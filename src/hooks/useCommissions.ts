import * as React from 'react'
import { commissionsService, isCommissionsLoaded, type CommissionPayment, type CommissionRates } from '@/services/commissions'

function useSnapshot<T>(getter: () => T): T {
  React.useEffect(() => { void commissionsService.ensureLoaded() }, [])
  return React.useSyncExternalStore(commissionsService.subscribe, getter, getter)
}

export function useCommissionsLoaded(): boolean {
  return useSnapshot(isCommissionsLoaded)
}

export function useCommissionRates(): CommissionRates {
  return useSnapshot(commissionsService.getRates)
}

export function useCommissionPayments(): CommissionPayment[] {
  return useSnapshot(commissionsService.getPayments)
}
