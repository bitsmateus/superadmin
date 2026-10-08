import { query } from '../db.js';
import { metaAdsConfig } from './metaInsights.js';

/**
 * Ações NO MEta ADS a partir das sugestões da IA (pausar, ativar, mudar orçamento diário).
 * Regras de segurança:
 *  - nada roda sem o usuário (admin) confirmar numa tela que mostra o antes/depois;
 *  - a ação é revalidada aqui contra o estado ATUAL do Meta (não confia no que o front mostrou);
 *  - tudo fica registrado em traffic_actions_log (quem, quando, antes, depois) e é reversível;
 *  - o token nunca sai do servidor. Precisa da permissão ads_management no token do Meta.
 */

const VERSION = (process.env.META_GRAPH_VERSION || 'v21.0').trim();

export type TipoAcao = 'pausar' | 'ativar' | 'orcamento';
export type NivelAcao = 'campanha' | 'conjunto' | 'anuncio';

export interface AcaoMeta {
  tipo: TipoAcao;
  nivel: NivelAcao;
  id: string;
  /** Só para tipo 'orcamento': novo orçamento DIÁRIO em reais. */
  valor?: number;
}

export interface EstadoMeta { status: string; orcamentoDia: number | null }

export interface PreviaAcao {
  acao: AcaoMeta;
  nome: string;
  antes: EstadoMeta;
  depois: EstadoMeta;
  titulo: string;
  comoFunciona: string[];
  avisos: string[];
  orcamentoMin: number | null;
  orcamentoMax: number | null;
}

const TABELA: Record<NivelAcao, { tabela: string; chave: string }> = {
  campanha: { tabela: 'meta_campaigns', chave: 'campaign_id' },
  conjunto: { tabela: 'meta_adsets', chave: 'adset_id' },
  anuncio: { tabela: 'meta_ads', chave: 'ad_id' },
};
const NOME_NIVEL: Record<NivelAcao, string> = { campanha: 'a campanha', conjunto: 'o conjunto', anuncio: 'o anúncio' };

/** Limites de segurança pra mudança de orçamento: evita erro de digitação (R$ 50 -> R$ 5000). */
const FATOR_MIN = 0.2;
const FATOR_MAX = 2;

export class ErroAcao extends Error {}

export function acaoValida(a: unknown): a is AcaoMeta {
  const x = a as Partial<AcaoMeta> | null;
  if (!x || typeof x !== 'object') return false;
  if (!['pausar', 'ativar', 'orcamento'].includes(String(x.tipo))) return false;
  if (!['campanha', 'conjunto', 'anuncio'].includes(String(x.nivel))) return false;
  if (typeof x.id !== 'string' || !/^\d{5,25}$/.test(x.id)) return false;
  if (x.tipo === 'orcamento' && !(typeof x.valor === 'number' && Number.isFinite(x.valor) && x.valor > 0)) return false;
  if (x.tipo === 'orcamento' && x.nivel === 'anuncio') return false;
  return true;
}

async function graph<T>(metodo: 'GET' | 'POST', id: string, params: Record<string, string>): Promise<T> {
  const cfg = metaAdsConfig();
  if (!cfg) throw new ErroAcao('Conta do Meta não configurada no servidor (META_ADS_TOKEN / META_AD_ACCOUNT_ID).');
  const url = new URL(`https://graph.facebook.com/${VERSION}/${id}`);
  const init: RequestInit = { method: metodo };
  if (metodo === 'GET') {
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
    url.searchParams.set('access_token', cfg.token);
  } else {
    const corpo = new URLSearchParams({ ...params, access_token: cfg.token });
    init.headers = { 'content-type': 'application/x-www-form-urlencoded' };
    init.body = corpo.toString();
  }
  const res = await fetch(url.toString(), init);
  const json = (await res.json().catch(() => ({}))) as { error?: { message?: string; code?: number; error_user_msg?: string } } & T;
  if (!res.ok || json.error) {
    const e = json.error;
    const semPermissao = e?.code === 200 || e?.code === 10 || /permission/i.test(e?.message ?? '');
    throw new ErroAcao(
      semPermissao
        ? 'O token do Meta não tem permissão para alterar anúncios (precisa de ads_management). Gere um token com essa permissão e atualize META_ADS_TOKEN.'
        : `Meta recusou (#${e?.code ?? res.status}): ${e?.error_user_msg ?? e?.message ?? 'erro desconhecido'}`,
    );
  }
  return json;
}

interface EntidadeMeta { name?: string; status?: string; effective_status?: string; daily_budget?: string; lifetime_budget?: string }

async function lerEntidade(nivel: NivelAcao, id: string): Promise<{ nome: string; estado: EstadoMeta; temOrcamentoDiario: boolean; vitalicio: boolean }> {
  const campos = nivel === 'anuncio' ? 'name,status,effective_status' : 'name,status,effective_status,daily_budget,lifetime_budget';
  const e = await graph<EntidadeMeta>('GET', id, { fields: campos });
  const diario = e.daily_budget && Number(e.daily_budget) > 0 ? Number(e.daily_budget) / 100 : null;
  return {
    nome: e.name ?? id,
    estado: { status: e.status ?? e.effective_status ?? '', orcamentoDia: diario },
    temOrcamentoDiario: diario !== null,
    vitalicio: !!(e.lifetime_budget && Number(e.lifetime_budget) > 0),
  };
}

const brl = (v: number | null): string => (v == null ? '—' : `R$ ${v.toFixed(2).replace('.', ',')}`);
const rotuloStatus = (s: string): string => (s === 'ACTIVE' ? 'ativa' : s === 'PAUSED' ? 'pausada' : s.toLowerCase() || 'desconhecido');

/** Lê o estado atual no Meta e descreve exatamente o que vai mudar. Lança ErroAcao se não dá pra fazer. */
export async function previaAcao(acao: AcaoMeta): Promise<PreviaAcao> {
  if (!acaoValida(acao)) throw new ErroAcao('Ação inválida.');
  const noCatalogo = await query(`SELECT 1 FROM ${TABELA[acao.nivel].tabela} WHERE ${TABELA[acao.nivel].chave} = $1`, [acao.id]);
  if (noCatalogo.length === 0) throw new ErroAcao('Esse item não está no catálogo do painel (sincronize e tente de novo).');

  const atual = await lerEntidade(acao.nivel, acao.id);
  const o = NOME_NIVEL[acao.nivel];
  const avisos: string[] = [];
  const comoFunciona: string[] = [];
  const depois: EstadoMeta = { ...atual.estado };
  let titulo = '';
  let orcamentoMin: number | null = null;
  let orcamentoMax: number | null = null;

  if (acao.tipo === 'pausar') {
    if (atual.estado.status === 'PAUSED') throw new ErroAcao(`Já está pausad${acao.nivel === 'campanha' ? 'a' : 'o'} no Meta — nada a fazer.`);
    depois.status = 'PAUSED';
    titulo = `Pausar ${o}`;
    comoFunciona.push(
      'O painel envia o pedido ao Meta agora, assim que você confirmar.',
      `A entrega para em poucos minutos: ${acao.nivel === 'campanha' ? 'todos os conjuntos e anúncios dela' : acao.nivel === 'conjunto' ? 'todos os anúncios dele' : 'o anúncio'} deixam de gastar.`,
      'Nada é apagado: histórico, públicos e criativos continuam lá.',
      'Para voltar, use o botão "Reverter" aqui no painel ou ative no Gerenciador de Anúncios.',
    );
    if (acao.nivel !== 'anuncio') avisos.push(`Pausar ${o} pausa tudo que está dentro. Se a campanha estiver em fase de aprendizado, ela volta a aprender do zero ao reativar.`);
  } else if (acao.tipo === 'ativar') {
    if (atual.estado.status === 'ACTIVE') throw new ErroAcao('Já está ativo no Meta — nada a fazer.');
    depois.status = 'ACTIVE';
    titulo = `Reativar ${o}`;
    comoFunciona.push(
      'O painel envia o pedido ao Meta agora, assim que você confirmar.',
      'A entrega volta e o gasto recomeça com o orçamento que já estava configurado.',
      'Se o item pai (campanha/conjunto) estiver pausado ou o anúncio reprovado, ele fica "ativo" mas não gasta.',
    );
    avisos.push('Reativar volta a gastar dinheiro de verdade com o orçamento diário atual.');
  } else {
    if (acao.nivel === 'anuncio') throw new ErroAcao('Anúncio não tem orçamento próprio.');
    if (!atual.temOrcamentoDiario) {
      throw new ErroAcao(atual.vitalicio
        ? `${acao.nivel === 'campanha' ? 'Essa campanha' : 'Esse conjunto'} usa orçamento VITALÍCIO — o painel só altera orçamento diário.`
        : `Esse nível não tem orçamento diário próprio${acao.nivel === 'campanha' ? ' (o orçamento deve estar nos conjuntos)' : ' (o orçamento deve estar na campanha)'}. Aplique a mudança no nível onde está o orçamento.`);
    }
    const hoje = atual.estado.orcamentoDia as number;
    orcamentoMin = Math.max(1, Math.round(hoje * FATOR_MIN * 100) / 100);
    orcamentoMax = Math.round(hoje * FATOR_MAX * 100) / 100;
    const novo = acao.valor as number;
    if (novo < orcamentoMin || novo > orcamentoMax) {
      throw new ErroAcao(`Por segurança, a mudança fica entre ${brl(orcamentoMin)} e ${brl(orcamentoMax)} por dia (20% a 200% do atual ${brl(hoje)}).`);
    }
    if (Math.abs(novo - hoje) < 0.01) throw new ErroAcao('O orçamento novo é igual ao atual.');
    depois.orcamentoDia = Math.round(novo * 100) / 100;
    titulo = `${novo > hoje ? 'Aumentar' : 'Reduzir'} o orçamento diário d${acao.nivel === 'campanha' ? 'a campanha' : 'o conjunto'}`;
    comoFunciona.push(
      'O painel envia o pedido ao Meta agora, assim que você confirmar.',
      `O novo limite de gasto por dia (${brl(depois.orcamentoDia)}) vale a partir de agora; o gasto de hoje que já passou não muda.`,
      'O Meta pode gastar até 25% acima do orçamento num dia (compensa em outros dias) — é o comportamento normal dele.',
      'Para voltar ao valor anterior, use o botão "Reverter" aqui no painel ou edite no Gerenciador.',
    );
    if (Math.abs(novo - hoje) / hoje > 0.2) avisos.push('Mudança maior que 20% do orçamento pode reiniciar a fase de aprendizado e piorar a entrega por alguns dias.');
    if (novo > hoje) avisos.push(`Você vai gastar MAIS: até ${brl((novo - hoje) * 30)} a mais por mês se deixar nesse valor.`);
  }

  return { acao, nome: atual.nome, antes: atual.estado, depois, titulo, comoFunciona, avisos, orcamentoMin, orcamentoMax };
}

export interface ResultadoAcao { previa: PreviaAcao; aplicado: EstadoMeta }

/** Aplica no Meta (revalidando), confere o resultado e registra no log. Só chamar depois da confirmação do usuário. */
export async function executarAcao(
  acao: AcaoMeta,
  usuario: { id: string | null; nome: string },
  ref?: { dia: string; id: string },
  reversao = false,
): Promise<ResultadoAcao> {
  const previa = await previaAcao(acao); // revalida contra o estado de AGORA
  let erro: string | null = null;
  let aplicado: EstadoMeta = previa.antes;
  try {
    const corpo: Record<string, string> = acao.tipo === 'orcamento'
      ? { daily_budget: String(Math.round((acao.valor as number) * 100)) }
      : { status: acao.tipo === 'pausar' ? 'PAUSED' : 'ACTIVE' };
    await graph('POST', acao.id, corpo);
    const conferido = await lerEntidade(acao.nivel, acao.id);
    aplicado = conferido.estado;
    const t = TABELA[acao.nivel];
    if (acao.tipo === 'orcamento' && acao.nivel !== 'anuncio') {
      await query(`UPDATE ${t.tabela} SET daily_budget = $2 WHERE ${t.chave} = $1`, [acao.id, aplicado.orcamentoDia]);
    } else {
      await query(`UPDATE ${t.tabela} SET status = $2 WHERE ${t.chave} = $1`, [acao.id, aplicado.status]);
    }
  } catch (err) {
    erro = err instanceof Error ? err.message : 'Falha ao aplicar no Meta';
  }

  await query(
    `INSERT INTO traffic_actions_log (user_id, user_name, tipo, nivel, entity_id, entity_name, antes, depois, ok, erro, sugestao_dia, sugestao_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb,$9,$10,$11,$12)`,
    [usuario.id, usuario.nome, acao.tipo, acao.nivel, acao.id, previa.nome, JSON.stringify(previa.antes),
      JSON.stringify(erro ? previa.antes : aplicado), erro === null, erro, ref?.dia ?? null, ref?.id ?? null],
  );
  if (erro) throw new ErroAcao(erro);

  if (ref) {
    const r = await query<{ sugestoes: Array<Record<string, unknown>> }>(`SELECT sugestoes FROM traffic_ai_reviews WHERE dia = $1::date`, [ref.dia]);
    const lista = r[0]?.sugestoes;
    if (lista) {
      const nova = lista.map((s) => (s.id === ref.id
        ? reversao
          // Reverteu: a sugestão volta a poder ser aplicada, sem marca de "aplicada".
          ? (({ aplicada: _descartada, ...resto }) => ({ ...resto, status: 'pendente' }))(s)
          : { ...s, status: 'aceita', aplicada: { em: new Date().toISOString(), por: usuario.nome, antes: previa.antes, depois: aplicado, titulo: previa.titulo, acao } }
        : s));
      await query(`UPDATE traffic_ai_reviews SET sugestoes = $2::jsonb WHERE dia = $1::date`, [ref.dia, JSON.stringify(nova)]);
    }
  }
  return { previa, aplicado };
}

export async function historicoAcoes(limite = 30) {
  return query(
    `SELECT id, created_at, user_name, tipo, nivel, entity_id, entity_name, antes, depois, ok, erro
     FROM traffic_actions_log ORDER BY created_at DESC LIMIT $1`, [limite]);
}
