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
import { Calendar, Copy, MessageCircle } from 'lucide-react'
import { useLeadLabels } from '@/hooks/useLeadLabels'
import { leadBoardsService } from '@/services/leadBoards'
import { leadLabelsService } from '@/services/leadLabels'
import { cn } from '@/lib/utils'
import { formatBRLCompact, parseBRLCents } from '@/lib/currency'
import type { LeadBoard, LeadRow } from '@/types/leadBoard'

type GroupField = 'status' | 'diaContato'

const GROUP_OPTIONS: { value: GroupField; label: string }[] = [
  { value: 'status', label: 'Status' },
  { value: 'diaContato', label: 'Dia de contato' },
]

const GROUP_STORAGE_KEY = 'comercial_kanban_group_by'

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
  const labels = useLeadLabels(groupField)

  const [activeId, setActiveId] = React.useState<string | null>(null)
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }))

  const columns = React.useMemo(() => {
    const noneLabel = groupField === 'status' ? 'Sem status' : 'Sem dia de contato'
    return [
      { key: '', label: noneLabel, color: '#9CA3AF' },
      ...labels.map((l) => ({ key: l.name, label: l.name, color: l.color })),
    ]
  }, [labels, groupField])

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

  const activeRow = activeId ? rows.find((r) => r.id === activeId) ?? null : null

  const duplicate = (row: LeadRow) => {
    leadBoardsService.createRow(row.boardId, {
      nome: row.nome, empresa: row.empresa, telefone: row.telefone, tipo: row.tipo,
      diaContato: row.diaContato, ligacao: row.ligacao, status: row.status, sdr: row.sdr, retornar: row.retornar,
      responsavel: row.responsavel, numero: row.numero, dorCliente: row.dorCliente,
      numeroAtendentes: row.numeroAtendentes, valorMrr: row.valorMrr, valorImplementacao: row.valorImplementacao,
    })
  }

  const onDragStart = (e: DragStartEvent) => setActiveId(String(e.active.id))
  const onDragEnd = (e: DragEndEvent) => {
    setActiveId(null)
    const rowId = String(e.active.id)
    const columnKey = e.over?.data.current?.column as string | undefined
    if (columnKey === undefined) return
    const row = rows.find((r) => r.id === rowId)
    if (!row || row[groupField] === columnKey) return

    // Arrastar pra uma coluna de Status move o lead pro quadro com o mesmo nome — igual à
    // lista, onde mudar o Status já leva o lead pro quadro correspondente.
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
        <span className="text-xs font-medium text-gray-500">Agrupar por</span>
        <div className="inline-flex overflow-hidden rounded-lg border border-gray-200">
          {GROUP_OPTIONS.map((o) => (
            <button
              key={o.value}
              type="button"
              onClick={() => setGroupField(o.value)}
              className={cn(
                'px-3 py-1.5 text-xs font-medium transition-colors',
                groupField === o.value ? 'bg-accent/10 text-accent' : 'text-gray-500 hover:bg-gray-50',
              )}
            >
              {o.label}
            </button>
          ))}
        </div>
      </div>

      <DndContext sensors={sensors} onDragStart={onDragStart} onDragEnd={onDragEnd}>
        <div className="flex items-start gap-3 overflow-x-auto pb-4">
          {columns.map((col) => (
            <KanbanColumn
              key={col.key || '__none__'}
              col={col}
              rows={rowsByColumn.get(col.key) ?? []}
              onOpenLead={onOpenLead}
              onDuplicate={duplicate}
            />
          ))}
        </div>
        {createPortal(
          <DragOverlay>
            {activeRow && <KanbanCard row={activeRow} overlay onOpenLead={() => {}} onDuplicate={() => {}} />}
          </DragOverlay>,
          document.body,
        )}
      </DndContext>
    </div>
  )
}

function KanbanColumn({
  col,
  rows,
  onOpenLead,
  onDuplicate,
}: {
  col: { key: string; label: string; color: string }
  rows: LeadRow[]
  onOpenLead: (id: string) => void
  onDuplicate: (row: LeadRow) => void
}) {
  const { setNodeRef, isOver } = useDroppable({ id: `col-${col.key}`, data: { column: col.key } })
  const totalMrr = React.useMemo(() => rows.reduce((sum, r) => sum + parseBRLCents(r.valorMrr), 0), [rows])
  return (
    <div
      ref={setNodeRef}
      className={cn(
        'w-64 shrink-0 overflow-hidden rounded-xl bg-gray-50 transition-colors',
        isOver && 'bg-accent/[0.06] ring-2 ring-accent/40',
      )}
    >
      <div
        className="flex items-center gap-1.5 px-3 py-2 text-sm font-semibold text-white"
        style={{ backgroundColor: col.color }}
      >
        <span className="truncate">{col.label}</span>
        {totalMrr > 0 && (
          <span className="shrink-0 text-[11px] font-medium text-white/85">{formatBRLCompact(totalMrr)}</span>
        )}
        <span className="ml-auto shrink-0 rounded-full bg-white/25 px-1.5 py-0.5 text-[11px]">{rows.length}</span>
      </div>
      <div className="min-h-[40px] space-y-2 p-2">
        {rows.map((row) => (
          <KanbanCard key={row.id} row={row} onOpenLead={onOpenLead} onDuplicate={onDuplicate} />
        ))}
        {rows.length === 0 && <p className="px-1 py-3 text-center text-[11px] text-gray-400">Nenhum lead</p>}
      </div>
    </div>
  )
}

function KanbanCard({
  row,
  overlay,
  onOpenLead,
  onDuplicate,
}: {
  row: LeadRow
  overlay?: boolean
  onOpenLead: (id: string) => void
  onDuplicate: (row: LeadRow) => void
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
        'cursor-grab select-none rounded-lg border border-gray-200 bg-white p-2.5 shadow-sm transition-shadow hover:shadow-md active:cursor-grabbing',
        !overlay && isDragging && 'opacity-40',
        overlay && 'w-64 rotate-2 shadow-xl',
      )}
    >
      <div className="truncate text-sm font-medium text-gray-800">{row.nome || 'Sem nome'}</div>
      {row.retornar && (
        <div className="mt-1.5 inline-flex items-center gap-1 rounded bg-elevate/[0.05] px-1.5 py-0.5 text-[11px] text-gray-500">
          <Calendar className="h-3 w-3" />
          {fmtShortDay(row.retornar)} (Retornar)
        </div>
      )}
      <div className="mt-2 flex items-center gap-1 text-gray-400">
        {row.notesCount > 0 && (
          <span className="inline-flex items-center gap-1 text-[11px]">
            <MessageCircle className="h-3.5 w-3.5" />
            {row.notesCount}
          </span>
        )}
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onDuplicate(row) }}
          title="Duplicar"
          className="ml-auto grid h-6 w-6 place-items-center rounded hover:bg-gray-100 hover:text-gray-700"
        >
          <Copy className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  )
}
