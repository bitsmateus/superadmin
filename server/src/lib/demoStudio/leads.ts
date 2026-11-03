import type { PoolClient } from 'pg';
import { pool, query, queryOne } from '../../db.js';
import { DS_WORKSPACE_ID } from '../../db/demoStudio.js';

/**
 * Leads do Demo Studio (§4.6, §8.2): normalização do WhatsApp para E.164, deduplicação por telefone ou
 * e-mail e pontuação de engajamento (§8.3). As funções puras ficam no topo, com testes.
 */

type Exec = Pick<PoolClient, 'query'>;

/** WhatsApp para E.164. Número brasileiro sem DDI ganha +55; lixo vira null. */
export function telefoneE164(entrada: string | null | undefined): string | null {
  if (!entrada) return null;
  let d = entrada.replace(/\D/g, '');
  if (d.startsWith('00')) d = d.slice(2);
  if (d.length === 10 || d.length === 11) d = '55' + d;
  if (d.length < 12 || d.length > 15) return null;
  return '+' + d;
}

export function emailNormalizado(entrada: string | null | undefined): string | null {
  const e = (entrada ?? '').trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) ? e : null;
}

export interface SessaoParaPontuar {
  completed: boolean;
  activeMs: number;
  ctaClicked: boolean;
}

/**
 * Pontuação (§8.3): 40×conclusão + 20×min(tempo/120s,1) + 15×min(sessões−1,2)/2 + 25×ctaClicked, 0–100.
 * "Conclusão" e "CTA" valem se aconteceram em qualquer sessão; o tempo é o total somado.
 */
export function pontuacao(sessoes: SessaoParaPontuar[]): number {
  if (!sessoes.length) return 0;
  const concluiu = sessoes.some((s) => s.completed) ? 1 : 0;
  const tempo = Math.min(sessoes.reduce((t, s) => t + s.activeMs, 0) / 120_000, 1);
  const repetiu = Math.min(sessoes.length - 1, 2) / 2;
  const cta = sessoes.some((s) => s.ctaClicked) ? 1 : 0;
  return Math.round(40 * concluiu + 20 * tempo + 15 * repetiu + 25 * cta);
}

export const LEAD_QUENTE = 70;

export interface DadosDoLead {
  name?: string | null;
  company?: string | null;
  phone?: string | null;
  email?: string | null;
  role?: string | null;
  cnpj?: string | null;
}

/**
 * Cria ou atualiza um lead. Acha o existente pelo `leadId` (lead já ligado à sessão), senão por telefone
 * E.164, senão por e-mail. Campos vazios não apagam o que já existe. Devolve se foi criado.
 */
export async function salvarLead(
  db: Exec,
  dados: DadosDoLead,
  extra: { leadId?: string | null; ownerId?: string | null; source?: Record<string, unknown> }
): Promise<{ id: string; criado: boolean; mudou: boolean }> {
  const phone = telefoneE164(dados.phone);
  const email = emailNormalizado(dados.email);
  const limpo = (v?: string | null) => (v ?? '').trim().slice(0, 200) || null;

  let existente: Record<string, any> | undefined;
  if (extra.leadId) existente = (await db.query(`SELECT * FROM ds_leads WHERE id = $1`, [extra.leadId])).rows[0];
  if (!existente && phone) existente = (await db.query(`SELECT * FROM ds_leads WHERE workspace_id = $1 AND phone_e164 = $2 ORDER BY first_seen_at LIMIT 1`, [DS_WORKSPACE_ID, phone])).rows[0];
  if (!existente && email) existente = (await db.query(`SELECT * FROM ds_leads WHERE workspace_id = $1 AND email = $2 ORDER BY first_seen_at LIMIT 1`, [DS_WORKSPACE_ID, email])).rows[0];

  const novos = {
    name: limpo(dados.name), company: limpo(dados.company), phone_e164: phone, email,
    role: limpo(dados.role), cnpj: (dados.cnpj ?? '').replace(/\D/g, '') || null,
  };

  if (!existente) {
    const { rows } = await db.query(
      `INSERT INTO ds_leads (workspace_id, name, company, phone_e164, email, role, cnpj, owner_id, source)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
      [DS_WORKSPACE_ID, novos.name, novos.company, novos.phone_e164, novos.email, novos.role, novos.cnpj, extra.ownerId ?? null, JSON.stringify(extra.source ?? {})]
    );
    return { id: rows[0].id, criado: true, mudou: true };
  }
  const mudou = (Object.keys(novos) as (keyof typeof novos)[]).some((k) => novos[k] && novos[k] !== existente![k]);
  await db.query(
    `UPDATE ds_leads SET
       name = COALESCE($2, name), company = COALESCE($3, company), phone_e164 = COALESCE($4, phone_e164),
       email = COALESCE($5, email), role = COALESCE($6, role), cnpj = COALESCE($7, cnpj),
       owner_id = COALESCE(owner_id, $8), last_seen_at = NOW()
     WHERE id = $1`,
    [existente.id, novos.name, novos.company, novos.phone_e164, novos.email, novos.role, novos.cnpj, extra.ownerId ?? null]
  );
  return { id: existente.id, criado: false, mudou };
}

/**
 * Liga o lead à sessão e ao visitante. As outras sessões do mesmo visitante (antes e depois) passam a
 * mostrar o lead também (§8.2).
 */
export async function ligarLeadAoVisitante(db: Exec, leadId: string, sessionId: string): Promise<void> {
  const { rows } = await db.query(`UPDATE ds_view_sessions SET lead_id = $2 WHERE id = $1 RETURNING visitor_id`, [sessionId, leadId]);
  const visitante = rows[0]?.visitor_id;
  if (!visitante) return;
  await db.query(`UPDATE ds_visitors SET lead_id = $2 WHERE id = $1`, [visitante, leadId]);
  await db.query(`UPDATE ds_view_sessions SET lead_id = $2 WHERE visitor_id = $1 AND lead_id IS NULL`, [visitante, leadId]);
}

/** Recalcula pontuação e última visita a partir das sessões (não internas) do lead. */
export async function atualizarPontuacao(leadId: string, db: Exec = pool): Promise<number> {
  const { rows } = await db.query(
    `SELECT completed, active_ms, cta_clicked, last_seen_at FROM ds_view_sessions WHERE lead_id = $1 AND NOT internal`,
    [leadId]
  );
  const score = pontuacao(rows.map((r) => ({ completed: r.completed, activeMs: r.active_ms, ctaClicked: r.cta_clicked })));
  await db.query(
    `UPDATE ds_leads SET score = $2,
       last_seen_at = GREATEST(last_seen_at, COALESCE((SELECT MAX(last_seen_at) FROM ds_view_sessions WHERE lead_id = $1), last_seen_at))
     WHERE id = $1`,
    [leadId, score]
  );
  return score;
}

/** Lead no formato do painel/webhook. */
export async function leadResumo(leadId: string) {
  return queryOne<{ id: string; nome: string | null; empresa: string | null; whatsapp: string | null; email: string | null; score: number; status: string }>(
    `SELECT id, name AS nome, company AS empresa, phone_e164 AS whatsapp, email, score, status FROM ds_leads WHERE id = $1`,
    [leadId]
  );
}

export async function apagarLeadComTudo(leadId: string): Promise<boolean> {
  // Direito de exclusão (LGPD, §13): o lead e todas as sessões/eventos dele.
  await query(`DELETE FROM ds_view_sessions WHERE lead_id = $1`, [leadId]);
  await query(`UPDATE ds_visitors SET lead_id = NULL WHERE lead_id = $1`, [leadId]);
  await query(`UPDATE ds_share_links SET lead_id = NULL, active = FALSE WHERE lead_id = $1`, [leadId]);
  const r = await query(`DELETE FROM ds_leads WHERE id = $1 RETURNING id`, [leadId]);
  return r.length > 0;
}
