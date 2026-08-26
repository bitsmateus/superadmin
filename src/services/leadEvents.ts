import { toast } from 'sonner'
import { api, onSseEvent } from '@/services/api'
import type { LeadEvent, LeadEventType } from '@/types/leadBoard'

type EventRow = {
  id: string; lead_row_id: string; type: LeadEventType
  from_value: string | null; to_value: string | null; actor_name: string
  created_at: string
}
function rowToEvent(r: EventRow): LeadEvent {
  return {
    id: r.id, leadRowId: r.lead_row_id, type: r.type,
    fromValue: r.from_value, toValue: r.to_value, actorName: r.actor_name,
    createdAt: r.created_at,
  }
}

// ---------- Cache (carregado sob demanda por lead — linha do tempo é só leitura) ----------

let events: LeadEvent[] = []
const loadedLeadIds = new Set<string>()

const subs = new Set<() => void>()
function notify() { for (const fn of subs) fn() }

let unsubSse: (() => void) | null = null
function ensureRealtime() {
  if (unsubSse) return
  unsubSse = onSseEvent((table, type, data) => {
    if (table !== 'lead_events' || type !== 'INSERT') return
    const row = data as Partial<EventRow>
    if (typeof row.lead_row_id !== 'string' || typeof row.type !== 'string') return
    // Só entra no cache se a linha do tempo desse lead já foi carregada — evita guardar
    // eventos de leads nunca abertos nessa sessão.
    if (!loadedLeadIds.has(row.lead_row_id)) return
    events = [rowToEvent(row as EventRow), ...events]
    notify()
  })
}

export interface PageLeadEvent extends LeadEvent {
  leadNome: string
  leadSdr: string
}
type PageEventRow = EventRow & { lead_nome: string; lead_sdr: string }

export const leadEventsService = {
  subscribe(fn: () => void): () => void { subs.add(fn); return () => { subs.delete(fn) } },

  /** Log de tudo que aconteceu numa aba (todos os leads/SDRs dela) — pro botão "Log" ao lado de
   * Filtro. Busca sob demanda a cada abertura do modal, sem cache (é uma conferência pontual). */
  async getPageEvents(page: string): Promise<PageLeadEvent[]> {
    const rows = await api.get<PageEventRow[]>(`/api/lead-events?page=${encodeURIComponent(page)}`)
    return rows.map((r) => ({ ...rowToEvent(r), leadNome: r.lead_nome || 'Sem nome', leadSdr: r.lead_sdr || '' }))
  },

  /** Referência crua do cache — filtrar/ordenar por leadRowId fica por conta do hook (useMemo). */
  getAllEvents(): LeadEvent[] { return events },

  isLoaded(leadRowId: string): boolean { return loadedLeadIds.has(leadRowId) },

  async loadEvents(leadRowId: string): Promise<void> {
    ensureRealtime()
    try {
      const rows = await api.get<EventRow[]>(`/api/lead-events?lead_row_id=${leadRowId}`)
      const fresh = rows.map(rowToEvent)
      events = [...events.filter((e) => e.leadRowId !== leadRowId), ...fresh]
      loadedLeadIds.add(leadRowId)
      notify()
    } catch (err) {
      toast.error('Falha ao carregar linha do tempo: ' + (err as Error).message)
    }
  },
}
