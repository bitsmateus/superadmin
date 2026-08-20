import { toast } from 'sonner'
import { api, onSseEvent } from '@/services/api'

/** Marco mais recente do lead na linha do tempo (agendada/no-show/vendido) — só leitura. */
export interface LeadMilestone {
  id: string
  boardId: string
  sdr: string
  milestone: string | null
}

type Row = { id: string; board_id: string; sdr: string; milestone: string | null }

let milestones: LeadMilestone[] = []
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
    // Só reagendamento/no-show/venda (evento type "status") muda o marco — o resto não precisa recarregar.
    if (row.type !== 'status') return
    if (refetchTimer) clearTimeout(refetchTimer)
    refetchTimer = setTimeout(() => { void leadMilestonesService.reload() }, 400)
  })
}

export const leadMilestonesService = {
  subscribe(fn: () => void): () => void { subs.add(fn); return () => { subs.delete(fn) } },

  getAll(): LeadMilestone[] { return milestones },

  async ensureLoaded(): Promise<void> {
    ensureRealtime()
    if (loaded) return
    if (loadingPromise) return loadingPromise
    loadingPromise = leadMilestonesService.reload().finally(() => { loadingPromise = null })
    return loadingPromise
  },

  async reload(): Promise<void> {
    try {
      const rows = await api.get<Row[]>('/api/lead-milestones')
      milestones = rows.map((r) => ({ id: r.id, boardId: r.board_id, sdr: r.sdr, milestone: r.milestone }))
      loaded = true
      notify()
    } catch (err) {
      toast.error('Falha ao carregar métricas de SDR: ' + (err as Error).message)
    }
  },
}
