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

/**
 * As métricas do planejamento, na ordem em que aparecem na grade: as quatro DIGITADAS primeiro, depois
 * as duas CALCULADAS (CPL = investimento ÷ leads; ROAS = faturamento ÷ investimento).
 */
export type ChavePlano = 'leads' | 'vendas' | 'investimento' | 'receita' | 'cpl' | 'roas'
export const CHAVES_DIGITADAS: { chave: ChavePlano; label: string }[] = [
  { chave: 'leads', label: 'Leads' },
  { chave: 'vendas', label: 'Vendas' },
  { chave: 'investimento', label: 'Investimento' },
  // O catálogo de métricas chama de "receita" o que aqui o time chama de faturamento.
  { chave: 'receita', label: 'Faturamento' },
]
export const CHAVES_CALCULADAS: { chave: ChavePlano; label: string }[] = [
  { chave: 'cpl', label: 'CPL' },
  { chave: 'roas', label: 'ROAS' },
]
export const CHAVES_PLANO: { chave: ChavePlano; label: string }[] = [...CHAVES_DIGITADAS, ...CHAVES_CALCULADAS]

/** A curva é sempre linear: o seletor linear/composta saiu da tela (o cálculo composto segue disponível). */
export type Curva = 'linear' | 'composta'
export type MetasPlano = Partial<Record<ChavePlano, number>>

/**
 * Os números do diagnóstico. Null = não informado, que é diferente de zero. Quatro são DIGITADOS
 * (leads, investimento, vendas, faturamento); ticket e conversão saem deles em `montarPontoA`.
 */
export interface PontoA {
  leads: number | null
  investimento: number | null
  vendas: number | null
  receita: number | null
  /** Calculado: faturamento ÷ vendas. */
  ticket: number | null
  /** Calculada, em percentual: vendas ÷ leads × 100 (8 = 8% dos leads viram venda). */
  conversao: number | null
}

const arredonda2 = (n: number) => Math.round(n * 100) / 100

/** Monta o ponto A a partir dos 4 números digitados, calculando ticket e conversão quando dá. */
export function montarPontoA(d: {
  leads: number | null
  investimento: number | null
  vendas: number | null
  receita: number | null
}): PontoA {
  return {
    ...d,
    ticket: d.receita !== null && d.vendas ? arredonda2(d.receita / d.vendas) : null,
    conversao: d.vendas !== null && d.leads ? arredonda2((d.vendas / d.leads) * 100) : null,
  }
}

/**
 * CPL e ROAS de um conjunto de números: são CONTAS, não metas digitadas. O que veio gravado pra essas
 * duas chaves é descartado — guardar o número duplicaria a conta e deixaria os três divergirem.
 */
export function comMetasCalculadas(m: MetasPlano): MetasPlano {
  const { cpl: _cpl, roas: _roas, ...digitadas } = m
  const saida: MetasPlano = { ...digitadas }
  if (m.investimento !== undefined && m.leads) saida.cpl = m.investimento / m.leads
  if (m.receita !== undefined && m.investimento) saida.roas = m.receita / m.investimento
  return saida
}

export interface Planejamento {
  curva: Curva
  /** 'YYYY-MM-DD'. Sem ela não há como saber de que mês a rota começa. */
  dataDiagnostico: string | null
  atual: PontoA
  metas: Record<HorizontePlano, MetasPlano>
  /**
   * Ponto de partida de uma métrica QUANDO O PONTO A NÃO TEM o número: o valor do primeiro mês lançado
   * em Métricas. Só serve pra traçar a rota; não é ponto A e não aparece como tal.
   */
  partida?: MetasPlano
}

/** Quanto o realizado pode se afastar do projetado e ainda contar como "no caminho". */
export const TOLERANCIA_NO_CAMINHO = 0.1

/** O valor de cada métrica no ponto A. CPL, vendas e ROAS saem das contas, não são digitados. */
export function baseDoPontoA(a: PontoA): MetasPlano {
  const base: MetasPlano = {}
  if (a.leads !== null) base.leads = a.leads
  if (a.investimento !== null) base.investimento = a.investimento
  if (a.vendas !== null) base.vendas = a.vendas
  if (a.receita !== null) base.receita = a.receita
  return comMetasCalculadas(base)
}

/** Tem algum número do ponto A preenchido? */
export function temPontoA(a: PontoA): boolean {
  return a.leads !== null || a.investimento !== null || a.vendas !== null || a.receita !== null
}

/** Hoje, 'YYYY-MM-DD', no relógio da pessoa. */
export function hojeISO(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/**
 * Sem Ponto A, a projeção parte do PRIMEIRO MÊS LANÇADO em Métricas: ele dá a data de início da rota
 * (quando não há data do diagnóstico) e o valor de partida das métricas que o ponto A não tem. Sem
 * nenhum mês lançado, a rota não existe — e a tela só diz pra lançar o primeiro mês.
 */
export function comPartidaDasMetricas(
  plano: Planejamento,
  realizado: Record<string, Record<string, number>>,
): Planejamento {
  const meses = Object.keys(realizado).sort()
  const primeiro = meses[0]
  if (!primeiro) return plano
  return {
    ...plano,
    dataDiagnostico: plano.dataDiagnostico ?? `${primeiro}-01`,
    partida: realizado[primeiro],
  }
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
  const a = baseDoPontoA(plano.atual)[chave] ?? plano.partida?.[chave]

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
  /** 'atencao' = a conta pede uma explicação; 'info' = pra saber. */
  nivel: 'atencao' | 'info'
  titulo: string
  texto: string
}

const reais = (v: number) => formatarMetrica(v, 'reais')
const inteiro = (v: number) => formatarMetrica(v, 'inteiro')
const MARGEM = 0.1

/**
 * Confere se as metas fecham ENTRE SI, a partir do que o cliente faz hoje. É AVISO, nunca bloqueio:
 * quem planejou sabe coisas que a conta não sabe.
 *
 * O que se confere aqui: leads que não sustentam as vendas (na conversão de hoje) e vendas × ticket que
 * não bate com o faturamento. O custo por lead que a meta implica NÃO entra aqui — tem aviso próprio,
 * `avisosDeCplImplicito`, pra a mesma conta não aparecer duas vezes.
 */
export function validarRealismo(plano: Planejamento): AvisoDeRealismo[] {
  const avisos: AvisoDeRealismo[] = []
  const a = plano.atual
  const conv = a.conversao && a.conversao > 0 ? a.conversao / 100 : null

  for (const h of HORIZONTES_PLANO) {
    const m = plano.metas[h.valor] ?? {}
    if (Object.keys(m).length === 0) continue
    const rotulo = `Meta de ${h.label}`

    const leadsParaVendas = m.vendas && conv ? m.vendas / conv : null
    if (leadsParaVendas !== null && m.leads !== undefined && m.leads < leadsParaVendas * (1 - MARGEM)) {
      avisos.push({
        horizonte: h.valor, nivel: 'atencao', titulo: `${rotulo}: leads não sustentam as vendas`,
        texto: `Com a conversão de hoje (${(a.conversao ?? 0).toLocaleString('pt-BR')}%), ${inteiro(m.vendas!)} vendas ` +
          `pedem cerca de ${inteiro(leadsParaVendas)} leads, e a meta de leads é ${inteiro(m.leads)}. ` +
          `Ou a meta de leads sobe, ou a meta supõe uma conversão melhor que a atual.`,
      })
    }

    const longe = (calculado: number, declarado: number) => declarado !== 0 && Math.abs(calculado - declarado) / declarado > 0.15
    if (m.vendas !== undefined && a.ticket && m.receita !== undefined && longe(m.vendas * a.ticket, m.receita)) {
      avisos.push({
        horizonte: h.valor, nivel: 'atencao', titulo: `${rotulo}: vendas × ticket não bate com o faturamento`,
        texto: `${inteiro(m.vendas)} vendas com o ticket de hoje (${reais(a.ticket)}) dão ${reais(m.vendas * a.ticket)}, ` +
          `e o faturamento previsto é ${reais(m.receita)}. Ou o ticket sobe, ou a meta de faturamento está fora.`,
      })
    }
  }
  return avisos
}

export interface AvisoDeCpl {
  horizonte: HorizontePlano
  cplHoje: number
  cplMeta: number
  /** Variação do CPL da meta contra o de hoje, em %. Negativa = o CPL cai. */
  variacaoPct: number
  texto: string
}

/** O CPL da meta pode cair até 50% (ou subir até 100%) sem pedir explicação. */
export const LIMITE_QUEDA_CPL = 0.5
export const LIMITE_ALTA_CPL = 1

/**
 * O CPL IMPLÍCITO da meta (investimento ÷ leads) está muito fora do CPL do ponto A? Queda maior que
 * 50% (ou alta maior que 100%) pede uma explicação — e a explicação é o texto de "Estratégia e
 * premissas" do horizonte. Com ele escrito, o aviso some: a premissa existe, não cabe cobrar de novo.
 * Aviso discreto, não bloqueia nada.
 */
export function avisosDeCplImplicito(
  plano: Planejamento,
  estrategiaEscrita: Record<HorizontePlano, string>,
): AvisoDeCpl[] {
  const a = plano.atual
  if (!a.leads || a.investimento === null) return []
  const cplHoje = a.investimento / a.leads
  if (!(cplHoje > 0)) return []
  const saida: AvisoDeCpl[] = []
  for (const h of HORIZONTES_PLANO) {
    const m = plano.metas[h.valor] ?? {}
    if (!m.leads || m.investimento === undefined) continue
    if (estrategiaEscrita[h.valor].trim() !== '') continue
    const cplMeta = m.investimento / m.leads
    const variacao = (cplMeta - cplHoje) / cplHoje
    if (variacao < -LIMITE_QUEDA_CPL) {
      saida.push({
        horizonte: h.valor, cplHoje, cplMeta, variacaoPct: variacao * 100,
        texto: `Meta de ${h.label}: o CPL implícito é ${reais(cplMeta)}, ${Math.abs(Math.round(variacao * 100))}% abaixo ` +
          `dos ${reais(cplHoje)} de hoje. Vale escrever em "Estratégia e premissas" o que vai derrubar o CPL.`,
      })
    } else if (variacao > LIMITE_ALTA_CPL) {
      saida.push({
        horizonte: h.valor, cplHoje, cplMeta, variacaoPct: variacao * 100,
        texto: `Meta de ${h.label}: o CPL implícito é ${reais(cplMeta)}, ${Math.round(variacao * 100)}% acima ` +
          `dos ${reais(cplHoje)} de hoje. Confira se o investimento ou os leads estão certos.`,
      })
    }
  }
  return saida
}

/** Variação de um valor contra o ponto A, em %. Null sem ponto A (ou com ponto A zero). */
export function variacaoContraPontoA(
  chave: ChavePlano,
  valor: number | undefined,
  pontoA: number | undefined,
): { pct: number; boa: boolean | null } | null {
  if (valor === undefined) return null
  const v = variacaoDaMetrica(chave, valor, pontoA)
  if (!v) return null
  // Investimento maior ou menor não é "bom" nem "ruim" por si: fica sem cor.
  return { pct: v.pct, boa: chave === 'investimento' ? null : v.boa }
}

/** Tem alguma META de 6 ou 12 meses? É o que o semáforo compara com o realizado. */
export function temPlanejamento(plano: Planejamento | null | undefined): plano is Planejamento {
  if (!plano) return false
  return HORIZONTES_PLANO.some((h) => Object.keys(plano.metas[h.valor] ?? {}).length > 0)
}

/** Tem QUALQUER número de planejamento: ponto A ou meta? Textos sozinhos não contam. */
export function temNumerosDePlanejamento(plano: Planejamento | null | undefined): boolean {
  if (!plano) return false
  return temPontoA(plano.atual) || temPlanejamento(plano)
}

/**
 * O estado do planejamento, em uma palavra:
 *  - 'definido'  : há número de planejamento;
 *  - 'a_definir' : nada preenchido ainda — estado NEUTRO, não é pendência nem risco;
 *  - 'atencao'   : nada preenchido E o lembrete de "completar em" já venceu. É o único caso em que
 *                  a falta de planejamento pede atenção.
 */
export type EstadoDoPlanejamento = 'definido' | 'a_definir' | 'atencao'
export function estadoDoPlanejamento(
  plano: Planejamento | null | undefined,
  lembrete: { aguardando?: boolean; lembrarEm?: string | null },
  hoje: string = hojeISO(),
): EstadoDoPlanejamento {
  if (temNumerosDePlanejamento(plano)) return 'definido'
  return lembreteVencido(lembrete, hoje) ? 'atencao' : 'a_definir'
}

/** O lembrete de completar o planejamento já venceu (a data é anterior a hoje)? */
export function lembreteVencido(
  lembrete: { aguardando?: boolean; lembrarEm?: string | null },
  hoje: string = hojeISO(),
): boolean {
  return !!lembrete.aguardando && !!lembrete.lembrarEm && lembrete.lembrarEm < hoje
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

// ---------------------------------------------------------------------------------------------------
// Ponto A a partir das métricas lançadas
// ---------------------------------------------------------------------------------------------------

export type CampoDoPontoA = 'leads' | 'investimento' | 'vendas' | 'receita'

export interface SugestaoDoPontoA {
  /** O valor sugerido e os meses cuja média o gerou. Ausente = não há dado pra calcular. */
  campos: Partial<Record<CampoDoPontoA, { valor: number; meses: string[] }>>
  /** Os meses considerados (os últimos lançados), do mais antigo ao mais recente. */
  meses: string[]
}

const arredonda = (n: number) => Math.round(n * 100) / 100

/**
 * Sugere o ponto A pela média dos últimos meses lançados (até 3).
 *
 *  - Só entram meses ANTERIORES ao corrente: o mês em andamento é parcial, e uma média com um mês
 *    pela metade subestimaria tudo.
 *  - "Últimos lançados" são os 3 meses mais recentes COM número, mesmo que não sejam seguidos: um
 *    mês sem lançamento no meio não pode fazer a média cair pra zero.
 *  - Cada campo usa só os meses em que ele existe; com 1 ou 2 meses usa o que houver.
 *  - Ticket e conversão não são sugeridos: saem de faturamento, vendas e leads depois de preenchidos.
 */
export function sugerirPontoA(
  linhas: { periodo_inicio: string; chave: string; valor: string | number }[],
  mesCorrente: string,
  quantos = 3,
): SugestaoDoPontoA {
  const porMes: Record<string, Record<string, number>> = {}
  for (const l of linhas) {
    const mes = String(l.periodo_inicio).slice(0, 7)
    const v = Number(l.valor)
    if (!Number.isFinite(v)) continue
    porMes[mes] = { ...(porMes[mes] ?? {}), [l.chave]: v }
  }
  const meses = Object.keys(porMes)
    .filter((m) => m < mesCorrente && ['leads', 'investimento', 'vendas', 'receita'].some((k) => porMes[m][k] !== undefined))
    .sort()
    .slice(-quantos)

  const campos: SugestaoDoPontoA['campos'] = {}
  const media = (chave: string) => {
    const usados = meses.filter((m) => porMes[m][chave] !== undefined)
    if (usados.length === 0) return null
    return { valor: arredonda(usados.reduce((s, m) => s + porMes[m][chave], 0) / usados.length), meses: usados }
  }
  for (const chave of ['leads', 'investimento', 'vendas', 'receita'] as const) {
    const m = media(chave)
    if (m) campos[chave] = m
  }
  return { campos, meses }
}

// ---------------------------------------------------------------------------------------------------
// Resumo de uma linha
// ---------------------------------------------------------------------------------------------------

// O Intl separa "R$" do número com espaço NÃO separável; num resumo que a pessoa copia e cola, espaço comum.
const brl0 = (v: number) =>
  v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 }).replace(/ /g, ' ')

/** "100 leads · R$ 6.400" — as duas métricas que contam a história: volume e faturamento. */
function trecho(m: MetasPlano): string | null {
  const partes: string[] = []
  if (m.leads !== undefined) partes.push(`${Math.round(m.leads).toLocaleString('pt-BR')} leads`)
  if (m.receita !== undefined) partes.push(brl0(m.receita))
  // Sem nenhuma das duas, o investimento é o que sobra pra dizer alguma coisa.
  if (partes.length === 0 && m.investimento !== undefined) partes.push(`${brl0(m.investimento)} de investimento`)
  return partes.length ? partes.join(' · ') : null
}

/** "Ponto A: 100 leads · R$ 6.400 → Meta 6m: 300 leads · … → Meta 12m: …". Null se não há nada. */
export function resumoLinha(plano: Planejamento): string | null {
  const partes: string[] = []
  const a = trecho(baseDoPontoA(plano.atual))
  if (a) partes.push(`Ponto A: ${a}`)
  const m6 = trecho(plano.metas['6_meses'] ?? {})
  if (m6) partes.push(`Meta 6m: ${m6}`)
  const m12 = trecho(plano.metas['12_meses'] ?? {})
  if (m12) partes.push(`Meta 12m: ${m12}`)
  return partes.length ? partes.join(' → ') : null
}

// ---------------------------------------------------------------------------------------------------
// Variáveis dos modelos de texto
// ---------------------------------------------------------------------------------------------------

/** As variáveis que um modelo pode usar, com o que cada uma é — pra mostrar na tela de gestão. */
export const VARIAVEIS_DE_MODELO: { nome: string; ajuda: string }[] = [
  { nome: 'cliente', ajuda: 'nome da empresa' },
  { nome: 'segmento', ajuda: 'segmento do cliente' },
  { nome: 'leads_hoje', ajuda: 'leads/mês do ponto A' },
  { nome: 'investimento_hoje', ajuda: 'investimento/mês do ponto A' },
  { nome: 'vendas_hoje', ajuda: 'vendas/mês do ponto A' },
  { nome: 'ticket_hoje', ajuda: 'ticket médio do ponto A (faturamento ÷ vendas)' },
  { nome: 'conversao_hoje', ajuda: 'conversão do ponto A em % (vendas ÷ leads)' },
  { nome: 'faturamento_hoje', ajuda: 'faturamento mensal do ponto A' },
  { nome: 'cpl_hoje', ajuda: 'CPL do ponto A (investimento ÷ leads)' },
  { nome: 'meta_leads_6m', ajuda: 'meta de leads em 6 meses (idem _12m)' },
  { nome: 'meta_faturamento_6m', ajuda: 'meta de faturamento em 6 meses (idem _12m)' },
  { nome: 'meta_investimento_6m', ajuda: 'meta de investimento em 6 meses (idem _12m)' },
]

const formatoNum = (v: number, casas = 0) =>
  v.toLocaleString('pt-BR', { minimumFractionDigits: casas, maximumFractionDigits: casas })

/** Os valores das variáveis, a partir do cliente e do planejamento. Só entra o que existe. */
export function contextoDeVariaveis(
  plano: Planejamento,
  cliente: { nome_empresa?: string | null; segmento?: string | null },
): Record<string, string> {
  const ctx: Record<string, string> = {}
  const base = baseDoPontoA(plano.atual)
  if (cliente.nome_empresa) ctx.cliente = cliente.nome_empresa
  if (cliente.segmento) ctx.segmento = cliente.segmento
  if (base.leads !== undefined) ctx.leads_hoje = formatoNum(base.leads)
  if (base.investimento !== undefined) ctx.investimento_hoje = formatoNum(base.investimento, 2)
  if (plano.atual.vendas !== null) ctx.vendas_hoje = formatoNum(plano.atual.vendas)
  if (plano.atual.ticket !== null) ctx.ticket_hoje = formatoNum(plano.atual.ticket, 2)
  if (plano.atual.conversao !== null) ctx.conversao_hoje = formatoNum(plano.atual.conversao, 1)
  if (base.receita !== undefined) ctx.faturamento_hoje = formatoNum(base.receita, 2)
  if (base.cpl !== undefined) ctx.cpl_hoje = formatoNum(base.cpl, 2)
  for (const h of HORIZONTES_PLANO) {
    const sufixo = `${h.meses}m`
    const m = plano.metas[h.valor] ?? {}
    if (m.leads !== undefined) ctx[`meta_leads_${sufixo}`] = formatoNum(m.leads)
    if (m.receita !== undefined) ctx[`meta_faturamento_${sufixo}`] = formatoNum(m.receita, 2)
    if (m.investimento !== undefined) ctx[`meta_investimento_${sufixo}`] = formatoNum(m.investimento, 2)
  }
  return ctx
}

/**
 * Troca {variavel} pelo valor, quando existe. Variável sem valor FICA no texto, visível: apagar
 * em silêncio deixaria "investe R$ /mês" e a pessoa nem notaria que faltou preencher o ponto A.
 */
export function aplicarVariaveis(texto: string, ctx: Record<string, string>): string {
  return texto.replace(/\{([a-z0-9_]+)\}/gi, (inteiro, nome: string) => (ctx[nome] !== undefined ? ctx[nome] : inteiro))
}
