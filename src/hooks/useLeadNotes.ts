import * as React from 'react'
import { leadNotesService } from '@/services/leadNotes'
import type { LeadNote } from '@/types/leadBoard'

/** Anotações de um lead, mais recentes primeiro. Carregue com leadNotesService.loadNotes(id). */
export function useLeadNotes(leadRowId: string | null): LeadNote[] {
  const all = React.useSyncExternalStore(
    leadNotesService.subscribe,
    leadNotesService.getAllNotes,
    leadNotesService.getAllNotes,
  )
  return React.useMemo(
    () => (leadRowId ? all.filter((n) => n.leadRowId === leadRowId).sort((a, b) => b.createdAt.localeCompare(a.createdAt)) : []),
    [all, leadRowId],
  )
}
