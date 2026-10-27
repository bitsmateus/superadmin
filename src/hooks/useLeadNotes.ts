import * as React from 'react'
import { idsDoHistorico, leadNotesService } from '@/services/leadNotes'
import type { LeadNote } from '@/types/leadBoard'

/** Anotações de um lead, mais recentes primeiro. Carregue com leadNotesService.loadNotes(id).
 * Lead espelhada mostra as Atualizações da original (e das outras origens do card do closer) — ver idsDoHistorico. */
export function useLeadNotes(leadRowId: string | null): LeadNote[] {
  const all = React.useSyncExternalStore(
    leadNotesService.subscribe,
    leadNotesService.getAllNotes,
    leadNotesService.getAllNotes,
  )
  return React.useMemo(() => {
    if (!leadRowId) return []
    const ids = idsDoHistorico(leadRowId)
    return all
      .filter((n) => ids.includes(n.leadRowId))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  }, [all, leadRowId])
}
