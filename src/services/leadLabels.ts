import { toast } from 'sonner'
import { api, onSseEvent } from '@/services/api'
import type { LeadLabel, LeadLabelField } from '@/types/leadBoard'

type LabelRow = { id: string; field: string; name: string; color: string; position: number; created_at: string }
function rowToLabel(r: LabelRow): LeadLabel {
  const field: LeadLabelField = r.field === 'dia_contato' ? 'diaContato' : (r.field as LeadLabelField)
  return {
    id: r.id, field,
    name: r.name, color: r.color, position: r.position, createdAt: r.created_at,
  }
}
function fieldToColumn(field: LeadLabelField): string {
  return field === 'diaContato' ? 'dia_contato' : field
}

// ---------- Cache ----------

let labels: LeadLabel[] = []
let loaded = false
let loadingPromise: Promise<void> | null = null

const subs = new Set<() => void>()
function notify() { for (const fn of subs) fn() }

let unsubSse: (() => void) | null = null
function ensureRealtime() {
  if (unsubSse) return
  unsubSse = onSseEvent((table, type, data) => {
    if (table !== 'lead_labels') return
    if (type === 'DELETE') {
      const id = (data as { id?: string }).id
      if (id) labels = labels.filter((l) => l.id !== id)
      notify()
      return
    }
    const row = data as Partial<LabelRow>
    if (typeof row.name !== 'string') return
    const next = rowToLabel(row as LabelRow)
    const idx = labels.findIndex((l) => l.id === next.id)
    if (idx === -1) labels = [...labels, next]
    else { const copy = labels.slice(); copy[idx] = next; labels = copy }
    notify()
  })
}

export const leadLabelsService = {
  subscribe(fn: () => void): () => void { subs.add(fn); return () => { subs.delete(fn) } },

  /** Referência crua do cache — filtrar/ordenar por campo fica por conta do hook (useMemo). */
  getAllLabels(): LeadLabel[] { return labels },

  async ensureLoaded(): Promise<void> {
    if (loaded) return
    if (loadingPromise) return loadingPromise
    ensureRealtime()
    loadingPromise = (async () => {
      try {
        const rows = await api.get<LabelRow[]>('/api/lead-labels')
        labels = rows.map(rowToLabel)
        loaded = true
        notify()
      } catch (err) {
        toast.error('Falha ao carregar etiquetas: ' + (err as Error).message)
      }
    })()
    return loadingPromise
  },

  async createLabel(field: LeadLabelField, name: string, color: string): Promise<void> {
    const trimmed = name.trim()
    if (!trimmed) return
    try {
      const row = await api.post<LabelRow>('/api/lead-labels', { field: fieldToColumn(field), name: trimmed, color })
      labels = [...labels, rowToLabel(row)]
      notify()
    } catch (err) {
      toast.error('Falha ao criar etiqueta: ' + (err as Error).message)
    }
  },

  updateLabel(id: string, patch: Partial<Pick<LeadLabel, 'name' | 'color'>>): void {
    const idx = labels.findIndex((l) => l.id === id)
    if (idx === -1) return
    const prev = labels[idx]
    const next = { ...prev, ...patch }
    const copy = labels.slice(); copy[idx] = next; labels = copy
    notify()

    void (async () => {
      try {
        await api.patch(`/api/lead-labels/${id}`, patch)
      } catch (err) {
        const rollback = labels.slice()
        const ridx = rollback.findIndex((l) => l.id === id)
        if (ridx !== -1) rollback[ridx] = prev
        labels = rollback
        notify()
        toast.error('Falha ao salvar etiqueta: ' + (err as Error).message)
      }
    })()
  },

  async deleteLabel(id: string): Promise<void> {
    const prev = labels
    labels = labels.filter((l) => l.id !== id)
    notify()
    try {
      await api.delete(`/api/lead-labels/${id}`)
    } catch (err) {
      labels = prev
      notify()
      toast.error('Falha ao remover etiqueta: ' + (err as Error).message)
    }
  },
}
