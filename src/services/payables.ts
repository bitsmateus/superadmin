import { toast } from 'sonner'
import { api, onSseEvent } from '@/services/api'

export type PayableStatus = 'a_pagar' | 'agendado' | 'pago'

export interface PayableGroup {
  id: string
  name: string
  color: string
  position: number
  createdAt: string
}

export interface PayableEntry {
  id: string
  groupId: string
  elemento: string
  previstoCents: number
  comissaoCents: number | null
  realCents: number | null
  status: PayableStatus
  data: string | null
  /** Só vem preenchido depois de loadFullEntry — a lista omite (pode ser um PDF grande). */
  boletoData?: string | null
  boletoFilename: string | null
  notas: string
  position: number
  createdAt: string
}

type GroupRow = { id: string; name: string; color: string; position: number; created_at: string }
type EntryRow = {
  id: string; group_id: string; elemento: string; previsto_cents: number
  comissao_cents: number | null; real_cents: number | null; status: PayableStatus; data: string | null
  boleto_data?: string | null; boleto_filename: string | null; notas: string; position: number; created_at: string
}

function rowToGroup(r: GroupRow): PayableGroup {
  return { id: r.id, name: r.name, color: r.color, position: r.position, createdAt: r.created_at }
}
function rowToEntry(r: EntryRow, prevBoletoData?: string | null): PayableEntry {
  return {
    id: r.id, groupId: r.group_id, elemento: r.elemento, previstoCents: r.previsto_cents,
    comissaoCents: r.comissao_cents ?? null, realCents: r.real_cents ?? null, status: r.status,
    data: r.data, boletoData: 'boleto_data' in r ? (r.boleto_data ?? null) : (prevBoletoData ?? null),
    boletoFilename: r.boleto_filename, notas: r.notas ?? '', position: r.position, createdAt: r.created_at,
  }
}

let groups: PayableGroup[] = []
let entries: PayableEntry[] = []
let loaded = false
let loadingPromise: Promise<void> | null = null

const subs = new Set<() => void>()
function notify() { for (const fn of subs) fn() }

let unsubSse: (() => void) | null = null
function ensureRealtime() {
  if (unsubSse) return
  unsubSse = onSseEvent((table) => {
    if (table !== 'payables_groups' && table !== 'payables_entries') return
    void reload()
  })
}

async function reload(): Promise<void> {
  try {
    const [groupRows, entryRows] = await Promise.all([
      api.get<GroupRow[]>('/api/payables-groups'),
      api.get<EntryRow[]>('/api/payables-entries'),
    ])
    groups = groupRows.map(rowToGroup)
    const prevById = new Map(entries.map((e) => [e.id, e]))
    entries = entryRows.map((r) => rowToEntry(r, prevById.get(r.id)?.boletoData))
    loaded = true
    notify()
  } catch (err) {
    toast.error('Falha ao carregar contas a pagar: ' + (err as Error).message)
  }
}

export function isPayablesLoaded(): boolean { return loaded }

export const payablesService = {
  subscribe(fn: () => void): () => void { subs.add(fn); return () => { subs.delete(fn) } },

  getGroups(): PayableGroup[] { return groups },
  getEntries(): PayableEntry[] { return entries },

  async ensureLoaded(): Promise<void> {
    ensureRealtime()
    if (loaded) return
    if (loadingPromise) return loadingPromise
    loadingPromise = reload().finally(() => { loadingPromise = null })
    return loadingPromise
  },

  /** Busca um item completo (com boletoData) — a lista omite esse campo por ser pesado. */
  async loadFullEntry(id: string): Promise<void> {
    try {
      const row = await api.get<EntryRow>(`/api/payables-entries/${id}`)
      const full = rowToEntry(row)
      const idx = entries.findIndex((e) => e.id === id)
      if (idx !== -1) { const copy = entries.slice(); copy[idx] = full; entries = copy; notify() }
    } catch (err) {
      toast.error('Falha ao carregar o boleto: ' + (err as Error).message)
    }
  },

  async createGroup(input: { name: string; color?: string }): Promise<void> {
    try {
      await api.post('/api/payables-groups', input)
      await reload()
    } catch (err) {
      toast.error('Falha ao criar grupo: ' + (err as Error).message)
    }
  },

  async updateGroup(id: string, patch: { name?: string; color?: string; position?: number }): Promise<void> {
    try {
      await api.patch(`/api/payables-groups/${id}`, patch)
      await reload()
    } catch (err) {
      toast.error('Falha ao salvar grupo: ' + (err as Error).message)
    }
  },

  async deleteGroup(id: string): Promise<void> {
    try {
      await api.delete(`/api/payables-groups/${id}`)
      groups = groups.filter((g) => g.id !== id)
      entries = entries.filter((e) => e.groupId !== id)
      notify()
    } catch (err) {
      toast.error('Falha ao excluir grupo: ' + (err as Error).message)
    }
  },

  async createEntry(input: {
    groupId: string; elemento: string; previstoCents?: number; comissaoCents?: number | null
    realCents?: number | null; status?: PayableStatus; data?: string | null; notas?: string
  }): Promise<void> {
    try {
      await api.post('/api/payables-entries', input)
      await reload()
    } catch (err) {
      toast.error('Falha ao criar item: ' + (err as Error).message)
    }
  },

  async updateEntry(id: string, patch: {
    groupId?: string; elemento?: string; previstoCents?: number; comissaoCents?: number | null
    realCents?: number | null; status?: PayableStatus; data?: string | null
    boletoData?: string | null; boletoFilename?: string | null; notas?: string; position?: number
  }): Promise<void> {
    try {
      const row = await api.patch<EntryRow>(`/api/payables-entries/${id}`, patch)
      const full = rowToEntry(row)
      const idx = entries.findIndex((e) => e.id === id)
      if (idx !== -1) { const copy = entries.slice(); copy[idx] = full; entries = copy; notify() }
    } catch (err) {
      toast.error('Falha ao salvar item: ' + (err as Error).message)
    }
  },

  async deleteEntry(id: string): Promise<void> {
    try {
      await api.delete(`/api/payables-entries/${id}`)
      entries = entries.filter((e) => e.id !== id)
      notify()
    } catch (err) {
      toast.error('Falha ao excluir item: ' + (err as Error).message)
    }
  },
}
