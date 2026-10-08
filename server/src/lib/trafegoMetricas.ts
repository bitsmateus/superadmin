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
  /** MRR e implantação (R$) das vendas ligadas aos leads da safra (aba Vendas, via venda_origem_id). */
  mrr: number;
  implantacao: number;
  /** (MRR + implantação) / gasto — retorno do primeiro mês. null sem gasto. */
  roas: number | null;
  /** Meses de MRR pra pagar o gasto, já descontada a implantação. null sem MRR. */
  paybackMeses: number | null;
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

/** "R$ 1.234,56" -> 1234.56 (mesma leitura do relatório comercial: só dígitos, dois últimos são centavos). */
function reais(v: string | null | undefined): number {
  const d = (v ?? '').replace(/\D/g, '');
  return d ? parseInt(d, 10) / 100 : 0;
}

const roasDe = (gasto: number, mrr: number, impl: number): number | null => (gasto > 0 ? (mrr + impl) / gasto : null);
const paybackDe = (gasto: number, mrr: number, impl: number): number | null => (mrr > 0 ? Math.max(0, gasto - impl) / mrr : null);

/** MRR e implantação das vendas (aba Vendas, não revertidas) cujo lead de origem entrou no período. */
async function valoresDeVendas(nivel: NivelTrafego | null, desde: string, ate: string): Promise<Map<string, { mrr: number; impl: number }>> {
  const col = nivel ? COLUNAS[nivel].lead : null;
  const rows = await query<{ k: string | null; valor_mrr: string; valor_implementacao: string }>(
    `SELECT ${col ? `lr.${col}` : "'tudo'"} AS k, v.valor_mrr, v.valor_implementacao
     FROM lead_rows v JOIN lead_boards vb ON vb.id = v.board_id AND vb.is_vendas = true
     JOIN lead_rows lr ON lr.id = v.venda_origem_id
     JOIN lead_boards lb ON lb.id = lr.board_id AND lb.is_vendas = false
     WHERE v.deleted_at IS NULL AND v.venda_revertida = false AND lr.deleted_at IS NULL AND lr.meta_lead_id IS NOT NULL
       ${col ? `AND lr.${col} IS NOT NULL` : ''}
       AND (lr.created_at AT TIME ZONE '${TZ}')::date BETWEEN $1::date AND $2::date`, [desde, ate]);
  const mapa = new Map<string, { mrr: number; impl: number }>();
  for (const x of rows) {
    const k = x.k ?? '';
    const a = mapa.get(k) ?? { mrr: 0, impl: 0 };
    a.mrr += reais(x.valor_mrr); a.impl += reais(x.valor_implementacao);
    mapa.set(k, a);
  }
  return mapa;
}

export async function rankingTrafego(nivel: NivelTrafego, desde: string, ate: string): Promise<LinhaTrafego[]> {
  const c = COLUNAS[nivel];
  const valores = await valoresDeVendas(nivel, desde, ate);
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
    const v = valores.get(String(r.id)) ?? { mrr: 0, impl: 0 };
    return {
      mrr: v.mrr, implantacao: v.impl, roas: roasDe(gasto, v.mrr, v.impl), paybackMeses: paybackDe(gasto, v.mrr, v.impl),
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
  mrr: number; implantacao: number; roas: number | null; paybackMeses: number | null;
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
  const v = (await valoresDeVendas(null, desde, ate)).get('tudo') ?? { mrr: 0, impl: 0 };
  return {
    gasto, leads, agendadas, reunioes, vendas,
    cpl: razao(gasto, leads), custoReuniao: razao(gasto, reunioes), cac: razao(gasto, vendas),
    mrr: v.mrr, implantacao: v.impl, roas: roasDe(gasto, v.mrr, v.impl), paybackMeses: paybackDe(gasto, v.mrr, v.impl),
  };
}

/**
 * "Primeiro contato do SDR" = o primeiro registro de trabalho no lead depois que ele entrou: mudança de
 * status, de dia de contato ou de SDR, ou uma Atualização (nota). Lead sem nenhum desses ainda não foi tocado.
 */
const PRIMEIRO_CONTATO = `LEAST(
  (SELECT MIN(le.created_at) FROM lead_events le WHERE le.lead_row_id = lr.id AND le.type IN ('status','dia_contato','sdr')),
  (SELECT MIN(n.created_at) FROM lead_notes n WHERE n.lead_row_id = lr.id))`;

const LEAD_META_ATIVO = `lb.is_vendas = false AND lr.espelho_origem_id IS NULL AND lr.deleted_at IS NULL AND lr.meta_lead_id IS NOT NULL`;

/** Leads do Meta parados sem contato do SDR há mais de `horas` (só dos últimos 7 dias, pra não reabrir passado). */
export async function leadsSemContato(horas: number): Promise<{ total: number; maisAntigoHoras: number }> {
  const r = await queryOne<{ n: string; antigo: string | null }>(
    `SELECT count(*) AS n, EXTRACT(EPOCH FROM (now() - MIN(lr.created_at))) / 3600 AS antigo
     FROM lead_rows lr JOIN lead_boards lb ON lb.id = lr.board_id
     WHERE ${LEAD_META_ATIVO} AND lr.created_at < now() - ($1 || ' hours')::interval AND lr.created_at > now() - interval '7 days'
       AND ${PRIMEIRO_CONTATO} IS NULL`, [String(horas)]);
  return { total: Number(r?.n ?? 0), maisAntigoHoras: Number(r?.antigo ?? 0) };
}

/** Tempo médio (horas) entre o lead entrar e o primeiro contato do SDR, na safra do período. */
export async function tempoPrimeiroContato(desde: string, ate: string): Promise<{ horasMedia: number | null; comContato: number; total: number }> {
  const r = await queryOne<{ media: string | null; com: string; total: string }>(
    `SELECT AVG(EXTRACT(EPOCH FROM (t - created_at)) / 3600) AS media, count(t) AS com, count(*) AS total FROM (
       SELECT lr.created_at, ${PRIMEIRO_CONTATO} AS t
       FROM lead_rows lr JOIN lead_boards lb ON lb.id = lr.board_id
       WHERE ${LEAD_META_ATIVO} AND (lr.created_at AT TIME ZONE '${TZ}')::date BETWEEN $1::date AND $2::date) x`, [desde, ate]);
  return { horasMedia: r?.media == null ? null : Number(r.media), comContato: Number(r?.com ?? 0), total: Number(r?.total ?? 0) };
}

/** Por campanha: leads dos últimos 14 dias e quantos têm motivo de desqualificação. */
export async function desqualificacaoPorCampanha(desde: string, ate: string): Promise<Array<{ id: string; nome: string | null; leads: number; desq: number }>> {
  const rows = await query<{ id: string; nome: string | null; leads: string; desq: string }>(
    `SELECT lr.meta_campaign_id AS id, c.name AS nome, count(*) AS leads,
       count(*) FILTER (WHERE COALESCE(lr.motivo_desqualificacao,'') <> '') AS desq
     FROM lead_rows lr JOIN lead_boards lb ON lb.id = lr.board_id
     LEFT JOIN meta_campaigns c ON c.campaign_id = lr.meta_campaign_id
     WHERE ${LEAD_META_ATIVO} AND lr.meta_campaign_id IS NOT NULL
       AND (lr.created_at AT TIME ZONE '${TZ}')::date BETWEEN $1::date AND $2::date
     GROUP BY 1, 2`, [desde, ate]);
  return rows.map((x) => ({ id: x.id, nome: x.nome, leads: Number(x.leads), desq: Number(x.desq) }));
}

export const brl = (v: number | null | undefined): string =>
  v == null ? '—' : `R$ ${new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 0 }).format(Math.round(v))}`;
