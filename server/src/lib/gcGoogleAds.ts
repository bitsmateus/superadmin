import { query, queryOne, withTransaction } from '../db.js';
import { diasAtras } from './metaInsights.js';

/**
 * Google Ads dos clientes NX Digital — SOMENTE LEITURA (API REST do Google Ads, GAQL).
 *
 * Cada cliente pode ter uma ou mais contas (gc_google_contas, pelo ID de cliente "123-456-7890").
 * A coleta grava gasto, impressões, cliques e conversões por campanha por dia em
 * gc_google_campanhas_dia, com o gc_cliente_id junto. A aba Tráfego lê daí.
 *
 * Acesso: uma conta de administrador (MCC) da NX com acesso às contas dos clientes.
 *  - GOOGLE_ADS_DEVELOPER_TOKEN   token de desenvolvedor da API (Centro de API da MCC)
 *  - GOOGLE_ADS_LOGIN_CUSTOMER_ID ID da MCC (sem traços)
 *  - GOOGLE_ADS_REFRESH_TOKEN     refresh token OAuth com o escopo https://www.googleapis.com/auth/adwords
 *  - GOOGLE_ADS_CLIENT_ID / GOOGLE_ADS_CLIENT_SECRET (vazios = os do GOOGLE_OAUTH_* do Calendar)
 *  - GOOGLE_ADS_API_VERSION       (opcional) versão da API, ex.: v22
 * Nenhum token entra em log nem em mensagem de erro.
 */

const VERSAO = (process.env.GOOGLE_ADS_API_VERSION || 'v22').trim();
const DIAS_REGRAVAR = 7;
const DIAS_HISTORICO = 90;

export interface ContaGoogle {
  id: string;
  gc_cliente_id: string;
  customer_id: string;
}

const env = (k: string) => (process.env[k] ?? '').trim();

export function googleAdsConfigurado(): boolean {
  return !!(env('GOOGLE_ADS_DEVELOPER_TOKEN') && env('GOOGLE_ADS_REFRESH_TOKEN') && clienteOAuth().id && clienteOAuth().segredo);
}

function clienteOAuth() {
  return {
    id: env('GOOGLE_ADS_CLIENT_ID') || env('GOOGLE_OAUTH_CLIENT_ID'),
    segredo: env('GOOGLE_ADS_CLIENT_SECRET') || env('GOOGLE_OAUTH_CLIENT_SECRET'),
  };
}

/** "123-456-7890" / "123 456 7890" → "1234567890". null se não tiver 10 dígitos. */
export function normalizarCustomerId(bruto: string): string | null {
  const d = String(bruto ?? '').replace(/\D/g, '');
  return d.length === 10 ? d : null;
}

/** "1234567890" → "123-456-7890" (como aparece no Google Ads). */
export const formatarCustomerId = (id: string) => (id.length === 10 ? `${id.slice(0, 3)}-${id.slice(3, 6)}-${id.slice(6)}` : id);

// ── Token OAuth (cache até expirar) ───────────────────────────────────────────

let tokenCache: { valor: string; expira: number } | null = null;

async function tokenDeAcesso(): Promise<string> {
  if (tokenCache && tokenCache.expira > Date.now() + 60_000) return tokenCache.valor;
  const { id, segredo } = clienteOAuth();
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: id, client_secret: segredo, refresh_token: env('GOOGLE_ADS_REFRESH_TOKEN'), grant_type: 'refresh_token' }),
  });
  const json = (await res.json().catch(() => ({}))) as { access_token?: string; expires_in?: number; error?: string; error_description?: string };
  if (!res.ok || !json.access_token) {
    throw new Error(`Google OAuth ${res.status}: ${json.error_description || json.error || 'não autorizou'}`);
  }
  tokenCache = { valor: json.access_token, expira: Date.now() + (json.expires_in ?? 3600) * 1000 };
  return json.access_token;
}

/** Mensagem de erro do Google Ads em português curto (sem token). */
export function mensagemDeErroGoogle(status: number, corpo: unknown): string {
  const lista = Array.isArray(corpo) ? corpo : [corpo];
  const err = (lista[0] as { error?: { message?: string; status?: string; details?: { errors?: { message?: string; errorCode?: Record<string, string> }[] }[] } })?.error;
  const detalhe = err?.details?.[0]?.errors?.[0];
  const codigo = detalhe?.errorCode ? Object.values(detalhe.errorCode)[0] : err?.status;
  const texto = detalhe?.message || err?.message || 'erro desconhecido';
  if (codigo === 'USER_PERMISSION_DENIED' || codigo === 'PERMISSION_DENIED') {
    return `Google Ads ${status}: a conta da NX não tem acesso a esta conta de anúncio (vincule-a à MCC). ${texto}`;
  }
  if (codigo === 'DEVELOPER_TOKEN_NOT_APPROVED') return `Google Ads ${status}: o token de desenvolvedor ainda não foi aprovado para contas reais.`;
  return `Google Ads ${status}${codigo ? ` (${codigo})` : ''}: ${texto}`;
}

/** GAQL via searchStream: devolve todas as linhas de todos os lotes. */
export async function gaql<T = Record<string, unknown>>(customerId: string, consulta: string): Promise<T[]> {
  if (!googleAdsConfigurado()) throw new Error('Google Ads não configurado no servidor (GOOGLE_ADS_DEVELOPER_TOKEN, GOOGLE_ADS_REFRESH_TOKEN).');
  const headers: Record<string, string> = {
    Authorization: `Bearer ${await tokenDeAcesso()}`,
    'developer-token': env('GOOGLE_ADS_DEVELOPER_TOKEN'),
    'Content-Type': 'application/json',
  };
  const mcc = normalizarCustomerId(env('GOOGLE_ADS_LOGIN_CUSTOMER_ID'));
  if (mcc) headers['login-customer-id'] = mcc;
  const res = await fetch(`https://googleads.googleapis.com/${VERSAO}/customers/${customerId}/googleAds:searchStream`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ query: consulta }),
  });
  const corpo = await res.json().catch(() => null);
  if (!res.ok) throw new Error(mensagemDeErroGoogle(res.status, corpo));
  const lotes = (Array.isArray(corpo) ? corpo : [corpo]) as { results?: T[] }[];
  return lotes.flatMap((l) => l?.results ?? []);
}

/** Confere se a MCC enxerga a conta e devolve o nome e a moeda. */
export async function lerContaNoGoogle(customerId: string): Promise<{ nome: string; moeda: string }> {
  const [linha] = await gaql<{ customer?: { descriptiveName?: string; currencyCode?: string } }>(
    customerId,
    'SELECT customer.descriptive_name, customer.currency_code FROM customer LIMIT 1',
  );
  return { nome: linha?.customer?.descriptiveName ?? '', moeda: linha?.customer?.currencyCode ?? '' };
}

// ── Linhas da API → linhas do banco (puro, coberto por teste) ─────────────────

export interface LinhaCampanhaGoogle {
  dia: string;
  campaignId: string;
  nome: string;
  status: string;
  canal: string;
  orcamentoDia: number | null;
  gasto: number;
  impressoes: number;
  cliques: number;
  conversoes: number;
  valorConversoes: number;
}

const n = (v: unknown) => {
  const x = Number(v);
  return Number.isFinite(x) ? x : 0;
};
const micros = (v: unknown) => n(v) / 1_000_000;

export function linhaDaApi(r: Record<string, any>): LinhaCampanhaGoogle | null {
  const dia = r?.segments?.date;
  const id = r?.campaign?.id;
  if (!dia || !id) return null;
  const orc = r?.campaignBudget?.amountMicros;
  return {
    dia: String(dia),
    campaignId: String(id),
    nome: String(r.campaign.name ?? ''),
    status: String(r.campaign.status ?? ''),
    canal: String(r.campaign.advertisingChannelType ?? ''),
    orcamentoDia: orc === undefined || orc === null ? null : micros(orc),
    gasto: Math.round(micros(r?.metrics?.costMicros) * 100) / 100,
    impressoes: n(r?.metrics?.impressions),
    cliques: n(r?.metrics?.clicks),
    conversoes: Math.round(n(r?.metrics?.conversions) * 100) / 100,
    valorConversoes: Math.round(n(r?.metrics?.conversionsValue) * 100) / 100,
  };
}

/** Consulta GAQL das campanhas por dia num período (datas YYYY-MM-DD). */
export const consultaCampanhas = (de: string, ate: string) =>
  `SELECT segments.date, campaign.id, campaign.name, campaign.status, campaign.advertising_channel_type,
     campaign_budget.amount_micros, metrics.cost_micros, metrics.impressions, metrics.clicks,
     metrics.conversions, metrics.conversions_value
   FROM campaign
   WHERE segments.date BETWEEN '${de}' AND '${ate}' AND metrics.impressions > 0`;

// ── Sync ──────────────────────────────────────────────────────────────────────

export async function sincronizarContaGoogle(conta: ContaGoogle): Promise<{ ok: boolean; linhas: number; erro?: string }> {
  try {
    const temHistorico = await queryOne('SELECT 1 FROM gc_google_campanhas_dia WHERE customer_id = $1 LIMIT 1', [conta.customer_id]);
    const de = diasAtras(temHistorico ? DIAS_REGRAVAR : DIAS_HISTORICO);
    const ate = diasAtras(0);
    const linhas = (await gaql(conta.customer_id, consultaCampanhas(de, ate))).map(linhaDaApi).filter((l): l is LinhaCampanhaGoogle => !!l);
    // Regrava a janela inteira (numa transação): campanha que zerou um dia não pode ficar com o número velho.
    await withTransaction(async (c) => {
      await c.query('DELETE FROM gc_google_campanhas_dia WHERE customer_id = $1 AND dia BETWEEN $2 AND $3', [conta.customer_id, de, ate]);
      for (const l of linhas) {
        await c.query(
          `INSERT INTO gc_google_campanhas_dia
             (dia, customer_id, campaign_id, gc_cliente_id, campanha_nome, status, canal, orcamento_dia, gasto, impressoes, cliques, conversoes, valor_conversoes)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
           ON CONFLICT (dia, campaign_id) DO UPDATE SET
             campanha_nome = EXCLUDED.campanha_nome, status = EXCLUDED.status, canal = EXCLUDED.canal,
             orcamento_dia = EXCLUDED.orcamento_dia, gasto = EXCLUDED.gasto, impressoes = EXCLUDED.impressoes,
             cliques = EXCLUDED.cliques, conversoes = EXCLUDED.conversoes, valor_conversoes = EXCLUDED.valor_conversoes,
             synced_at = now()`,
          [l.dia, conta.customer_id, l.campaignId, conta.gc_cliente_id, l.nome, l.status, l.canal, l.orcamentoDia, l.gasto, l.impressoes, l.cliques, l.conversoes, l.valorConversoes],
        );
      }
    });
    await query('UPDATE gc_google_contas SET ultimo_sync_em = now(), ultimo_erro = NULL WHERE id = $1', [conta.id]);
    return { ok: true, linhas: linhas.length };
  } catch (err) {
    const erro = (err instanceof Error ? err.message : String(err)).slice(0, 500);
    await query('UPDATE gc_google_contas SET ultimo_erro = $2 WHERE id = $1', [conta.id, erro]);
    return { ok: false, linhas: 0, erro };
  }
}

/** Todas as contas Google ativas de clientes ativos, uma de cada vez. Sem configuração, não faz nada. */
export async function sincronizarTodasGoogle(): Promise<{ contas: number; erros: number }> {
  if (!googleAdsConfigurado()) return { contas: 0, erros: 0 };
  const contas = await query<ContaGoogle>(
    `SELECT g.id, g.gc_cliente_id, g.customer_id FROM gc_google_contas g
     JOIN gc_clientes c ON c.id = g.gc_cliente_id WHERE g.ativo AND c.status = 'ativo'`,
  );
  let erros = 0;
  for (const c of contas) if (!(await sincronizarContaGoogle(c)).ok) erros++;
  return { contas: contas.length, erros };
}

// ── Leitura (aba Tráfego) ─────────────────────────────────────────────────────

export interface TotaisGoogle {
  gasto: number;
  impressoes: number;
  cliques: number;
  conversoes: number;
  valorConversoes: number;
  ctr: number | null;
  cpc: number | null;
  custoConversao: number | null;
  roas: number | null;
}

export function montarTotaisGoogle(r: Partial<Record<'gasto' | 'impressoes' | 'cliques' | 'conversoes' | 'valor_conversoes', unknown>> | null | undefined): TotaisGoogle {
  const gasto = n(r?.gasto);
  const impressoes = n(r?.impressoes);
  const cliques = n(r?.cliques);
  const conversoes = n(r?.conversoes);
  const valorConversoes = n(r?.valor_conversoes);
  return {
    gasto, impressoes, cliques, conversoes, valorConversoes,
    ctr: impressoes > 0 ? cliques / impressoes : null,
    cpc: cliques > 0 ? gasto / cliques : null,
    custoConversao: conversoes > 0 ? gasto / conversoes : null,
    roas: gasto > 0 && valorConversoes > 0 ? valorConversoes / gasto : null,
  };
}

const SOMAS = `COALESCE(SUM(gasto),0) AS gasto, COALESCE(SUM(impressoes),0) AS impressoes, COALESCE(SUM(cliques),0) AS cliques,
  COALESCE(SUM(conversoes),0) AS conversoes, COALESCE(SUM(valor_conversoes),0) AS valor_conversoes`;

export async function totaisGoogleDoCliente(clienteId: string, de: string, ate: string): Promise<TotaisGoogle> {
  return montarTotaisGoogle(
    await queryOne(`SELECT ${SOMAS} FROM gc_google_campanhas_dia WHERE gc_cliente_id = $1 AND dia BETWEEN $2 AND $3`, [clienteId, de, ate]),
  );
}

export async function serieGoogleDoCliente(clienteId: string, de: string, ate: string) {
  const linhas = await query<{ dia: string; gasto: string; conversoes: string }>(
    `SELECT to_char(dia, 'YYYY-MM-DD') AS dia, SUM(gasto) AS gasto, SUM(conversoes) AS conversoes
     FROM gc_google_campanhas_dia WHERE gc_cliente_id = $1 AND dia BETWEEN $2 AND $3 GROUP BY dia ORDER BY dia`,
    [clienteId, de, ate],
  );
  return linhas.map((l) => ({ dia: l.dia, gasto: n(l.gasto), resultados: Math.round(n(l.conversoes)) }));
}

export async function campanhasGoogleDoCliente(clienteId: string, de: string, ate: string) {
  const linhas = await query<Record<string, string>>(
    `SELECT campaign_id, customer_id,
            (array_agg(campanha_nome ORDER BY dia DESC))[1] AS nome,
            (array_agg(status ORDER BY dia DESC))[1] AS status,
            (array_agg(canal ORDER BY dia DESC))[1] AS canal,
            (array_agg(orcamento_dia ORDER BY dia DESC))[1] AS orcamento_dia,
            ${SOMAS}
     FROM gc_google_campanhas_dia WHERE gc_cliente_id = $1 AND dia BETWEEN $2 AND $3
     GROUP BY campaign_id, customer_id ORDER BY SUM(gasto) DESC`,
    [clienteId, de, ate],
  );
  return linhas.map((l) => ({
    id: l.campaign_id,
    conta: formatarCustomerId(l.customer_id),
    nome: l.nome,
    status: l.status,
    canal: l.canal,
    orcamentoDia: l.orcamento_dia === null || l.orcamento_dia === undefined ? null : n(l.orcamento_dia),
    ...montarTotaisGoogle(l),
  }));
}
