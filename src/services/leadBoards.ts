import { toast } from 'sonner'
import { api, onSseEvent } from '@/services/api'
import type { LeadBoard, LeadBoardPage, LeadRow } from '@/types/leadBoard'

function uuid(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  const bytes = new Uint8Array(16)
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    crypto.getRandomValues(bytes)
  } else {
    for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256)
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x40
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

// ---------- Snake ↔ camel ----------

type BoardRow = { id: string; name: string; color: string; page: LeadBoardPage; position: number; created_at: string }
function rowToBoard(r: BoardRow): LeadBoard {
  return { id: r.id, name: r.name, color: r.color, page: r.page, position: r.position, createdAt: r.created_at }
}
function boardToRow(patch: Partial<LeadBoard>): Record<string, unknown> {
  const row: Record<string, unknown> = {}
  if ('name' in patch) row.name = patch.name
  if ('color' in patch) row.color = patch.color
  if ('page' in patch) row.page = patch.page
  if ('position' in patch) row.position = patch.position
  return row
}

type LeadRowRow = {
  id: string; board_id: string; nome: string; tipo: string; empresa: string; telefone: string
  dia_contato: string; status: string; retornar: string; retornado: boolean; responsavel: string
  sdr: string; numero: string; dor_cliente: string; numero_atendentes: string; valor_mrr: string
  valor_implementacao: string; notes_count: number; position: number; created_at: string; updated_at: string
}
function rowToLead(r: LeadRowRow): LeadRow {
  return {
    id: r.id, boardId: r.board_id, nome: r.nome, tipo: r.tipo, empresa: r.empresa,
    telefone: r.telefone, diaContato: r.dia_contato, status: r.status, retornar: r.retornar,
    retornado: r.retornado ?? false,
    responsavel: r.responsavel, sdr: r.sdr, numero: r.numero,
    dorCliente: r.dor_cliente, numeroAtendentes: r.numero_atendentes,
    valorMrr: r.valor_mrr, valorImplementacao: r.valor_implementacao, notesCount: r.notes_count ?? 0,
    position: r.position, createdAt: r.created_at, updatedAt: r.updated_at,
  }
}
function leadToRow(patch: Partial<LeadRow>): Record<string, unknown> {
  const row: Record<string, unknown> = {}
  if ('nome' in patch) row.nome = patch.nome
  if ('tipo' in patch) row.tipo = patch.tipo
  if ('empresa' in patch) row.empresa = patch.empresa
  if ('telefone' in patch) row.telefone = patch.telefone
  if ('diaContato' in patch) row.dia_contato = patch.diaContato
  if ('status' in patch) row.status = patch.status
  if ('retornar' in patch) row.retornar = patch.retornar
  if ('retornado' in patch) row.retornado = patch.retornado
  if ('responsavel' in patch) row.responsavel = patch.responsavel
  if ('sdr' in patch) row.sdr = patch.sdr
  if ('numero' in patch) row.numero = patch.numero
  if ('dorCliente' in patch) row.dor_cliente = patch.dorCliente
  if ('numeroAtendentes' in patch) row.numero_atendentes = patch.numeroAtendentes
  if ('valorMrr' in patch) row.valor_mrr = patch.valorMrr
  if ('valorImplementacao' in patch) row.valor_implementacao = patch.valorImplementacao
  if ('boardId' in patch) row.board_id = patch.boardId
  if ('position' in patch) row.position = patch.position
  return row
}

// ---------- Cache ----------

let boards: LeadBoard[] = []
let rows: LeadRow[] = []

const subs = new Set<() => void>()
function notify() { for (const fn of subs) fn() }

let booted = false
let bootingPromise: Promise<void> | null = null
let unsubSse: (() => void) | null = null

export function isLeadBoardsBooted(): boolean { return booted }

export async function bootLeadBoards(): Promise<void> {
  if (bootingPromise) return bootingPromise
  bootingPromise = (async () => {
    try {
      const [boardsRes, rowsRes] = await Promise.allSettled([
        api.get<BoardRow[]>('/api/lead-boards'),
        api.get<LeadRowRow[]>('/api/lead-rows'),
      ])
      if (boardsRes.status === 'fulfilled') {
        boards = boardsRes.value.map(rowToBoard).sort((a, b) => a.position - b.position)
      }
      if (rowsRes.status === 'fulfilled') rows = rowsRes.value.map(rowToLead)

      subscribeRealtime()
      booted = true
      notify()
    } catch (err) {
      console.error('[leadBoards] boot crash', err)
    }
  })()
  return bootingPromise
}

export async function teardownLeadBoards(): Promise<void> {
  unsubSse?.(); unsubSse = null
  boards = []; rows = []
  booted = false; bootingPromise = null
  notify()
}

async function reloadBoards() {
  try {
    const fresh = await api.get<BoardRow[]>('/api/lead-boards')
    boards = fresh.map(rowToBoard).sort((a, b) => a.position - b.position)
    notify()
  } catch { /* silent — próxima mudança real corrige o cache */ }
}

async function reloadRows() {
  try {
    const fresh = await api.get<LeadRowRow[]>('/api/lead-rows')
    rows = fresh.map(rowToLead)
    notify()
  } catch { /* silent — próxima mudança real corrige o cache */ }
}

function subscribeRealtime() {
  if (unsubSse) return
  unsubSse = onSseEvent((table, type, data) => {
    if (table === 'lead_boards') {
      if (type === 'DELETE') {
        const id = (data as { id?: string }).id
        if (id) boards = boards.filter((b) => b.id !== id)
        notify()
        return
      }
      // Payload grande demais chega truncado só com {id} — recarrega a lista
      // inteira em vez de gravar um quadro incompleto no cache.
      const row = data as Partial<BoardRow>
      if (typeof row.name !== 'string') { void reloadBoards(); return }
      const next = rowToBoard(row as BoardRow)
      const idx = boards.findIndex((b) => b.id === next.id)
      if (idx === -1) boards = [...boards, next]
      else { const copy = boards.slice(); copy[idx] = next; boards = copy }
      boards = boards.slice().sort((a, b) => a.position - b.position)
      notify()
    } else if (table === 'lead_rows') {
      if (type === 'DELETE') {
        const id = (data as { id?: string }).id
        if (id) rows = rows.filter((r) => r.id !== id)
        notify()
        return
      }
      const row = data as Partial<LeadRowRow>
      if (typeof row.nome !== 'string') { void reloadRows(); return }
      const next = rowToLead(row as LeadRowRow)
      const idx = rows.findIndex((r) => r.id === next.id)
      if (idx === -1) rows = [...rows, next]
      else { const copy = rows.slice(); copy[idx] = next; rows = copy }
      notify()
    }
  })
}

// ---------- Public API ----------

export const leadBoardsService = {
  subscribe(fn: () => void): () => void { subs.add(fn); return () => { subs.delete(fn) } },

  getBoards(): LeadBoard[] { return boards },
  getRows(): LeadRow[] { return rows },
  getRowsByBoard(boardId: string): LeadRow[] {
    return rows.filter((r) => r.boardId === boardId).sort((a, b) => a.position - b.position)
  },

  createBoard(name: string, color = '#4F8EF7', page: LeadBoardPage = 'novos_leads'): LeadBoard {
    const pageBoards = boards.filter((b) => b.page === page)
    const position = pageBoards.length ? Math.max(...pageBoards.map((b) => b.position)) + 1 : 0
    const board: LeadBoard = { id: uuid(), name, color, page, position, createdAt: new Date().toISOString() }
    boards = [...boards, board].sort((a, b) => a.position - b.position)
    notify()

    void (async () => {
      try {
        await api.post('/api/lead-boards', { id: board.id, name: board.name, color: board.color, page: board.page, position: board.position })
      } catch (err) {
        boards = boards.filter((b) => b.id !== board.id)
        notify()
        toast.error('Falha ao criar quadro: ' + (err as Error).message)
      }
    })()

    return board
  },

  updateBoard(id: string, patch: Partial<LeadBoard>): void {
    const idx = boards.findIndex((b) => b.id === id)
    if (idx === -1) return
    const prev = boards[idx]
    const next = { ...prev, ...patch }
    const copy = boards.slice(); copy[idx] = next
    boards = copy.sort((a, b) => a.position - b.position)
    notify()

    void (async () => {
      try {
        await api.patch(`/api/lead-boards/${id}`, boardToRow(patch))
      } catch (err) {
        const rollback = boards.slice()
        const ridx = rollback.findIndex((b) => b.id === id)
        if (ridx !== -1) rollback[ridx] = prev
        boards = rollback
        notify()
        toast.error('Falha ao salvar quadro: ' + (err as Error).message)
      }
    })()
  },

  async deleteBoard(id: string): Promise<void> {
    const prevBoards = boards
    const prevRows = rows
    boards = boards.filter((b) => b.id !== id)
    rows = rows.filter((r) => r.boardId !== id)
    notify()

    try {
      await api.delete(`/api/lead-boards/${id}`)
    } catch (err) {
      boards = prevBoards
      rows = prevRows
      notify()
      toast.error('Falha ao excluir quadro: ' + (err as Error).message)
    }
  },

  createRow(boardId: string, initial?: Partial<LeadRow>): LeadRow {
    const boardRows = rows.filter((r) => r.boardId === boardId)
    const position = boardRows.length ? Math.max(...boardRows.map((r) => r.position)) + 1 : 0
    const now = new Date().toISOString()
    const row: LeadRow = {
      id: uuid(), boardId, nome: '', tipo: '', empresa: '', telefone: '', diaContato: '',
      status: '', retornar: '', retornado: false, responsavel: '', sdr: '', numero: '',
      dorCliente: '', numeroAtendentes: '', valorMrr: '', valorImplementacao: '', notesCount: 0,
      position, createdAt: now, updatedAt: now, ...initial,
    }
    rows = [...rows, row]
    notify()

    void (async () => {
      try {
        await api.post('/api/lead-rows', { id: row.id, board_id: boardId, position, ...leadToRow(row) })
      } catch (err) {
        rows = rows.filter((r) => r.id !== row.id)
        notify()
        toast.error('Falha ao criar lead: ' + (err as Error).message)
      }
    })()

    return row
  },

  /** Ajuste local do contador de anotações — sem chamada à API (o trigger do banco já persiste). */
  bumpNotesCount(rowId: string, delta: number): void {
    const idx = rows.findIndex((r) => r.id === rowId)
    if (idx === -1) return
    const copy = rows.slice()
    copy[idx] = { ...copy[idx], notesCount: Math.max(0, copy[idx].notesCount + delta) }
    rows = copy
    notify()
  },

  updateRow(id: string, patch: Partial<LeadRow>): void {
    const idx = rows.findIndex((r) => r.id === id)
    if (idx === -1) return
    const prev = rows[idx]
    const next = { ...prev, ...patch, updatedAt: new Date().toISOString() }
    const copy = rows.slice(); copy[idx] = next; rows = copy
    notify()

    void (async () => {
      try {
        await api.patch(`/api/lead-rows/${id}`, leadToRow(patch))
      } catch (err) {
        const rollback = rows.slice()
        const ridx = rollback.findIndex((r) => r.id === id)
        if (ridx !== -1) rollback[ridx] = prev
        rows = rollback
        notify()
        toast.error('Falha ao salvar: ' + (err as Error).message)
      }
    })()
  },

  async deleteRow(id: string): Promise<void> {
    const prev = rows
    rows = rows.filter((r) => r.id !== id)
    notify()

    try {
      await api.delete(`/api/lead-rows/${id}`)
    } catch (err) {
      rows = prev
      notify()
      toast.error('Falha ao remover lead: ' + (err as Error).message)
    }
  },
}
