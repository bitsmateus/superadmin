import * as React from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Building2,
  Calendar,
  CheckCircle2,
  ClipboardList,
  Clock,
  KanbanSquare,
  ListTodo,
  Pencil,
  Plus,
  RotateCcw,
  StickyNote,
  Trash2,
  Users2,
} from 'lucide-react'
import { toast } from 'sonner'
import { TopBar } from '@/components/layout/TopBar'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Modal } from '@/components/ui/Modal'
import { Badge } from '@/components/ui/Badge'
import { useAllReminders } from '@/hooks/useTickets'
import { useClients } from '@/hooks/useClients'
import { useAuth } from '@/hooks/useAuth'
import { useTeam, teamMemberLabel } from '@/hooks/useTeam'
import { ticketsService } from '@/services/tickets'
import { computeAlerts } from '@/lib/crmAlerts'
import { cn, formatDateShort } from '@/lib/utils'
import type {
  Reminder,
  ReminderKind,
  ReminderStatus,
  ReminderPriority,
} from '@/types/ticket'

// ── Labels / metadados ────────────────────────────────────────────────────────
const KIND_META: Record<ReminderKind, { label: string; icon: React.ReactNode }> = {
  task: { label: 'Tarefa', icon: <ListTodo className="h-3.5 w-3.5" /> },
  pending: { label: 'Pendência', icon: <Clock className="h-3.5 w-3.5" /> },
  meeting: { label: 'Reunião', icon: <Calendar className="h-3.5 w-3.5" /> },
  note: { label: 'Anotação', icon: <StickyNote className="h-3.5 w-3.5" /> },
}
const STATUS_META: Record<ReminderStatus, { label: string }> = {
  todo: { label: 'A fazer' },
  doing: { label: 'Fazendo' },
  waiting: { label: 'Aguardando técnico' },
  done: { label: 'Concluído' },
}
const STATUS_ORDER: ReminderStatus[] = ['todo', 'doing', 'waiting', 'done']
const PRIORITY_META: Record<ReminderPriority, { label: string; cls: string }> = {
  low: { label: 'Baixa', cls: 'text-foreground/40' },
  normal: { label: 'Normal', cls: 'text-accent' },
  high: { label: 'Alta', cls: 'text-danger' },
}

// ── Helpers de data ───────────────────────────────────────────────────────────
type Bucket = 'overdue' | 'today' | 'week' | 'month' | 'later' | 'none'
const BUCKET_LABEL: Record<Bucket, string> = {
  overdue: 'Atrasadas',
  today: 'Hoje',
  week: 'Esta semana',
  month: 'Este mês',
  later: 'Depois',
  none: 'Sem data / Backlog',
}
const BUCKET_ORDER: Bucket[] = ['overdue', 'today', 'week', 'month', 'later', 'none']

function bucketOf(dueAt?: string | null): Bucket {
  if (!dueAt) return 'none'
  const d = new Date(dueAt)
  const now = new Date()
  const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const endToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999)
  const eow = new Date(endToday)
  eow.setDate(eow.getDate() + ((7 - eow.getDay()) % 7))
  const eom = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999)
  if (d < startToday) return 'overdue'
  if (d <= endToday) return 'today'
  if (d <= eow) return 'week'
  if (d <= eom) return 'month'
  return 'later'
}

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

// ── Página ────────────────────────────────────────────────────────────────────
export function SupportWorkspacePage() {
  const reminders = useAllReminders()
  const clients = useClients()
  const team = useTeam()
  const { profile } = useAuth()
  const navigate = useNavigate()
  const myId = profile?.id

  const [view, setView] = React.useState<'list' | 'kanban'>('list')
  const [filterKind, setFilterKind] = React.useState<ReminderKind | 'all'>('all')
  const [filterAssignee, setFilterAssignee] = React.useState<string>('all') // all | mine | <id>
  const [editing, setEditing] = React.useState<Reminder | null | undefined>(undefined) // undefined = closed

  const companyOf = React.useCallback(
    (clientId?: string | null) => {
      if (!clientId) return undefined
      const c = clients.find((x) => x.id === clientId)
      return c ? c.company || c.name : undefined
    },
    [clients],
  )

  const filtered = React.useMemo(() => {
    return reminders.filter((r) => {
      if (filterKind !== 'all' && (r.kind ?? 'task') !== filterKind) return false
      if (filterAssignee === 'mine' && r.userId !== myId) return false
      if (filterAssignee !== 'all' && filterAssignee !== 'mine' && r.userId !== filterAssignee) return false
      return true
    })
  }, [reminders, filterKind, filterAssignee, myId])

  const openTasks = React.useMemo(() => filtered.filter((r) => !r.completedAt), [filtered])

  const grouped = React.useMemo(() => {
    const map: Record<Bucket, Reminder[]> = {
      overdue: [], today: [], week: [], month: [], later: [], none: [],
    }
    for (const r of openTasks) map[bucketOf(r.dueAt)].push(r)
    for (const b of BUCKET_ORDER) {
      map[b].sort((a, c) => {
        const da = a.dueAt ? new Date(a.dueAt).getTime() : Number.MAX_SAFE_INTEGER
        const dc = c.dueAt ? new Date(c.dueAt).getTime() : Number.MAX_SAFE_INTEGER
        return da - dc
      })
    }
    return map
  }, [openTasks])

  const doneTasks = React.useMemo(
    () => filtered.filter((r) => r.completedAt).slice(0, 30),
    [filtered],
  )

  const overdueCount = grouped.overdue.length
  const todayCount = grouped.today.length

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

      <div className="px-8 py-6">
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
            <Chip active={filterAssignee === 'all'} onClick={() => setFilterAssignee('all')}>
              Todos
            </Chip>
            <Chip active={filterAssignee === 'mine'} onClick={() => setFilterAssignee('mine')}>
              Meus
            </Chip>
            {team.length > 0 && (
              <select
                value={filterAssignee === 'all' || filterAssignee === 'mine' ? '' : filterAssignee}
                onChange={(e) => setFilterAssignee(e.target.value || 'all')}
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
                grouped={grouped}
                doneTasks={doneTasks}
                companyOf={companyOf}
                onEdit={setEditing}
                onOpenClient={(id) => navigate(`/clients?open=${id}`)}
              />
            ) : (
              <KanbanView
                tasks={filtered}
                companyOf={companyOf}
                onEdit={setEditing}
                onOpenClient={(id) => navigate(`/clients?open=${id}`)}
              />
            )}
          </div>

          <PipelinePanel clients={clients} onConvert={(r) => setEditing(r)} />
        </div>
      </div>

      {editing !== undefined && (
        <TaskModal
          initial={editing}
          clients={clients}
          team={team}
          defaultAssignee={myId}
          onClose={() => setEditing(undefined)}
        />
      )}
    </>
  )
}

// ── Lista por prazo ───────────────────────────────────────────────────────────
function ListView({
  grouped,
  doneTasks,
  companyOf,
  onEdit,
  onOpenClient,
}: {
  grouped: Record<Bucket, Reminder[]>
  doneTasks: Reminder[]
  companyOf: (id?: string | null) => string | undefined
  onEdit: (r: Reminder) => void
  onOpenClient: (id: string) => void
}) {
  const hasAny = BUCKET_ORDER.some((b) => grouped[b].length > 0)
  return (
    <div className="space-y-5">
      {!hasAny && (
        <div className="rounded-2xl border border-line bg-card px-4 py-10 text-center text-sm text-foreground/45">
          Nenhuma tarefa aberta. Crie a primeira em “Nova tarefa”. 🎯
        </div>
      )}
      {BUCKET_ORDER.map((b) =>
        grouped[b].length === 0 ? null : (
          <section key={b}>
            <h3
              className={cn(
                'mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider',
                b === 'overdue' ? 'text-danger' : b === 'today' ? 'text-warning' : 'text-foreground/45',
              )}
            >
              {BUCKET_LABEL[b]}
              <span className="rounded-full bg-elevate/[0.06] px-1.5 py-0.5 text-[10px] text-foreground/50">
                {grouped[b].length}
              </span>
            </h3>
            <ul className="space-y-2">
              {grouped[b].map((r) => (
                <TaskRow
                  key={r.id}
                  r={r}
                  company={companyOf(r.clientId)}
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
          <ul className="divide-y divide-line">
            {doneTasks.map((r) => (
              <TaskRow
                key={r.id}
                r={r}
                company={companyOf(r.clientId)}
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
  onEdit,
  onOpenClient,
  done,
}: {
  r: Reminder
  company?: string
  onEdit: () => void
  onOpenClient: (id: string) => void
  done?: boolean
}) {
  const kind = KIND_META[r.kind ?? 'task']
  const prio = PRIORITY_META[r.priority ?? 'normal']
  return (
    <li className="flex items-start gap-3 rounded-xl border border-line bg-card px-3.5 py-2.5">
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
        <div className="flex items-center gap-2">
          <span className="inline-flex items-center gap-1 rounded bg-elevate/[0.05] px-1.5 py-0.5 text-[10px] text-foreground/55">
            {kind.icon}
            {kind.label}
          </span>
          <span className={cn('truncate text-sm', done ? 'text-foreground/40 line-through' : 'font-medium text-foreground')}>
            {r.title}
          </span>
          {r.priority === 'high' && !done && (
            <span className={cn('text-[10px] font-semibold', prio.cls)}>● Alta</span>
          )}
        </div>
        <div className="mt-0.5 flex flex-wrap items-center gap-2 text-[11px] text-foreground/45">
          {r.dueAt && (
            <span className="inline-flex items-center gap-1">
              <Clock className="h-3 w-3" />
              {formatDateShort(r.dueAt)}
            </span>
          )}
          {company && (
            <button
              onClick={() => r.clientId && onOpenClient(r.clientId)}
              className="inline-flex items-center gap-1 hover:text-accent"
            >
              <Building2 className="h-3 w-3" />
              {company}
            </button>
          )}
          <span className="inline-flex items-center gap-1">
            <Users2 className="h-3 w-3" />
            {STATUS_META[r.status ?? 'todo'].label}
          </span>
        </div>
        {r.notes && <p className="mt-1 line-clamp-2 text-[11px] text-foreground/50">{r.notes}</p>}
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

// ── Kanban por status ─────────────────────────────────────────────────────────
function KanbanView({
  tasks,
  companyOf,
  onEdit,
  onOpenClient,
}: {
  tasks: Reminder[]
  companyOf: (id?: string | null) => string | undefined
  onEdit: (r: Reminder) => void
  onOpenClient: (id: string) => void
}) {
  const byStatus = React.useMemo(() => {
    const map: Record<ReminderStatus, Reminder[]> = { todo: [], doing: [], waiting: [], done: [] }
    for (const r of tasks) {
      const st = r.completedAt ? 'done' : r.status ?? 'todo'
      map[st].push(r)
    }
    return map
  }, [tasks])

  const move = (r: Reminder, dir: -1 | 1) => {
    const cur = r.completedAt ? 'done' : r.status ?? 'todo'
    const idx = STATUS_ORDER.indexOf(cur)
    const next = STATUS_ORDER[idx + dir]
    if (!next) return
    if (next === 'done') ticketsService.completeReminder(r.id)
    else if (cur === 'done') ticketsService.patchReminder(r.id, { completed_at: null, status: next })
    else ticketsService.patchReminder(r.id, { status: next })
  }

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {STATUS_ORDER.map((st) => (
        <div key={st} className="rounded-xl border border-line bg-card">
          <header className="flex items-center justify-between border-b border-line px-3 py-2">
            <span className="text-xs font-semibold text-foreground/70">{STATUS_META[st].label}</span>
            <span className="rounded-full bg-elevate/[0.06] px-1.5 py-0.5 text-[10px] text-foreground/50">
              {byStatus[st].length}
            </span>
          </header>
          <ul className="space-y-2 p-2">
            {byStatus[st].length === 0 && (
              <li className="px-1 py-4 text-center text-[11px] text-foreground/30">—</li>
            )}
            {byStatus[st].map((r) => (
              <li key={r.id} className="rounded-lg border border-line bg-elevate/[0.02] p-2.5">
                <div className="flex items-start gap-1.5">
                  <span className="mt-0.5 text-foreground/45">{KIND_META[r.kind ?? 'task'].icon}</span>
                  <span className={cn('flex-1 text-xs', st === 'done' ? 'text-foreground/40 line-through' : 'text-foreground/85')}>
                    {r.title}
                  </span>
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[10px] text-foreground/40">
                  {r.dueAt && <span>{formatDateShort(r.dueAt)}</span>}
                  {companyOf(r.clientId) && (
                    <button
                      onClick={() => r.clientId && onOpenClient(r.clientId)}
                      className="hover:text-accent"
                    >
                      {companyOf(r.clientId)}
                    </button>
                  )}
                </div>
                <div className="mt-1.5 flex items-center justify-between">
                  <div className="flex items-center gap-1">
                    <IconBtn title="Mover ←" onClick={() => move(r, -1)} small>
                      ‹
                    </IconBtn>
                    <IconBtn title="Mover →" onClick={() => move(r, 1)} small>
                      ›
                    </IconBtn>
                  </div>
                  <div className="flex items-center gap-1">
                    <IconBtn title="Editar" onClick={() => onEdit(r)} small>
                      <Pencil className="h-3 w-3" />
                    </IconBtn>
                    <IconBtn title="Excluir" danger small onClick={() => ticketsService.deleteReminder(r.id)}>
                      <Trash2 className="h-3 w-3" />
                    </IconBtn>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
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
  onConvert,
}: {
  clients: ReturnType<typeof useClients>
  onConvert: (r: Reminder) => void
}) {
  const navigate = useNavigate()
  const alerts = React.useMemo(
    () => computeAlerts(clients).filter((a) => ACTIONABLE.has(a.kind)).slice(0, 12),
    [clients],
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
                      userId: '',
                      clientId: a.client.id,
                      title: a.title,
                      notes: a.subtitle,
                      dueAt: a.whenAt ?? null,
                      createdAt: '',
                      kind: 'pending',
                      status: 'todo',
                      priority: 'normal',
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
  defaultAssignee,
  onClose,
}: {
  initial: Reminder | null
  clients: ReturnType<typeof useClients>
  team: ReturnType<typeof useTeam>
  defaultAssignee?: string
  onClose: () => void
}) {
  const editing = Boolean(initial?.id)
  const [kind, setKind] = React.useState<ReminderKind>(initial?.kind ?? 'task')
  const [title, setTitle] = React.useState(initial?.title ?? '')
  const [clientId, setClientId] = React.useState(initial?.clientId ?? '')
  const [notes, setNotes] = React.useState(initial?.notes ?? '')
  const [due, setDue] = React.useState(toLocalInput(initial?.dueAt))
  const [assignee, setAssignee] = React.useState(initial?.userId || defaultAssignee || '')
  const [priority, setPriority] = React.useState<ReminderPriority>(initial?.priority ?? 'normal')
  const [status, setStatus] = React.useState<ReminderStatus>(initial?.status ?? 'todo')
  const [saving, setSaving] = React.useState(false)

  const save = async () => {
    if (!title.trim()) {
      toast.error('Dê um título para a tarefa')
      return
    }
    if (!assignee) {
      toast.error('Selecione um responsável')
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
          <Field label="Empresa (opcional)">
            <Select value={clientId} onChange={setClientId}>
              <option value="">— Nenhuma —</option>
              {clients.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.company || c.name}
                </option>
              ))}
            </Select>
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
          <Field label="Data e hora">
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
              {STATUS_ORDER.map((s) => (
                <option key={s} value={s}>
                  {STATUS_META[s].label}
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
