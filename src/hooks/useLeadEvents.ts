import * as React from 'react'
import { leadEventsService } from '@/services/leadEvents'
import type { LeadEvent } from '@/types/leadBoard'

/** Linha do tempo automática de um lead, mais recente primeiro. Carregue com leadEventsService.loadEvents(id). */
export function useLeadEvents(leadRowId: string | null): LeadEvent[] {
  const all = React.useSyncExternalStore(
    leadEventsService.subscribe,
    leadEventsService.getAllEvents,
    leadEventsService.getAllEvents,
  )
  return React.useMemo(
    () => (leadRowId ? all.filter((e) => e.leadRowId === leadRowId).sort((a, b) => b.createdAt.localeCompare(a.createdAt)) : []),
    [all, leadRowId],
  )
}
