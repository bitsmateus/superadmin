import * as React from 'react'
import { commissionsService, isCommissionsLoaded, type CommissionEntry, type CommissionType } from '@/services/commissions'

function useSnapshot<T>(getter: () => T): T {
  React.useEffect(() => { void commissionsService.ensureLoaded() }, [])
  return React.useSyncExternalStore(commissionsService.subscribe, getter, getter)
}

export function useCommissionsLoaded(): boolean {
  return useSnapshot(isCommissionsLoaded)
}

export function useCommissionTypes(): CommissionType[] {
  return useSnapshot(commissionsService.getTypes)
}

export function useCommissionEntries(): CommissionEntry[] {
  return useSnapshot(commissionsService.getEntries)
}
