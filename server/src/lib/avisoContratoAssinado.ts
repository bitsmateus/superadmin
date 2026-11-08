import { query, queryOne } from '../db.js';
import { sendToSupportGroupId } from './supportGroup.js';

/**
 * Aviso no grupo SUPORTE GERAL do WhatsApp (pela conexão do suporte, settings.support_group) quando um contrato
 * vira assinado — pelo Autentique (checagem periódica ou webhook), pelo botão "Marcar como assinado" ou pelo
 * "Contrato assinado" da aba Vendas.
 * Um aviso por contrato (contracts.aviso_assinatura_em): marcar de novo, ou outro caminho chegando depois, não
 * repete. Chamar DEPOIS do advanceClientToBriefing, pra mensagem dizer se o cliente foi pro Briefing.
 * Nunca lança: falhar aqui não desfaz a assinatura.
 */

/** Grupo SUPORTE GERAL. Dá pra trocar sem deploy de código pela env SUPORTE_GERAL_GROUP_ID. */
const GRUPO_SUPORTE_GERAL = (process.env.SUPORTE_GERAL_GROUP_ID || '120363423784755925').trim();

export function montarAvisoContrato(empresa: string, foiProBriefing: boolean): string {
  const linhas = [`✅ *${empresa.trim() || 'Cliente sem nome'} assinou o contrato!*`];
  if (foiProBriefing) linhas.push('Movido para Briefing, aguardando a equipe enviar a ficha.');
  return linhas.join('\n');
}

export async function avisarContratoAssinado(contractId: string): Promise<void> {
  try {
    // Reserva o aviso antes de mandar: dois caminhos assinando ao mesmo tempo não mandam duas vezes.
    const [c] = await query<{ id: string; client_id: string | null; venda_lead_id: string | null }>(
      `UPDATE contracts SET aviso_assinatura_em = NOW()
       WHERE id = $1 AND status = 'assinado' AND aviso_assinatura_em IS NULL
       RETURNING id, client_id, venda_lead_id`,
      [contractId]
    );
    if (!c) return;

    const cliente = c.client_id
      ? await queryOne<{ company: string | null; name: string | null; stage: string | null }>(
        'SELECT company, name, stage FROM clients WHERE id = $1', [c.client_id])
      : null;
    // Contrato sem cliente no cadastro: o nome vem da venda (empresa, ou o nome do lead).
    const venda = !cliente?.company?.trim() && !cliente?.name?.trim() && c.venda_lead_id
      ? await queryOne<{ empresa: string; nome: string }>('SELECT empresa, nome FROM lead_rows WHERE id = $1', [c.venda_lead_id])
      : null;
    const empresa = cliente?.company?.trim() || cliente?.name?.trim() || venda?.empresa?.trim() || venda?.nome?.trim() || '';

    const res = await sendToSupportGroupId(GRUPO_SUPORTE_GERAL, montarAvisoContrato(empresa, cliente?.stage === 'briefing'));
    if (!res.ok) {
      console.error('[contrato] falha ao avisar a assinatura no grupo:', res.reason ?? res.status ?? res.detail);
      // Libera de novo: marcar como assinado outra vez (ou a próxima checagem) tenta mandar.
      await query('UPDATE contracts SET aviso_assinatura_em = NULL WHERE id = $1', [contractId]);
    }
  } catch (err) {
    console.error('[contrato] erro ao avisar a assinatura', contractId, err instanceof Error ? err.message : err);
  }
}

/** Ao subir o servidor: manda o aviso dos contratos assinados que ainda não avisaram (o que falhou no envio, ou o
 * da estreia — ver db.ts). Um de cada vez. */
export async function avisarAssinadosSemAviso(): Promise<void> {
  try {
    const pendentes = await query<{ id: string }>(
      `SELECT id FROM contracts WHERE status = 'assinado' AND aviso_assinatura_em IS NULL ORDER BY signed_at NULLS LAST`
    );
    for (const c of pendentes) await avisarContratoAssinado(c.id);
  } catch (err) {
    console.error('[contrato] erro ao avisar os assinados pendentes', err instanceof Error ? err.message : err);
  }
}
