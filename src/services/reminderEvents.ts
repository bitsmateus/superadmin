import { toast } from 'sonner'
import { api, onSseEvent } from '@/services/api'
import type { ReminderEvent, ReminderEventType } from '@/types/ticket'

type EventRow = {
  id: string; reminder_id: string; type: ReminderEventType
  from_value: string | null; to_value: string | null; actor_name: string
  created_at: string
}
function rowToEvent(r: EventRow): ReminderEvent {
  return {
    id: r.id, reminderId: r.reminder_id, type: r.type,
    fromValue: r.from_value, toValue: r.to_value, actorName: r.actor_name,
    createdAt: r.created_at,
  }
}

// ---------- Cache (carregado sob demanda por tarefa — linha do tempo é só leitura) ----------

let events: ReminderEvent[] = []
const loadedReminderIds = new Set<string>()

const subs = new Set<() => void>()
function notify() { for (const fn of subs) fn() }

let unsubSse: (() => void) | null = null
function ensureRealtime() {
  if (unsubSse) return
  unsubSse = onSseEvent((table, type, data) => {
    if (table !== 'reminder_events' || type !== 'INSERT') return
    const row = data as Partial<EventRow>
    if (typeof row.reminder_id !== 'string' || typeof row.type !== 'string') return
    if (!loadedReminderIds.has(row.reminder_id)) return
    events = [rowToEvent(row as EventRow), ...events]
    notify()
  })
}

export const reminderEventsService = {
  subscribe(fn: () => void): () => void { subs.add(fn); return () => { subs.delete(fn) } },
  getAllEvents(): ReminderEvent[] { return events },
  isLoaded(reminderId: string): boolean { return loadedReminderIds.has(reminderId) },

  async loadEvents(reminderId: string): Promise<void> {
    ensureRealtime()
    try {
      const rows = await api.get<EventRow[]>(`/api/reminder-events?reminder_id=${reminderId}`)
      const fresh = rows.map(rowToEvent)
      events = [...events.filter((e) => e.reminderId !== reminderId), ...fresh]
      loadedReminderIds.add(reminderId)
      notify()
    } catch (err) {
      toast.error('Falha ao carregar linha do tempo: ' + (err as Error).message)
    }
  },
}
