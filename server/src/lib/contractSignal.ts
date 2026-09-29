import { query, queryOne } from '../db.js';
import { advanceClientToBriefing } from './briefingHandoff.js';

/**
 * Fecha a corrente do contrato: assinou -> a VENDA fica com "Contrato assinado" -> e os
 * lançamentos de comissão daquela venda também.
 *
 * Antes isso era marcado à mão em cada tela (contrato, venda e comissão), o que dava três cliques
 * pro mesmo fato e vivia desencontrado. Serve pros três caminhos que assinam um contrato: o botão
 * "Marcar como assinado", o webhook do Autentique e a checagem periódica na API deles.
 *
 * Só age quando o contrato está vinculado a uma lead/venda (contracts.venda_lead_id) — sem vínculo
 * não há o que marcar, e é de propósito: adivinhar aqui arriscaria marcar a venda de outra pessoa.
 * Nunca lança: é efeito colateral, não pode derrubar quem assinou o contrato.
 */
export async function propagarContratoAssinado(contractId: string, assinado: boolean): Promise<void> {
  try {
    const contrato = await queryOne<{ venda_lead_id: string | null }>(
      'SELECT venda_lead_id FROM contracts WHERE id = $1',
      [contractId]
    );
    const leadId = contrato?.venda_lead_id;
    if (!leadId) return;

    // O vínculo pode apontar pro lead do CRM (o normal) ou direto pra linha da aba Vendas (venda
    // registrada à mão, sem lead no funil). Nos dois casos o alvo é a linha da VENDA.
    const venda = await queryOne<{ id: string }>(
      `SELECT r.id FROM lead_rows r JOIN lead_boards lb ON lb.id = r.board_id
       WHERE lb.is_vendas AND r.deleted_at IS NULL AND (r.id = $1 OR r.venda_origem_id = $1)
       ORDER BY (r.id = $1) DESC LIMIT 1`,
      [leadId]
    );
    if (!venda) return;

    await query(
      `UPDATE lead_rows SET contrato_assinado = $1, updated_at = NOW()
       WHERE id = $2 AND contrato_assinado IS DISTINCT FROM $1`,
      [assinado, venda.id]
    );
    await query(
      `UPDATE commission_entries SET contrato_assinado = $1, updated_at = NOW()
       WHERE venda_lead_id = $2 AND contrato_assinado IS DISTINCT FROM $1`,
      [assinado, venda.id]
    );
  } catch (err) {
    console.error('[contrato] falha ao propagar a assinatura pra venda/comissão', contractId, err);
  }
}

/**
 * A mesma corrente no sentido contrário: marcou "Assinado" na linha da aba Vendas -> o CONTRATO
 * daquela venda também fica assinado (e desmarcar volta pra pendente).
 *
 * Sem isso, o chip da venda e o status na aba Contrato viviam discordando — a pessoa marcava num
 * lugar e o outro continuava dizendo "pendente", que é exatamente o retrabalho que essa corrente
 * existe pra tirar. Como o contrato assinado é o que libera o Briefing, o cliente avança pela
 * mesma porta de sempre (advanceClientToBriefing), que só age se ele ainda estiver em "Contrato".
 *
 * Escreve direto no banco, não pela rota — por isso não volta em laço pelo propagarContratoAssinado.
 * Nunca lança: é efeito colateral de uma edição que já aconteceu.
 */
export async function propagarAssinaturaDaVenda(vendaLeadId: string, assinado: boolean): Promise<void> {
  try {
    // A venda é uma cópia do lead de origem: o contrato pode estar vinculado a qualquer um dos dois.
    const venda = await queryOne<{ id: string; venda_origem_id: string | null }>(
      `SELECT r.id, r.venda_origem_id FROM lead_rows r JOIN lead_boards lb ON lb.id = r.board_id
       WHERE r.id = $1 AND lb.is_vendas AND r.deleted_at IS NULL`,
      [vendaLeadId]
    );
    if (!venda) return;

    const contratos = await query<{ id: string; client_id: string | null }>(
      `SELECT id, client_id FROM contracts
       WHERE venda_lead_id = $1 OR venda_lead_id = $2`,
      [venda.id, venda.venda_origem_id]
    );
    if (!contratos.length) return;

    for (const c of contratos) {
      await query(
        `UPDATE contracts
         SET status = $1, signed_at = CASE WHEN $1 = 'assinado' THEN COALESCE(signed_at, NOW()) ELSE NULL END,
             updated_at = NOW()
         WHERE id = $2 AND status IS DISTINCT FROM $1`,
        [assinado ? 'assinado' : 'pendente', c.id]
      );
      if (assinado && c.client_id) await advanceClientToBriefing(c.client_id);
    }
  } catch (err) {
    console.error('[contrato] falha ao propagar a assinatura da venda pro contrato', vendaLeadId, err);
  }
}
