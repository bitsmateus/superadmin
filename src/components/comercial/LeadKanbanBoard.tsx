import * as React from 'react'
import { createPortal } from 'react-dom'
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
import { Archive, ArchiveRestore, Calendar, ChevronsLeftRight, MessageCircle, Settings2 } from 'lucide-react'
import { useLeadLabels } from '@/hooks/useLeadLabels'
import { leadBoardsService } from '@/services/leadBoards'
import { leadLabelsService } from '@/services/leadLabels'
import { LeadLabelCell, ManageLabelsModal } from '@/components/comercial/LeadLabelCell'
import { cn } from '@/lib/utils'
import { formatBRLCompact, parseBRLCents } from '@/lib/currency'
import type { LeadBoard, LeadRow } from '@/types/leadBoard'

type GroupField = 'status' | 'diaContato'

const GROUP_OPTIONS: { value: GroupField; label: string }[] = [
  { value: 'status', label: 'Status' },
  { value: 'diaContato', label: 'Dia de contato' },
]

const GROUP_STORAGE_KEY = 'comercial_kanban_group_by'
const COLLAPSED_STORAGE_KEY = 'comercial_kanban_collapsed'

/** Status que representa "concluído e guardado" — vira a última coluna do Kanban de Demandas,
 * recolhida por padrão. É só um valor de Status (sem mudança no banco). */
const ARCHIVE_STATUS = 'Arquivado'
const COLLAPSED_W = 44
const COLUMN_W = 256

type Column = { key: string; label: string; color: string; archive?: boolean }

function readCollapsed(): Record<string, boolean> {
  try {
    const raw = window.localStorage.getItem(COLLAPSED_STORAGE_KEY)
    const parsed = raw ? JSON.parse(raw) : {}
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

function fmtShortDay(iso: string): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' }).replace('.', '')
}

export interface LeadKanbanBoardProps {
  rows: LeadRow[]
  allBoards: LeadBoard[]
  onOpenLead: (id: string) => void
}

/** Visão alternativa em quadro — mesmos leads da lista, agrupados por Status ou Dia de
 * contato (à escolha) em vez de por quadro. Arrastar um card muda o campo agrupado. */
export function LeadKanbanBoard({ rows, allBoards, onOpenLead }: LeadKanbanBoardProps) {
  const [groupField, setGroupField] = React.useState<GroupField>(() => {
    try {
      return window.localStorage.getItem(GROUP_STORAGE_KEY) === 'diaContato' ? 'diaContato' : 'status'
    } catch {
      return 'status'
    }
  })
  React.useEffect(() => {
    try { window.localStorage.setItem(GROUP_STORAGE_KEY, groupField) } catch { /* ignore */ }
  }, [groupField])

  React.useEffect(() => { void leadLabelsService.ensureLoaded() }, [])
  // allBoards já vem filtrado pra UMA aba só (LeadBoardsView) — dá pra tirar a aba dali direto.
  const pageId = allBoards[0]?.page
  const labels = useLeadLabels(groupField, pageId)

  const [activeId, setActiveId] = React.useState<string | null>(null)
  const [manageOpen, setManageOpen] = React.useState(false)
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }))

  const withArchive = groupField === 'status'
  const columns = React.useMemo<Column[]>(() => {
    const noneLabel = groupField === 'status' ? 'Sem status' : 'Sem dia de contato'
    const cols: Column[] = [
      { key: '', label: noneLabel, color: '#9CA3AF' },
      ...labels
        .filter((l) => !(withArchive && l.name.trim().toLowerCase() === ARCHIVE_STATUS.toLowerCase()))
        .map((l) => ({ key: l.name, label: l.name, color: l.color })),
    ]
    if (withArchive) cols.push({ key: ARCHIVE_STATUS, label: ARCHIVE_STATUS, color: '#6B7280', archive: true })
    return cols
  }, [labels, groupField, withArchive])

  // Colunas recolhidas — guardado no navegador por aba+agrupamento, então sobrevive ao F5.
  // Sem escolha salva, só a coluna Arquivado nasce recolhida.
  const [collapsedMap, setCollapsedMap] = React.useState<Record<string, boolean>>(readCollapsed)
  const collapseKey = (col: Column) => `${pageId ?? ''}:${groupField}:${col.key}`
  const isCollapsed = (col: Column) => collapsedMap[collapseKey(col)] ?? col.archive === true
  const toggleCollapsed = (col: Column) => {
    setCollapsedMap((prev) => {
      const next = { ...prev, [collapseKey(col)]: !(prev[collapseKey(col)] ?? col.archive === true) }
      try { window.localStorage.setItem(COLLAPSED_STORAGE_KEY, JSON.stringify(next)) } catch { /* ignore */ }
      return next
    })
  }

  const rowsByColumn = React.useMemo(() => {
    const map = new Map<string, LeadRow[]>()
    for (const col of columns) map.set(col.key, [])
    for (const row of rows) {
      const value = row[groupField]
      const key = map.has(value) ? value : ''
      map.get(key)!.push(row)
    }
    return map
  }, [rows, columns, groupField])

  // Ao desarquivar, volta pra "Feito" se a aba tiver esse status; senão fica sem status.
  const doneLabel = labels.find((l) => l.name.trim().toLowerCase() === 'feito')?.name

  const activeRow = activeId ? rows.find((r) => r.id === activeId) ?? null : null

  // Colunas são w-64 (256px) com gap-3 (12px) entre elas — dá pra calcular a largura total
  // sem medir o DOM, e usar isso pra dimensionar a barra de rolagem flutuante abaixo.
  const scrollRef = React.useRef<HTMLDivElement>(null)
  const barRef = React.useRef<HTMLDivElement>(null)
  const contentWidth = columns.reduce((sum, c) => sum + (isCollapsed(c) ? COLLAPSED_W : COLUMN_W), 0)
    + Math.max(0, columns.length - 1) * 12

  const onDragStart = (e: DragStartEvent) => setActiveId(String(e.active.id))
  const onDragEnd = (e: DragEndEvent) => {
    setActiveId(null)
    const rowId = String(e.active.id)
    const columnKey = e.over?.data.current?.column as string | undefined
    if (columnKey === undefined) return
    const row = rows.find((r) => r.id === rowId)
    if (row) moveToColumn(row, columnKey)
  }

  const moveToColumn = (row: LeadRow, columnKey: string) => {
    const rowId = row.id
    if (row[groupField] === columnKey) return

    // Arrastar pra uma coluna de Status move o lead pro quadro com o mesmo nome — igual à
    // lista, onde mudar o Status já leva o lead pro quadro correspondente. `allBoards` aqui já
    // vem filtrado pra UMA página só (ver comentário acima), então não corre o risco de casar
    // com um quadro de mesmo nome em outra página.
    if (groupField === 'status') {
      const target = allBoards.find(
        (b) => b.id !== row.boardId && b.name.trim().toLowerCase() === columnKey.trim().toLowerCase(),
      )
      leadBoardsService.updateRow(rowId, target ? { status: columnKey, boardId: target.id } : { status: columnKey })
    } else {
      leadBoardsService.updateRow(rowId, { [groupField]: columnKey })
    }
  }

  return (
    <div>
      <div className="mb-3 flex items-center gap-2">
        <span className="text-xs font-medium text-foreground/50">Agrupar por</span>
        <div className="inline-flex overflow-hidden rounded-lg border border-line">
          {GROUP_OPTIONS.map((o) => (
            <button
              key={o.value}
              type="button"
              onClick={() => setGroupField(o.value)}
              className={cn(
                'px-3 py-1.5 text-xs font-medium transition-colors',
                groupField === o.value ? 'bg-accent/10 text-accent' : 'text-foreground/50 hover:bg-elevate/[0.04]',
              )}
            >
              {o.label}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={() => setManageOpen(true)}
          className="inline-flex items-center gap-1.5 rounded-lg border border-line px-3 py-1.5 text-xs font-medium text-foreground/50 hover:bg-elevate/[0.04]"
        >
          <Settings2 className="h-3.5 w-3.5" />
          Colunas
        </button>
      </div>

      <DndContext sensors={sensors} onDragStart={onDragStart} onDragEnd={onDragEnd}>
        <div
          ref={scrollRef}
          className="no-scrollbar flex items-start gap-3 overflow-x-auto pb-4"
          style={{ WebkitOverflowScrolling: 'touch' }}
          onScroll={(e) => {
            if (barRef.current && barRef.current.scrollLeft !== e.currentTarget.scrollLeft) {
              barRef.current.scrollLeft = e.currentTarget.scrollLeft
            }
          }}
        >
          {columns.map((col) => (
            <KanbanColumn
              key={col.key || '__none__'}
              col={col}
              rows={rowsByColumn.get(col.key) ?? []}
              onOpenLead={onOpenLead}
              collapsed={isCollapsed(col)}
              onToggle={() => toggleCollapsed(col)}
              showTag
              tagPageId={pageId}
              onArchive={withArchive ? (row) => moveToColumn(row, col.archive ? (doneLabel ?? '') : ARCHIVE_STATUS) : undefined}
            />
          ))}
        </div>
        {createPortal(
          <DragOverlay>
            {activeRow && <KanbanCard row={activeRow} overlay onOpenLead={() => {}} showTag tagPageId={pageId} />}
          </DragOverlay>,
          document.body,
        )}
      </DndContext>

      {/* Barra de rolagem horizontal flutuante, fixa na tela — igual à da Lista, pra não
          precisar descer até o fim de colunas cheias de card só pra arrastar de lado. No celular,
          o toque direto nas colunas já rola sozinho (overflow-x-auto acima) — essa barra fica só
          como atalho visual pro mouse, sincronizada nos dois sentidos. */}
      <div className="pointer-events-none fixed inset-x-0 bottom-3 z-30 px-4 sm:px-6 lg:px-8 lg:pl-[236px]">
        <div
          ref={barRef}
          className="pointer-events-auto overflow-x-auto overflow-y-hidden rounded-full border border-line bg-card shadow-lg"
          style={{ height: 14 }}
          onScroll={(e) => {
            if (scrollRef.current && scrollRef.current.scrollLeft !== e.currentTarget.scrollLeft) {
              scrollRef.current.scrollLeft = e.currentTarget.scrollLeft
            }
          }}
        >
          <div style={{ width: contentWidth, height: 1 }} />
        </div>
      </div>

      <ManageLabelsModal field={groupField} pageId={pageId} open={manageOpen} onClose={() => setManageOpen(false)} />
    </div>
  )
}

function KanbanColumn({
  col,
  rows,
  onOpenLead,
  collapsed,
  onToggle,
  showTag,
  tagPageId,
  onArchive,
}: {
  col: Column
  rows: LeadRow[]
  onOpenLead: (id: string) => void
  collapsed: boolean
  onToggle: () => void
  showTag: boolean
  tagPageId?: string
  onArchive?: (row: LeadRow) => void
}) {
  const { setNodeRef, isOver } = useDroppable({ id: `col-${col.key}`, data: { column: col.key } })
  const totalMrr = React.useMemo(() => rows.reduce((sum, r) => sum + parseBRLCents(r.valorMrr), 0), [rows])
  const totalImplementacao = React.useMemo(
    () => rows.reduce((sum, r) => sum + parseBRLCents(r.valorImplementacao), 0),
    [rows],
  )
  // Recolhida: faixa estreita com o nome na vertical e a contagem. Continua sendo alvo de
  // arrastar (dá pra soltar um card direto no Arquivado sem abrir a coluna).
  if (collapsed) {
    return (
      <div
        ref={setNodeRef}
        onClick={onToggle}
        title={`Expandir "${col.label}"`}
        className={cn(
          'flex shrink-0 cursor-pointer flex-col items-center gap-2 overflow-hidden rounded-xl py-2 text-white transition-opacity hover:opacity-90',
          isOver && 'ring-2 ring-accent/40',
        )}
        style={{ backgroundColor: col.color, width: COLLAPSED_W, minHeight: 140 }}
      >
        <ChevronsLeftRight className="h-3.5 w-3.5 shrink-0 rotate-90 opacity-80" />
        <span className="rounded-full bg-white/25 px-1.5 py-0.5 text-[11px] font-semibold">{rows.length}</span>
        <span className="mt-1 text-sm font-semibold [text-orientation:mixed] [writing-mode:vertical-rl]">{col.label}</span>
      </div>
    )
  }

  return (
    <div
      ref={setNodeRef}
      className={cn(
        'w-64 shrink-0 overflow-hidden rounded-xl bg-elevate/[0.03] transition-colors',
        isOver && 'bg-accent/[0.06] ring-2 ring-accent/40',
      )}
    >
      <div
        className="flex items-center gap-1.5 px-3 py-2 text-sm font-semibold text-white"
        style={{ backgroundColor: col.color }}
      >
        <span className="truncate">{col.label}</span>
        {(totalMrr > 0 || totalImplementacao > 0) && (
          <span className="shrink-0 text-[11px] font-medium text-white/85" title="Valor MRR / Valor de Implementação">
            {formatBRLCompact(totalMrr)} / {formatBRLCompact(totalImplementacao)}
          </span>
        )}
        <span className="ml-auto shrink-0 rounded-full bg-white/25 px-1.5 py-0.5 text-[11px]">{rows.length}</span>
        <button
          type="button"
          onClick={onToggle}
          title="Recolher coluna"
          className="grid h-5 w-5 shrink-0 place-items-center rounded hover:bg-white/20"
        >
          <ChevronsLeftRight className="h-3.5 w-3.5" />
        </button>
      </div>
      <div className="min-h-[40px] space-y-2 p-2">
        {rows.map((row) => (
          <KanbanCard
            key={row.id}
            row={row}
            onOpenLead={onOpenLead}
            showTag={showTag}
            tagPageId={tagPageId}
            archived={col.archive}
            onArchive={onArchive}
          />
        ))}
        {rows.length === 0 && <p className="px-1 py-3 text-center text-[11px] text-foreground/40">Nenhum lead</p>}
      </div>
    </div>
  )
}

function KanbanCard({
  row,
  overlay,
  onOpenLead,
  showTag,
  tagPageId,
  archived,
  onArchive,
}: {
  row: LeadRow
  overlay?: boolean
  onOpenLead: (id: string) => void
  /** Mostra a etiqueta (Tipo) no card — pra marcar urgência. */
  showTag?: boolean
  tagPageId?: string
  archived?: boolean
  onArchive?: (row: LeadRow) => void
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: row.id,
    data: { row },
    disabled: overlay,
  })
  const style = transform && !overlay
    ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)` }
    : undefined

  return (
    <div
      ref={overlay ? undefined : setNodeRef}
      style={style}
      {...(overlay ? {} : listeners)}
      {...(overlay ? {} : attributes)}
      onClick={() => { if (!overlay) onOpenLead(row.id) }}
      className={cn(
        'cursor-grab select-none rounded-lg border border-line bg-card p-2.5 shadow-sm transition-shadow hover:shadow-md active:cursor-grabbing',
        !overlay && isDragging && 'opacity-40',
        overlay && 'w-64 rotate-2 shadow-xl',
      )}
    >
      <div className="flex items-start gap-1.5">
        <div className="min-w-0 flex-1 break-words text-sm font-medium text-foreground">{row.nome || 'Sem nome'}</div>
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onOpenLead(row.id) }}
          title="Atualizações"
          className="relative grid h-6 w-6 shrink-0 place-items-center rounded hover:bg-elevate/[0.08]"
        >
          <MessageCircle className={cn('h-3.5 w-3.5', row.notesCount > 0 ? 'fill-accent text-accent' : 'text-foreground/30')} />
          {row.notesCount > 0 && (
            <span className="absolute -bottom-0.5 -right-0.5 grid h-3.5 min-w-[0.875rem] place-items-center rounded-full bg-accent px-0.5 text-[9px] font-semibold text-white ring-2 ring-card">
              {row.notesCount > 9 ? '9+' : row.notesCount}
            </span>
          )}
        </button>
        {onArchive && !overlay && (
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onArchive(row) }}
            title={archived ? 'Desarquivar' : 'Arquivar'}
            className="grid h-6 w-6 shrink-0 place-items-center rounded text-foreground/30 hover:bg-elevate/[0.08] hover:text-foreground/70"
          >
            {archived ? <ArchiveRestore className="h-3.5 w-3.5" /> : <Archive className="h-3.5 w-3.5" />}
          </button>
        )}
      </div>
      {showTag && (
        <div
          className="mt-1.5"
          onClick={(e) => e.stopPropagation()}
          onPointerDown={(e) => e.stopPropagation()}
        >
          {overlay ? (
            row.tipo && <span className="inline-block rounded px-2 py-0.5 text-[11px] font-semibold text-foreground/70">{row.tipo}</span>
          ) : (
            <div className="w-fit max-w-full overflow-hidden rounded">
              <LeadLabelCell
                field="tipo"
                value={row.tipo}
                pageId={tagPageId}
                onChange={(next) => leadBoardsService.updateRow(row.id, { tipo: next })}
                placeholder="+ Etiqueta"
                className="min-h-0 w-auto max-w-full px-2 py-0.5 text-[11px] font-semibold"
              />
            </div>
          )}
        </div>
      )}
      {row.lastNotePreview && (
        <p className="mt-1.5 line-clamp-2 text-[11px] leading-snug text-foreground/45">
          {row.lastNotePreview}
        </p>
      )}
      {row.retornar && (
        <div className="mt-1.5 inline-flex items-center gap-1 rounded bg-elevate/[0.05] px-1.5 py-0.5 text-[11px] text-foreground/50">
          <Calendar className="h-3 w-3" />
          {fmtShortDay(row.retornar)} (Retornar)
        </div>
      )}
    </div>
  )
}
