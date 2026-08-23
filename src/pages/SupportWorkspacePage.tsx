import * as React from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Building2,
  Calendar,
  CheckCircle2,
  ClipboardList,
  Clock,
  ExternalLink,
  KanbanSquare,
  ListTodo,
  MessageCircle,
  Pencil,
  Plus,
  Send,
  Settings2,
  StickyNote,
  Trash2,
  Users2,
} from 'lucide-react'
import { toast } from 'sonner'
import { TopBar } from '@/components/layout/TopBar'
import { useSupportView, useSupportViewValue } from '@/components/support/SupportViewContext'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Modal } from '@/components/ui/Modal'
import { Badge } from '@/components/ui/Badge'
import { useAllReminders } from '@/hooks/useTickets'
import { useClients, useSettings } from '@/hooks/useClients'
import { useAuth } from '@/hooks/useAuth'
import { useTeam, teamMemberLabel } from '@/hooks/useTeam'
import { useOutsideClose } from '@/hooks/useOutsideClose'
import { ticketsService } from '@/services/tickets'
import { db } from '@/services/db'
import { api } from '@/services/api'
import { canManageUsers } from '@/services/supabase'
import { computeAlerts } from '@/lib/crmAlerts'
import { STAGE_SLA_DAYS } from '@/constants/stageColors'
import { cn } from '@/lib/utils'
import type {
  Reminder,
  ReminderKind,
  ReminderStatus,
  ReminderPriority,
} from '@/types/ticket'
import type { TeamMember } from '@/hooks/useTeam'
import type { PipelineStage } from '@/types/client'
import { SupportKanbanBoard } from '@/components/support/SupportKanbanBoard'
import {
  KIND_META,
  PRIORITY_META,
  PRIORITY_ORDER,
  bucketOf,
  dueChipCls,
  fmtDue,
  statusLabel,
} from '@/lib/supportMeta'
import { useSupportColumns, useSupportColumnLabels } from '@/hooks/useSupportColumns'
import type { SupportColumn } from '@/types/supportColumn'

/** Modo de visualização escolhido (lista ou kanban) — lembrado no navegador. */
const VIEW_KEY = 'support_view_mode'

function toLocalInput(iso?: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}
function fromLocalInput(v: string): string | null {
  if (!v) return null
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? null : d.toISOString()
}

/** Casa o texto livre do responsável (ex.: responsavelEntrega) com um membro
 *  do time, por nome ou e-mail (case-insensitive). Retorna o id do perfil. */
function resolveTeamId(team: TeamMember[], name?: string | null): string | undefined {
  const n = (name ?? '').trim().toLowerCase()
  if (!n) return undefined
  const hit = team.find(
    (m) => (m.name ?? '').trim().toLowerCase() === n || m.email.trim().toLowerCase() === n,
  )
  return hit?.id
}

/** Prazo (ISO) a partir do SLA da etapa: hoje + STAGE_SLA_DAYS[stage] dias. */
function slaDueFromStage(stage: string): string | null {
  const days = (STAGE_SLA_DAYS as Record<string, number | undefined>)[stage]
  if (!days) return null
  const d = new Date()
  d.setDate(d.getDate() + days)
  return d.toISOString()
}

// ── Página ────────────────────────────────────────────────────────────────────
export function SupportWorkspacePage() {
  const reminders = useAllReminders()
  const clients = useClients()
  const team = useTeam()
  const { profile } = useAuth()
  const settings = useSettings()
  const navigate = useNavigate()
  const myId = profile?.id
  const isAdmin = canManageUsers(profile?.role)

  // A visão em lista segue sendo o padrão; o Kanban é opcional e a escolha
  // fica salva no navegador pra não ter que alternar a cada visita.
  // As colunas do quadro também nomeiam o status na lista e no modal.
  const columns = useSupportColumns()
  const statusLabels = useSupportColumnLabels()

  // Numa cópia do menu ("Duplicar") a preferência de Lista/Kanban é dela, não do Suporte inteiro:
  // a chave do localStorage leva o id da cópia, senão alternar aqui mudaria a tela original também.
  const supportView = useSupportView()
  const viewStorageKey = supportView ? `${VIEW_KEY}:${supportView.pageId}` : VIEW_KEY
  const [view, setView] = React.useState<'list' | 'kanban'>(() => {
    const saved = localStorage.getItem(viewStorageKey)
    if (saved === 'kanban' || saved === 'list') return saved
    // Sem escolha anterior nessa cópia, vale o modo definido ao duplicar.
    return supportView?.config.view === 'kanban' ? 'kanban' : 'list'
  })
  React.useEffect(() => {
    localStorage.setItem(viewStorageKey, view)
  }, [view, viewStorageKey])
  const [filterKind, setFilterKind] = React.useState<ReminderKind | 'all'>(
    useSupportViewValue<ReminderKind | 'all'>('filterKind', 'all'),
  )
  // Filtros rápidos (uma dimensão) + seletor de pessoa específica (outra).
  const [quick, setQuick] = React.useState<'all' | 'mine' | 'unassigned' | 'overdue' | 'today'>(
    useSupportViewValue<'all' | 'mine' | 'unassigned' | 'overdue' | 'today'>('quick', 'all'),
  )
  const [filterPerson, setFilterPerson] = React.useState<string>('') // '' = qualquer pessoa
  const [editing, setEditing] = React.useState<Reminder | null | undefined>(undefined) // undefined = closed

  const clientOf = React.useCallback(
    (clientId?: string | null) =>
      clientId ? clients.find((x) => x.id === clientId) : undefined,
    [clients],
  )

  const companyOf = React.useCallback(
    (clientId?: string | null) => {
      const c = clientOf(clientId)
      return c ? c.company || c.name : undefined
    },
    [clientOf],
  )

  // Ids de donos válidos (membros atuais do time) — usado por "Sem dono" para
  // pegar também tarefas cujo dono saiu do time (órfãs).
  const knownOwnerIds = React.useMemo(() => new Set(team.map((m) => m.id)), [team])

  const filtered = React.useMemo(() => {
    return reminders.filter((r) => {
      if (filterKind !== 'all' && (r.kind ?? 'task') !== filterKind) return false
      if (filterPerson && r.userId !== filterPerson) return false
      if (quick === 'mine' && r.userId !== myId) return false
      if (quick === 'unassigned' && r.userId && knownOwnerIds.has(r.userId)) return false
      if (quick === 'overdue' && bucketOf(r.dueAt) !== 'overdue') return false
      if (quick === 'today' && bucketOf(r.dueAt) !== 'today') return false
      return true
    })
  }, [reminders, filterKind, filterPerson, quick, myId, knownOwnerIds])

  const openTasks = React.useMemo(() => filtered.filter((r) => !r.completedAt), [filtered])

  // Mapa id->nome do responsável (pra exibir no card).
  const teamMap = React.useMemo(() => {
    const m = new Map<string, string>()
    for (const t of team) m.set(t.id, teamMemberLabel(t))
    return m
  }, [team])

  // Agrupado por prioridade (Alta / Média / Baixa), cada grupo por prazo.
  const byPriority = React.useMemo(() => {
    const map: Record<ReminderPriority, Reminder[]> = { high: [], normal: [], low: [] }
    for (const r of openTasks) map[r.priority ?? 'normal'].push(r)
    const dueTime = (r: Reminder) => (r.dueAt ? new Date(r.dueAt).getTime() : Number.MAX_SAFE_INTEGER)
    for (const p of PRIORITY_ORDER) map[p].sort((a, c) => dueTime(a) - dueTime(c))
    return map
  }, [openTasks])

  const doneTasks = React.useMemo(
    () => filtered.filter((r) => r.completedAt).slice(0, 30),
    [filtered],
  )

  // Base p/ as contagens dos chips: abertas, filtradas só por tipo/pessoa (não
  // pelo filtro rápido) — assim "Atrasadas (N)" não zera ao escolher "Hoje".
  const scopedOpen = React.useMemo(
    () =>
      reminders.filter(
        (r) =>
          !r.completedAt &&
          (filterKind === 'all' || (r.kind ?? 'task') === filterKind) &&
          (!filterPerson || r.userId === filterPerson),
      ),
    [reminders, filterKind, filterPerson],
  )
  const overdueCount = React.useMemo(
    () => scopedOpen.filter((r) => bucketOf(r.dueAt) === 'overdue').length,
    [scopedOpen],
  )
  const todayCount = React.useMemo(
    () => scopedOpen.filter((r) => bucketOf(r.dueAt) === 'today').length,
    [scopedOpen],
  )

  // Reuniões abertas (futuras + atrasadas), ordenadas pela data.
  const meetings = React.useMemo(
    () =>
      reminders
        .filter((r) => (r.kind ?? 'task') === 'meeting' && !r.completedAt && r.dueAt)
        .sort((a, b) => new Date(a.dueAt!).getTime() - new Date(b.dueAt!).getTime()),
    [reminders],
  )

  // Pop-up limpo, uma vez por dia: resumo do que precisa de atenção.
  React.useEffect(() => {
    const today = new Date().toISOString().slice(0, 10)
    const KEY = 'support_daily_alert'
    if (localStorage.getItem(KEY) === today) return
    const parts: string[] = []
    if (overdueCount > 0) parts.push(`${overdueCount} vencida(s)`)
    if (todayCount > 0) parts.push(`${todayCount} para hoje`)
    const nextMeetingToday = meetings.find((m) => bucketOf(m.dueAt) === 'today')
    if (parts.length === 0 && !nextMeetingToday) return // nada a avisar (ou ainda carregando)
    localStorage.setItem(KEY, today)
    toast(`📋 Suporte de hoje`, {
      description:
        (parts.join(' · ') || 'Sem tarefas para hoje') +
        (nextMeetingToday ? ` · Reunião ${fmtDue(nextMeetingToday.dueAt!)}` : ''),
      duration: 8000,
    })
  }, [overdueCount, todayCount, meetings])

  return (
    <>
      <TopBar
        title="Suporte"
        subtitle={`${openTasks.length} aberta(s) · ${overdueCount} atrasada(s) · ${todayCount} hoje`}
        rightSlot={
          <Button onClick={() => setEditing(null)} leftIcon={<Plus className="h-4 w-4" />}>
            Nova tarefa
          </Button>
        }
      />

      <div className="px-4 py-4 sm:px-6 sm:py-6 lg:px-8">
        {/* Barra de filtros + alternância de visão */}
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-1.5">
            <Chip active={filterKind === 'all'} onClick={() => setFilterKind('all')}>
              Tudo
            </Chip>
            {(Object.keys(KIND_META) as ReminderKind[]).map((k) => (
              <Chip key={k} active={filterKind === k} onClick={() => setFilterKind(k)}>
                <span className="inline-flex items-center gap-1">
                  {KIND_META[k].icon}
                  {KIND_META[k].label}
                </span>
              </Chip>
            ))}
            <span className="mx-1 h-4 w-px bg-line" />
            <Chip active={quick === 'all'} onClick={() => setQuick('all')}>
              Todas
            </Chip>
            <Chip active={quick === 'mine'} onClick={() => setQuick('mine')}>
              Minhas
            </Chip>
            <Chip active={quick === 'unassigned'} onClick={() => setQuick('unassigned')}>
              Sem dono
            </Chip>
            <Chip active={quick === 'overdue'} onClick={() => setQuick('overdue')}>
              Atrasadas{overdueCount > 0 ? ` (${overdueCount})` : ''}
            </Chip>
            <Chip active={quick === 'today'} onClick={() => setQuick('today')}>
              Hoje{todayCount > 0 ? ` (${todayCount})` : ''}
            </Chip>
            {team.length > 0 && (
              <select
                value={filterPerson}
                onChange={(e) => setFilterPerson(e.target.value)}
                className="h-7 rounded-lg border border-line bg-elevate/[0.04] px-2 text-xs text-foreground/70 outline-none focus:border-accent/40"
              >
                <option value="">Responsável…</option>
                {team.map((m) => (
                  <option key={m.id} value={m.id}>
                    {teamMemberLabel(m)}
                  </option>
                ))}
              </select>
            )}
          </div>

          <div className="inline-flex overflow-hidden rounded-lg border border-line">
            <ViewBtn active={view === 'list'} onClick={() => setView('list')} icon={<ListTodo className="h-4 w-4" />}>
              Lista
            </ViewBtn>
            <ViewBtn active={view === 'kanban'} onClick={() => setView('kanban')} icon={<KanbanSquare className="h-4 w-4" />}>
              Kanban
            </ViewBtn>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-5 xl:grid-cols-[1fr_340px]">
          <div>
            {view === 'list' ? (
              <ListView
                byPriority={byPriority}
                doneTasks={doneTasks}
                companyOf={companyOf}
                teamMap={teamMap}
                statusLabels={statusLabels}
                onEdit={setEditing}
                onOpenClient={(id) => navigate(`/clients?open=${id}`)}
              />
            ) : (
              <SupportKanbanBoard
                tasks={filtered}
                clientOf={clientOf}
                teamMap={teamMap}
                onEdit={setEditing}
              />
            )}
          </div>

          <div className="space-y-5">
            <WhatsAppGroupCard
              settings={settings}
              isAdmin={isAdmin}
              openTasks={openTasks}
              meetings={meetings}
              teamMap={teamMap}
              companyOf={companyOf}
            />
            <MeetingsPanel
              meetings={meetings}
              companyOf={companyOf}
              onOpenClient={(id) => navigate(`/clients?open=${id}`)}
            />
            <PipelinePanel
              clients={clients}
              team={team}
              reminders={reminders}
              myId={myId}
              slaByStage={settings.slaByStage}
              onConvert={(r) => setEditing(r)}
            />
          </div>
        </div>
      </div>

      {editing !== undefined && (
        <TaskModal
          initial={editing}
          clients={clients}
          team={team}
          columns={columns}
          defaultAssignee={myId}
          onClose={() => setEditing(undefined)}
        />
      )}
    </>
  )
}

// ── Lista agrupada por prioridade ─────────────────────────────────────────────
function ListView({
  byPriority,
  doneTasks,
  companyOf,
  teamMap,
  statusLabels,
  onEdit,
  onOpenClient,
}: {
  byPriority: Record<ReminderPriority, Reminder[]>
  doneTasks: Reminder[]
  companyOf: (id?: string | null) => string | undefined
  teamMap: Map<string, string>
  statusLabels: Map<string, string>
  onEdit: (r: Reminder) => void
  onOpenClient: (id: string) => void
}) {
  const hasAny = PRIORITY_ORDER.some((p) => byPriority[p].length > 0)
  return (
    <div className="space-y-5">
      {!hasAny && (
        <div className="rounded-2xl border border-line bg-card px-4 py-10 text-center text-sm text-foreground/45">
          Nenhuma tarefa aberta. Crie a primeira em “Nova tarefa”. 🎯
        </div>
      )}
      {PRIORITY_ORDER.map((p) =>
        byPriority[p].length === 0 ? null : (
          <section key={p}>
            <h3 className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider">
              <span className={cn('h-2 w-2 rounded-full', PRIORITY_META[p].dot)} />
              <span className={PRIORITY_META[p].header}>Prioridade {PRIORITY_META[p].label}</span>
              <span className="rounded-full bg-elevate/[0.06] px-1.5 py-0.5 text-[10px] text-foreground/50">
                {byPriority[p].length}
              </span>
            </h3>
            <ul className="space-y-2">
              {byPriority[p].map((r) => (
                <TaskRow
                  key={r.id}
                  r={r}
                  company={companyOf(r.clientId)}
                  assignee={teamMap.get(r.userId)}
                  statusLabels={statusLabels}
                  onEdit={() => onEdit(r)}
                  onOpenClient={onOpenClient}
                />
              ))}
            </ul>
          </section>
        ),
      )}

      {doneTasks.length > 0 && (
        <details className="rounded-xl border border-line bg-card">
          <summary className="cursor-pointer px-4 py-2.5 text-xs font-medium text-foreground/55">
            Concluídas recentemente ({doneTasks.length})
          </summary>
          <ul className="divide-y divide-line p-2">
            {doneTasks.map((r) => (
              <TaskRow
                key={r.id}
                r={r}
                company={companyOf(r.clientId)}
                assignee={teamMap.get(r.userId)}
                statusLabels={statusLabels}
                onEdit={() => onEdit(r)}
                onOpenClient={onOpenClient}
                done
              />
            ))}
          </ul>
        </details>
      )}
    </div>
  )
}

function TaskRow({
  r,
  company,
  assignee,
  statusLabels,
  onEdit,
  onOpenClient,
  done,
}: {
  r: Reminder
  company?: string
  assignee?: string
  statusLabels: Map<string, string>
  onEdit: () => void
  onOpenClient: (id: string) => void
  done?: boolean
}) {
  const kind = KIND_META[r.kind ?? 'task']
  const prio = PRIORITY_META[r.priority ?? 'normal']
  return (
    <li className="flex items-start gap-3 rounded-xl border border-line bg-card px-3.5 py-3">
      <button
        type="button"
        title={done ? 'Reabrir' : 'Concluir'}
        onClick={() => (done ? ticketsService.reopenReminder(r.id) : ticketsService.completeReminder(r.id))}
        className={cn(
          'mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full ring-1 transition-colors',
          done
            ? 'bg-success/15 text-success ring-success/30'
            : 'text-foreground/30 ring-line hover:bg-success/10 hover:text-success hover:ring-success/30',
        )}
      >
        <CheckCircle2 className="h-3.5 w-3.5" />
      </button>

      <div className="min-w-0 flex-1">
        {/* Empresa em destaque + botão de abrir (igual abrir um cliente) */}
        {company && (
          <button
            type="button"
            onClick={() => r.clientId && onOpenClient(r.clientId)}
            title="Abrir cliente"
            className="mb-1 inline-flex max-w-full items-center gap-1.5 rounded-lg bg-accent/10 px-2 py-1 text-xs font-semibold text-accent ring-1 ring-accent/20 transition-colors hover:bg-accent/15"
          >
            <Building2 className="h-3.5 w-3.5 shrink-0" />
            <span className="truncate">{company}</span>
            <ExternalLink className="h-3 w-3 shrink-0 opacity-70" />
          </button>
        )}

        <div className="flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center gap-1 rounded bg-elevate/[0.05] px-1.5 py-0.5 text-[10px] text-foreground/55">
            {kind.icon}
            {kind.label}
          </span>
          {!done && (
            <span className={cn('rounded-full px-1.5 py-0.5 text-[10px] font-semibold ring-1', prio.chip)}>
              {prio.label}
            </span>
          )}
          <span className={cn('text-sm', done ? 'text-foreground/40 line-through' : 'font-medium text-foreground')}>
            {r.title}
          </span>
        </div>

        <div className="mt-1.5 flex flex-wrap items-center gap-2 text-[11px]">
          {r.dueAt && (
            <span
              className={cn(
                'inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 font-medium ring-1',
                dueChipCls(r.dueAt),
              )}
            >
              <Clock className="h-3 w-3" />
              Até {fmtDue(r.dueAt)}
            </span>
          )}
          <span className="inline-flex items-center gap-1 text-foreground/45">
            <Users2 className="h-3 w-3" />
            {assignee ?? '—'}
          </span>
          <span className="text-foreground/35">· {statusLabel(r.status, statusLabels)}</span>
        </div>

        {r.notes && <p className="mt-1.5 line-clamp-2 text-[11px] text-foreground/50">{r.notes}</p>}
      </div>

      <div className="flex shrink-0 items-center gap-1">
        <IconBtn title="Editar" onClick={onEdit}>
          <Pencil className="h-3.5 w-3.5" />
        </IconBtn>
        <IconBtn title="Excluir" danger onClick={() => ticketsService.deleteReminder(r.id)}>
          <Trash2 className="h-3.5 w-3.5" />
        </IconBtn>
      </div>
    </li>
  )
}

// ── Painel "do pipeline" ──────────────────────────────────────────────────────
const ACTIONABLE = new Set([
  'briefing_pending_send',
  'briefing_sent_waiting',
  'briefing_filled_no_setup',
  'setup_in_progress',
  'delivery_scheduled',
  'followup_pending',
])

function PipelinePanel({
  clients,
  team,
  reminders,
  myId,
  slaByStage,
  onConvert,
}: {
  clients: ReturnType<typeof useClients>
  team: TeamMember[]
  reminders: Reminder[]
  myId?: string
  slaByStage?: Partial<Record<PipelineStage, number>>
  onConvert: (r: Reminder) => void
}) {
  const navigate = useNavigate()
  // Tarefas abertas já existentes, indexadas por cliente+título — pra não
  // oferecer virar tarefa um alerta que já virou (evita duplicar).
  const openTaskKeys = React.useMemo(() => {
    const set = new Set<string>()
    for (const r of reminders) {
      if (r.completedAt) continue
      if (r.clientId) set.add(`${r.clientId}::${r.title.trim().toLowerCase()}`)
    }
    return set
  }, [reminders])

  const alerts = React.useMemo(
    () =>
      computeAlerts(clients, slaByStage)
        .filter((a) => ACTIONABLE.has(a.kind))
        .filter((a) => !openTaskKeys.has(`${a.client.id}::${a.title.trim().toLowerCase()}`))
        .slice(0, 12),
    [clients, openTaskKeys, slaByStage],
  )
  return (
    <section className="rounded-2xl border border-line bg-card">
      <header className="flex items-center gap-2 border-b border-line px-4 py-3">
        <ClipboardList className="h-4 w-4 text-accent" />
        <div>
          <h3 className="text-sm font-medium text-foreground">Do pipeline</h3>
          <p className="text-[11px] text-foreground/45">Demandas que vêm do funil</p>
        </div>
        <Badge tone={alerts.length === 0 ? 'neutral' : 'warning'} dot={alerts.length > 0}>
          {alerts.length}
        </Badge>
      </header>
      {alerts.length === 0 ? (
        <p className="px-4 py-6 text-center text-xs text-foreground/40">Nada pendente no pipeline. 🎉</p>
      ) : (
        <ul className="divide-y divide-line">
          {alerts.map((a) => (
            <li key={`${a.kind}-${a.client.id}`} className="px-4 py-2.5">
              <p className="truncate text-sm text-foreground">{a.title}</p>
              <p className="truncate text-[11px] text-foreground/50">{a.subtitle}</p>
              <div className="mt-1 flex items-center gap-2">
                <button
                  onClick={() => navigate(`/clients?open=${a.client.id}`)}
                  className="text-[11px] text-accent hover:underline"
                >
                  Abrir
                </button>
                <button
                  onClick={() =>
                    onConvert({
                      id: '',
                      // Dono = responsável de ENTREGA do cliente (casado com o
                      // time). Sem correspondência, cai para quem está clicando.
                      userId:
                        resolveTeamId(team, a.client.responsavelEntrega) ??
                        resolveTeamId(team, a.client.responsavel) ??
                        myId ??
                        '',
                      clientId: a.client.id,
                      title: a.title,
                      notes: a.subtitle,
                      // Prazo pelo SLA da etapa; sem SLA, usa o "quando" do alerta.
                      dueAt: slaDueFromStage(a.client.stage) ?? a.whenAt ?? null,
                      createdAt: '',
                      kind: 'pending',
                      status: 'todo',
                      priority: a.tone === 'danger' ? 'high' : 'normal',
                    })
                  }
                  className="text-[11px] text-foreground/55 hover:text-accent hover:underline"
                >
                  Virar tarefa
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

// ── Modal de criar/editar ─────────────────────────────────────────────────────
function TaskModal({
  initial,
  clients,
  team,
  columns,
  defaultAssignee,
  onClose,
}: {
  initial: Reminder | null
  clients: ReturnType<typeof useClients>
  team: ReturnType<typeof useTeam>
  columns: SupportColumn[]
  defaultAssignee?: string
  onClose: () => void
}) {
  const editing = Boolean(initial?.id)
  const [kind, setKind] = React.useState<ReminderKind>(initial?.kind ?? 'task')
  const [title, setTitle] = React.useState(initial?.title ?? '')
  const [clientId, setClientId] = React.useState(initial?.clientId ?? '')
  const [notes, setNotes] = React.useState(initial?.notes ?? '')
  // Nova tarefa já vem com a data de hoje como prazo (editável).
  const [due, setDue] = React.useState(
    initial?.dueAt ? toLocalInput(initial.dueAt) : toLocalInput(new Date().toISOString()),
  )
  const [assignee, setAssignee] = React.useState(initial?.userId || defaultAssignee || '')
  const [priority, setPriority] = React.useState<ReminderPriority>(initial?.priority ?? 'normal')
  // Tarefa nova nasce na primeira coluna do quadro (hoje "A Fazer").
  const [status, setStatus] = React.useState<ReminderStatus>(
    initial?.status ?? columns[0]?.key ?? 'todo',
  )
  const [saving, setSaving] = React.useState(false)

  const save = async () => {
    if (!title.trim()) {
      toast.error('Dê um título para a tarefa')
      return
    }
    if (!clientId) {
      toast.error('Selecione a empresa')
      return
    }
    if (!assignee) {
      toast.error('Selecione um responsável')
      return
    }
    // Prazo obrigatório para tarefas de verdade. Anotação (note) é backlog sem
    // data por definição, então fica isenta.
    if (kind !== 'note' && !fromLocalInput(due)) {
      toast.error('Defina um prazo para a tarefa')
      return
    }
    setSaving(true)
    await ticketsService.upsertReminder({
      id: initial?.id || undefined,
      userId: assignee,
      clientId: clientId || null,
      title: title.trim(),
      notes: notes.trim() || undefined,
      dueAt: fromLocalInput(due),
      kind,
      status,
      priority,
    })
    setSaving(false)
    toast.success(editing ? 'Tarefa atualizada' : 'Tarefa criada')
    onClose()
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={editing ? 'Editar tarefa' : 'Nova tarefa'}
      size="md"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            Cancelar
          </Button>
          <Button onClick={save} loading={saving}>
            {editing ? 'Salvar' : 'Criar'}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div>
          <div className="mb-1.5 text-[11px] uppercase tracking-wider text-foreground/45">Tipo</div>
          <div className="flex flex-wrap gap-1.5">
            {(Object.keys(KIND_META) as ReminderKind[]).map((k) => (
              <Chip key={k} active={kind === k} onClick={() => setKind(k)}>
                <span className="inline-flex items-center gap-1">
                  {KIND_META[k].icon}
                  {KIND_META[k].label}
                </span>
              </Chip>
            ))}
          </div>
        </div>

        <Input label="Título *" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Ex.: Retornar erro de envio para o cliente" />

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Empresa *">
            <ClientCombobox clients={clients} value={clientId} onChange={setClientId} />
          </Field>
          <Field label="Responsável *">
            <Select value={assignee} onChange={setAssignee}>
              <option value="">— Selecionar —</option>
              {team.map((m) => (
                <option key={m.id} value={m.id}>
                  {teamMemberLabel(m)}
                </option>
              ))}
            </Select>
          </Field>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Field label="Prazo de entrega">
            <input
              type="datetime-local"
              value={due}
              onChange={(e) => setDue(e.target.value)}
              className="h-9 w-full rounded-lg border border-line bg-elevate/[0.04] px-2.5 text-sm text-foreground outline-none focus:border-accent/40"
            />
          </Field>
          <Field label="Prioridade">
            <Select value={priority} onChange={(v) => setPriority(v as ReminderPriority)}>
              {(Object.keys(PRIORITY_META) as ReminderPriority[]).map((p) => (
                <option key={p} value={p}>
                  {PRIORITY_META[p].label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Status">
            <Select value={status} onChange={(v) => setStatus(v as ReminderStatus)}>
              {columns.map((c) => (
                <option key={c.id} value={c.key}>
                  {c.name}
                </option>
              ))}
            </Select>
          </Field>
        </div>

        <Field label="Detalhes / infos">
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={4}
            placeholder="Contexto, o que perguntar pra equipe técnica, links…"
            className="w-full rounded-lg border border-line bg-elevate/[0.04] px-3 py-2 text-sm text-foreground outline-none focus:border-accent/40"
          />
        </Field>
      </div>
    </Modal>
  )
}

// ── Painel de Reuniões (lateral direita) ──────────────────────────────────────
function MeetingsPanel({
  meetings,
  companyOf,
  onOpenClient,
}: {
  meetings: Reminder[]
  companyOf: (id?: string | null) => string | undefined
  onOpenClient: (id: string) => void
}) {
  return (
    <section className="rounded-2xl border border-line bg-card">
      <header className="flex items-center gap-2 border-b border-line px-4 py-3">
        <Calendar className="h-4 w-4 text-accent" />
        <div className="flex-1">
          <h3 className="text-sm font-medium text-foreground">Reuniões</h3>
          <p className="text-[11px] text-foreground/45">Agendadas, por data</p>
        </div>
        <Badge tone={meetings.length === 0 ? 'neutral' : 'info'} dot={meetings.length > 0}>
          {meetings.length}
        </Badge>
      </header>
      {meetings.length === 0 ? (
        <p className="px-4 py-6 text-center text-xs text-foreground/40">Nenhuma reunião agendada.</p>
      ) : (
        <ul className="divide-y divide-line">
          {meetings.slice(0, 10).map((m) => {
            const overdue = bucketOf(m.dueAt) === 'overdue'
            return (
              <li key={m.id} className="flex items-start gap-3 px-4 py-2.5">
                <span
                  className={cn(
                    'mt-0.5 inline-flex shrink-0 items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-medium ring-1',
                    dueChipCls(m.dueAt),
                  )}
                >
                  {fmtDue(m.dueAt!)}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm text-foreground">{m.title}</p>
                  {companyOf(m.clientId) && (
                    <button
                      onClick={() => m.clientId && onOpenClient(m.clientId)}
                      className="inline-flex items-center gap-1 text-[11px] text-accent hover:underline"
                    >
                      <Building2 className="h-3 w-3" />
                      {companyOf(m.clientId)}
                    </button>
                  )}
                  {overdue && <span className="ml-1 text-[10px] text-danger">· atrasada</span>}
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}

// ── Grupo de WhatsApp (alertas) ───────────────────────────────────────────────
function buildDemandsMessage(
  openTasks: Reminder[],
  meetings: Reminder[],
  teamMap: Map<string, string>,
  companyOf: (id?: string | null) => string | undefined,
): string {
  const overdue = openTasks.filter((r) => bucketOf(r.dueAt) === 'overdue')
  const today = openTasks.filter((r) => bucketOf(r.dueAt) === 'today')
  const todayMeetings = meetings.filter((m) => bucketOf(m.dueAt) === 'today')
  const line = (r: Reminder) => {
    const co = companyOf(r.clientId)
    const resp = teamMap.get(r.userId)
    return `• ${r.title}${co ? ` — ${co}` : ''}${resp ? ` (${resp})` : ''}`
  }
  const d = new Date()
  const dateStr = `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`
  const out: string[] = [`📋 *Demandas do suporte — ${dateStr}*`]
  if (overdue.length) out.push('', `🔴 *Vencidas (${overdue.length})*`, ...overdue.map(line))
  if (today.length) out.push('', `⭐ *Para hoje (${today.length})*`, ...today.map(line))
  if (todayMeetings.length)
    out.push(
      '',
      `📅 *Reuniões de hoje*`,
      ...todayMeetings.map(
        (m) => `• ${fmtDue(m.dueAt!)} — ${m.title}${companyOf(m.clientId) ? ` (${companyOf(m.clientId)})` : ''}`,
      ),
    )
  if (!overdue.length && !today.length && !todayMeetings.length) out.push('', 'Nenhuma demanda pendente para hoje. ✅')
  return out.join('\n')
}

async function sendToGroup(text: string): Promise<boolean> {
  try {
    await api.post('/api/support-group/send', { text })
    toast.success('Mensagem enviada ao grupo')
    return true
  } catch (err) {
    toast.error('Falha ao enviar: ' + ((err as Error)?.message ?? 'erro'))
    return false
  }
}

function WhatsAppGroupCard({
  settings,
  isAdmin,
  openTasks,
  meetings,
  teamMap,
  companyOf,
}: {
  settings: ReturnType<typeof useSettings>
  isAdmin: boolean
  openTasks: Reminder[]
  meetings: Reminder[]
  teamMap: Map<string, string>
  companyOf: (id?: string | null) => string | undefined
}) {
  const sg = settings.supportGroup
  const configured = Boolean(sg?.groupId && sg?.apiId && (sg?.tokenSet || sg?.token))
  const [msgOpen, setMsgOpen] = React.useState(false)
  const [configOpen, setConfigOpen] = React.useState(false)
  const [sending, setSending] = React.useState(false)

  const sendDemands = async () => {
    setSending(true)
    await sendToGroup(buildDemandsMessage(openTasks, meetings, teamMap, companyOf))
    setSending(false)
  }

  return (
    <section className="rounded-2xl border border-line bg-card">
      <header className="flex items-center gap-2 border-b border-line px-4 py-3">
        <MessageCircle className="h-4 w-4 text-success" />
        <div className="flex-1">
          <h3 className="text-sm font-medium text-foreground">Grupo do WhatsApp</h3>
          <p className="text-[11px] text-foreground/45">
            {configured ? 'Alertas do suporte' : 'Não configurado'}
          </p>
        </div>
        {isAdmin && (
          <button
            type="button"
            title="Configurar grupo"
            onClick={() => setConfigOpen(true)}
            className="grid h-7 w-7 place-items-center rounded-lg text-foreground/45 ring-1 ring-line hover:bg-elevate/[0.06] hover:text-foreground/80"
          >
            <Settings2 className="h-3.5 w-3.5" />
          </button>
        )}
      </header>

      <div className="space-y-2 p-3">
        {!configured ? (
          <p className="rounded-lg border border-warning/30 bg-warning/5 px-3 py-2 text-xs text-warning">
            {isAdmin
              ? 'Configure o grupo (engrenagem) para enviar alertas.'
              : 'Grupo ainda não configurado por um admin.'}
          </p>
        ) : (
          <>
            <Button
              onClick={sendDemands}
              loading={sending}
              leftIcon={<Send className="h-4 w-4" />}
              className="w-full"
            >
              Enviar demandas do dia
            </Button>
            <Button
              variant="secondary"
              onClick={() => setMsgOpen(true)}
              leftIcon={<MessageCircle className="h-4 w-4" />}
              className="w-full"
            >
              Enviar mensagem manual
            </Button>
          </>
        )}
      </div>

      {msgOpen && <SendMessageModal onClose={() => setMsgOpen(false)} />}
      {configOpen && <GroupConfigModal settings={settings} onClose={() => setConfigOpen(false)} />}
    </section>
  )
}

function SendMessageModal({ onClose }: { onClose: () => void }) {
  const [text, setText] = React.useState('')
  const [sending, setSending] = React.useState(false)
  const send = async () => {
    if (!text.trim()) {
      toast.error('Digite a mensagem')
      return
    }
    setSending(true)
    const ok = await sendToGroup(text.trim())
    setSending(false)
    if (ok) onClose()
  }
  return (
    <Modal
      open
      onClose={onClose}
      title="Enviar mensagem ao grupo"
      size="md"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={sending}>
            Cancelar
          </Button>
          <Button onClick={send} loading={sending} leftIcon={<Send className="h-4 w-4" />}>
            Enviar
          </Button>
        </>
      }
    >
      <textarea
        autoFocus
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={5}
        placeholder="Digite a mensagem para o grupo do WhatsApp…"
        className="w-full rounded-lg border border-line bg-elevate/[0.04] px-3 py-2 text-sm text-foreground outline-none focus:border-accent/40"
      />
    </Modal>
  )
}

function GroupConfigModal({
  settings,
  onClose,
}: {
  settings: ReturnType<typeof useSettings>
  onClose: () => void
}) {
  const sg = settings.supportGroup
  const [baseUrl, setBaseUrl] = React.useState(sg?.baseUrl || 'https://appapi.nxsystems.com.br')
  const [apiId, setApiId] = React.useState(sg?.apiId || '')
  const [groupId, setGroupId] = React.useState(sg?.groupId || '')
  const [token, setToken] = React.useState('')
  const [digestEnabled, setDigestEnabled] = React.useState(sg?.digestEnabled !== false)
  const [digestHour, setDigestHour] = React.useState(String(sg?.digestHour ?? 7))
  const [saving, setSaving] = React.useState(false)

  const save = async () => {
    if (!apiId.trim() || !groupId.trim()) {
      toast.error('Informe o ApiID e o ID do grupo')
      return
    }
    const hour = Math.min(23, Math.max(0, parseInt(digestHour, 10) || 7))
    setSaving(true)
    db.saveSettings({
      ...db.getSettings(),
      supportGroup: {
        baseUrl: baseUrl.trim() || undefined,
        apiId: apiId.trim(),
        groupId: groupId.trim(),
        token: token.trim(), // vazio = mantém o atual (merge no backend)
        digestEnabled,
        digestHour: hour,
      },
    })
    setSaving(false)
    toast.success('Grupo configurado')
    onClose()
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="Configurar grupo do WhatsApp"
      description="Token fica só no servidor — deixe em branco para manter o atual."
      size="md"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            Cancelar
          </Button>
          <Button onClick={save} loading={saving}>
            Salvar
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <Input label="URL base" value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} />
        <Input label="ApiID" value={apiId} onChange={(e) => setApiId(e.target.value)} placeholder="bed9539f-..." />
        <Input
          label="Token"
          type="password"
          value={token}
          onChange={(e) => setToken(e.target.value)}
          placeholder={sg?.tokenSet ? '•••••••• (configurado)' : 'Cole o token'}
        />
        <Input
          label="ID do grupo"
          value={groupId}
          onChange={(e) => setGroupId(e.target.value)}
          placeholder="number do grupo (ex.: 12356...@g.us)"
        />

        <div className="rounded-lg border border-line bg-elevate/[0.02] p-3">
          <label className="flex items-center gap-2 text-sm text-foreground/80">
            <input
              type="checkbox"
              checked={digestEnabled}
              onChange={(e) => setDigestEnabled(e.target.checked)}
              className="h-4 w-4 accent-[#4F8EF7]"
            />
            Enviar resumo diário automático
          </label>
          <div className="mt-2 flex items-center gap-2">
            <span className="text-xs text-foreground/55">Horário (0–23h, fuso de São Paulo):</span>
            <input
              type="number"
              min={0}
              max={23}
              value={digestHour}
              onChange={(e) => setDigestHour(e.target.value)}
              disabled={!digestEnabled}
              className="h-8 w-16 rounded-lg border border-line bg-elevate/[0.04] px-2 text-sm text-foreground outline-none focus:border-accent/40 disabled:opacity-50"
            />
          </div>
        </div>
      </div>
    </Modal>
  )
}

// ── UI helpers ────────────────────────────────────────────────────────────────
function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'rounded-full px-2.5 py-1 text-xs font-medium ring-1 transition-colors',
        active
          ? 'bg-accent/10 text-accent ring-accent/30'
          : 'bg-elevate/[0.04] text-foreground/55 ring-line hover:text-foreground/80',
      )}
    >
      {children}
    </button>
  )
}

function ViewBtn({
  active,
  onClick,
  icon,
  children,
}: {
  active: boolean
  onClick: () => void
  icon: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium transition-colors',
        active ? 'bg-accent/10 text-accent' : 'text-foreground/55 hover:bg-elevate/[0.04]',
      )}
    >
      {icon}
      {children}
    </button>
  )
}

function IconBtn({
  title,
  onClick,
  children,
  danger,
  small,
}: {
  title: string
  onClick: () => void
  children: React.ReactNode
  danger?: boolean
  small?: boolean
}) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      className={cn(
        'inline-flex items-center justify-center rounded-lg ring-1 ring-line text-foreground/45 transition-colors',
        small ? 'h-6 w-6 text-sm' : 'h-7 w-7',
        danger ? 'hover:bg-danger/10 hover:text-danger hover:ring-danger/30' : 'hover:bg-elevate/[0.06] hover:text-foreground/80',
      )}
    >
      {children}
    </button>
  )
}

function ClientCombobox({
  clients,
  value,
  onChange,
}: {
  clients: ReturnType<typeof useClients>
  value: string
  onChange: (id: string) => void
}) {
  const labelFor = React.useCallback(
    (id: string) => {
      const c = clients.find((x) => x.id === id)
      return c ? c.company || c.name : ''
    },
    [clients],
  )
  const [query, setQuery] = React.useState(() => labelFor(value))
  const [open, setOpen] = React.useState(false)
  const boxRef = React.useRef<HTMLDivElement>(null)
  useOutsideClose(boxRef, open, () => setOpen(false))

  // Sincroniza o texto quando a empresa muda de fora (ex.: editar / virar tarefa).
  React.useEffect(() => {
    setQuery(labelFor(value))
  }, [value, labelFor])

  const matches = React.useMemo(() => {
    const q = query.trim().toLowerCase()
    const list = q
      ? clients.filter((c) => `${c.company ?? ''} ${c.name ?? ''}`.toLowerCase().includes(q))
      : clients
    return list.slice(0, 8)
  }, [clients, query])

  return (
    <div ref={boxRef} className="relative">
      <input
        value={query}
        onChange={(e) => {
          setQuery(e.target.value)
          onChange('') // limpa a seleção até escolher uma da lista
          setOpen(true)
        }}
        onFocus={() => setOpen(true)}
        placeholder="Digite o nome da empresa…"
        className={cn(
          'h-9 w-full rounded-lg border bg-elevate/[0.04] px-2.5 text-sm text-foreground outline-none focus:border-accent/40',
          value ? 'border-line' : 'border-warning/40',
        )}
      />
      {open && matches.length > 0 && (
        <ul className="absolute z-20 mt-1 max-h-56 w-full overflow-auto rounded-lg border border-line bg-card shadow-lg">
          {matches.map((c) => (
            <li key={c.id}>
              <button
                type="button"
                onMouseDown={(e) => {
                  e.preventDefault()
                  onChange(c.id)
                  setQuery(c.company || c.name)
                  setOpen(false)
                }}
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-foreground/85 hover:bg-elevate/[0.05]"
              >
                <Building2 className="h-3.5 w-3.5 shrink-0 text-foreground/40" />
                <span className="truncate">{c.company || c.name}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {open && query.trim() && matches.length === 0 && (
        <div className="absolute z-20 mt-1 w-full rounded-lg border border-line bg-card px-3 py-2 text-xs text-foreground/45 shadow-lg">
          Nenhuma empresa encontrada
        </div>
      )}
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[11px] uppercase tracking-wider text-foreground/45">{label}</span>
      {children}
    </label>
  )
}

function Select({ value, onChange, children }: { value: string; onChange: (v: string) => void; children: React.ReactNode }) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="h-9 w-full rounded-lg border border-line bg-elevate/[0.04] px-2.5 text-sm text-foreground outline-none focus:border-accent/40"
    >
      {children}
    </select>
  )
}
