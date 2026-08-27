import * as React from 'react'
import { reminderNotesService } from '@/services/reminderNotes'
import type { ReminderNote } from '@/types/ticket'

/** Atualizações de uma tarefa, mais recentes primeiro. Carregue com reminderNotesService.loadNotes(id). */
export function useReminderNotes(reminderId: string | null): ReminderNote[] {
  const all = React.useSyncExternalStore(
    reminderNotesService.subscribe,
    reminderNotesService.getAllNotes,
    reminderNotesService.getAllNotes,
  )
  return React.useMemo(
    () => (reminderId ? all.filter((n) => n.reminderId === reminderId).sort((a, b) => b.createdAt.localeCompare(a.createdAt)) : []),
    [all, reminderId],
  )
}
