import { query, queryOne } from '../db.js';

/**
 * Cruzamento gasto do Meta (meta_ad_insights_daily) x funil do CRM (lead_rows), pela chave
 * campaign_id / adset_id / ad_id. Só leitura.
 *
 * Funil por SAFRA: conta os leads que ENTRARAM no período e o que eles viraram depois (a venda leva
 * dias). Mesmas regras de marcos do relatorioComercial.ts: agendada = passou por "Reunião agendada"
 * ou "Reunião não comparecida"; reunião realizada = passou por proposta/follow-up/vendido.
 */

const TZ = 'America/Sao_Paulo';
const REUNIAO_STATUSES = ['Reunião agendada', 'Reunião não comparecida'];
const POS_REUNIAO_STATUSES = ['Proposta Enviada', 'Follow-up Propostas', 'Vendido'];
const MILESTONE_VENDIDO = 'Vendido';

export type NivelTrafego = 'campanha' | 'conjunto' | 'anuncio';

const COLUNAS: Record<NivelTrafego, { lead: string; gasto: string; tabela: string; chave: string }> = {
  campanha: { lead: 'meta_campaign_id', gasto: 'campaign_id', tabela: 'meta_campaigns', chave: 'campaign_id' },
  conjunto: { lead: 'meta_adset_id', gasto: 'adset_id', tabela: 'meta_adsets', chave: 'adset_id' },
  anuncio: { lead: 'meta_ad_id', gasto: 'ad_id', tabela: 'meta_ads', chave: 'ad_id' },
};

export interface LinhaTrafego {
  id: string;
  nome: string;
  gasto: number;
  impressoes: number;
  cliquesLink: number;
  frequencia: number;
  leads: number;
  agendadas: number;
  reunioes: number;
  vendas: number;
  cpl: number | null;
  custoAgendamento: number | null;
  custoReuniao: number | null;
  cac: number | null;
}

const razao = (gasto: number, n: number): number | null => (n > 0 ? gasto / n : null);

export function dataSp(offsetDias = 0): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' })
    .format(new Date(Date.now() - offsetDias * 86_400_000));
}

/** CTE de leads da safra [desde, ate] (datas YYYY-MM-DD de São Paulo, inclusivas). */
const SAFRA = `
  SELECT lr.meta_campaign_id, lr.meta_adset_id, lr.meta_ad_id, lr.meta_lead_id,
    (lr.status = ANY($3) OR EXISTS (SELECT 1 FROM lead_events le WHERE le.lead_row_id = lr.id
       AND le.type = 'status' AND le.to_value = ANY($3))) AS agendada,
    (lr.status = ANY($4) OR EXISTS (SELECT 1 FROM lead_events le WHERE le.lead_row_id = lr.id
       AND le.type = 'status' AND le.to_value = ANY($4))) AS compareceu,
    (lr.status = $5) AS vendido
  FROM lead_rows lr JOIN lead_boards lb ON lb.id = lr.board_id
  WHERE lb.is_vendas = false AND lr.espelho_origem_id IS NULL AND lr.deleted_at IS NULL
    AND (lr.created_at AT TIME ZONE '${TZ}')::date BETWEEN $1::date AND $2::date`;
const SAFRA_PARAMS = (desde: string, ate: string) =>
  [desde, ate, REUNIAO_STATUSES, POS_REUNIAO_STATUSES, MILESTONE_VENDIDO];

export async function rankingTrafego(nivel: NivelTrafego, desde: string, ate: string): Promise<LinhaTrafego[]> {
  const c = COLUNAS[nivel];
  const rows = await query<Record<string, string | null>>(
    `WITH safra AS (${SAFRA}),
     leads AS (
       SELECT ${c.lead} AS k, count(*) AS leads,
         count(*) FILTER (WHERE agendada) AS agendadas,
         count(*) FILTER (WHERE agendada AND compareceu) AS reunioes,
         count(*) FILTER (WHERE vendido) AS vendas
       FROM safra WHERE ${c.lead} IS NOT NULL GROUP BY 1),
     gasto AS (
       SELECT ${c.gasto} AS k, SUM(spend) AS gasto, SUM(impressions) AS imp, SUM(link_clicks) AS cliques,
         CASE WHEN SUM(impressions) > 0 THEN SUM(frequency * impressions) / SUM(impressions) ELSE 0 END AS freq
       FROM meta_ad_insights_daily WHERE dia BETWEEN $1::date AND $2::date AND ${c.gasto} IS NOT NULL GROUP BY 1)
     SELECT COALESCE(g.k, l.k) AS id, m.name AS nome,
       COALESCE(g.gasto,0) AS gasto, COALESCE(g.imp,0) AS imp, COALESCE(g.cliques,0) AS cliques,
       COALESCE(g.freq,0) AS freq, COALESCE(l.leads,0) AS leads, COALESCE(l.agendadas,0) AS agendadas,
       COALESCE(l.reunioes,0) AS reunioes, COALESCE(l.vendas,0) AS vendas
     FROM gasto g FULL JOIN leads l ON l.k = g.k
     LEFT JOIN ${c.tabela} m ON m.${c.chave} = COALESCE(g.k, l.k)`,
    SAFRA_PARAMS(desde, ate),
  );
  return rows.map((r) => {
    const gasto = Number(r.gasto);
    const leads = Number(r.leads), agendadas = Number(r.agendadas), reunioes = Number(r.reunioes), vendas = Number(r.vendas);
    return {
      id: String(r.id), nome: r.nome ?? String(r.id), gasto,
      impressoes: Number(r.imp), cliquesLink: Number(r.cliques), frequencia: Number(r.freq),
      leads, agendadas, reunioes, vendas,
      cpl: razao(gasto, leads), custoAgendamento: razao(gasto, agendadas),
      custoReuniao: razao(gasto, reunioes), cac: razao(gasto, vendas),
    };
  });
}

export interface TotaisTrafego {
  gasto: number; leads: number; agendadas: number; reunioes: number; vendas: number;
  cpl: number | null; custoReuniao: number | null; cac: number | null;
}

/** Totais da conta: gasto do Meta no período + leads do Meta (meta_lead_id) da safra. */
export async function totaisTrafego(desde: string, ate: string): Promise<TotaisTrafego> {
  const g = await queryOne<{ gasto: string }>(
    `SELECT COALESCE(SUM(spend),0) AS gasto FROM meta_ad_insights_daily WHERE dia BETWEEN $1::date AND $2::date`,
    [desde, ate],
  );
  const l = await queryOne<{ leads: string; agendadas: string; reunioes: string; vendas: string }>(
    `WITH safra AS (${SAFRA})
     SELECT count(*) AS leads, count(*) FILTER (WHERE agendada) AS agendadas,
       count(*) FILTER (WHERE agendada AND compareceu) AS reunioes, count(*) FILTER (WHERE vendido) AS vendas
     FROM safra WHERE meta_lead_id IS NOT NULL`,
    SAFRA_PARAMS(desde, ate),
  );
  const gasto = Number(g?.gasto ?? 0);
  const leads = Number(l?.leads ?? 0), agendadas = Number(l?.agendadas ?? 0);
  const reunioes = Number(l?.reunioes ?? 0), vendas = Number(l?.vendas ?? 0);
  return {
    gasto, leads, agendadas, reunioes, vendas,
    cpl: razao(gasto, leads), custoReuniao: razao(gasto, reunioes), cac: razao(gasto, vendas),
  };
}

export const brl = (v: number | null | undefined): string =>
  v == null ? '—' : `R$ ${new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 0 }).format(Math.round(v))}`;
