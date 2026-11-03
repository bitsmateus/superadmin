import { createHash } from 'node:crypto';
import UAParser from 'ua-parser-js';
import { z } from 'zod';
import type { PoolClient } from 'pg';
import { withTransaction } from '../../db.js';
import { atualizarPontuacao } from './leads.js';
import { dispararEvento } from './webhooks.js';

/**
 * Processamento do POST /api/t (§8.2): valida o lote do player, cria/atualiza visitante e sessão, grava os
 * eventos e mantém os agregados da sessão (é deles que saem as métricas — ver metrics.ts).
 */

const id = z.string().uuid();

const evento = z.discriminatedUnion('t', [
  z.object({ t: z.literal('session_start'), ts: z.number() }),
  z.object({ t: z.literal('step_view'), ts: z.number(), stepId: id, order: z.number().int().min(1).max(1000) }),
  z.object({ t: z.literal('hotspot_click'), ts: z.number(), stepId: id }),
  z.object({ t: z.literal('chapter_open'), ts: z.number(), chapter: z.string().max(120) }),
  z.object({ t: z.literal('lead_submit'), ts: z.number(), fields: z.record(z.string().max(40), z.string().max(200)) }),
  z.object({ t: z.literal('cta_click'), ts: z.number(), cta: z.string().max(20) }),
  z.object({ t: z.literal('complete'), ts: z.number() }),
  z.object({ t: z.literal('heartbeat'), ts: z.number(), activeMs: z.number().int().min(0).max(60000) }),
]);

const texto = (max: number) => z.string().max(max).optional().default('');

export const loteDeEventos = z.object({
  v: z.literal(1),
  demoId: id,
  versionId: id.nullable().optional(),
  linkCode: z.string().regex(/^[0-9A-Za-z]{7}$/).optional(),
  visitorId: id,
  sessionId: id,
  internal: z.boolean().optional(),
  ctx: z
    .object({
      url: texto(500),
      referrer: texto(500),
      utm: z.object({ source: texto(100), medium: texto(100), campaign: texto(100) }).partial().optional(),
      screen: z.object({ w: z.number(), h: z.number(), dpr: z.number() }).partial().optional(),
      lang: texto(20),
      tz: texto(60),
    })
    .partial()
    .optional(),
  events: z.array(evento).min(1).max(100),
});
export type LoteDeEventos = z.infer<typeof loteDeEventos>;

/** Lista básica de robôs, incluindo o preview de link do WhatsApp e do Facebook (§8.1). */
const ROBOS = /bot|crawler|spider|crawling|WhatsApp\/|facebookexternalhit|Facebot|Slackbot|TelegramBot|Discordbot|preview|HeadlessChrome|curl\/|wget|python-requests/i;
export function ehRobo(ua: string | undefined): boolean {
  return !ua || ROBOS.test(ua);
}

/** Dispositivo/navegador/SO pelo user-agent. Sem tipo de aparelho = desktop. */
export function lerDispositivo(ua: string): { device: 'mobile' | 'tablet' | 'desktop'; browser: string | null; os: string | null } {
  const r = new UAParser(ua).getResult();
  const tipo = r.device.type === 'mobile' || r.device.type === 'tablet' ? r.device.type : 'desktop';
  return { device: tipo, browser: r.browser.name ?? null, os: r.os.name ?? null };
}

/**
 * IP do visitante: atrás do proxy do Easypanel o `req.ip` é o do proxy, então vale o primeiro do
 * X-Forwarded-For. Só serve pra rate limit e pro hash — o IP em claro nunca é gravado.
 */
export function ipDoVisitante(xff: string | string[] | undefined, ipDireto: string): string {
  const v = Array.isArray(xff) ? xff[0] : xff;
  return (v?.split(',')[0] ?? '').trim() || ipDireto;
}

export function hashDoIp(ip: string): string {
  return createHash('sha256').update(ip + (process.env.IP_SALT ?? '')).digest('hex');
}

/** Rate limit simples em memória: N requisições por janela, por chave. */
export function criarLimitador(maximo: number, janelaMs: number) {
  const contas = new Map<string, { n: number; desde: number }>();
  return (chave: string, agora = Date.now()): boolean => {
    const c = contas.get(chave);
    if (!c || agora - c.desde >= janelaMs) {
      contas.set(chave, { n: 1, desde: agora });
      if (contas.size > 20000) for (const [k, v] of contas) if (agora - v.desde >= janelaMs) contas.delete(k);
      return true;
    }
    c.n++;
    return c.n <= maximo;
  };
}

/** Horário do evento: o do navegador, se for plausível; senão o do servidor. */
export function horarioDoEvento(ts: number, agora = Date.now()): Date {
  return ts > agora - 24 * 3600_000 && ts < agora + 60_000 ? new Date(ts) : new Date(agora);
}

/** O que o lote muda nos agregados da sessão (puro, testado). */
export function resumoDoLote(eventos: LoteDeEventos['events']) {
  let activeMs = 0;
  let maxOrder = 0;
  let completed = false;
  let cta = false;
  for (const e of eventos) {
    if (e.t === 'heartbeat') activeMs += Math.min(e.activeMs, 20000);
    if (e.t === 'step_view') maxOrder = Math.max(maxOrder, e.order);
    if (e.t === 'complete') completed = true;
    if (e.t === 'cta_click') cta = true;
  }
  return { activeMs, maxOrder, completed, cta };
}

export interface ContextoDaColeta {
  ua: string;
  ipHash: string;
}

/** O que o lote mudou na sessão — usado pra disparar webhooks e recalcular a pontuação do lead. */
export interface ResultadoDoLote {
  sessionId: string;
  leadId: string | null;
  internal: boolean;
  criada: boolean;
  concluiuAgora: boolean;
  ctaAgora: boolean;
}

/**
 * Grava o lote e, depois de confirmado, dispara os webhooks (§9.1) e recalcula a pontuação do lead.
 * Devolve null quando o lote não vale (demo inexistente, sessão de outra demo) — o endpoint responde 204
 * do mesmo jeito: o player não tem o que fazer com erro.
 */
export async function gravarLote(lote: LoteDeEventos, c: ContextoDaColeta): Promise<ResultadoDoLote | null> {
  const r = await gravarNoBanco(lote, c);
  if (r?.leadId && !r.internal) {
    await atualizarPontuacao(r.leadId);
    if (r.criada) await dispararEvento('session.started', { sessionId: r.sessionId });
  }
  if (r && !r.internal) {
    if (r.concluiuAgora) await dispararEvento('session.completed', { sessionId: r.sessionId });
    if (r.ctaAgora) await dispararEvento('cta.clicked', { sessionId: r.sessionId });
  }
  return r;
}

async function gravarNoBanco(lote: LoteDeEventos, c: ContextoDaColeta): Promise<ResultadoDoLote | null> {
  return withTransaction(async (db) => {
    const { rows: demos } = await db.query(`SELECT id FROM ds_demos WHERE id = $1`, [lote.demoId]);
    if (!demos[0]) return null;

    let versionId: string | null = null;
    let totalSteps = 0;
    if (lote.versionId) {
      const { rows } = await db.query(
        `SELECT id, jsonb_array_length(snapshot->'steps') AS n FROM ds_demo_versions WHERE id = $1 AND demo_id = $2`,
        [lote.versionId, lote.demoId]
      );
      if (rows[0]) {
        versionId = rows[0].id;
        totalSteps = Number(rows[0].n);
      }
    }

    let linkId: string | null = null;
    let leadDoLink: string | null = null;
    if (lote.linkCode) {
      const { rows } = await db.query(
        `SELECT id, lead_id FROM ds_share_links WHERE code = $1 AND demo_id = $2 AND active AND (expires_at IS NULL OR expires_at > NOW())`,
        [lote.linkCode, lote.demoId]
      );
      linkId = rows[0]?.id ?? null;
      leadDoLink = rows[0]?.lead_id ?? null;
    }

    // Lote só de heartbeat não abre sessão: é aba esquecida aberta (ou sessão já expirada) e contaria
    // como uma view sem ninguém ter visto nada.
    if (lote.events.every((e) => e.t === 'heartbeat')) {
      const { rows } = await db.query(`SELECT 1 FROM ds_view_sessions WHERE id = $1`, [lote.sessionId]);
      if (!rows[0]) return null;
    }

    const agora = Date.now();
    const horarios = lote.events.map((e) => horarioDoEvento(e.ts, agora));
    const primeiro = new Date(Math.min(...horarios.map((d) => d.getTime())));
    const ultimo = new Date(Math.max(...horarios.map((d) => d.getTime())));

    await db.query(
      `INSERT INTO ds_visitors (id, first_seen_at, last_seen_at) VALUES ($1, $2, $3)
       ON CONFLICT (id) DO UPDATE SET last_seen_at = GREATEST(ds_visitors.last_seen_at, EXCLUDED.last_seen_at)`,
      [lote.visitorId, primeiro, ultimo]
    );
    const { rows: visitante } = await db.query(`SELECT lead_id FROM ds_visitors WHERE id = $1`, [lote.visitorId]);

    const disp = lerDispositivo(c.ua);
    const utm = lote.ctx?.utm ?? {};
    const { rows: inserida } = await db.query(
      `INSERT INTO ds_view_sessions
         (id, demo_id, version_id, link_id, visitor_id, lead_id, started_at, last_seen_at, total_steps,
          internal, device, browser, os, referrer, utm, ip_hash)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $7, $8, $9, $10, $11, $12, $13, $14, $15)
       ON CONFLICT (id) DO NOTHING RETURNING id`,
      [
        lote.sessionId, lote.demoId, versionId, linkId, lote.visitorId, leadDoLink ?? visitante[0]?.lead_id ?? null,
        primeiro, totalSteps, !!lote.internal, disp.device, disp.browser, disp.os,
        lote.ctx?.referrer || null, JSON.stringify(utm), c.ipHash,
      ]
    );
    const { rows: sessao } = await db.query(
      `SELECT demo_id, visitor_id, completed, cta_clicked FROM ds_view_sessions WHERE id = $1`,
      [lote.sessionId]
    );
    // Id de sessão de outra demo/visitante: não mistura (o navegador gera ids novos por demo).
    if (sessao[0]?.demo_id !== lote.demoId || sessao[0]?.visitor_id !== lote.visitorId) return null;
    const antes = sessao[0];

    await inserirEventos(db, lote, horarios);

    const r = resumoDoLote(lote.events);
    const { rows: depois } = await db.query(
      `UPDATE ds_view_sessions s SET
         last_seen_at = GREATEST(s.last_seen_at, $2),
         active_ms = s.active_ms + $3,
         max_step_order = GREATEST(s.max_step_order, $4),
         steps_viewed = (SELECT COUNT(DISTINCT e.step_id)::int FROM ds_events e WHERE e.session_id = s.id AND e.type = 'step_view'),
         completed = s.completed OR $5,
         cta_clicked = s.cta_clicked OR $6,
         -- Alguém logado no painel continuou esta sessão (mesmo navegador, menos de 30 min): ela inteira
         -- deixa de contar, senão a visita interna somaria etapas na sessão de um visitante de verdade.
         internal = s.internal OR $7
       WHERE s.id = $1
       RETURNING lead_id, internal, completed, cta_clicked`,
      [lote.sessionId, ultimo, r.activeMs, r.maxOrder, r.completed, r.cta, !!lote.internal]
    );
    const d = depois[0];
    return {
      sessionId: lote.sessionId,
      leadId: d.lead_id,
      internal: d.internal,
      criada: inserida.length > 0,
      concluiuAgora: !antes.completed && d.completed,
      ctaAgora: !antes.cta_clicked && d.cta_clicked,
    };
  });
}

async function inserirEventos(db: PoolClient, lote: LoteDeEventos, horarios: Date[]) {
  const valores: unknown[] = [];
  const linhas = lote.events.map((e, i) => {
    const { t, ts: _ts, ...resto } = e as Record<string, unknown> & { t: string; ts: number };
    const stepId = (resto.stepId as string | undefined) ?? null;
    const order = (resto.order as number | undefined) ?? null;
    delete resto.stepId;
    delete resto.order;
    // Os dados do formulário vão para ds_leads (POST /api/public/ds/leads); no evento fica só quais campos vieram.
    if (t === 'lead_submit' && resto.fields) resto.fields = Object.keys(resto.fields as object);
    valores.push(lote.sessionId, t, stepId, order, Object.keys(resto).length ? JSON.stringify(resto) : null, horarios[i]);
    const b = i * 6;
    return `($${b + 1}, $${b + 2}, $${b + 3}, $${b + 4}, $${b + 5}, $${b + 6})`;
  });
  await db.query(`INSERT INTO ds_events (session_id, type, step_id, step_order, data, ts) VALUES ${linhas.join(', ')}`, valores);
}
