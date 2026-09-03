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
  Trash2,
} from 'lucide-react'
import { ticketsService } from '@/services/tickets'
import { supportColumnsService } from '@/services/supportColumns'
import { useSupportColumns } from '@/hooks/useSupportColumns'
import { accessClientSystem, accessUrlFor, hasSupportEmail } from '@/lib/accessSystem'
import { KIND_META, PRIORITY_META, PRIORITY_ORDER, dueChipCls, fmtDue } from '@/lib/supportMeta'
import { cn, initials } from '@/lib/utils'
import { COLUMN_COLORS, type SupportColumn } from '@/types/supportColumn'
import type { Reminder } from '@/types/ticket'
import type { Client } from '@/types/client'

/** Quantas concluídas mostrar numa coluna de conclusão (equivale à antiga seção
 *  "Concluídas recentemente" da visão em lista). */
export const DONE_LIMIT = 30

/** Em qual coluna o cartão está hoje. Status desconhecido (coluna apagada, dado
 *  antigo) cai na primeira coluna, pra nenhuma tarefa sumir do quadro. Exportada — a visão em
 *  Lista (ListView, SupportWorkspacePage.tsx) agrupa pelas mesmas colunas do Kanban. */
export function columnKeyOf(r: Reminder, columns: SupportColumn[]): string {
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
          // Em toque não existe "hover" — sem isso os 3 botões abaixo (mover/excluir coluna)
          // ficavam permanentemente invisíveis e inalcançáveis no celular. Abaixo de lg fica
          // sempre visível; a partir de lg volta a aparecer só no hover, igual antes.
          <div className="flex shrink-0 items-center gap-0.5 opacity-100 transition-opacity lg:opacity-0 lg:group-hover/head:opacity-100 lg:focus-within:opacity-100">
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

      {/* Altura limitada a ~5 cartões — coluna com mais do que isso rola por dentro dela mesma,
          em vez de esticar a página inteira (era preciso descer quase até o fim da tela pra ver
          o fim de uma coluna longa, tipo "Feito"). */}
      <ul className="min-h-[120px] max-h-[640px] flex-1 space-y-2 overflow-y-auto p-2 pr-1.5">
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
        'grid h-8 w-8 place-items-center rounded transition-colors lg:h-5 lg:w-5',
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
      // Clicar no cartão (fora dos botões, que já param a propagação) abre a mesma tela de
      // "Editar" — o distanceConstraint dos sensores (6px) garante que só um clique de verdade,
      // sem arrastar, chega aqui; um drag de verdade nunca aciona isso.
      onClick={overlay ? undefined : onEdit}
      className={cn(
        'select-none rounded-xl border border-line/70 bg-card p-3 shadow-sm transition-all duration-150',
        // O fantasma precisa de fundo opaco (bg-card) pra não deixar os cartões
        // de baixo aparecerem através dele — por isso os fundos são exclusivos.
        overlay
          ? 'cursor-grabbing shadow-xl ring-1 ring-accent/40'
          : 'cursor-grab hover:-translate-y-0.5 hover:border-accent/30 hover:shadow-md active:cursor-grabbing',
        isDragging && 'opacity-30',
      )}
    >
      {/* Prioridade (ponto + texto, mais discreto que um selo cheio) + tipo */}
      <div className="mb-2 flex items-center justify-between gap-1.5">
        <span className="inline-flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide">
          <span className={cn('h-1.5 w-1.5 shrink-0 rounded-full', prio.dot)} />
          <span className={prio.header}>{prio.label}</span>
        </span>
        <span className="inline-flex items-center gap-1 rounded-full bg-elevate/[0.06] px-2 py-0.5 text-[10px] font-medium text-foreground/50">
          {kind.icon}
          {kind.label}
        </span>
      </div>

      {/* Título — texto principal do cartão */}
      <p
        className={cn(
          'text-sm font-semibold leading-snug',
          isDone ? 'text-foreground/40 line-through' : 'text-foreground',
        )}
      >
        {r.title}
      </p>

      {/* Empresa, como linha secundária + atalho pra "Acessar sistema" */}
      {company && (
        <div className="mt-1 flex items-center gap-1.5">
          <Building2 className="h-3 w-3 shrink-0 text-foreground/35" />
          <span className="min-w-0 flex-1 truncate text-[11px] text-foreground/55">{company}</span>
          <button
            type="button"
            title={accessTitle}
            disabled={!canAccess}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => { e.stopPropagation(); if (client) void accessClientSystem(client) }}
            className={cn(
              'grid h-5 w-5 shrink-0 place-items-center rounded transition-colors',
              canAccess
                ? 'text-accent hover:bg-accent/10'
                : 'cursor-not-allowed text-foreground/20',
            )}
          >
            <ExternalLink className="h-3 w-3" />
          </button>
        </div>
      )}

      {r.notes && <p className="mt-2 line-clamp-2 text-[11px] text-foreground/45">{r.notes}</p>}

      <div className="mt-3 flex items-center justify-between gap-2 border-t border-line/60 pt-2">
        <div className="flex min-w-0 flex-wrap items-center gap-1.5">
          {r.dueAt && (
            <span
              className={cn(
                'inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-medium ring-1',
                dueChipCls(r.dueAt),
              )}
            >
              <Clock className="h-2.5 w-2.5" />
              {fmtDue(r.dueAt)}
            </span>
          )}
          {assignee && (
            <span
              title={assignee}
              className="grid h-4 w-4 shrink-0 place-items-center rounded-full bg-elevate/[0.08] text-[8px] font-semibold text-foreground/60 ring-1 ring-line"
            >
              {initials(assignee)}
            </span>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-0.5">
          {/* Fallback ao drag-and-drop (mobile / toque): move de coluna. */}
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
      // Impede que o clique nos botões inicie o arrasto do cartão E que o clique "suba" pro
      // cartão (que agora abre "Editar" sozinho ao ser clicado).
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => { e.stopPropagation(); onClick() }}
      className={cn(
        'inline-flex h-8 w-8 items-center justify-center rounded-lg text-sm ring-1 ring-line transition-colors lg:h-6 lg:w-6',
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
