import { toast } from 'sonner'
import { api, onSseEvent } from '@/services/api'

export type CommissionRole = 'sdr' | 'suporte'
export type CommissionKind = 'fixed' | 'percent'
export type CommissionStatus = 'pendente' | 'pago'

export interface CommissionType {
  id: string
  role: CommissionRole
  label: string
  kind: CommissionKind
  rateCents: number | null
  ratePercent: number | null
  position: number
  archived: boolean
}

export interface CommissionEntry {
  id: string
  /** Nome do cliente/venda — o mesmo nome que aparece na aba Vendas. */
  nome: string
  person: string
  role: CommissionRole
  typeId: string | null
  typeLabel: string
  reference: string
  baseValueCents: number | null
  amountCents: number
  month: string
  status: CommissionStatus
  createdAt: string
}

type TypeRow = {
  id: string; role: CommissionRole; label: string; kind: CommissionKind
  rate_cents: number | null; rate_percent: string | null; position: number; archived: boolean
}
type EntryRow = {
  id: string; nome: string; person: string; role: CommissionRole; type_id: string | null; type_label: string
  reference: string; base_value_cents: number | null; amount_cents: number; month: string
  status: CommissionStatus; created_at: string
}

function rowToType(r: TypeRow): CommissionType {
  return {
    id: r.id, role: r.role, label: r.label, kind: r.kind,
    rateCents: r.rate_cents ?? null, ratePercent: r.rate_percent !== null ? Number(r.rate_percent) : null,
    position: r.position, archived: r.archived,
  }
}
function rowToEntry(r: EntryRow): CommissionEntry {
  return {
    id: r.id, nome: r.nome ?? '', person: r.person, role: r.role, typeId: r.type_id, typeLabel: r.type_label,
    reference: r.reference ?? '', baseValueCents: r.base_value_cents ?? null, amountCents: r.amount_cents,
    month: r.month, status: r.status, createdAt: r.created_at,
  }
}

let types: CommissionType[] = []
let entries: CommissionEntry[] = []
let loaded = false
let loadingPromise: Promise<void> | null = null

const subs = new Set<() => void>()
function notify() { for (const fn of subs) fn() }

let unsubSse: (() => void) | null = null
function ensureRealtime() {
  if (unsubSse) return
  unsubSse = onSseEvent((table) => {
    if (table !== 'commission_types' && table !== 'commission_entries') return
    void reload()
  })
}

async function reload(): Promise<void> {
  try {
    const [typeRows, entryRows] = await Promise.all([
      api.get<TypeRow[]>('/api/commission-types'),
      api.get<EntryRow[]>('/api/commission-entries'),
    ])
    types = typeRows.map(rowToType)
    entries = entryRows.map(rowToEntry)
    loaded = true
    notify()
  } catch (err) {
    toast.error('Falha ao carregar comissões: ' + (err as Error).message)
  }
}

export function isCommissionsLoaded(): boolean { return loaded }

export const commissionsService = {
  subscribe(fn: () => void): () => void { subs.add(fn); return () => { subs.delete(fn) } },

  getTypes(): CommissionType[] { return types },
  getEntries(): CommissionEntry[] { return entries },

  async ensureLoaded(): Promise<void> {
    ensureRealtime()
    if (loaded) return
    if (loadingPromise) return loadingPromise
    loadingPromise = reload().finally(() => { loadingPromise = null })
    return loadingPromise
  },

  async createType(input: {
    role: CommissionRole; label: string; kind: CommissionKind; rateCents?: number | null; ratePercent?: number | null
  }): Promise<void> {
    try {
      await api.post('/api/commission-types', input)
      await reload()
    } catch (err) {
      toast.error('Falha ao criar tipo de comissão: ' + (err as Error).message)
    }
  },

  async updateType(id: string, patch: {
    label?: string; kind?: CommissionKind; rateCents?: number | null; ratePercent?: number | null; archived?: boolean
  }): Promise<void> {
    try {
      await api.patch(`/api/commission-types/${id}`, patch)
      await reload()
    } catch (err) {
      toast.error('Falha ao salvar tipo de comissão: ' + (err as Error).message)
    }
  },

  async createEntry(input: {
    nome?: string; person: string; role: CommissionRole; typeId: string | null; typeLabel: string
    reference?: string; baseValueCents?: number | null; amountCents: number; month: string
  }): Promise<void> {
    try {
      await api.post('/api/commission-entries', input)
      await reload()
    } catch (err) {
      toast.error('Falha ao registrar comissão: ' + (err as Error).message)
    }
  },

  async setEntryStatus(id: string, status: CommissionStatus): Promise<void> {
    return commissionsService.updateEntry(id, { status })
  },

  async updateEntry(id: string, patch: {
    status?: CommissionStatus; amountCents?: number; reference?: string; nome?: string
    typeId?: string | null; typeLabel?: string; baseValueCents?: number | null
  }): Promise<void> {
    try {
      const row = await api.patch<EntryRow>(`/api/commission-entries/${id}`, patch)
      const full = rowToEntry(row)
      const idx = entries.findIndex((e) => e.id === id)
      if (idx !== -1) { const copy = entries.slice(); copy[idx] = full; entries = copy; notify() }
    } catch (err) {
      toast.error('Falha ao salvar lançamento: ' + (err as Error).message)
    }
  },

  async deleteEntry(id: string): Promise<void> {
    try {
      await api.delete(`/api/commission-entries/${id}`)
      entries = entries.filter((e) => e.id !== id)
      notify()
    } catch (err) {
      toast.error('Falha ao excluir lançamento: ' + (err as Error).message)
    }
  },
}
