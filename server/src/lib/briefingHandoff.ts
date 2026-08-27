import { v4 as uuidv4 } from 'uuid';
import { query, queryOne } from '../db.js';
import { findMatchingLeadRowId } from './leadMatch.js';

/**
 * Quando o contrato é assinado (manual ou pelo webhook do Autentique), o cliente avança pra
 * "Briefing" — e, pra facilitar a vida do Suporte, as "Atualizações" que o SDR escreveu no card
 * dele no CRM (lead_notes) são copiadas pra "Mensagens registradas" do cliente (client.notes),
 * marcadas como nota interna (não aparecem em portal público, já que costumam ter detalhe de
 * negociação — valor combinado, condição especial, etc.).
 *
 * Não existe vínculo direto entre `clients` (ficha pública) e `lead_rows` (card do CRM) — são
 * cadastros separados do mesmo prospect. O jeito de achar o lead certo aqui é por telefone
 * primeiro e nome/empresa como fallback (ver findMatchingLeadRowId, lib/leadMatch.ts — muitos
 * leads do CRM não têm telefone preenchido); se achar mais de um ou nenhum em qualquer critério,
 * não copia nada — silencioso, mas seguro (não expõe conversa de gente errada). Só avança a etapa
 * (nunca regride) e só se o cliente ainda estiver exatamente em "Contrato" — a mesma regra de sempre.
 */
export async function advanceClientToBriefing(clientId: string): Promise<void> {
  const client = await queryOne<{ id: string; stage: string; phone: string | null; name: string | null; company: string | null }>(
    'SELECT id, stage, phone, name, company FROM clients WHERE id = $1',
    [clientId]
  );
  if (!client || client.stage !== 'contract') return;

  await query(`UPDATE clients SET stage = 'briefing', contract_signed_at = NOW() WHERE id = $1`, [clientId]);

  const leadId = await findMatchingLeadRowId(client.phone, client.name, client.company);
  if (!leadId) return;

  const notes = await query<{ author_name: string; content: string; created_at: string }>(
    'SELECT author_name, content, created_at FROM lead_notes WHERE lead_row_id = $1 ORDER BY created_at ASC',
    [leadId]
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
