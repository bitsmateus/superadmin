import * as React from 'react'
import { commercialMonthsService, isCommercialMonthsLoaded, type CommercialMonth } from '@/services/commercialMonths'

/** Meses já criados no Painel do Mês, mais recente primeiro — carregado sob demanda. */
export function useCommercialMonths(): CommercialMonth[] {
  React.useEffect(() => { void commercialMonthsService.ensureLoaded() }, [])
  return React.useSyncExternalStore(
    commercialMonthsService.subscribe,
    commercialMonthsService.getAll,
    commercialMonthsService.getAll,
  )
}

export function useCommercialMonthsLoaded(): boolean {
  return React.useSyncExternalStore(
    commercialMonthsService.subscribe,
    isCommercialMonthsLoaded,
    isCommercialMonthsLoaded,
  )
}
