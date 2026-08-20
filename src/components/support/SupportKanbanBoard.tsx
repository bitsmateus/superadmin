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
import {
  Building2,
  Check,
  ChevronLeft,
  ChevronRight,
  Clock,
  ExternalLink,
  Pencil,
  Plus,
  Trash2,
  Users2,
  X,
} from 'lucide-react'
import { ticketsService } from '@/services/tickets'
import { supportColumnsService } from '@/services/supportColumns'
import { useSupportColumns } from '@/hooks/useSupportColumns'
import { accessClientSystem, accessUrlFor, hasSupportEmail } from '@/lib/accessSystem'
import { KIND_META, PRIORITY_META, PRIORITY_ORDER, dueChipCls, fmtDue } from '@/lib/supportMeta'
import { cn } from '@/lib/utils'
import { COLUMN_COLORS, type SupportColumn } from '@/types/supportColumn'
import type { Reminder } from '@/types/ticket'
import type { Client } from '@/types/client'

/** Quantas concluídas mostrar numa coluna de conclusão (equivale à antiga seção
 *  "Concluídas recentemente" da visão em lista). */
const DONE_LIMIT = 30

/** Em qual coluna o cartão está hoje. Status desconhecido (coluna apagada, dado
 *  antigo) cai na primeira coluna, pra nenhuma tarefa sumir do quadro. */
function columnKeyOf(r: Reminder, columns: SupportColumn[]): string {
  if (r.completedAt) return (columns.find((c) => c.isDone) ?? columns[columns.length - 1])?.key ?? ''
  const hit = columns.find((c) => c.key === r.status)
  return (hit ?? columns[0])?.key ?? ''
}

/** Persiste a mudança de coluna no backend (PATCH /api/reminders/:id). */
function moveTo(r: Reminder, target: SupportColumn, columns: SupportColumn[]): void {
  if (columnKeyOf(r, columns) === target.key) return
  if (target.isDone) {
    ticketsService.patchReminder(r.id, {
      completed_at: r.completedAt ?? new Date().toISOString(),
      status: target.key,
    })
    return
  }
  ticketsService.patchReminder(r.id, {
    status: target.key,
    // Sair de uma coluna de conclusão reabre a tarefa.
    ...(r.completedAt ? { completed_at: null } : {}),
  })
}

export interface SupportKanbanBoardProps {
  /** Tarefas já filtradas pela barra de filtros da página. */
  tasks: Reminder[]
  clientOf: (id?: string | null) => Client | undefined
  teamMap: Map<string, string>
  onEdit: (r: Reminder) => void
}

export function SupportKanbanBoard({ tasks, clientOf, teamMap, onEdit }: SupportKanbanBoardProps) {
  const columns = useSupportColumns()
  const [dragging, setDragging] = React.useState<Reminder | null>(null)

  // distance:6 evita que um clique em "editar"/"excluir" vire um arrasto.
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }))

  const byColumn = React.useMemo(() => {
    const map = new Map<string, Reminder[]>()
    for (const c of columns) map.set(c.key, [])
    for (const r of tasks) map.get(columnKeyOf(r, columns))?.push(r)

    const dueTime = (r: Reminder) => (r.dueAt ? new Date(r.dueAt).getTime() : Number.MAX_SAFE_INTEGER)
    const prioRank = (r: Reminder) => PRIORITY_ORDER.indexOf(r.priority ?? 'normal')
    const doneTime = (r: Reminder) => (r.completedAt ? new Date(r.completedAt).getTime() : 0)
    for (const c of columns) {
      const list = map.get(c.key)!
      if (c.isDone) list.sort((a, b) => doneTime(b) - doneTime(a))
      else list.sort((a, b) => prioRank(a) - prioRank(b) || dueTime(a) - dueTime(b))
    }
    return map
  }, [tasks, columns])

  const onDragEnd = (e: DragEndEvent) => {
    setDragging(null)
    const reminder = e.active.data.current?.reminder as Reminder | undefined
    const target = e.over?.data.current?.column as SupportColumn | undefined
    if (reminder && target) moveTo(reminder, target, columns)
  }

  return (
    <DndContext
      sensors={sensors}
      onDragStart={(e: DragStartEvent) =>
        setDragging((e.active.data.current?.reminder as Reminder | undefined) ?? null)
      }
      onDragEnd={onDragEnd}
      onDragCancel={() => setDragging(null)}
    >
      {/* Rolagem horizontal: o número de colunas é livre. */}
      <div className="flex items-start gap-3 overflow-x-auto pb-2">
        {columns.map((col, i) => {
          const all = byColumn.get(col.key) ?? []
          const shown = col.isDone ? all.slice(0, DONE_LIMIT) : all
          return (
            <Column
              key={col.id}
              column={col}
              count={all.length}
              isFirst={i === 0}
              isLast={i === columns.length - 1}
              canDelete={columns.length > 1}
              footer={
                all.length > shown.length
                  ? `+${all.length - shown.length} concluída(s) mais antiga(s)`
                  : undefined
              }
            >
              {shown.map((r) => (
                <KanbanCard
                  key={r.id}
                  r={r}
                  client={clientOf(r.clientId)}
                  assignee={teamMap.get(r.userId)}
                  isDone={col.isDone}
                  onEdit={() => onEdit(r)}
                  onMove={(dir) => {
                    const next = columns[columns.indexOf(col) + dir]
                    if (next) moveTo(r, next, columns)
                  }}
                  canMoveLeft={i > 0}
                  canMoveRight={i < columns.length - 1}
                />
              ))}
            </Column>
          )
        })}

        <AddColumnTile />
      </div>

      {/* Cartão "fantasma" que segue o cursor durante o arrasto. */}
      <DragOverlay dropAnimation={null}>
        {dragging ? (
          <div className="w-[280px] rotate-2">
            <KanbanCard
              r={dragging}
              client={clientOf(dragging.clientId)}
              assignee={teamMap.get(dragging.userId)}
              isDone={Boolean(dragging.completedAt)}
              onEdit={() => {}}
              onMove={() => {}}
              canMoveLeft={false}
              canMoveRight={false}
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
  isFirst,
  isLast,
  canDelete,
  footer,
  children,
}: {
  column: SupportColumn
  count: number
  isFirst: boolean
  isLast: boolean
  canDelete: boolean
  footer?: string
  children: React.ReactNode
}) {
  const { setNodeRef, isOver } = useDroppable({
    id: `col-${column.key}`,
    data: { column },
  })

  const [renaming, setRenaming] = React.useState(false)
  const [draft, setDraft] = React.useState(column.name)
  const [palette, setPalette] = React.useState(false)

  const commit = () => {
    setRenaming(false)
    const next = draft.trim()
    if (next && next !== column.name) supportColumnsService.updateColumn(column.id, { name: next })
    else setDraft(column.name)
  }

  const remove = () => {
    const msg =
      count > 0
        ? `Excluir a coluna "${column.name}"? As ${count} tarefa(s) dela vão para a primeira coluna do quadro.`
        : `Excluir a coluna "${column.name}"?`
    if (window.confirm(msg)) void supportColumnsService.deleteColumn(column.id)
  }

  return (
    <div
      ref={setNodeRef}
      className={cn(
        'flex w-[300px] shrink-0 flex-col rounded-xl border bg-card transition-colors',
        isOver ? 'border-accent/50 bg-accent/[0.04]' : 'border-line',
      )}
    >
      <header className="group/head relative flex items-center gap-1.5 border-b border-line px-3 py-2">
        <button
          type="button"
          title="Cor da coluna"
          onClick={() => setPalette((p) => !p)}
          className="h-2.5 w-2.5 shrink-0 rounded-full ring-1 ring-elevate/20"
          style={{ background: column.color }}
        />

        {renaming ? (
          <input
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commit()
              if (e.key === 'Escape') {
                setDraft(column.name)
                setRenaming(false)
              }
            }}
            className="min-w-0 flex-1 rounded border border-accent/40 bg-elevate/[0.06] px-1.5 py-0.5 text-xs font-semibold uppercase tracking-wider text-foreground outline-none"
          />
        ) : (
          <button
            type="button"
            title="Clique para renomear"
            onClick={() => {
              setDraft(column.name)
              setRenaming(true)
            }}
            className="min-w-0 flex-1 truncate text-left text-xs font-semibold uppercase tracking-wider text-foreground/70 hover:text-foreground"
          >
            {column.name}
          </button>
        )}

        <span className="shrink-0 rounded-full bg-elevate/[0.06] px-1.5 py-0.5 text-[10px] text-foreground/50">
          {count}
        </span>

        {!renaming && (
          <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover/head:opacity-100 focus-within:opacity-100">
            <HeadBtn
              title="Mover coluna para a esquerda"
              disabled={isFirst}
              onClick={() => void supportColumnsService.moveColumn(column.id, -1)}
            >
              <ChevronLeft className="h-3 w-3" />
            </HeadBtn>
            <HeadBtn
              title="Mover coluna para a direita"
              disabled={isLast}
              onClick={() => void supportColumnsService.moveColumn(column.id, 1)}
            >
              <ChevronRight className="h-3 w-3" />
            </HeadBtn>
            <HeadBtn
              title={canDelete ? 'Excluir coluna' : 'O quadro precisa de pelo menos uma coluna'}
              disabled={!canDelete}
              danger
              onClick={remove}
            >
              <Trash2 className="h-3 w-3" />
            </HeadBtn>
          </div>
        )}

        {palette && (
          <div className="absolute left-2 top-full z-20 mt-1 flex gap-1 rounded-lg border border-line bg-card p-1.5 shadow-lg">
            {COLUMN_COLORS.map((c) => (
              <button
                key={c}
                type="button"
                title={c}
                onClick={() => {
                  supportColumnsService.updateColumn(column.id, { color: c })
                  setPalette(false)
                }}
                className="grid h-4 w-4 place-items-center rounded-full ring-1 ring-elevate/20"
                style={{ background: c }}
              >
                {c === column.color && <Check className="h-2.5 w-2.5 text-white" />}
              </button>
            ))}
          </div>
        )}
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
        <div className="border-t border-line px-3 py-1.5 text-[10px] text-foreground/35">{footer}</div>
      )}
    </div>
  )
}

/** Tile no fim do quadro pra criar uma coluna nova. */
function AddColumnTile() {
  const [open, setOpen] = React.useState(false)
  const [name, setName] = React.useState('')

  const create = () => {
    const trimmed = name.trim()
    if (trimmed) void supportColumnsService.createColumn(trimmed)
    setName('')
    setOpen(false)
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex w-[220px] shrink-0 items-center justify-center gap-1.5 rounded-xl border border-dashed border-line py-3 text-xs font-medium text-foreground/45 transition-colors hover:border-accent/40 hover:bg-accent/[0.04] hover:text-accent"
      >
        <Plus className="h-3.5 w-3.5" />
        Adicionar coluna
      </button>
    )
  }

  return (
    <div className="w-[240px] shrink-0 rounded-xl border border-line bg-card p-2">
      <input
        autoFocus
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Nome da coluna…"
        onKeyDown={(e) => {
          if (e.key === 'Enter') create()
          if (e.key === 'Escape') {
            setName('')
            setOpen(false)
          }
        }}
        className="h-8 w-full rounded-lg border border-line bg-elevate/[0.04] px-2 text-xs text-foreground outline-none focus:border-accent/40"
      />
      <div className="mt-1.5 flex items-center gap-1">
        <button
          type="button"
          onClick={create}
          disabled={!name.trim()}
          className="inline-flex flex-1 items-center justify-center gap-1 rounded-lg bg-accent/10 px-2 py-1 text-[11px] font-medium text-accent ring-1 ring-accent/20 transition-colors hover:bg-accent/20 disabled:cursor-not-allowed disabled:opacity-40"
        >
          <Check className="h-3 w-3" />
          Criar
        </button>
        <button
          type="button"
          title="Cancelar"
          onClick={() => {
            setName('')
            setOpen(false)
          }}
          className="grid h-6 w-6 place-items-center rounded-lg text-foreground/45 ring-1 ring-line hover:text-foreground/80"
        >
          <X className="h-3 w-3" />
        </button>
      </div>
    </div>
  )
}

function HeadBtn({
  title,
  onClick,
  children,
  disabled,
  danger,
}: {
  title: string
  onClick: () => void
  children: React.ReactNode
  disabled?: boolean
  danger?: boolean
}) {
  return (
    <button
      type="button"
      title={title}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'grid h-5 w-5 place-items-center rounded transition-colors',
        disabled
          ? 'cursor-not-allowed text-foreground/15'
          : danger
            ? 'text-foreground/40 hover:bg-danger/10 hover:text-danger'
            : 'text-foreground/40 hover:bg-elevate/[0.06] hover:text-foreground/80',
      )}
    >
      {children}
    </button>
  )
}

// ── Cartão ────────────────────────────────────────────────────────────────────
function KanbanCard({
  r,
  client,
  assignee,
  isDone,
  onEdit,
  onMove,
  canMoveLeft,
  canMoveRight,
  overlay,
}: {
  r: Reminder
  client?: Client
  assignee?: string
  isDone: boolean
  onEdit: () => void
  onMove: (dir: -1 | 1) => void
  canMoveLeft: boolean
  canMoveRight: boolean
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
        <span className={cn('rounded-full px-1.5 py-0.5 text-[10px] font-semibold ring-1', prio.chip)}>
          {prio.label}
        </span>
        <span className="inline-flex items-center gap-1 rounded bg-elevate/[0.05] px-1.5 py-0.5 text-[10px] text-foreground/55">
          {kind.icon}
          {kind.label}
        </span>
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
        {/* Fallback ao drag-and-drop (mobile / toque): move de coluna. */}
        <div className="flex items-center gap-1">
          <MiniBtn
            title="Mover para a coluna anterior"
            disabled={!canMoveLeft}
            onClick={() => onMove(-1)}
          >
            <ChevronLeft className="h-3 w-3" />
          </MiniBtn>
          <MiniBtn
            title="Mover para a próxima coluna"
            disabled={!canMoveRight}
            onClick={() => onMove(1)}
          >
            <ChevronRight className="h-3 w-3" />
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
