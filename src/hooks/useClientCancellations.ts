import * as React from 'react'
import {
  clientCancellationsService, isCancellationsLoaded, type ClientCancellation,
} from '@/services/clientCancellations'

function useSnapshot<T>(getter: () => T): T {
  React.useEffect(() => { void clientCancellationsService.ensureLoaded() }, [])
  return React.useSyncExternalStore(clientCancellationsService.subscribe, getter, getter)
}

export function useClientCancellations(): ClientCancellation[] {
  return useSnapshot(clientCancellationsService.getAll)
}

export function useClientCancellationsLoaded(): boolean {
  return useSnapshot(isCancellationsLoaded)
}
