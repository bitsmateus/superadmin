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
import { LeadDetailModal } from '@/components/comercial/LeadDetailModal'
import { LeadLabelCell } from '@/components/comercial/LeadLabelCell'
import { EditableField } from '@/components/comercial/EditableField'
import { cn, formatDateTimeShort } from '@/lib/utils'
import { useLeadBoards, useLeadBoardsBooted, useLeadRows } from '@/hooks/useLeadBoards'
import { leadBoardsService } from '@/services/leadBoards'
import type { LeadBoard, LeadLabelField, LeadRow, LeadRowField } from '@/types/leadBoard'

interface ColumnDef {
  key: LeadRowField | 'createdAt'
  label: string
  type?: 'text' | 'date' | 'datetime-local'
  width: number
  readOnly?: boolean
  tag?: boolean
}

const CHECKBOX_COL_WIDTH = 40
const ACTIONS_COL_WIDTH = 36

const COLUMNS: ColumnDef[] = [
  { key: 'nome', label: 'Nome', width: 180 },
  { key: 'empresa', label: 'Empresa', width: 170 },
  { key: 'telefone', label: 'Telefone', width: 140 },
  { key: 'tipo', label: 'Tipo', width: 130, tag: true },
  { key: 'diaContato', label: 'Dia de contato', width: 170, tag: true },
  { key: 'status', label: 'Status', width: 170, tag: true },
  { key: 'sdr', label: 'SDR', width: 130 },
  { key: 'retornar', label: 'Retornar', type: 'datetime-local', width: 190 },
  { key: 'responsavel', label: 'Resp.', width: 130 },
  { key: 'numero', label: 'Número', width: 110 },
  { key: 'dorCliente', label: 'Dor do cliente', width: 200 },
  { key: 'numeroAtendentes', label: 'Número de atendentes', width: 170 },
  { key: 'valorMrr', label: 'Valor MRR', width: 140 },
  { key: 'valorImplementacao', label: 'Valor de Implementação', width: 170 },
  { key: 'createdAt', label: 'Log de criação', width: 160, readOnly: true },
]

const TABLE_WIDTH =
  CHECKBOX_COL_WIDTH + ACTIONS_COL_WIDTH + COLUMNS.reduce((sum, c) => sum + c.width, 0)

const GRID_BORDER = 'border-r border-gray-200'

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
      className="min-w-0 max-w-[280px] truncate bg-transparent text-base font-bold uppercase tracking-wide outline-none focus:underline"
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
  onOpenLead: (rowId: string) => void
  registerScrollEl: (boardId: string, el: HTMLDivElement | null) => void
}

function BoardGroup({ board, search, focusRowId, onFocused, onCreateRow, onOpenLead, registerScrollEl }: BoardGroupProps) {
  const [open, setOpen] = React.useState(true)
  const allRows = useLeadRows(board.id)
  const rows = React.useMemo(() => allRows.filter((r) => matchesSearch(r, search)), [allRows, search])

  return (
    <div
      className="mb-5 overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm transition-shadow hover:shadow-md"
      style={{ borderLeft: `4px solid ${board.color}` }}
    >
      <div
        className="flex items-center gap-2.5 border-b border-gray-200 px-4 py-3"
        style={{ backgroundColor: `${board.color}12` }}
      >
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="grid h-6 w-6 shrink-0 place-items-center rounded-md text-gray-400 transition-colors hover:bg-black/5 hover:text-gray-700"
        >
          <ChevronDown className={cn('h-4 w-4 transition-transform', open ? '' : '-rotate-90')} />
        </button>
        <span className="h-2.5 w-2.5 shrink-0 rounded-full ring-4" style={{ backgroundColor: board.color, boxShadow: `0 0 0 4px ${board.color}1f` }} />
        <BoardNameEditor board={board} />
        <span className="rounded-full bg-black/5 px-2 py-0.5 text-xs font-medium text-gray-500">{rows.length}</span>
        <input
          type="color"
          value={board.color}
          onChange={(e) => leadBoardsService.updateBoard(board.id, { color: e.target.value })}
          title="Cor do quadro"
          className="ml-auto h-6 w-6 shrink-0 cursor-pointer rounded-md border-0 bg-transparent p-0"
        />
        <button
          type="button"
          onClick={() => {
            if (window.confirm(`Excluir o quadro "${board.name}" e todos os leads dentro dele?`)) {
              void leadBoardsService.deleteBoard(board.id)
            }
          }}
          title="Excluir quadro"
          className="grid h-6 w-6 shrink-0 place-items-center rounded-md text-gray-400 transition-colors hover:bg-danger/10 hover:text-danger"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>

      {open && (
        <div ref={(el) => registerScrollEl(board.id, el)} className="overflow-x-hidden">
          <table className="border-collapse table-fixed" style={{ width: TABLE_WIDTH }}>
            <thead>
              <tr className="border-b border-gray-200 bg-gray-50/80 text-left text-[13px] font-semibold uppercase tracking-wide text-[#323338]">
                <th className={cn('px-3 py-3', GRID_BORDER)} style={{ width: CHECKBOX_COL_WIDTH }}>
                  <input type="checkbox" className="h-4 w-4 rounded border-gray-300" />
                </th>
                {COLUMNS.map((col) => (
                  <th key={col.key} className={cn('truncate px-3 py-3 font-semibold', GRID_BORDER)} style={{ width: col.width }}>
                    {col.label}
                  </th>
                ))}
                <th className="px-1 py-3" style={{ width: ACTIONS_COL_WIDTH }} />
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} className="group border-b border-gray-200 transition-colors hover:bg-accent/[0.04]">
                  <td className={cn('px-3 py-2.5 align-middle', GRID_BORDER)}>
                    <input type="checkbox" className="h-4 w-4 rounded border-gray-300" />
                  </td>
                  {COLUMNS.map((col) => (
                    <td key={col.key} className={cn('align-middle', GRID_BORDER)}>
                      {col.readOnly ? (
                        <div className="truncate px-3 py-3 text-sm text-gray-400">
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
                            className="bg-transparent px-3 py-3 text-[15px] font-medium text-gray-800"
                          />
                          <button
                            type="button"
                            onClick={() => onOpenLead(row.id)}
                            title="Abrir lead"
                            className="relative mr-2 grid h-7 w-7 shrink-0 place-items-center rounded text-gray-400 hover:bg-gray-100 hover:text-accent"
                          >
                            <MessageSquare className="h-4 w-4" />
                            {row.notesCount > 0 && (
                              <span className="absolute -right-1 -top-1 grid h-4 min-w-[1rem] place-items-center rounded-full bg-accent px-0.5 text-[10px] font-semibold text-white">
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
                        <EditableField
                          value={row[col.key as LeadRowField]}
                          type={col.type}
                          onSave={(next) => leadBoardsService.updateRow(row.id, { [col.key]: next })}
                          className="bg-transparent px-3 py-3 text-[15px] text-gray-800"
                        />
                      )}
                    </td>
                  ))}
                  <td className="text-center align-middle">
                    <button
                      type="button"
                      onClick={() => void leadBoardsService.deleteRow(row.id)}
                      title="Remover lead"
                      className="grid h-8 w-8 place-items-center rounded text-gray-300 hover:bg-danger/10 hover:text-danger"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </td>
                </tr>
              ))}
              <tr className="hover:bg-gray-50">
                <td colSpan={COLUMNS.length + 2} className="px-3 py-3">
                  <button
                    type="button"
                    onClick={() => onCreateRow(board.id)}
                    className="flex items-center gap-1.5 text-sm text-gray-400 transition-colors hover:text-accent"
                  >
                    <Plus className="h-4 w-4" />
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
  const [openLeadId, setOpenLeadId] = React.useState<string | null>(null)

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

  return (
    <>
      <TopBar title="Novos Leads" subtitle="Comercial · quadros de captação de leads" />

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
              <Button rightIcon={<ChevronDown className="h-4 w-4" />} onClick={handleCreateNome}>
                Criar nome
              </Button>
              <div className="relative">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Pesquisar"
                  className="h-9 w-44 rounded-md border border-gray-200 bg-white pl-9 pr-2 text-sm text-gray-800 placeholder:text-gray-400 focus:border-accent/60 focus:outline-none"
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
                <div className="flex-1">
                  {boards.map((board) => (
                    <BoardGroup
                      key={board.id}
                      board={board}
                      search={search}
                      focusRowId={focusRowId}
                      onFocused={() => setFocusRowId(null)}
                      onCreateRow={handleCreateRow}
                      onOpenLead={setOpenLeadId}
                      registerScrollEl={registerScrollEl}
                    />
                  ))}
                  <button
                    type="button"
                    onClick={() => setBoardModalOpen(true)}
                    className="flex h-12 w-full items-center justify-center gap-1.5 rounded-2xl border border-dashed border-gray-300 text-sm font-medium text-gray-400 transition-colors hover:border-accent/50 hover:bg-accent/[0.03] hover:text-accent"
                  >
                    <Plus className="h-4 w-4" />
                    Novo quadro
                  </button>
                </div>

                {/* Barra de rolagem horizontal única — arrasta todos os quadros juntos */}
                <div
                  className="sticky bottom-0 mt-3 overflow-x-auto overflow-y-hidden border-t border-gray-200 bg-white"
                  style={{ height: 16 }}
                  onScroll={handleSharedScroll}
                >
                  <div style={{ width: TABLE_WIDTH, height: 1 }} />
                </div>
              </>
            )}
          </>
        )}
      </div>

      <CreateBoardModal open={boardModalOpen} onClose={() => setBoardModalOpen(false)} />
      <LeadDetailModal leadRowId={openLeadId} onClose={() => setOpenLeadId(null)} />
    </>
  )
}
