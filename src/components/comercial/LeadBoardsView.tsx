import * as React from 'react'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import {
  Archive,
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
  MoreHorizontal,
  Pencil,
  Plus,
  Rows3,
  ScrollText,
  Search,
  StickyNote,
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
import { PageActivityLogModal } from '@/components/comercial/PageActivityLogModal'
import { LeadKanbanBoard } from '@/components/comercial/LeadKanbanBoard'
import { LeadDashboardView } from '@/components/comercial/LeadDashboardView'
import { LeadTrashModal } from '@/components/comercial/LeadTrashModal'
import { LeadTodayPanel } from '@/components/comercial/LeadTodayPanel'
import { LeadLabelCell } from '@/components/comercial/LeadLabelCell'
import { EditableField } from '@/components/comercial/EditableField'
import { CurrencyField } from '@/components/comercial/CurrencyField'
import { RetornarField } from '@/components/comercial/RetornarField'
import { AgendamentoField } from '@/components/comercial/AgendamentoField'
import { LeadFiltersModal, matchesLeadFilters, type FilterRule } from '@/components/comercial/LeadFiltersModal'
import { useOutsideClose } from '@/hooks/useOutsideClose'
import { cn, formatDateTimeShort } from '@/lib/utils'
import { formatBRLCents, parseBRLCents } from '@/lib/currency'
import { useAllLeadRows, useLeadBoards, useLeadBoardsBooted, useLeadRows } from '@/hooks/useLeadBoards'
import { useLeadLabels } from '@/hooks/useLeadLabels'
import { useLeadPages } from '@/hooks/useLeadPages'
import { useAuth } from '@/hooks/useAuth'
import { leadBoardsService } from '@/services/leadBoards'
import { leadLabelsService } from '@/services/leadLabels'
import { leadPagesService } from '@/services/leadPages'
import { canManageUsers } from '@/services/supabase'
import type { LeadBoard, LeadBoardPage, LeadLabelField, LeadPage, LeadRow, LeadRowField } from '@/types/leadBoard'

// A lib de leitura de .xlsx é pesada (~400KB) — carrega só quando alguém abre o import,
// não no bundle inicial da tela de Lista/Kanban/Dashboard.
const LeadImportModal = React.lazy(() =>
  import('@/components/comercial/LeadImportModal').then((m) => ({ default: m.LeadImportModal })),
)
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
  /** Largura travada — ninguém arrasta pra redimensionar, ignora qualquer preferência salva. */
  widthLocked?: boolean
}

/** Largura de exibição de uma coluna: travada usa sempre o padrão fixo; senão, a preferência
 * salva do usuário (se existir) manda mais que o padrão do código. */
function columnWidth(col: ColumnDef, columnWidths: Record<string, number>): number {
  return col.widthLocked ? col.width : (columnWidths[col.key] ?? col.width)
}

const CHECKBOX_COL_WIDTH = 58

const COLUMNS: ColumnDef[] = [
  { key: 'nome', label: 'Nome', width: 180 },
  { key: 'empresa', label: 'Empresa', width: 170, align: 'center' },
  { key: 'telefone', label: 'Telefone', width: 140, required: true },
  { key: 'tipo', label: 'Tipo', width: 108, tag: true },
  { key: 'diaContato', label: 'Dia de contato', width: 140, tag: true, required: true },
  { key: 'ligacao', label: 'Lig.', width: 46, tag: true, widthLocked: true },
  { key: 'status', label: 'Status', width: 170, tag: true, required: true },
  { key: 'agendamento', label: 'Agendamento', type: 'date', width: 150, align: 'center' },
  { key: 'retornar', label: 'Retornar', type: 'datetime-local', width: 190 },
  { key: 'sdr', label: 'SDR', width: 100, tag: true },
  { key: 'dorCliente', label: 'Dor do cliente', width: 200, align: 'center' },
  { key: 'numeroAtendentes', label: 'Número de atendentes', width: 170, align: 'center' },
  { key: 'valorMrr', label: 'Valor MRR', width: 140, currency: true, align: 'center' },
  { key: 'valorImplementacao', label: 'Valor de Implementação', width: 170, currency: true, align: 'center' },
  { key: 'fechamento', label: 'Fechamento', type: 'date', width: 140, align: 'center' },
  { key: 'createdAt', label: 'Log de criação', width: 160, readOnly: true, align: 'center' },
]

/** Colunas do quadro de vendas — só o que interessa numa venda fechada. As do dia a dia do SDR
 * (Dia de contato, Lig., Retornar, Dor do cliente…) não fazem sentido depois do negócio fechado. */
const VENDAS_COLUMN_KEYS = new Set<string>([
  'nome', 'empresa', 'telefone', 'sdr', 'valorMrr', 'valorImplementacao', 'fechamento',
])

const GRID_BORDER = 'border-r border-line'
const MIN_COL_WIDTH = 80


/** Abas que pertencem a um SDR específico (ex.: "CRM LUIS", "CRM NX Arthur") travam nele — o
 * Dashboard só mostra as métricas daquele SDR e a coluna SDR some da tabela (não faz sentido
 * escolher entre os dois ali dentro). Casa pelo NOME da aba, não pelo id — o id fixo das 3 abas
 * de sempre não muda com uma renomeação, mas uma aba nova/duplicada pode ter qualquer nome, e é
 * o nome que a pessoa realmente lê pra saber de quem é aquela aba. A visão combinada dos dois só
 * existe no Dashboard Comercial (visão do admin). */
function sdrLockForPageName(pageName: string, sdrLabels: { name: string }[]): string | undefined {
  const lower = pageName.toLowerCase()
  return sdrLabels.find((l) => lower.includes(l.name.toLowerCase()))?.name
}

/** Aba "CRM Ian e Mateus" não usa esses campos — pedido direto do usuário pra tirar da tabela. */
const IAN_MATEUS_HIDDEN_COLUMN_KEYS = new Set<string>([
  'tipo', 'diaContato', 'ligacao', 'sdr', 'dorCliente', 'numeroAtendentes', 'valorMrr', 'valorImplementacao',
])

/** true pra aba do Ian OU do Mateus (ex.: "CRM Ian", "CRM Mateus") — casa pelo nome, como
 * sdrLockForPageName já faz, pra sobreviver a uma renomeação de id. Usa \b (palavra inteira) pra
 * não confundir "ian" com um pedaço de outra palavra qualquer (ex.: "diante"). */
function isIanMateusPage(pageName: string): boolean {
  return /\bian\b/i.test(pageName) || /\bmateus\b/i.test(pageName)
}

/** Colunas visíveis numa aba — a coluna SDR só faz sentido em Novos Leads (várias pessoas
 * cadastrando ali); numa aba travada num SDR só, a coluna vira redundante e some da tabela.
 * O quadro de vendas tem um conjunto próprio: lá o que importa é quem, quanto e quando. */
function columnsForSdrLock(
  sdrLock: string | undefined,
  isVendas = false,
  hideIanMateusCols = false,
  boardName = '',
): ColumnDef[] {
  if (isVendas) return COLUMNS.filter((c) => VENDAS_COLUMN_KEYS.has(c.key))
  // "Fechamento" só existe no contexto de venda — fora dele seria uma coluna vazia em todo lead.
  const base = COLUMNS.filter((c) => c.key !== 'fechamento')
  const withoutSdr = sdrLock ? base.filter((c) => c.key !== 'sdr') : base
  const visible = hideIanMateusCols ? withoutSdr.filter((c) => !IAN_MATEUS_HIDDEN_COLUMN_KEYS.has(c.key)) : withoutSdr
  // Agendamento só é obrigatório dentro do quadro "Reunião agendada" — nos outros quadros o
  // lead ainda nem chegou nessa etapa, então não faz sentido cobrar a data aqui.
  if (boardName.trim().toLowerCase() !== 'reunião agendada') return visible
  return visible.map((c) => (c.key === 'agendamento' ? { ...c, required: true } : c))
}

function columnWidthsStorageKey(page: LeadBoardPage) {
  return `leadColumnWidths:${page}`
}

const LIGACAO_WIDTH_MIGRATION_KEY = 'leadColumnWidths:ligacaoNarrowMigration'

// A coluna Lig. ficou bem mais estreita (28px) — sem isso, quem já tinha redimensionado ela
// manualmente (ou herdou o valor antigo, mais largo) nunca veria a mudança, porque a
// preferência salva sempre ganha do padrão novo do código. Roda só uma vez por navegador.
function migrateLigacaoWidthOnce() {
  try {
    if (window.localStorage.getItem(LIGACAO_WIDTH_MIGRATION_KEY)) return
    // As 3 abas de sempre — os ids nunca mudaram nessa migração de estrutura, só passaram a
    // vir de lead_pages em vez de um enum fixo no código.
    for (const p of ['novos_leads', 'crm_luis', 'crm_arthur']) {
      const key = columnWidthsStorageKey(p)
      const raw = window.localStorage.getItem(key)
      if (!raw) continue
      const parsed = JSON.parse(raw)
      if ('ligacao' in parsed) {
        delete parsed.ligacao
        window.localStorage.setItem(key, JSON.stringify(parsed))
      }
    }
    window.localStorage.setItem(LIGACAO_WIDTH_MIGRATION_KEY, '1')
  } catch { /* ignore */ }
}

function loadColumnWidths(page: LeadBoardPage): Record<string, number> {
  migrateLigacaoWidthOnce()
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

/** Compara duas linhas por UMA coluna qualquer — valor em R$ ordena pelo número (não pelo texto
 * "R$ 1.234,56"), o resto ordena como texto (mas "numeric" no localeCompare já lê "Lead 10" depois
 * de "Lead 2" certinho, em vez de ordem alfabética pura). */
function compareRowsByColumn(a: LeadRow, b: LeadRow, key: LeadRowField | 'createdAt' | 'position'): number {
  if (key === 'position') return a.position - b.position
  if (key === 'valorMrr' || key === 'valorImplementacao') {
    return parseBRLCents(a[key]) - parseBRLCents(b[key])
  }
  return String(a[key] ?? '').localeCompare(String(b[key] ?? ''), 'pt-BR', { numeric: true, sensitivity: 'base' })
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
        'inline-flex h-9 items-center gap-1.5 rounded-md px-3 text-sm font-medium text-foreground/50',
        'transition-colors hover:bg-elevate/[0.08] hover:text-foreground',
        className,
      )}
    >
      {icon}
      {children}
    </button>
  )
}

/** Duplicar (só a estrutura de quadros, sem leads) e arquivar a aba do Comercial — admin only.
 * Arquivar não apaga nada: quadros e leads continuam intactos no banco até alguém restaurar. */
function PageActionsMenu({ pageId, pageName, boards }: { pageId: string; pageName: string; boards: LeadBoard[] }) {
  const navigate = useNavigate()
  const pages = useLeadPages()
  const isNotas = pages.find((p) => p.id === pageId)?.isNotas ?? false
  const [open, setOpen] = React.useState(false)
  const [busy, setBusy] = React.useState(false)
  const [duplicateOpen, setDuplicateOpen] = React.useState(false)
  const [duplicateName, setDuplicateName] = React.useState('')
  const [duplicateBoardIds, setDuplicateBoardIds] = React.useState<Set<string>>(new Set())
  const ref = React.useRef<HTMLDivElement>(null)
  useOutsideClose(ref, open, () => setOpen(false))

  const openDuplicate = () => {
    setDuplicateName(`${pageName} (cópia)`)
    setDuplicateBoardIds(new Set(boards.map((b) => b.id)))
    setDuplicateOpen(true)
    setOpen(false)
  }

  const toggleDuplicateBoard = (id: string) => {
    setDuplicateBoardIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const confirmDuplicate = async () => {
    const name = duplicateName.trim()
    if (!name) return
    setBusy(true)
    try {
      const created = await leadPagesService.duplicate(pageId, name, Array.from(duplicateBoardIds))
      // Os quadros novos entram por SSE, mas recarrega na hora pra não esperar — senão a aba
      // abre "vazia" por um instante até o realtime alcançar.
      await leadBoardsService.reloadBoards()
      toast.success(`"${created.name}" criada — mesma estrutura de quadros, sem os leads.`)
      setDuplicateOpen(false)
      navigate(`/comercial/${created.id}`)
    } catch (err) {
      toast.error('Falha ao duplicar: ' + (err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const archive = async () => {
    if (!window.confirm(`Arquivar "${pageName}"? Os quadros e leads continuam salvos — dá pra restaurar depois.`)) return
    setBusy(true)
    try {
      await leadPagesService.archive(pageId)
      toast.success(`"${pageName}" arquivada.`)
      setOpen(false)
      navigate('/comercial')
    } catch (err) {
      toast.error('Falha ao arquivar: ' + (err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const toggleNotas = async () => {
    if (!isNotas && boards.length > 0) {
      if (!window.confirm(`"${pageName}" tem ${boards.length} quadro(s) — eles continuam salvos, mas ficam inacessíveis por aqui enquanto a aba for um bloco de notas. Continuar?`)) return
    }
    setBusy(true)
    try {
      await leadPagesService.setIsNotas(pageId, !isNotas)
      toast.success(isNotas ? `"${pageName}" voltou a ser um quadro normal.` : `"${pageName}" virou um bloco de notas.`)
      setOpen(false)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div ref={ref} className="relative">
      <ToolbarButton icon={<MoreHorizontal className="h-3.5 w-3.5" />} onClick={() => setOpen((o) => !o)} title="Gerenciar esta aba">
        Página
      </ToolbarButton>
      {open && (
        <div className="absolute left-0 top-full z-20 mt-1 w-52 rounded-lg border border-line bg-card p-1.5 shadow-xl">
          <button
            type="button"
            onClick={openDuplicate}
            className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs text-foreground/70 hover:bg-elevate/[0.04]"
          >
            <Copy className="h-3.5 w-3.5" />
            Duplicar aba
          </button>
          <button
            type="button"
            onClick={toggleNotas}
            disabled={busy}
            className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs text-foreground/70 hover:bg-elevate/[0.04] disabled:opacity-50"
          >
            <StickyNote className="h-3.5 w-3.5" />
            {isNotas ? 'Voltar a ser quadro normal' : 'Marcar como bloco de notas'}
          </button>
          <button
            type="button"
            onClick={archive}
            disabled={busy}
            className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs text-foreground/70 hover:bg-danger/10 hover:text-danger disabled:opacity-50"
          >
            <Archive className="h-3.5 w-3.5" />
            Arquivar aba
          </button>
        </div>
      )}

      <Modal open={duplicateOpen} onClose={() => setDuplicateOpen(false)} title="Duplicar aba" size="sm">
        <Input
          label="Nome da nova aba"
          value={duplicateName}
          onChange={(e) => setDuplicateName(e.target.value)}
          autoFocus
          onKeyDown={(e) => { if (e.key === 'Enter') void confirmDuplicate() }}
        />
        {boards.length > 0 && (
          <div className="mt-3">
            <div className="mb-1.5 flex items-center justify-between">
              <label className="text-xs font-medium text-foreground/70">Quadros a duplicar</label>
              <button
                type="button"
                onClick={() => setDuplicateBoardIds(
                  duplicateBoardIds.size === boards.length ? new Set() : new Set(boards.map((b) => b.id)),
                )}
                className="text-[11px] font-medium text-accent hover:underline"
              >
                {duplicateBoardIds.size === boards.length ? 'Desmarcar todos' : 'Marcar todos'}
              </button>
            </div>
            <div className="max-h-40 space-y-1 overflow-y-auto rounded-lg border border-line p-2">
              {boards.map((b) => (
                <label key={b.id} className="flex items-center gap-2 rounded-md px-1.5 py-1 text-xs hover:bg-elevate/[0.03]">
                  <input
                    type="checkbox"
                    checked={duplicateBoardIds.has(b.id)}
                    onChange={() => toggleDuplicateBoard(b.id)}
                    className="h-3.5 w-3.5 rounded border-line"
                  />
                  <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: b.color }} />
                  <span className="truncate text-foreground/80">{b.name}</span>
                </label>
              ))}
            </div>
          </div>
        )}
        <p className="mt-2 text-xs text-foreground/45">Copia só a estrutura dos quadros marcados (nome/cor) — sem trazer os leads.</p>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setDuplicateOpen(false)} disabled={busy}>Cancelar</Button>
          <Button onClick={confirmDuplicate} disabled={!duplicateName.trim()} loading={busy}>Duplicar</Button>
        </div>
      </Modal>
    </div>
  )
}

export function SdrFilterButton({ value, onChange }: { value: string | null; onChange: (v: string | null) => void }) {
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
        <div className="absolute left-0 top-full z-20 mt-1 w-48 rounded-lg border border-line bg-card p-1.5 shadow-xl">
          <button
            type="button"
            onClick={() => { onChange(null); setOpen(false) }}
            className={cn(
              'flex w-full items-center rounded-md px-2 py-1.5 text-left text-xs',
              !value ? 'bg-accent/10 font-medium text-accent' : 'text-foreground/70 hover:bg-elevate/[0.04]',
            )}
          >
            Todos
          </button>
          {labels.length === 0 && (
            <p className="px-2 py-1.5 text-xs text-foreground/40">Nenhum SDR cadastrado.</p>
          )}
          {labels.map((l) => (
            <button
              key={l.id}
              type="button"
              onClick={() => { onChange(l.name); setOpen(false) }}
              className={cn(
                'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs',
                l.name === value ? 'bg-accent/10 font-medium text-accent' : 'text-foreground/70 hover:bg-elevate/[0.04]',
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
        danger ? 'text-foreground/50 hover:bg-danger/10 hover:text-danger' : 'text-foreground/50 hover:bg-elevate/[0.08] hover:text-foreground',
      )}
    >
      {icon}
      {label}
    </button>
  )
}

function MoveSubmenu({
  allBoards,
  allPages,
  onMove,
  currentPageId,
  sdrLock,
}: {
  allBoards: LeadBoard[]
  allPages: LeadPage[]
  onMove: (boardId: string) => void
  currentPageId: string
  sdrLock: string | undefined
}) {
  const [aba, setAba] = React.useState<LeadBoardPage | null>(null)

  // Aba travada num SDR só (CRM Luis/Arthur): só pode mover pra dentro da própria aba ou pra
  // Novos Leads — nunca pra outro SDR, Vendas ou Contrato. Sem trava (ex.: Novos Leads), continua
  // podendo mover pra qualquer aba, como sempre foi.
  const movablePages = sdrLock
    ? allPages.filter((p) => p.id === currentPageId || p.name.trim().toLowerCase() === 'novos leads')
    : allPages

  if (!aba) {
    return (
      <>
        {movablePages.map((p) => (
          <button
            key={p.id}
            type="button"
            onClick={() => setAba(p.id)}
            className="flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-xs text-foreground/70 hover:bg-elevate/[0.04]"
          >
            {p.name}
            <ChevronRight className="h-3.5 w-3.5 text-foreground/30" />
          </button>
        ))}
      </>
    )
  }

  const abaLabel = allPages.find((p) => p.id === aba)?.name ?? aba
  const boardsForAba = allBoards.filter((b) => b.page === aba).sort((a, b) => a.position - b.position)
  return (
    <>
      <button
        type="button"
        onClick={() => setAba(null)}
        className="mb-1 flex items-center gap-1 rounded-md px-2 py-1 text-[11px] text-foreground/40 hover:bg-elevate/[0.04] hover:text-foreground/70"
      >
        <ChevronLeft className="h-3 w-3" /> {abaLabel}
      </button>
      {boardsForAba.length === 0 ? (
        <p className="px-2 py-1.5 text-xs text-foreground/40">Nenhum quadro nessa aba ainda.</p>
      ) : (
        boardsForAba.map((b) => (
          <button
            key={b.id}
            type="button"
            onClick={() => onMove(b.id)}
            className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs text-foreground/70 hover:bg-elevate/[0.04]"
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

function BulkEditSubmenu({ onApply, pageId }: { onApply: (field: LeadLabelField, value: string) => void; pageId: string }) {
  const [field, setField] = React.useState<LeadLabelField | null>(null)
  const labels = useLeadLabels(field ?? 'status', pageId)

  if (!field) {
    return (
      <>
        {BULK_EDIT_FIELDS.map((f) => (
          <button
            key={f.key}
            type="button"
            onClick={() => setField(f.key)}
            className="flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-xs text-foreground/70 hover:bg-elevate/[0.04]"
          >
            {f.label}
            <ChevronRight className="h-3.5 w-3.5 text-foreground/30" />
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
        className="mb-1 flex items-center gap-1 rounded-md px-2 py-1 text-[11px] text-foreground/40 hover:bg-elevate/[0.04] hover:text-foreground/70"
      >
        <ChevronLeft className="h-3 w-3" /> {title}
      </button>
      {labels.length === 0 ? (
        <p className="px-2 py-1.5 text-xs text-foreground/40">Nenhuma etiqueta cadastrada.</p>
      ) : (
        labels.map((l) => (
          <button
            key={l.id}
            type="button"
            onClick={() => onApply(field, l.name)}
            className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs text-foreground/70 hover:bg-elevate/[0.04]"
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
  allPages,
  onClear,
  pageId,
  sdrLock,
}: {
  selectedIds: Set<string>
  allRows: LeadRow[]
  allBoards: LeadBoard[]
  allPages: LeadPage[]
  onClear: () => void
  sdrLock: string | undefined
  pageId: string
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
        diaContato: r.diaContato, ligacao: r.ligacao, status: r.status, sdr: r.sdr,
        agendamento: r.agendamento, retornar: r.retornar,
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
      <div className="pointer-events-auto flex items-center gap-1 rounded-full border border-line bg-card px-2 py-1.5 shadow-xl">
        <span className="mr-1 grid h-6 w-6 shrink-0 place-items-center rounded-full bg-accent text-xs font-semibold text-white">
          {selectedRows.length}
        </span>
        <span className="mr-1.5 whitespace-nowrap text-xs font-medium text-foreground/70">
          {selectedRows.length === 1 ? 'Nome selecionado' : 'Nomes selecionados'}
        </span>
        <div className="mx-1 h-6 w-px bg-line" />
        <BulkActionButton icon={<Copy className="h-4 w-4" />} label="Duplicar" onClick={duplicate} />
        <BulkActionButton icon={<Download className="h-4 w-4" />} label="Exportar" onClick={() => exportLeadsCsv(selectedRows)} />
        <div className="relative" ref={editRef}>
          <BulkActionButton icon={<Pencil className="h-4 w-4" />} label="Editar" onClick={() => setEditOpen((o) => !o)} />
          {editOpen && (
            <div className="absolute bottom-full left-1/2 mb-2 w-56 -translate-x-1/2 rounded-lg border border-line bg-card p-1.5 shadow-xl">
              <BulkEditSubmenu onApply={applyBulkEdit} pageId={pageId} />
            </div>
          )}
        </div>
        <div className="relative" ref={moveRef}>
          <BulkActionButton icon={<ArrowRightLeft className="h-4 w-4" />} label="Mover" onClick={() => setMoveOpen((o) => !o)} />
          {moveOpen && (
            <div className="absolute bottom-full left-1/2 mb-2 w-56 -translate-x-1/2 rounded-lg border border-line bg-card p-1.5 shadow-xl">
              <MoveSubmenu allBoards={allBoards} allPages={allPages} onMove={moveTo} currentPageId={pageId} sdrLock={sdrLock} />
            </div>
          )}
        </div>
        <BulkActionButton icon={<Trash2 className="h-4 w-4" />} label="Excluir" onClick={bulkDelete} danger />
        <div className="mx-1 h-6 w-px bg-line" />
        <button
          type="button"
          onClick={onClear}
          title="Limpar seleção"
          className="grid h-7 w-7 shrink-0 place-items-center rounded-full text-foreground/40 hover:bg-elevate/[0.08] hover:text-foreground/70"
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
  sdrLock: string | undefined
  sdrPageBoards: Map<string, LeadBoard[]>
  hideIanMateusCols: boolean
}

function BoardGroup({
  board, allBoards, search, sdrFilter, filterRules, focusRowId, onFocused, onCreateRow, onOpenLead, registerScrollEl,
  selectedIds, onToggleRow, onToggleAll,
  draggingIds, isDragOver, onRowDragStart, onRowDragEnd, onBoardDragOver, onBoardDragLeave, onBoardDrop,
  columnWidths, onResizeColumn, sdrLock, sdrPageBoards, hideIanMateusCols,
}: BoardGroupProps) {
  // Quadro nasce fechado — só mostra os leads quando a pessoa abre de propósito. Exceto em "Novos
  // Leads": ali entra já aberto, sem precisar clicar, pedido específico dessa aba.
  const [open, setOpen] = React.useState(board.page === 'novos_leads')
  // Ordenação é por QUADRO — cada um guarda a própria coluna/direção, ao contrário de antes (um
  // botão só na barra de cima ordenando todos juntos por data). Disparada passando o mouse em
  // QUALQUER coluna, igual o Monday: aparece um ícone de ordenar, sem precisar de botão fixo.
  const [sortBy, setSortBy] = React.useState<{ key: LeadRowField | 'createdAt' | 'position'; desc: boolean }>({ key: 'createdAt', desc: false })
  const toggleSort = (key: LeadRowField | 'createdAt') => {
    setSortBy((prev) => (prev.key === key ? { key, desc: !prev.desc } : { key, desc: false }))
  }
  const cols = columnsForSdrLock(sdrLock, board.isVendas, hideIanMateusCols, board.name)
  const tableWidth = CHECKBOX_COL_WIDTH
    + cols.reduce((sum, c) => sum + columnWidth(c, columnWidths), 0)

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
    return [...filtered].sort((a, b) => {
      const cmp = compareRowsByColumn(a, b, sortBy.key)
      return sortBy.desc ? -cmp : cmp
    })
  }, [allRows, search, sdrFilter, filterRules, sortBy])
  const allSelected = rows.length > 0 && rows.every((r) => selectedIds.has(r.id))
  // Venda desfeita continua no quadro (pra não sumir o histórico) mas fica FORA dos totais —
  // senão o somatório de MRR contaria dinheiro que não entrou.
  const totalRows = React.useMemo(() => rows.filter((r) => !r.vendaRevertida), [rows])
  const totalMrr = React.useMemo(
    () => totalRows.reduce((sum, r) => sum + parseBRLCents(r.valorMrr), 0),
    [totalRows],
  )
  const totalImplementacao = React.useMemo(
    () => totalRows.reduce((sum, r) => sum + parseBRLCents(r.valorImplementacao), 0),
    [totalRows],
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

  /** Reordena manualmente dentro do MESMO quadro (arrastar um lead pra cima/baixo de outro).
   * Só regrava o "position" de quem realmente mudou de lugar entre o ponto de origem e o de
   * destino — não reindexa o quadro inteiro, importante pros quadros com centenas de leads. */
  const reorderRow = (draggedId: string, targetId: string) => {
    const sorted = allRows.slice().sort((a, b) => a.position - b.position)
    const positions = sorted.map((r) => r.position)
    const fromIdx = sorted.findIndex((r) => r.id === draggedId)
    let toIdx = sorted.findIndex((r) => r.id === targetId)
    if (fromIdx === -1 || toIdx === -1) return
    const [moved] = sorted.splice(fromIdx, 1)
    if (toIdx > fromIdx) toIdx -= 1
    sorted.splice(toIdx, 0, moved)
    sorted.forEach((r, i) => {
      if (r.position !== positions[i]) leadBoardsService.updateRow(r.id, { position: positions[i] })
    })
    // Sem isso, o drop pode não parecer ter feito nada — a lista só reflete a nova ordem
    // visualmente quando ordenada por posição (é literalmente a ordem que acabou de ser definida).
    setSortBy({ key: 'position', desc: false })
  }

  return (
    <div
      className={cn(
        'mb-5 overflow-hidden rounded-2xl bg-card shadow-sm transition-all duration-150 hover:shadow-md',
        isDragOver && 'bg-accent/[0.03] shadow-lg ring-2 ring-accent/50',
      )}
      onDragOver={(e) => { e.preventDefault(); onBoardDragOver(board.id) }}
      onDragLeave={onBoardDragLeave}
      onDrop={(e) => { e.preventDefault(); onBoardDrop(board.id) }}
    >
      <div className="border-b border-line bg-card px-3 py-2">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            className="grid h-5 w-5 shrink-0 place-items-center rounded text-foreground/40 transition-colors hover:bg-elevate/[0.05] hover:text-foreground/70"
          >
            <ChevronDown className={cn('h-3.5 w-3.5 transition-transform', open ? '' : '-rotate-90')} />
          </button>
          <span className="h-2 w-2 shrink-0 rounded-full ring-4" style={{ backgroundColor: board.color, boxShadow: `0 0 0 3px ${board.color}1f` }} />
          <BoardNameEditor board={board} />
          <span className="rounded-full bg-elevate/[0.05] px-1.5 py-0.5 text-[11px] font-medium text-foreground/50">{rows.length}</span>
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
            className="grid h-5 w-5 shrink-0 place-items-center rounded text-foreground/40 transition-colors hover:bg-danger/10 hover:text-danger"
          >
            <Trash2 className="h-3 w-3" />
          </button>
        </div>
        {/* Fechado, o quadro vira um "resumo" — mostra o total pra não precisar abrir só pra contar. */}
        {!open && <p className="ml-7 mt-0.5 text-[11px] text-foreground/40">{rows.length} Nome</p>}
      </div>

      {open && (
        <div
          ref={(el) => registerScrollEl(board.id, el)}
          className="overflow-x-hidden"
          style={{ borderLeft: `4px solid ${board.color}` }}
        >
          <table className="border-collapse table-fixed" style={{ width: tableWidth }}>
            <thead>
              <tr className="border-b border-line bg-card text-left text-sm text-foreground">
                <th className={cn('px-2.5 py-2', GRID_BORDER)} style={{ width: CHECKBOX_COL_WIDTH }}>
                  <input
                    type="checkbox"
                    checked={allSelected}
                    onChange={() => onToggleAll(rows.map((r) => r.id), !allSelected)}
                    className="h-3.5 w-3.5 rounded border-line"
                  />
                </th>
                {cols.map((col) => {
                  const width = columnWidth(col, columnWidths)
                  const sortActive = sortBy.key === col.key
                  return (
                    <th
                      key={col.key}
                      className={cn('group relative truncate px-2.5 py-2 text-center font-normal', GRID_BORDER)}
                      style={{ width }}
                    >
                      <span className="inline-flex items-center justify-center gap-1">
                        <span className="truncate">{col.label}</span>
                        {col.required && <span className="text-danger" title="Obrigatório">*</span>}
                        {/* Igual o Monday: passa o mouse em QUALQUER coluna e aparece o ícone de
                            ordenar — cada quadro guarda a própria coluna/direção ativa. A coluna
                            que está ordenando agora fica com o ícone sempre visível (não só no hover). */}
                        <button
                          type="button"
                          onClick={() => toggleSort(col.key)}
                          title={sortActive ? (sortBy.desc ? 'Ordenar crescente' : 'Ordenar decrescente') : 'Ordenar'}
                          className={cn(
                            'grid h-4 w-4 shrink-0 place-items-center rounded transition-opacity hover:bg-elevate/[0.05] hover:text-accent',
                            sortActive ? 'text-accent opacity-100' : 'text-foreground/30 opacity-0 group-hover:opacity-100',
                          )}
                        >
                          <ArrowUpDown className={cn('h-3 w-3 transition-transform', sortActive && sortBy.desc && 'rotate-180')} />
                        </button>
                      </span>
                      {!col.widthLocked && (
                        <span
                          onMouseDown={(e) => startResize(e, col.key, width)}
                          title="Redimensionar coluna"
                          className="absolute right-0 top-0 h-full w-2 cursor-col-resize select-none hover:bg-accent/30 active:bg-accent/40"
                        />
                      )}
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
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => {
                    const draggedId = e.dataTransfer.getData('text/plain')
                    // Se o lead arrastado não é deste quadro, deixa o evento borbulhar pro
                    // onDrop do quadro (comportamento já existente: move de quadro).
                    if (!draggedId || draggedId === row.id || !allRows.some((r) => r.id === draggedId)) return
                    e.preventDefault()
                    e.stopPropagation()
                    reorderRow(draggedId, row.id)
                  }}
                  // Venda desfeita: fica visível (o histórico importa) mas apagada, pra ninguém
                  // ler como negócio fechado ao bater o olho. Já está fora dos totais.
                  title={row.vendaRevertida ? 'Venda revertida — o lead saiu de "Vendido"' : undefined}
                  className={cn(
                    'group border-b border-line transition-colors',
                    draggingIds?.includes(row.id) ? 'opacity-40' : '',
                    row.vendaRevertida ? 'bg-elevate/[0.03] text-foreground/40 line-through decoration-foreground/30' : '',
                    selected ? 'bg-accent/10 hover:bg-accent/15' : 'hover:bg-accent/[0.04]',
                  )}
                >
                  <td className={cn('px-1.5 py-1.5 align-middle', GRID_BORDER)}>
                    <div className="flex items-center gap-0.5">
                      <span
                        draggable
                        onDragStart={(e) => startDrag(e, row.id, row.nome)}
                        onDragEnd={onRowDragEnd}
                        title="Arrastar para reordenar aqui ou mover para outro quadro"
                        className="grid h-5 w-4 shrink-0 cursor-grab place-items-center text-foreground/30 hover:text-foreground/50 active:cursor-grabbing"
                      >
                        <GripVertical className="h-3.5 w-3.5" />
                      </span>
                      <input
                        type="checkbox"
                        checked={selected}
                        onChange={() => onToggleRow(row.id)}
                        className="h-3.5 w-3.5 rounded border-line"
                      />
                    </div>
                  </td>
                  {cols.map((col) => (
                    <td key={col.key} className={cn('p-0 align-middle', GRID_BORDER)}>
                      {col.readOnly ? (
                        <div className={cn('truncate px-2.5 py-1.5 text-sm text-foreground/40', col.align === 'center' && 'text-center')}>
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
                            className="bg-transparent px-2.5 py-1.5 text-sm font-normal text-foreground"
                          />
                          <button
                            type="button"
                            onClick={() => onOpenLead(row.id)}
                            title="Abrir lead"
                            className={cn(
                              'relative mr-1.5 grid h-7 w-7 shrink-0 place-items-center rounded-md transition-colors',
                              row.notesCount > 0 ? 'bg-accent/15 hover:bg-accent/25' : 'hover:bg-elevate/[0.08]',
                            )}
                          >
                            <MessageCircle
                              className={cn('h-4 w-4', row.notesCount > 0 ? 'fill-accent text-accent' : 'text-foreground/30')}
                            />
                            {row.notesCount > 0 && (
                              <span className="absolute -top-1.5 -right-1.5 grid h-4 min-w-[1rem] place-items-center rounded-full bg-accent px-0.5 text-[10px] font-semibold text-white ring-2 ring-white">
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
                          pageId={board.page}
                          onChange={(next) => {
                            if (col.key === 'status') {
                              const target = allBoards.find(
                                (b) => b.id !== row.boardId && b.name.trim().toLowerCase() === next.trim().toLowerCase(),
                              )
                              applyFieldChange(row, target ? { status: next, boardId: target.id } : { status: next })
                            } else if (col.key === 'sdr') {
                              // Marcar o SDR aqui (só existe em abas sem dono, ex.: Novos Leads) já
                              // manda o lead pro quadro de MESMO NOME na aba daquele SDR — não faz
                              // sentido ficar em Novos Leads depois de atribuído.
                              const target = next
                                ? sdrPageBoards.get(next)?.find(
                                    (b) => b.name.trim().toLowerCase() === board.name.trim().toLowerCase(),
                                  )
                                : undefined
                              applyFieldChange(row, target ? { sdr: next, boardId: target.id } : { sdr: next })
                            } else {
                              applyFieldChange(row, { [col.key]: next })
                            }
                          }}
                        />
                      ) : col.currency ? (
                        <CurrencyField
                          value={row[col.key as LeadRowField]}
                          onSave={(next) => leadBoardsService.updateRow(row.id, { [col.key]: next })}
                          className={cn('bg-transparent px-2.5 py-1.5 text-sm text-foreground', col.align === 'center' && 'text-center')}
                        />
                      ) : col.key === 'retornar' ? (
                        <RetornarField
                          value={row.retornar}
                          retornado={row.retornado}
                          onChange={(patch) => applyFieldChange(row, patch)}
                          className="bg-transparent px-2.5 py-1.5 text-sm text-foreground"
                        />
                      ) : col.key === 'agendamento' ? (
                        <AgendamentoField
                          value={row.agendamento}
                          onChange={(next) => leadBoardsService.updateRow(row.id, { agendamento: next })}
                          placeholder={col.required ? 'Obrigatório' : undefined}
                          className={cn(
                            'justify-center px-2.5 py-1.5 text-sm text-foreground',
                            col.required && !row.agendamento
                              ? 'bg-danger/10 ring-1 ring-inset ring-danger/30'
                              : 'bg-transparent',
                          )}
                        />
                      ) : (
                        <EditableField
                          value={row[col.key as LeadRowField]}
                          type={col.type}
                          placeholder={col.required ? 'Obrigatório' : undefined}
                          onSave={(next) => leadBoardsService.updateRow(row.id, { [col.key]: next })}
                          className={cn(
                            'px-2.5 py-1.5 text-sm text-foreground',
                            col.align === 'center' && 'text-center',
                            col.required && !row[col.key as LeadRowField]
                              ? 'bg-danger/10 ring-1 ring-inset ring-danger/30'
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
                <tr className="border-t border-line bg-elevate/[0.03] text-sm font-semibold text-foreground">
                  <td className={GRID_BORDER} style={{ width: CHECKBOX_COL_WIDTH }} />
                  {cols.map((col) => (
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
              <tr className="hover:bg-elevate/[0.04]">
                <td colSpan={cols.length + 1} className="px-2.5 py-2">
                  <button
                    type="button"
                    onClick={() => onCreateRow(board.id)}
                    className="flex items-center gap-1.5 text-xs text-foreground/40 transition-colors hover:text-accent"
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
}

export function LeadBoardsView({ page }: LeadBoardsViewProps) {
  const { profile } = useAuth()
  const isAdmin = canManageUsers(profile?.role)
  const allPages = useLeadPages()
  const currentPage = allPages.find((p) => p.id === page)
  const title = currentPage?.name ?? '...'
  const subtitle = 'Comercial · quadros de captação de leads'
  const sdrLabelsForLock = useLeadLabels('sdr')
  const sdrLock = React.useMemo(() => sdrLockForPageName(title, sdrLabelsForLock), [title, sdrLabelsForLock])
  const hideIanMateusCols = React.useMemo(() => isIanMateusPage(title), [title])

  const booted = useLeadBoardsBooted()
  const allBoards = useLeadBoards()
  const boards = React.useMemo(() => allBoards.filter((b) => b.page === page), [allBoards, page])
  // Quadros de cada aba travada num SDR (CRM Luis/Arthur) — usado só em abas SEM trava (ex.: Novos
  // Leads): quando alguém marca o SDR ali, o lead pula sozinho pro quadro de MESMO NOME na aba
  // daquele SDR (ex.: "Leads Novos" em Novos Leads → "Leads Novos" em CRM Luis).
  const sdrPageBoards = React.useMemo(() => {
    const map = new Map<string, LeadBoard[]>()
    for (const l of sdrLabelsForLock) {
      const targetPage = allPages.find((p) => sdrLockForPageName(p.name, sdrLabelsForLock) === l.name)
      if (targetPage) map.set(l.name, allBoards.filter((b) => b.page === targetPage.id))
    }
    return map
  }, [sdrLabelsForLock, allPages, allBoards])
  const allRows = useAllLeadRows()
  const pageRows = React.useMemo(() => {
    const boardIds = new Set(boards.map((b) => b.id))
    return allRows.filter((r) => boardIds.has(r.boardId))
  }, [allRows, boards])
  const [search, setSearch] = React.useState('')
  const [sdrFilter, setSdrFilter] = React.useState<string | null>(null)
  const [filterRules, setFilterRules] = React.useState<FilterRule[]>([])
  const [filtersOpen, setFiltersOpen] = React.useState(false)
  const [logOpen, setLogOpen] = React.useState(false)
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
      + columnsForSdrLock(sdrLock, false, hideIanMateusCols).reduce((sum, c) => sum + columnWidth(c, columnWidths), 0),
    [columnWidths, sdrLock, hideIanMateusCols],
  )

  // Arrastar um lead perto da borda de cima/baixo da tela rola a página sozinha — sem isso, pra
  // mover um lead pra um quadro fora da área visível era preciso soltar, rolar manualmente e
  // arrastar de novo. Velocidade aumenta quanto mais perto da borda o ponteiro está.
  const scrollDirRef = React.useRef(0)
  React.useEffect(() => {
    if (!draggingIds) return
    const EDGE = 90
    const MAX_SPEED = 22
    const onDragOverWindow = (e: DragEvent) => {
      const y = e.clientY
      if (y < EDGE) {
        scrollDirRef.current = -MAX_SPEED * (1 - y / EDGE)
      } else if (y > window.innerHeight - EDGE) {
        scrollDirRef.current = MAX_SPEED * (1 - (window.innerHeight - y) / EDGE)
      } else {
        scrollDirRef.current = 0
      }
    }
    window.addEventListener('dragover', onDragOverWindow)
    // Girar a rodinha do mouse durante o arrasto — o navegador ignora scroll nativo nesse
    // momento (padrão do drag-and-drop HTML5), então rola manualmente na mesma quantidade.
    const onWheelWindow = (e: WheelEvent) => {
      e.preventDefault()
      window.scrollBy(0, e.deltaY)
    }
    window.addEventListener('wheel', onWheelWindow, { passive: false })
    let raf = 0
    const tick = () => {
      if (scrollDirRef.current !== 0) window.scrollBy(0, scrollDirRef.current)
      raf = window.requestAnimationFrame(tick)
    }
    raf = window.requestAnimationFrame(tick)
    return () => {
      window.removeEventListener('dragover', onDragOverWindow)
      window.removeEventListener('wheel', onWheelWindow)
      window.cancelAnimationFrame(raf)
      scrollDirRef.current = 0
    }
  }, [draggingIds])

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
    // Aba travada num SDR (CRM Luis/Arthur) — lead criado aqui já nasce com o SDR certo, já que a
    // coluna nem aparece pra escolher manualmente. Sem isso, o lead ficava "Sem SDR" nos
    // dashboards (o funil por SDR conta pelo campo, não por em qual aba o lead está).
    const row = leadBoardsService.createRow(boardId, sdrLock ? { sdr: sdrLock } : undefined)
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

  const dashboardRows = React.useMemo(
    () => (sdrLock ? visibleRows.filter((r) => r.sdr === sdrLock) : visibleRows),
    [visibleRows, sdrLock],
  )

  // Pesquisando, só mostra os quadros que TÊM algum resultado — sem isso, a lista inteira de
  // quadros vazios ficava à vista só pra achar o único cliente que bateu com a busca. Sem termo de
  // busca, volta a mostrar todos os quadros normalmente (mesmo que o filtro de SDR/Filtro avançado
  // esteja ativo — isso continua só esvaziando o quadro, não escondendo ele).
  const visibleBoards = React.useMemo(() => {
    if (!search.trim()) return boards
    const matchingBoardIds = new Set(visibleRows.map((r) => r.boardId))
    return boards.filter((b) => matchingBoardIds.has(b.id))
  }, [boards, visibleRows, search])

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
  const VIEW_LABEL: Record<'list' | 'kanban' | 'dashboard', string> = {
    list: 'lista', kanban: 'Kanban', dashboard: sdrLock ? 'Minhas métricas' : 'Dashboard',
  }
  const changeView = (next: 'list' | 'kanban' | 'dashboard') => {
    if (next === view) return
    setView(next)
    toast.success(`Visão em ${VIEW_LABEL[next]} aplicada — fica salva pra você.`)
  }

  return (
    <>
      <TopBar
        title={title}
        subtitle={subtitle}
        titleClassName="text-[30px] font-medium font-['Roboto']"
        breadcrumbs={[
          { label: 'Grupo NX Digital', to: '/' },
          { label: 'Comercial', to: '/comercial' },
          { label: title },
        ]}
      />

      <div className="flex min-h-screen flex-col bg-card px-4 py-4 sm:px-6 sm:py-6 lg:px-8">
        {!booted ? (
          <div className="grid min-h-[30vh] place-items-center text-sm text-foreground/50">
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
                  {isAdmin && <PageActionsMenu pageId={page} pageName={title} boards={boards} />}
                </>
              )}
              <div className="relative">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-foreground/40" />
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Pesquisar"
                  className="h-9 w-44 rounded-md border border-line bg-card pl-9 pr-2 text-sm text-foreground placeholder:text-foreground/40 focus:border-accent/60 focus:outline-none"
                />
              </div>
              <ToolbarButton
                icon={<LayoutDashboard className="h-3.5 w-3.5" />}
                onClick={() => changeView('dashboard')}
                className={view === 'dashboard' ? 'bg-accent/10 text-accent' : undefined}
                title="Ver resumo em relatório — só visualização"
              >
                {sdrLock ? 'Minhas métricas' : 'Dashboard'}
              </ToolbarButton>
              <div className="inline-flex overflow-hidden rounded-lg border border-line">
                <button
                  type="button"
                  onClick={() => changeView('list')}
                  title="Aplicar visão em lista"
                  className={cn(
                    'inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium transition-colors',
                    view === 'list' ? 'bg-accent/10 text-accent' : 'text-foreground/50 hover:bg-elevate/[0.04]',
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
                    view === 'kanban' ? 'bg-accent/10 text-accent' : 'text-foreground/50 hover:bg-elevate/[0.04]',
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
                icon={<ScrollText className="h-3.5 w-3.5" />}
                onClick={() => setLogOpen(true)}
                title="Ver tudo que aconteceu nesta aba"
              >
                Log
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
              <LeadDashboardView rows={dashboardRows} boards={boards} onOpenLead={setOpenLeadId} sdrTabLabel={sdrLock ? 'Minhas métricas' : undefined} onlySdr={!!sdrLock} />
            ) : view === 'kanban' ? (
              <LeadKanbanBoard rows={visibleRows} allBoards={boards} onOpenLead={setOpenLeadId} />
            ) : (
              <>
                <LeadTodayPanel rows={pageRows} boards={boards} onOpenLead={setOpenLeadId} />
                <div className="flex-1">
                  {visibleBoards.map((board) => (
                    <BoardGroup
                      key={board.id}
                      board={board}
                      allBoards={boards}
                      search={search}
                      sdrFilter={sdrFilter}
                      filterRules={filterRules}
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
                      sdrLock={sdrLock}
                      sdrPageBoards={sdrPageBoards}
                      hideIanMateusCols={hideIanMateusCols}
                    />
                  ))}
                  <button
                    type="button"
                    onClick={() => setBoardModalOpen(true)}
                    className="flex h-9 w-full items-center justify-center gap-1.5 rounded-xl border border-dashed border-line text-xs font-medium text-foreground/40 transition-colors hover:border-accent/50 hover:bg-accent/[0.03] hover:text-accent"
                  >
                    <Plus className="h-3.5 w-3.5" />
                    Novo quadro
                  </button>
                  <button
                    type="button"
                    onClick={() => setTrashModalOpen(true)}
                    className="mt-2 flex items-center gap-1 text-[11px] text-foreground/40 transition-colors hover:text-foreground/70"
                  >
                    <Trash2 className="h-3 w-3" />
                    Excluídos
                  </button>
                </div>

                {/* Barra de rolagem horizontal única, flutuante — visível na tela toda,
                    não precisa descer até o fim da página pra arrastar. */}
                <div className="pointer-events-none fixed inset-x-0 bottom-3 z-30 px-4 sm:px-6 lg:px-8 lg:pl-[236px]">
                  <div
                    className="pointer-events-auto overflow-x-auto overflow-y-hidden rounded-full border border-line bg-card shadow-lg"
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
                  allPages={allPages}
                  onClear={() => setSelectedIds(new Set())}
                  pageId={page}
                  sdrLock={sdrLock}
                />
              </>
            )}
          </>
        )}
      </div>

      <CreateBoardModal open={boardModalOpen} onClose={() => setBoardModalOpen(false)} page={page} />
      {importModalOpen && (
        <React.Suspense
          fallback={
            <div className="fixed inset-0 z-50 grid place-items-center bg-black/70 backdrop-blur-sm">
              <Loader2 className="h-6 w-6 animate-spin text-white" />
            </div>
          }
        >
          <LeadImportModal open={importModalOpen} onClose={() => setImportModalOpen(false)} page={page} boards={boards} />
        </React.Suspense>
      )}
      <LeadTrashModal open={trashModalOpen} onClose={() => setTrashModalOpen(false)} boards={boards} />
      <LeadDetailModal leadRowId={openLeadId} onClose={() => setOpenLeadId(null)} />
      <PageActivityLogModal
        open={logOpen}
        onClose={() => setLogOpen(false)}
        page={page}
        onOpenLead={(id) => { setLogOpen(false); setOpenLeadId(id) }}
      />
      <LeadFiltersModal
        open={filtersOpen}
        onClose={() => setFiltersOpen(false)}
        rules={filterRules}
        onChange={setFilterRules}
        visibleCount={visibleCount}
        totalCount={pageRows.length}
        pageId={page}
      />
    </>
  )
}
