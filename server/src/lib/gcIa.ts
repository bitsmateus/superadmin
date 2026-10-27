import { query, queryOne } from '../db.js';
import { diasAtras } from './metaInsights.js';
import { anunciosDoCliente, benchmarkDoSegmento, campanhasDoCliente, totaisDoCliente } from './gcTrafego.js';
import { postsDoCliente } from './gcInstagram.js';

/**
 * IA dos clientes NX Digital (Claude): análise do tráfego, ideias de conteúdo (roteiros de vídeo e
 * artes) e o chat do assistente. Tudo parte do mesmo pacote de contexto do cliente (montado aqui),
 * que leva só números agregados e textos do cadastro/briefing — NUNCA as senhas do briefing.
 */

const API_URL = 'https://api.anthropic.com/v1/messages';
const MODEL = process.env.ANTHROPIC_MODEL || 'claude-sonnet-5';

export interface MensagemIa { role: 'user' | 'assistant'; content: string }

export async function chamarClaude(sistema: string, mensagens: MensagemIa[], maxTokens = 8000): Promise<string> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error('ANTHROPIC_API_KEY não configurada no servidor.');
  const res = await fetch(API_URL, {
    method: 'POST',
    headers: {
      'x-api-key': key,
      'anthropic-version': '2023-06-01',
      ...(process.env.ANTHROPIC_WORKSPACE_ID ? { 'anthropic-workspace-id': process.env.ANTHROPIC_WORKSPACE_ID } : {}),
      'content-type': 'application/json',
    },
    body: JSON.stringify({ model: MODEL, max_tokens: maxTokens, system: sistema, messages: mensagens }),
  });
  if (!res.ok) {
    const detalhe = await res.text().catch(() => '');
    throw new Error(`Claude API ${res.status}: ${detalhe.slice(0, 300)}`);
  }
  const data = (await res.json()) as { content?: { type: string; text?: string }[]; stop_reason?: string };
  if (data.stop_reason === 'refusal') throw new Error('A IA recusou o pedido.');
  const texto = (data.content ?? []).filter((b) => b.type === 'text').map((b) => b.text ?? '').join('\n').trim();
  if (!texto) throw new Error(`A IA não retornou texto (parada: ${data.stop_reason ?? 'desconhecida'}).`);
  return texto;
}

/** Extrai o objeto JSON da resposta (tolera ```json em volta ou texto antes/depois). */
export function extrairJson<T>(bruto: string): T {
  const ini = bruto.indexOf('{');
  const fim = bruto.lastIndexOf('}');
  if (ini < 0 || fim <= ini) throw new Error('Resposta da IA sem JSON.');
  return JSON.parse(bruto.slice(ini, fim + 1)) as T;
}

const arred = (v: number | null | undefined, casas = 2) => (v == null ? null : Math.round(v * 10 ** casas) / 10 ** casas);

/** Tudo o que a IA precisa saber do cliente, num JSON compacto. */
export async function contextoDoCliente(clienteId: string): Promise<Record<string, unknown>> {
  const cliente = await queryOne<Record<string, unknown>>(
    `SELECT nome_empresa, segmento, cidade, prioridade, observacoes_gerais, data_inicio FROM gc_clientes WHERE id = $1`,
    [clienteId],
  );
  if (!cliente) throw new Error('Cliente não encontrado');
  const de30 = diasAtras(30);
  const ontem = diasAtras(1);
  const [briefing, planejamento, metas, servicos, t30, t30ant, t7, t7ant, campanhas, anuncios, alertas, historico, bench, posts] = await Promise.all([
    // Só campos sem senha.
    queryOne<{ site: string; instagram: string; perguntas: unknown; extras: unknown }>(
      'SELECT site, instagram, perguntas, extras FROM gc_briefing WHERE gc_cliente_id = $1', [clienteId],
    ),
    queryOne('SELECT situacao_atual, leads_mes, investimento_mes, ticket_medio, taxa_conversao, faturamento_mensal FROM gc_planejamento WHERE gc_cliente_id = $1', [clienteId]),
    query(`SELECT chave_metrica, horizonte, valor_base, valor_meta, prazo FROM gc_metas WHERE gc_cliente_id = $1 AND status = 'ativa'`, [clienteId]),
    query(`SELECT tipo, descricao_plano, investimento_previsto_mensal FROM gc_servicos WHERE gc_cliente_id = $1 AND status = 'ativo'`, [clienteId]),
    totaisDoCliente(clienteId, de30, ontem),
    totaisDoCliente(clienteId, diasAtras(60), diasAtras(31)),
    totaisDoCliente(clienteId, diasAtras(7), ontem),
    totaisDoCliente(clienteId, diasAtras(14), diasAtras(8)),
    campanhasDoCliente(clienteId, de30, ontem),
    anunciosDoCliente(clienteId, de30, ontem, 15),
    query(`SELECT nivel, mensagem FROM gc_trafego_alertas WHERE gc_cliente_id = $1 AND resolved_at IS NULL`, [clienteId]),
    query(`SELECT tipo, titulo, descricao, created_at::date AS dia FROM gc_historico WHERE gc_cliente_id = $1 ORDER BY created_at DESC LIMIT 12`, [clienteId]),
    benchmarkDoSegmento(clienteId, de30, ontem),
    postsDoCliente(clienteId, 90),
  ]);
  const resumoTotais = (t: Awaited<ReturnType<typeof totaisDoCliente>>) => ({
    gasto: arred(t.gasto), resultados: t.resultados, leads: t.leads, conversas: t.conversas, compras: t.compras,
    valor_compras: arred(t.valorCompras), custo_por_resultado: arred(t.custoResultado), ctr_pct: arred(t.ctr),
    cpm: arred(t.cpm), roas: arred(t.roas), impressoes: t.impressoes, cliques: t.cliques,
  });
  const topPosts = [...posts].sort((a, b) => (b.alcance ?? 0) - (a.alcance ?? 0)).slice(0, 12);
  return {
    hoje: diasAtras(0),
    cliente,
    briefing: briefing ? { site: briefing.site, instagram: briefing.instagram, perguntas: briefing.perguntas, extras: briefing.extras } : null,
    planejamento, metas_ativas: metas, servicos,
    trafego_meta: {
      ultimos_30_dias: resumoTotais(t30), '30_dias_anteriores': resumoTotais(t30ant),
      ultimos_7_dias: resumoTotais(t7), '7_dias_anteriores': resumoTotais(t7ant),
      campanhas: campanhas.slice(0, 10).map((c) => ({ nome: c.nome, status: c.status, objetivo: c.objetivo, orcamento_dia: c.orcamentoDia, ...resumoTotais(c) })),
      anuncios_com_mais_verba: anuncios.map((a) => ({
        nome: a.nome, formato: a.formato, campanha: a.campanha, titulo: a.titulo, texto: a.texto.slice(0, 400),
        frequencia: arred(a.frequencia, 1), ...resumoTotais(a),
      })),
      benchmark_segmento_30d: bench,
      alertas_abertos: alertas,
    },
    instagram_ultimos_90_dias: {
      total_posts: posts.length,
      mais_alcance: topPosts.map((p) => ({
        tipo: p.produto || p.tipo, data: p.publicadoEm?.slice(0, 10), legenda: p.legenda.slice(0, 500),
        alcance: p.alcance, visualizacoes: p.visualizacoes, curtidas: p.curtidas, comentarios: p.comentarios,
        salvos: p.salvos, compartilhamentos: p.compartilhamentos, engajamento_pct: arred(p.engajamento),
      })),
      media_alcance: posts.length ? Math.round(posts.reduce((s, p) => s + (p.alcance ?? 0), 0) / posts.length) : null,
    },
    historico_recente: historico,
  };
}

// ── Análise do tráfego ────────────────────────────────────────────────────────

const SISTEMA_TRAFEGO = `Você é gestor de tráfego pago sênior da agência NX Digital (Brasil). Recebe o JSON de UM cliente: cadastro, briefing, planejamento e metas, números do Meta Ads (30 e 7 dias contra os períodos anteriores), campanhas, anúncios, benchmark do segmento, alertas, desempenho do Instagram e histórico de notas da equipe.
Seu trabalho: dizer como o cliente está e o que fazer pra melhorar o resultado dele.
Regras:
- Cite os números do JSON que sustentam cada ponto. Nunca invente número, campanha ou criativo.
- "Resultado" = leads + conversas + compras. Julgue por custo por resultado, volume e tendência; compare com as metas e o benchmark quando houver.
- Com menos de R$ 300 gastos ou menos de 15 resultados, diga que está em teste e o que observar.
- No máximo 5 sugestões, da mais pra menos importante. Seja específico (qual campanha/criativo, quanto mudar).
- Ideias de criativo: baseie nos anúncios que mais converteram e nos posts orgânicos com mais alcance.
- "mensagem_cliente": texto curto pra mandar no WhatsApp do cliente (tom próximo, sem jargão, 4 a 8 linhas, pode usar emoji com moderação), com o resumo do período e o próximo passo. Nunca prometa resultado.
- Se não houver dados de tráfego, diga isso no resumo e foque no que falta configurar.
Responda SOMENTE com JSON válido, sem markdown, neste formato:
{"nota":0-10,"resumo":"3 a 5 frases","pontos_fortes":["..."],"problemas":["..."],"sugestoes":[{"prioridade":"alta|media|baixa","titulo":"curto","detalhe":"o que fazer e por quê","dado":"números"}],"ideias_criativos":[{"titulo":"...","formato":"video|imagem|carrossel","gancho":"primeira frase/cena","descricao":"como é o criativo"}],"mensagem_cliente":"..."}`;

export interface AnaliseTrafego {
  nota: number | null; resumo: string; pontos_fortes: string[]; problemas: string[];
  sugestoes: { prioridade: string; titulo: string; detalhe: string; dado: string }[];
  ideias_criativos: { titulo: string; formato: string; gancho: string; descricao: string }[];
  mensagem_cliente: string;
}

const txt = (v: unknown, max = 2000) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const lista = (v: unknown, max: number) => (Array.isArray(v) ? v.slice(0, max) : []);

export function normalizarAnalise(bruta: Record<string, unknown>): AnaliseTrafego {
  const nota = Number(bruta.nota);
  return {
    nota: Number.isFinite(nota) ? Math.max(0, Math.min(10, nota)) : null,
    resumo: txt(bruta.resumo, 1500),
    pontos_fortes: lista(bruta.pontos_fortes, 6).map((x) => txt(x, 300)).filter(Boolean),
    problemas: lista(bruta.problemas, 6).map((x) => txt(x, 300)).filter(Boolean),
    sugestoes: lista(bruta.sugestoes, 5).map((s) => {
      const r = (s ?? {}) as Record<string, unknown>;
      const prioridade = ['alta', 'media', 'baixa'].includes(String(r.prioridade)) ? String(r.prioridade) : 'media';
      return { prioridade, titulo: txt(r.titulo, 160), detalhe: txt(r.detalhe, 800), dado: txt(r.dado, 400) };
    }).filter((s) => s.titulo),
    ideias_criativos: lista(bruta.ideias_criativos, 6).map((s) => {
      const r = (s ?? {}) as Record<string, unknown>;
      return { titulo: txt(r.titulo, 160), formato: txt(r.formato, 30), gancho: txt(r.gancho, 300), descricao: txt(r.descricao, 800) };
    }).filter((s) => s.titulo),
    mensagem_cliente: txt(bruta.mensagem_cliente, 1500),
  };
}

// ── Ideias de conteúdo (social media) ─────────────────────────────────────────

const SISTEMA_CONTEUDO = `Você é estrategista de social media e roteirista da agência NX Digital (Brasil). Recebe o JSON de UM cliente: cadastro, briefing, planejamento, os posts do Instagram com mais alcance (com métricas) e os anúncios que mais converteram no Meta Ads.
Seu trabalho: descobrir o que faz o conteúdo desse cliente dar visualização e transformar isso em novos conteúdos prontos pra produzir.
Regras:
- Os padrões precisam vir dos dados (cite o post/anúncio e os números). Se houver poucos dados, diga isso e use boas práticas do segmento, deixando claro que é hipótese.
- Roteiros de vídeo (Reels): gancho forte nos 3 primeiros segundos, cenas numeradas com o que aparece e o que é falado, CTA no fim, duração sugerida e legenda pronta com hashtags.
- Artes (post, carrossel ou story): o texto que vai NA arte (por slide no carrossel), o briefing visual pra designer e a legenda.
- Fale a língua do público do cliente. Nada de promessa que o cliente não possa cumprir.
- Pelo menos 3 roteiros de vídeo e 3 artes.
Responda SOMENTE com JSON válido, sem markdown, neste formato:
{"diagnostico":"2 a 4 frases","padroes":[{"padrao":"...","evidencia":"..."}],"roteiros_video":[{"titulo":"...","objetivo":"alcance|engajamento|conversao","duracao":"30s","gancho":"...","cenas":["1. ...","2. ..."],"cta":"...","legenda":"..."}],"artes":[{"titulo":"...","formato":"post|carrossel|story","texto_arte":["slide 1: ...","slide 2: ..."],"briefing_visual":"...","legenda":"..."}]}`;

export interface IdeiasConteudo {
  diagnostico: string;
  padroes: { padrao: string; evidencia: string }[];
  roteiros_video: { titulo: string; objetivo: string; duracao: string; gancho: string; cenas: string[]; cta: string; legenda: string }[];
  artes: { titulo: string; formato: string; texto_arte: string[]; briefing_visual: string; legenda: string }[];
}

export function normalizarIdeias(b: Record<string, unknown>): IdeiasConteudo {
  return {
    diagnostico: txt(b.diagnostico, 1500),
    padroes: lista(b.padroes, 8).map((p) => {
      const r = (p ?? {}) as Record<string, unknown>;
      return { padrao: txt(r.padrao, 300), evidencia: txt(r.evidencia, 400) };
    }).filter((p) => p.padrao),
    roteiros_video: lista(b.roteiros_video, 8).map((p) => {
      const r = (p ?? {}) as Record<string, unknown>;
      return {
        titulo: txt(r.titulo, 160), objetivo: txt(r.objetivo, 30), duracao: txt(r.duracao, 30), gancho: txt(r.gancho, 400),
        cenas: lista(r.cenas, 15).map((c) => txt(c, 500)).filter(Boolean), cta: txt(r.cta, 300), legenda: txt(r.legenda, 2200),
      };
    }).filter((p) => p.titulo),
    artes: lista(b.artes, 8).map((p) => {
      const r = (p ?? {}) as Record<string, unknown>;
      return {
        titulo: txt(r.titulo, 160), formato: txt(r.formato, 30),
        texto_arte: lista(r.texto_arte, 12).map((c) => txt(c, 500)).filter(Boolean),
        briefing_visual: txt(r.briefing_visual, 1000), legenda: txt(r.legenda, 2200),
      };
    }).filter((p) => p.titulo),
  };
}

// ── Gerar e guardar ───────────────────────────────────────────────────────────

export async function gerarAnalise(
  clienteId: string,
  tipo: 'trafego' | 'conteudo',
  origem: 'manual' | 'auto',
  usuarioId: string | null,
  pedidoExtra = '',
): Promise<{ id: string; conteudo: AnaliseTrafego | IdeiasConteudo; created_at: string }> {
  const contexto = await contextoDoCliente(clienteId);
  const sistema = tipo === 'trafego' ? SISTEMA_TRAFEGO : SISTEMA_CONTEUDO;
  const extra = pedidoExtra.trim() ? `\n\nPedido da equipe pra esta geração: ${pedidoExtra.trim().slice(0, 1000)}` : '';
  const bruto = await chamarClaude(sistema, [{ role: 'user', content: `Dados do cliente (JSON):\n${JSON.stringify(contexto)}${extra}` }]);
  const obj = extrairJson<Record<string, unknown>>(bruto);
  const conteudo = tipo === 'trafego' ? normalizarAnalise(obj) : normalizarIdeias(obj);
  const r = await queryOne<{ id: string; created_at: string }>(
    `INSERT INTO gc_ia_analises (gc_cliente_id, tipo, dia, origem, conteudo, gerado_por)
     VALUES ($1,$2,$3,$4,$5,$6) RETURNING id, created_at`,
    [clienteId, tipo, diasAtras(0), origem, JSON.stringify(conteudo), usuarioId],
  );
  return { id: r!.id, conteudo, created_at: r!.created_at };
}

export async function ultimaAnalise(clienteId: string, tipo: 'trafego' | 'conteudo') {
  return queryOne<{ id: string; dia: string; origem: string; conteudo: unknown; created_at: string; gerado_por_nome: string | null }>(
    `SELECT a.id, to_char(a.dia, 'YYYY-MM-DD') AS dia, a.origem, a.conteudo, a.created_at, p.name AS gerado_por_nome
     FROM gc_ia_analises a LEFT JOIN profiles p ON p.id = a.gerado_por
     WHERE a.gc_cliente_id = $1 AND a.tipo = $2 ORDER BY a.created_at DESC LIMIT 1`,
    [clienteId, tipo],
  );
}

// ── Chat do assistente ────────────────────────────────────────────────────────

const SISTEMA_CHAT = `Você é o assistente de IA da agência NX Digital (Brasil), dentro da ficha de UM cliente. A equipe (gestores de tráfego, social media, atendimento) conversa com você pra entender o cliente, tirar relatórios, pedir ideias de criativos, roteiros, copies e próximos passos.
Você recebe abaixo o JSON com tudo o que se sabe do cliente agora (cadastro, briefing, planejamento, metas, números do Meta Ads, campanhas, anúncios, benchmark, alertas, Instagram e histórico).
Regras:
- Responda em português do Brasil, direto ao ponto, em markdown simples (títulos curtos, listas, negrito). Tabelas só quando ajudarem.
- Use os números do JSON e diga o período. Nunca invente número, campanha, post ou fato. Se o dado não existe, diga o que falta (ex.: vincular conta, sincronizar Instagram).
- Quando pedirem relatório, monte com: período, investimento, resultados, custo por resultado, comparação com o período anterior, destaques (melhores campanhas/criativos), problemas e próximos passos.
- Quando pedirem roteiro/arte, entregue pronto pra produzir (gancho, cenas, texto da arte, legenda).
- Você não altera nada na Meta nem no sistema; só orienta.`;

export async function conversar(clienteId: string, historico: MensagemIa[], mensagem: string): Promise<string> {
  const contexto = await contextoDoCliente(clienteId);
  const msgs: MensagemIa[] = [
    ...historico.filter((m) => (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string' && m.content.trim())
      .slice(-16).map((m) => ({ role: m.role, content: m.content.slice(0, 8000) })),
    { role: 'user', content: mensagem.slice(0, 4000) },
  ];
  // A API exige começar com "user".
  while (msgs.length && msgs[0].role !== 'user') msgs.shift();
  return chamarClaude(`${SISTEMA_CHAT}\n\nDados do cliente (JSON):\n${JSON.stringify(contexto)}`, msgs, 6000);
}

// ── Rotina diária ─────────────────────────────────────────────────────────────

/** Análise de tráfego automática pros clientes que gastaram na semana e ainda não têm a de hoje. */
export async function analisesDiarias(): Promise<{ geradas: number; erros: number }> {
  if (!process.env.ANTHROPIC_API_KEY) return { geradas: 0, erros: 0 };
  const clientes = await query<{ id: string }>(
    `SELECT DISTINCT i.gc_cliente_id AS id FROM gc_meta_insights_dia i JOIN gc_clientes c ON c.id = i.gc_cliente_id
     WHERE c.status = 'ativo' AND i.dia >= $1 AND i.gasto > 0
       AND NOT EXISTS (SELECT 1 FROM gc_ia_analises a WHERE a.gc_cliente_id = i.gc_cliente_id AND a.tipo = 'trafego' AND a.dia = $2)`,
    [diasAtras(7), diasAtras(0)],
  );
  let geradas = 0;
  let erros = 0;
  for (const c of clientes) {
    try {
      await gerarAnalise(c.id, 'trafego', 'auto', null);
      geradas++;
    } catch (err) {
      erros++;
      console.error('[gc-ia] análise do cliente', c.id, err instanceof Error ? err.message : err);
    }
  }
  return { geradas, erros };
}
