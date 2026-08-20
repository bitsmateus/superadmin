import { toast } from 'sonner'
import { api, onSseEvent } from '@/services/api'

/** Quando o "Dia de contato" de um lead foi alterado pela última vez (ou criado, se nunca
 * mudou) — usado pra sinalizar quem está parado há mais de 24h sem o SDR mexer. */
export interface LeadActivity {
  id: string
  boardId: string
  diaContatoUpdatedAt: string
}

type Row = { id: string; board_id: string; dia_contato_updated_at: string }

let activity: LeadActivity[] = []
let loaded = false
let loadingPromise: Promise<void> | null = null

const subs = new Set<() => void>()
function notify() { for (const fn of subs) fn() }

let unsubSse: (() => void) | null = null
let refetchTimer: ReturnType<typeof setTimeout> | null = null
function ensureRealtime() {
  if (unsubSse) return
  unsubSse = onSseEvent((table, type, data) => {
    if (table !== 'lead_events' || type !== 'INSERT') return
    const row = data as { type?: string }
    if (row.type !== 'dia_contato') return
    if (refetchTimer) clearTimeout(refetchTimer)
    refetchTimer = setTimeout(() => { void leadActivityService.reload() }, 400)
  })
}

export const leadActivityService = {
  subscribe(fn: () => void): () => void { subs.add(fn); return () => { subs.delete(fn) } },

  getAll(): LeadActivity[] { return activity },

  async ensureLoaded(): Promise<void> {
    ensureRealtime()
    if (loaded) return
    if (loadingPromise) return loadingPromise
    loadingPromise = leadActivityService.reload().finally(() => { loadingPromise = null })
    return loadingPromise
  },

  async reload(): Promise<void> {
    try {
      const rows = await api.get<Row[]>('/api/lead-activity')
      activity = rows.map((r) => ({ id: r.id, boardId: r.board_id, diaContatoUpdatedAt: r.dia_contato_updated_at }))
      loaded = true
      notify()
    } catch (err) {
      toast.error('Falha ao carregar atividade dos leads: ' + (err as Error).message)
    }
  },
}
