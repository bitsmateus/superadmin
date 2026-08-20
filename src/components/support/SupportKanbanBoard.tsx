import * as React from 'react'
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core'
import { Building2, Clock, ExternalLink, Pencil, Trash2, Users2 } from 'lucide-react'
import { ticketsService } from '@/services/tickets'
import { accessClientSystem, accessUrlFor, hasSupportEmail } from '@/lib/accessSystem'
import {
  KIND_META,
  PRIORITY_META,
  PRIORITY_ORDER,
  STATUS_META,
  dueChipCls,
  fmtDue,
} from '@/lib/supportMeta'
import { cn } from '@/lib/utils'
import type { Reminder, ReminderStatus } from '@/types/ticket'
import type { Client } from '@/types/client'

// ── Colunas do quadro ─────────────────────────────────────────────────────────
// As 3 etapas da metodologia to-do do time. O status `waiting` ("Aguardando
// técnico") não ganha coluna própria: ele mora em "Fazendo" com uma etiqueta,
// pra não sumir do quadro nem perder a informação.
type ColumnKey = 'todo' | 'doing' | 'done'

const COLUMNS: { key: ColumnKey; label: string; accent: string }[] = [
  { key: 'todo', label: 'A Fazer', accent: 'text-foreground/70' },
  { key: 'doing', label: 'Fazendo', accent: 'text-accent' },
  { key: 'done', label: 'Feito', accent: 'text-success' },
]

/** Quantas concluídas mostrar na coluna "Feito" (equivale à antiga seção
 *  "Concluídas recentemente" da visão em lista). */
const DONE_LIMIT = 30

function columnOf(r: Reminder): ColumnKey {
  if (r.completedAt || r.status === 'done') return 'done'
  if (r.status === 'doing' || r.status === 'waiting') return 'doing'
  return 'todo'
}

/** Persiste a mudança de coluna no backend (PATCH /api/reminders/:id). */
function moveTo(r: Reminder, target: ColumnKey): void {
  const current = columnOf(r)
  if (current === target) return
  if (target === 'done') {
    ticketsService.completeReminder(r.id)
    return
  }
  const nextStatus: ReminderStatus = target === 'doing' ? 'doing' : 'todo'
  if (current === 'done') {
    ticketsService.patchReminder(r.id, { completed_at: null, status: nextStatus })
  } else {
    ticketsService.patchReminder(r.id, { status: nextStatus })
  }
}

export interface SupportKanbanBoardProps {
  /** Tarefas já filtradas pela barra de filtros da página. */
  tasks: Reminder[]
  clientOf: (id?: string | null) => Client | undefined
  teamMap: Map<string, string>
  onEdit: (r: Reminder) => void
}

export function SupportKanbanBoard({
  tasks,
  clientOf,
  teamMap,
  onEdit,
}: SupportKanbanBoardProps) {
  const [dragging, setDragging] = React.useState<Reminder | null>(null)

  // distance:6 evita que um clique em "editar"/"excluir" vire um arrasto.
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }))

  const byColumn = React.useMemo(() => {
    const map: Record<ColumnKey, Reminder[]> = { todo: [], doing: [], done: [] }
    for (const r of tasks) map[columnOf(r)].push(r)

    const dueTime = (r: Reminder) =>
      r.dueAt ? new Date(r.dueAt).getTime() : Number.MAX_SAFE_INTEGER
    const prioRank = (r: Reminder) => PRIORITY_ORDER.indexOf(r.priority ?? 'normal')
    for (const key of ['todo', 'doing'] as ColumnKey[]) {
      map[key].sort((a, b) => prioRank(a) - prioRank(b) || dueTime(a) - dueTime(b))
    }
    // "Feito": mais recentes primeiro, limitado como a antiga lista de concluídas.
    const doneTime = (r: Reminder) => (r.completedAt ? new Date(r.completedAt).getTime() : 0)
    map.done.sort((a, b) => doneTime(b) - doneTime(a))
    return map
  }, [tasks])

  const doneHidden = Math.max(0, byColumn.done.length - DONE_LIMIT)

  const onDragStart = (e: DragStartEvent) => {
    setDragging((e.active.data.current?.reminder as Reminder | undefined) ?? null)
  }

  const onDragEnd = (e: DragEndEvent) => {
    setDragging(null)
    const reminder = e.active.data.current?.reminder as Reminder | undefined
    const target = e.over?.data.current?.column as ColumnKey | undefined
    if (reminder && target) moveTo(reminder, target)
  }

  return (
    <DndContext
      sensors={sensors}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onDragCancel={() => setDragging(null)}
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {COLUMNS.map((col) => (
          <Column
            key={col.key}
            column={col}
            count={byColumn[col.key].length}
            footer={
              col.key === 'done' && doneHidden > 0
                ? `+${doneHidden} concluída(s) mais antiga(s)`
                : undefined
            }
          >
            {(col.key === 'done' ? byColumn.done.slice(0, DONE_LIMIT) : byColumn[col.key]).map(
              (r) => (
                <KanbanCard
                  key={r.id}
                  r={r}
                  client={clientOf(r.clientId)}
                  assignee={teamMap.get(r.userId)}
                  onEdit={() => onEdit(r)}
                />
              ),
            )}
          </Column>
        ))}
      </div>

      {/* Cartão "fantasma" que segue o cursor durante o arrasto. */}
      <DragOverlay dropAnimation={null}>
        {dragging ? (
          <div className="w-[280px] rotate-2">
            <KanbanCard
              r={dragging}
              client={clientOf(dragging.clientId)}
              assignee={teamMap.get(dragging.userId)}
              onEdit={() => {}}
              overlay
            />
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  )
}

// ── Coluna ────────────────────────────────────────────────────────────────────
function Column({
  column,
  count,
  footer,
  children,
}: {
  column: { key: ColumnKey; label: string; accent: string }
  count: number
  footer?: string
  children: React.ReactNode
}) {
  const { setNodeRef, isOver } = useDroppable({
    id: `col-${column.key}`,
    data: { column: column.key },
  })

  return (
    <div
      ref={setNodeRef}
      className={cn(
        'flex flex-col rounded-xl border bg-card transition-colors',
        isOver ? 'border-accent/50 bg-accent/[0.04]' : 'border-line',
      )}
    >
      <header className="flex items-center justify-between border-b border-line px-3 py-2">
        <span className={cn('text-xs font-semibold uppercase tracking-wider', column.accent)}>
          {column.label}
        </span>
        <span className="rounded-full bg-elevate/[0.06] px-1.5 py-0.5 text-[10px] text-foreground/50">
          {count}
        </span>
      </header>

      <ul className="min-h-[120px] flex-1 space-y-2 p-2">
        {count === 0 ? (
          <li
            className={cn(
              'grid h-[88px] place-items-center rounded-lg border border-dashed text-[11px] transition-colors',
              isOver ? 'border-accent/50 text-accent/70' : 'border-line/70 text-foreground/25',
            )}
          >
            {isOver ? 'Solte aqui' : 'Sem cartões'}
          </li>
        ) : (
          children
        )}
      </ul>

      {footer && (
        <div className="border-t border-line px-3 py-1.5 text-[10px] text-foreground/35">
          {footer}
        </div>
      )}
    </div>
  )
}

// ── Cartão ────────────────────────────────────────────────────────────────────
function KanbanCard({
  r,
  client,
  assignee,
  onEdit,
  overlay,
}: {
  r: Reminder
  client?: Client
  assignee?: string
  onEdit: () => void
  /** Render dentro do DragOverlay: sem listeners e sem ficar semitransparente. */
  overlay?: boolean
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: r.id,
    data: { reminder: r },
    disabled: overlay,
  })

  const kind = KIND_META[r.kind ?? 'task']
  const prio = PRIORITY_META[r.priority ?? 'normal']
  const col = columnOf(r)
  const isDone = col === 'done'
  const company = client ? client.company || client.name : undefined

  // "Acessar sistema": copia o e-mail de suporte do cliente e abre o login.
  // Só faz sentido quando há cliente vinculado E algo pra usar (e-mail ou URL).
  const canAccess = Boolean(client) && (hasSupportEmail(client) || Boolean(accessUrlFor(client)))
  const accessTitle = !client
    ? 'Tarefa sem cliente vinculado'
    : hasSupportEmail(client)
      ? 'Acessar sistema — copia o e-mail de suporte e abre o login'
      : 'Cliente sem e-mail de suporte cadastrado — abre só o login do sistema'

  return (
    <li
      ref={setNodeRef}
      {...(overlay ? {} : listeners)}
      {...(overlay ? {} : attributes)}
      className={cn(
        'select-none rounded-lg border border-line p-2.5 shadow-sm',
        // O fantasma precisa de fundo opaco (bg-card) pra não deixar os cartões
        // de baixo aparecerem através dele — por isso os fundos são exclusivos.
        overlay
          ? 'cursor-grabbing bg-card shadow-xl ring-1 ring-accent/40'
          : 'cursor-grab bg-elevate/[0.02] active:cursor-grabbing',
        isDragging && 'opacity-30',
      )}
    >
      {/* Etiquetas: prioridade (mesmas cores da lista) + tipo */}
      <div className="mb-1.5 flex flex-wrap items-center gap-1.5">
        <span
          className={cn('rounded-full px-1.5 py-0.5 text-[10px] font-semibold ring-1', prio.chip)}
        >
          {prio.label}
        </span>
        <span className="inline-flex items-center gap-1 rounded bg-elevate/[0.05] px-1.5 py-0.5 text-[10px] text-foreground/55">
          {kind.icon}
          {kind.label}
        </span>
        {r.status === 'waiting' && !r.completedAt && (
          <span className="rounded bg-elevate/[0.05] px-1.5 py-0.5 text-[10px] text-foreground/45">
            {STATUS_META.waiting.label}
          </span>
        )}
      </div>

      {/* Empresa como texto simples + ação dedicada "Acessar sistema" */}
      {company && (
        <div className="mb-1.5 flex items-center gap-1.5">
          <span className="inline-flex min-w-0 items-center gap-1 text-[11px] font-semibold text-foreground/70">
            <Building2 className="h-3 w-3 shrink-0 text-foreground/40" />
            <span className="truncate">{company}</span>
          </span>
          <button
            type="button"
            title={accessTitle}
            disabled={!canAccess}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={() => client && void accessClientSystem(client)}
            className={cn(
              'ml-auto inline-flex shrink-0 items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-medium ring-1 transition-colors',
              canAccess
                ? 'bg-accent/10 text-accent ring-accent/20 hover:bg-accent/20'
                : 'cursor-not-allowed bg-elevate/[0.03] text-foreground/25 ring-line',
            )}
          >
            <ExternalLink className="h-3 w-3" />
            Acessar
          </button>
        </div>
      )}

      <p
        className={cn(
          'text-xs leading-snug',
          isDone ? 'text-foreground/40 line-through' : 'text-foreground/85',
        )}
      >
        {r.title}
      </p>

      <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[10px] text-foreground/45">
        {r.dueAt && (
          <span
            className={cn(
              'inline-flex items-center gap-1 rounded px-1 py-0.5 font-medium ring-1',
              dueChipCls(r.dueAt),
            )}
          >
            <Clock className="h-2.5 w-2.5" />
            Até {fmtDue(r.dueAt)}
          </span>
        )}
        <span className="inline-flex items-center gap-1">
          <Users2 className="h-2.5 w-2.5" />
          {assignee ?? '—'}
        </span>
      </div>

      {r.notes && <p className="mt-1.5 line-clamp-2 text-[10px] text-foreground/45">{r.notes}</p>}

      <div className="mt-2 flex items-center justify-between">
        {/* Fallback ao drag-and-drop (mobile / teclado): move de coluna. */}
        <div className="flex items-center gap-1">
          <MiniBtn
            title="Mover para a coluna anterior"
            disabled={col === 'todo'}
            onClick={() => moveTo(r, col === 'done' ? 'doing' : 'todo')}
          >
            &lsaquo;
          </MiniBtn>
          <MiniBtn
            title="Mover para a próxima coluna"
            disabled={col === 'done'}
            onClick={() => moveTo(r, col === 'todo' ? 'doing' : 'done')}
          >
            &rsaquo;
          </MiniBtn>
        </div>
        <div className="flex items-center gap-1">
          <MiniBtn title="Editar" onClick={onEdit}>
            <Pencil className="h-3 w-3" />
          </MiniBtn>
          <MiniBtn title="Excluir" danger onClick={() => ticketsService.deleteReminder(r.id)}>
            <Trash2 className="h-3 w-3" />
          </MiniBtn>
        </div>
      </div>
    </li>
  )
}

function MiniBtn({
  title,
  onClick,
  children,
  danger,
  disabled,
}: {
  title: string
  onClick: () => void
  children: React.ReactNode
  danger?: boolean
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      title={title}
      disabled={disabled}
      // Impede que o clique nos botões inicie o arrasto do cartão.
      onPointerDown={(e) => e.stopPropagation()}
      onClick={onClick}
      className={cn(
        'inline-flex h-6 w-6 items-center justify-center rounded-lg text-sm ring-1 ring-line transition-colors',
        disabled
          ? 'cursor-not-allowed text-foreground/15'
          : danger
            ? 'text-foreground/45 hover:bg-danger/10 hover:text-danger hover:ring-danger/30'
            : 'text-foreground/45 hover:bg-elevate/[0.06] hover:text-foreground/80',
      )}
    >
      {children}
    </button>
  )
}
