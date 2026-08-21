import * as React from 'react'
import { leadPagesService, isLeadPagesBooted } from '@/services/leadPages'
import type { LeadPage } from '@/types/leadBoard'

function useSnapshot<T>(getter: () => T): T {
  return React.useSyncExternalStore(
    leadPagesService.subscribe,
    getter,
    getter,
  )
}

export function useLeadPagesBooted(): boolean {
  return useSnapshot(isLeadPagesBooted)
}

/** Abas do Comercial ativas (não arquivadas), ordenadas — Novos Leads, CRM NX Luis, CRM NX
 * Arthur, e as que um admin criar/duplicar depois. */
export function useLeadPages(): LeadPage[] {
  return useSnapshot(leadPagesService.getAll)
}
