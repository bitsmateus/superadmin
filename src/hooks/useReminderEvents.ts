import * as React from 'react'
import { reminderEventsService } from '@/services/reminderEvents'
import type { ReminderEvent } from '@/types/ticket'

/** Linha do tempo automática de uma tarefa, mais recente primeiro. Carregue com
 * reminderEventsService.loadEvents(id). */
export function useReminderEvents(reminderId: string | null): ReminderEvent[] {
  const all = React.useSyncExternalStore(
    reminderEventsService.subscribe,
    reminderEventsService.getAllEvents,
    reminderEventsService.getAllEvents,
  )
  return React.useMemo(
    () => (reminderId ? all.filter((e) => e.reminderId === reminderId).sort((a, b) => b.createdAt.localeCompare(a.createdAt)) : []),
    [all, reminderId],
  )
}
