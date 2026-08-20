import * as React from 'react'
import { leadMilestonesService, type LeadMilestone } from '@/services/leadMilestones'

/** Marco (agendada/no-show/vendido) mais recente de cada lead — carregado sob demanda. */
export function useLeadMilestones(): LeadMilestone[] {
  React.useEffect(() => { void leadMilestonesService.ensureLoaded() }, [])
  return React.useSyncExternalStore(
    leadMilestonesService.subscribe,
    leadMilestonesService.getAll,
    leadMilestonesService.getAll,
  )
}
