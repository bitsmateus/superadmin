import { query, queryOne } from '../db.js';

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
