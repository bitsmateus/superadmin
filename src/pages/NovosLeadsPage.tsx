import * as React from 'react'
import {
  ArrowUpDown,
  ChevronDown,
  Ellipsis,
  EyeOff,
  Filter,
  Loader2,
  MessageSquare,
  Plus,
  Rows3,
  Search,
  Trash2,
  UserRound,
} from 'lucide-react'
import { TopBar } from '@/components/layout/TopBar'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Modal } from '@/components/ui/Modal'
import { EmptyState } from '@/components/ui/EmptyState'
import { LeadNotesDrawer } from '@/components/comercial/LeadNotesDrawer'
import { LeadLabelCell } from '@/components/comercial/LeadLabelCell'
import { cn, formatDateTimeShort } from '@/lib/utils'
import { useLeadBoards, useLeadBoardsBooted, useLeadRows } from '@/hooks/useLeadBoards'
import { useDebouncedCallback } from '@/hooks/useDebouncedCallback'
import { leadBoardsService } from '@/services/leadBoards'
import type { LeadBoard, LeadLabelField, LeadRow, LeadRowField } from '@/types/leadBoard'

interface ColumnDef {
  key: LeadRowField | 'createdAt'
  label: string
  type?: 'text' | 'date'
  width: string
  readOnly?: boolean
  tag?: boolean
}

const COLUMNS: ColumnDef[] = [
  { key: 'nome', label: 'Nome', width: 'min-w-[180px]' },
  { key: 'tipo', label: 'Tipo', width: 'min-w-[110px]' },
  { key: 'empresa', label: 'Empresa', width: 'min-w-[180px]' },
  { key: 'telefone', label: 'Telefone', width: 'min-w-[140px]' },
  { key: 'diaContato', label: 'Dia de contato', width: 'min-w-[170px]', tag: true },
  { key: 'status', label: 'Status', width: 'min-w-[170px]', tag: true },
  { key: 'retornar', label: 'Retornar', type: 'date', width: 'min-w-[130px]' },
  { key: 'ligacao', label: 'Ligação', width: 'min-w-[110px]' },
  { key: 'responsavel', label: 'Resp.', width: 'min-w-[110px]' },
  { key: 'numero', label: 'Número', width: 'min-w-[110px]' },
  { key: 'dorCliente', label: 'Dor do cliente', width: 'min-w-[200px]' },
  { key: 'numeroAtendentes', label: 'Número de atendentes', width: 'min-w-[170px]' },
  { key: 'valorPrevisto', label: 'Valor Previsto', width: 'min-w-[140px]' },
  { key: 'valorFechado', label: 'Valor Fechado', width: 'min-w-[140px]' },
  { key: 'createdAt', label: 'Log de criação', width: 'min-w-[160px]', readOnly: true },
]

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
}: {
  icon?: React.ReactNode
  children?: React.ReactNode
  onClick?: () => void
  className?: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'inline-flex h-8 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium text-gray-500',
        'transition-colors hover:bg-gray-100 hover:text-gray-800',
        className,
      )}
    >
      {icon}
      {children}
    </button>
  )
}

const EditableCell = React.forwardRef<
  HTMLInputElement,
  { value: string; type?: 'text' | 'date'; placeholder?: string; onSave: (next: string) => void }
>(function EditableCell({ value, type = 'text', placeholder, onSave }, ref) {
  const [local, setLocal] = React.useState(value)
  const focusedRef = React.useRef(false)
  const debouncedSave = useDebouncedCallback((next: string) => onSave(next), 600)

  React.useEffect(() => {
    if (!focusedRef.current) setLocal(value)
  }, [value])

  return (
    <input
      ref={ref}
      type={type}
      value={local}
      placeholder={placeholder}
      onFocus={() => { focusedRef.current = true }}
      onChange={(e) => {
        setLocal(e.target.value)
        debouncedSave(e.target.value)
      }}
      onBlur={() => {
        focusedRef.current = false
        if (local !== value) onSave(local)
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
      }}
      className={cn(
        'h-full w-full bg-transparent px-3 py-2.5 text-sm text-gray-800 outline-none',
        'placeholder:text-gray-300 focus:bg-accent/[0.06]',
      )}
    />
  )
})

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
      className="min-w-0 max-w-[280px] truncate bg-transparent text-sm font-semibold uppercase tracking-wide outline-none focus:underline"
      style={{ color: board.color }}
    />
  )
}

interface BoardGroupProps {
  board: LeadBoard
  search: string
  focusRowId: string | null
  onFocused: () => void
  onCreateRow: (boardId: string) => void
  onOpenNotes: (rowId: string, rowName: string) => void
}

function BoardGroup({ board, search, focusRowId, onFocused, onCreateRow, onOpenNotes }: BoardGroupProps) {
  const [open, setOpen] = React.useState(true)
  const allRows = useLeadRows(board.id)
  const rows = React.useMemo(() => allRows.filter((r) => matchesSearch(r, search)), [allRows, search])

  return (
    <div className="mb-4 overflow-hidden rounded-xl border border-gray-200">
      <div className="flex items-center gap-2 border-b border-gray-200 bg-gray-50 px-3 py-2.5">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="grid h-6 w-6 shrink-0 place-items-center rounded text-gray-400 hover:bg-gray-100 hover:text-gray-700"
        >
          <ChevronDown className={cn('h-4 w-4 transition-transform', open ? '' : '-rotate-90')} />
        </button>
        <span
          className="h-2.5 w-2.5 shrink-0 rounded-sm"
          style={{ backgroundColor: board.color }}
        />
        <BoardNameEditor board={board} />
        <span className="text-xs text-gray-400">{rows.length}</span>
        <input
          type="color"
          value={board.color}
          onChange={(e) => leadBoardsService.updateBoard(board.id, { color: e.target.value })}
          title="Cor do quadro"
          className="ml-auto h-6 w-6 shrink-0 cursor-pointer rounded border-0 bg-transparent p-0"
        />
        <button
          type="button"
          onClick={() => {
            if (window.confirm(`Excluir o quadro "${board.name}" e todos os leads dentro dele?`)) {
              void leadBoardsService.deleteBoard(board.id)
            }
          }}
          title="Excluir quadro"
          className="grid h-6 w-6 shrink-0 place-items-center rounded text-gray-400 hover:bg-danger/10 hover:text-danger"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>

      {open && (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse">
            <thead>
              <tr className="border-b border-gray-200 bg-gray-50 text-left text-xs font-medium text-gray-500">
                <th className="w-10 px-3 py-2">
                  <input type="checkbox" className="rounded border-gray-300" />
                </th>
                {COLUMNS.map((col) => (
                  <th key={col.key} className={cn('px-1 py-2 font-medium', col.width)}>
                    {col.label}
                  </th>
                ))}
                <th className="w-9 px-1 py-2" />
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} className="group border-b border-gray-100 last:border-b-0 hover:bg-gray-50">
                  <td className="px-3 py-2 align-middle">
                    <input type="checkbox" className="rounded border-gray-300" />
                  </td>
                  {COLUMNS.map((col) => (
                    <td key={col.key} className={cn('border-l border-gray-100 align-middle', col.width)}>
                      {col.readOnly ? (
                        <div className="truncate px-3 py-2.5 text-xs text-gray-400">
                          {formatDateTimeShort(row.createdAt)}
                        </div>
                      ) : col.key === 'nome' ? (
                        <div className="flex items-center">
                          <EditableCell
                            ref={row.id === focusRowId ? (el) => {
                              if (el) { el.focus(); onFocused() }
                            } : undefined}
                            value={row.nome}
                            onSave={(next) => leadBoardsService.updateRow(row.id, { nome: next })}
                          />
                          <button
                            type="button"
                            onClick={() => onOpenNotes(row.id, row.nome || 'Lead sem nome')}
                            title="Anotações do lead"
                            className="relative mr-2 grid h-6 w-6 shrink-0 place-items-center rounded text-gray-400 hover:bg-gray-100 hover:text-accent"
                          >
                            <MessageSquare className="h-3.5 w-3.5" />
                            {row.notesCount > 0 && (
                              <span className="absolute -right-1 -top-1 grid h-3.5 min-w-[0.875rem] place-items-center rounded-full bg-accent px-0.5 text-[9px] font-semibold text-white">
                                {row.notesCount > 9 ? '9+' : row.notesCount}
                              </span>
                            )}
                          </button>
                        </div>
                      ) : col.tag ? (
                        <LeadLabelCell
                          field={col.key as LeadLabelField}
                          value={row[col.key as LeadRowField]}
                          onChange={(next) => leadBoardsService.updateRow(row.id, { [col.key]: next })}
                        />
                      ) : (
                        <EditableCell
                          value={row[col.key as LeadRowField]}
                          type={col.type}
                          onSave={(next) => leadBoardsService.updateRow(row.id, { [col.key]: next })}
                        />
                      )}
                    </td>
                  ))}
                  <td className="px-1 text-center align-middle">
                    <button
                      type="button"
                      onClick={() => void leadBoardsService.deleteRow(row.id)}
                      title="Remover lead"
                      className="grid h-7 w-7 place-items-center rounded text-gray-300 hover:bg-danger/10 hover:text-danger"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </td>
                </tr>
              ))}
              <tr>
                <td colSpan={COLUMNS.length + 2} className="px-3 py-2">
                  <button
                    type="button"
                    onClick={() => onCreateRow(board.id)}
                    className="flex items-center gap-1.5 text-xs text-gray-400 hover:text-gray-700"
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

function CreateBoardModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [name, setName] = React.useState('')
  const [color, setColor] = React.useState('#4F8EF7')

  const submit = () => {
    const trimmed = name.trim()
    if (!trimmed) return
    leadBoardsService.createBoard(trimmed, color)
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

export function NovosLeadsPage() {
  const booted = useLeadBoardsBooted()
  const boards = useLeadBoards()
  const [search, setSearch] = React.useState('')
  const [boardModalOpen, setBoardModalOpen] = React.useState(false)
  const [focusRowId, setFocusRowId] = React.useState<string | null>(null)
  const [notesLead, setNotesLead] = React.useState<{ id: string; name: string } | null>(null)

  const handleCreateRow = (boardId: string) => {
    const row = leadBoardsService.createRow(boardId)
    setFocusRowId(row.id)
  }

  const handleCreateNome = () => {
    if (!boards.length) { setBoardModalOpen(true); return }
    handleCreateRow(boards[0].id)
  }

  return (
    <>
      <TopBar title="Novos Leads" subtitle="Comercial · quadros de captação de leads" />

      <div className="min-h-screen bg-white px-4 py-4 sm:px-6 sm:py-6 lg:px-8">
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
              <Button size="sm" rightIcon={<ChevronDown className="h-3.5 w-3.5" />} onClick={handleCreateNome}>
                Criar nome
              </Button>
              <div className="relative">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-gray-400" />
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Pesquisar"
                  className="h-8 w-40 rounded-md border border-gray-200 bg-white pl-8 pr-2 text-xs text-gray-800 placeholder:text-gray-400 focus:border-accent/60 focus:outline-none"
                />
              </div>
              <ToolbarButton icon={<UserRound className="h-3.5 w-3.5" />}>Pessoa</ToolbarButton>
              <ToolbarButton icon={<Filter className="h-3.5 w-3.5" />}>Filtro</ToolbarButton>
              <ToolbarButton icon={<ArrowUpDown className="h-3.5 w-3.5" />}>Ordenar</ToolbarButton>
              <ToolbarButton icon={<EyeOff className="h-3.5 w-3.5" />}>Ocultar</ToolbarButton>
              <ToolbarButton icon={<Rows3 className="h-3.5 w-3.5" />}>Agrupar por</ToolbarButton>
              <ToolbarButton icon={<Ellipsis className="h-3.5 w-3.5" />} className="px-2" />
            </div>

            {boards.length === 0 ? (
              <EmptyState
                icon={<Rows3 className="h-5 w-5" />}
                title="Nenhum quadro criado ainda"
                description="Crie o primeiro quadro para começar a registrar leads."
                action={<Button size="sm" onClick={() => setBoardModalOpen(true)}>Criar quadro</Button>}
              />
            ) : (
              <>
                {boards.map((board) => (
                  <BoardGroup
                    key={board.id}
                    board={board}
                    search={search}
                    focusRowId={focusRowId}
                    onFocused={() => setFocusRowId(null)}
                    onCreateRow={handleCreateRow}
                    onOpenNotes={(id, name) => setNotesLead({ id, name })}
                  />
                ))}
                <ToolbarButton icon={<Plus className="h-3.5 w-3.5" />} onClick={() => setBoardModalOpen(true)}>
                  Novo quadro
                </ToolbarButton>
              </>
            )}
          </>
        )}
      </div>

      <CreateBoardModal open={boardModalOpen} onClose={() => setBoardModalOpen(false)} />
      <LeadNotesDrawer
        leadRowId={notesLead?.id ?? null}
        leadName={notesLead?.name ?? ''}
        onClose={() => setNotesLead(null)}
      />
    </>
  )
}
