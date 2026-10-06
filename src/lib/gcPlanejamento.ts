import { comDerivadas, formatarMetrica, variacaoDaMetrica } from '@/lib/gcMetricas'

/**
 * Planejamento do cliente (módulo "Clientes NX Digital"): o ponto A, as metas de 6 e 12 meses, a
 * rota mês a mês entre elas e a conferência de realismo.
 *
 * Tudo aqui é CÁLCULO PURO, sem tela e sem serviço: a mesma rota alimenta o editor, o gráfico, o
 * semáforo ("Metas combinadas") e o portal do cliente, e uma conta que mora em um lugar só é uma
 * conta que não diverge entre eles.
 */

export type HorizontePlano = '6_meses' | '12_meses'
export const HORIZONTES_PLANO: { valor: HorizontePlano; meses: number; label: string }[] = [
  { valor: '6_meses', meses: 6, label: '6 meses' },
  { valor: '12_meses', meses: 12, label: '12 meses' },
]

/** As métricas do planejamento, na ordem em que aparecem no editor. */
export type ChavePlano = 'leads' | 'cpl' | 'vendas' | 'roas' | 'receita' | 'investimento'
export const CHAVES_PLANO: { chave: ChavePlano; label: string }[] = [
  { chave: 'leads', label: 'Leads' },
  { chave: 'cpl', label: 'CPL' },
  { chave: 'vendas', label: 'Vendas' },
  { chave: 'roas', label: 'ROAS' },
  // O catálogo de métricas chama de "receita" o que aqui o time chama de faturamento.
  { chave: 'receita', label: 'Faturamento' },
  { chave: 'investimento', label: 'Investimento' },
]

export type Curva = 'linear' | 'composta'
export type MetasPlano = Partial<Record<ChavePlano, number>>

/** Os números fixos do diagnóstico. Null = não informado, que é diferente de zero. */
export interface PontoA {
  leads: number | null
  investimento: number | null
  ticket: number | null
  /** Em percentual: 8 = 8% dos leads viram venda. */
  conversao: number | null
  receita: number | null
}

export interface Planejamento {
  curva: Curva
  /** 'YYYY-MM-DD'. Sem ela não há como saber de que mês a rota começa. */
  dataDiagnostico: string | null
  atual: PontoA
  metas: Record<HorizontePlano, MetasPlano>
}

/** Quanto o realizado pode se afastar do projetado e ainda contar como "no caminho". */
export const TOLERANCIA_NO_CAMINHO = 0.1

/** O valor de cada métrica no ponto A. CPL, vendas e ROAS saem das contas, não são digitados. */
export function baseDoPontoA(a: PontoA): MetasPlano {
  const base: MetasPlano = {}
  if (a.leads !== null) base.leads = a.leads
  if (a.investimento !== null) base.investimento = a.investimento
  if (a.receita !== null) base.receita = a.receita
  if (a.leads && a.investimento !== null) base.cpl = a.investimento / a.leads
  if (a.leads !== null && a.conversao !== null) base.vendas = (a.leads * a.conversao) / 100
  if (a.investimento && a.receita !== null) base.roas = a.receita / a.investimento
  return base
}

// ---------------------------------------------------------------------------------------------------
// Rota mês a mês
// ---------------------------------------------------------------------------------------------------

/**
 * O valor no mês `k` de um trecho que vai de `de` (em k=0) até `ate` (em k=`total`).
 *
 * LINEAR soma o mesmo tanto todo mês. COMPOSTA cresce a mesma PERCENTAGEM todo mês, que é como
 * tráfego costuma se comportar (cada mês melhora em cima do anterior). A composta só existe com os
 * dois extremos positivos — não há taxa de crescimento a partir de zero nem de valor negativo —,
 * e nesses casos cai na linear em vez de devolver NaN.
 */
export function interpolar(de: number, ate: number, k: number, total: number, curva: Curva): number {
  if (total <= 0) return ate
  const fracao = Math.max(0, Math.min(1, k / total))
  if (curva === 'composta' && de > 0 && ate > 0) return de * Math.pow(ate / de, fracao)
  return de + (ate - de) * fracao
}

/** 'YYYY-MM' do mês `k` meses depois do diagnóstico. */
export function mesDoIndice(dataDiagnostico: string, k: number): string {
  const [ano, mes] = dataDiagnostico.slice(0, 10).split('-').map(Number)
  const d = new Date(Date.UTC(ano, mes - 1 + k, 1))
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
}

/** Quantos meses o `periodo` ('YYYY-MM') está depois do mês do diagnóstico. Negativo = antes. */
export function indiceDoMes(dataDiagnostico: string, periodo: string): number {
  const [a1, m1] = dataDiagnostico.slice(0, 10).split('-').map(Number)
  const [a2, m2] = periodo.split('-').map(Number)
  return (a2 - a1) * 12 + (m2 - m1)
}

export interface PontoDaRota {
  /** Meses depois do diagnóstico (0 = o mês do diagnóstico, o ponto A). */
  k: number
  mes: string
  alvo: number
}

/**
 * A rota PROJETADA de uma métrica: o valor-alvo de cada mês, do ponto A até a última meta.
 *
 * Com as duas metas, a rota é ENCADEADA — A → meta de 6 meses → meta de 12 meses. A meta de 6 meses
 * é um ponto de passagem do caminho até a de 12, e não duas linhas independentes saindo de A: se a
 * de 12 fosse interpolada direto de A, o alvo do 6º mês dela discordaria da própria meta de 6 meses
 * e o gráfico mostraria dois "projetados" diferentes pro mesmo mês. Com uma meta só, a rota é A →
 * essa meta, que é a leitura literal.
 *
 * Devolve [] quando não há como traçar: sem data de diagnóstico, ou com menos de dois pontos.
 */
export function rotaProjetada(plano: Planejamento, chave: ChavePlano): PontoDaRota[] {
  if (!plano.dataDiagnostico) return []
  const a = baseDoPontoA(plano.atual)[chave]

  const pontos: { k: number; valor: number }[] = []
  if (a !== undefined) pontos.push({ k: 0, valor: a })
  for (const h of HORIZONTES_PLANO) {
    const m = plano.metas[h.valor]?.[chave]
    if (m !== undefined) pontos.push({ k: h.meses, valor: m })
  }
  if (pontos.length < 2) return []

  const rota: PontoDaRota[] = []
  for (let i = 0; i < pontos.length - 1; i++) {
    const de = pontos[i]
    const ate = pontos[i + 1]
    for (let k = de.k; k <= ate.k; k++) {
      // O ponto de junção entre dois trechos já foi emitido pelo trecho anterior.
      if (i > 0 && k === de.k) continue
      rota.push({
        k,
        mes: mesDoIndice(plano.dataDiagnostico, k),
        alvo: interpolar(de.valor, ate.valor, k - de.k, ate.k - de.k, plano.curva),
      })
    }
  }
  return rota
}

/** O alvo de UM mês ('YYYY-MM'), ou null se a rota não cobre esse mês. */
export function projetadoDoMes(plano: Planejamento, chave: ChavePlano, periodo: string): number | null {
  const ponto = rotaProjetada(plano, chave).find((p) => p.mes === periodo)
  return ponto ? ponto.alvo : null
}

// ---------------------------------------------------------------------------------------------------
// Realizado × projetado
// ---------------------------------------------------------------------------------------------------

export type SituacaoDoMes = 'no_caminho' | 'acima' | 'abaixo' | 'sem_lancamento' | 'a_vir'

export interface LinhaDaProjecao {
  mes: string
  k: number
  projetado: number
  realizado: number | null
  /** realizado − projetado. Null sem realizado. */
  desvio: number | null
  /** O desvio em % do projetado. Null sem realizado ou com projetado zero. */
  desvioPct: number | null
  situacao: SituacaoDoMes
  /**
   * O desvio é bom ou ruim PRA ESSA MÉTRICA? Acima em leads é bom; acima em CPL é ruim; em
   * investimento não é nem uma coisa nem outra (gastar mais que o previsto não é "resultado").
   */
  boa: boolean | null
}

type MetricasDoMes = Record<string, Record<string, number>>

/**
 * Agrupa as métricas lançadas por mês, já com as derivadas (CPL, ROAS) calculadas. `linhas` é o que
 * a API devolve: uma linha por métrica lançada.
 */
export function realizadoPorMes(
  linhas: { periodo_inicio: string; chave: string; valor: string | number }[],
): MetricasDoMes {
  const brutas: Record<string, Record<string, number>> = {}
  for (const l of linhas) {
    const mes = String(l.periodo_inicio).slice(0, 7)
    brutas[mes] = { ...(brutas[mes] ?? {}), [l.chave]: Number(l.valor) }
  }
  const saida: MetricasDoMes = {}
  for (const [mes, valores] of Object.entries(brutas)) saida[mes] = comDerivadas(valores)
  return saida
}

/**
 * A projeção de uma métrica, mês a mês, contra o que já foi lançado.
 *
 * "No caminho" é estar a menos de 10% do projetado, pra cima ou pra baixo; além disso é "acima" ou
 * "abaixo". Mês futuro é "a vir" e mês passado sem número é "sem lançamento" — não é "abaixo", porque
 * ninguém sabe o que aconteceu, e chamar de abaixo seria acusar um mês que simplesmente não foi
 * preenchido.
 */
export function projecaoMensal(
  plano: Planejamento,
  chave: ChavePlano,
  realizado: MetricasDoMes,
  mesCorrente: string,
): LinhaDaProjecao[] {
  return rotaProjetada(plano, chave).map((p) => {
    const r = realizado[p.mes]?.[chave]
    if (r === undefined) {
      return {
        mes: p.mes, k: p.k, projetado: p.alvo, realizado: null, desvio: null, desvioPct: null,
        situacao: p.mes > mesCorrente ? 'a_vir' : 'sem_lancamento', boa: null,
      }
    }
    const desvio = r - p.alvo
    const desvioPct = p.alvo !== 0 ? (desvio / Math.abs(p.alvo)) * 100 : null
    const situacao: SituacaoDoMes =
      desvioPct === null || Math.abs(desvioPct) <= TOLERANCIA_NO_CAMINHO * 100
        ? 'no_caminho'
        : desvioPct > 0
          ? 'acima'
          : 'abaixo'
    // Reaproveita a regra de "subir é bom?" do catálogo (CPL e CAC são o contrário).
    const direcao = variacaoDaMetrica(chave, p.alvo + (desvio || 0), p.alvo)
    let boa: boolean | null
    if (chave === 'investimento') boa = null
    else if (situacao === 'no_caminho') boa = true
    else boa = direcao ? direcao.boa : null
    return { mes: p.mes, k: p.k, projetado: p.alvo, realizado: r, desvio, desvioPct, situacao, boa }
  })
}

// ---------------------------------------------------------------------------------------------------
// Realismo
// ---------------------------------------------------------------------------------------------------

export interface AvisoDeRealismo {
  horizonte: HorizontePlano
  /** 'alerta' = a conta não fecha; 'atencao' = só fecha com uma condição; 'info' = pra saber. */
  nivel: 'alerta' | 'atencao' | 'info'
  titulo: string
  texto: string
  /** Quanto de investimento mensal a meta pede, quando o aviso é sobre isso. */
  investimentoNecessario?: number
}

const reais = (v: number) => formatarMetrica(v, 'reais')
const inteiro = (v: number) => formatarMetrica(v, 'inteiro')
const MARGEM = 0.1

/**
 * Confere se o cenário é realista a partir do que o próprio cliente faz HOJE.
 *
 * A pergunta central: pra chegar na meta de leads/vendas com o CPL e a conversão de partida, quanto
 * precisa investir? Se a premissa de investimento do cenário é menor que isso, a meta não fecha — e
 * isso é melhor descobrir ao desenhar o plano do que no terceiro mês, quando o realizado já estiver
 * "abaixo". Vira AVISO, não bloqueio: a premissa pode ser "o CPL vai cair com criativo novo", e quem
 * planejou sabe disso melhor que a conta.
 *
 * A conta usa o CPL de partida (conservador) e, se o cenário prevê um CPL melhor, também esse (o
 * otimista): fechar só com o CPL melhorando é um aviso de atenção, não de alerta.
 */
export function validarRealismo(plano: Planejamento): AvisoDeRealismo[] {
  const avisos: AvisoDeRealismo[] = []
  const a = plano.atual
  const cplA = a.leads && a.investimento !== null ? a.investimento / a.leads : null
  const conv = a.conversao && a.conversao > 0 ? a.conversao / 100 : null

  for (const h of HORIZONTES_PLANO) {
    const m = plano.metas[h.valor] ?? {}
    if (Object.keys(m).length === 0) continue
    const rotulo = `Cenário de ${h.label}`

    // Quantos leads a meta realmente exige: a de leads, ou os que as vendas pedem na conversão de hoje.
    const leadsParaVendas = m.vendas && conv ? m.vendas / conv : null
    if (leadsParaVendas !== null && m.leads !== undefined && m.leads < leadsParaVendas * (1 - MARGEM)) {
      avisos.push({
        horizonte: h.valor, nivel: 'atencao', titulo: `${rotulo}: leads não sustentam as vendas`,
        texto: `Com a conversão de hoje (${(a.conversao ?? 0).toLocaleString('pt-BR')}%), ${inteiro(m.vendas!)} vendas ` +
          `pedem cerca de ${inteiro(leadsParaVendas)} leads, e a meta de leads é ${inteiro(m.leads)}. ` +
          `Ou a meta de leads sobe, ou o cenário supõe uma conversão melhor que a atual.`,
      })
    }
    const leadsNecessarios = Math.max(m.leads ?? 0, leadsParaVendas ?? 0)

    if (leadsNecessarios > 0 && cplA !== null) {
      const comCplDeHoje = leadsNecessarios * cplA
      const comCplDaMeta = m.cpl !== undefined ? leadsNecessarios * m.cpl : null
      const referencia = comCplDaMeta ?? comCplDeHoje
      const alvoDe = m.leads !== undefined && m.leads >= (leadsParaVendas ?? 0) ? `${inteiro(m.leads)} leads` : `${inteiro(m.vendas ?? 0)} vendas`

      if (m.investimento !== undefined) {
        if (m.investimento < referencia * (1 - MARGEM)) {
          avisos.push({
            horizonte: h.valor, nivel: 'alerta', investimentoNecessario: referencia,
            titulo: `${rotulo}: o investimento previsto não fecha a conta`,
            texto: `Pra chegar em ${alvoDe} com CPL de ${reais(comCplDaMeta !== null ? m.cpl! : cplA)}` +
              `${comCplDaMeta !== null ? ' (o da meta)' : ' (o de hoje)'}, o investimento teria de ser ` +
              `de cerca de ${reais(referencia)}/mês — o cenário prevê ${reais(m.investimento)}.`,
          })
        } else if (comCplDaMeta !== null && m.investimento < comCplDeHoje * (1 - MARGEM)) {
          avisos.push({
            horizonte: h.valor, nivel: 'atencao', investimentoNecessario: comCplDeHoje,
            titulo: `${rotulo}: só fecha se o CPL cair`,
            texto: `Com o CPL de hoje (${reais(cplA)}), ${alvoDe} custariam cerca de ${reais(comCplDeHoje)}/mês. ` +
              `O investimento previsto (${reais(m.investimento)}) só basta se o CPL cair pra ${reais(m.cpl!)}. ` +
              `Vale registrar nas premissas o que vai derrubar o CPL.`,
          })
        } else if (m.investimento > referencia * 1.5) {
          avisos.push({
            horizonte: h.valor, nivel: 'info', investimentoNecessario: referencia,
            titulo: `${rotulo}: investimento acima do necessário`,
            texto: `O investimento previsto (${reais(m.investimento)}) é ` +
              `${Math.round((m.investimento / referencia - 1) * 100)}% maior que o necessário pra ${alvoDe} ` +
              `(cerca de ${reais(referencia)}/mês). Ou a meta está baixa pro orçamento, ou sobra verba.`,
          })
        }
      } else {
        avisos.push({
          horizonte: h.valor, nivel: 'info', investimentoNecessario: referencia,
          titulo: `${rotulo}: falta a premissa de investimento`,
          texto: `Pra chegar em ${alvoDe} com o CPL ${comCplDaMeta !== null ? 'da meta' : 'de hoje'}, são cerca de ` +
            `${reais(referencia)}/mês. Preencha o investimento do cenário pra conferir se o orçamento comporta.`,
        })
      }
    }

    // Coerência entre as próprias metas do cenário.
    const longe = (calculado: number, declarado: number) => Math.abs(calculado - declarado) / declarado > 0.15
    if (m.cpl !== undefined && m.leads !== undefined && m.investimento !== undefined && longe(m.cpl * m.leads, m.investimento)) {
      avisos.push({
        horizonte: h.valor, nivel: 'atencao', titulo: `${rotulo}: CPL × leads não bate com o investimento`,
        texto: `${reais(m.cpl)} × ${inteiro(m.leads)} leads dá ${reais(m.cpl * m.leads)}, e o investimento previsto é ${reais(m.investimento)}.`,
      })
    }
    if (m.roas !== undefined && m.investimento !== undefined && m.receita !== undefined && longe(m.roas * m.investimento, m.receita)) {
      avisos.push({
        horizonte: h.valor, nivel: 'atencao', titulo: `${rotulo}: ROAS × investimento não bate com o faturamento`,
        texto: `ROAS ${m.roas.toLocaleString('pt-BR')}x sobre ${reais(m.investimento)} dá ${reais(m.roas * m.investimento)}, ` +
          `e o faturamento previsto é ${reais(m.receita)}.`,
      })
    }
    if (m.vendas !== undefined && a.ticket && m.receita !== undefined && longe(m.vendas * a.ticket, m.receita)) {
      avisos.push({
        horizonte: h.valor, nivel: 'atencao', titulo: `${rotulo}: vendas × ticket não bate com o faturamento`,
        texto: `${inteiro(m.vendas)} vendas com o ticket de hoje (${reais(a.ticket)}) dão ${reais(m.vendas * a.ticket)}, ` +
          `e o faturamento previsto é ${reais(m.receita)}. Ou o ticket sobe, ou a meta de faturamento está fora.`,
      })
    }
  }

  if (cplA === null && HORIZONTES_PLANO.some((h) => Object.keys(plano.metas[h.valor] ?? {}).length > 0)) {
    avisos.unshift({
      horizonte: '6_meses', nivel: 'info', titulo: 'Sem leads e investimento de partida',
      texto: 'Preencha leads e investimento do ponto A pra o painel conferir se o orçamento dos cenários comporta as metas.',
    })
  }

  const ordem = { alerta: 0, atencao: 1, info: 2 }
  return avisos.sort((x, y) => ordem[x.nivel] - ordem[y.nivel])
}

/** Tem algum número de planejamento a considerar (metas de 6/12 meses ou ponto A)? */
export function temPlanejamento(plano: Planejamento | null | undefined): plano is Planejamento {
  if (!plano) return false
  return HORIZONTES_PLANO.some((h) => Object.keys(plano.metas[h.valor] ?? {}).length > 0)
}

// ---------------------------------------------------------------------------------------------------
// O mês contra a rota — pra "Metas combinadas" do semáforo
// ---------------------------------------------------------------------------------------------------

export interface AvaliacaoDaRota {
  chave: ChavePlano
  label: string
  projetado: number
  realizado: number
  desvioPct: number
  /** O desvio é bom ou ruim pra essa métrica (CPL acima é ruim)? Null = nem um nem outro. */
  boa: boolean | null
  /** O mês está depois do fim da rota: vale a meta final, que é onde o cliente deveria estar. */
  alemDaRota: boolean
}

/**
 * Compara o realizado de UM mês com o projetado da rota, métrica a métrica.
 *
 * Fora: investimento (gastar diferente do previsto não é resultado bom nem ruim, e puxaria o
 * semáforo por um motivo que não é "o cliente não está indo bem") e o que não tem rota.
 *
 * Antes do mês do diagnóstico não há o que comparar. Depois do fim da rota (mais de 12 meses) vale a
 * meta final: o plano acabou e a meta continua sendo onde o cliente deveria estar.
 */
export function avaliarMesContraRota(
  plano: Planejamento,
  realizadoDoMes: Record<string, number>,
  periodo: string,
): AvaliacaoDaRota[] {
  const saida: AvaliacaoDaRota[] = []
  for (const { chave, label } of CHAVES_PLANO) {
    if (chave === 'investimento') continue
    const rota = rotaProjetada(plano, chave)
    const r = realizadoDoMes[chave]
    if (rota.length === 0 || r === undefined) continue
    const doMes = rota.find((p) => p.mes === periodo)
    const depois = periodo > rota[rota.length - 1].mes
    if (!doMes && !depois) continue
    const projetado = doMes ? doMes.alvo : rota[rota.length - 1].alvo
    if (projetado === 0) continue
    const desvioPct = ((r - projetado) / Math.abs(projetado)) * 100
    const direcao = variacaoDaMetrica(chave, r, projetado)
    saida.push({
      chave, label, projetado, realizado: r, desvioPct,
      boa: Math.abs(desvioPct) <= TOLERANCIA_NO_CAMINHO * 100 ? true : (direcao ? direcao.boa : null),
      alemDaRota: !doMes,
    })
  }
  return saida
}
