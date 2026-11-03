import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { query, queryOne } from '../db.js';
import { DS_WORKSPACE_ID } from '../db/demoStudio.js';
import { exigir, papelDaRequisicao, validar, type Usuario } from '../lib/demoStudio/acesso.js';
import { aoVivo, canalDaSessao, contarPor, funil, resumo, serieDiaria, type SessaoMetrica } from '../lib/demoStudio/metrics.js';

/**
 * Analytics do Demo Studio (§4.5, §8.3): visão geral, funil, lista de sessões e linha do tempo.
 * Sessões internas (gente logada no painel) e robôs nunca entram. Vendedor (SELLER) só enxerga as
 * sessões dos links que ele criou.
 */

const DIA = /^\d{4}-\d{2}-\d{2}$/;
const filtro = z.object({
  from: z.string().regex(DIA, 'Data no formato aaaa-mm-dd'),
  to: z.string().regex(DIA, 'Data no formato aaaa-mm-dd'),
  demoId: z.string().uuid().optional(),
  linkId: z.string().uuid().optional(),
  sellerId: z.string().uuid().optional(),
});
type Filtro = z.infer<typeof filtro>;

/** Período em dias de calendário de São Paulo (UTC-3, sem horário de verão desde 2019). */
function periodo(f: Filtro): { de: Date; ate: Date } {
  return { de: new Date(`${f.from}T00:00:00-03:00`), ate: new Date(`${f.to}T23:59:59.999-03:00`) };
}

/** Vendedor vê só os próprios links, não importa o que pedir no filtro. */
function filtroEfetivo(req: FastifyRequest, f: Filtro): Filtro {
  return papelDaRequisicao(req) === 'SELLER' ? { ...f, sellerId: (req.user as Usuario).sub } : f;
}

const COLUNAS = `
  s.id, s.visitor_id, s.demo_id, s.link_id, l.label AS link_label, s.lead_id, s.started_at, s.last_seen_at,
  s.active_ms, s.max_step_order, s.steps_viewed, s.total_steps, s.completed, s.cta_clicked, s.device,
  s.browser, s.os, s.referrer, s.utm->>'source' AS utm_source, d.name AS demo_name, ld.name AS lead_name, ld.company AS lead_company`;
const ORIGEM = `
  FROM ds_view_sessions s
  JOIN ds_demos d ON d.id = s.demo_id
  LEFT JOIN ds_share_links l ON l.id = s.link_id
  LEFT JOIN ds_leads ld ON ld.id = s.lead_id`;
const ONDE = `
  WHERE NOT s.internal AND s.started_at BETWEEN $1 AND $2
    AND ($3::uuid IS NULL OR s.demo_id = $3)
    AND ($4::uuid IS NULL OR s.link_id = $4)
    AND ($5::uuid IS NULL OR l.created_by = $5)`;

function parametros(f: Filtro) {
  const { de, ate } = periodo(f);
  return [de, ate, f.demoId ?? null, f.linkId ?? null, f.sellerId ?? null];
}

function paraMetrica(r: Record<string, any>): SessaoMetrica {
  return {
    id: r.id,
    visitorId: r.visitor_id,
    demoId: r.demo_id,
    linkId: r.link_id,
    linkLabel: r.link_label,
    leadId: r.lead_id,
    startedAt: new Date(r.started_at),
    lastSeenAt: new Date(r.last_seen_at),
    activeMs: r.active_ms,
    maxStepOrder: r.max_step_order,
    stepsViewed: r.steps_viewed,
    totalSteps: r.total_steps,
    completed: r.completed,
    ctaClicked: r.cta_clicked,
    device: r.device,
    referrer: r.referrer,
    utmSource: r.utm_source || null,
  };
}

/** Linha da lista de sessões (§4.5): quando, quem, link, dispositivo, duração, etapas, concluiu, CTA. */
function sessaoDaLinha(r: Record<string, any>) {
  return {
    id: r.id,
    startedAt: r.started_at,
    lastSeenAt: r.last_seen_at,
    demo: { id: r.demo_id, name: r.demo_name },
    lead: r.lead_id ? { id: r.lead_id, name: r.lead_name, company: r.lead_company } : null,
    link: r.link_id ? { id: r.link_id, label: r.link_label } : null,
    channel: canalDaSessao(paraMetrica(r)),
    device: r.device,
    browser: r.browser,
    os: r.os,
    activeMs: r.active_ms,
    stepsViewed: r.steps_viewed,
    totalSteps: r.total_steps,
    maxStepOrder: r.max_step_order,
    completed: r.completed,
    ctaClicked: r.cta_clicked,
  };
}

async function sessoesDoFiltro(f: Filtro) {
  return query<Record<string, any>>(`SELECT ${COLUNAS} ${ORIGEM} ${ONDE} ORDER BY s.started_at DESC`, parametros(f));
}

/** Etapas da demo para o funil/linha do tempo: as da versão publicada, senão as do rascunho. */
async function etapasDaDemo(demoId: string, versionId?: string | null) {
  const v = await queryOne<{ steps: { id: string; order: number; title: string; kind: string }[] }>(
    `SELECT v.snapshot->'steps' AS steps FROM ds_demo_versions v
     WHERE v.id = COALESCE($2::uuid, (SELECT published_version_id FROM ds_demos WHERE id = $1)) AND v.demo_id = $1`,
    [demoId, versionId ?? null]
  );
  if (v?.steps) return v.steps.map((s) => ({ id: s.id, order: s.order, title: s.title, kind: s.kind }));
  const rascunho = await query<{ id: string; order: number; title: string; kind: string }>(
    `SELECT id, "order", title, kind FROM ds_steps WHERE demo_id = $1 ORDER BY "order"`,
    [demoId]
  );
  return rascunho;
}

function lerFiltro(req: FastifyRequest, reply: FastifyReply): Filtro | undefined {
  const f = validar(filtro, req.query, reply);
  return f ? filtroEfetivo(req, f) : undefined;
}

export async function demoStudioAnalyticsRoutes(app: FastifyInstance) {
  const ver = { onRequest: [app.authenticate], preHandler: exigir('ver') };

  app.get('/api/ds/analytics', ver, async (req, reply) => {
    const f = lerFiltro(req, reply);
    if (!f) return;
    const { de, ate } = periodo(f);
    const linhas = await sessoesDoFiltro(f);
    const s = linhas.map(paraMetrica);
    const nomeDaDemo = new Map(linhas.map((r) => [r.demo_id as string, r.demo_name as string]));
    const leads = await queryOne<{ n: number }>(
      `SELECT COUNT(*)::int AS n FROM ds_leads ld
       WHERE ld.workspace_id = $1 AND ld.first_seen_at BETWEEN $2 AND $3
         AND ($4::text IS NULL OR ld.source->>'demoId' = $4::text)
         AND ($5::uuid IS NULL OR ld.owner_id = $5)`,
      [DS_WORKSPACE_ID, de, ate, f.demoId ?? null, f.sellerId ?? null]
    );
    return {
      periodo: { de, ate },
      resumo: resumo(s),
      leads: leads?.n ?? 0,
      serie: serieDiaria(s, de, ate),
      dispositivos: contarPor(s, (x) => x.device ?? 'desktop'),
      canais: contarPor(s, canalDaSessao),
      demos: contarPor(s, (x) => x.demoId).slice(0, 10).map((d) => ({ ...d, nome: nomeDaDemo.get(d.chave) ?? '—' })),
      aoVivo: aoVivo(s),
      recentes: linhas.slice(0, 10).map(sessaoDaLinha),
    };
  });

  /** Opções dos filtros: links (com a demo) e vendedores (quem criou link). Vendedor só vê os próprios. */
  app.get('/api/ds/analytics/filters', ver, async (req) => {
    const so = papelDaRequisicao(req) === 'SELLER' ? (req.user as Usuario).sub : null;
    const [links, vendedores] = await Promise.all([
      query(
        `SELECT l.id, l.label, l.kind, l.demo_id AS "demoId", d.name AS "demoName"
         FROM ds_share_links l JOIN ds_demos d ON d.id = l.demo_id
         WHERE ($1::uuid IS NULL OR l.created_by = $1) ORDER BY d.name, l.label`,
        [so]
      ),
      query(
        `SELECT DISTINCT p.id, p.name FROM ds_share_links l JOIN profiles p ON p.id = l.created_by
         WHERE ($1::uuid IS NULL OR p.id = $1) ORDER BY p.name`,
        [so]
      ),
    ]);
    return { links, vendedores };
  });

  app.get('/api/ds/analytics/funnel', ver, async (req, reply) => {
    const f = lerFiltro(req, reply);
    if (!f) return;
    if (!f.demoId) return reply.status(400).send({ message: 'Escolha uma demo para ver o funil.' });
    const s = (await sessoesDoFiltro(f)).map(paraMetrica);
    const etapas = await etapasDaDemo(f.demoId);
    return funil(s, etapas.map((e) => ({ order: e.order, title: e.title, kind: e.kind })));
  });

  app.get('/api/ds/sessions', ver, async (req, reply) => {
    const f = lerFiltro(req, reply);
    if (!f) return;
    const pag = z.object({ limit: z.coerce.number().int().min(1).max(200).default(50), offset: z.coerce.number().int().min(0).default(0) })
      .parse(req.query);
    const p = parametros(f);
    const [linhas, total] = await Promise.all([
      query(`SELECT ${COLUNAS} ${ORIGEM} ${ONDE} ORDER BY s.started_at DESC LIMIT $6 OFFSET $7`, [...p, pag.limit, pag.offset]),
      queryOne<{ n: number }>(`SELECT COUNT(*)::int AS n ${ORIGEM} ${ONDE}`, p),
    ]);
    return { total: total?.n ?? 0, sessions: linhas.map(sessaoDaLinha) };
  });

  app.get<{ Params: { id: string } }>('/api/ds/sessions/:id', ver, async (req, reply) => {
    const r = await queryOne<Record<string, any>>(
      `SELECT ${COLUNAS}, s.version_id, s.utm, s.internal, l.created_by AS link_owner ${ORIGEM} WHERE s.id = $1`,
      [req.params.id]
    );
    if (!r) return reply.status(404).send({ message: 'Sessão não encontrada' });
    if (papelDaRequisicao(req) === 'SELLER' && r.link_owner !== (req.user as Usuario).sub) {
      return reply.status(404).send({ message: 'Sessão não encontrada' });
    }
    const [eventos, etapas] = await Promise.all([
      query(`SELECT type, step_id AS "stepId", step_order AS "order", data, ts FROM ds_events WHERE session_id = $1 ORDER BY ts, id`, [r.id]),
      etapasDaDemo(r.demo_id, r.version_id),
    ]);
    return {
      ...sessaoDaLinha(r),
      internal: r.internal,
      utm: r.utm,
      steps: etapas,
      events: eventos,
    };
  });
}
