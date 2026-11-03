import * as React from 'react'
import { Link, useParams } from 'react-router-dom'
import { toast } from 'sonner'
import { Activity, ArrowLeft, CheckCircle2, Eye, Loader2, MousePointerClick, Pencil } from 'lucide-react'
import { TopBar } from '@/components/layout/TopBar'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { EmptyState } from '@/components/ui/EmptyState'
import {
  BarraDeFiltros,
  Barras,
  CartoesKpi,
  Funil,
  GraficoDiario,
  Painel,
  ROTULO_DISPOSITIVO,
  TabelaSessoes,
  usePeriodo,
} from '@/components/demoStudio/analytics/Analytics'
import { dataHora, duracao, hora } from '@/lib/demoStudio/format'
import {
  analytics,
  demoStudio,
  type DemoResumo,
  type FiltroAnalytics,
  type LinhaFunil,
  type OpcoesDeFiltro,
  type SessaoDetalhe,
  type SessaoResumo,
  type VisaoGeral,
} from '@/services/demoStudio'

type FiltroSemPeriodo = Omit<FiltroAnalytics, 'from' | 'to'>

/** Carrega a visão geral sempre que período/filtros mudam (descarta resposta velha). */
function useVisaoGeral(f: FiltroAnalytics) {
  const [dados, setDados] = React.useState<VisaoGeral | null>(null)
  const chave = JSON.stringify(f)
  React.useEffect(() => {
    let vivo = true
    setDados(null)
    analytics.visaoGeral(f).then((d) => vivo && setDados(d)).catch((e: Error) => toast.error(e.message))
    return () => { vivo = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chave])
  return dados
}

function Carregando() {
  return <div className="grid h-40 place-items-center text-foreground/45"><Loader2 className="h-5 w-5 animate-spin" /></div>
}

/* ------------------------------------------------------------------ /demo-studio (visão geral) */

export function DemoOverviewPage() {
  const periodo = usePeriodo('30')
  const [filtro, setFiltro] = React.useState<FiltroSemPeriodo>({})
  const [demos, setDemos] = React.useState<DemoResumo[]>([])
  const [opcoes, setOpcoes] = React.useState<OpcoesDeFiltro | null>(null)
  React.useEffect(() => {
    demoStudio.listar().then(setDemos).catch(() => undefined)
    analytics.filtros().then(setOpcoes).catch(() => undefined)
  }, [])
  const dados = useVisaoGeral({ ...periodo.periodo, ...filtro })

  return (
    <>
      <TopBar compacto title="Visão geral" subtitle="Demo Studio" breadcrumbs={[{ label: 'Demo Studio', to: '/demo-studio' }, { label: 'Visão geral' }]}
        titleAddon={dados && dados.aoVivo > 0 ? <Badge tone="success" dot>{dados.aoVivo} ao vivo</Badge> : undefined} />
      <div className="space-y-4 px-4 pb-10 lg:px-6">
        <BarraDeFiltros periodo={periodo} demos={demos} opcoes={opcoes} filtro={filtro} onFiltro={setFiltro} />
        {!dados ? <Carregando /> : dados.resumo.views === 0 && !filtro.demoId && !filtro.linkId ? (
          <EmptyState
            icon={<Activity className="h-5 w-5" />}
            title="Nenhuma sessão no período"
            description="Compartilhe o link de uma demo para começar a medir views, conclusão e leads. Acessos de quem está logado no painel não contam."
            action={<Link to="/demo-studio/demos"><Button size="sm">Ver demos</Button></Link>}
          />
        ) : (
          <>
            <CartoesKpi r={dados.resumo} leads={dados.leads} />
            <div className="grid gap-4 xl:grid-cols-3">
              <Painel titulo="Views por dia" className="xl:col-span-2"><GraficoDiario serie={dados.serie} /></Painel>
              <Painel titulo="Dispositivos"><Barras itens={dados.dispositivos} rotulo={(k) => ROTULO_DISPOSITIVO[k] ?? k} /></Painel>
            </div>
            <div className="grid gap-4 xl:grid-cols-2">
              <Painel titulo="Demos mais vistas">
                <Barras itens={dados.demos} rotulo={(k) => {
                  const d = dados.demos.find((x) => x.chave === k)
                  return <Link className="hover:underline" to={`/demo-studio/demos/${k}/analytics`}>{d?.nome ?? k}</Link>
                }} />
              </Painel>
              <Painel titulo="Canais e links"><Barras itens={dados.canais} /></Painel>
            </div>
            <Painel titulo="Sessões recentes"><TabelaSessoes sessoes={dados.recentes} /></Painel>
          </>
        )}
      </div>
    </>
  )
}

/* ------------------------------------------------------------------ /demo-studio/demos/:id/analytics */

export function DemoAnalyticsPage() {
  const { id = '' } = useParams()
  const periodo = usePeriodo('30')
  const [filtro, setFiltro] = React.useState<FiltroSemPeriodo>({})
  const [opcoes, setOpcoes] = React.useState<OpcoesDeFiltro | null>(null)
  const [nome, setNome] = React.useState('')
  const [funil, setFunil] = React.useState<LinhaFunil[] | null>(null)
  const [sessoes, setSessoes] = React.useState<{ total: number; sessions: SessaoResumo[] } | null>(null)
  const [pagina, setPagina] = React.useState(0)
  const f: FiltroAnalytics & { demoId: string } = { ...periodo.periodo, ...filtro, demoId: id }
  const dados = useVisaoGeral(f)
  const chave = JSON.stringify(f)

  React.useEffect(() => {
    demoStudio.obter(id).then((d) => setNome(d.name)).catch(() => undefined)
    analytics.filtros().then(setOpcoes).catch(() => undefined)
  }, [id])
  React.useEffect(() => {
    setFunil(null)
    setPagina(0)
    analytics.funil(f).then(setFunil).catch((e: Error) => toast.error(e.message))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chave])
  React.useEffect(() => {
    analytics.sessoes({ ...f, limit: 50, offset: pagina * 50 }).then(setSessoes).catch((e: Error) => toast.error(e.message))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chave, pagina])

  return (
    <>
      <TopBar compacto title={nome || 'Analytics'} subtitle="Analytics da demo"
        breadcrumbs={[{ label: 'Demo Studio', to: '/demo-studio' }, { label: 'Demos', to: '/demo-studio/demos' }, { label: nome || 'Demo', to: `/demo-studio/demos/${id}` }, { label: 'Analytics' }]} />
      <div className="space-y-4 px-4 pb-10 lg:px-6">
        <div className="flex flex-wrap items-center gap-2">
          <Link to={`/demo-studio/demos/${id}`}><Button size="sm" variant="ghost" leftIcon={<Pencil className="h-4 w-4" />}>Editor</Button></Link>
          <Link to={`/demo-studio/demos/${id}/preview`}><Button size="sm" variant="ghost" leftIcon={<Eye className="h-4 w-4" />}>Pré-visualizar</Button></Link>
        </div>
        <BarraDeFiltros periodo={periodo} opcoes={opcoes} filtro={{ ...filtro, demoId: id }} onFiltro={({ demoId: _d, ...resto }) => setFiltro(resto)} esconderDemo />
        {!dados ? <Carregando /> : (
          <>
            <CartoesKpi r={dados.resumo} leads={dados.leads} />
            <Painel titulo="Funil por etapa" acao={<span className="text-[11px] text-foreground/45">sessões que chegaram até cada etapa · em vermelho, a maior queda</span>}>
              {funil ? <Funil linhas={funil} /> : <Carregando />}
            </Painel>
            <div className="grid gap-4 xl:grid-cols-3">
              <Painel titulo="Views por dia" className="xl:col-span-2"><GraficoDiario serie={dados.serie} /></Painel>
              <div className="space-y-4">
                <Painel titulo="Dispositivos"><Barras itens={dados.dispositivos} rotulo={(k) => ROTULO_DISPOSITIVO[k] ?? k} /></Painel>
                <Painel titulo="Canais e links"><Barras itens={dados.canais} /></Painel>
              </div>
            </div>
            <Painel titulo={`Sessões${sessoes ? ` (${sessoes.total})` : ''}`}>
              {sessoes ? <TabelaSessoes sessoes={sessoes.sessions} mostrarDemo={false} /> : <Carregando />}
              {sessoes && sessoes.total > 50 && (
                <div className="mt-3 flex items-center justify-end gap-2 text-xs text-foreground/55">
                  <Button size="sm" variant="ghost" disabled={pagina === 0} onClick={() => setPagina((p) => p - 1)}>Anteriores</Button>
                  <span>{pagina * 50 + 1}–{Math.min((pagina + 1) * 50, sessoes.total)} de {sessoes.total}</span>
                  <Button size="sm" variant="ghost" disabled={(pagina + 1) * 50 >= sessoes.total} onClick={() => setPagina((p) => p + 1)}>Próximas</Button>
                </div>
              )}
            </Painel>
          </>
        )}
      </div>
    </>
  )
}

/* ------------------------------------------------------------------ /demo-studio/sessoes/:id */

const NOME_DO_EVENTO: Record<string, string> = {
  session_start: 'Abriu a demo',
  step_view: 'Viu a etapa',
  hotspot_click: 'Clicou no destaque',
  chapter_open: 'Abriu o capítulo',
  lead_submit: 'Enviou o formulário',
  cta_click: 'Clicou no CTA',
  complete: 'Concluiu o tour',
}

export function DemoSessionPage() {
  const { id = '' } = useParams()
  const [s, setS] = React.useState<SessaoDetalhe | null>(null)
  const [erro, setErro] = React.useState('')
  React.useEffect(() => {
    analytics.sessao(id).then(setS).catch((e: Error) => setErro(e.message))
  }, [id])

  if (erro) return <div className="p-6"><EmptyState title="Sessão não encontrada" description={erro} /></div>
  if (!s) return <Carregando />

  const titulo = new Map(s.steps.map((e) => [e.id, e.title]))
  // Heartbeats não entram na linha do tempo: só somam o tempo ativo, mostrado no cabeçalho.
  const eventos = s.events.filter((e) => e.type !== 'heartbeat')

  return (
    <>
      <TopBar compacto title="Sessão" subtitle={s.demo.name}
        breadcrumbs={[{ label: 'Demo Studio', to: '/demo-studio' }, { label: s.demo.name, to: `/demo-studio/demos/${s.demo.id}/analytics` }, { label: 'Sessão' }]} />
      <div className="space-y-4 px-4 pb-10 lg:px-6">
        <Link to={`/demo-studio/demos/${s.demo.id}/analytics`} className="inline-flex items-center gap-1.5 text-sm text-foreground/60 hover:text-foreground">
          <ArrowLeft className="h-4 w-4" /> Analytics da demo
        </Link>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          {[
            ['Quem', s.lead ? `${s.lead.name ?? 'Lead'}${s.lead.company ? ` · ${s.lead.company}` : ''}` : 'Anônimo'],
            ['Quando', dataHora(s.startedAt)],
            ['Tempo ativo', duracao(s.activeMs)],
            ['Etapas vistas', `${s.stepsViewed} de ${s.totalSteps || '?'}`],
            ['Canal', s.channel],
            ['Dispositivo', [ROTULO_DISPOSITIVO[s.device ?? 'desktop'], s.browser, s.os].filter(Boolean).join(' · ')],
            ['Concluiu', s.completed ? 'Sim' : `Não (parou na ${s.maxStepOrder || 1}ª)`],
            ['CTA', s.ctaClicked ? 'Clicou' : 'Não clicou'],
          ].map(([r, v]) => (
            <div key={r} className="rounded-xl border border-line bg-surface p-3">
              <p className="text-[11px] text-foreground/50">{r}</p>
              <p className="mt-0.5 truncate text-sm text-foreground" title={v}>{v}</p>
            </div>
          ))}
        </div>
        <Painel titulo="Linha do tempo">
          {!eventos.length ? <p className="text-xs text-foreground/45">Sem eventos.</p> : (
            <ol className="relative space-y-3 border-l border-line pl-4">
              {eventos.map((e, i) => (
                <li key={i} className="relative text-sm">
                  <span className={`absolute -left-[21px] top-1.5 h-2.5 w-2.5 rounded-full ${e.type === 'complete' || e.type === 'cta_click' ? 'bg-emerald-500' : 'bg-accent'}`} />
                  <span className="mr-2 font-mono text-xs tabular-nums text-foreground/45">{hora(e.ts)}</span>
                  <span className="text-foreground">{NOME_DO_EVENTO[e.type] ?? e.type}</span>
                  {e.type === 'step_view' && (
                    <span className="text-foreground/60"> {e.order}: {(e.stepId && titulo.get(e.stepId)) || '(etapa removida)'}</span>
                  )}
                  {e.type === 'cta_click' && <span className="text-foreground/60"> ({String(e.data?.cta ?? '')})</span>}
                  {e.type === 'complete' && <CheckCircle2 className="ml-1 inline h-3.5 w-3.5 text-emerald-500" />}
                  {e.type === 'hotspot_click' && <MousePointerClick className="ml-1 inline h-3.5 w-3.5 text-foreground/40" />}
                </li>
              ))}
            </ol>
          )}
        </Painel>
      </div>
    </>
  )
}
