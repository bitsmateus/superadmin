/**
 * Catálogo de métricas do módulo "Clientes NX Digital".
 *
 * O banco não sabe o que é "leads" ou "cpl": `gc_metricas` guarda pares chave/valor por período,
 * e é este arquivo que diz quais chaves existem, como se chamam na tela e como se formatam. Métrica
 * nova = uma linha aqui, sem migração.
 *
 * As métricas DERIVADAS (CPL, CTR, ROAS…) não são gravadas: são calculadas a partir das lançadas.
 * Gravar o CPL junto deixaria dois números que podem discordar — e o certo seria sempre a divisão.
 */

export type GcUnidade = 'reais' | 'inteiro' | 'percentual' | 'decimal'

export interface GcMetricaDef {
  chave: string
  label: string
  unidade: GcUnidade
  /** Texto de ajuda da coluna, quando o nome não basta. */
  ajuda?: string
  /**
   * Subir é bom? Padrão sim. Em CPL e CAC é o contrário — e é isso que decide a COR da variação:
   * CPL caindo é verde, mesmo sendo número menor. Sem essa marcação, o relatório pintaria de
   * vermelho justamente o mês em que o custo melhorou.
   */
  subirEhBom?: boolean
}

/** O que o time digita. Esta é a ordem em que aparece no editor do mês e na tela de Tráfego. */
export const METRICAS_LANCADAS: GcMetricaDef[] = [
  { chave: 'investimento', label: 'Investimento', unidade: 'reais', ajuda: 'Verba gasta em anúncios no período' },
  { chave: 'impressoes', label: 'Impressões', unidade: 'inteiro' },
  { chave: 'cliques', label: 'Cliques', unidade: 'inteiro' },
  { chave: 'leads', label: 'Leads', unidade: 'inteiro' },
  { chave: 'conversas', label: 'Conversas', unidade: 'inteiro', ajuda: 'Leads que responderam e viraram conversa' },
  { chave: 'agendamentos', label: 'Agendamentos', unidade: 'inteiro' },
  { chave: 'vendas', label: 'Vendas', unidade: 'inteiro' },
  { chave: 'receita', label: 'Receita', unidade: 'reais', ajuda: 'Faturamento que o cliente atribui à campanha' },
]

/** Calculadas em cima das lançadas — nunca gravadas. Divisão por zero some da tela (null). */
export const METRICAS_DERIVADAS: (GcMetricaDef & {
  calcular: (v: Record<string, number>) => number | null
})[] = [
  {
    chave: 'cpl',
    label: 'CPL',
    unidade: 'reais',
    ajuda: 'Investimento ÷ leads',
    subirEhBom: false,
    calcular: (v) => (v.leads ? v.investimento / v.leads : null),
  },
  {
    chave: 'ctr',
    label: 'CTR',
    unidade: 'percentual',
    ajuda: 'Cliques ÷ impressões',
    calcular: (v) => (v.impressoes ? (v.cliques / v.impressoes) * 100 : null),
  },
  {
    chave: 'cac',
    label: 'CAC',
    unidade: 'reais',
    ajuda: 'Investimento ÷ vendas',
    subirEhBom: false,
    calcular: (v) => (v.vendas ? v.investimento / v.vendas : null),
  },
  {
    chave: 'ticket',
    label: 'Ticket médio',
    unidade: 'reais',
    ajuda: 'Receita ÷ vendas',
    calcular: (v) => (v.vendas ? v.receita / v.vendas : null),
  },
  {
    chave: 'conversao',
    label: 'Conversão',
    unidade: 'percentual',
    ajuda: 'Vendas ÷ leads',
    calcular: (v) => (v.leads ? (v.vendas / v.leads) * 100 : null),
  },
  {
    chave: 'roas',
    label: 'ROAS',
    unidade: 'decimal',
    ajuda: 'Receita ÷ investimento',
    calcular: (v) => (v.investimento ? v.receita / v.investimento : null),
  },
]

/** Toda métrica que a tela conhece, lançada ou derivada — serve pro seletor de metas. */
export const TODAS_METRICAS: GcMetricaDef[] = [...METRICAS_LANCADAS, ...METRICAS_DERIVADAS]

export function metricaLabel(chave: string): string {
  return TODAS_METRICAS.find((m) => m.chave === chave)?.label ?? chave
}

export function metricaUnidade(chave: string): GcUnidade {
  return TODAS_METRICAS.find((m) => m.chave === chave)?.unidade ?? 'decimal'
}

/** Formata um número conforme a unidade da métrica. Null/indefinido viram travessão. */
export function formatarMetrica(valor: number | null | undefined, unidade: GcUnidade): string {
  if (valor === null || valor === undefined || Number.isNaN(valor)) return '—'
  switch (unidade) {
    case 'reais':
      return valor.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
    case 'inteiro':
      return Math.round(valor).toLocaleString('pt-BR')
    case 'percentual':
      return `${valor.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`
    default:
      return valor.toLocaleString('pt-BR', { maximumFractionDigits: 2 })
  }
}

/** Atalho: formata já sabendo a chave. */
export function formatarPorChave(chave: string, valor: number | null | undefined): string {
  return formatarMetrica(valor, metricaUnidade(chave))
}

/**
 * Pega o pacote de métricas de um período ({ leads: '42' }, como vem do banco) e devolve números,
 * já com as derivadas calculadas.
 *
 * Métrica que não foi lançada NÃO entra no resultado: a tela mostra travessão, não zero. Pra conta
 * das derivadas o que falta vale zero (e aí a divisão por zero devolve null, que também é
 * travessão) — mas isso fica dentro da conta, não aparece como número lançado.
 */
export function comDerivadas(brutas: Record<string, number | string | null>): Record<string, number> {
  const saida: Record<string, number> = {}
  const paraConta: Record<string, number> = {}
  for (const m of METRICAS_LANCADAS) {
    const v = brutas?.[m.chave]
    const ausente = v === null || v === undefined || v === ''
    paraConta[m.chave] = ausente ? 0 : Number(v)
    if (!ausente) saida[m.chave] = Number(v)
  }
  for (const d of METRICAS_DERIVADAS) {
    const calculado = d.calcular(paraConta)
    if (calculado !== null && Number.isFinite(calculado)) saida[d.chave] = calculado
  }
  return saida
}

/**
 * Número do jeito que a pessoa digita no Brasil: "1.500,50" → 1500.5. Campo vazio devolve null,
 * que é diferente de zero — zero é um valor lançado, vazio é "não sei".
 */
export function numeroDigitado(texto: string | null | undefined): number | null {
  const limpo = String(texto ?? '').trim()
  if (!limpo) return null
  const n = Number(limpo.replace(/\./g, '').replace(',', '.'))
  return Number.isFinite(n) ? n : null
}

/**
 * Variação percentual entre dois períodos e se ela é boa ou ruim PRA AQUELA métrica.
 * Sem base de comparação (ou base zero), devolve null — não inventa "+100%".
 */
export function variacaoDaMetrica(
  chave: string,
  atual: number | null | undefined,
  anterior: number | null | undefined,
): { pct: number; boa: boolean } | null {
  if (atual === null || atual === undefined) return null
  if (anterior === null || anterior === undefined || anterior === 0) return null
  const pct = ((atual - anterior) / Math.abs(anterior)) * 100
  const subirEhBom = TODAS_METRICAS.find((m) => m.chave === chave)?.subirEhBom !== false
  return { pct, boa: pct === 0 ? true : pct > 0 === subirEhBom }
}

/**
 * Confere se os números lançados fazem sentido entre si. Devolve a lista de avisos (vazia = tudo
 * coerente). É AVISO, não bloqueio: existem casos legítimos (lead que veio de outra origem, venda
 * de lead de meses atrás), e travar o salvamento faria a pessoa digitar número falso pra passar.
 *
 * Só compara pares em que os DOIS lados foram preenchidos — campo vazio é "não sei", e não dá pra
 * dizer que "leads > cliques" se ninguém lançou os cliques.
 */
export function validarMetricas(valores: Record<string, number | null | undefined>): string[] {
  const avisos: string[] = []
  const v = (chave: string): number | null => {
    const x = valores[chave]
    return x === null || x === undefined || Number.isNaN(x) ? null : x
  }
  const { impressoes, cliques, leads, vendas } = {
    impressoes: v('impressoes'), cliques: v('cliques'), leads: v('leads'), vendas: v('vendas'),
  }

  if (impressoes !== null && cliques !== null && cliques > impressoes) {
    // CTR acima de 100% é a mesma contradição vista de outro ângulo: um aviso só, com os dois nomes.
    const ctr = impressoes > 0 ? (cliques / impressoes) * 100 : null
    avisos.push(
      `Cliques (${cliques.toLocaleString('pt-BR')}) maior que impressões (${impressoes.toLocaleString('pt-BR')})` +
        (ctr !== null ? ` — o CTR ficaria em ${ctr.toLocaleString('pt-BR', { maximumFractionDigits: 0 })}%` : ''),
    )
  }
  if (cliques !== null && leads !== null && leads > cliques) {
    avisos.push(
      `Leads (${leads.toLocaleString('pt-BR')}) maior que cliques (${cliques.toLocaleString('pt-BR')})`,
    )
  }
  if (leads !== null && vendas !== null && vendas > leads) {
    avisos.push(
      `Vendas (${vendas.toLocaleString('pt-BR')}) maior que leads (${leads.toLocaleString('pt-BR')})`,
    )
  }
  return avisos
}

/** Primeiro e último dia do mês 'YYYY-MM', do jeito que `gc_metricas` guarda o período. */
export function limitesDoMes(periodo: string): { inicio: string; fim: string } {
  const [ano, mes] = periodo.split('-').map(Number)
  const ultimo = new Date(ano, mes, 0).getDate()
  return { inicio: `${periodo}-01`, fim: `${periodo}-${String(ultimo).padStart(2, '0')}` }
}

/** 'YYYY-MM' → 'Outubro de 2026'. */
export function mesPorExtenso(periodo: string): string {
  const [ano, mes] = periodo.split('-').map(Number)
  const nome = new Date(ano, mes - 1, 1).toLocaleDateString('pt-BR', { month: 'long' })
  return `${nome[0].toUpperCase()}${nome.slice(1)} de ${ano}`
}

/** Mês atual em 'YYYY-MM'. */
export function mesAtual(): string {
  const agora = new Date()
  return `${agora.getFullYear()}-${String(agora.getMonth() + 1).padStart(2, '0')}`
}

/** Anda `passos` meses a partir de 'YYYY-MM' (negativo volta). */
export function somarMeses(periodo: string, passos: number): string {
  const [ano, mes] = periodo.split('-').map(Number)
  const d = new Date(ano, mes - 1 + passos, 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}
