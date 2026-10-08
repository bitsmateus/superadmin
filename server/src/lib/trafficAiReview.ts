import { randomUUID } from 'crypto';
import { query } from '../db.js';
import { dataSp, rankingTrafego, totaisTrafego, type LinhaTrafego, type NivelTrafego } from './trafegoMetricas.js';

/**
 * Varredura diária de tráfego com IA (Inteligência de Tráfego, fase 4).
 * Monta um resumo SÓ com números agregados e textos de anúncio (sem nome nem telefone de lead),
 * pede à Claude até 5 sugestões acionáveis e guarda em traffic_ai_reviews. Só SUGERE: nada é
 * pausado nem alterado no Meta — a pessoa aceita ou ignora cada sugestão na aba Tráfego.
 */

const API_URL = 'https://api.anthropic.com/v1/messages';
const MODEL = process.env.ANTHROPIC_MODEL || 'claude-sonnet-5';
const CATEGORIAS = ['verba', 'criativo', 'publico', 'nicho', 'copy', 'operacao'] as const;
export type CategoriaSugestao = (typeof CATEGORIAS)[number];
export type StatusSugestao = 'pendente' | 'aceita' | 'ignorada';

export interface SugestaoIa {
  id: string;
  categoria: CategoriaSugestao;
  titulo: string;
  detalhe: string;
  dado: string;
  status: StatusSugestao;
}

const arredonda = (v: number | null): number | null => (v == null ? null : Math.round(v * 100) / 100);

function enxuto(l: LinhaTrafego) {
  return {
    nome: l.nome, gasto: arredonda(l.gasto), leads: l.leads, agendamentos: l.agendadas, reunioes: l.reunioes,
    vendas: l.vendas, cpl: arredonda(l.cpl), custo_reuniao: arredonda(l.custoReuniao), cac: arredonda(l.cac),
    frequencia: arredonda(l.frequencia),
  };
}

async function top(nivel: NivelTrafego, desde: string, ate: string, n: number) {
  return (await rankingTrafego(nivel, desde, ate))
    .filter((l) => l.gasto > 0 || l.leads > 0)
    .sort((a, b) => b.gasto - a.gasto)
    .slice(0, n)
    .map(enxuto);
}

/** Entrada da IA: tudo agregado por campanha/conjunto/anúncio/nicho, sem dado pessoal de lead. */
export async function montarEntradaIa(): Promise<Record<string, unknown>> {
  const ate = dataSp(1);
  const d14 = dataSp(14), d30 = dataSp(30);

  const [t14, t30, camp14, camp30, conj14, anun14, anun30] = await Promise.all([
    totaisTrafego(d14, ate), totaisTrafego(d30, ate),
    top('campanha', d14, ate, 12), top('campanha', d30, ate, 12),
    top('conjunto', d14, ate, 15), top('anuncio', d14, ate, 20), top('anuncio', d30, ate, 20),
  ]);

  const nichos = await query<{ nicho: string; papel: string; gasto: string; leads: string }>(
    `SELECT COALESCE(NULLIF(c.nicho,''), '(sem nicho)') AS nicho, COALESCE(NULLIF(c.papel,''), 'sem papel') AS papel,
       SUM(i.spend) AS gasto, 0 AS leads
     FROM meta_ad_insights_daily i LEFT JOIN meta_campaigns c ON c.campaign_id = i.campaign_id
     WHERE i.dia BETWEEN $1::date AND $2::date GROUP BY 1, 2 ORDER BY SUM(i.spend) DESC LIMIT 15`, [d30, ate]);

  const criativos = await query<Record<string, string>>(
    `SELECT a.name, a.formato, a.titulo, LEFT(a.texto, 400) AS texto FROM meta_ads a
     WHERE a.ad_id IN (SELECT ad_id FROM meta_ad_insights_daily WHERE dia BETWEEN $1::date AND $2::date GROUP BY ad_id HAVING SUM(spend) > 0)
     ORDER BY a.name LIMIT 25`, [d14, ate]);

  const publicos = await query<Record<string, unknown>>(
    `SELECT s.name, s.optimization_goal, s.targeting FROM meta_adsets s
     WHERE s.adset_id IN (SELECT adset_id FROM meta_ad_insights_daily WHERE dia BETWEEN $1::date AND $2::date GROUP BY adset_id HAVING SUM(spend) > 0)
     LIMIT 15`, [d14, ate]);

  // Só contagens: motivo de desqualificação e dores do formulário, sem vínculo com um lead específico.
  const motivos = await query<{ motivo: string; n: string }>(
    `SELECT motivo_desqualificacao AS motivo, count(*) AS n FROM lead_rows
     WHERE meta_ad_id IS NOT NULL AND deleted_at IS NULL AND COALESCE(motivo_desqualificacao,'') <> ''
       AND (created_at AT TIME ZONE 'America/Sao_Paulo')::date >= $1::date GROUP BY 1 ORDER BY 2 DESC LIMIT 10`, [d30]);
  const dores = await query<{ dor: string; n: string }>(
    `SELECT LEFT(dor_cliente, 80) AS dor, count(*) AS n FROM lead_rows
     WHERE meta_ad_id IS NOT NULL AND deleted_at IS NULL AND COALESCE(dor_cliente,'') <> ''
       AND (created_at AT TIME ZONE 'America/Sao_Paulo')::date >= $1::date GROUP BY 1 ORDER BY 2 DESC LIMIT 10`, [d30]);

  const alertas = await query<{ level: string; message: string }>(
    `SELECT level, message FROM traffic_alerts WHERE resolved_at IS NULL ORDER BY created_at DESC LIMIT 15`);

  const anteriores = await query<{ dia: string; sugestoes: SugestaoIa[] }>(
    `SELECT to_char(dia,'YYYY-MM-DD') AS dia, sugestoes FROM traffic_ai_reviews WHERE dia >= (now()::date - 7) ORDER BY dia DESC`);

  return {
    periodo_ate: ate,
    totais_14d: t14, totais_30d: t30,
    campanhas_14d: camp14, campanhas_30d: camp30, conjuntos_14d: conj14, anuncios_14d: anun14, anuncios_30d: anun30,
    gasto_por_nicho_30d: nichos.map((n) => ({ nicho: n.nicho, papel: n.papel, gasto: arredonda(Number(n.gasto)) })),
    criativos_ativos: criativos, publicos,
    motivos_desqualificacao_30d: motivos.map((m) => ({ motivo: m.motivo, leads: Number(m.n) })),
    dores_formulario_30d: dores.map((d) => ({ dor: d.dor, leads: Number(d.n) })),
    alertas_abertos: alertas,
    sugestoes_ultimos_7_dias: anteriores.flatMap((r) => (r.sugestoes ?? []).map((s) => ({
      dia: r.dia, categoria: s.categoria, titulo: s.titulo, status: s.status,
    }))),
  };
}

const SISTEMA = `Você é analista de tráfego pago de uma agência brasileira que vende software/atendimento para pequenas empresas. Recebe dados agregados do Meta Ads cruzados com o funil de vendas (lead -> agendamento -> reunião -> venda) e devolve NO MÁXIMO 5 sugestões de ação, da mais para a menos importante.
Regras:
- Cada sugestão precisa citar o dado que a justifica (números do JSON recebido). Não invente números.
- Julgue por custo por reunião, custo por venda e CAC — não por CPL sozinho. Só dê veredito de nicho/campanha/anúncio com pelo menos R$ 300 gastos e 15 leads; abaixo disso é "em teste", diga para aguardar.
- Categorias possíveis: verba, criativo, publico, nicho, copy, operacao.
- Não repita sugestões já aceitas ou ignoradas nos últimos 7 dias (campo sugestoes_ultimos_7_dias), a menos que o dado tenha mudado de forma relevante.
- Se não houver nada relevante, devolva menos sugestões (ou nenhuma). Não encha linguiça.
- Você só sugere; nunca diga que já alterou algo.
Responda SOMENTE com JSON válido, sem markdown, neste formato:
{"resumo":"2 a 4 frases sobre como a conta está","sugestoes":[{"categoria":"verba","titulo":"curto e direto","detalhe":"o que fazer e por quê","dado":"os números que sustentam"}]}`;

interface BlocoAnthropic { type: string; text?: string }

async function chamarClaude(entrada: Record<string, unknown>): Promise<string> {
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
    body: JSON.stringify({
      model: MODEL,
      // Folga grande: se o modelo "pensar" antes de responder, o raciocínio também consome este limite.
      max_tokens: 8000,
      system: SISTEMA,
      messages: [{ role: 'user', content: `Dados da conta (JSON):\n${JSON.stringify(entrada)}` }],
    }),
  });
  if (!res.ok) {
    const detalhe = await res.text().catch(() => '');
    throw new Error(`Claude API ${res.status}: ${detalhe.slice(0, 300)}`);
  }
  const data = (await res.json()) as { content?: BlocoAnthropic[]; stop_reason?: string };
  if (data.stop_reason === 'refusal') throw new Error('A IA recusou o pedido.');
  const texto = (data.content ?? []).filter((b) => b.type === 'text').map((b) => b.text ?? '').join('\n').trim();
  if (!texto) {
    const tipos = (data.content ?? []).map((b) => b.type).join(', ') || 'nenhum';
    throw new Error(`A IA não retornou texto (motivo de parada: ${data.stop_reason ?? 'desconhecido'}; blocos: ${tipos}; modelo: ${MODEL}).`);
  }
  return texto;
}

/** Extrai e valida o JSON da resposta (tolera cerca ```json em volta). Máx. 5 sugestões. */
export function interpretarResposta(bruto: string): { resumo: string; sugestoes: SugestaoIa[] } {
  const ini = bruto.indexOf('{'), fim = bruto.lastIndexOf('}');
  if (ini < 0 || fim <= ini) throw new Error('Resposta da IA sem JSON.');
  const obj = JSON.parse(bruto.slice(ini, fim + 1)) as { resumo?: unknown; sugestoes?: unknown };
  const texto = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
  const lista = Array.isArray(obj.sugestoes) ? obj.sugestoes : [];
  const sugestoes: SugestaoIa[] = [];
  for (const s of lista.slice(0, 5)) {
    const r = s as Record<string, unknown>;
    const categoria = CATEGORIAS.includes(r.categoria as CategoriaSugestao) ? (r.categoria as CategoriaSugestao) : 'operacao';
    const titulo = texto(r.titulo, 140);
    if (!titulo) continue;
    sugestoes.push({ id: randomUUID(), categoria, titulo, detalhe: texto(r.detalhe, 700), dado: texto(r.dado, 400), status: 'pendente' });
  }
  return { resumo: texto(obj.resumo, 800), sugestoes };
}

/** Roda a varredura de hoje e grava (substitui a de hoje, se já existir). */
export async function rodarVarreduraIa(): Promise<{ dia: string; sugestoes: number }> {
  const dia = dataSp(0);
  const { resumo, sugestoes } = interpretarResposta(await chamarClaude(await montarEntradaIa()));
  await query(
    `INSERT INTO traffic_ai_reviews (dia, texto, sugestoes) VALUES ($1::date, $2, $3::jsonb)
     ON CONFLICT (dia) DO UPDATE SET texto = EXCLUDED.texto, sugestoes = EXCLUDED.sugestoes, created_at = now()`,
    [dia, resumo, JSON.stringify(sugestoes)],
  );
  return { dia, sugestoes: sugestoes.length };
}

/** Aceitar / ignorar uma sugestão (vira histórico). Retorna false se não achou. */
export async function marcarSugestao(dia: string, id: string, status: StatusSugestao): Promise<boolean> {
  const r = await query<{ sugestoes: SugestaoIa[] }>(`SELECT sugestoes FROM traffic_ai_reviews WHERE dia = $1::date`, [dia]);
  const lista = r[0]?.sugestoes;
  if (!lista || !lista.some((s) => s.id === id)) return false;
  const nova = lista.map((s) => (s.id === id ? { ...s, status } : s));
  await query(`UPDATE traffic_ai_reviews SET sugestoes = $2::jsonb WHERE dia = $1::date`, [dia, JSON.stringify(nova)]);
  return true;
}
