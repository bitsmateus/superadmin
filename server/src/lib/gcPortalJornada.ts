import { CHAVES_PLANEJAMENTO, HORIZONTES_PLANEJAMENTO, derivadosDoPontoA } from './gcPlanejamento.js';

/**
 * O bloco "Nossa jornada" do portal do cliente — montagem PURA, sem banco.
 *
 * É a única porta de saída do planejamento pro portal e pra prévia "ver como o cliente vê". Por isso
 * é uma função à parte, fácil de testar: o que o cliente pode ler é decidido aqui, campo por campo,
 * numa LISTA PERMITIDA. Nada é copiado por espalhamento (`...linha`): se a consulta que alimenta
 * isto um dia trouxer uma coluna a mais — um `SELECT *` descuidado —, a coluna simplesmente não
 * chega à saída.
 *
 * Regras:
 *  - estratégia e premissas NUNCA saem, nem com tudo ligado. Não existe interruptor pra isso;
 *  - situação de hoje e "onde quer chegar" só saem se a equipe marcou cada um;
 *  - o bloco inteiro só existe se `portal_ativo` — exceto na prévia, que passa `ignorarToggle` pra a
 *    equipe ver o que o cliente veria antes de ligar;
 *  - o realizado só vem dos meses de relatório publicado (quem chama já entrega só esses).
 */

export interface EntradaJornada {
  /** A linha de gc_planejamento. Colunas além das listadas são ignoradas. */
  planejamento: Record<string, unknown> | null;
  metas: { horizonte: string; chave_metrica: string; valor_meta: unknown }[];
  /** Linhas de gc_planejamento_cenarios. Só `onde_quer_chegar` é lido, e só se estiver marcado. */
  cenarios: Record<string, unknown>[];
  realizado: { chave: string; mes: string; valor: unknown }[];
}

export interface JornadaPublica {
  data_diagnostico: string | null;
  curva: string;
  situacao: string | null;
  atual: {
    leads: number | null;
    investimento: number | null;
    vendas: number | null;
    ticket: number | null;
    conversao: number | null;
    receita: number | null;
  };
  /** O primeiro mês do plano (só números): investimento, vendas e faturamento, e o CPL médio da premissa. */
  primeiro_mes: { investimento: number | null; vendas: number | null; faturamento: number | null; cpl_medio: number | null };
  cenarios: Record<string, { metas: Record<string, number>; objetivo: string | null }>;
  realizado: Record<string, Record<string, number>>;
}

/** Chaves de realizado que o portal mostra. */
export const CHAVES_REALIZADO_PUBLICO = ['leads', 'vendas', 'receita', 'investimento'] as const;

const numero = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

const texto = (v: unknown): string => (typeof v === 'string' ? v : '');

export function montarJornadaPublica(
  e: EntradaJornada,
  opcoes: { ignorarToggle?: boolean } = {}
): JornadaPublica | null {
  const p = e.planejamento;
  if (!p) return null;
  if (!p.portal_ativo && !opcoes.ignorarToggle) return null;

  const mostrarObjetivo = Boolean(p.portal_mostrar_objetivo);
  const mostrarSituacao = Boolean(p.portal_mostrar_situacao);

  const cenarios: JornadaPublica['cenarios'] = {};
  for (const h of HORIZONTES_PLANEJAMENTO) {
    const metas: Record<string, number> = {};
    for (const m of e.metas) {
      if (m.horizonte !== h || !(CHAVES_PLANEJAMENTO as readonly string[]).includes(m.chave_metrica)) continue;
      const v = numero(m.valor_meta);
      if (v !== null) metas[m.chave_metrica] = v;
    }
    const linha = e.cenarios.find((c) => c.horizonte === h);
    cenarios[h] = {
      metas,
      objetivo: mostrarObjetivo ? texto(linha?.onde_quer_chegar).trim() || null : null,
    };
  }

  const realizado: JornadaPublica['realizado'] = {};
  for (const chave of CHAVES_REALIZADO_PUBLICO) realizado[chave] = {};
  for (const r of e.realizado) {
    if (!(CHAVES_REALIZADO_PUBLICO as readonly string[]).includes(r.chave)) continue;
    const v = numero(r.valor);
    if (v !== null) realizado[r.chave][r.mes] = v;
  }

  return {
    data_diagnostico: typeof p.data_diagnostico === 'string' ? p.data_diagnostico : null,
    curva: texto(p.curva) || 'linear',
    situacao: mostrarSituacao ? texto(p.situacao_atual).trim() || null : null,
    atual: {
      leads: numero(p.leads_mes),
      investimento: numero(p.investimento_mes),
      vendas: numero(p.vendas_mes),
      // Ticket e conversão saem das contas (faturamento ÷ vendas, vendas ÷ leads), não de colunas.
      ...(({ ticket_medio, taxa_conversao }) => ({ ticket: ticket_medio, conversao: taxa_conversao }))(
        derivadosDoPontoA({
          leads_mes: numero(p.leads_mes), investimento_mes: numero(p.investimento_mes),
          vendas_mes: numero(p.vendas_mes), faturamento_mensal: numero(p.faturamento_mensal),
        })
      ),
      receita: numero(p.faturamento_mensal),
    },
    primeiro_mes: {
      investimento: numero(p.mes1_investimento),
      vendas: numero(p.mes1_vendas),
      faturamento: numero(p.mes1_faturamento),
      cpl_medio: numero(p.cpl_medio),
    },
    cenarios,
    realizado,
  };
}
