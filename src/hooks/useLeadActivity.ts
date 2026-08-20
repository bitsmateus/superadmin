import * as React from 'react'
import { leadActivityService, type LeadActivity } from '@/services/leadActivity'

/** Quando cada lead teve o "Dia de contato" alterado pela última vez — carregado sob demanda. */
export function useLeadActivity(): LeadActivity[] {
  React.useEffect(() => { void leadActivityService.ensureLoaded() }, [])
  return React.useSyncExternalStore(
    leadActivityService.subscribe,
    leadActivityService.getAll,
    leadActivityService.getAll,
  )
}
