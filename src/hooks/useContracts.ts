import * as React from 'react'
import { contractsService, isContractsLoaded, type Contract, type ContractTemplate } from '@/services/contracts'

function useSnapshot<T>(getter: () => T): T {
  React.useEffect(() => { void contractsService.ensureLoaded() }, [])
  return React.useSyncExternalStore(contractsService.subscribe, getter, getter)
}

export function useContractsLoaded(): boolean {
  return useSnapshot(isContractsLoaded)
}

export function useContractTemplates(): ContractTemplate[] {
  return useSnapshot(contractsService.getTemplates)
}

export function useContracts(): Contract[] {
  return useSnapshot(contractsService.getContracts)
}
