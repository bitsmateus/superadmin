import * as React from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import {
  Activity, AlertTriangle, Archive, ArrowUpRight, BarChart3, Bell, Building2, CalendarClock, CalendarDays, Check,
  CheckCircle2, Clock, Columns3, Contact, FileText, Headset, History, KanbanSquare, LayoutDashboard, ListChecks,
  ListTodo, MessageCircle, MessageSquare, Newspaper, Palette, PhoneCall, Pencil, Presentation, Radio, RotateCcw,
  Search, Settings, ShieldCheck, ShoppingBag, Sparkles, Star, Trophy, Users, Wallet, Zap,
  type LucideIcon,
} from 'lucide-react'
import { TopBar } from '@/components/layout/TopBar'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { TodayActions } from '@/components/crm/TodayActions'
import { LeadDetailModal } from '@/components/comercial/LeadDetailModal'
import { useAuth, saveOwnHomePrefs } from '@/hooks/useAuth'
import { useOpenReminders } from '@/hooks/useTickets'
import { usePaginasDoUsuario, usePaginasRecentes } from '@/hooks/usePaginasDaInicio'
import { reunioesService, agendamentoLegivel } from '@/services/reunioes'
import { retornosService } from '@/services/retornos'
import { resolveArea, type UserRole } from '@/services/supabase'
import {
  escolhidas, MAXIMO_ACESSO_RAPIDO, MAXIMO_ATALHOS, type GrupoDaPagina, type IconeDaPagina, type PaginaDoSistema,
} from '@/lib/paginasDaInicio'
import { cn } from '@/lib/utils'

const ICONES: Record<IconeDaPagina, LucideIcon> = {
  dashboard: LayoutDashboard, tarefas: ListTodo, pipeline: Columns3, clientes: Users, followups: Bell, agenda: CalendarDays,
  atendimento: Headset, canais: Radio, tenants: Building2, comunicados: Newspaper, tickets: MessageCircle,
  templates: MessageSquare, arquivados: Archive, crm: Contact, demandas: ListChecks, grafico: BarChart3, trafego: Activity,
  kanban: KanbanSquare, social: Palette, demo: Presentation, vendas: ShoppingBag, contrato: FileText, pontos: Clock,
  gestao: Wallet, comando: Zap, equipe: ShieldCheck, performance: Trophy, configuracoes: Settings, relatorios: BarChart3,
  nps: Star, risco: AlertTriangle,
}

/** Cor de cada grupo (fundo do ícone). */
const COR_DO_GRUPO: Record<GrupoDaPagina, string> = {
  Suporte: 'bg-sky-500/12 text-sky-600 ring-sky-500/20 dark:text-sky-400',
  Comercial: 'bg-violet-500/12 text-violet-600 ring-violet-500/20 dark:text-violet-400',
  Demandas: 'bg-amber-500/12 text-amber-600 ring-amber-500/20 dark:text-amber-400',
  'NX Digital': 'bg-emerald-500/12 text-emerald-600 ring-emerald-500/20 dark:text-emerald-400',
  'Demo Studio': 'bg-pink-500/12 text-pink-600 ring-pink-500/20 dark:text-pink-400',
  Gestão: 'bg-teal-500/12 text-teal-600 ring-teal-500/20 dark:text-teal-400',
  Sistema: 'bg-slate-500/12 text-slate-600 ring-slate-500/20 dark:text-slate-300',
}

const PAPEL: Record<UserRole, string> = { admin: 'Administrador', supervisor: 'Supervisor', suporte: 'Usuário' }
const AREA = { comercial: 'Comercial', entrega: 'Suporte', ambos: 'Comercial e suporte' } as const

function Icone({ pagina, grande }: { pagina: PaginaDoSistema; grande?: boolean }) {
  const I = ICONES[pagina.icone] ?? LayoutDashboard
  return (
    <span className={cn('grid shrink-0 place-items-center ring-1', COR_DO_GRUPO[pagina.grupo], grande ? 'h-12 w-12 rounded-2xl' : 'h-8 w-8 rounded-xl')}>
      <I className={grande ? 'h-5 w-5' : 'h-4 w-4'} />
    </span>
  )
}

function saudacao(agora: Date): string {
  const h = agora.getHours()
  return h < 12 ? 'Bom dia' : h < 18 ? 'Boa tarde' : 'Boa noite'
}

/**
 * Tela inicial (/) — de todo mundo. Mostra só o que a pessoa pode abrir:
 *  - "Olá, <nome>" com a área e o resumo do que é dela hoje;
 *  - 3 atalhos e o acesso rápido, que ela escolhe (salvos na conta, valem em qualquer dispositivo);
 *  - as 5 últimas telas que ela abriu (neste navegador);
 *  - as demandas DELA: clientes em que é responsável (suporte), reuniões sem resultado e retornos vencidos (comercial)
 *    e as tarefas/lembretes dela.
 * O Dashboard do Suporte (indicadores do time) continua em /dashboard-suporte.
 */
export function InicioPage() {
  const { profile } = useAuth()
  const catalogo = usePaginasDoUsuario()
  const recentes = usePaginasRecentes(catalogo)
  const area = resolveArea(profile?.area)
  const prefs = profile?.homePrefs ?? null
  const atalhos = React.useMemo(() => escolhidas(catalogo, prefs?.atalhos, 'atalhos', area), [catalogo, prefs, area])
  const acessoRapido = React.useMemo(() => escolhidas(catalogo, prefs?.acessoRapido, 'acessoRapido', area), [catalogo, prefs, area])
  const [editando, setEditando] = React.useState<'atalhos' | 'acessoRapido' | null>(null)

  const abre = (to: string) => catalogo.some((p) => p.to === to)
  const veSuporte = area !== 'comercial' && ['/dashboard-suporte', '/tarefas', '/pipeline', '/clients'].some(abre)
  const veComercial = area !== 'entrega' && catalogo.some((p) => p.grupo === 'Comercial')

  const salvar = (qual: 'atalhos' | 'acessoRapido', caminhos: string[]) => {
    void saveOwnHomePrefs({
      atalhos: qual === 'atalhos' ? caminhos : atalhos.map((p) => p.to),
      acessoRapido: qual === 'acessoRapido' ? caminhos : acessoRapido.map((p) => p.to),
    })
  }

  const agora = new Date()
  const primeiroNome = (profile?.name || profile?.email || '').trim().split(/\s+/)[0]
  const iniciais = (profile?.name || profile?.email || '?').trim().split(/\s+/).slice(0, 2).map((s) => s[0]?.toUpperCase()).join('')
  const dataPorExtenso = new Intl.DateTimeFormat('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' }).format(agora)
  const dataDeHoje = dataPorExtenso.charAt(0).toUpperCase() + dataPorExtenso.slice(1)

  return (
    <>
      <TopBar title="Início" subtitle="Seus atalhos e o que é seu hoje" />
      <div className="mx-auto w-full max-w-[1400px] space-y-6 px-4 py-5 sm:px-6 sm:py-6 lg:px-8">
        {/* Boas-vindas */}
        <section className="relative overflow-hidden rounded-3xl border border-line bg-card p-6 shadow-sm sm:p-8">
          <div aria-hidden className="pointer-events-none absolute -right-16 -top-24 h-64 w-64 rounded-full bg-accent/20 blur-3xl" />
          <div aria-hidden className="pointer-events-none absolute -bottom-28 left-1/3 h-56 w-56 rounded-full bg-violet-500/10 blur-3xl" />
          <div className="relative flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-4">
              <span className="grid h-14 w-14 shrink-0 place-items-center rounded-2xl bg-gradient-to-br from-accent to-violet-500 text-lg font-semibold text-white shadow-lg shadow-accent/25">
                {iniciais}
              </span>
              <div className="min-w-0">
                <p className="text-xs font-medium text-foreground/45">{dataDeHoje}</p>
                <h2 className="truncate text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
                  {saudacao(agora)}, {primeiroNome}!
                </h2>
                <p className="mt-0.5 text-sm text-foreground/55">Bem-vindo ao painel do Grupo NX Digital.</p>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {profile?.role && (
                    <span className="rounded-full bg-accent/10 px-2.5 py-0.5 text-[11px] font-medium text-accent ring-1 ring-accent/20">
                      {PAPEL[profile.role]}
                    </span>
                  )}
                  <span className="rounded-full bg-elevate/[0.05] px-2.5 py-0.5 text-[11px] font-medium text-foreground/60 ring-1 ring-line">
                    {AREA[area]}
                  </span>
                </div>
              </div>
            </div>
            <ResumoDoDia veComercial={veComercial} />
          </div>
        </section>

        {/* Atalhos */}
        <section>
          <CabecalhoDaSecao
            icone={<Sparkles className="h-4 w-4" />}
            titulo="Atalhos"
            subtitulo="As 3 telas que você mais usa"
            onEditar={catalogo.length ? () => setEditando('atalhos') : undefined}
          />
          {atalhos.length === 0 ? (
            <Vazio texto="Nenhum atalho ainda. Clique em Editar e escolha até 3 telas." />
          ) : (
            <div className="grid gap-3 sm:grid-cols-3">
              {atalhos.map((p) => (
                <Link
                  key={p.to}
                  to={p.to}
                  className="group relative flex items-center gap-4 rounded-2xl border border-line bg-card p-4 shadow-sm transition-all hover:-translate-y-0.5 hover:border-accent/30 hover:shadow-md sm:p-5"
                >
                  <Icone pagina={p} grande />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-foreground">{p.label}</p>
                    <p className="truncate text-xs text-foreground/50">{p.descricao}</p>
                    <p className="mt-1 text-[10px] font-medium uppercase tracking-wider text-foreground/35">{p.grupo}</p>
                  </div>
                  <ArrowUpRight className="h-4 w-4 shrink-0 text-foreground/25 transition-colors group-hover:text-accent" />
                </Link>
              ))}
            </div>
          )}
        </section>

        {/* Páginas recentes */}
        <section className="rounded-2xl border border-line bg-card p-4 shadow-sm sm:p-5">
          <CabecalhoDaSecao icone={<History className="h-4 w-4" />} titulo="Páginas recentes" subtitulo="As últimas telas que você abriu" semMargem />
          {recentes.length === 0 ? (
            <p className="mt-3 text-xs text-foreground/45">As telas que você abrir vão aparecer aqui.</p>
          ) : (
            <div className="mt-3 flex flex-wrap gap-2">
              {recentes.map((p) => (
                <Link
                  key={p.to}
                  to={p.to}
                  className="inline-flex max-w-full items-center gap-2 rounded-xl border border-line bg-elevate/[0.02] py-1.5 pl-1.5 pr-3 text-sm text-foreground/80 transition-colors hover:border-accent/30 hover:bg-accent/5 hover:text-foreground"
                >
                  <Icone pagina={p} />
                  <span className="truncate">{p.label}</span>
                </Link>
              ))}
            </div>
          )}
        </section>

        <div className="grid gap-6 lg:grid-cols-3">
          {/* Demandas da pessoa */}
          <section className="space-y-4 lg:col-span-2">
            <CabecalhoDaSecao icone={<CheckCircle2 className="h-4 w-4" />} titulo="Minhas demandas" subtitulo="Só o que é seu" />
            {veSuporte && <TodayActions somenteMeus />}
            {veComercial && <DemandasDoComercial />}
            <MinhasTarefas podeAbrirTarefas={abre('/tarefas')} />
          </section>

          {/* Acesso rápido */}
          <section>
            <CabecalhoDaSecao
              icone={<Zap className="h-4 w-4" />}
              titulo="Acesso rápido"
              subtitulo={`Até ${MAXIMO_ACESSO_RAPIDO} telas`}
              onEditar={catalogo.length ? () => setEditando('acessoRapido') : undefined}
            />
            <div className="overflow-hidden rounded-2xl border border-line bg-card shadow-sm">
              {acessoRapido.length === 0 ? (
                <p className="px-4 py-6 text-center text-xs text-foreground/45">Nada escolhido. Clique em Editar.</p>
              ) : (
                <ul className="divide-y divide-line">
                  {acessoRapido.map((p) => (
                    <li key={p.to}>
                      <Link to={p.to} className="group flex items-center gap-3 px-4 py-3 transition-colors hover:bg-elevate/[0.03]">
                        <Icone pagina={p} />
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium text-foreground">{p.label}</p>
                          <p className="truncate text-[11px] text-foreground/45">{p.descricao}</p>
                        </div>
                        <ArrowUpRight className="h-3.5 w-3.5 shrink-0 text-foreground/25 group-hover:text-accent" />
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </section>
        </div>
      </div>

      <EscolherPaginasModal
        open={editando !== null}
        onClose={() => setEditando(null)}
        titulo={editando === 'atalhos' ? 'Escolher atalhos' : 'Escolher acesso rápido'}
        maximo={editando === 'atalhos' ? MAXIMO_ATALHOS : MAXIMO_ACESSO_RAPIDO}
        catalogo={catalogo}
        selecionadas={(editando === 'atalhos' ? atalhos : acessoRapido).map((p) => p.to)}
        padrao={editando ? escolhidas(catalogo, null, editando, area).map((p) => p.to) : []}
        onSalvar={(caminhos) => { if (editando) salvar(editando, caminhos); setEditando(null) }}
      />
    </>
  )
}

function CabecalhoDaSecao({ icone, titulo, subtitulo, onEditar, semMargem }: {
  icone: React.ReactNode; titulo: string; subtitulo?: string; onEditar?: () => void; semMargem?: boolean
}) {
  return (
    <div className={cn('flex items-center justify-between gap-3', !semMargem && 'mb-3')}>
      <div className="flex min-w-0 items-center gap-2.5">
        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-xl bg-accent/10 text-accent ring-1 ring-accent/20">{icone}</span>
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-foreground">{titulo}</h3>
          {subtitulo && <p className="truncate text-[11px] text-foreground/45">{subtitulo}</p>}
        </div>
      </div>
      {onEditar && (
        <button
          type="button"
          onClick={onEditar}
          className="inline-flex shrink-0 items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium text-foreground/55 transition-colors hover:bg-elevate/[0.05] hover:text-foreground"
        >
          <Pencil className="h-3.5 w-3.5" /> Editar
        </button>
      )}
    </div>
  )
}

function Vazio({ texto }: { texto: string }) {
  return <p className="rounded-2xl border border-dashed border-line px-4 py-6 text-center text-xs text-foreground/45">{texto}</p>
}

/** Contadores do canto da boas-vindas: o que é da pessoa hoje. */
function ResumoDoDia({ veComercial }: { veComercial: boolean }) {
  const { profile } = useAuth()
  const tarefas = useTarefasDeHoje(profile?.id)
  const { reunioes, retornos } = usePendenciasDoComercial(veComercial)
  const itens = [
    { n: tarefas.length, rotulo: tarefas.length === 1 ? 'tarefa pra hoje' : 'tarefas pra hoje' },
    ...(veComercial ? [
      { n: reunioes.length, rotulo: reunioes.length === 1 ? 'reunião sem resultado' : 'reuniões sem resultado' },
      { n: retornos.length, rotulo: retornos.length === 1 ? 'retorno vencido' : 'retornos vencidos' },
    ] : []),
  ]
  return (
    <div className={cn('grid gap-2 sm:flex sm:flex-wrap sm:justify-end', itens.length === 3 ? 'grid-cols-3' : 'grid-cols-1')}>
      {itens.map((i) => (
        <div key={i.rotulo} className="min-w-0 rounded-2xl border border-line bg-bg/60 px-3 py-3 backdrop-blur sm:min-w-[7.5rem] sm:px-4">
          <p className={cn('text-2xl font-semibold tabular-nums', i.n ? 'text-foreground' : 'text-foreground/35')}>{i.n}</p>
          <p className="text-[11px] text-foreground/50">{i.rotulo}</p>
        </div>
      ))}
    </div>
  )
}

/** Tarefas abertas da pessoa que vencem até hoje (atrasadas incluídas), da mais antiga pra mais nova. */
function useTarefasDeHoje(userId: string | undefined) {
  const abertas = useOpenReminders(userId)
  return React.useMemo(() => {
    const fim = new Date()
    fim.setHours(23, 59, 59, 999)
    return abertas
      .filter((r) => r.dueAt && new Date(r.dueAt) <= fim)
      .sort((a, b) => new Date(a.dueAt!).getTime() - new Date(b.dueAt!).getTime())
  }, [abertas])
}

function usePendenciasDoComercial(ativo: boolean) {
  const reunioes = useQuery({ queryKey: ['inicio', 'reunioes'], queryFn: reunioesService.pendentes, enabled: ativo, refetchInterval: 60_000 })
  const retornos = useQuery({ queryKey: ['inicio', 'retornos'], queryFn: retornosService.pendentes, enabled: ativo, refetchInterval: 60_000 })
  return { reunioes: reunioes.data ?? [], retornos: retornos.data ?? [], carregando: reunioes.isLoading || retornos.isLoading }
}

function DemandasDoComercial() {
  const { reunioes, retornos, carregando } = usePendenciasDoComercial(true)
  const [aberto, setAberto] = React.useState<string | null>(null)
  const total = reunioes.length + retornos.length
  return (
    <section className="rounded-2xl border border-line bg-card">
      <header className="flex items-center gap-2.5 border-b border-line px-4 py-3">
        <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-violet-500/10 text-violet-600 ring-1 ring-violet-500/20 dark:text-violet-400">
          <Contact className="h-3.5 w-3.5" />
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-medium text-foreground">Comercial</h3>
          <p className="text-[11px] text-foreground/45">Reuniões sem resultado e retornos de proposta vencidos</p>
        </div>
        <span className={cn('rounded-md px-2 py-0.5 text-[11px] font-medium ring-1', total ? 'bg-warning/10 text-warning ring-warning/20' : 'bg-elevate/[0.04] text-foreground/50 ring-line')}>
          {total}
        </span>
      </header>
      {carregando ? (
        <p className="px-4 py-6 text-center text-xs text-foreground/40">Carregando…</p>
      ) : total === 0 ? (
        <p className="px-4 py-6 text-center text-xs text-foreground/40">Nada pendente pra você no comercial agora.</p>
      ) : (
        <ul className="divide-y divide-line">
          {reunioes.map((r) => (
            <LinhaDeDemanda
              key={`r-${r.card_id}`}
              icone={<CalendarClock className="h-3.5 w-3.5" />}
              titulo={r.nome || r.empresa || 'Lead sem nome'}
              detalhe={`Reunião de ${agendamentoLegivel(r.agendamento)} sem resultado · ${r.crm_do_card}`}
              tom="danger"
              onAbrir={() => setAberto(r.card_id)}
            />
          ))}
          {retornos.map((r) => (
            <LinhaDeDemanda
              key={`t-${r.card_id}`}
              icone={<PhoneCall className="h-3.5 w-3.5" />}
              titulo={r.nome || r.empresa || 'Lead sem nome'}
              detalhe={`Retorno de proposta vencido (${agendamentoLegivel(r.retornar)}) · ${r.coluna}`}
              tom="warning"
              onAbrir={() => setAberto(r.card_id)}
            />
          ))}
        </ul>
      )}
      <LeadDetailModal leadRowId={aberto} onClose={() => setAberto(null)} />
    </section>
  )
}

function LinhaDeDemanda({ icone, titulo, detalhe, tom, onAbrir }: {
  icone: React.ReactNode; titulo: string; detalhe: string; tom: 'danger' | 'warning'; onAbrir: () => void
}) {
  return (
    <li>
      <button type="button" onClick={onAbrir} className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-elevate/[0.03]">
        <span className={cn('grid h-7 w-7 shrink-0 place-items-center rounded-lg ring-1', tom === 'danger' ? 'bg-danger/10 text-danger ring-danger/20' : 'bg-warning/10 text-warning ring-warning/20')}>
          {icone}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-foreground">{titulo}</p>
          <p className="truncate text-[11px] text-foreground/50">{detalhe}</p>
        </div>
        <ArrowUpRight className="h-3.5 w-3.5 shrink-0 text-foreground/25" />
      </button>
    </li>
  )
}

function MinhasTarefas({ podeAbrirTarefas }: { podeAbrirTarefas: boolean }) {
  const { profile } = useAuth()
  const tarefas = useTarefasDeHoje(profile?.id)
  const hoje = new Date()
  hoje.setHours(0, 0, 0, 0)
  const conteudo = (
    <>
      <header className="flex items-center gap-2.5 border-b border-line px-4 py-3">
        <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-accent/10 text-accent ring-1 ring-accent/20">
          <ListTodo className="h-3.5 w-3.5" />
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-medium text-foreground">Minhas tarefas</h3>
          <p className="text-[11px] text-foreground/45">Tarefas e lembretes seus que vencem até hoje</p>
        </div>
        <span className={cn('rounded-md px-2 py-0.5 text-[11px] font-medium ring-1', tarefas.length ? 'bg-warning/10 text-warning ring-warning/20' : 'bg-elevate/[0.04] text-foreground/50 ring-line')}>
          {tarefas.length}
        </span>
      </header>
      {tarefas.length === 0 ? (
        <p className="px-4 py-6 text-center text-xs text-foreground/40">Nenhuma tarefa sua pra hoje.</p>
      ) : (
        <ul className="divide-y divide-line">
          {tarefas.slice(0, 8).map((t) => {
            const atrasada = new Date(t.dueAt!) < hoje
            return (
              <li key={t.id} className="flex items-center gap-3 px-4 py-2.5">
                <span className={cn('h-2 w-2 shrink-0 rounded-full', atrasada ? 'bg-danger' : 'bg-warning')} />
                <p className="min-w-0 flex-1 truncate text-sm text-foreground/85">{t.title}</p>
                <span className={cn('shrink-0 text-[11px]', atrasada ? 'text-danger' : 'text-foreground/45')}>
                  {atrasada ? 'Atrasada' : new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit' }).format(new Date(t.dueAt!))}
                </span>
              </li>
            )
          })}
        </ul>
      )}
    </>
  )
  return (
    <section className="overflow-hidden rounded-2xl border border-line bg-card">
      {conteudo}
      {podeAbrirTarefas && tarefas.length > 0 && (
        <Link to="/tarefas" className="block border-t border-line px-4 py-2.5 text-center text-xs font-medium text-accent hover:bg-accent/5">
          Ver todas as tarefas
        </Link>
      )}
    </section>
  )
}

/** Escolher telas (até `maximo`), na ordem em que foram marcadas. Só lista o que a pessoa pode abrir. */
function EscolherPaginasModal({ open, onClose, titulo, maximo, catalogo, selecionadas, padrao, onSalvar }: {
  open: boolean; onClose: () => void; titulo: string; maximo: number; catalogo: PaginaDoSistema[]
  selecionadas: string[]; padrao: string[]; onSalvar: (caminhos: string[]) => void
}) {
  const [marcadas, setMarcadas] = React.useState<string[]>(selecionadas)
  const [busca, setBusca] = React.useState('')
  React.useEffect(() => { if (open) { setMarcadas(selecionadas); setBusca('') } }, [open]) // eslint-disable-line react-hooks/exhaustive-deps

  const termo = busca.trim().toLowerCase()
  const visiveis = catalogo.filter((p) => !termo || `${p.label} ${p.grupo} ${p.descricao}`.toLowerCase().includes(termo))
  const grupos = [...new Set(visiveis.map((p) => p.grupo))]
  const cheio = marcadas.length >= maximo
  const alternar = (to: string) =>
    setMarcadas((m) => (m.includes(to) ? m.filter((x) => x !== to) : m.length >= maximo ? m : [...m, to]))

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={titulo}
      description={`Marque até ${maximo}. Aparecem só as telas que você pode abrir.`}
      size="lg"
      footer={
        <>
          <Button variant="ghost" onClick={() => setMarcadas(padrao)} className="mr-auto">
            <RotateCcw className="h-3.5 w-3.5" /> Voltar ao padrão
          </Button>
          <Button variant="outline" onClick={onClose}>Cancelar</Button>
          <Button onClick={() => onSalvar(marcadas)}>Salvar</Button>
        </>
      }
    >
      <div className="relative mb-4">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-foreground/35" />
        <input
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          placeholder="Procurar tela…"
          className="h-10 w-full rounded-xl border border-line bg-elevate/[0.03] pl-9 pr-3 text-sm text-foreground outline-none placeholder:text-foreground/35 focus:border-accent/40"
        />
      </div>
      <p className="mb-3 text-xs text-foreground/50">{marcadas.length} de {maximo} escolhida(s){cheio ? ' — desmarque uma pra trocar' : ''}</p>
      <div className="space-y-4">
        {grupos.map((g) => (
          <div key={g}>
            <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-foreground/40">{g}</p>
            <div className="grid gap-1.5 sm:grid-cols-2">
              {visiveis.filter((p) => p.grupo === g).map((p) => {
                const ordem = marcadas.indexOf(p.to)
                const marcada = ordem >= 0
                return (
                  <button
                    key={p.to}
                    type="button"
                    onClick={() => alternar(p.to)}
                    disabled={!marcada && cheio}
                    className={cn(
                      'flex items-center gap-2.5 rounded-xl border px-2.5 py-2 text-left transition-colors',
                      marcada ? 'border-accent/40 bg-accent/5' : 'border-line hover:bg-elevate/[0.03]',
                      !marcada && cheio && 'cursor-not-allowed opacity-40',
                    )}
                  >
                    <Icone pagina={p} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm text-foreground">{p.label}</span>
                      <span className="block truncate text-[11px] text-foreground/45">{p.descricao}</span>
                    </span>
                    <span className={cn('grid h-5 w-5 shrink-0 place-items-center rounded-full text-[10px] font-semibold', marcada ? 'bg-accent text-white' : 'ring-1 ring-line')}>
                      {marcada ? (maximo > 1 ? ordem + 1 : <Check className="h-3 w-3" />) : null}
                    </span>
                  </button>
                )
              })}
            </div>
          </div>
        ))}
        {grupos.length === 0 && <p className="py-6 text-center text-xs text-foreground/45">Nenhuma tela com esse nome.</p>}
      </div>
    </Modal>
  )
}
