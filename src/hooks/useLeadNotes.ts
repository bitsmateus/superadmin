import * as React from 'react'
import { canonicalNoteLeadId, leadNotesService } from '@/services/leadNotes'
import type { LeadNote } from '@/types/leadBoard'

/** Anotações de um lead, mais recentes primeiro. Carregue com leadNotesService.loadNotes(id).
 * Lead espelhada mostra as Atualizações da original — ver canonicalNoteLeadId. */
export function useLeadNotes(leadRowId: string | null): LeadNote[] {
  const all = React.useSyncExternalStore(
    leadNotesService.subscribe,
    leadNotesService.getAllNotes,
    leadNotesService.getAllNotes,
  )
  return React.useMemo(() => {
    if (!leadRowId) return []
    const canonicalId = canonicalNoteLeadId(leadRowId)
    return all
      .filter((n) => n.leadRowId === canonicalId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  }, [all, leadRowId])
}
