import * as React from 'react'
import {
  ArrowUpDown,
  ChevronDown,
  Ellipsis,
  EyeOff,
  Filter,
  Loader2,
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
import { cn } from '@/lib/utils'
import { useRole } from '@/hooks/useAuth'
import { useLeadBoards, useLeadBoardsBooted, useLeadRows } from '@/hooks/useLeadBoards'
import { useDebouncedCallback } from '@/hooks/useDebouncedCallback'
import { leadBoardsService } from '@/services/leadBoards'
import type { LeadBoard, LeadRow, LeadRowField } from '@/types/leadBoard'

interface ColumnDef {
  key: LeadRowField
  label: string
  type?: 'text' | 'date'
  width: string
}

const COLUMNS: ColumnDef[] = [
  { key: 'nome', label: 'Nome', width: 'min-w-[180px]' },
  { key: 'tipo', label: 'Tipo', width: 'min-w-[110px]' },
  { key: 'empresa', label: 'Empresa', width: 'min-w-[180px]' },
  { key: 'telefone', label: 'Telefone', width: 'min-w-[140px]' },
  { key: 'diaContato', label: 'Dia de contato', type: 'date', width: 'min-w-[150px]' },
  { key: 'status', label: 'Status', width: 'min-w-[130px]' },
  { key: 'retornar', label: 'Retornar', type: 'date', width: 'min-w-[130px]' },
  { key: 'ligacao', label: 'Ligação', width: 'min-w-[110px]' },
  { key: 'responsavel', label: 'Resp.', width: 'min-w-[110px]' },
  { key: 'numero', label: 'Número', width: 'min-w-[110px]' },
]

function matchesSearch(row: LeadRow, term: string): boolean {
  if (!term) return true
  const haystack = `${row.nome} ${row.empresa} ${row.telefone} ${row.status} ${row.responsavel}`.toLowerCase()
  return haystack.includes(term.toLowerCase())
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
        'h-full w-full bg-transparent px-3 py-2.5 text-sm text-foreground/85 outline-none',
        'placeholder:text-foreground/25 focus:bg-accent/[0.06]',
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
  canManage: boolean
  focusRowId: string | null
  onFocused: () => void
  onCreateRow: (boardId: string) => void
  canDelete: boolean
}

function BoardGroup({ board, search, canManage, focusRowId, onFocused, onCreateRow, canDelete }: BoardGroupProps) {
  const [open, setOpen] = React.useState(true)
  const allRows = useLeadRows(board.id)
  const rows = React.useMemo(() => allRows.filter((r) => matchesSearch(r, search)), [allRows, search])

  return (
    <div className="mb-4 overflow-hidden rounded-xl border border-line">
      <div className="flex items-center gap-2 border-b border-line bg-elevate/[0.02] px-3 py-2.5">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="grid h-6 w-6 shrink-0 place-items-center rounded text-foreground/50 hover:bg-elevate/[0.06] hover:text-foreground"
        >
          <ChevronDown className={cn('h-4 w-4 transition-transform', open ? '' : '-rotate-90')} />
        </button>
        <span
          className="h-2.5 w-2.5 shrink-0 rounded-sm"
          style={{ backgroundColor: board.color }}
        />
        <BoardNameEditor board={board} />
        <span className="text-xs text-foreground/35">{rows.length}</span>
        <input
          type="color"
          value={board.color}
          onChange={(e) => leadBoardsService.updateBoard(board.id, { color: e.target.value })}
          title="Cor do quadro"
          className="ml-auto h-6 w-6 shrink-0 cursor-pointer rounded border-0 bg-transparent p-0"
        />
        {canManage && canDelete && (
          <button
            type="button"
            onClick={() => {
              if (window.confirm(`Excluir o quadro "${board.name}" e todos os leads dentro dele?`)) {
                void leadBoardsService.deleteBoard(board.id)
              }
            }}
            title="Excluir quadro"
            className="grid h-6 w-6 shrink-0 place-items-center rounded text-foreground/40 hover:bg-danger/10 hover:text-danger"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      {open && (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse">
            <thead>
              <tr className="border-b border-line bg-elevate/[0.015] text-left text-xs font-medium text-foreground/45">
                <th className="w-10 px-3 py-2">
                  <input type="checkbox" className="rounded border-line" />
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
                <tr key={row.id} className="group border-b border-line/60 last:border-b-0 hover:bg-elevate/[0.02]">
                  <td className="px-3 py-2 align-middle">
                    <input type="checkbox" className="rounded border-line" />
                  </td>
                  {COLUMNS.map((col) => (
                    <td key={col.key} className={cn('border-l border-line/40 align-middle', col.width)}>
                      <EditableCell
                        ref={col.key === 'nome' ? (el) => {
                          if (el && row.id === focusRowId) { el.focus(); onFocused() }
                        } : undefined}
                        value={row[col.key]}
                        type={col.type}
                        onSave={(next) => leadBoardsService.updateRow(row.id, { [col.key]: next })}
                      />
                    </td>
                  ))}
                  <td className="px-1 text-center align-middle">
                    <button
                      type="button"
                      onClick={() => void leadBoardsService.deleteRow(row.id)}
                      title="Remover lead"
                      className="hidden h-7 w-7 place-items-center rounded text-foreground/30 hover:bg-danger/10 hover:text-danger group-hover:grid"
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
                    className="flex items-center gap-1.5 text-xs text-foreground/40 hover:text-foreground/70"
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
  const role = useRole()
  const canManage = role === 'admin' || role === 'supervisor'
  const booted = useLeadBoardsBooted()
  const boards = useLeadBoards()
  const [search, setSearch] = React.useState('')
  const [boardModalOpen, setBoardModalOpen] = React.useState(false)
  const [focusRowId, setFocusRowId] = React.useState<string | null>(null)

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

      <div className="px-4 py-4 sm:px-6 sm:py-6 lg:px-8">
        {!booted ? (
          <div className="grid min-h-[30vh] place-items-center text-sm text-foreground/55">
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
                <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-foreground/35" />
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Pesquisar"
                  className="h-8 w-40 rounded-md border border-line bg-transparent pl-8 pr-2 text-xs text-foreground placeholder:text-foreground/35 focus:border-accent/50 focus:outline-none"
                />
              </div>
              <Button variant="ghost" size="sm" leftIcon={<UserRound className="h-3.5 w-3.5" />}>Pessoa</Button>
              <Button variant="ghost" size="sm" leftIcon={<Filter className="h-3.5 w-3.5" />}>Filtro</Button>
              <Button variant="ghost" size="sm" leftIcon={<ArrowUpDown className="h-3.5 w-3.5" />}>Ordenar</Button>
              <Button variant="ghost" size="sm" leftIcon={<EyeOff className="h-3.5 w-3.5" />}>Ocultar</Button>
              <Button variant="ghost" size="sm" leftIcon={<Rows3 className="h-3.5 w-3.5" />}>Agrupar por</Button>
              <Button variant="ghost" size="sm" className="px-2"><Ellipsis className="h-3.5 w-3.5" /></Button>
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
                    canManage={canManage}
                    canDelete={boards.length > 1}
                    focusRowId={focusRowId}
                    onFocused={() => setFocusRowId(null)}
                    onCreateRow={handleCreateRow}
                  />
                ))}
                <Button
                  variant="ghost"
                  size="sm"
                  leftIcon={<Plus className="h-3.5 w-3.5" />}
                  onClick={() => setBoardModalOpen(true)}
                >
                  Novo quadro
                </Button>
              </>
            )}
          </>
        )}
      </div>

      <CreateBoardModal open={boardModalOpen} onClose={() => setBoardModalOpen(false)} />
    </>
  )
}
