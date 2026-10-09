import { queryOne } from '../db.js';

/**
 * Lead numa aba que é de um SDR (ex.: "CRM ARTHUR") e ainda sem SDR marcado ganha o SDR dessa aba.
 *
 * A coluna SDR nem aparece nessas abas, então ninguém preenche à mão — e o lead que chega pelo Meta Ads
 * (webhook) nasce sem ela. Antes isso só era corrigido quando o servidor REINICIAVA (ver o backfill em
 * db.ts): entre um deploy e outro, os leads novos ficavam fora das "Métricas por SDR" e do funil.
 *
 * Mesma regra do front (sdrLockForPageName): o nome da aba contém o nome de uma etiqueta de SDR. Só vale
 * pras abas do Comercial e nunca pro quadro de Vendas. Devolve o SDR gravado, ou null se nada mudou.
 */
export async function preencherSdrDaAba(leadRowId: string): Promise<string | null> {
  const r = await queryOne<{ sdr: string }>(
    `UPDATE lead_rows lr SET sdr = alvo.name
     FROM (
       SELECT r.id, ll.name
       FROM lead_rows r
       JOIN lead_boards lb ON lb.id = r.board_id
       JOIN lead_pages lp ON lp.id = lb.page
       JOIN lead_labels ll ON ll.field = 'sdr' AND lower(lp.name) LIKE '%' || lower(ll.name) || '%'
       WHERE r.id = $1 AND COALESCE(r.sdr, '') = '' AND r.deleted_at IS NULL
         AND lb.is_vendas = false AND lp.section = 'comercial'
       ORDER BY ll.position
       LIMIT 1
     ) alvo
     WHERE lr.id = alvo.id
     RETURNING lr.sdr`,
    [leadRowId]
  );
  return r?.sdr ?? null;
}
