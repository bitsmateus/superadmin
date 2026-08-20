import * as React from 'react'
import { toast } from 'sonner'
import {
  ArrowRightLeft,
  ArrowUpDown,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Copy,
  Download,
  Filter,
  GripVertical,
  KanbanSquare,
  LayoutDashboard,
  ListTodo,
  Loader2,
  MessageCircle,
  Pencil,
  Plus,
  Rows3,
  Search,
  Trash2,
  Upload,
  UserRound,
  X,
} from 'lucide-react'
import { TopBar } from '@/components/layout/TopBar'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Modal } from '@/components/ui/Modal'
import { EmptyState } from '@/components/ui/EmptyState'
import { LeadDetailModal } from '@/components/comercial/LeadDetailModal'
import { LeadKanbanBoard } from '@/components/comercial/LeadKanbanBoard'
import { LeadDashboardView } from '@/components/comercial/LeadDashboardView'
import { LeadImportModal } from '@/components/comercial/LeadImportModal'
import { LeadTrashModal } from '@/components/comercial/LeadTrashModal'
import { LeadLabelCell } from '@/components/comercial/LeadLabelCell'
import { EditableField } from '@/components/comercial/EditableField'
import { CurrencyField } from '@/components/comercial/CurrencyField'
import { RetornarField } from '@/components/comercial/RetornarField'
import { LeadFiltersModal, matchesLeadFilters, type FilterRule } from '@/components/comercial/LeadFiltersModal'
import { useOutsideClose } from '@/hooks/useOutsideClose'
import { cn, formatDateTimeShort } from '@/lib/utils'
import { formatBRLCents, parseBRLCents } from '@/lib/currency'
import { useAllLeadRows, useLeadBoards, useLeadBoardsBooted, useLeadRows } from '@/hooks/useLeadBoards'
import { useLeadLabels } from '@/hooks/useLeadLabels'
import { leadBoardsService } from '@/services/leadBoards'
import { leadLabelsService } from '@/services/leadLabels'
import { ABA_LABELS, ABA_ORDER } from '@/types/leadBoard'
import type { LeadBoard, LeadBoardPage, LeadLabelField, LeadRow, LeadRowField } from '@/types/leadBoard'

export { ABA_LABELS, ABA_ORDER }

interface ColumnDef {
  key: LeadRowField | 'createdAt'
  label: string
  type?: 'text' | 'date' | 'datetime-local'
  width: number
  readOnly?: boolean
  tag?: boolean
  currency?: boolean
  align?: 'center'
  /** Pendência obrigatória pro SDR preencher — vazio fica marcado em vermelho. */
  required?: boolean
}

const CHECKBOX_COL_WIDTH = 58

const COLUMNS: ColumnDef[] = [
  { key: 'nome', label: 'Nome', width: 180 },
  { key: 'empresa', label: 'Empresa', width: 170, align: 'center' },
  { key: 'telefone', label: 'Telefone', width: 140, required: true },
  { key: 'tipo', label: 'Tipo', width: 108, tag: true },
  { key: 'diaContato', label: 'Dia de contato', width: 140, tag: true, required: true },
  { key: 'ligacao', label: 'Ligação', width: 62, tag: true },
  { key: 'status', label: 'Status', width: 170, tag: true, required: true },
  { key: 'retornar', label: 'Retornar', type: 'datetime-local', width: 190 },
  { key: 'sdr', label: 'SDR', width: 100, tag: true },
  { key: 'dorCliente', label: 'Dor do cliente', width: 200, align: 'center' },
  { key: 'numeroAtendentes', label: 'Número de atendentes', width: 170, align: 'center' },
  { key: 'valorMrr', label: 'Valor MRR', width: 140, currency: true, align: 'center' },
  { key: 'valorImplementacao', label: 'Valor de Implementação', width: 170, currency: true, align: 'center' },
  { key: 'createdAt', label: 'Log de criação', width: 160, readOnly: true, align: 'center' },
]

const GRID_BORDER = 'border-r border-gray-200'
const MIN_COL_WIDTH = 80


function columnWidthsStorageKey(page: LeadBoardPage) {
  return `leadColumnWidths:${page}`
}

function loadColumnWidths(page: LeadBoardPage): Record<string, number> {
  try {
    const raw = window.localStorage.getItem(columnWidthsStorageKey(page))
    return raw ? JSON.parse(raw) : {}
  } catch {
    return {}
  }
}

function matchesSearch(row: LeadRow, term: string): boolean {
  if (!term) return true
  const haystack = `${row.nome} ${row.empresa} ${row.telefone} ${row.status} ${row.responsavel}`.toLowerCase()
  return haystack.includes(term.toLowerCase())
}

function ToolbarButton({
  icon,
  children,
  onClick,
  className,
  title,
}: {
  icon?: React.ReactNode
  children?: React.ReactNode
  onClick?: () => void
  className?: string
  title?: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className={cn(
        'inline-flex h-9 items-center gap-1.5 rounded-md px-3 text-sm font-medium text-gray-500',
        'transition-colors hover:bg-gray-100 hover:text-gray-800',
        className,
      )}
    >
      {icon}
      {children}
    </button>
  )
}

function SdrFilterButton({ value, onChange }: { value: string | null; onChange: (v: string | null) => void }) {
  const labels = useLeadLabels('sdr')
  const [open, setOpen] = React.useState(false)
  const ref = React.useRef<HTMLDivElement>(null)
  useOutsideClose(ref, open, () => setOpen(false))

  React.useEffect(() => { void leadLabelsService.ensureLoaded() }, [])

  const current = labels.find((l) => l.name === value)

  return (
    <div ref={ref} className="relative">
      <ToolbarButton
        icon={<UserRound className="h-3.5 w-3.5" style={current ? { color: current.color } : undefined} />}
        onClick={() => setOpen((o) => !o)}
        className={value ? 'text-accent' : undefined}
      >
        {value ? `SDR: ${value}` : 'SDR'}
      </ToolbarButton>
      {open && (
        <div className="absolute left-0 top-full z-20 mt-1 w-48 rounded-lg border border-gray-200 bg-white p-1.5 shadow-xl">
          <button
            type="button"
            onClick={() => { onChange(null); setOpen(false) }}
            className={cn(
              'flex w-full items-center rounded-md px-2 py-1.5 text-left text-xs',
              !value ? 'bg-accent/10 font-medium text-accent' : 'text-gray-600 hover:bg-gray-50',
            )}
          >
            Todos
          </button>
          {labels.length === 0 && (
            <p className="px-2 py-1.5 text-xs text-gray-400">Nenhum SDR cadastrado.</p>
          )}
          {labels.map((l) => (
            <button
              key={l.id}
              type="button"
              onClick={() => { onChange(l.name); setOpen(false) }}
              className={cn(
                'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs',
                l.name === value ? 'bg-accent/10 font-medium text-accent' : 'text-gray-600 hover:bg-gray-50',
              )}
            >
              <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: l.color }} />
              {l.name}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function csvEscape(value: string): string {
  const s = value ?? ''
  return /[",;\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

function exportLeadsCsv(rows: LeadRow[]) {
  const cols: { label: string; get: (r: LeadRow) => string }[] = [
    ...COLUMNS.filter((c) => !c.readOnly).map((c) => ({
      label: c.label,
      get: (r: LeadRow) => r[c.key as LeadRowField] ?? '',
    })),
    { label: 'Log de criação', get: (r: LeadRow) => formatDateTimeShort(r.createdAt) },
  ]
  const lines = [
    cols.map((c) => csvEscape(c.label)).join(';'),
    ...rows.map((r) => cols.map((c) => csvEscape(c.get(r))).join(';')),
  ]
  const csv = '﻿' + lines.join('\r\n')
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `leads-${new Date().toISOString().slice(0, 10)}.csv`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

function BulkActionButton({
  icon,
  label,
  onClick,
  danger,
}: {
  icon: React.ReactNode
  label: string
  onClick: () => void
  danger?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex flex-col items-center gap-0.5 rounded-lg px-2.5 py-1 text-[10px] font-medium transition-colors',
        danger ? 'text-gray-500 hover:bg-danger/10 hover:text-danger' : 'text-gray-500 hover:bg-gray-100 hover:text-gray-800',
      )}
    >
      {icon}
      {label}
    </button>
  )
}

function MoveSubmenu({ allBoards, onMove }: { allBoards: LeadBoard[]; onMove: (boardId: string) => void }) {
  const [aba, setAba] = React.useState<LeadBoardPage | null>(null)

  if (!aba) {
    return (
      <>
        {ABA_ORDER.map((p) => (
          <button
            key={p}
            type="button"
            onClick={() => setAba(p)}
            className="flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-xs text-gray-600 hover:bg-gray-50"
          >
            {ABA_LABELS[p]}
            <ChevronRight className="h-3.5 w-3.5 text-gray-300" />
          </button>
        ))}
      </>
    )
  }

  const boardsForAba = allBoards.filter((b) => b.page === aba).sort((a, b) => a.position - b.position)
  return (
    <>
      <button
        type="button"
        onClick={() => setAba(null)}
        className="mb-1 flex items-center gap-1 rounded-md px-2 py-1 text-[11px] text-gray-400 hover:bg-gray-50 hover:text-gray-600"
      >
        <ChevronLeft className="h-3 w-3" /> {ABA_LABELS[aba]}
      </button>
      {boardsForAba.length === 0 ? (
        <p className="px-2 py-1.5 text-xs text-gray-400">Nenhum quadro nessa aba ainda.</p>
      ) : (
        boardsForAba.map((b) => (
          <button
            key={b.id}
            type="button"
            onClick={() => onMove(b.id)}
            className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs text-gray-600 hover:bg-gray-50"
          >
            <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: b.color }} />
            <span className="truncate">{b.name}</span>
          </button>
        ))
      )}
    </>
  )
}

const BULK_EDIT_FIELDS: { key: LeadLabelField; label: string }[] = [
  { key: 'tipo', label: 'Tipo' },
  { key: 'diaContato', label: 'Dia de contato' },
  { key: 'status', label: 'Status' },
  { key: 'sdr', label: 'SDR' },
]

function BulkEditSubmenu({ onApply }: { onApply: (field: LeadLabelField, value: string) => void }) {
  const [field, setField] = React.useState<LeadLabelField | null>(null)
  const labels = useLeadLabels(field ?? 'status')

  if (!field) {
    return (
      <>
        {BULK_EDIT_FIELDS.map((f) => (
          <button
            key={f.key}
            type="button"
            onClick={() => setField(f.key)}
            className="flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-xs text-gray-600 hover:bg-gray-50"
          >
            {f.label}
            <ChevronRight className="h-3.5 w-3.5 text-gray-300" />
          </button>
        ))}
      </>
    )
  }

  const title = BULK_EDIT_FIELDS.find((f) => f.key === field)?.label ?? ''
  return (
    <>
      <button
        type="button"
        onClick={() => setField(null)}
        className="mb-1 flex items-center gap-1 rounded-md px-2 py-1 text-[11px] text-gray-400 hover:bg-gray-50 hover:text-gray-600"
      >
        <ChevronLeft className="h-3 w-3" /> {title}
      </button>
      {labels.length === 0 ? (
        <p className="px-2 py-1.5 text-xs text-gray-400">Nenhuma etiqueta cadastrada.</p>
      ) : (
        labels.map((l) => (
          <button
            key={l.id}
            type="button"
            onClick={() => onApply(field, l.name)}
            className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs text-gray-600 hover:bg-gray-50"
          >
            <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: l.color }} />
            <span className="truncate">{l.name}</span>
          </button>
        ))
      )}
    </>
  )
}

function BulkActionBar({
  selectedIds,
  allRows,
  allBoards,
  onClear,
}: {
  selectedIds: Set<string>
  allRows: LeadRow[]
  allBoards: LeadBoard[]
  onClear: () => void
}) {
  const [moveOpen, setMoveOpen] = React.useState(false)
  const moveRef = React.useRef<HTMLDivElement>(null)
  useOutsideClose(moveRef, moveOpen, () => setMoveOpen(false))
  const [editOpen, setEditOpen] = React.useState(false)
  const editRef = React.useRef<HTMLDivElement>(null)
  useOutsideClose(editRef, editOpen, () => setEditOpen(false))

  if (selectedIds.size === 0) return null

  const selectedRows = allRows.filter((r) => selectedIds.has(r.id))

  const duplicate = () => {
    for (const r of selectedRows) {
      leadBoardsService.createRow(r.boardId, {
        nome: r.nome, empresa: r.empresa, telefone: r.telefone, tipo: r.tipo,
        diaContato: r.diaContato, ligacao: r.ligacao, status: r.status, sdr: r.sdr, retornar: r.retornar,
        responsavel: r.responsavel, numero: r.numero, dorCliente: r.dorCliente,
        numeroAtendentes: r.numeroAtendentes, valorMrr: r.valorMrr,
        valorImplementacao: r.valorImplementacao,
      })
    }
    onClear()
  }

  const bulkDelete = () => {
    if (!window.confirm(`Excluir ${selectedRows.length} lead(s) selecionado(s)?`)) return
    for (const r of selectedRows) void leadBoardsService.deleteRow(r.id)
    onClear()
  }

  const moveTo = (boardId: string) => {
    for (const r of selectedRows) leadBoardsService.updateRow(r.id, { boardId })
    setMoveOpen(false)
    onClear()
  }

  const applyBulkEdit = (field: LeadLabelField, value: string) => {
    for (const r of selectedRows) leadBoardsService.updateRow(r.id, { [field]: value })
    setEditOpen(false)
    onClear()
  }

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-16 z-40 flex justify-center px-4">
      <div className="pointer-events-auto flex items-center gap-1 rounded-full border border-gray-200 bg-white px-2 py-1.5 shadow-xl">
        <span className="mr-1 grid h-6 w-6 shrink-0 place-items-center rounded-full bg-accent text-xs font-semibold text-white">
          {selectedRows.length}
        </span>
        <span className="mr-1.5 whitespace-nowrap text-xs font-medium text-gray-600">
          {selectedRows.length === 1 ? 'Nome selecionado' : 'Nomes selecionados'}
        </span>
        <div className="mx-1 h-6 w-px bg-gray-200" />
        <BulkActionButton icon={<Copy className="h-4 w-4" />} label="Duplicar" onClick={duplicate} />
        <BulkActionButton icon={<Download className="h-4 w-4" />} label="Exportar" onClick={() => exportLeadsCsv(selectedRows)} />
        <div className="relative" ref={editRef}>
          <BulkActionButton icon={<Pencil className="h-4 w-4" />} label="Editar" onClick={() => setEditOpen((o) => !o)} />
          {editOpen && (
            <div className="absolute bottom-full left-1/2 mb-2 w-56 -translate-x-1/2 rounded-lg border border-gray-200 bg-white p-1.5 shadow-xl">
              <BulkEditSubmenu onApply={applyBulkEdit} />
            </div>
          )}
        </div>
        <div className="relative" ref={moveRef}>
          <BulkActionButton icon={<ArrowRightLeft className="h-4 w-4" />} label="Mover" onClick={() => setMoveOpen((o) => !o)} />
          {moveOpen && (
            <div className="absolute bottom-full left-1/2 mb-2 w-56 -translate-x-1/2 rounded-lg border border-gray-200 bg-white p-1.5 shadow-xl">
              <MoveSubmenu allBoards={allBoards} onMove={moveTo} />
            </div>
          )}
        </div>
        <BulkActionButton icon={<Trash2 className="h-4 w-4" />} label="Excluir" onClick={bulkDelete} danger />
        <div className="mx-1 h-6 w-px bg-gray-200" />
        <button
          type="button"
          onClick={onClear}
          title="Limpar seleção"
          className="grid h-7 w-7 shrink-0 place-items-center rounded-full text-gray-400 hover:bg-gray-100 hover:text-gray-700"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  )
}

function BoardNameEditor({ board }: { board: LeadBoard }) {
  const [value, setValue] = React.useState(board.name)
  React.useEffect(() => setValue(board.name), [board.name])
  return (
    <input
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onBlur={() => {
        const trimmed = value.trim()
        if (trimmed && trimmed !== board.name) leadBoardsService.updateBoard(board.id, { name: trimmed })
        else setValue(board.name)
      }}
      onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
      className="min-w-0 flex-1 truncate bg-transparent text-sm font-semibold uppercase tracking-wide outline-none focus:underline"
      style={{ color: board.color }}
    />
  )
}

interface BoardGroupProps {
  board: LeadBoard
  allBoards: LeadBoard[]
  search: string
  sdrFilter: string | null
  filterRules: FilterRule[]
  sortDesc: boolean
  focusRowId: string | null
  onFocused: () => void
  onCreateRow: (boardId: string) => void
  onOpenLead: (rowId: string) => void
  registerScrollEl: (boardId: string, el: HTMLDivElement | null) => void
  selectedIds: Set<string>
  onToggleRow: (id: string) => void
  onToggleAll: (ids: string[], select: boolean) => void
  draggingIds: string[] | null
  isDragOver: boolean
  onRowDragStart: (ids: string[]) => void
  onRowDragEnd: () => void
  onBoardDragOver: (boardId: string) => void
  onBoardDragLeave: () => void
  onBoardDrop: (boardId: string) => void
  columnWidths: Record<string, number>
  onResizeColumn: (key: string, width: number) => void
}

function BoardGroup({
  board, allBoards, search, sdrFilter, filterRules, sortDesc, focusRowId, onFocused, onCreateRow, onOpenLead, registerScrollEl,
  selectedIds, onToggleRow, onToggleAll,
  draggingIds, isDragOver, onRowDragStart, onRowDragEnd, onBoardDragOver, onBoardDragLeave, onBoardDrop,
  columnWidths, onResizeColumn,
}: BoardGroupProps) {
  const [open, setOpen] = React.useState(true)
  const tableWidth = CHECKBOX_COL_WIDTH
    + COLUMNS.reduce((sum, c) => sum + (columnWidths[c.key] ?? c.width), 0)

  const startResize = React.useCallback((e: React.MouseEvent, key: string, startWidth: number) => {
    e.preventDefault()
    e.stopPropagation()
    const startX = e.clientX
    const onMove = (ev: MouseEvent) => {
      onResizeColumn(key, Math.max(MIN_COL_WIDTH, startWidth + (ev.clientX - startX)))
    }
    const onUp = () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }, [onResizeColumn])
  const allRows = useLeadRows(board.id)
  const rows = React.useMemo(() => {
    const filtered = allRows.filter((r) =>
      matchesSearch(r, search) && (!sdrFilter || r.sdr === sdrFilter) && matchesLeadFilters(r, filterRules),
    )
    return [...filtered].sort((a, b) =>
      sortDesc ? b.createdAt.localeCompare(a.createdAt) : a.createdAt.localeCompare(b.createdAt),
    )
  }, [allRows, search, sdrFilter, filterRules, sortDesc])
  const allSelected = rows.length > 0 && rows.every((r) => selectedIds.has(r.id))
  const totalMrr = React.useMemo(() => rows.reduce((sum, r) => sum + parseBRLCents(r.valorMrr), 0), [rows])
  const totalImplementacao = React.useMemo(
    () => rows.reduce((sum, r) => sum + parseBRLCents(r.valorImplementacao), 0),
    [rows],
  )

  // Tipo, Dia de contato, Status, Ligação, SDR e Retornar propagam pra toda a seleção
  // quando editados numa linha que já está marcada — igual ao Monday.
  const applyFieldChange = (row: LeadRow, patch: Partial<LeadRow>) => {
    if (selectedIds.has(row.id) && selectedIds.size > 1) {
      for (const id of selectedIds) leadBoardsService.updateRow(id, patch)
    } else {
      leadBoardsService.updateRow(row.id, patch)
    }
  }

  const startDrag = (e: React.DragEvent, id: string, label: string) => {
    // Arrastar uma linha que já está selecionada leva a seleção inteira junto.
    const ids = selectedIds.has(id) && selectedIds.size > 1 ? Array.from(selectedIds) : [id]
    e.dataTransfer.setData('text/plain', id)
    e.dataTransfer.effectAllowed = 'move'
    const ghost = document.createElement('div')
    ghost.textContent = ids.length > 1 ? `${ids.length} leads selecionados` : (label || 'Lead sem nome')
    ghost.style.cssText =
      'position:fixed;top:-1000px;left:-1000px;padding:6px 12px;background:#4F8EF7;color:#fff;' +
      'font-size:12px;font-weight:600;border-radius:8px;box-shadow:0 6px 16px rgba(0,0,0,.25);' +
      'white-space:nowrap;font-family:inherit;'
    document.body.appendChild(ghost)
    e.dataTransfer.setDragImage(ghost, 14, 14)
    window.setTimeout(() => { document.body.removeChild(ghost) }, 0)
    onRowDragStart(ids)
  }

  return (
    <div
      className={cn(
        'mb-5 overflow-hidden rounded-2xl bg-white shadow-sm transition-all duration-150 hover:shadow-md',
        isDragOver && 'bg-accent/[0.03] shadow-lg ring-2 ring-accent/50',
      )}
      onDragOver={(e) => { e.preventDefault(); onBoardDragOver(board.id) }}
      onDragLeave={onBoardDragLeave}
      onDrop={(e) => { e.preventDefault(); onBoardDrop(board.id) }}
    >
      <div className="flex items-center gap-2 border-b border-gray-200 bg-white px-3 py-2">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="grid h-5 w-5 shrink-0 place-items-center rounded text-gray-400 transition-colors hover:bg-black/5 hover:text-gray-700"
        >
          <ChevronDown className={cn('h-3.5 w-3.5 transition-transform', open ? '' : '-rotate-90')} />
        </button>
        <span className="h-2 w-2 shrink-0 rounded-full ring-4" style={{ backgroundColor: board.color, boxShadow: `0 0 0 3px ${board.color}1f` }} />
        <BoardNameEditor board={board} />
        <span className="rounded-full bg-black/5 px-1.5 py-0.5 text-[11px] font-medium text-gray-500">{rows.length}</span>
        <input
          type="color"
          value={board.color}
          onChange={(e) => leadBoardsService.updateBoard(board.id, { color: e.target.value })}
          title="Cor do quadro"
          className="ml-auto h-5 w-5 shrink-0 cursor-pointer rounded border-0 bg-transparent p-0"
        />
        <button
          type="button"
          onClick={() => {
            if (window.confirm(`Excluir o quadro "${board.name}" e todos os leads dentro dele?`)) {
              void leadBoardsService.deleteBoard(board.id)
            }
          }}
          title="Excluir quadro"
          className="grid h-5 w-5 shrink-0 place-items-center rounded text-gray-400 transition-colors hover:bg-danger/10 hover:text-danger"
        >
          <Trash2 className="h-3 w-3" />
        </button>
      </div>

      {open && (
        <div
          ref={(el) => registerScrollEl(board.id, el)}
          className="overflow-x-hidden"
          style={{ borderLeft: `4px solid ${board.color}` }}
        >
          <table className="border-collapse table-fixed" style={{ width: tableWidth }}>
            <thead>
              <tr className="border-b border-gray-200 bg-white text-left text-xs font-semibold text-[#323338]">
                <th className={cn('px-2.5 py-2', GRID_BORDER)} style={{ width: CHECKBOX_COL_WIDTH }}>
                  <input
                    type="checkbox"
                    checked={allSelected}
                    onChange={() => onToggleAll(rows.map((r) => r.id), !allSelected)}
                    className="h-3.5 w-3.5 rounded border-gray-300"
                  />
                </th>
                {COLUMNS.map((col) => {
                  const width = columnWidths[col.key] ?? col.width
                  return (
                    <th
                      key={col.key}
                      className={cn('relative truncate px-2.5 py-2 text-center font-semibold', GRID_BORDER)}
                      style={{ width }}
                    >
                      {col.label}
                      {col.required && <span className="text-red-400" title="Obrigatório"> *</span>}
                      <span
                        onMouseDown={(e) => startResize(e, col.key, width)}
                        title="Redimensionar coluna"
                        className="absolute right-0 top-0 h-full w-2 cursor-col-resize select-none hover:bg-accent/30 active:bg-accent/40"
                      />
                    </th>
                  )
                })}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const selected = selectedIds.has(row.id)
                return (
                <tr
                  key={row.id}
                  draggable
                  onDragStart={(e) => startDrag(e, row.id, row.nome)}
                  onDragEnd={onRowDragEnd}
                  className={cn(
                    'group border-b border-gray-200 transition-colors',
                    draggingIds?.includes(row.id) ? 'opacity-40' : '',
                    selected ? 'bg-accent/10 hover:bg-accent/15' : 'hover:bg-accent/[0.04]',
                  )}
                >
                  <td className={cn('px-1.5 py-1.5 align-middle', GRID_BORDER)}>
                    <div className="flex items-center gap-0.5">
                      <span
                        draggable
                        onDragStart={(e) => startDrag(e, row.id, row.nome)}
                        onDragEnd={onRowDragEnd}
                        title="Arrastar para outro quadro"
                        className="grid h-5 w-4 shrink-0 cursor-grab place-items-center text-gray-300 hover:text-gray-500 active:cursor-grabbing"
                      >
                        <GripVertical className="h-3.5 w-3.5" />
                      </span>
                      <input
                        type="checkbox"
                        checked={selected}
                        onChange={() => onToggleRow(row.id)}
                        className="h-3.5 w-3.5 rounded border-gray-300"
                      />
                    </div>
                  </td>
                  {COLUMNS.map((col) => (
                    <td key={col.key} className={cn('align-middle', GRID_BORDER)}>
                      {col.readOnly ? (
                        <div className={cn('truncate px-2.5 py-1.5 text-xs text-gray-400', col.align === 'center' && 'text-center')}>
                          {formatDateTimeShort(row.createdAt)}
                        </div>
                      ) : col.key === 'nome' ? (
                        <div className="flex items-center">
                          <EditableField
                            ref={row.id === focusRowId ? (el) => {
                              if (el) { el.focus(); onFocused() }
                            } : undefined}
                            value={row.nome}
                            onSave={(next) => leadBoardsService.updateRow(row.id, { nome: next })}
                            className="bg-transparent px-2.5 py-1.5 text-sm font-medium text-gray-800"
                          />
                          <button
                            type="button"
                            onClick={() => onOpenLead(row.id)}
                            title="Abrir lead"
                            className="relative mr-1.5 grid h-7 w-7 shrink-0 place-items-center rounded-full transition-colors hover:bg-gray-100"
                          >
                            <MessageCircle
                              className={cn('h-5 w-5', row.notesCount > 0 ? 'fill-accent text-accent' : 'text-gray-300')}
                            />
                            {row.notesCount > 0 && (
                              <span className="absolute -bottom-0.5 -right-0.5 grid h-4 min-w-[1rem] place-items-center rounded-full bg-accent px-0.5 text-[10px] font-semibold text-white ring-2 ring-white">
                                {row.notesCount > 9 ? '9+' : row.notesCount}
                              </span>
                            )}
                          </button>
                        </div>
                      ) : col.tag ? (
                        <LeadLabelCell
                          field={col.key as LeadLabelField}
                          value={row[col.key as LeadRowField]}
                          required={col.required}
                          onChange={(next) => {
                            if (col.key === 'status') {
                              const target = allBoards.find(
                                (b) => b.id !== row.boardId && b.name.trim().toLowerCase() === next.trim().toLowerCase(),
                              )
                              applyFieldChange(row, target ? { status: next, boardId: target.id } : { status: next })
                            } else {
                              applyFieldChange(row, { [col.key]: next })
                            }
                          }}
                        />
                      ) : col.currency ? (
                        <CurrencyField
                          value={row[col.key as LeadRowField]}
                          onSave={(next) => leadBoardsService.updateRow(row.id, { [col.key]: next })}
                          className={cn('bg-transparent px-2.5 py-1.5 text-sm text-gray-800', col.align === 'center' && 'text-center')}
                        />
                      ) : col.key === 'retornar' ? (
                        <RetornarField
                          value={row.retornar}
                          retornado={row.retornado}
                          onChange={(patch) => applyFieldChange(row, patch)}
                          className="bg-transparent px-2.5 py-1.5 text-sm text-gray-800"
                        />
                      ) : (
                        <EditableField
                          value={row[col.key as LeadRowField]}
                          type={col.type}
                          placeholder={col.required ? 'Obrigatório' : undefined}
                          onSave={(next) => leadBoardsService.updateRow(row.id, { [col.key]: next })}
                          className={cn(
                            'px-2.5 py-1.5 text-sm text-gray-800',
                            col.align === 'center' && 'text-center',
                            col.required && !row[col.key as LeadRowField]
                              ? 'bg-red-50 ring-1 ring-inset ring-red-200'
                              : 'bg-transparent',
                          )}
                        />
                      )}
                    </td>
                  ))}
                </tr>
                )
              })}
              {rows.length > 0 && (
                <tr className="border-t border-gray-200 bg-gray-50/70 text-xs font-semibold text-[#323338]">
                  <td className={GRID_BORDER} style={{ width: CHECKBOX_COL_WIDTH }} />
                  {COLUMNS.map((col) => (
                    <td key={col.key} className={cn('px-2.5 py-1.5 text-center', GRID_BORDER)}>
                      {col.key === 'valorMrr'
                        ? formatBRLCents(totalMrr)
                        : col.key === 'valorImplementacao'
                          ? formatBRLCents(totalImplementacao)
                          : null}
                    </td>
                  ))}
                </tr>
              )}
              <tr className="hover:bg-gray-50">
                <td colSpan={COLUMNS.length + 1} className="px-2.5 py-2">
                  <button
                    type="button"
                    onClick={() => onCreateRow(board.id)}
                    className="flex items-center gap-1.5 text-xs text-gray-400 transition-colors hover:text-accent"
                  >
                    <Plus className="h-3.5 w-3.5" />
                    Adicionar nome
                  </button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function CreateBoardModal({ open, onClose, page }: { open: boolean; onClose: () => void; page: LeadBoardPage }) {
  const [name, setName] = React.useState('')
  const [color, setColor] = React.useState('#4F8EF7')

  const submit = () => {
    const trimmed = name.trim()
    if (!trimmed) return
    leadBoardsService.createBoard(trimmed, color, page)
    setName('')
    setColor('#4F8EF7')
    onClose()
  }

  return (
    <Modal open={open} onClose={onClose} title="Novo quadro" size="sm">
      <div className="space-y-4">
        <Input
          label="Nome do quadro"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Ex.: Leads Frios"
          autoFocus
          onKeyDown={(e) => { if (e.key === 'Enter') submit() }}
        />
        <div>
          <label className="mb-1.5 block text-xs font-medium text-foreground/70">Cor</label>
          <input
            type="color"
            value={color}
            onChange={(e) => setColor(e.target.value)}
            className="h-10 w-16 cursor-pointer rounded-lg border border-line bg-transparent p-1"
          />
        </div>
      </div>
      <div className="mt-5 flex justify-end gap-2">
        <Button variant="ghost" onClick={onClose}>Cancelar</Button>
        <Button onClick={submit} disabled={!name.trim()}>Criar quadro</Button>
      </div>
    </Modal>
  )
}

export interface LeadBoardsViewProps {
  page: LeadBoardPage
  title: string
  subtitle: string
}

export function LeadBoardsView({ page, title, subtitle }: LeadBoardsViewProps) {
  const booted = useLeadBoardsBooted()
  const allBoards = useLeadBoards()
  const boards = React.useMemo(() => allBoards.filter((b) => b.page === page), [allBoards, page])
  const allRows = useAllLeadRows()
  const pageRows = React.useMemo(() => {
    const boardIds = new Set(boards.map((b) => b.id))
    return allRows.filter((r) => boardIds.has(r.boardId))
  }, [allRows, boards])
  const [search, setSearch] = React.useState('')
  const [sdrFilter, setSdrFilter] = React.useState<string | null>(null)
  const [filterRules, setFilterRules] = React.useState<FilterRule[]>([])
  const [filtersOpen, setFiltersOpen] = React.useState(false)
  const [sortDesc, setSortDesc] = React.useState(false)
  const [boardModalOpen, setBoardModalOpen] = React.useState(false)
  const [importModalOpen, setImportModalOpen] = React.useState(false)
  const [trashModalOpen, setTrashModalOpen] = React.useState(false)
  const [focusRowId, setFocusRowId] = React.useState<string | null>(null)
  const [openLeadId, setOpenLeadId] = React.useState<string | null>(null)
  const [selectedIds, setSelectedIds] = React.useState<Set<string>>(new Set())
  const [draggingIds, setDraggingIds] = React.useState<string[] | null>(null)
  const [dragOverBoardId, setDragOverBoardId] = React.useState<string | null>(null)
  const [columnWidths, setColumnWidths] = React.useState<Record<string, number>>(() => loadColumnWidths(page))

  const handleResizeColumn = React.useCallback((key: string, width: number) => {
    setColumnWidths((prev) => {
      const next = { ...prev, [key]: width }
      try { window.localStorage.setItem(columnWidthsStorageKey(page), JSON.stringify(next)) } catch { /* ignore */ }
      return next
    })
  }, [page])

  const tableWidth = React.useMemo(
    () => CHECKBOX_COL_WIDTH
      + COLUMNS.reduce((sum, c) => sum + (columnWidths[c.key] ?? c.width), 0),
    [columnWidths],
  )

  const handleRowDragStart = React.useCallback((ids: string[]) => setDraggingIds(ids), [])
  const handleRowDragEnd = React.useCallback(() => {
    setDraggingIds(null)
    setDragOverBoardId(null)
  }, [])
  const handleBoardDragOver = React.useCallback((boardId: string) => setDragOverBoardId(boardId), [])
  const handleBoardDragLeave = React.useCallback(() => setDragOverBoardId(null), [])
  const handleBoardDrop = React.useCallback((boardId: string) => {
    setDraggingIds((current) => {
      if (current) for (const id of current) leadBoardsService.updateRow(id, { boardId })
      return null
    })
    setDragOverBoardId(null)
  }, [])

  const toggleRow = React.useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  const toggleAll = React.useCallback((ids: string[], select: boolean) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      for (const id of ids) { if (select) next.add(id); else next.delete(id) }
      return next
    })
  }, [])

  const scrollEls = React.useRef<Map<string, HTMLDivElement>>(new Map())
  const registerScrollEl = React.useCallback((boardId: string, el: HTMLDivElement | null) => {
    if (el) scrollEls.current.set(boardId, el)
    else scrollEls.current.delete(boardId)
  }, [])
  const handleSharedScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const left = e.currentTarget.scrollLeft
    scrollEls.current.forEach((el) => { el.scrollLeft = left })
  }

  const handleCreateRow = (boardId: string) => {
    const row = leadBoardsService.createRow(boardId)
    setFocusRowId(row.id)
  }

  const handleCreateNome = () => {
    if (!boards.length) { setBoardModalOpen(true); return }
    handleCreateRow(boards[0].id)
  }

  const visibleRows = React.useMemo(
    () => pageRows.filter((r) =>
      matchesSearch(r, search) && (!sdrFilter || r.sdr === sdrFilter) && matchesLeadFilters(r, filterRules),
    ),
    [pageRows, search, sdrFilter, filterRules],
  )
  const visibleCount = visibleRows.length

  // Kanban/Dashboard é uma preferência do usuário/navegador, vale pras 3 telas do Comercial.
  const [view, setView] = React.useState<'list' | 'kanban' | 'dashboard'>(() => {
    try {
      const stored = window.localStorage.getItem('comercial_view_mode')
      return stored === 'kanban' || stored === 'dashboard' ? stored : 'list'
    } catch { return 'list' }
  })
  React.useEffect(() => {
    try { window.localStorage.setItem('comercial_view_mode', view) } catch { /* ignore */ }
  }, [view])
  const VIEW_LABEL: Record<'list' | 'kanban' | 'dashboard', string> = { list: 'lista', kanban: 'Kanban', dashboard: 'Dashboard' }
  const changeView = (next: 'list' | 'kanban' | 'dashboard') => {
    if (next === view) return
    setView(next)
    toast.success(`Visão em ${VIEW_LABEL[next]} aplicada — fica salva pra você.`)
  }

  return (
    <>
      <TopBar title={title} subtitle={subtitle} />

      <div className="flex min-h-screen flex-col bg-white px-4 py-4 sm:px-6 sm:py-6 lg:px-8">
        {!booted ? (
          <div className="grid min-h-[30vh] place-items-center text-sm text-gray-500">
            <span className="inline-flex items-center gap-2">
              <Loader2 className="h-4 w-4 animate-spin" />
              Carregando…
            </span>
          </div>
        ) : (
          <>
            <div className="mb-4 flex flex-wrap items-center gap-2">
              {view !== 'dashboard' && (
                <>
                  <Button rightIcon={<ChevronDown className="h-4 w-4" />} onClick={handleCreateNome}>
                    Criar nome
                  </Button>
                  <ToolbarButton icon={<Upload className="h-3.5 w-3.5" />} onClick={() => setImportModalOpen(true)}>
                    Importar
                  </ToolbarButton>
                </>
              )}
              <div className="relative">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Pesquisar"
                  className="h-9 w-44 rounded-md border border-gray-200 bg-white pl-9 pr-2 text-sm text-gray-800 placeholder:text-gray-400 focus:border-accent/60 focus:outline-none"
                />
              </div>
              <ToolbarButton
                icon={<LayoutDashboard className="h-3.5 w-3.5" />}
                onClick={() => changeView('dashboard')}
                className={view === 'dashboard' ? 'bg-accent/10 text-accent' : undefined}
                title="Ver resumo em relatório — só visualização"
              >
                Dashboard
              </ToolbarButton>
              <div className="inline-flex overflow-hidden rounded-lg border border-gray-200">
                <button
                  type="button"
                  onClick={() => changeView('list')}
                  title="Aplicar visão em lista"
                  className={cn(
                    'inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium transition-colors',
                    view === 'list' ? 'bg-accent/10 text-accent' : 'text-gray-500 hover:bg-gray-50',
                  )}
                >
                  <ListTodo className="h-3.5 w-3.5" />
                  Lista
                </button>
                <button
                  type="button"
                  onClick={() => changeView('kanban')}
                  title="Aplicar visão em Kanban"
                  className={cn(
                    'inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium transition-colors',
                    view === 'kanban' ? 'bg-accent/10 text-accent' : 'text-gray-500 hover:bg-gray-50',
                  )}
                >
                  <KanbanSquare className="h-3.5 w-3.5" />
                  Kanban
                </button>
              </div>
              <SdrFilterButton value={sdrFilter} onChange={setSdrFilter} />
              <ToolbarButton
                icon={<Filter className="h-3.5 w-3.5" />}
                onClick={() => setFiltersOpen(true)}
                className={filterRules.length > 0 ? 'text-accent' : undefined}
              >
                {filterRules.length > 0 ? `Filtro (${filterRules.length})` : 'Filtro'}
              </ToolbarButton>
              <ToolbarButton
                icon={<ArrowUpDown className={cn('h-3.5 w-3.5 transition-transform', sortDesc && 'rotate-180')} />}
                onClick={() => setSortDesc((d) => !d)}
                className="text-accent"
                title={sortDesc ? 'Clique para ordenar do mais antigo para o mais novo' : 'Clique para ordenar do mais novo para o mais antigo'}
              >
                {sortDesc ? 'Mais novo' : 'Mais antigo'}
              </ToolbarButton>
            </div>

            {boards.length === 0 ? (
              <EmptyState
                icon={<Rows3 className="h-5 w-5" />}
                title="Nenhum quadro criado ainda"
                description="Crie o primeiro quadro para começar a registrar leads."
                action={<Button size="sm" onClick={() => setBoardModalOpen(true)}>Criar quadro</Button>}
              />
            ) : view === 'dashboard' ? (
              <LeadDashboardView rows={visibleRows} boards={boards} />
            ) : view === 'kanban' ? (
              <LeadKanbanBoard rows={visibleRows} allBoards={boards} onOpenLead={setOpenLeadId} />
            ) : (
              <>
                <div className="flex-1">
                  {boards.map((board) => (
                    <BoardGroup
                      key={board.id}
                      board={board}
                      allBoards={boards}
                      search={search}
                      sdrFilter={sdrFilter}
                      filterRules={filterRules}
                      sortDesc={sortDesc}
                      focusRowId={focusRowId}
                      onFocused={() => setFocusRowId(null)}
                      onCreateRow={handleCreateRow}
                      onOpenLead={setOpenLeadId}
                      registerScrollEl={registerScrollEl}
                      selectedIds={selectedIds}
                      onToggleRow={toggleRow}
                      onToggleAll={toggleAll}
                      draggingIds={draggingIds}
                      isDragOver={dragOverBoardId === board.id}
                      onRowDragStart={handleRowDragStart}
                      onRowDragEnd={handleRowDragEnd}
                      onBoardDragOver={handleBoardDragOver}
                      onBoardDragLeave={handleBoardDragLeave}
                      onBoardDrop={handleBoardDrop}
                      columnWidths={columnWidths}
                      onResizeColumn={handleResizeColumn}
                    />
                  ))}
                  <button
                    type="button"
                    onClick={() => setBoardModalOpen(true)}
                    className="flex h-9 w-full items-center justify-center gap-1.5 rounded-xl border border-dashed border-gray-300 text-xs font-medium text-gray-400 transition-colors hover:border-accent/50 hover:bg-accent/[0.03] hover:text-accent"
                  >
                    <Plus className="h-3.5 w-3.5" />
                    Novo quadro
                  </button>
                  <button
                    type="button"
                    onClick={() => setTrashModalOpen(true)}
                    className="mt-2 flex items-center gap-1 text-[11px] text-gray-400 transition-colors hover:text-gray-600"
                  >
                    <Trash2 className="h-3 w-3" />
                    Excluídos
                  </button>
                </div>

                {/* Barra de rolagem horizontal única, flutuante — visível na tela toda,
                    não precisa descer até o fim da página pra arrastar. */}
                <div className="pointer-events-none fixed inset-x-0 bottom-3 z-30 px-4 sm:px-6 lg:px-8 lg:pl-[236px]">
                  <div
                    className="pointer-events-auto overflow-x-auto overflow-y-hidden rounded-full border border-gray-200 bg-white shadow-lg"
                    style={{ height: 14 }}
                    onScroll={handleSharedScroll}
                  >
                    <div style={{ width: tableWidth, height: 1 }} />
                  </div>
                </div>

                <BulkActionBar
                  selectedIds={selectedIds}
                  allRows={allRows}
                  allBoards={allBoards}
                  onClear={() => setSelectedIds(new Set())}
                />
              </>
            )}
          </>
        )}
      </div>

      <CreateBoardModal open={boardModalOpen} onClose={() => setBoardModalOpen(false)} page={page} />
      <LeadImportModal open={importModalOpen} onClose={() => setImportModalOpen(false)} page={page} boards={boards} />
      <LeadTrashModal open={trashModalOpen} onClose={() => setTrashModalOpen(false)} boards={boards} />
      <LeadDetailModal leadRowId={openLeadId} onClose={() => setOpenLeadId(null)} />
      <LeadFiltersModal
        open={filtersOpen}
        onClose={() => setFiltersOpen(false)}
        rules={filterRules}
        onChange={setFilterRules}
        visibleCount={visibleCount}
        totalCount={pageRows.length}
      />
    </>
  )
}
