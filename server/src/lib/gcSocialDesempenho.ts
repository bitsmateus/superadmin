import { query } from '../db.js';
import { montarTotais } from './gcTrafego.js';

/**
 * Desempenho de cada arte que o gestor ligou a anúncios da Meta: soma os números diários desses
 * anúncios desde o dia em que a arte entrou no tráfego (ou desde sempre, se não tiver a data).
 * É o retorno que alimenta a IA na hora de pedir as próximas artes ("faça mais artes assim").
 */
export interface DesempenhoArte {
  id: string; titulo: string; mes: string; ad_ids: string[];
  gasto: number; impressoes: number; cliques: number; resultados: number;
  ctr: number | null; custoResultado: number | null;
}

export async function desempenhoDasArtes(clienteId: string, limite = 60): Promise<DesempenhoArte[]> {
  const rows = await query<{
    id: string; titulo: string; mes: string; ad_ids: string[];
    gasto: string; impressoes: string; alcance: string; cliques: string; leads: string; conversas: string; compras: string; valor_compras: string;
  }>(
    `SELECT d.id, d.titulo, d.mes, d.ad_ids,
            COALESCE(SUM(i.gasto),0) AS gasto, COALESCE(SUM(i.impressoes),0) AS impressoes, COALESCE(SUM(i.alcance),0) AS alcance,
            COALESCE(SUM(i.cliques_link),0) AS cliques, COALESCE(SUM(i.leads),0) AS leads, COALESCE(SUM(i.conversas),0) AS conversas,
            COALESCE(SUM(i.compras),0) AS compras, COALESCE(SUM(i.valor_compras),0) AS valor_compras
     FROM gc_social_producao d
     LEFT JOIN gc_meta_insights_dia i
       ON i.gc_cliente_id = d.gc_cliente_id AND i.ad_id = ANY(d.ad_ids)
      AND (d.trafego_em IS NULL OR i.dia >= (d.trafego_em AT TIME ZONE 'America/Sao_Paulo')::date)
     WHERE d.gc_cliente_id = $1 AND cardinality(d.ad_ids) > 0
     GROUP BY d.id
     ORDER BY d.trafego_em DESC NULLS LAST
     LIMIT $2`,
    [clienteId, limite],
  );
  return rows.map((r) => {
    const t = montarTotais(r as never);
    return {
      id: r.id, titulo: r.titulo, mes: r.mes, ad_ids: r.ad_ids,
      gasto: t.gasto, impressoes: t.impressoes, cliques: t.cliques, resultados: t.resultados, ctr: t.ctr, custoResultado: t.custoResultado,
    };
  });
}
