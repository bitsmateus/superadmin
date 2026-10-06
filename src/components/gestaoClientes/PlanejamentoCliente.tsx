import * as React from 'react'
import {
  AlertTriangle, Calculator, ChevronDown, Eye, Info, Loader2, Lock, Route, ShieldAlert, Target, Wand2,
} from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/Button'
import { Input, Textarea } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
import { Modal } from '@/components/ui/Modal'
import { CampoData } from '@/components/gestaoClientes/CampoData'
import { GraficoProjecao, TabelaProjecao } from '@/components/gestaoClientes/GraficoProjecao'
import { ModalModelosTexto, SeletorDeModelo } from '@/components/gestaoClientes/ModelosDeTexto'
import { PreviaPortal } from '@/components/gestaoClientes/PreviaPortal'
import { PastilhaSaude } from '@/components/gestaoClientes/Semaforo'
import {
  gestaoClientes,
  type GcCampoModelo, type GcHistoricoPlanejamento, type GcMetrica, type GcModeloTexto,
  type GcOrigemCampo, type GcPlanejamentoApi, type GcPlanejamentoEntrada,
} from '@/services/gestaoClientes'
import {
  CHAVES_PLANO, HORIZONTES_PLANO, aplicarVariaveis, avaliarMesContraRota, baseDoPontoA, contextoDeVariaveis,
  faltaNoPlanejamento, planejamentoCompleto, projecaoMensal, realizadoPorMes, resumoLinha, rotaProjetada,
  sugerirPontoA, validarRealismo, type CampoDoPontoA, type ChavePlano, type Curva, type HorizontePlano,
  type Planejamento,
} from '@/lib/gcPlanejamento'
import { planoDaApi } from '@/lib/gcPlanoAdaptadores'
import {
  formatarMetrica, mesAtual, metricaUnidade, numeroDigitado, numeroParaCampo,
} from '@/lib/gcMetricas'
import { cn } from '@/lib/utils'

// ---------------------------------------------------------------------------------------------------
// O rascunho do editor: tudo em TEXTO, como a pessoa digita
// ---------------------------------------------------------------------------------------------------

/** Os cinco números do ponto A: nome no rascunho, nome na API e como aparece na tela. */
const CAMPOS_DO_A: { campo: CampoDoPontoA; api: string; label: string; ph: string; ajuda?: string }[] = [
  { campo: 'leads', api: 'leads_mes', label: 'Leads / mês', ph: '0' },
  { campo: 'investimento', api: 'investimento_mes', label: 'Investimento / mês (R$)', ph: '0,00' },
  { campo: 'ticket', api: 'ticket_medio', label: 'Ticket médio (R$)', ph: '0,00' },
  { campo: 'conversao', api: 'taxa_conversao', label: 'Taxa de conversão (%)', ph: '0', ajuda: 'leads que viram venda' },
  { campo: 'receita', api: 'faturamento_mensal', label: 'Faturamento mensal (R$)', ph: '0,00' },
]

interface Rascunho {
  situacao: string
  leads: string
  investimento: string
  ticket: string
  conversao: string
  receita: string
  /** Origem por campo da API (leads_mes...). Campo com número e sem entrada aqui conta como "informado". */
  origens: Record<string, GcOrigemCampo>
  data: string | null
  curva: Curva
  portalAtivo: boolean
  portalSituacao: boolean
  portalObjetivo: boolean
  cenarios: Record<HorizontePlano, {
    objetivo: string
    estrategia: string
    premissas: string
    metas: Record<ChavePlano, string>
  }>
}

function vazioDeMetas(): Record<ChavePlano, string> {
  return { leads: '', cpl: '', vendas: '', roas: '', receita: '', investimento: '' }
}

function doApi(a: GcPlanejamentoApi): Rascunho {
  const cen = (h: HorizontePlano) => {
    const c = a.cenarios[h]
    const metas = vazioDeMetas()
    for (const { chave } of CHAVES_PLANO) metas[chave] = numeroParaCampo(c?.metas?.[chave])
    return {
      objetivo: c?.onde_quer_chegar ?? '',
      estrategia: c?.estrategia ?? '',
      premissas: c?.premissas ?? '',
      metas,
    }
  }
  return {
    situacao: a.atual.situacao_atual,
    leads: numeroParaCampo(a.atual.leads_mes),
    investimento: numeroParaCampo(a.atual.investimento_mes),
    ticket: numeroParaCampo(a.atual.ticket_medio),
    conversao: numeroParaCampo(a.atual.taxa_conversao),
    receita: numeroParaCampo(a.atual.faturamento_mensal),
    origens: a.origens ?? {},
    data: a.atual.data_diagnostico,
    curva: a.curva,
    portalAtivo: a.portal.ativo,
    portalSituacao: a.portal.mostrar_situacao,
    portalObjetivo: a.portal.mostrar_objetivo,
    cenarios: { '6_meses': cen('6_meses'), '12_meses': cen('12_meses') },
  }
}

/** O rascunho no formato do cálculo — é com ele que o realismo e a projeção reagem ao digitar. */
function planoDoRascunho(r: Rascunho): Planejamento {
  const metas = (h: HorizontePlano) => {
    const m: Partial<Record<ChavePlano, number>> = {}
    for (const { chave } of CHAVES_PLANO) {
      const n = numeroDigitado(r.cenarios[h].metas[chave])
      if (n !== null) m[chave] = n
    }
    return m
  }
  return {
    curva: r.curva,
    dataDiagnostico: r.data,
    atual: {
      leads: numeroDigitado(r.leads),
      investimento: numeroDigitado(r.investimento),
      ticket: numeroDigitado(r.ticket),
      conversao: numeroDigitado(r.conversao),
      receita: numeroDigitado(r.receita),
    },
    metas: { '6_meses': metas('6_meses'), '12_meses': metas('12_meses') },
  }
}

function paraEntrada(r: Rascunho): GcPlanejamentoEntrada {
  const plano = planoDoRascunho(r)
  const cen = (h: HorizontePlano) => ({
    onde_quer_chegar: r.cenarios[h].objetivo,
    estrategia: r.cenarios[h].estrategia,
    premissas: r.cenarios[h].premissas,
    // Campo em branco vai como null: é o sinal de "apague essa meta".
    metas: Object.fromEntries(CHAVES_PLANO.map(({ chave }) => [chave, plano.metas[h][chave] ?? null])),
  })
  // Todo número do ponto A sai com origem: o que ninguém marcou como calculado é "informado".
  const origens: Record<string, GcOrigemCampo> = {}
  for (const c of CAMPOS_DO_A) {
    if (plano.atual[c.campo] === null) continue
    origens[c.api] = r.origens[c.api] ?? { origem: 'informado' }
  }
  return {
    atual: {
      situacao_atual: r.situacao,
      leads_mes: plano.atual.leads,
      investimento_mes: plano.atual.investimento,
      ticket_medio: plano.atual.ticket,
      taxa_conversao: plano.atual.conversao,
      faturamento_mensal: plano.atual.receita,
      data_diagnostico: r.data,
    },
    curva: r.curva,
    origens,
    portal: { ativo: r.portalAtivo, mostrar_situacao: r.portalSituacao, mostrar_objetivo: r.portalObjetivo },
    cenarios: { '6_meses': cen('6_meses'), '12_meses': cen('12_meses') },
  }
}

const NIVEL_AVISO = {
  alerta: { classe: 'border-danger/30 bg-danger/[0.05]', icone: ShieldAlert, cor: 'text-danger', rotulo: 'não fecha' },
  atencao: { classe: 'border-warning/30 bg-warning/[0.06]', icone: AlertTriangle, cor: 'text-warning', rotulo: 'atenção' },
  info: { classe: 'border-line bg-elevate/[0.02]', icone: Info, cor: 'text-accent', rotulo: 'pra saber' },
} as const

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

const CHAVE_ABERTO = (id: string) => `gc:planejamento:aberto:${id}`

/**
 * PLANEJAMENTO DO CLIENTE — o ponto A (onde o cliente está hoje), onde se quer chegar em 6 e 12
 * meses, a rota entre as duas pontas e a conferência de realismo.
 *
 * O bloco abre sozinho só quando está INCOMPLETO: planejamento pronto fica recolhido, com um resumo
 * de uma linha no cabeçalho, pra não empurrar o resto da aba pra baixo toda vez. Quem abre ou fecha
 * à mão tem a escolha lembrada neste navegador.
 *
 * O ponto A pode ser PRÉ-PREENCHIDO com a média dos últimos meses lançados, com a origem de cada
 * número marcada ("calculado das métricas" × "informado"). É uma FOTO do diagnóstico, não um número
 * que se atualiza: se andasse todo mês, a régua das metas se moveria junto.
 *
 * Os NÚMEROS das metas de 6 e 12 meses moram na mesma tabela de metas de sempre: o que se preenche
 * aqui aparece também em "Metas combinadas". O que a tabela de metas não guarda — o diagnóstico e os
 * textos — tem tabela própria.
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
  const [previaAberta, setPreviaAberta] = React.useState(false)
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
      // Sem os modelos o seletor fica vazio, mas dá pra escrever à mão — não vale um aviso a mais.
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
    let usadas: string[] = []
    setRascunho((r) => {
      if (!r) return r
      const proximo = { ...r, origens: { ...r.origens } }
      for (const c of CAMPOS_DO_A) {
        const s = sugestao.campos[c.campo]
        if (!s) continue
        if (soVazios && proximo[c.campo].trim() !== '') continue
        proximo[c.campo] = numeroParaCampo(s.valor)
        proximo.origens[c.api] = { origem: 'calculado', meses: s.meses }
        usadas = s.meses.length > usadas.length ? s.meses : usadas
      }
      return proximo
    })
    return usadas
  }, [sugestao])

  React.useEffect(() => {
    // Uma vez por planejamento carregado, e só em campo vazio: nunca sobrescreve número já salvo.
    if (!api || prefillFeito.current === api) return
    prefillFeito.current = api
    if (sugestao.meses.length === 0) return
    const preenchidos = CAMPOS_DO_A.filter((c) => (doApi(api) as unknown as Record<string, string>)[c.campo].trim() === '' && sugestao.campos[c.campo])
    if (preenchidos.length === 0) return
    aplicarMedia(true)
    setMediaAplicada(rotuloDosMeses(sugestao.meses))
  }, [api, sugestao, aplicarMedia])

  // ---- recolher / abrir
  const plano = React.useMemo(() => (rascunho ? planoDoRascunho(rascunho) : null), [rascunho])
  const planoSalvo = React.useMemo(() => (api ? planoDaApi(api) : null), [api])
  const completo = planoSalvo ? planejamentoCompleto(planoSalvo) : false

  React.useEffect(() => {
    // Só decide uma vez, quando o planejamento chega: a escolha lembrada vale; sem ela, abre se incompleto.
    if (!api || aberto !== null) return
    let lembrado: string | null = null
    try {
      lembrado = window.localStorage.getItem(CHAVE_ABERTO(clienteId))
    } catch {
      /* sem armazenamento: vale a regra padrão */
    }
    setAberto(lembrado === '1' ? true : lembrado === '0' ? false : !planejamentoCompleto(planoDaApi(api)))
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

  const avisos = React.useMemo(() => (plano ? validarRealismo(plano) : []), [plano])
  const realizado = React.useMemo(() => realizadoPorMes(metricas), [metricas])
  const sujo = rascunho !== null && JSON.stringify(rascunho) !== inicial

  const chavesComRota = React.useMemo(
    () => (plano ? CHAVES_PLANO.filter(({ chave }) => rotaProjetada(plano, chave).length > 0) : []),
    [plano],
  )
  const chaveEfetiva = chavesComRota.some((c) => c.chave === chaveGrafico)
    ? chaveGrafico
    : (chavesComRota[0]?.chave ?? chaveGrafico)
  const linhasDaProjecao = React.useMemo(
    () => (plano ? projecaoMensal(plano, chaveEfetiva, realizado, mesAtual()) : []),
    [plano, chaveEfetiva, realizado],
  )

  if (carregando || !rascunho || !plano) {
    return (
      <section className="flex items-center justify-center gap-2 rounded-xl border border-line p-8 text-sm text-foreground/60">
        <Loader2 className="h-4 w-4 animate-spin" /> Carregando planejamento…
      </section>
    )
  }

  const mudar = <K extends keyof Rascunho>(campo: K, valor: Rascunho[K]) =>
    setRascunho((r) => (r ? { ...r, [campo]: valor } : r))
  /** Digitar num número do ponto A o torna "informado": deixou de ser a média calculada. */
  const mudarPontoA = (campo: CampoDoPontoA, api: string, valor: string) =>
    setRascunho((r) =>
      r ? { ...r, [campo]: valor, origens: { ...r.origens, [api]: { origem: 'informado' as const } } } : r,
    )
  const mudarCenario = (h: HorizontePlano, campo: 'objetivo' | 'estrategia' | 'premissas', valor: string) =>
    setRascunho((r) => (r ? { ...r, cenarios: { ...r.cenarios, [h]: { ...r.cenarios[h], [campo]: valor } } } : r))
  const mudarMeta = (h: HorizontePlano, chave: ChavePlano, valor: string) =>
    setRascunho((r) =>
      r
        ? { ...r, cenarios: { ...r.cenarios, [h]: { ...r.cenarios[h], metas: { ...r.cenarios[h].metas, [chave]: valor } } } }
        : r,
    )

  const ctxDeVariaveis = contextoDeVariaveis(plano, cliente ?? {})
  /** Aplica um modelo a um texto: troca as variáveis, e substitui ou acrescenta conforme a escolha. */
  const aplicarModelo = (atual: string, modelo: string, modo: 'substituir' | 'acrescentar') => {
    const texto = aplicarVariaveis(modelo, ctxDeVariaveis)
    return modo === 'acrescentar' && atual.trim() ? `${atual.replace(/\s+$/, '')}\n\n${texto}` : texto
  }

  const salvar = async () => {
    const conv = numeroDigitado(rascunho.conversao)
    if (conv !== null && (conv < 0 || conv > 100)) {
      toast.error('A taxa de conversão fica entre 0 e 100%')
      return
    }
    setSalvando(true)
    try {
      const salvo = await gestaoClientes.salvarPlanejamento(clienteId, paraEntrada(rascunho))
      aplicar(salvo)
      setMediaAplicada('')
      // A conferência roda sobre o que FOI gravado — é o que o time vai ver depois.
      const conferencia = validarRealismo(planoDaApi(salvo))
      const graves = conferencia.filter((a) => a.nivel === 'alerta')
      if (graves.length > 0) {
        const g = graves[0]
        toast.warning(
          `Planejamento salvo, mas ${graves.length} ponto(s) não fecham a conta` +
            (g.investimentoNecessario ? ` — ${g.titulo.split(':')[0].toLowerCase()} pede cerca de ${formatarMetrica(g.investimentoNecessario, 'reais')}/mês` : ''),
        )
      } else if (conferencia.some((a) => a.nivel === 'atencao')) {
        toast.success('Planejamento salvo — há pontos de atenção nos avisos de realismo')
      } else {
        toast.success('Planejamento salvo')
      }
      if (!salvo.atual.data_diagnostico) {
        toast.info('Sem a data do diagnóstico não dá pra traçar a rota mês a mês.')
      }
      setHistorico(null)
      await onMetasMudaram()
    } catch (err) {
      toast.error('Falha ao salvar o planejamento: ' + (err as Error).message)
    } finally {
      setSalvando(false)
    }
  }

  const base = baseDoPontoA(plano.atual)
  const falta = faltaNoPlanejamento(plano)
  const resumo = resumoLinha(plano)
  const mesAgora = mesAtual()
  const naRota = avaliarMesContraRota(plano, realizado[mesAgora] ?? {}, mesAgora)
  const ruins = naRota.filter((r) => r.boa === false)
  const estadoDoMes = ruins.some((r) => Math.abs(r.desvioPct) > 40)
    ? { estado: 'risco' as const, texto: 'Muito abaixo da rota' }
    : ruins.some((r) => Math.abs(r.desvioPct) > 20)
      ? { estado: 'atencao' as const, texto: 'Abaixo da rota' }
      : naRota.length > 0
        ? { estado: 'otimo' as const, texto: 'No caminho' }
        : null

  /** Enter desce pra mesma coluna da linha de baixo, como em planilha. */
  const aoTeclar = (e: React.KeyboardEvent<HTMLInputElement>, h: HorizontePlano, indice: number) => {
    if (e.key !== 'Enter') return
    e.preventDefault()
    const proximo = document.querySelector<HTMLInputElement>(`[data-plano="${h}-${indice + 1}"]`)
    proximo?.focus()
    proximo?.select()
  }

  const temSugestao = Object.keys(sugestao.campos).length > 0
  const algumNumero = CAMPOS_DO_A.some((c) => rascunho[c.campo].trim() !== '')

  /** O rótulo de um texto, com o seletor de modelo ao lado. */
  const rotuloComModelo = (rotulo: string, campo: GcCampoModelo, texto: string, aoAplicar: (t: string) => void) => (
    <div className="mb-1.5 flex items-center justify-between gap-2">
      <span className="text-xs font-medium text-foreground/70">{rotulo}</span>
      <SeletorDeModelo
        campo={campo}
        modelos={modelos}
        textoAtual={texto}
        onAplicar={(m, modo) => aoAplicar(aplicarModelo(texto, m, modo))}
        onGerenciar={() => setGerenciando(campo)}
      />
    </div>
  )

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
              {estadoDoMes && <PastilhaSaude estado={estadoDoMes.estado} texto={estadoDoMes.texto} />}
              {completo ? null : (
                <span className="rounded-full border border-warning/30 bg-warning/10 px-2 py-0.5 text-[11px] text-warning">
                  incompleto
                </span>
              )}
            </span>
            {resumo ? (
              <span className="mt-0.5 block truncate text-xs text-foreground/60" title={resumo}>
                {resumo}
              </span>
            ) : (
              <span className="mt-0.5 block text-xs text-foreground/50">
                Ainda não há ponto de partida nem metas. Abra pra montar.
              </span>
            )}
            {!completo && falta.length > 0 && (
              <span className="mt-0.5 block text-[11px] text-warning/90">Falta: {falta.join(', ')}</span>
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
        <p className="mb-3 max-w-2xl text-xs text-foreground/55">
          De onde o cliente parte, onde a gente quer chegar em 6 e 12 meses e o caminho entre os dois. As metas
          numéricas dos cenários são as mesmas de "Metas combinadas" mais abaixo.
        </p>

        {/* ---------------------------------------------------------------- 1. cenário atual */}
        <div className="rounded-xl border border-line bg-surface p-3">
          <h3 className="mb-2 text-sm font-semibold text-foreground">1 · Cenário atual — o ponto A</h3>
          <div>
            {rotuloComModelo('Situação de hoje', 'situacao', rascunho.situacao, (t) => mudar('situacao', t))}
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

          <div className="mt-3 grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
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
                  {!temValor && c.ajuda && <p className="mt-1 text-[11px] text-foreground/40">{c.ajuda}</p>}
                </div>
              )
            })}
            <CampoData label="Data do diagnóstico" value={rascunho.data} onChange={(v) => mudar('data', v)} />
          </div>

          {temSugestao && (
            <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-foreground/50">
              <Button
                variant="ghost"
                size="sm"
                leftIcon={<Calculator className="h-3.5 w-3.5" />}
                onClick={() => (algumNumero ? setConfirmandoMedia(true) : (aplicarMedia(false), setMediaAplicada(rotuloDosMeses(sugestao.meses))))}
              >
                {algumNumero ? 'Recalcular da média dos últimos meses' : 'Preencher com a média dos últimos meses'}
              </Button>
              <span>
                média de {sugestao.meses.length} mês(es) lançado(s): {rotuloDosMeses(sugestao.meses)}
              </span>
            </div>
          )}
        </div>

        {/* ---------------------------------------------------------------- 2. grade dos cenários */}
        <div className="mt-3 rounded-xl border border-line bg-surface p-3">
          <h3 className="mb-1 flex items-center gap-2 text-sm font-semibold text-foreground">
            <Target className="h-4 w-4 text-accent" /> 2 · Metas dos cenários de 6 e 12 meses
          </h3>
          <p className="mb-2 text-xs text-foreground/50">
            Preencha tudo de uma vez — <strong>Enter</strong> desce pra linha de baixo. O ponto A é calculado do
            cenário atual. Campo vazio apaga aquela meta.
          </p>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs uppercase tracking-wide text-foreground/45">
                <tr>
                  <th className="py-1.5 pr-3 font-medium">Métrica</th>
                  <th className="px-2 py-1.5 text-right font-medium">Ponto A</th>
                  {HORIZONTES_PLANO.map((h) => (
                    <th key={h.valor} className="px-2 py-1.5 text-right font-medium">
                      Meta em {h.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {CHAVES_PLANO.map(({ chave, label }, indice) => {
                  const unidade = metricaUnidade(chave)
                  return (
                    <tr key={chave} className="border-t border-line">
                      <td className="py-1.5 pr-3 font-medium text-foreground/85">{label}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums text-foreground/55">
                        {base[chave] === undefined ? '—' : formatarMetrica(base[chave]!, unidade)}
                      </td>
                      {HORIZONTES_PLANO.map((h) => (
                        <td key={h.valor} className="px-1.5 py-1">
                          <input
                            data-plano={`${h.valor}-${indice}`}
                            value={rascunho.cenarios[h.valor].metas[chave]}
                            onChange={(e) => mudarMeta(h.valor, chave, e.target.value)}
                            onKeyDown={(e) => aoTeclar(e, h.valor, indice)}
                            onFocus={(e) => e.target.select()}
                            inputMode="decimal"
                            placeholder={unidade === 'reais' || unidade === 'decimal' ? '0,00' : '0'}
                            className="h-8 w-full min-w-[96px] rounded-md border border-line bg-surface px-2 text-right text-sm tabular-nums text-foreground outline-none placeholder:text-foreground/25 focus:border-accent focus:ring-2 focus:ring-accent/15"
                          />
                        </td>
                      ))}
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          {/* ------------------------------------------------------------ realismo */}
          {avisos.length > 0 && (
            <div className="mt-3 space-y-2">
              <p className="text-xs font-medium uppercase tracking-wide text-foreground/45">Conferência de realismo</p>
              {avisos.map((a, i) => {
                const n = NIVEL_AVISO[a.nivel]
                const Icone = n.icone
                const sugerido = a.investimentoNecessario ? Math.ceil(a.investimentoNecessario / 10) * 10 : null
                const atualInv = numeroDigitado(rascunho.cenarios[a.horizonte].metas.investimento)
                return (
                  <div key={i} className={cn('flex items-start gap-2.5 rounded-lg border px-3 py-2', n.classe)}>
                    <Icone className={cn('mt-0.5 h-4 w-4 shrink-0', n.cor)} />
                    <div className="min-w-0 flex-1 text-sm">
                      <p className="font-medium text-foreground">
                        {a.titulo} <span className={cn('text-[11px] font-normal', n.cor)}>· {n.rotulo}</span>
                      </p>
                      <p className="text-xs text-foreground/70">{a.texto}</p>
                    </div>
                    {sugerido !== null && atualInv !== sugerido && (
                      <Button
                        size="sm"
                        variant="secondary"
                        className="shrink-0"
                        leftIcon={<Wand2 className="h-3.5 w-3.5" />}
                        onClick={() => mudarMeta(a.horizonte, 'investimento', numeroParaCampo(sugerido))}
                      >
                        Usar {formatarMetrica(sugerido, 'reais')}
                      </Button>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {/* ---------------------------------------------------------------- textos dos cenários */}
        <div className="mt-3 grid gap-3 lg:grid-cols-2">
          {HORIZONTES_PLANO.map((h) => {
            const c = rascunho.cenarios[h.valor]
            return (
              <div key={h.valor} className="rounded-xl border border-line bg-surface p-3">
                <h3 className="mb-2 text-sm font-semibold text-foreground">Cenário de {h.label}</h3>
                <div className="space-y-3">
                  <div>
                    {rotuloComModelo('Onde quer chegar', 'objetivo', c.objetivo, (t) => mudarCenario(h.valor, 'objetivo', t))}
                    <Textarea
                      rows={2}
                      value={c.objetivo}
                      onChange={(e) => mudarCenario(h.valor, 'objetivo', e.target.value)}
                      placeholder="O objetivo, na linguagem do negócio do cliente."
                    />
                  </div>
                  <div>
                    {rotuloComModelo('Estratégia', 'estrategia', c.estrategia, (t) => mudarCenario(h.valor, 'estrategia', t))}
                    <Textarea
                      rows={3}
                      value={c.estrategia}
                      onChange={(e) => mudarCenario(h.valor, 'estrategia', e.target.value)}
                      placeholder="O que vamos fazer pra chegar lá."
                    />
                    <p className="mt-1 flex items-center gap-1 text-[11px] text-foreground/40">
                      <Lock className="h-3 w-3" /> interna — nunca vai pro portal
                    </p>
                  </div>
                  <div>
                    {rotuloComModelo('Premissas', 'premissas', c.premissas, (t) => mudarCenario(h.valor, 'premissas', t))}
                    <Textarea
                      rows={3}
                      value={c.premissas}
                      onChange={(e) => mudarCenario(h.valor, 'premissas', e.target.value)}
                      placeholder="O que precisa ser verdade: CPL cair com criativo novo, cliente atender em 5 min…"
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
            <div className="flex flex-wrap items-center gap-3">
              <div className="flex overflow-hidden rounded-lg border border-line" role="group" aria-label="Curva de crescimento">
                {(
                  [
                    { valor: 'linear', rotulo: 'Linear', ajuda: 'o mesmo tanto a cada mês' },
                    { valor: 'composta', rotulo: 'Composta', ajuda: 'a mesma % a cada mês, em cima do mês anterior' },
                  ] as const
                ).map((c) => (
                  <button
                    key={c.valor}
                    type="button"
                    title={c.ajuda}
                    onClick={() => mudar('curva', c.valor)}
                    aria-pressed={rascunho.curva === c.valor}
                    className={cn(
                      'h-8 px-3 text-xs transition-colors',
                      rascunho.curva === c.valor
                        ? 'bg-elevate/[0.08] text-foreground'
                        : 'text-foreground/50 hover:text-foreground/80',
                    )}
                  >
                    {c.rotulo}
                  </button>
                ))}
              </div>
              {chavesComRota.length > 0 && (
                <Select
                  options={chavesComRota.map((c) => ({ value: c.chave, label: c.label }))}
                  value={chaveEfetiva}
                  onChange={(e) => setChaveGrafico(e.target.value as ChavePlano)}
                  className="w-40"
                />
              )}
            </div>
          </div>

          {chavesComRota.length === 0 ? (
            <p className="py-6 text-center text-sm text-foreground/45">
              Pra traçar a rota, preencha a <strong>data do diagnóstico</strong>, o ponto A e pelo menos uma meta.
            </p>
          ) : (
            <>
              <p className="mb-3 text-xs text-foreground/50">
                {HORIZONTES_PLANO.every((h) => plano.metas[h.valor][chaveEfetiva] !== undefined)
                  ? 'A rota passa pela meta de 6 meses antes de seguir pra de 12 — a de 6 é um ponto de passagem, não uma linha à parte. '
                  : 'Rota do ponto A até a meta. '}
                {rascunho.curva === 'linear'
                  ? 'Linear: o mesmo tanto a cada mês.'
                  : 'Composta: a mesma percentagem a cada mês, em cima do mês anterior.'}{' '}
                "No caminho" é estar a menos de 10% do projetado.
              </p>
              <GraficoProjecao linhas={linhasDaProjecao} chave={chaveEfetiva} />
              <div className="mt-3">
                <TabelaProjecao linhas={linhasDaProjecao} chave={chaveEfetiva} />
              </div>
            </>
          )}
        </div>

        {/* ---------------------------------------------------------------- portal */}
        <div className="mt-3 rounded-xl border border-line bg-surface p-3">
          <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-semibold text-foreground">Portal do cliente — "Nossa jornada"</h3>
            <Button
              variant="secondary"
              size="sm"
              leftIcon={<Eye className="h-3.5 w-3.5" />}
              disabled={sujo}
              title={sujo ? 'Salve o planejamento primeiro — a prévia mostra o que está salvo' : undefined}
              onClick={() => setPreviaAberta(true)}
            >
              Ver como o cliente vê
            </Button>
          </div>
          <p className="mb-2 text-xs text-foreground/50">
            Desligado por padrão. Ligado, o cliente vê o cenário atual (só os números), as metas de 6 e 12 meses e o
            gráfico de realizado × projeção — com o realizado dos meses de relatório já publicado. Use a prévia
            antes de ligar.{sujo && ' (Salve as alterações pra a prévia refletir.)'}
          </p>
          <label className="flex cursor-pointer items-center gap-2 text-sm text-foreground/85">
            <input
              type="checkbox"
              checked={rascunho.portalAtivo}
              onChange={(e) => mudar('portalAtivo', e.target.checked)}
              className="h-4 w-4 rounded border-line"
            />
            Mostrar "Nossa jornada" no portal deste cliente
          </label>
          <div className={cn('ml-6 mt-2 space-y-1.5', !rascunho.portalAtivo && 'opacity-45')}>
            <label className="flex cursor-pointer items-center gap-2 text-sm text-foreground/75">
              <input
                type="checkbox"
                disabled={!rascunho.portalAtivo}
                checked={rascunho.portalSituacao}
                onChange={(e) => mudar('portalSituacao', e.target.checked)}
                className="h-3.5 w-3.5 rounded border-line"
              />
              Mostrar o texto "situação de hoje"
            </label>
            <label className="flex cursor-pointer items-center gap-2 text-sm text-foreground/75">
              <input
                type="checkbox"
                disabled={!rascunho.portalAtivo}
                checked={rascunho.portalObjetivo}
                onChange={(e) => mudar('portalObjetivo', e.target.checked)}
                className="h-3.5 w-3.5 rounded border-line"
              />
              Mostrar o texto "onde quer chegar" de cada cenário
            </label>
            <p className="flex items-center gap-1 text-xs text-foreground/45">
              <Lock className="h-3 w-3" /> Estratégia e premissas nunca vão pro portal.
            </p>
          </div>
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
      <PreviaPortal aberto={previaAberta} clienteId={clienteId} onFechar={() => setPreviaAberta(false)} />
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
