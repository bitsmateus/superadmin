import * as React from 'react'
import { AlertTriangle, Calculator, ChevronDown, Loader2, Lock, Route, Target } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/Button'
import { Input, Textarea } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
import { Modal } from '@/components/ui/Modal'
import { CampoData } from '@/components/gestaoClientes/CampoData'
import { GraficoProjecao, TabelaProjecao } from '@/components/gestaoClientes/GraficoProjecao'
import { MenuModelos, ModalModelosTexto, type AlvoDeModelo } from '@/components/gestaoClientes/ModelosDeTexto'
import { PastilhaSaude } from '@/components/gestaoClientes/Semaforo'
import {
  gestaoClientes,
  type GcCampoModelo, type GcHistoricoPlanejamento, type GcMetrica, type GcModeloTexto,
  type GcOrigemCampo, type GcPlanejamentoApi, type GcPlanejamentoEntrada,
} from '@/services/gestaoClientes'
import {
  CHAVES_CALCULADAS, CHAVES_DIGITADAS, CHAVES_PLANO, HORIZONTES_PLANO, aplicarVariaveis, avaliarMesContraRota,
  avisosDeCplImplicito, baseDoPontoA, comMetasCalculadas, comPartidaDasMetricas, contextoDeVariaveis,
  estadoDoPlanejamento, hojeISO, montarPontoA, projecaoMensal, realizadoPorMes, resumoLinha, rotaProjetada,
  sugerirPontoA, validarRealismo, variacaoContraPontoA, type CampoDoPontoA, type ChavePlano,
  type HorizontePlano, type Planejamento,
} from '@/lib/gcPlanejamento'
import { planoDaApi } from '@/lib/gcPlanoAdaptadores'
import { formatarMetrica, mesAtual, numeroDigitado, numeroParaCampo } from '@/lib/gcMetricas'
import { cn } from '@/lib/utils'

// ---------------------------------------------------------------------------------------------------
// O rascunho do editor: tudo em TEXTO, como a pessoa digita
// ---------------------------------------------------------------------------------------------------

/** Os quatro números do ponto A: nome no rascunho, nome na API e como aparece na tela. */
const CAMPOS_DO_A: { campo: CampoDoPontoA; api: string; label: string; ph: string }[] = [
  { campo: 'leads', api: 'leads_mes', label: 'Leads / mês', ph: '0' },
  { campo: 'investimento', api: 'investimento_mes', label: 'Investimento / mês (R$)', ph: '0,00' },
  { campo: 'vendas', api: 'vendas_mes', label: 'Vendas / mês', ph: '0' },
  { campo: 'receita', api: 'faturamento_mensal', label: 'Faturamento / mês (R$)', ph: '0,00' },
]

type ChaveDigitada = 'leads' | 'vendas' | 'investimento' | 'receita'

interface Rascunho {
  situacao: string
  leads: string
  investimento: string
  vendas: string
  receita: string
  /** Origem por campo da API (leads_mes...). Campo com número e sem entrada aqui conta como "informado". */
  origens: Record<string, GcOrigemCampo>
  data: string | null
  /** O ponto A está em branco de propósito: o cliente ainda vai trazer os números. */
  aguardando: boolean
  lembrarEm: string | null
  cenarios: Record<HorizontePlano, {
    objetivo: string
    /** "Estratégia e premissas": interna, nunca vai pro portal. */
    estrategia: string
    metas: Record<ChaveDigitada, string>
  }>
}

function vazioDeMetas(): Record<ChaveDigitada, string> {
  return { leads: '', vendas: '', investimento: '', receita: '' }
}

function doApi(a: GcPlanejamentoApi): Rascunho {
  const cen = (h: HorizontePlano) => {
    const c = a.cenarios[h]
    const metas = vazioDeMetas()
    for (const { chave } of CHAVES_DIGITADAS) metas[chave as ChaveDigitada] = numeroParaCampo(c?.metas?.[chave as ChaveDigitada])
    return { objetivo: c?.onde_quer_chegar ?? '', estrategia: c?.estrategia ?? '', metas }
  }
  return {
    situacao: a.atual.situacao_atual,
    leads: numeroParaCampo(a.atual.leads_mes),
    investimento: numeroParaCampo(a.atual.investimento_mes),
    vendas: numeroParaCampo(a.atual.vendas_mes),
    receita: numeroParaCampo(a.atual.faturamento_mensal),
    origens: a.origens ?? {},
    data: a.atual.data_diagnostico,
    aguardando: a.atual.aguardando_cliente,
    lembrarEm: a.atual.lembrar_em,
    cenarios: { '6_meses': cen('6_meses'), '12_meses': cen('12_meses') },
  }
}

/** O rascunho no formato do cálculo — é com ele que os avisos e a projeção reagem ao digitar. */
function planoDoRascunho(r: Rascunho): Planejamento {
  const metas = (h: HorizontePlano) => {
    const m: Partial<Record<ChavePlano, number>> = {}
    for (const { chave } of CHAVES_DIGITADAS) {
      const n = numeroDigitado(r.cenarios[h].metas[chave as ChaveDigitada])
      if (n !== null) m[chave] = n
    }
    return comMetasCalculadas(m)
  }
  return {
    curva: 'linear',
    dataDiagnostico: r.data,
    atual: montarPontoA({
      leads: numeroDigitado(r.leads),
      investimento: numeroDigitado(r.investimento),
      vendas: numeroDigitado(r.vendas),
      receita: numeroDigitado(r.receita),
    }),
    metas: { '6_meses': metas('6_meses'), '12_meses': metas('12_meses') },
  }
}

function paraEntrada(r: Rascunho): GcPlanejamentoEntrada {
  const plano = planoDoRascunho(r)
  const cen = (h: HorizontePlano) => ({
    onde_quer_chegar: r.cenarios[h].objetivo,
    estrategia: r.cenarios[h].estrategia,
    // Campo em branco vai como null: é o sinal de "apague essa meta".
    metas: Object.fromEntries(
      CHAVES_DIGITADAS.map(({ chave }) => [chave, numeroDigitado(r.cenarios[h].metas[chave as ChaveDigitada])]),
    ),
  })
  // Todo número do ponto A sai com origem: o que ninguém marcou como calculado é "informado".
  const origens: Record<string, GcOrigemCampo> = {}
  for (const c of CAMPOS_DO_A) {
    if (numeroDigitado(r[c.campo]) === null) continue
    origens[c.api] = r.origens[c.api] ?? { origem: 'informado' }
  }
  return {
    atual: {
      situacao_atual: r.situacao,
      leads_mes: plano.atual.leads,
      investimento_mes: plano.atual.investimento,
      vendas_mes: plano.atual.vendas,
      faturamento_mensal: plano.atual.receita,
      data_diagnostico: r.data,
      aguardando_cliente: r.aguardando,
      lembrar_em: r.aguardando ? r.lembrarEm : null,
    },
    origens,
    cenarios: { '6_meses': cen('6_meses'), '12_meses': cen('12_meses') },
  }
}

function textoDoValor(v: string | number | boolean | null): string {
  if (v === null || v === '') return '—'
  if (typeof v === 'boolean') return v ? 'ligado' : 'desligado'
  const s = String(v)
  return s.length > 60 ? `${s.slice(0, 60)}…` : s
}

const NOMES_MES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez']
/** ['2026-06','2026-07','2026-08'] → "jun, jul, ago/26". */
function rotuloDosMeses(meses: string[] | undefined): string {
  if (!meses || meses.length === 0) return ''
  const nomes = meses.map((m) => NOMES_MES[Number(m.slice(5, 7)) - 1])
  return `${nomes.join(', ')}/${meses[meses.length - 1].slice(2, 4)}`
}

const dataBR = (iso: string) => iso.slice(0, 10).split('-').reverse().join('/')

const CHAVE_ABERTO = (id: string) => `gc:planejamento:aberto:${id}`

/** O prefixo de unidade que vai DENTRO do campo da grade. Leads e vendas não têm. */
const PREFIXO: Partial<Record<ChavePlano, string>> = { investimento: 'R$', receita: 'R$', cpl: 'R$', roas: 'x' }

/** O valor de uma linha calculada (CPL, ROAS) no formato da grade: sem o "R$" — ele já é o prefixo. */
function textoCalculado(chave: ChavePlano, v: number | undefined): string {
  if (v === undefined) return '—'
  return v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}
function textoDaBase(chave: ChavePlano, v: number | undefined): string {
  if (v === undefined) return '—'
  if (chave === 'leads' || chave === 'vendas') return formatarMetrica(v, 'inteiro')
  return `${PREFIXO[chave] ?? ''} ${textoCalculado(chave, v)}`.trim()
}

/** Variação contra o ponto A em texto pequeno: "+120%", ou "—" quando não há como comparar. */
function CelulaVariacao({ chave, valor, pontoA }: { chave: ChavePlano; valor: number | undefined; pontoA: number | undefined }) {
  const v = variacaoContraPontoA(chave, valor, pontoA)
  if (!v) return <span className="text-[11px] text-foreground/30">—</span>
  const pct = Math.round(v.pct)
  return (
    <span className={cn('text-[11px] tabular-nums', v.boa === true ? 'text-success' : 'text-foreground/50')}>
      {pct > 0 ? '+' : ''}
      {pct.toLocaleString('pt-BR')}%
    </span>
  )
}

/**
 * PLANEJAMENTO DO CLIENTE — o ponto A (onde o cliente está hoje), onde se quer chegar em 6 e 12
 * meses, a rota entre as duas pontas e a conferência das metas.
 *
 * TUDO é opcional. Salvar vazio, só com texto ou com parte dos números sempre funciona; sem número o
 * planejamento aparece como "A definir" (cinza, neutro), nunca como pendência ou erro. O bloco vem
 * recolhido: abre quando a pessoa pede (ou quando a Visão geral manda abrir) e a escolha fica lembrada.
 *
 * O ponto A tem quatro números digitados (leads, investimento, vendas e faturamento); ticket médio e
 * conversão saem deles. Na grade, só leads, vendas, investimento e faturamento são digitados: CPL e
 * ROAS são contas, mostradas em cinza.
 *
 * O ponto A pode ser PRÉ-PREENCHIDO com a média dos últimos meses lançados — só na primeira vez, num
 * planejamento que nunca foi salvo —, com a origem de cada número marcada ("calculado das métricas" ×
 * "informado"). É uma FOTO do diagnóstico, não um número que se atualiza.
 *
 * Os NÚMEROS das metas de 6 e 12 meses moram na mesma tabela de metas de sempre: o que se preenche
 * aqui aparece também em "Metas combinadas". As opções do portal ("Nossa jornada") ficam na aba
 * Relatórios, junto do link do portal.
 */
export function PlanejamentoCliente({
  clienteId,
  metricas,
  cliente,
  abrirQuando = 0,
  onMetasMudaram,
}: {
  clienteId: string
  metricas: GcMetrica[]
  /** Pra trocar {cliente} e {segmento} nos modelos de texto. */
  cliente?: { nome_empresa?: string | null; segmento?: string | null }
  /** Sobe quando algo de fora (a Visão geral) pede pra abrir o bloco. */
  abrirQuando?: number
  /** Chamado depois de salvar: as metas mudaram e a seção "Metas combinadas" precisa recarregar. */
  onMetasMudaram: () => Promise<void> | void
}) {
  const [api, setApi] = React.useState<GcPlanejamentoApi | null>(null)
  const [rascunho, setRascunho] = React.useState<Rascunho | null>(null)
  const [inicial, setInicial] = React.useState('')
  const [carregando, setCarregando] = React.useState(true)
  const [salvando, setSalvando] = React.useState(false)
  const [aberto, setAberto] = React.useState<boolean | null>(null)
  const [chaveGrafico, setChaveGrafico] = React.useState<ChavePlano>('leads')
  const [historicoAberto, setHistoricoAberto] = React.useState(false)
  const [historico, setHistorico] = React.useState<GcHistoricoPlanejamento[] | null>(null)
  const [modelos, setModelos] = React.useState<GcModeloTexto[]>([])
  const [gerenciando, setGerenciando] = React.useState<GcCampoModelo | null>(null)
  const [confirmandoMedia, setConfirmandoMedia] = React.useState(false)
  const [mediaAplicada, setMediaAplicada] = React.useState<string>('')
  const prefillFeito = React.useRef<GcPlanejamentoApi | null>(null)
  const secaoRef = React.useRef<HTMLElement>(null)

  const sugestao = React.useMemo(() => sugerirPontoA(metricas, mesAtual()), [metricas])

  const aplicar = React.useCallback((a: GcPlanejamentoApi) => {
    const r = doApi(a)
    setApi(a)
    setRascunho(r)
    setInicial(JSON.stringify(r))
  }, [])

  React.useEffect(() => {
    let cancelado = false
    setCarregando(true)
    gestaoClientes
      .planejamento(clienteId)
      .then((a) => {
        if (!cancelado) aplicar(a)
      })
      .catch((err: Error) => toast.error('Falha ao carregar o planejamento: ' + err.message))
      .finally(() => {
        if (!cancelado) setCarregando(false)
      })
    return () => {
      cancelado = true
    }
  }, [clienteId, aplicar])

  const carregarModelos = React.useCallback(async () => {
    try {
      setModelos(await gestaoClientes.modelosTexto(false))
    } catch {
      // Sem os modelos o menu fica vazio, mas dá pra escrever à mão — não vale um aviso a mais.
    }
  }, [])
  React.useEffect(() => {
    void carregarModelos()
  }, [carregarModelos])

  const carregarHistorico = React.useCallback(async () => {
    try {
      setHistorico(await gestaoClientes.historicoPlanejamento(clienteId))
    } catch (err) {
      toast.error('Falha ao carregar o histórico: ' + (err as Error).message)
    }
  }, [clienteId])
  React.useEffect(() => {
    if (historicoAberto && historico === null) void carregarHistorico()
  }, [historicoAberto, historico, carregarHistorico])

  // ---- ponto A: pré-preenchimento com a média dos últimos meses lançados
  /** Aplica a sugestão aos campos. `soVazios` = só onde ainda não há número (o pré-preenchimento). */
  const aplicarMedia = React.useCallback((soVazios: boolean) => {
    setRascunho((r) => {
      if (!r) return r
      const proximo = { ...r, origens: { ...r.origens } }
      let preencheu = false
      for (const c of CAMPOS_DO_A) {
        const s = sugestao.campos[c.campo]
        if (!s) continue
        if (soVazios && proximo[c.campo].trim() !== '') continue
        proximo[c.campo] = numeroParaCampo(s.valor)
        proximo.origens[c.api] = { origem: 'calculado', meses: s.meses }
        preencheu = true
      }
      // Entrou número no ponto A: a data do diagnóstico vem com hoje, e o "aguardando" acaba.
      if (preencheu) {
        proximo.data = proximo.data ?? hojeISO()
        proximo.aguardando = false
        proximo.lembrarEm = null
      }
      return proximo
    })
  }, [sugestao])

  React.useEffect(() => {
    // Só na PRIMEIRA vez (planejamento nunca salvo) e em campo vazio: quem já salvou — inclusive em
    // branco, de propósito — não vê os números voltarem sozinhos.
    if (!api || prefillFeito.current === api) return
    prefillFeito.current = api
    if (api.existe || api.atual.aguardando_cliente || sugestao.meses.length === 0) return
    if (!CAMPOS_DO_A.some((c) => sugestao.campos[c.campo])) return
    aplicarMedia(true)
    setMediaAplicada(rotuloDosMeses(sugestao.meses))
  }, [api, sugestao, aplicarMedia])

  // ---- recolher / abrir
  const planoSalvo = React.useMemo(() => (api ? planoDaApi(api) : null), [api])
  const estado = planoSalvo
    ? estadoDoPlanejamento(planoSalvo, { aguardando: api?.atual.aguardando_cliente, lembrarEm: api?.atual.lembrar_em })
    : 'a_definir'

  React.useEffect(() => {
    // Só decide uma vez, quando o planejamento chega: recolhido, a menos que a pessoa tenha deixado aberto.
    if (!api || aberto !== null) return
    let lembrado: string | null = null
    try {
      lembrado = window.localStorage.getItem(CHAVE_ABERTO(clienteId))
    } catch {
      /* sem armazenamento: vale a regra padrão */
    }
    setAberto(lembrado === '1')
  }, [api, aberto, clienteId])

  const alternar = (valor: boolean) => {
    setAberto(valor)
    try {
      window.localStorage.setItem(CHAVE_ABERTO(clienteId), valor ? '1' : '0')
    } catch {
      /* a escolha vale até recarregar */
    }
  }

  // Um pedido de fora ("abrir planejamento", vindo da Visão geral ou do semáforo) abre e rola até aqui.
  React.useEffect(() => {
    if (abrirQuando <= 0) return
    setAberto(true)
    const t = window.setTimeout(() => {
      secaoRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }, 80)
    return () => window.clearTimeout(t)
  }, [abrirQuando])

  const plano = React.useMemo(() => (rascunho ? planoDoRascunho(rascunho) : null), [rascunho])
  const realizado = React.useMemo(() => realizadoPorMes(metricas), [metricas])
  /** Pra projetar: sem ponto A, a rota parte do primeiro mês lançado em Métricas. */
  const planoDaRota = React.useMemo(() => (plano ? comPartidaDasMetricas(plano, realizado) : null), [plano, realizado])
  const avisos = React.useMemo(() => {
    if (!plano || !rascunho) return []
    const cpl = avisosDeCplImplicito(plano, {
      '6_meses': rascunho.cenarios['6_meses'].estrategia,
      '12_meses': rascunho.cenarios['12_meses'].estrategia,
    })
    return [...cpl.map((a) => a.texto), ...validarRealismo(plano).map((a) => `${a.titulo}. ${a.texto}`)]
  }, [plano, rascunho])
  // O botão de salvar fica ativo sempre que o rascunho difere do que está gravado — inclusive ao LIMPAR
  // um campo, que é só uma diferença como outra qualquer.
  const sujo = rascunho !== null && JSON.stringify(rascunho) !== inicial

  const chavesComRota = React.useMemo(
    () => (planoDaRota ? CHAVES_PLANO.filter(({ chave }) => rotaProjetada(planoDaRota, chave).length > 0) : []),
    [planoDaRota],
  )
  const chaveEfetiva = chavesComRota.some((c) => c.chave === chaveGrafico)
    ? chaveGrafico
    : (chavesComRota[0]?.chave ?? chaveGrafico)
  const linhasDaProjecao = React.useMemo(
    () => (planoDaRota ? projecaoMensal(planoDaRota, chaveEfetiva, realizado, mesAtual()) : []),
    [planoDaRota, chaveEfetiva, realizado],
  )

  if (carregando || !rascunho || !plano || !planoDaRota) {
    return (
      <section className="flex items-center justify-center gap-2 rounded-xl border border-line p-8 text-sm text-foreground/60">
        <Loader2 className="h-4 w-4 animate-spin" /> Carregando planejamento…
      </section>
    )
  }

  const mudar = <K extends keyof Rascunho>(campo: K, valor: Rascunho[K]) =>
    setRascunho((r) => (r ? { ...r, [campo]: valor } : r))
  /**
   * Digitar num número do ponto A o torna "informado" (deixou de ser a média). Quando é o PRIMEIRO
   * número do ponto A, a data do diagnóstico vem preenchida com hoje (continua editável e opcional) e o
   * "aguardando o cliente" acaba: os números chegaram.
   */
  const mudarPontoA = (campo: CampoDoPontoA, apiCampo: string, valor: string) =>
    setRascunho((r) => {
      if (!r) return r
      const jaTinhaNumero = CAMPOS_DO_A.some((c) => r[c.campo].trim() !== '')
      const proximo: Rascunho = {
        ...r, [campo]: valor, origens: { ...r.origens, [apiCampo]: { origem: 'informado' as const } },
      }
      if (valor.trim() !== '') {
        if (!jaTinhaNumero && !r.data) proximo.data = hojeISO()
        proximo.aguardando = false
        proximo.lembrarEm = null
      }
      return proximo
    })
  const mudarCenario = (h: HorizontePlano, campo: 'objetivo' | 'estrategia', valor: string) =>
    setRascunho((r) => (r ? { ...r, cenarios: { ...r.cenarios, [h]: { ...r.cenarios[h], [campo]: valor } } } : r))
  const mudarMeta = (h: HorizontePlano, chave: ChaveDigitada, valor: string) =>
    setRascunho((r) =>
      r
        ? { ...r, cenarios: { ...r.cenarios, [h]: { ...r.cenarios[h], metas: { ...r.cenarios[h].metas, [chave]: valor } } } }
        : r,
    )

  const ctxDeVariaveis = contextoDeVariaveis(plano, cliente ?? {})
  /** Aplica um modelo a um texto: troca as variáveis, e substitui ou acrescenta conforme a escolha. */
  const textoComModelo = (atual: string, modelo: string, modo: 'substituir' | 'acrescentar') => {
    const texto = aplicarVariaveis(modelo, ctxDeVariaveis)
    return modo === 'acrescentar' && atual.trim() ? `${atual.replace(/\s+$/, '')}\n\n${texto}` : texto
  }
  const textosDoPlano: Record<AlvoDeModelo, string> = {
    situacao: rascunho.situacao,
    'objetivo:6_meses': rascunho.cenarios['6_meses'].objetivo,
    'objetivo:12_meses': rascunho.cenarios['12_meses'].objetivo,
    'estrategia:6_meses': rascunho.cenarios['6_meses'].estrategia,
    'estrategia:12_meses': rascunho.cenarios['12_meses'].estrategia,
  }
  const aplicarModeloEm = (alvo: AlvoDeModelo, modelo: string, modo: 'substituir' | 'acrescentar') => {
    const novo = textoComModelo(textosDoPlano[alvo], modelo, modo)
    if (alvo === 'situacao') return mudar('situacao', novo)
    const [campo, horizonte] = alvo.split(':') as ['objetivo' | 'estrategia', HorizontePlano]
    mudarCenario(horizonte, campo, novo)
  }

  const salvar = async () => {
    setSalvando(true)
    try {
      const salvo = await gestaoClientes.salvarPlanejamento(clienteId, paraEntrada(rascunho))
      aplicar(salvo)
      setMediaAplicada('')
      const lembrete = salvo.atual.aguardando_cliente && salvo.atual.lembrar_em
      toast.success(
        lembrete
          ? `Planejamento salvo — lembrete em Estratégias > Pendências para ${dataBR(salvo.atual.lembrar_em!)}`
          : 'Planejamento salvo',
      )
      setHistorico(null)
      await onMetasMudaram()
    } catch (err) {
      toast.error('Falha ao salvar o planejamento: ' + (err as Error).message)
    } finally {
      setSalvando(false)
    }
  }

  // O que a grade mostra na coluna "Ponto A": só o ponto A de verdade, sem o ponto de partida emprestado.
  const base = baseDoPontoA(plano.atual)
  const resumo = planoSalvo ? resumoLinha(planoSalvo) : null
  const mesAgora = mesAtual()
  const naRota = avaliarMesContraRota(planoDaRota, realizado[mesAgora] ?? {}, mesAgora)
  const ruins = naRota.filter((r) => r.boa === false)
  const estadoDoMes = ruins.some((r) => Math.abs(r.desvioPct) > 40)
    ? { estado: 'risco' as const, texto: 'Muito abaixo da rota' }
    : ruins.some((r) => Math.abs(r.desvioPct) > 20)
      ? { estado: 'atencao' as const, texto: 'Abaixo da rota' }
      : naRota.length > 0
        ? { estado: 'otimo' as const, texto: 'No caminho' }
        : null

  /**
   * Enter e Tab descem pra mesma coluna da linha de baixo, como em planilha; no fim da coluna de 6
   * meses, seguem pro topo da de 12. Shift+Tab sobe. Fora da grade, o Tab é o de sempre.
   */
  const aoTeclar = (e: React.KeyboardEvent<HTMLInputElement>, h: HorizontePlano, indice: number) => {
    const total = CHAVES_DIGITADAS.length
    let alvo: string | null = null
    if (e.key === 'Enter' || (e.key === 'Tab' && !e.shiftKey)) {
      if (indice + 1 < total) alvo = `${h}-${indice + 1}`
      else if (h === '6_meses') alvo = `12_meses-0`
      else if (e.key === 'Enter') return e.preventDefault()
    } else if (e.key === 'Tab' && e.shiftKey) {
      if (indice > 0) alvo = `${h}-${indice - 1}`
      else if (h === '12_meses') alvo = `6_meses-${total - 1}`
    }
    if (!alvo) return
    const proximo = document.querySelector<HTMLInputElement>(`[data-plano="${alvo}"]`)
    if (!proximo) return
    e.preventDefault()
    proximo.focus()
    proximo.select()
  }

  const temSugestao = Object.keys(sugestao.campos).length > 0
  const algumNumero = CAMPOS_DO_A.some((c) => rascunho[c.campo].trim() !== '')
  const ticketCalculado = plano.atual.ticket
  const conversaoCalculada = plano.atual.conversao
  const semData = !planoDaRota.dataDiagnostico

  return (
    <section ref={secaoRef} id="gc-planejamento" className="rounded-xl border border-accent/25 bg-accent/[0.015]">
      {/* ------------------------------------------------------------ cabeçalho (sempre visível) */}
      <div className="flex flex-wrap items-center gap-3 p-4">
        <button
          type="button"
          onClick={() => alternar(!aberto)}
          className="flex min-w-0 flex-1 items-start gap-2.5 text-left"
          aria-expanded={!!aberto}
        >
          <ChevronDown
            className={cn('mt-1 h-4 w-4 shrink-0 text-foreground/40 transition-transform', !aberto && '-rotate-90')}
          />
          <span className="min-w-0">
            <span className="flex flex-wrap items-center gap-2">
              <Route className="h-4 w-4 text-accent" />
              <span className="text-base font-semibold text-foreground">Planejamento do cliente</span>
              {estado === 'a_definir' && <PastilhaSaude estado="neutro" texto="A definir" />}
              {estado === 'atencao' && <PastilhaSaude estado="atencao" texto="Atenção" />}
              {estado === 'definido' && estadoDoMes && (
                <PastilhaSaude estado={estadoDoMes.estado} texto={estadoDoMes.texto} />
              )}
            </span>
            {estado === 'definido' && resumo ? (
              <span className="mt-0.5 block truncate text-xs text-foreground/60" title={resumo}>
                {resumo}
              </span>
            ) : (
              <span className="mt-0.5 block text-xs text-foreground/50">
                {estado === 'atencao' && api?.atual.lembrar_em
                  ? `O lembrete de ${dataBR(api.atual.lembrar_em)} venceu: veja se o cliente já trouxe os números.`
                  : api?.atual.aguardando_cliente
                    ? `Aguardando o cliente${api.atual.lembrar_em ? ` — lembrar em ${dataBR(api.atual.lembrar_em)}` : ''}.`
                    : 'Preencha quando o cliente tiver esses números.'}
              </span>
            )}
          </span>
        </button>
        <div className="flex items-center gap-2">
          {sujo && <span className="text-xs text-warning">alterações não salvas</span>}
          {sujo && (
            <Button variant="ghost" size="sm" onClick={() => api && aplicar(api)}>
              Descartar
            </Button>
          )}
          <Button onClick={() => void salvar()} loading={salvando} disabled={!sujo}>
            Salvar planejamento
          </Button>
        </div>
      </div>

      {/* O conteúdo fica MONTADO mesmo recolhido: desmontar jogaria fora o que está sendo digitado. */}
      <div className={cn('border-t border-accent/15 p-4', !aberto && 'hidden')}>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <p className="max-w-2xl text-xs text-foreground/55">
            Tudo é opcional: preencha o que souber. As metas numéricas são as mesmas de "Metas combinadas".
          </p>
          <MenuModelos
            modelos={modelos}
            textos={textosDoPlano}
            onAplicar={aplicarModeloEm}
            onGerenciar={() => setGerenciando('situacao')}
          />
        </div>

        {/* ---------------------------------------------------------------- 1. ponto A */}
        <div className="rounded-xl border border-line bg-surface p-3">
          <h3 className="mb-2 text-sm font-semibold text-foreground">1 · Onde o cliente está hoje — ponto A</h3>
          <div>
            <span className="mb-1.5 block text-xs font-medium text-foreground/70">Situação de hoje</span>
            <Textarea
              rows={3}
              value={rascunho.situacao}
              onChange={(e) => mudar('situacao', e.target.value)}
              placeholder="Como o cliente chegou até a gente: o que já faz, o que não funciona, o que ele espera. Leitura interna."
            />
          </div>

          {mediaAplicada && (
            <p className="mt-3 flex items-start gap-2 rounded-lg border border-accent/25 bg-accent/[0.05] px-3 py-2 text-xs text-foreground/80">
              <Calculator className="mt-0.5 h-3.5 w-3.5 shrink-0 text-accent" />
              Pré-preenchido com a média das métricas lançadas ({mediaAplicada}). Confira, ajuste o que for
              preciso e salve — o ponto A é uma foto do diagnóstico e não se atualiza sozinho.
            </p>
          )}

          <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            {CAMPOS_DO_A.map((c) => {
              const origem = rascunho.origens[c.api]
              const temValor = rascunho[c.campo].trim() !== ''
              return (
                <div key={c.campo}>
                  <Input
                    label={c.label}
                    value={rascunho[c.campo]}
                    onChange={(e) => mudarPontoA(c.campo, c.api, e.target.value)}
                    placeholder={c.ph}
                    inputMode="decimal"
                  />
                  {temValor && (
                    <p
                      className={cn(
                        'mt-1 text-[11px]',
                        origem?.origem === 'calculado' ? 'text-accent' : 'text-foreground/40',
                      )}
                      title={
                        origem?.origem === 'calculado'
                          ? `Média das métricas lançadas em ${rotuloDosMeses(origem.meses)}`
                          : 'Digitado por alguém'
                      }
                    >
                      {origem?.origem === 'calculado'
                        ? `calculado das métricas · ${rotuloDosMeses(origem.meses)}`
                        : 'informado'}
                    </p>
                  )}
                </div>
              )
            })}
            <CampoData label="Data do diagnóstico" value={rascunho.data} onChange={(v) => mudar('data', v)} />
          </div>

          {/* Ticket e conversão são contas: aparecem só quando existem, em texto pequeno. */}
          {(ticketCalculado !== null || conversaoCalculada !== null) && (
            <p className="mt-2 text-[11px] text-foreground/45">
              {[
                ticketCalculado !== null ? `Ticket médio ${formatarMetrica(ticketCalculado, 'reais')}` : null,
                conversaoCalculada !== null ? `Conversão ${formatarMetrica(conversaoCalculada, 'percentual')}` : null,
              ]
                .filter(Boolean)
                .join(' · ')}{' '}
              <span className="text-foreground/30">(calculados)</span>
            </p>
          )}

          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2">
            <label className="flex cursor-pointer items-center gap-2 text-sm text-foreground/80">
              <input
                type="checkbox"
                checked={rascunho.aguardando}
                onChange={(e) =>
                  setRascunho((r) =>
                    r ? { ...r, aguardando: e.target.checked, lembrarEm: e.target.checked ? r.lembrarEm : null } : r,
                  )
                }
                className="h-4 w-4 rounded border-line"
              />
              Aguardando o cliente trazer os números
            </label>
            {rascunho.aguardando && (
              <div className="flex items-center gap-2">
                <CampoData
                  label="Lembrar de completar em"
                  value={rascunho.lembrarEm}
                  onChange={(v) => mudar('lembrarEm', v)}
                  hint="Opcional. Com data, vira pendência em Estratégias > Pendências."
                />
              </div>
            )}
          </div>

          {temSugestao && (
            <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-foreground/50">
              <Button
                variant="ghost"
                size="sm"
                leftIcon={<Calculator className="h-3.5 w-3.5" />}
                onClick={() =>
                  algumNumero
                    ? setConfirmandoMedia(true)
                    : (aplicarMedia(false), setMediaAplicada(rotuloDosMeses(sugestao.meses)))
                }
              >
                {algumNumero ? 'Recalcular da média dos últimos meses' : 'Preencher com a média dos últimos meses'}
              </Button>
              <span>
                média de {sugestao.meses.length} mês(es) lançado(s): {rotuloDosMeses(sugestao.meses)}
              </span>
            </div>
          )}
        </div>

        {/* ---------------------------------------------------------------- 2. grade das metas */}
        <div className="mt-3 rounded-xl border border-line bg-surface p-3">
          <h3 className="mb-1 flex items-center gap-2 text-sm font-semibold text-foreground">
            <Target className="h-4 w-4 text-accent" /> 2 · Metas de 6 e 12 meses
          </h3>
          <p className="mb-2 text-xs text-foreground/50">Preencha o que souber. CPL e ROAS são calculados.</p>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-sm">
              <thead className="text-left text-xs uppercase tracking-wide text-foreground/45">
                <tr>
                  <th className="py-1.5 pr-3 font-medium">Métrica</th>
                  <th className="px-2 py-1.5 text-right font-medium">Ponto A</th>
                  <th className="px-2 py-1.5 text-right font-medium">Meta 6 meses</th>
                  <th className="px-2 py-1.5 font-medium">Variação</th>
                  <th className="px-2 py-1.5 text-right font-medium">Meta 12 meses</th>
                  <th className="px-2 py-1.5 font-medium">Variação</th>
                </tr>
              </thead>
              <tbody>
                {CHAVES_DIGITADAS.map(({ chave, label }, indice) => {
                  const prefixo = PREFIXO[chave]
                  const placeholder = prefixo === 'R$' ? '0,00' : '0'
                  return (
                    <tr key={chave} className="border-t border-line">
                      <td className="py-1.5 pr-3 font-medium text-foreground/85">{label}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums text-foreground/55">{textoDaBase(chave, base[chave])}</td>
                      {HORIZONTES_PLANO.flatMap((h) => [
                        <td key={`${h.valor}-campo`} className="px-1.5 py-1">
                          <div className="relative ml-auto w-[160px]">
                            {prefixo && (
                              <span className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-xs text-foreground/40">
                                {prefixo}
                              </span>
                            )}
                            <input
                              data-plano={`${h.valor}-${indice}`}
                              aria-label={`${label}, meta de ${h.label}`}
                              value={rascunho.cenarios[h.valor].metas[chave as ChaveDigitada]}
                              onChange={(e) => mudarMeta(h.valor, chave as ChaveDigitada, e.target.value)}
                              onKeyDown={(e) => aoTeclar(e, h.valor, indice)}
                              onFocus={(e) => e.target.select()}
                              inputMode="decimal"
                              placeholder={placeholder}
                              className={cn(
                                'h-8 w-full rounded-md border border-line bg-surface pr-2 text-right text-sm tabular-nums text-foreground outline-none placeholder:text-foreground/25 focus:border-accent focus:ring-2 focus:ring-accent/15',
                                prefixo ? 'pl-8' : 'pl-2',
                              )}
                            />
                          </div>
                        </td>,
                        <td key={`${h.valor}-var`} className="px-2 py-1">
                          <CelulaVariacao chave={chave} valor={plano.metas[h.valor][chave]} pontoA={base[chave]} />
                        </td>,
                      ])}
                    </tr>
                  )
                })}
                {/* Linhas CALCULADAS: cinza, somente leitura. */}
                {CHAVES_CALCULADAS.map(({ chave, label }) => (
                  <tr key={chave} className="border-t border-line">
                    <td className="py-1.5 pr-3 font-medium text-foreground/45">{label}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums text-foreground/40">{textoDaBase(chave, base[chave])}</td>
                    {HORIZONTES_PLANO.flatMap((h) => [
                      <td key={`${h.valor}-campo`} className="px-1.5 py-1">
                        <div
                          className="relative ml-auto h-8 w-[160px] rounded-md bg-elevate/[0.04] text-foreground/45"
                          title="Calculado — não se digita"
                        >
                          <span className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-xs text-foreground/30">
                            {PREFIXO[chave]}
                          </span>
                          <span className="absolute inset-y-0 right-2 flex items-center text-sm tabular-nums">
                            {textoCalculado(chave, plano.metas[h.valor][chave])}
                          </span>
                        </div>
                      </td>,
                      <td key={`${h.valor}-var`} className="px-2 py-1">
                        <CelulaVariacao chave={chave} valor={plano.metas[h.valor][chave]} pontoA={base[chave]} />
                      </td>,
                    ])}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* ------------------------------------------------------------ avisos (discretos, não bloqueiam) */}
          {avisos.length > 0 && (
            <ul className="mt-3 space-y-1.5">
              {avisos.map((texto, i) => (
                <li
                  key={i}
                  className="flex items-start gap-2 rounded-md border border-warning/25 bg-warning/[0.05] px-2.5 py-1.5 text-xs text-foreground/75"
                >
                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning" />
                  <span>{texto}</span>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* ---------------------------------------------------------------- textos dos cenários */}
        <div className="mt-3 grid gap-3 lg:grid-cols-2">
          {HORIZONTES_PLANO.map((h) => {
            const c = rascunho.cenarios[h.valor]
            return (
              <div key={h.valor} className="rounded-xl border border-line bg-surface p-3">
                <h3 className="mb-2 text-sm font-semibold text-foreground">Em {h.label}</h3>
                <div className="space-y-3">
                  <div>
                    <span className="mb-1.5 block text-xs font-medium text-foreground/70">Onde quer chegar</span>
                    <Textarea
                      rows={2}
                      value={c.objetivo}
                      onChange={(e) => mudarCenario(h.valor, 'objetivo', e.target.value)}
                      placeholder="O objetivo, na linguagem do negócio do cliente."
                    />
                  </div>
                  <div>
                    <span className="mb-1.5 block text-xs font-medium text-foreground/70">Estratégia e premissas</span>
                    <Textarea
                      rows={4}
                      value={c.estrategia}
                      onChange={(e) => mudarCenario(h.valor, 'estrategia', e.target.value)}
                      placeholder="O que vamos fazer e o que precisa ser verdade: CPL cair com criativo novo, cliente atender em 5 min…"
                    />
                    <p className="mt-1 flex items-center gap-1 text-[11px] text-foreground/40">
                      <Lock className="h-3 w-3" /> interna — nunca vai pro portal
                    </p>
                  </div>
                </div>
              </div>
            )
          })}
        </div>

        {/* ---------------------------------------------------------------- 3. projeção */}
        <div className="mt-3 rounded-xl border border-line bg-surface p-3">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-3">
            <h3 className="text-sm font-semibold text-foreground">3 · Projeção mês a mês</h3>
            {chavesComRota.length > 0 && (
              <Select
                options={chavesComRota.map((c) => ({ value: c.chave, label: c.label }))}
                value={chaveEfetiva}
                onChange={(e) => setChaveGrafico(e.target.value as ChavePlano)}
                className="w-40"
              />
            )}
          </div>

          {chavesComRota.length === 0 ? (
            <p className="py-6 text-center text-sm text-foreground/45">
              {semData
                ? 'Lance o primeiro mês para ver a rota.'
                : 'Defina uma meta de 6 ou 12 meses para ver a rota.'}
            </p>
          ) : (
            <>
              <p className="mb-3 text-xs text-foreground/50">
                {HORIZONTES_PLANO.every((h) => planoDaRota.metas[h.valor][chaveEfetiva] !== undefined)
                  ? 'A rota passa pela meta de 6 meses antes de seguir pra de 12. '
                  : 'Rota até a meta. '}
                {temPontoDeA(base, chaveEfetiva)
                  ? 'Parte do ponto A, o mesmo tanto a cada mês. '
                  : 'Sem o número no ponto A, parte do primeiro mês lançado em Métricas. '}
                "No caminho" é estar a menos de 10% do projetado.
              </p>
              <GraficoProjecao linhas={linhasDaProjecao} chave={chaveEfetiva} />
              <div className="mt-3">
                <TabelaProjecao linhas={linhasDaProjecao} chave={chaveEfetiva} />
              </div>
            </>
          )}
        </div>

        {/* ---------------------------------------------------------------- histórico */}
        <div className="mt-3 overflow-hidden rounded-xl border border-line bg-surface">
          <button
            type="button"
            onClick={() => setHistoricoAberto((a) => !a)}
            className="flex w-full items-center justify-between px-3 py-2.5 text-left text-sm font-medium text-foreground hover:bg-elevate/[0.02]"
          >
            Histórico de alterações
            <ChevronDown className={cn('h-4 w-4 text-foreground/40 transition-transform', !historicoAberto && '-rotate-90')} />
          </button>
          {historicoAberto && (
            <div className="border-t border-line px-3 py-2">
              {historico === null ? (
                <p className="py-3 text-center text-sm text-foreground/45">Carregando…</p>
              ) : historico.length === 0 ? (
                <p className="py-3 text-center text-sm text-foreground/45">Nenhuma alteração registrada ainda.</p>
              ) : (
                <ol className="space-y-3">
                  {historico.map((h) => (
                    <li key={h.id}>
                      <p className="text-xs text-foreground/50">
                        {new Date(h.alterado_em).toLocaleString('pt-BR', {
                          day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
                        })}
                        {h.autor_nome ? ` · ${h.autor_nome}` : ''} · {h.mudancas.length} alteração(ões)
                      </p>
                      <ul className="mt-1 space-y-0.5">
                        {h.mudancas.map((m, i) => (
                          <li key={i} className="text-xs text-foreground/75">
                            <span className="text-foreground/45">
                              {m.escopo === 'atual' ? '' : `${m.escopo === '6_meses' ? '6 meses' : '12 meses'} · `}
                            </span>
                            {m.rotulo}: <span className="text-foreground/50">{textoDoValor(m.antes)}</span> →{' '}
                            <span className="font-medium text-foreground">{textoDoValor(m.depois)}</span>
                          </li>
                        ))}
                      </ul>
                    </li>
                  ))}
                </ol>
              )}
            </div>
          )}
        </div>
      </div>

      {/* ------------------------------------------------------------------ janelas */}
      <ModalModelosTexto
        aberto={gerenciando !== null}
        campoInicial={gerenciando ?? 'situacao'}
        onFechar={() => setGerenciando(null)}
        onMudou={carregarModelos}
      />
      <Modal
        open={confirmandoMedia}
        onClose={() => setConfirmandoMedia(false)}
        size="sm"
        title="Recalcular o ponto A?"
        description="Os números do ponto A vão ser trocados pela média dos últimos meses lançados."
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setConfirmandoMedia(false)}>
              Cancelar
            </Button>
            <Button
              onClick={() => {
                aplicarMedia(false)
                setMediaAplicada(rotuloDosMeses(sugestao.meses))
                setConfirmandoMedia(false)
              }}
            >
              Recalcular
            </Button>
          </div>
        }
      >
        <p className="text-sm text-foreground/75">
          Isso <strong>substitui</strong> o que está digitado nos campos que a média consegue calcular. Nada é gravado
          até você clicar em "Salvar planejamento", e "Descartar" desfaz.
        </p>
      </Modal>
    </section>
  )
}

/** A métrica tem número no ponto A (e não só o ponto de partida emprestado do primeiro mês)? */
function temPontoDeA(base: Partial<Record<ChavePlano, number>>, chave: ChavePlano): boolean {
  return base[chave] !== undefined
}
