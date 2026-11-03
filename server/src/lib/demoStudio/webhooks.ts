import { createHmac, randomBytes } from 'node:crypto';
import { query, queryOne } from '../../db.js';
import { DS_WORKSPACE_ID } from '../../db/demoStudio.js';

/**
 * Webhooks do Demo Studio para o n8n (§9.1). Cada evento vira uma linha em ds_webhook_deliveries por
 * webhook assinante; o worker (a cada 10s, no mesmo processo) entrega com assinatura HMAC e tenta de novo
 * com backoff de 1 min, 5 min e 30 min antes de desistir.
 */

export const EVENTOS_DE_WEBHOOK = ['lead.created', 'lead.updated', 'session.started', 'session.completed', 'cta.clicked'] as const;
export type EventoDeWebhook = (typeof EVENTOS_DE_WEBHOOK)[number];

/** Espera depois da 1ª, 2ª e 3ª falha. Depois da 4ª tentativa, FAILED. */
export const BACKOFF_MS = [60_000, 5 * 60_000, 30 * 60_000];

export function assinar(segredo: string, corpo: string): string {
  return 'sha256=' + createHmac('sha256', segredo).update(corpo).digest('hex');
}

export function novoSegredo(): string {
  return randomBytes(24).toString('hex');
}

/** Próximo estado depois de uma tentativa que falhou (`tentativas` já contando esta). */
export function depoisDaFalha(tentativas: number, agora = Date.now()): { status: 'PENDING' | 'FAILED'; proxima: Date | null } {
  const espera = BACKOFF_MS[tentativas - 1];
  return espera === undefined ? { status: 'FAILED', proxima: null } : { status: 'PENDING', proxima: new Date(agora + espera) };
}

const base = () => (process.env.PUBLIC_BASE_URL || '').replace(/\/+$/, '');

/** Corpo do webhook no formato da §9.1. */
export async function montarPayload(evento: string, ref: { sessionId?: string | null; leadId?: string | null }) {
  const s = ref.sessionId
    ? await queryOne<Record<string, any>>(
        `SELECT s.*, d.name AS demo_name, d.slug, l.code, l.label, p.name AS seller_name, p.email AS seller_email
         FROM ds_view_sessions s JOIN ds_demos d ON d.id = s.demo_id
         LEFT JOIN ds_share_links l ON l.id = s.link_id LEFT JOIN profiles p ON p.id = l.created_by
         WHERE s.id = $1`,
        [ref.sessionId]
      )
    : null;
  const leadId = ref.leadId ?? s?.lead_id ?? null;
  const lead = leadId
    ? await queryOne<Record<string, any>>(
        `SELECT ld.*, d.name AS demo_name, d.slug, l.code, l.label, p.name AS seller_name, p.email AS seller_email
         FROM ds_leads ld
         LEFT JOIN ds_demos d ON d.id::text = ld.source->>'demoId'
         LEFT JOIN ds_share_links l ON l.id::text = ld.source->>'linkId'
         LEFT JOIN profiles p ON p.id = COALESCE(l.created_by, ld.owner_id)
         WHERE ld.id = $1`,
        [leadId]
      )
    : null;
  const ctx = s ?? lead;
  return {
    event: evento,
    sentAt: new Date().toISOString(),
    demo: ctx?.slug ? { id: s?.demo_id ?? lead?.source?.demoId, name: ctx.demo_name, url: `${base()}/d/${ctx.slug}` } : null,
    link: ctx?.code
      ? { code: ctx.code, label: ctx.label, seller: ctx.seller_name ? { name: ctx.seller_name, email: ctx.seller_email } : null }
      : null,
    lead: lead
      ? { id: lead.id, nome: lead.name, empresa: lead.company, whatsapp: lead.phone_e164, email: lead.email, score: lead.score, status: lead.status }
      : null,
    session: s
      ? {
          id: s.id,
          startedAt: s.started_at,
          activeSeconds: Math.round(s.active_ms / 1000),
          stepsViewed: s.steps_viewed,
          totalSteps: s.total_steps,
          completed: s.completed,
          device: s.device,
        }
      : null,
    panelUrl: lead ? `${base()}/demo-studio/leads/${lead.id}` : s ? `${base()}/demo-studio/sessoes/${s.id}` : null,
  };
}

/** Enfileira o evento para todo webhook ativo que o assina. Nunca lança: webhook não pode travar a coleta. */
export async function dispararEvento(evento: EventoDeWebhook, ref: { sessionId?: string | null; leadId?: string | null }): Promise<void> {
  try {
    const ganchos = await query<{ id: string }>(
      `SELECT id FROM ds_webhooks WHERE workspace_id = $1 AND active AND $2 = ANY(events)`,
      [DS_WORKSPACE_ID, evento]
    );
    if (!ganchos.length) return;
    const payload = await montarPayload(evento, ref);
    for (const g of ganchos) {
      await query(`INSERT INTO ds_webhook_deliveries (webhook_id, event, payload) VALUES ($1, $2, $3)`, [g.id, evento, JSON.stringify(payload)]);
    }
  } catch (err) {
    console.error('[demo-studio] erro ao enfileirar webhook:', err);
  }
}

/** Faz uma tentativa de entrega e grava o resultado. */
export async function entregar(entregaId: string): Promise<{ ok: boolean; status: number | null; corpo: string }> {
  const e = await queryOne<{ url: string; secret: string; payload: unknown; attempts: number; event: string }>(
    `SELECT w.url, w.secret, d.payload, d.attempts, d.event FROM ds_webhook_deliveries d JOIN ds_webhooks w ON w.id = d.webhook_id WHERE d.id = $1`,
    [entregaId]
  );
  if (!e) return { ok: false, status: null, corpo: 'entrega não encontrada' };
  const corpo = JSON.stringify(e.payload);
  let status: number | null = null;
  let resposta = '';
  try {
    const r = await fetch(e.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'NXDemoStudio-Webhook/1.0',
        'X-NXDemo-Event': e.event,
        'X-NXDemo-Delivery': entregaId,
        'X-NXDemo-Signature': assinar(e.secret, corpo),
      },
      body: corpo,
      signal: AbortSignal.timeout(10_000),
    });
    status = r.status;
    resposta = (await r.text().catch(() => '')).slice(0, 1000);
  } catch (err) {
    resposta = String((err as Error).message ?? err).slice(0, 1000);
  }
  const ok = status !== null && status >= 200 && status < 300;
  const tentativas = e.attempts + 1;
  const prox = ok ? { status: 'SUCCESS' as const, proxima: null } : depoisDaFalha(tentativas);
  await query(
    `UPDATE ds_webhook_deliveries SET status = $2, attempts = $3, next_attempt_at = COALESCE($4, next_attempt_at),
       response_code = $5, response_body = $6 WHERE id = $1`,
    [entregaId, prox.status, tentativas, prox.proxima, status, resposta]
  );
  return { ok, status, corpo: resposta };
}

let rodando = false;
async function rodada() {
  if (rodando) return;
  rodando = true;
  try {
    const pendentes = await query<{ id: string }>(
      `SELECT id FROM ds_webhook_deliveries WHERE status = 'PENDING' AND next_attempt_at <= NOW() ORDER BY next_attempt_at LIMIT 20`
    );
    for (const p of pendentes) await entregar(p.id);
  } catch (err) {
    console.error('[demo-studio] worker de webhooks:', err);
  } finally {
    rodando = false;
  }
}

export function startDemoStudioWebhooks() {
  setInterval(rodada, 10_000);
}
