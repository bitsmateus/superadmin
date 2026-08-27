import { v4 as uuidv4 } from 'uuid';
import { query, queryOne } from '../db.js';

/** Só os últimos 8 dígitos — tolera diferença de DDI (55) e o "9" extra que nem todo cadastro
 * tem, sem exigir que os dois números estejam no formato exatamente igual. Exportada porque a
 * mesma heurística é reusada em GET /api/clients/:id/crm-lead (ver routes/clients.ts). */
export function phoneKey(raw: string | null | undefined): string | null {
  const digits = (raw ?? '').replace(/\D/g, '');
  return digits.length >= 8 ? digits.slice(-8) : null;
}

/**
 * Quando o contrato é assinado (manual ou pelo webhook do Autentique), o cliente avança pra
 * "Briefing" — e, pra facilitar a vida do Suporte, as "Atualizações" que o SDR escreveu no card
 * dele no CRM (lead_notes) são copiadas pra "Mensagens registradas" do cliente (client.notes),
 * marcadas como nota interna (não aparecem em portal público, já que costumam ter detalhe de
 * negociação — valor combinado, condição especial, etc.).
 *
 * Não existe vínculo direto entre `clients` (ficha pública) e `lead_rows` (card do CRM) — são
 * cadastros separados do mesmo prospect. O jeito de achar o lead certo aqui é por telefone
 * (últimos 8 dígitos, pra tolerar formato diferente); se achar mais de um ou nenhum, não copia
 * nada — silencioso, mas seguro (não expõe conversa de gente errada). Só avança a etapa (nunca
 * regride) e só se o cliente ainda estiver exatamente em "Contrato" — a mesma regra de sempre.
 */
export async function advanceClientToBriefing(clientId: string): Promise<void> {
  const client = await queryOne<{ id: string; stage: string; phone: string | null }>(
    'SELECT id, stage, phone FROM clients WHERE id = $1',
    [clientId]
  );
  if (!client || client.stage !== 'contract') return;

  await query(`UPDATE clients SET stage = 'briefing', contract_signed_at = NOW() WHERE id = $1`, [clientId]);

  const key = phoneKey(client.phone);
  if (!key) return;

  const candidates = await query<{ id: string }>(
    `SELECT id FROM lead_rows
     WHERE deleted_at IS NULL AND right(regexp_replace(telefone, '\\D', '', 'g'), 8) = $1
     ORDER BY created_at DESC`,
    [key]
  );
  if (candidates.length !== 1) return;

  const notes = await query<{ author_name: string; content: string; created_at: string }>(
    'SELECT author_name, content, created_at FROM lead_notes WHERE lead_row_id = $1 ORDER BY created_at ASC',
    [candidates[0].id]
  );
  if (!notes.length) return;

  const copied = notes.map((n) => ({
    id: uuidv4(),
    text: n.content,
    author: n.author_name,
    createdAt: n.created_at,
    internal: true,
  }));

  const current = await queryOne<{ notes: unknown[] }>('SELECT notes FROM clients WHERE id = $1', [clientId]);
  const merged = [...copied.reverse(), ...(current?.notes ?? [])];
  await query('UPDATE clients SET notes = $2 WHERE id = $1', [clientId, JSON.stringify(merged)]);
}
