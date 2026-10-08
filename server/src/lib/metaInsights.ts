import { lerNomeCampanha } from './trafegoNicho.js';
import { query } from '../db.js';

/**
 * Meta Marketing API -> banco (SOMENTE LEITURA). Traz o catálogo (campanhas, conjuntos, anúncios +
 * criativos) e o gasto/insights por anúncio por dia, pra cruzar com lead_rows pelo ad_id
 * (ver server/src/db.ts: meta_ad_insights_daily e meta_*).
 *
 * O token (META_ADS_TOKEN) fica SÓ no servidor e nunca entra em log nem em mensagem de erro.
 * O Meta revisa gasto/conversões por alguns dias, por isso o sync regrava uma janela móvel.
 */

const TZ = 'America/Sao_Paulo';
const VERSION = (process.env.META_GRAPH_VERSION || 'v21.0').trim();
const PAGE_LIMIT = 500;
const MAX_PAGES = 200;

export function metaAdsConfig(): { token: string; account: string } | null {
  const token = (process.env.META_ADS_TOKEN ?? '').trim();
  const raw = (process.env.META_AD_ACCOUNT_ID ?? '').trim();
  if (!token || !raw) return null;
  return { token, account: raw.startsWith('act_') ? raw : `act_${raw}` };
}

type GraphPage<T> = { data?: T[]; paging?: { next?: string }; error?: { message?: string; code?: number } };

/** GET paginado na Graph API. A mensagem de erro vem do Meta e não contém o token. */
async function graphList<T>(path: string, params: Record<string, string>, token: string): Promise<T[]> {
  const url = new URL(`https://graph.facebook.com/${VERSION}${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  url.searchParams.set('limit', String(PAGE_LIMIT));
  url.searchParams.set('access_token', token);

  const out: T[] = [];
  let next: string | undefined = url.toString();
  for (let i = 0; next && i < MAX_PAGES; i++) {
    const res: Response = await fetch(next);
    const json = (await res.json().catch(() => ({}))) as GraphPage<T>;
    if (!res.ok || json.error) {
      throw new Error(`Meta API ${res.status}${json.error?.code ? ` (#${json.error.code})` : ''}: ${json.error?.message ?? 'erro desconhecido'} em ${path}`);
    }
    out.push(...(json.data ?? []));
    next = json.paging?.next;
  }
  return out;
}

const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const cents = (v: unknown): number | null => (v === undefined || v === null || v === '' ? null : num(v) / 100);

function spDate(d: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}
export function diasAtras(n: number): string {
  return spDate(new Date(Date.now() - n * 86_400_000));
}

// ── Catálogo ──────────────────────────────────────────────────────────────────

interface MetaCampaign { id: string; name?: string; objective?: string; effective_status?: string; daily_budget?: string }
interface MetaAdset {
  id: string; name?: string; campaign_id?: string; effective_status?: string;
  daily_budget?: string; optimization_goal?: string; targeting?: unknown;
}
interface MetaAd {
  id: string; name?: string; adset_id?: string; campaign_id?: string; effective_status?: string;
  preview_shareable_link?: string;
  creative?: { thumbnail_url?: string; title?: string; body?: string; object_type?: string; video_id?: string };
}

function formatoDoCriativo(c: MetaAd['creative']): string {
  if (!c) return '';
  if (c.video_id || c.object_type === 'VIDEO') return 'video';
  if (c.object_type === 'PHOTO') return 'imagem';
  if (c.object_type === 'SHARE') return 'carrossel_ou_link';
  return (c.object_type ?? '').toLowerCase();
}

export async function sincronizarCatalogoMeta(): Promise<{ campanhas: number; conjuntos: number; anuncios: number } | null> {
  const cfg = metaAdsConfig();
  if (!cfg) return null;
  const { token, account } = cfg;

  const [campanhas, conjuntos, anuncios] = await Promise.all([
    graphList<MetaCampaign>(`/${account}/campaigns`, { fields: 'id,name,objective,effective_status,daily_budget' }, token),
    graphList<MetaAdset>(`/${account}/adsets`, { fields: 'id,name,campaign_id,effective_status,daily_budget,optimization_goal,targeting' }, token),
    graphList<MetaAd>(`/${account}/ads`, {
      fields: 'id,name,adset_id,campaign_id,effective_status,preview_shareable_link,creative{thumbnail_url,title,body,object_type,video_id}',
    }, token),
  ]);

  // nicho/papel: vêm da convenção "NICHO | PAPEL | OFERTA" do nome (lib/trafegoNicho.ts), mas só
  // PREENCHEM quando o campo está vazio — o que foi marcado à mão na aba Tráfego nunca é sobrescrito.
  for (const c of campanhas) {
    await query(
      `INSERT INTO meta_campaigns (campaign_id, name, objective, status, daily_budget, nicho, papel, synced_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,now())
       ON CONFLICT (campaign_id) DO UPDATE SET name=EXCLUDED.name, objective=EXCLUDED.objective,
         status=EXCLUDED.status, daily_budget=EXCLUDED.daily_budget, synced_at=now(),
         nicho = CASE WHEN meta_campaigns.nicho = '' THEN EXCLUDED.nicho ELSE meta_campaigns.nicho END,
         papel = CASE WHEN meta_campaigns.papel = '' THEN EXCLUDED.papel ELSE meta_campaigns.papel END`,
      [c.id, c.name ?? '', c.objective ?? '', c.effective_status ?? '', cents(c.daily_budget),
        lerNomeCampanha(c.name).nicho, lerNomeCampanha(c.name).papel],
    );
  }
  for (const s of conjuntos) {
    await query(
      `INSERT INTO meta_adsets (adset_id, campaign_id, name, status, daily_budget, optimization_goal, targeting, nicho, synced_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,now())
       ON CONFLICT (adset_id) DO UPDATE SET campaign_id=EXCLUDED.campaign_id, name=EXCLUDED.name,
         status=EXCLUDED.status, daily_budget=EXCLUDED.daily_budget, optimization_goal=EXCLUDED.optimization_goal,
         targeting=EXCLUDED.targeting, synced_at=now(),
         nicho = CASE WHEN meta_adsets.nicho = '' THEN EXCLUDED.nicho ELSE meta_adsets.nicho END`,
      [s.id, s.campaign_id ?? null, s.name ?? '', s.effective_status ?? '', cents(s.daily_budget),
        s.optimization_goal ?? '', s.targeting ? JSON.stringify(s.targeting) : null, lerNomeCampanha(s.name).nicho],
    );
  }
  for (const a of anuncios) {
    await query(
      `INSERT INTO meta_ads (ad_id, adset_id, campaign_id, name, status, formato, thumbnail_url, titulo, texto, preview_url, synced_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,now())
       ON CONFLICT (ad_id) DO UPDATE SET adset_id=EXCLUDED.adset_id, campaign_id=EXCLUDED.campaign_id,
         name=EXCLUDED.name, status=EXCLUDED.status, formato=EXCLUDED.formato, thumbnail_url=EXCLUDED.thumbnail_url,
         titulo=EXCLUDED.titulo, texto=EXCLUDED.texto, preview_url=EXCLUDED.preview_url, synced_at=now()`,
      [a.id, a.adset_id ?? null, a.campaign_id ?? null, a.name ?? '', a.effective_status ?? '',
        formatoDoCriativo(a.creative), a.creative?.thumbnail_url ?? '', a.creative?.title ?? '',
        a.creative?.body ?? '', a.preview_shareable_link ?? ''],
    );
  }
  return { campanhas: campanhas.length, conjuntos: conjuntos.length, anuncios: anuncios.length };
}

// ── Insights por anúncio por dia ──────────────────────────────────────────────

type Action = { action_type?: string; value?: string };
interface MetaInsightRow {
  date_start: string; ad_id?: string; adset_id?: string; campaign_id?: string;
  spend?: string; impressions?: string; reach?: string; frequency?: string;
  inline_link_clicks?: string; inline_link_click_ctr?: string; cpm?: string;
  actions?: Action[];
  video_p25_watched_actions?: Action[]; video_p50_watched_actions?: Action[];
  video_p75_watched_actions?: Action[]; video_p100_watched_actions?: Action[];
}

const soma = (arr: Action[] | undefined, tipo?: string): number =>
  (arr ?? []).filter((a) => !tipo || a.action_type === tipo).reduce((s, a) => s + num(a.value), 0);

/** Janela de no máximo 30 dias por chamada, pra não estourar o tamanho da resposta. */
function janelas(desde: string, ate: string): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  let ini = new Date(`${desde}T12:00:00Z`);
  const fim = new Date(`${ate}T12:00:00Z`);
  while (ini <= fim) {
    const f = new Date(Math.min(ini.getTime() + 29 * 86_400_000, fim.getTime()));
    out.push([ini.toISOString().slice(0, 10), f.toISOString().slice(0, 10)]);
    ini = new Date(f.getTime() + 86_400_000);
  }
  return out;
}

export async function sincronizarInsightsMeta(diasParaTras: number): Promise<{ linhas: number; desde: string; ate: string } | null> {
  const cfg = metaAdsConfig();
  if (!cfg) return null;
  const { token, account } = cfg;

  const desde = diasAtras(diasParaTras);
  const ate = diasAtras(0);
  let linhas = 0;

  for (const [since, until] of janelas(desde, ate)) {
    const rows = await graphList<MetaInsightRow>(`/${account}/insights`, {
      level: 'ad',
      time_increment: '1',
      time_range: JSON.stringify({ since, until }),
      fields: [
        'ad_id', 'adset_id', 'campaign_id', 'spend', 'impressions', 'reach', 'frequency',
        'inline_link_clicks', 'inline_link_click_ctr', 'cpm', 'actions',
        'video_p25_watched_actions', 'video_p50_watched_actions',
        'video_p75_watched_actions', 'video_p100_watched_actions',
      ].join(','),
    }, token);

    for (const r of rows) {
      if (!r.ad_id) continue;
      await query(
        `INSERT INTO meta_ad_insights_daily (
           dia, ad_id, adset_id, campaign_id, spend, impressions, reach, frequency, link_clicks, ctr, cpm,
           meta_leads, video_3s, video_p25, video_p50, video_p75, video_p100, synced_at
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,now())
         ON CONFLICT (dia, ad_id) DO UPDATE SET
           adset_id=EXCLUDED.adset_id, campaign_id=EXCLUDED.campaign_id, spend=EXCLUDED.spend,
           impressions=EXCLUDED.impressions, reach=EXCLUDED.reach, frequency=EXCLUDED.frequency,
           link_clicks=EXCLUDED.link_clicks, ctr=EXCLUDED.ctr, cpm=EXCLUDED.cpm, meta_leads=EXCLUDED.meta_leads,
           video_3s=EXCLUDED.video_3s, video_p25=EXCLUDED.video_p25, video_p50=EXCLUDED.video_p50,
           video_p75=EXCLUDED.video_p75, video_p100=EXCLUDED.video_p100, synced_at=now()`,
        [
          r.date_start, r.ad_id, r.adset_id ?? null, r.campaign_id ?? null,
          num(r.spend), num(r.impressions), num(r.reach), num(r.frequency),
          num(r.inline_link_clicks), num(r.inline_link_click_ctr), num(r.cpm),
          soma(r.actions, 'lead'), soma(r.actions, 'video_view'),
          soma(r.video_p25_watched_actions), soma(r.video_p50_watched_actions),
          soma(r.video_p75_watched_actions), soma(r.video_p100_watched_actions),
        ],
      );
      linhas++;
    }
  }

  // Primeiro/último dia de veiculação de cada anúncio, derivado do que já foi gravado.
  await query(
    `UPDATE meta_ads a SET first_day = i.min_dia, last_day = i.max_dia
     FROM (SELECT ad_id, MIN(dia) AS min_dia, MAX(dia) AS max_dia FROM meta_ad_insights_daily
           WHERE spend > 0 GROUP BY ad_id) i
     WHERE a.ad_id = i.ad_id`,
  );

  await preencherInvestimentoDoMes();
  return { linhas, desde, ate };
}

/**
 * commercial_months.investimento_trafego passa a vir do gasto real do Meta (antes era digitado).
 * Só mexe nos meses que o Meta cobre e onde há gasto; mês sem dado do Meta continua como estava.
 */
async function preencherInvestimentoDoMes(): Promise<void> {
  const meses = await query<{ mes: string; total: string }>(
    `SELECT to_char(dia, 'YYYY-MM') AS mes, SUM(spend)::text AS total
     FROM meta_ad_insights_daily GROUP BY 1 HAVING SUM(spend) > 0`,
  );
  for (const m of meses) {
    // Formato do campo texto da tela: "1.234,56".
    const fmt = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(m.total));
    await query(
      `INSERT INTO commercial_months (id, investimento_trafego) VALUES ($1,$2)
       ON CONFLICT (id) DO UPDATE SET investimento_trafego = EXCLUDED.investimento_trafego`,
      [m.mes, fmt],
    );
  }
}

export async function temInsights(): Promise<boolean> {
  const [r] = await query<{ n: string }>(`SELECT count(*)::text AS n FROM meta_ad_insights_daily`);
  return Number(r?.n ?? 0) > 0;
}
