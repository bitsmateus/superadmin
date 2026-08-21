import { toast } from 'sonner'
import { api, onSseEvent } from '@/services/api'

/** Marco mais recente do lead na linha do tempo (agendada/no-show/vendido) — só leitura. */
export interface LeadMilestone {
  id: string
  boardId: string
  sdr: string
  milestone: string | null
  /** Data do evento que gerou o "milestone" atual (quando virou no-show/vendido do jeito que
   * está agora) — usado pro Dashboard Comercial filtrar por período. */
  milestoneAt: string | null
  /** Já passou por "Reunião agendada" em algum momento — mesmo se o marco atual for outro
   * (ex.: já virou Vendido). Denominador do funil (% de no-show, % de venda). */
  everAgendada: boolean
  /** Data do PRIMEIRO "Reunião agendada" da história do lead — fica fixa mesmo que ele tenha
   * dado no-show e sido reagendado depois (reagendar não conta como um novo agendamento). */
  firstAgendadaAt: string | null
}

type Row = {
  id: string; board_id: string; sdr: string; milestone: string | null; milestone_at: string | null
  ever_agendada: boolean; first_agendada_at: string | null
}

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
      milestones = rows.map((r) => ({
        id: r.id, boardId: r.board_id, sdr: r.sdr, milestone: r.milestone, milestoneAt: r.milestone_at,
        everAgendada: r.ever_agendada, firstAgendadaAt: r.first_agendada_at,
      }))
      loaded = true
      notify()
    } catch (err) {
      toast.error('Falha ao carregar métricas de SDR: ' + (err as Error).message)
    }
  },
}
