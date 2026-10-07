import * as React from 'react'
import { AlertTriangle, Calculator, ChevronDown, Loader2, Lock, Route, Target } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/Button'
import { Input, Textarea } from '@/components/ui/Input'
import { Modal } from '@/components/ui/Modal'
import { CampoData } from '@/components/gestaoClientes/CampoData'
import { type AlvoDeModelo } from '@/components/gestaoClientes/ModelosDeTexto'
import { BarraSalvar } from '@/components/gestaoClientes/BarraSalvar'
import { PastilhaSaude } from '@/components/gestaoClientes/Semaforo'
import { RoteiroDoPlano } from '@/components/gestaoClientes/RoteiroDoPlano'
import { CenarioEmPassos, ProjecaoXReal } from '@/components/gestaoClientes/ProjecaoXReal'
import { useAvisoAoSair } from '@/hooks/useAvisoAoSair'
import {
  gestaoClientes,
  type GcCampoModelo, type GcMetrica, type GcModeloTexto,
  type GcOrigemCampo, type GcPlanejamentoApi, type GcPlanejamentoEntrada,
} from '@/services/gestaoClientes'
import {
  CHAVES_CALCULADAS, CHAVES_DIGITADAS, CHAVES_PLANO, HORIZONTES_PLANO, doPrimeiroMes, aplicarVariaveis, avaliarMesContraRota,
  avisosDeCplImplicito, baseDoPontoA, comMetasCalculadas, comPartidaDasMetricas, contextoDeVariaveis,
  estadoDoPlanejamento, hojeISO, montarPontoA, projecaoMensal, realizadoPorMes, resumoLinha, rotaProjetada,
  sugerirPontoA, validarRealismo, variacaoContraPontoA, type CampoDoPontoA, type ChavePlano,
  type HorizontePlano, type Planejamento,
} from '@/lib/gcPlanejamento'
import { planoDaApi } from '@/lib/gcPlanoAdaptadores'
import { formatarMetrica, mascararCampo, mesAtual, numeroDigitado, numeroParaCampo } from '@/lib/gcMetricas'
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
  /** O primeiro mês do plano (pra quem começa a investir): investimento, vendas e faturamento esperados. */
  mes1: { investimento: string; vendas: string; receita: string }
  /** A estratégia que está sendo usada hoje (texto livre, interno). */
  estrategiaUsada: string
  /** CPL médio estimado: transforma o investimento do mês 1 (e dos meses sem meta de leads) em leads. */
  cplMedio: string
  /** O funil por coluna: CPL (só 6/12), taxa de agendamento e de conversão em %, ticket médio. */
  funil: Record<ColunaDaGrade, FunilDaColuna>
  cenarios: Record<HorizontePlano, {
    objetivo: string
    /** "Estratégia e premissas": interna, nunca vai pro portal. */
    estrategia: string
    metas: Record<ChaveDigitada, string>
  }>
}

interface FunilDaColuna { cpl: string; agendamento: string; conversao: string; ticket: string }

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
    mes1: {
      investimento: numeroParaCampo(a.primeiro_mes?.investimento),
      vendas: numeroParaCampo(a.primeiro_mes?.vendas),
      receita: numeroParaCampo(a.primeiro_mes?.faturamento),
    },
    cplMedio: numeroParaCampo(a.primeiro_mes?.cpl_medio),
    funil: Object.fromEntries(
      (['mes1', '6_meses', '12_meses'] as ColunaDaGrade[]).map((c) => [
        c,
        {
          cpl: numeroParaCampo(a.funil?.[c]?.cpl),
          agendamento: numeroParaCampo(a.funil?.[c]?.agendamento),
          conversao: numeroParaCampo(a.funil?.[c]?.conversao),
          ticket: numeroParaCampo(a.funil?.[c]?.ticket),
        },
      ]),
    ) as Record<ColunaDaGrade, FunilDaColuna>,
    estrategiaUsada: a.estrategia_usada ?? '',
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
  const pm: NonNullable<Planejamento['primeiroMes']> = {}
  const inv1 = numeroDigitado(r.mes1.investimento)
  const ven1 = numeroDigitado(r.mes1.vendas)
  const rec1 = numeroDigitado(r.mes1.receita)
  if (inv1 !== null) pm.investimento = inv1
  if (ven1 !== null) pm.vendas = ven1
  if (rec1 !== null) pm.receita = rec1
  const cpl = numeroDigitado(r.cplMedio)
  return {
    ...(Object.keys(pm).length ? { primeiroMes: pm } : {}),
    ...(cpl !== null ? { cplMedio: cpl } : {}),
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

/**
 * O rascunho com os números como NÚMEROS, pra comparar "o que está na tela" com "o que está salvo" sem
 * que a máscara ("2000" → "2.000,00") conte como alteração.
 */
function normalizado(r: Rascunho) {
  const n = (t: string) => numeroDigitado(t)
  return {
    ...r,
    leads: n(r.leads), investimento: n(r.investimento), vendas: n(r.vendas), receita: n(r.receita),
    mes1: { investimento: n(r.mes1.investimento), vendas: n(r.mes1.vendas), receita: n(r.mes1.receita) },
    cplMedio: n(r.cplMedio),
    funil: Object.fromEntries(
      Object.entries(r.funil).map(([c, f]) => [c, { cpl: n(f.cpl), agendamento: n(f.agendamento), conversao: n(f.conversao), ticket: n(f.ticket) }]),
    ),
    cenarios: Object.fromEntries(
      (Object.keys(r.cenarios) as HorizontePlano[]).map((h) => [
        h,
        { ...r.cenarios[h], metas: Object.fromEntries(Object.entries(r.cenarios[h].metas).map(([k, v]) => [k, n(v)])) },
      ]),
    ),
  }
}

/**
 * O FUNIL: investimento ÷ CPL = leads; leads × taxa de agendamento = agendamentos; × taxa de conversão = vendas;
 * vendas × ticket = faturamento. Preenche leads, vendas e faturamento da coluna quando há dados pra conta;
 * os campos seguem editáveis (digitar por cima vale até mexer de novo no funil).
 */
function aplicarFunil(r: Rascunho, coluna: ColunaDaGrade): Rascunho {
  const f = r.funil[coluna]
  const mes1 = coluna === 'mes1'
  const inv = numeroDigitado(mes1 ? r.mes1.investimento : r.cenarios[coluna].metas.investimento)
  const cpl = numeroDigitado(mes1 ? r.cplMedio : f.cpl)
  const ag = numeroDigitado(f.agendamento)
  const conv = numeroDigitado(f.conversao)
  const ticket = numeroDigitado(f.ticket)
  if (inv === null || !cpl || cpl <= 0) return r
  const leads = inv / cpl
  const agendamentos = ag !== null ? leads * (ag / 100) : leads
  const vendas = conv !== null ? Math.round(agendamentos * (conv / 100)) : null
  const receita = vendas !== null && ticket !== null ? vendas * ticket : null
  const texto = (n: number) => numeroParaCampo(n)
  if (mes1) {
    return {
      ...r,
      mes1: { ...r.mes1, ...(vendas !== null ? { vendas: texto(vendas) } : {}), ...(receita !== null ? { receita: texto(receita) } : {}) },
    }
  }
  const metas = {
    ...r.cenarios[coluna].metas,
    leads: texto(Math.round(leads)),
    ...(vendas !== null ? { vendas: texto(vendas) } : {}),
    ...(receita !== null ? { receita: texto(receita) } : {}),
  }
  return { ...r, cenarios: { ...r.cenarios, [coluna]: { ...r.cenarios[coluna], metas } } }
}

const CHAVE_RASCUNHO = (id: string) => `gc:planejamento:rascunho:${id}`

function paraEntrada(r: Rascunho): GcPlanejamentoEntrada {
  const plano = planoDoRascunho(r)
  const inv1 = numeroDigitado(r.mes1.investimento)
  const ven1 = numeroDigitado(r.mes1.vendas)
  const rec1 = numeroDigitado(r.mes1.receita)
  const cpl = numeroDigitado(r.cplMedio)
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
    estrategia_usada: r.estrategiaUsada,
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
    primeiro_mes: {
      investimento: inv1, vendas: ven1, faturamento: rec1, cpl_medio: cpl,
    },
    funil: Object.fromEntries(
      Object.entries(r.funil).map(([c, f]) => [
        c,
        { cpl: numeroDigitado(f.cpl), agendamento: numeroDigitado(f.agendamento), conversao: numeroDigitado(f.conversao), ticket: numeroDigitado(f.ticket) },
      ]),
    ),
    cenarios: { '6_meses': cen('6_meses'), '12_meses': cen('12_meses') },
  }
}

const NOMES_MES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez']
/** ['2026-06','2026-07','2026-08'] → "jun, jul, ago/26". */
function rotuloDosMeses(meses: string[] | undefined): string {
  if (!meses || meses.length === 0) return ''
  const nomes = meses.map((m) => NOMES_MES[Number(m.slice(5, 7)) - 1])
  return `${nomes.join(', ')}/${meses[meses.length - 1].slice(2, 4)}`
}

const dataBR = (iso: string) => iso.slice(0, 10).split('-').reverse().join('/')

/** O cabeçalho de cada passo do plano: um número, a PERGUNTA que ele responde e uma linha de apoio. */
function Passo({ numero, pergunta, apoio }: { numero: number; pergunta: string; apoio: string }) {
  return (
    <div className="mb-3 flex items-start gap-2.5">
      <span className="mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full bg-accent/15 text-xs font-bold text-accent">{numero}</span>
      <div>
        <h3 className="text-sm font-semibold text-foreground">{pergunta}</h3>
        <p className="text-xs text-foreground/50">{apoio}</p>
      </div>
    </div>
  )
}

const CHAVE_ABERTO = (id: string) => `gc:planejamento:aberto:${id}`

/** As colunas da grade do plano, na ordem em que aparecem: o primeiro mês e as duas metas. */
type ColunaDaGrade = 'mes1' | HorizontePlano
const COLUNAS_DA_GRADE: ColunaDaGrade[] = ['mes1', '6_meses', '12_meses']
const ROTULO_DA_COLUNA: Record<ColunaDaGrade, string> = { mes1: 'Mês 1', '6_meses': 'Meta 6 meses', '12_meses': 'Meta 12 meses' }
/** As linhas, na ordem de leitura: o que investir, o CPL que se espera, os leads que isso dá, vendas e faturamento. */
const LINHAS_DA_GRADE: ChavePlano[] = ['investimento', 'leads', 'vendas', 'receita', 'cpl', 'roas']
const ROTULO_DA_LINHA: Record<ChavePlano, string> = {
  investimento: 'Investimento', leads: 'Leads', vendas: 'Vendas', receita: 'Faturamento', cpl: 'CPL', roas: 'ROAS',
}

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
  recolhivel = true,
  onMetasMudaram,
}: {
  clienteId: string
  metricas: GcMetrica[]
  /** Pra trocar {cliente} e {segmento} nos modelos de texto. */
  cliente?: { nome_empresa?: string | null; segmento?: string | null }
  /** Falso na aba Planejamento: o bloco fica sempre aberto, sem o recolher. */
  recolhivel?: boolean
  /** Chamado depois de salvar: as metas mudaram e a seção "Metas combinadas" precisa recarregar. */
  onMetasMudaram: () => Promise<void> | void
}) {
  const [api, setApi] = React.useState<GcPlanejamentoApi | null>(null)
  const [rascunho, setRascunho] = React.useState<Rascunho | null>(null)
  const [inicial, setInicial] = React.useState('')
  const [carregando, setCarregando] = React.useState(true)
  const [salvando, setSalvando] = React.useState(false)
  const [abertoEscolhido, setAberto] = React.useState<boolean | null>(null)
  const aberto = recolhivel ? abertoEscolhido : true
  const [modelos, setModelos] = React.useState<GcModeloTexto[]>([])
  const [gerenciando, setGerenciando] = React.useState<GcCampoModelo | null>(null)
  const [confirmandoMedia, setConfirmandoMedia] = React.useState(false)
  const [mediaAplicada, setMediaAplicada] = React.useState<string>('')
  const prefillFeito = React.useRef<GcPlanejamentoApi | null>(null)
  /** Rascunho de uma sessão anterior (guardado no navegador) à espera de o usuário decidir. */
  const [guardado, setGuardado] = React.useState<{ rascunho: Rascunho; em: string } | null>(null)
  const rascunhoVerificado = React.useRef(false)

  const sugestao = React.useMemo(() => sugerirPontoA(metricas, mesAtual()), [metricas])

  const aplicar = React.useCallback((a: GcPlanejamentoApi) => {
    const r = doApi(a)
    setApi(a)
    setRascunho(r)
    setInicial(JSON.stringify(normalizado(r)))
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
    if (!recolhivel || !api || abertoEscolhido !== null) return
    let lembrado: string | null = null
    try {
      lembrado = window.localStorage.getItem(CHAVE_ABERTO(clienteId))
    } catch {
      /* sem armazenamento: vale a regra padrão */
    }
    setAberto(lembrado === '1')
  }, [api, recolhivel, abertoEscolhido, clienteId])

  const alternar = (valor: boolean) => {
    setAberto(valor)
    try {
      window.localStorage.setItem(CHAVE_ABERTO(clienteId), valor ? '1' : '0')
    } catch {
      /* a escolha vale até recarregar */
    }
  }

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
  const sujo = rascunho !== null && JSON.stringify(normalizado(rascunho)) !== inicial
  useAvisoAoSair(sujo)

  // ---- rascunho automático: o que foi digitado e não salvo fica guardado neste navegador (trocar de
  // aba ou fechar sem querer não joga o trabalho fora) e é oferecido de volta na próxima abertura.
  React.useEffect(() => {
    if (!api || !rascunho || rascunhoVerificado.current) return
    rascunhoVerificado.current = true
    try {
      const bruto = window.localStorage.getItem(CHAVE_RASCUNHO(clienteId))
      if (!bruto) return
      const lido = JSON.parse(bruto) as { rascunho: Rascunho; em: string }
      // Rascunho igual ao que já está salvo não tem o que oferecer.
      if (JSON.stringify(normalizado(lido.rascunho)) === inicial) {
        window.localStorage.removeItem(CHAVE_RASCUNHO(clienteId))
        return
      }
      setGuardado(lido)
    } catch {
      /* sem armazenamento ou rascunho ilegível: segue sem ele */
    }
  }, [api, rascunho, inicial, clienteId])

  React.useEffect(() => {
    if (!rascunho || !rascunhoVerificado.current || guardado) return
    const t = window.setTimeout(() => {
      try {
        if (sujo) {
          window.localStorage.setItem(
            CHAVE_RASCUNHO(clienteId),
            JSON.stringify({ rascunho, em: new Date().toISOString() }),
          )
        } else {
          window.localStorage.removeItem(CHAVE_RASCUNHO(clienteId))
        }
      } catch {
        /* sem armazenamento: o aviso ao sair continua valendo */
      }
    }, 600)
    return () => window.clearTimeout(t)
  }, [rascunho, sujo, guardado, clienteId])

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
  const mudarFunil = (coluna: ColunaDaGrade, campo: keyof FunilDaColuna, valor: string) =>
    setRascunho((r) => (r ? aplicarFunil({ ...r, funil: { ...r.funil, [coluna]: { ...r.funil[coluna], [campo]: valor } } }, coluna) : r))
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
   * Enter e Tab descem pra mesma coluna da linha de baixo (pulando as células calculadas, que não têm
   * campo), como em planilha; no fim de uma coluna, seguem pro topo da próxima. Shift+Tab sobe.
   */
  const aoTeclar = (e: React.KeyboardEvent<HTMLInputElement>, coluna: ColunaDaGrade, chave: ChavePlano) => {
    const descer = e.key === 'Enter' || (e.key === 'Tab' && !e.shiftKey)
    const subir = e.key === 'Tab' && e.shiftKey
    if (!descer && !subir) return
    // No celular a grade vira cartões (outros campos, mesmos dados): procura entre os que estão à vista.
    const prefixo = window.matchMedia('(min-width: 640px)').matches ? '' : 'm-'
    const achar = (c: number, r: number) =>
      document.querySelector<HTMLInputElement>(`[data-plano="${prefixo}${COLUNAS_DA_GRADE[c]}-${LINHAS_DA_GRADE[r]}"]`)
    const ci = COLUNAS_DA_GRADE.indexOf(coluna)
    const ri = LINHAS_DA_GRADE.indexOf(chave)
    let alvo: HTMLInputElement | null = null
    if (descer) {
      for (let r = ri + 1; r < LINHAS_DA_GRADE.length && !alvo; r++) alvo = achar(ci, r)
      for (let c = ci + 1; c < COLUNAS_DA_GRADE.length && !alvo; c++) {
        for (let r = 0; r < LINHAS_DA_GRADE.length && !alvo; r++) alvo = achar(c, r)
      }
      if (!alvo && e.key === 'Enter') return e.preventDefault()
    } else {
      for (let r = ri - 1; r >= 0 && !alvo; r--) alvo = achar(ci, r)
      for (let c = ci - 1; c >= 0 && !alvo; c--) {
        for (let r = LINHAS_DA_GRADE.length - 1; r >= 0 && !alvo; r--) alvo = achar(c, r)
      }
    }
    if (!alvo) return
    e.preventDefault()
    alvo.focus()
    alvo.select()
  }

  /** O valor PLANEJADO numa célula (pro cálculo da variação e pro que aparece nas células calculadas). */
  const valorPlanejado = (coluna: ColunaDaGrade, chave: ChavePlano): number | undefined => {
    if (coluna === 'mes1') return doPrimeiroMes(plano, chave)
    const v = plano.metas[coluna][chave]
    // Sem meta de leads, o CPL das metas é o médio (a premissa) — é com ele que os leads são estimados.
    if (chave === 'cpl' && v === undefined && plano.metas[coluna].investimento !== undefined) return plano.cplMedio
    return v
  }
  const ehDigitada = (chave: ChavePlano) => chave !== 'roas' && (chave !== 'cpl')
  /** O texto do campo de uma célula DIGITÁVEL. */
  const textoDoCampo = (coluna: ColunaDaGrade, chave: ChavePlano): string => {
    if (coluna === 'mes1') return chave === 'cpl' ? rascunho.cplMedio : rascunho.mes1[chave as 'investimento' | 'vendas' | 'receita']
    return rascunho.cenarios[coluna].metas[chave as ChaveDigitada]
  }
  const mudarCampo = (coluna: ColunaDaGrade, chave: ChavePlano, valor: string) => {
    // Mexeu no investimento (ou no CPL do mês 1), o funil da coluna refaz leads, vendas e faturamento.
    const refaz = chave === 'investimento' || chave === 'cpl'
    if (coluna === 'mes1') {
      setRascunho((r) => {
        if (!r) return r
        const novo = chave === 'cpl' ? { ...r, cplMedio: valor } : { ...r, mes1: { ...r.mes1, [chave]: valor } }
        return refaz ? aplicarFunil(novo, 'mes1') : novo
      })
    } else {
      mudarMeta(coluna, chave as ChaveDigitada, valor)
      if (refaz) setRascunho((r) => (r ? aplicarFunil(r, coluna) : r))
    }
  }
  /**
   * Uma célula da grade. Digitável (campo com prefixo de unidade) ou CALCULADA (cinza, só leitura):
   *  - mês 1: investimento, vendas, faturamento e o CPL médio se digitam; leads e ROAS são calculados;
   *  - 6 e 12 meses: investimento, leads, vendas e faturamento se digitam; CPL e ROAS são calculados.
   */
  const celulaDaGrade = (coluna: ColunaDaGrade, chave: ChavePlano, mobile: boolean) => {
    const digitavel =
      coluna === 'mes1' ? ['investimento', 'vendas', 'receita', 'cpl'].includes(chave) : ['investimento', 'leads', 'vendas', 'receita'].includes(chave)
    const prefixo = PREFIXO[chave]
    const largura = mobile ? 'w-full' : 'ml-auto w-[150px]'
    if (!digitavel) {
      const v = valorPlanejado(coluna, chave)
      return (
        <div
          className={cn('relative rounded-md bg-elevate/[0.04] text-foreground/45', mobile ? 'h-10' : 'h-8', largura)}
          title="Calculado — não se digita"
        >
          {prefixo && <span className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-xs text-foreground/30">{prefixo}</span>}
          <span className={cn('absolute inset-y-0 right-2 flex items-center tabular-nums', mobile ? 'text-base' : 'text-sm')}>
            {chave === 'leads' ? (v === undefined ? '—' : Math.round(v).toLocaleString('pt-BR')) : textoCalculado(chave, v)}
          </span>
        </div>
      )
    }
    const placeholder =
      chave === 'cpl' && base.cpl !== undefined ? textoCalculado('cpl', base.cpl) : prefixo === 'R$' ? '0,00' : '0'
    return (
      <div className={cn('relative', largura)}>
        {prefixo && <span className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-xs text-foreground/40">{prefixo}</span>}
        <input
          data-plano={`${mobile ? 'm-' : ''}${coluna}-${chave}`}
          aria-label={`${ROTULO_DA_LINHA[chave]}, ${ROTULO_DA_COLUNA[coluna].toLowerCase()}`}
          value={textoDoCampo(coluna, chave)}
          onChange={(e) => mudarCampo(coluna, chave, e.target.value)}
          onKeyDown={(e) => aoTeclar(e, coluna, chave)}
          onBlur={(e) => mudarCampo(coluna, chave, mascararCampo(e.target.value, prefixo === 'R$' ? 'reais' : 'inteiro'))}
          onFocus={(e) => e.target.select()}
          inputMode="decimal"
          enterKeyHint="next"
          placeholder={placeholder}
          title={chave === 'cpl' ? 'CPL médio estimado — com ele, o investimento vira leads' : undefined}
          className={cn(
            'w-full rounded-md border border-line bg-surface pr-2 text-right tabular-nums text-foreground outline-none placeholder:text-foreground/10 focus:border-accent focus:ring-2 focus:ring-accent/15',
            mobile ? 'h-10 text-base' : 'h-8 text-sm',
            prefixo ? (mobile ? 'pl-7' : 'pl-8') : 'pl-2',
          )}
        />
      </div>
    )
  }

  const temSugestao = Object.keys(sugestao.campos).length > 0
  const algumNumero = CAMPOS_DO_A.some((c) => rascunho[c.campo].trim() !== '')
  const ticketCalculado = plano.atual.ticket
  const conversaoCalculada = plano.atual.conversao
  const semData = !planoDaRota.dataDiagnostico

  return (
    <section id="gc-planejamento" className="rounded-xl border border-accent/25 bg-accent/[0.015]">
      {/* ------------------------------------------------------------ cabeçalho (sempre visível) */}
      <div className="flex flex-wrap items-center gap-3 p-4">
        <button
          type="button"
          onClick={() => recolhivel && alternar(!aberto)}
          className={cn('flex min-w-0 flex-1 items-start gap-2.5 text-left', !recolhivel && 'cursor-default')}
          aria-expanded={!!aberto}
        >
          {recolhivel && (
            <ChevronDown
              className={cn('mt-1 h-4 w-4 shrink-0 text-foreground/40 transition-transform', !aberto && '-rotate-90')}
            />
          )}
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
            <Button className="hidden sm:inline-flex" variant="ghost" size="sm" onClick={() => api && aplicar(api)}>
              Descartar
            </Button>
          )}
          <Button className="hidden sm:inline-flex" onClick={() => void salvar()} loading={salvando} disabled={!sujo}>
            Salvar planejamento
          </Button>
        </div>
      </div>

      {/* O conteúdo fica MONTADO mesmo recolhido: desmontar jogaria fora o que está sendo digitado. */}
      <div className={cn('border-t border-accent/15 p-4', !aberto && 'hidden')}>
        {guardado && (
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-accent/30 bg-accent/[0.05] px-3 py-2 text-sm">
            <span className="text-foreground/85">
              Há um rascunho não salvo de{' '}
              {new Date(guardado.em).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}.
            </span>
            <span className="flex items-center gap-2">
              <Button
                size="sm"
                onClick={() => {
                  setRascunho({
                    ...guardado.rascunho,
                    funil: guardado.rascunho.funil ?? doApi({ ...(api as GcPlanejamentoApi), funil: undefined }).funil,
                  })
                  setGuardado(null)
                }}
              >
                Restaurar
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  try {
                    window.localStorage.removeItem(CHAVE_RASCUNHO(clienteId))
                  } catch {
                    /* nada a limpar */
                  }
                  setGuardado(null)
                }}
              >
                Descartar rascunho
              </Button>
            </span>
          </div>
        )}
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <p className="max-w-2xl text-xs text-foreground/55">
            Tudo é opcional: preencha o que souber, na ordem dos 4 passos. O resumo acima se monta sozinho.
          </p>
        </div>

        {/* ---------------------------------------------------------------- 1. ponto A */}
        <div className="rounded-xl border border-line bg-surface p-3">
          <Passo numero={1} pergunta="Onde o cliente está hoje?" apoio="O ponto de partida (Ponto A): o briefing e os números de hoje." />
          <div>
            <span className="mb-1.5 block text-xs font-medium text-foreground/70">Situação de hoje (o briefing)</span>
            <Textarea
              rows={3}
              value={rascunho.situacao}
              onChange={(e) => mudar('situacao', e.target.value)}
              placeholder="Conte o cenário do cliente conforme o briefing: o que já faz, o que não funciona, o que ele espera. Se ele ainda não faz tráfego, diga aqui. Leitura interna."
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
                    onBlur={() =>
                      setRascunho((r) =>
                        r ? { ...r, [c.campo]: mascararCampo(r[c.campo], c.label.includes('(R$)') ? 'reais' : 'inteiro') } : r,
                      )
                    }
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
            <Button
              variant="secondary"
              size="sm"
              title="Preenche leads, investimento, vendas e faturamento com zero: o cliente parte do zero"
              onClick={() =>
                setRascunho((r) =>
                  r
                    ? {
                        ...r, leads: '0', investimento: '0', vendas: '0', receita: '0',
                        data: r.data ?? hojeISO(), aguardando: false, lembrarEm: null,
                        origens: { ...r.origens, leads_mes: { origem: 'informado' }, investimento_mes: { origem: 'informado' }, vendas_mes: { origem: 'informado' }, faturamento_mensal: { origem: 'informado' } },
                      }
                    : r,
                )
              }
            >
              Cliente ainda não faz tráfego (partir do zero)
            </Button>
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
                  hint="Opcional · vira pendência em Estratégias"
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

        {/* ---------------------------------------------------------------- 2. o plano: mês 1 e metas */}
        <div className="mt-3 rounded-xl border border-line bg-surface p-3">
          <Passo
            numero={2}
            pergunta="Onde queremos chegar?"
            apoio="As metas. No Mês 1: quanto investir e o que se espera. Depois, 6 e 12 meses. Os leads saem do investimento ÷ CPL médio que você estima."
          />

          {/* Celular: um cartão por métrica, com as três colunas lado a lado. A tabela fica de tablet pra cima. */}
          <div className="space-y-2 sm:hidden">
            {LINHAS_DA_GRADE.map((chave) => (
              <div key={chave} className="rounded-lg border border-line p-2.5">
                <div className="flex items-baseline justify-between gap-2">
                  <span className={cn('text-sm font-medium', ehDigitada(chave) ? 'text-foreground/85' : 'text-foreground/45')}>
                    {chave === 'cpl' ? 'CPL (médio no mês 1)' : ROTULO_DA_LINHA[chave]}
                  </span>
                  <span className="text-xs tabular-nums text-foreground/50">Ponto A: {textoDaBase(chave, base[chave])}</span>
                </div>
                <div className="mt-2 grid grid-cols-3 gap-1.5">
                  {COLUNAS_DA_GRADE.map((coluna) => (
                    <div key={coluna} className="min-w-0">
                      <span className="mb-1 block truncate text-[10.5px] text-foreground/45">{ROTULO_DA_COLUNA[coluna].replace('Meta ', '')}</span>
                      {celulaDaGrade(coluna, chave, true)}
                      <div className="mt-0.5 h-4">
                        <CelulaVariacao chave={chave} valor={valorPlanejado(coluna, chave)} pontoA={base[chave]} />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>

          <div className="hidden overflow-x-auto sm:block">
            <table className="w-full max-w-[820px] text-sm">
              <thead className="text-left text-xs uppercase tracking-wide text-foreground/45">
                <tr>
                  <th className="py-1.5 pr-3 font-medium">Métrica</th>
                  <th className="px-2 py-1.5 text-right font-medium">Ponto A</th>
                  {COLUNAS_DA_GRADE.map((c) => (
                    <th key={c} className="px-2 py-1.5 text-right font-medium">{ROTULO_DA_COLUNA[c]}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {LINHAS_DA_GRADE.map((chave) => (
                  <tr key={chave} className="border-t border-line align-top">
                    <td className={cn('py-1.5 pr-3 font-medium', ehDigitada(chave) ? 'text-foreground/85' : 'text-foreground/45')}>
                      {chave === 'cpl' ? 'CPL médio' : ROTULO_DA_LINHA[chave]}
                    </td>
                    <td className="px-2 py-1.5 text-right tabular-nums text-foreground/55">{textoDaBase(chave, base[chave])}</td>
                    {COLUNAS_DA_GRADE.map((coluna) => (
                      <td key={coluna} className="px-1.5 py-1">
                        {celulaDaGrade(coluna, chave, false)}
                        <div className="mt-0.5 h-4 text-right">
                          <CelulaVariacao chave={chave} valor={valorPlanejado(coluna, chave)} pontoA={base[chave]} />
                        </div>
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* ------------------------------------------------------------ o funil: do investimento até a venda */}
          <div className="mt-4 rounded-xl border border-line bg-elevate/[0.02] p-3">
            <p className="text-sm font-semibold text-foreground">Funil: do investimento até a venda</p>
            <p className="mb-3 text-xs text-foreground/50">
              Preencha o CPL, a taxa de agendamento e a de conversão: o plano calcula leads, agendamentos, vendas e (com o ticket médio) o faturamento.
              Investimento ÷ CPL = leads → × taxa de agendamento = agendamentos → × taxa de conversão = vendas → × ticket = faturamento.
            </p>
            <div className="grid gap-3 lg:grid-cols-3">
              {COLUNAS_DA_GRADE.map((coluna) => {
                const f = rascunho.funil[coluna]
                const mes1 = coluna === 'mes1'
                const inv = numeroDigitado(mes1 ? rascunho.mes1.investimento : rascunho.cenarios[coluna].metas.investimento)
                const cpl = numeroDigitado(mes1 ? rascunho.cplMedio : f.cpl)
                const ag = numeroDigitado(f.agendamento)
                const conv = numeroDigitado(f.conversao)
                const leads = inv !== null && cpl ? inv / cpl : null
                const agendados = leads !== null && ag !== null ? leads * (ag / 100) : null
                const vendas = leads !== null && conv !== null ? Math.round((agendados ?? leads) * (conv / 100)) : null
                const campo = (rotulo: string, valor: string, onChange: (v: string) => void, sufixo: string, prefixo?: string) => (
                  <label className="block">
                    <span className="mb-1 block text-[11px] text-foreground/55">{rotulo}</span>
                    <span className="relative block">
                      {prefixo && <span className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-xs text-foreground/40">{prefixo}</span>}
                      <input
                        value={valor}
                        onChange={(e) => onChange(e.target.value)}
                        onBlur={(e) => onChange(mascararCampo(e.target.value, 'reais'))}
                        onFocus={(e) => e.target.select()}
                        inputMode="decimal"
                        placeholder="0"
                        className={cn(
                          'h-9 w-full rounded-md border border-line bg-surface pr-7 text-right text-sm tabular-nums text-foreground outline-none focus:border-accent focus:ring-2 focus:ring-accent/15',
                          prefixo ? 'pl-8' : 'pl-2',
                        )}
                      />
                      {sufixo && <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-xs text-foreground/40">{sufixo}</span>}
                    </span>
                  </label>
                )
                return (
                  <div key={coluna} className="rounded-lg border border-line bg-surface p-3">
                    <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-accent">{ROTULO_DA_COLUNA[coluna]}</p>
                    <div className="grid grid-cols-2 gap-2">
                      {!mes1 && campo('CPL médio', f.cpl, (v) => mudarFunil(coluna, 'cpl', v), '', 'R$')}
                      {campo('Taxa de agendamento', f.agendamento, (v) => mudarFunil(coluna, 'agendamento', v), '%')}
                      {campo('Taxa de conversão', f.conversao, (v) => mudarFunil(coluna, 'conversao', v), '%')}
                      {campo('Ticket médio', f.ticket, (v) => mudarFunil(coluna, 'ticket', v), '', 'R$')}
                    </div>
                    <p className="mt-2 text-[11px] leading-snug text-foreground/55">
                      {leads === null
                        ? 'Preencha o investimento e o CPL médio pra calcular.'
                        : `${Math.round(leads).toLocaleString('pt-BR')} leads${agendados !== null ? ` → ${Math.round(agendados).toLocaleString('pt-BR')} agendamentos` : ''}${vendas !== null ? ` → ${vendas.toLocaleString('pt-BR')} vendas` : ''}`}
                    </p>
                  </div>
                )
              })}
            </div>
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

        {/* ---------------------------------------------------------------- o que se quer em palavras (passo 2) */}
        <div className="mt-3 grid gap-3 lg:grid-cols-2">
          {HORIZONTES_PLANO.map((h) => (
            <div key={h.valor} className="rounded-xl border border-line bg-surface p-3">
              <span className="mb-1.5 block text-xs font-medium text-foreground/70">Onde quer chegar em {h.label}</span>
              <Textarea
                rows={2}
                value={rascunho.cenarios[h.valor].objetivo}
                onChange={(e) => mudarCenario(h.valor, 'objetivo', e.target.value)}
                placeholder="O objetivo, na linguagem do negócio do cliente."
              />
            </div>
          ))}
        </div>

        <RoteiroDoPlano clienteId={clienteId} />

        {/* ---------------------------------------------------------------- 3. como vamos chegar lá */}
        <div className="mt-3 rounded-xl border border-line bg-surface p-3">
          <Passo
            numero={3}
            pergunta="Como vamos chegar lá?"
            apoio="A estratégia que está sendo usada e o que precisa ser verdade pra meta se cumprir. Interno: nunca vai pro portal."
          />
          <div>
            <span className="mb-1.5 block text-xs font-medium text-foreground/70">Estratégia usada hoje</span>
            <Textarea
              rows={4}
              value={rascunho.estrategiaUsada}
              onChange={(e) => mudar('estrategiaUsada', e.target.value)}
              placeholder="O que está sendo feito neste cliente: público, canais, criativos, orçamento… (pode ser personalizada)"
            />
          </div>
          <div className="mt-3 grid gap-3 lg:grid-cols-2">
            {HORIZONTES_PLANO.map((h) => (
              <div key={h.valor}>
                <span className="mb-1.5 block text-xs font-medium text-foreground/70">Estratégia e premissas — {h.label}</span>
                <Textarea
                  rows={4}
                  value={rascunho.cenarios[h.valor].estrategia}
                  onChange={(e) => mudarCenario(h.valor, 'estrategia', e.target.value)}
                  placeholder="O que vamos fazer e o que precisa ser verdade: CPL cair com criativo novo, cliente atender em 5 min…"
                />
              </div>
            ))}
          </div>
          <p className="mt-2 flex items-center gap-1 text-[11px] text-foreground/40">
            <Lock className="h-3 w-3" /> interna — nunca vai pro portal
          </p>
        </div>

        {/* ---------------------------------------------------------------- 4. projeção × real */}
        <div className="mt-3 rounded-xl border border-line bg-surface p-3">
          <Passo numero={4} pergunta="Está dando certo?" apoio="Mês a mês, o que o plano projeta ao lado do que já foi lançado em Métricas." />
          <ProjecaoXReal plano={planoDaRota} realizado={realizado} />
        </div>
      </div>

      <div className={cn('px-4 pb-4', !aberto && 'hidden')}>
        <BarraSalvar
          visivel={sujo}
          salvando={salvando}
          rotulo="Salvar planejamento"
          onSalvar={() => void salvar()}
          onDescartar={() => api && aplicar(api)}
        />
      </div>

      {/* ------------------------------------------------------------------ janelas */}
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
