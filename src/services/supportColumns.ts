import { toast } from 'sonner'
import { api, onSseEvent } from '@/services/api'
import { ticketsService } from '@/services/tickets'
import { FALLBACK_COLUMNS, type SupportColumn } from '@/types/supportColumn'

type ColumnRow = {
  id: string
  key: string
  name: string
  color: string
  position: number
  is_done: boolean
  created_at: string
}

function rowToColumn(r: ColumnRow): SupportColumn {
  return {
    id: r.id,
    key: r.key,
    name: r.name,
    color: r.color,
    position: r.position,
    isDone: Boolean(r.is_done),
    createdAt: r.created_at,
  }
}

const byPosition = (a: SupportColumn, b: SupportColumn) =>
  a.position - b.position || a.createdAt.localeCompare(b.createdAt)

// ---------- Cache ----------

let columns: SupportColumn[] = FALLBACK_COLUMNS
let loaded = false
let loadingPromise: Promise<void> | null = null

const subs = new Set<() => void>()
function notify() {
  for (const fn of subs) fn()
}

let unsubSse: (() => void) | null = null
function ensureRealtime() {
  if (unsubSse) return
  unsubSse = onSseEvent((table, type, data) => {
    if (table !== 'support_columns') return
    if (type === 'DELETE') {
      const id = (data as { id?: string }).id
      if (id) columns = columns.filter((c) => c.id !== id)
      notify()
      return
    }
    const row = data as Partial<ColumnRow>
    if (typeof row.key !== 'string' || typeof row.name !== 'string') return
    const next = rowToColumn(row as ColumnRow)
    const idx = columns.findIndex((c) => c.id === next.id)
    columns =
      idx === -1
        ? [...columns, next].sort(byPosition)
        : columns.map((c) => (c.id === next.id ? next : c)).sort(byPosition)
    notify()
  })
}

export const supportColumnsService = {
  subscribe(fn: () => void): () => void {
    subs.add(fn)
    return () => {
      subs.delete(fn)
    }
  },

  getColumns(): SupportColumn[] {
    return columns
  },

  async ensureLoaded(): Promise<void> {
    if (loaded) return
    if (loadingPromise) return loadingPromise
    ensureRealtime()
    loadingPromise = (async () => {
      try {
        const rows = await api.get<ColumnRow[]>('/api/support-columns')
        // Banco sem migração ainda? Mantém o fallback em vez de zerar o quadro.
        if (rows.length > 0) columns = rows.map(rowToColumn).sort(byPosition)
        loaded = true
        notify()
      } catch (err) {
        toast.error('Falha ao carregar as colunas do quadro: ' + (err as Error).message)
      } finally {
        loadingPromise = null
      }
    })()
    return loadingPromise
  },

  async createColumn(name: string): Promise<void> {
    const trimmed = name.trim()
    if (!trimmed) return
    try {
      const row = await api.post<ColumnRow>('/api/support-columns', { name: trimmed })
      columns = [...columns, rowToColumn(row)].sort(byPosition)
      notify()
    } catch (err) {
      toast.error('Falha ao criar coluna: ' + (err as Error).message)
    }
  },

  /** Renomear/recolorir — otimista, com rollback se o backend recusar. */
  updateColumn(id: string, patch: Partial<Pick<SupportColumn, 'name' | 'color'>>): void {
    const prev = columns
    const trimmed = patch.name?.trim()
    if (patch.name !== undefined && !trimmed) return
    const applied = { ...patch, ...(trimmed ? { name: trimmed } : {}) }
    columns = columns.map((c) => (c.id === id ? { ...c, ...applied } : c))
    notify()

    void (async () => {
      try {
        await api.patch(`/api/support-columns/${id}`, applied)
      } catch (err) {
        columns = prev
        notify()
        toast.error('Falha ao salvar coluna: ' + (err as Error).message)
      }
    })()
  },

  /** Troca a coluna de lugar com a vizinha (dir -1 = esquerda, 1 = direita). */
  async moveColumn(id: string, dir: -1 | 1): Promise<void> {
    const ordered = [...columns].sort(byPosition)
    const idx = ordered.findIndex((c) => c.id === id)
    const other = ordered[idx + dir]
    if (idx === -1 || !other) return
    const current = ordered[idx]

    const prev = columns
    ordered[idx] = other
    ordered[idx + dir] = current
    columns = ordered.map((c, i) => ({ ...c, position: i + 1 }))
    notify()

    try {
      await Promise.all(
        columns.map((c) => api.patch(`/api/support-columns/${c.id}`, { position: c.position })),
      )
    } catch (err) {
      columns = prev
      notify()
      toast.error('Falha ao reordenar: ' + (err as Error).message)
    }
  },

  /** Remove a coluna; o backend move as tarefas dela para a primeira restante. */
  async deleteColumn(id: string): Promise<void> {
    const prev = columns
    columns = columns.filter((c) => c.id !== id)
    notify()
    try {
      await api.delete(`/api/support-columns/${id}`)
      // O backend realocou as tarefas da coluna apagada — recarrega pra que os
      // cartões apareçam já na coluna de destino.
      await ticketsService.refreshReminders()
    } catch (err) {
      columns = prev
      notify()
      toast.error('Falha ao remover coluna: ' + (err as Error).message)
    }
  },
}
