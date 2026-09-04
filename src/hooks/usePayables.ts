import * as React from 'react'
import { payablesService, isPayablesLoaded, type PayableEntry, type PayableGroup } from '@/services/payables'

function useSnapshot<T>(getter: () => T): T {
  React.useEffect(() => { void payablesService.ensureLoaded() }, [])
  return React.useSyncExternalStore(payablesService.subscribe, getter, getter)
}

export function usePayablesLoaded(): boolean {
  return useSnapshot(isPayablesLoaded)
}

export function usePayableGroups(): PayableGroup[] {
  return useSnapshot(payablesService.getGroups)
}

export function usePayableEntries(): PayableEntry[] {
  return useSnapshot(payablesService.getEntries)
}
