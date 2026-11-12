import { query, queryOne } from '../db.js';
import { diasAtras, formatoDoCriativo, graphList, janelas, type MetaAd } from './metaInsights.js';
import { alertasDeSaldo, CAMPOS_FINANCEIRO_META, interpretarFinanceiro, type FinanceiroMeta } from './gcSaldo.js';

/**
 * Tráfego (Meta) dos clientes NX Digital — SOMENTE LEITURA na Meta.
 *
 * Cada cliente tem uma ou mais contas de anúncio (gc_trafego_contas). O sync traz catálogo
 * (campanhas + anúncios/criativos) e insights por anúncio por dia pras tabelas gc_meta_*, sempre
 * com o gc_cliente_id junto. Nada aqui encosta nas tabelas meta_* (a conta da própria NX).
 *
 * O token é o da conta (se alguém cadastrou) ou o META_ADS_TOKEN do servidor. Ele nunca entra em
 * log nem em mensagem de erro: as mensagens vêm da Meta, que não ecoa o token.
 */

const VERSION = (process.env.META_GRAPH_VERSION || 'v21.0').trim();
const DIAS_REGRAVAR = 7;
const DIAS_HISTORICO = 90;

export interface ContaTrafego {
  id: string;
  gc_cliente_id: string;
  ad_account_id: string;
  token: string | null;
}

export const normalizarConta = (raw: string): string => {
  const limpo = raw.trim().replace(/\s+/g, '');
  return limpo.startsWith('act_') ? limpo : `act_${limpo}`;
};

export function tokenDa(conta: { token: string | null }): string | null {
  return (conta.token ?? '').trim() || (process.env.META_ADS_TOKEN ?? '').trim() || null;
}

/** Confere se o token enxerga a conta e devolve nome/moeda/status pra gravar no cadastro. */
export async function lerContaNaMeta(
  adAccountId: string,
  token: string,
): Promise<{ nome: string; moeda: string; status: number }> {
  const url = new URL(`https://graph.facebook.com/${VERSION}/${adAccountId}`);
  url.searchParams.set('fields', 'name,currency,account_status');
  url.searchParams.set('access_token', token);
  const res = await fetch(url.toString());
  const json = (await res.json().catch(() => ({}))) as {
    name?: string; currency?: string; account_status?: number; error?: { message?: string; code?: number };
  };
  if (!res.ok || json.error) {
    throw new Error(`Meta ${res.status}${json.error?.code ? ` (#${json.error.code})` : ''}: ${json.error?.message ?? 'erro desconhecido'}`);
  }
  return { nome: json.name ?? '', moeda: json.currency ?? '', status: Number(json.account_status ?? 0) };
}

// ── Sync ──────────────────────────────────────────────────────────────────────

const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const cents = (v: unknown): number | null => (v === undefined || v === null || v === '' ? null : num(v) / 100);

type Action = { action_type?: string; value?: string };
const somaAcao = (arr: Action[] | undefined, tipo: string): number =>
  (arr ?? []).filter((a) => a.action_type === tipo).reduce((s, a) => s + num(a.value), 0);

interface CampanhaMeta { id: string; name?: string; objective?: string; effective_status?: string; daily_budget?: string }
type AnuncioMeta = MetaAd & { adset?: { name?: string } };
interface InsightMeta {
  date_start: string; ad_id?: string; adset_id?: string; campaign_id?: string;
  ad_name?: string; campaign_name?: string; objective?: string;
  spend?: string; impressions?: string; reach?: string; inline_link_clicks?: string;
  actions?: Action[]; action_values?: Action[];
}

async function sincronizarCatalogo(conta: ContaTrafego, token: string): Promise<void> {
  const acc = conta.ad_account_id;
  const [campanhas, anuncios] = await Promise.all([
    graphList<CampanhaMeta>(`/${acc}/campaigns`, { fields: 'id,name,objective,effective_status,daily_budget' }, token),
    graphList<AnuncioMeta>(`/${acc}/ads`, {
      fields: 'id,name,adset_id,campaign_id,effective_status,preview_shareable_link,adset{name},creative{thumbnail_url,title,body,object_type,video_id}',
    }, token),
  ]);
  for (const c of campanhas) {
    await query(
      `INSERT INTO gc_meta_campanhas (campaign_id, gc_cliente_id, ad_account_id, nome, objetivo, status, orcamento_dia, synced_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,now())
       ON CONFLICT (campaign_id) DO UPDATE SET gc_cliente_id=EXCLUDED.gc_cliente_id, ad_account_id=EXCLUDED.ad_account_id,
         nome=EXCLUDED.nome, objetivo=EXCLUDED.objetivo, status=EXCLUDED.status, orcamento_dia=EXCLUDED.orcamento_dia, synced_at=now()`,
      [c.id, conta.gc_cliente_id, acc, c.name ?? '', c.objective ?? '', c.effective_status ?? '', cents(c.daily_budget)],
    );
  }
  for (const a of anuncios) {
    await query(
      `INSERT INTO gc_meta_anuncios (ad_id, gc_cliente_id, ad_account_id, campaign_id, adset_id, conjunto_nome, nome, status,
         formato, thumbnail_url, titulo, texto, preview_url, synced_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,now())
       ON CONFLICT (ad_id) DO UPDATE SET gc_cliente_id=EXCLUDED.gc_cliente_id, ad_account_id=EXCLUDED.ad_account_id,
         campaign_id=EXCLUDED.campaign_id, adset_id=EXCLUDED.adset_id, conjunto_nome=EXCLUDED.conjunto_nome, nome=EXCLUDED.nome,
         status=EXCLUDED.status, formato=EXCLUDED.formato, thumbnail_url=EXCLUDED.thumbnail_url, titulo=EXCLUDED.titulo,
         texto=EXCLUDED.texto, preview_url=EXCLUDED.preview_url, synced_at=now()`,
      [a.id, conta.gc_cliente_id, acc, a.campaign_id ?? null, a.adset_id ?? null, a.adset?.name ?? '', a.name ?? '',
        a.effective_status ?? '', formatoDoCriativo(a.creative), a.creative?.thumbnail_url ?? '',
        a.creative?.title ?? '', a.creative?.body ?? '', a.preview_shareable_link ?? ''],
    );
  }
}

async function sincronizarInsights(conta: ContaTrafego, token: string, diasParaTras: number): Promise<number> {
  let linhas = 0;
  const vistos = new Set<string>();
  for (const [since, until] of janelas(diasAtras(diasParaTras), diasAtras(0))) {
    const rows = await graphList<InsightMeta>(`/${conta.ad_account_id}/insights`, {
      level: 'ad',
      time_increment: '1',
      time_range: JSON.stringify({ since, until }),
      fields: 'ad_id,ad_name,adset_id,campaign_id,campaign_name,objective,spend,impressions,reach,inline_link_clicks,actions,action_values',
    }, token);
    for (const r of rows) {
      if (!r.ad_id) continue;
      // Campanha/anúncio arquivado ou excluído não volta no catálogo (/campaigns, /ads), mas o insight
      // traz nome e objetivo: grava o mínimo pra a tabela não mostrar "excluída" sem nome. Não sobrescreve
      // o que o catálogo já tem.
      if (r.campaign_id && !vistos.has(r.campaign_id)) {
        vistos.add(r.campaign_id);
        await query(
          `INSERT INTO gc_meta_campanhas (campaign_id, gc_cliente_id, ad_account_id, nome, objetivo, status)
           VALUES ($1,$2,$3,$4,$5,'ARCHIVED') ON CONFLICT (campaign_id) DO NOTHING`,
          [r.campaign_id, conta.gc_cliente_id, conta.ad_account_id, r.campaign_name ?? '', r.objective ?? ''],
        );
      }
      if (!vistos.has(r.ad_id)) {
        vistos.add(r.ad_id);
        await query(
          `INSERT INTO gc_meta_anuncios (ad_id, gc_cliente_id, ad_account_id, campaign_id, adset_id, nome, status)
           VALUES ($1,$2,$3,$4,$5,$6,'ARCHIVED') ON CONFLICT (ad_id) DO NOTHING`,
          [r.ad_id, conta.gc_cliente_id, conta.ad_account_id, r.campaign_id ?? null, r.adset_id ?? null, r.ad_name ?? ''],
        );
      }
      await query(
        `INSERT INTO gc_meta_insights_dia (dia, ad_id, gc_cliente_id, campaign_id, adset_id, gasto, impressoes, alcance,
           cliques_link, leads, conversas, compras, valor_compras, video_3s, synced_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,now())
         ON CONFLICT (dia, ad_id) DO UPDATE SET gc_cliente_id=EXCLUDED.gc_cliente_id, campaign_id=EXCLUDED.campaign_id,
           adset_id=EXCLUDED.adset_id, gasto=EXCLUDED.gasto, impressoes=EXCLUDED.impressoes, alcance=EXCLUDED.alcance,
           cliques_link=EXCLUDED.cliques_link, leads=EXCLUDED.leads, conversas=EXCLUDED.conversas, compras=EXCLUDED.compras,
           valor_compras=EXCLUDED.valor_compras, video_3s=EXCLUDED.video_3s, synced_at=now()`,
        [
          r.date_start, r.ad_id, conta.gc_cliente_id, r.campaign_id ?? null, r.adset_id ?? null,
          num(r.spend), num(r.impressions), num(r.reach), num(r.inline_link_clicks),
          somaAcao(r.actions, 'lead'),
          somaAcao(r.actions, 'onsite_conversion.messaging_conversation_started_7d'),
          somaAcao(r.actions, 'purchase'),
          somaAcao(r.action_values, 'purchase'),
          somaAcao(r.actions, 'video_view'),
        ],
      );
      linhas++;
    }
  }
  return linhas;
}

// ── Saldo e pagamento ────────────────────────────────────────────────────────

/** Lê status, saldo, limite e forma de pagamento da conta e guarda como veio. Nunca lança. */
export async function atualizarFinanceiro(conta: ContaTrafego): Promise<boolean> {
  const token = tokenDa(conta);
  if (!token) return false;
  try {
    const url = new URL(`https://graph.facebook.com/${VERSION}/${conta.ad_account_id}`);
    url.searchParams.set('fields', CAMPOS_FINANCEIRO_META);
    url.searchParams.set('access_token', token);
    const res = await fetch(url.toString());
    const json = (await res.json().catch(() => ({}))) as FinanceiroMeta & { error?: { message?: string } };
    if (!res.ok || json.error) {
      console.warn('[gc-trafego] saldo da conta', conta.ad_account_id, json.error?.message ?? res.status);
      return false;
    }
    const { error: _e, ...financeiro } = json as FinanceiroMeta & { error?: unknown; id?: string };
    await query(`UPDATE gc_trafego_contas SET financeiro = $2, financeiro_em = now() WHERE id = $1`, [conta.id, JSON.stringify(financeiro)]);
    return true;
  } catch (err) {
    console.warn('[gc-trafego] saldo da conta', conta.ad_account_id, err instanceof Error ? err.message : err);
    return false;
  }
}

/** Saldo de todas as contas ativas (uma chamada leve por conta): roda de hora em hora. */
export async function atualizarSaldosDeTodas(): Promise<number> {
  const contas = await query<ContaTrafego>(
    `SELECT t.id, t.gc_cliente_id, t.ad_account_id, t.token FROM gc_trafego_contas t
     JOIN gc_clientes c ON c.id = t.gc_cliente_id WHERE t.ativo AND c.status = 'ativo'`,
  );
  let ok = 0;
  for (const c of contas) if (await atualizarFinanceiro(c)) ok++;
  return ok;
}

/** Gasto médio por dia da conta nos últimos 7 dias fechados (é com ele que o saldo vira "dias"). */
export async function gastoMedioDiarioDaConta(adAccountId: string): Promise<number> {
  const r = await queryOne<{ total: string | null }>(
    `SELECT SUM(i.gasto) AS total FROM gc_meta_insights_dia i JOIN gc_meta_anuncios a ON a.ad_id = i.ad_id
     WHERE a.ad_account_id = $1 AND i.dia BETWEEN $2 AND $3`,
    [adAccountId, diasAtras(7), diasAtras(1)],
  );
  return num(r?.total) / 7;
}

/** Sincroniza uma conta. Grava o resultado (ou o erro) na própria conta e nunca lança. */
export async function sincronizarConta(conta: ContaTrafego): Promise<{ ok: boolean; linhas: number; erro?: string }> {
  const token = tokenDa(conta);
  if (!token) {
    const erro = 'Sem token da Meta: cadastre um na conta ou configure META_ADS_TOKEN no servidor.';
    await query(`UPDATE gc_trafego_contas SET ultimo_erro = $2 WHERE id = $1`, [conta.id, erro]);
    return { ok: false, linhas: 0, erro };
  }
  try {
    await sincronizarCatalogo(conta, token);
    const temHistorico = await queryOne(
      `SELECT 1 FROM gc_meta_insights_dia i JOIN gc_meta_anuncios a ON a.ad_id = i.ad_id
       WHERE a.ad_account_id = $1 LIMIT 1`,
      [conta.ad_account_id],
    );
    // Anúncio com gasto nos 90 dias que não está no catálogo (arquivado/excluído antes de o sync guardar o
    // nome pelo insight): uma rodada de 90 dias preenche e as próximas voltam a ser de 7.
    const semNome = temHistorico && await queryOne(
      `SELECT 1 FROM gc_meta_insights_dia i LEFT JOIN gc_meta_anuncios a ON a.ad_id = i.ad_id
       WHERE i.gc_cliente_id = $1 AND i.dia >= $2 AND a.ad_id IS NULL LIMIT 1`,
      [conta.gc_cliente_id, diasAtras(DIAS_HISTORICO)],
    );
    const linhas = await sincronizarInsights(conta, token, temHistorico && !semNome ? DIAS_REGRAVAR : DIAS_HISTORICO);
    await atualizarFinanceiro(conta);
    await query(`UPDATE gc_trafego_contas SET ultimo_sync_em = now(), ultimo_erro = NULL WHERE id = $1`, [conta.id]);
    return { ok: true, linhas };
  } catch (err) {
    const erro = (err instanceof Error ? err.message : String(err)).slice(0, 500);
    await query(`UPDATE gc_trafego_contas SET ultimo_erro = $2 WHERE id = $1`, [conta.id, erro]);
    return { ok: false, linhas: 0, erro };
  }
}

/** Todas as contas ativas de clientes ativos, uma de cada vez (a Meta limita chamadas por token). */
export async function sincronizarTodasAsContas(): Promise<{ contas: number; erros: number }> {
  const contas = await query<ContaTrafego>(
    `SELECT t.id, t.gc_cliente_id, t.ad_account_id, t.token FROM gc_trafego_contas t
     JOIN gc_clientes c ON c.id = t.gc_cliente_id
     WHERE t.ativo AND c.status = 'ativo'`,
  );
  let erros = 0;
  for (const c of contas) if (!(await sincronizarConta(c)).ok) erros++;
  return { contas: contas.length, erros };
}

// ── Números ───────────────────────────────────────────────────────────────────

export interface TotaisCliente {
  gasto: number; impressoes: number; alcance: number; cliques: number;
  leads: number; conversas: number; compras: number; valorCompras: number;
  resultados: number; custoResultado: number | null; ctr: number | null; cpm: number | null; roas: number | null;
}

const COLUNAS_SOMA = `COALESCE(SUM(gasto),0) AS gasto, COALESCE(SUM(impressoes),0) AS impressoes,
  COALESCE(SUM(alcance),0) AS alcance, COALESCE(SUM(cliques_link),0) AS cliques, COALESCE(SUM(leads),0) AS leads,
  COALESCE(SUM(conversas),0) AS conversas, COALESCE(SUM(compras),0) AS compras, COALESCE(SUM(valor_compras),0) AS valor_compras`;

type LinhaSoma = Record<'gasto' | 'impressoes' | 'alcance' | 'cliques' | 'leads' | 'conversas' | 'compras' | 'valor_compras', string>;

export function montarTotais(r: Partial<LinhaSoma> | null | undefined): TotaisCliente {
  const gasto = num(r?.gasto);
  const impressoes = num(r?.impressoes);
  const cliques = num(r?.cliques);
  const leads = num(r?.leads);
  const conversas = num(r?.conversas);
  const compras = num(r?.compras);
  const valorCompras = num(r?.valor_compras);
  const resultados = leads + conversas + compras;
  return {
    gasto, impressoes, alcance: num(r?.alcance), cliques, leads, conversas, compras, valorCompras, resultados,
    custoResultado: resultados > 0 ? gasto / resultados : null,
    ctr: impressoes > 0 ? (cliques / impressoes) * 100 : null,
    cpm: impressoes > 0 ? (gasto / impressoes) * 1000 : null,
    roas: gasto > 0 && valorCompras > 0 ? valorCompras / gasto : null,
  };
}

export async function totaisDoCliente(clienteId: string, de: string, ate: string): Promise<TotaisCliente> {
  const r = await queryOne<LinhaSoma>(
    `SELECT ${COLUNAS_SOMA} FROM gc_meta_insights_dia WHERE gc_cliente_id = $1 AND dia BETWEEN $2 AND $3`,
    [clienteId, de, ate],
  );
  return montarTotais(r);
}

/** Totais de TODOS os clientes num período, por cliente — uma consulta só pro painel. */
export async function totaisPorCliente(de: string, ate: string): Promise<Map<string, TotaisCliente>> {
  const rows = await query<LinhaSoma & { gc_cliente_id: string }>(
    `SELECT gc_cliente_id, ${COLUNAS_SOMA} FROM gc_meta_insights_dia WHERE dia BETWEEN $1 AND $2 GROUP BY gc_cliente_id`,
    [de, ate],
  );
  return new Map(rows.map((r) => [r.gc_cliente_id, montarTotais(r)]));
}

export async function serieDoCliente(clienteId: string, de: string, ate: string) {
  const rows = await query<{ dia: string; gasto: string; resultados: string }>(
    `SELECT to_char(d::date, 'YYYY-MM-DD') AS dia, COALESCE(SUM(i.gasto),0) AS gasto,
            COALESCE(SUM(i.leads + i.conversas + i.compras),0) AS resultados
     FROM generate_series($2::date, $3::date, INTERVAL '1 day') d
     LEFT JOIN gc_meta_insights_dia i ON i.dia = d::date AND i.gc_cliente_id = $1
     GROUP BY d ORDER BY d`,
    [clienteId, de, ate],
  );
  return rows.map((r) => ({ dia: r.dia, gasto: num(r.gasto), resultados: num(r.resultados) }));
}

export async function campanhasDoCliente(clienteId: string, de: string, ate: string) {
  const rows = await query<LinhaSoma & { id: string; nome: string; status: string; objetivo: string; orcamento_dia: string | null }>(
    // Parte do que GASTOU (insights), não do catálogo: campanha arquivada/excluída some do catálogo da Meta,
    // mas o gasto dela está no total — sem isso a tabela não fecha com o número de cima.
    `SELECT s.campaign_id AS id, COALESCE(NULLIF(c.nome, ''), 'Campanha arquivada ou excluída') AS nome,
            COALESCE(c.status, 'ARCHIVED') AS status, COALESCE(c.objetivo, '') AS objetivo, c.orcamento_dia, s.*
     FROM (SELECT campaign_id, ${COLUNAS_SOMA} FROM gc_meta_insights_dia
           WHERE gc_cliente_id = $1 AND dia BETWEEN $2 AND $3 GROUP BY campaign_id) s
     LEFT JOIN gc_meta_campanhas c ON c.campaign_id = s.campaign_id
     WHERE s.gasto > 0 OR s.impressoes > 0
     ORDER BY s.gasto DESC`,
    [clienteId, de, ate],
  );
  return rows.map((r) => ({
    id: r.id, nome: r.nome, status: r.status, objetivo: r.objetivo,
    orcamentoDia: r.orcamento_dia == null ? null : num(r.orcamento_dia), ...montarTotais(r),
  }));
}

export async function anunciosDoCliente(clienteId: string, de: string, ate: string, limite = 12) {
  const rows = await query<LinhaSoma & {
    id: string; nome: string; status: string; formato: string; thumbnail_url: string; titulo: string;
    texto: string; preview_url: string; conjunto_nome: string; campanha_nome: string | null;
  }>(
    `SELECT s.ad_id AS id, COALESCE(NULLIF(a.nome, ''), 'Anúncio arquivado ou excluído') AS nome,
            COALESCE(a.status, 'ARCHIVED') AS status, COALESCE(a.formato, '') AS formato,
            COALESCE(a.thumbnail_url, '') AS thumbnail_url, COALESCE(a.titulo, '') AS titulo, COALESCE(a.texto, '') AS texto,
            COALESCE(a.preview_url, '') AS preview_url, COALESCE(a.conjunto_nome, '') AS conjunto_nome, c.nome AS campanha_nome, s.*
     FROM (SELECT ad_id, MAX(campaign_id) AS campaign_id, ${COLUNAS_SOMA} FROM gc_meta_insights_dia
           WHERE gc_cliente_id = $1 AND dia BETWEEN $2 AND $3 GROUP BY ad_id) s
     LEFT JOIN gc_meta_anuncios a ON a.ad_id = s.ad_id
     LEFT JOIN gc_meta_campanhas c ON c.campaign_id = COALESCE(a.campaign_id, s.campaign_id)
     WHERE s.gasto > 0
     ORDER BY s.gasto DESC
     LIMIT $4`,
    [clienteId, de, ate, limite],
  );
  return rows.map((r) => {
    const t = montarTotais(r);
    return {
      id: r.id, nome: r.nome, status: r.status, formato: r.formato, thumbnail: r.thumbnail_url, titulo: r.titulo,
      texto: r.texto, previewUrl: r.preview_url, conjunto: r.conjunto_nome, campanha: r.campanha_nome ?? '',
      frequencia: t.alcance > 0 ? t.impressoes / t.alcance : null, ...t,
    };
  });
}

// ── Alertas ───────────────────────────────────────────────────────────────────

type Nivel = 'critico' | 'atencao' | 'oportunidade';
interface Disparo { regra: string; nivel: Nivel; entidade: string; mensagem: string }

const brl = (v: number) => `R$ ${new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 0 }).format(Math.round(v))}`;
const pct = (v: number) => `${Math.round(v * 100)}%`;

/** Dia do mês e total de dias do mês, em São Paulo (pro ritmo do investimento). */
function posicaoNoMes(): { dia: number; diasNoMes: number; inicioMes: string } {
  const hoje = diasAtras(0);
  const [a, m, d] = hoje.split('-').map(Number);
  return { dia: d, diasNoMes: new Date(Date.UTC(a, m, 0)).getUTCDate(), inicioMes: `${hoje.slice(0, 8)}01` };
}

/**
 * Regras por cliente, olhando os últimos 7 dias FECHADOS (ontem pra trás — hoje ainda está
 * rodando) contra os 7 anteriores. Mínimos de gasto/volume evitam alarme com conta pequena.
 */
async function regrasDoCliente(
  clienteId: string,
  contas: { ad_account_id: string; nome: string; ultimo_erro: string | null; financeiro: FinanceiroMeta | null }[],
): Promise<Disparo[]> {
  const out: Disparo[] = [];
  for (const c of contas) {
    if (c.ultimo_erro) {
      out.push({ regra: 'sync_erro', nivel: 'critico', entidade: c.ad_account_id, mensagem: `Não consegui ler a conta ${c.nome || c.ad_account_id}: ${c.ultimo_erro}` });
    }
    // Saldo acabando, limite de gastos perto e conta bloqueada (lib/gcSaldo.ts).
    if (c.financeiro) {
      const gastoDia = await gastoMedioDiarioDaConta(c.ad_account_id);
      const nome = contas.length > 1 ? c.nome || c.ad_account_id : '';
      for (const d of alertasDeSaldo(interpretarFinanceiro(c.financeiro), gastoDia, nome)) {
        out.push({ regra: d.regra, nivel: d.nivel, entidade: c.ad_account_id, mensagem: d.mensagem });
      }
    }
  }

  const [atual, anterior, ultimos2, antes2] = await Promise.all([
    totaisDoCliente(clienteId, diasAtras(7), diasAtras(1)),
    totaisDoCliente(clienteId, diasAtras(14), diasAtras(8)),
    totaisDoCliente(clienteId, diasAtras(2), diasAtras(1)),
    totaisDoCliente(clienteId, diasAtras(9), diasAtras(3)),
  ]);

  if (ultimos2.gasto === 0 && antes2.gasto >= 50) {
    out.push({ regra: 'parou_de_rodar', nivel: 'critico', entidade: '', mensagem: 'Os anúncios não gastaram nada nos últimos 2 dias. Conferir pagamento, reprovação ou orçamento.' });
  }
  if (atual.gasto >= 150 && atual.resultados === 0) {
    out.push({ regra: 'sem_resultado', nivel: 'critico', entidade: '', mensagem: `${brl(atual.gasto)} gastos em 7 dias sem nenhum lead, conversa ou compra.` });
  }
  if (atual.custoResultado && anterior.custoResultado && atual.resultados >= 5 && anterior.resultados >= 5) {
    const razao = atual.custoResultado / anterior.custoResultado;
    if (razao >= 1.4) {
      out.push({ regra: 'custo_subiu', nivel: 'atencao', entidade: '', mensagem: `Custo por resultado subiu ${pct(razao - 1)} na semana (${brl(anterior.custoResultado)} → ${brl(atual.custoResultado)}).` });
    } else if (razao <= 0.7 && atual.resultados >= 10) {
      out.push({ regra: 'custo_caiu', nivel: 'oportunidade', entidade: '', mensagem: `Custo por resultado caiu ${pct(1 - razao)} na semana (${brl(atual.custoResultado)}). Bom momento pra escalar o que está funcionando.` });
    }
  }
  if (anterior.resultados >= 10 && atual.resultados < anterior.resultados * 0.6) {
    out.push({ regra: 'resultado_caiu', nivel: 'atencao', entidade: '', mensagem: `Resultados caíram de ${anterior.resultados} pra ${atual.resultados} na semana.` });
  }

  // Ritmo do mês contra o investimento previsto no serviço de tráfego Meta.
  const previsto = await queryOne<{ total: string | null }>(
    `SELECT SUM(investimento_previsto_mensal) AS total FROM gc_servicos
     WHERE gc_cliente_id = $1 AND tipo = 'trafego_meta' AND status = 'ativo'`,
    [clienteId],
  );
  const previstoMes = num(previsto?.total);
  const { dia, diasNoMes, inicioMes } = posicaoNoMes();
  if (previstoMes > 0 && dia >= 5) {
    const mes = await totaisDoCliente(clienteId, inicioMes, diasAtras(1));
    const projecao = (mes.gasto / Math.max(1, dia - 1)) * diasNoMes;
    if (projecao > previstoMes * 1.15) {
      out.push({ regra: 'ritmo_acima', nivel: 'atencao', entidade: '', mensagem: `No ritmo atual o mês fecha em ${brl(projecao)}, acima dos ${brl(previstoMes)} previstos.` });
    } else if (dia >= 8 && projecao < previstoMes * 0.7) {
      out.push({ regra: 'ritmo_abaixo', nivel: 'atencao', entidade: '', mensagem: `No ritmo atual o mês fecha em ${brl(projecao)}, bem abaixo dos ${brl(previstoMes)} previstos.` });
    }
  }

  // Criativo saturando: o mesmo público vendo o anúncio vezes demais na semana.
  for (const a of await anunciosDoCliente(clienteId, diasAtras(7), diasAtras(1), 30)) {
    if (a.gasto >= 50 && a.frequencia !== null && a.frequencia >= 3.5) {
      out.push({ regra: 'criativo_saturando', nivel: 'atencao', entidade: a.id, mensagem: `Criativo "${a.nome}" com frequência ${a.frequencia.toFixed(1).replace('.', ',')} na semana. Hora de trocar ou abrir público.` });
    }
  }
  return out;
}

/** Roda as regras pra todos os clientes com conta. Abre o que disparou e fecha o que parou. */
export async function avaliarAlertasClientes(): Promise<{ novos: number; resolvidos: number }> {
  const contas = await query<{ gc_cliente_id: string; ad_account_id: string; nome: string; ultimo_erro: string | null; financeiro: FinanceiroMeta | null }>(
    `SELECT t.gc_cliente_id, t.ad_account_id, t.nome, t.ultimo_erro, t.financeiro FROM gc_trafego_contas t
     JOIN gc_clientes c ON c.id = t.gc_cliente_id WHERE t.ativo AND c.status = 'ativo'`,
  );
  const porCliente = new Map<string, typeof contas>();
  for (const c of contas) porCliente.set(c.gc_cliente_id, [...(porCliente.get(c.gc_cliente_id) ?? []), c]);

  let novos = 0;
  let resolvidos = 0;
  for (const [clienteId, lista] of porCliente) {
    const disparos = await regrasDoCliente(clienteId, lista);
    const chaves = new Set(disparos.map((d) => `${d.regra}|${d.entidade}`));
    for (const d of disparos) {
      // Alguém já marcou esse alerta como visto há menos de 7 dias: não volta a abrir todo sync.
      const visto = await queryOne(
        `SELECT 1 FROM gc_trafego_alertas WHERE gc_cliente_id = $1 AND regra = $2 AND entidade_id = $3
           AND resolvido_por IS NOT NULL AND resolved_at > now() - INTERVAL '7 days'`,
        [clienteId, d.regra, d.entidade],
      );
      if (visto) {
        chaves.delete(`${d.regra}|${d.entidade}`);
        continue;
      }
      const r = await query(
        `INSERT INTO gc_trafego_alertas (gc_cliente_id, regra, nivel, entidade_id, mensagem)
         VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT (gc_cliente_id, regra, entidade_id) WHERE resolved_at IS NULL
         DO UPDATE SET mensagem = EXCLUDED.mensagem, nivel = EXCLUDED.nivel
         RETURNING (xmax = 0) AS inserido`,
        [clienteId, d.regra, d.nivel, d.entidade, d.mensagem],
      );
      if ((r[0] as { inserido?: boolean } | undefined)?.inserido) novos++;
    }
    const abertos = await query<{ id: string; regra: string; entidade_id: string }>(
      `SELECT id, regra, entidade_id FROM gc_trafego_alertas WHERE gc_cliente_id = $1 AND resolved_at IS NULL`,
      [clienteId],
    );
    for (const a of abertos) {
      if (chaves.has(`${a.regra}|${a.entidade_id}`)) continue;
      await query(`UPDATE gc_trafego_alertas SET resolved_at = now() WHERE id = $1`, [a.id]);
      resolvidos++;
    }
  }
  return { novos, resolvidos };
}

// ── Benchmark ─────────────────────────────────────────────────────────────────

/**
 * Média dos OUTROS clientes do mesmo segmento no mesmo período (custo por resultado, CTR, CPM).
 * Só sai com pelo menos 2 outros clientes com gasto, senão o "benchmark" seria um cliente só.
 */
export async function benchmarkDoSegmento(clienteId: string, de: string, ate: string) {
  const cli = await queryOne<{ segmento: string }>('SELECT segmento FROM gc_clientes WHERE id = $1', [clienteId]);
  const segmento = (cli?.segmento ?? '').trim();
  if (!segmento) return null;
  const rows = await query<LinhaSoma & { gc_cliente_id: string }>(
    `SELECT i.gc_cliente_id, ${COLUNAS_SOMA.replace(/SUM\((\w+)\)/g, 'SUM(i.$1)')}
     FROM gc_meta_insights_dia i JOIN gc_clientes c ON c.id = i.gc_cliente_id
     WHERE lower(trim(c.segmento)) = lower($1) AND c.id <> $2 AND i.dia BETWEEN $3 AND $4
     GROUP BY i.gc_cliente_id HAVING SUM(i.gasto) > 0`,
    [segmento, clienteId, de, ate],
  );
  if (rows.length < 2) return { segmento, clientes: rows.length, custoResultado: null, ctr: null, cpm: null };
  const totais = rows.map(montarTotais);
  const media = (xs: (number | null)[]) => {
    const v = xs.filter((x): x is number => x !== null);
    return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
  };
  return {
    segmento, clientes: rows.length,
    custoResultado: media(totais.map((t) => t.custoResultado)),
    ctr: media(totais.map((t) => t.ctr)),
    cpm: media(totais.map((t) => t.cpm)),
  };
}

// ── Métricas do mês a partir do tráfego ──────────────────────────────────────

/**
 * As métricas do mês que o Meta sabe, gravadas no lançamento do mês (gc_metricas, fonte 'manual' —
 * a mesma linha que a tela de Métricas e relatórios edita). Leads = leads de formulário + conversas,
 * que é o "resultado" da aba Tráfego. Vendas e receita NÃO vêm daqui: quem sabe é o cliente/CRM, e o
 * pixel de compra só cobre parte dos clientes; o que a equipe digitou nessas duas fica como está.
 *
 * Cliente sem conta vinculada ou sem nada no mês fica de fora — não apaga o que foi lançado à mão.
 * Também abre o rascunho do relatório do mês (se ainda não há um), pro mês já aparecer pronto pra revisão.
 */
export async function metricasDoMesPeloTrafego(
  clienteId: string,
  periodo: string,
): Promise<{ atualizado: boolean; valores: Record<string, number> }> {
  const [ano, mes] = periodo.split('-').map(Number);
  const inicio = `${periodo}-01`;
  const fim = `${periodo}-${String(new Date(ano, mes, 0).getDate()).padStart(2, '0')}`;
  const conta = await queryOne('SELECT 1 FROM gc_trafego_contas WHERE gc_cliente_id = $1 AND ativo', [clienteId]);
  if (!conta) return { atualizado: false, valores: {} };
  const t = await totaisDoCliente(clienteId, inicio, fim);
  if (t.gasto === 0 && t.impressoes === 0) return { atualizado: false, valores: {} };

  const valores: Record<string, number> = {
    investimento: Math.round(t.gasto * 100) / 100,
    impressoes: t.impressoes,
    cliques: t.cliques,
    leads: t.leads + t.conversas,
    conversas: t.conversas,
  };
  for (const [chave, valor] of Object.entries(valores)) {
    await query(
      `INSERT INTO gc_metricas (gc_cliente_id, periodo_inicio, periodo_fim, fonte, chave, valor)
       VALUES ($1, $2, $3, 'manual', $4, $5)
       ON CONFLICT (gc_cliente_id, periodo_inicio, periodo_fim, fonte, chave)
       DO UPDATE SET valor = EXCLUDED.valor, updated_at = NOW()`,
      [clienteId, inicio, fim, chave, valor],
    );
  }
  await query(
    `INSERT INTO gc_relatorios (gc_cliente_id, periodo_inicio, periodo_fim) VALUES ($1, $2, $3)
     ON CONFLICT (gc_cliente_id, periodo_inicio, periodo_fim) DO NOTHING`,
    [clienteId, inicio, fim],
  );
  return { atualizado: true, valores };
}

/** Roda o de cima pra todo cliente com conta do Meta ativa (o relatório semanal). */
export async function metricasDoMesDeTodos(periodo: string): Promise<{ clientes: number; erros: number }> {
  const clientes = await query<{ gc_cliente_id: string }>(
    `SELECT DISTINCT t.gc_cliente_id FROM gc_trafego_contas t
     JOIN gc_clientes c ON c.id = t.gc_cliente_id
     WHERE t.ativo AND c.status <> 'encerrado'`,
  );
  let atualizados = 0;
  let erros = 0;
  for (const c of clientes) {
    try {
      if ((await metricasDoMesPeloTrafego(c.gc_cliente_id, periodo)).atualizado) atualizados++;
    } catch (err) {
      erros++;
      console.error('[gc-relatorio] cliente', c.gc_cliente_id, err instanceof Error ? err.message : err);
    }
  }
  return { clientes: atualizados, erros };
}
