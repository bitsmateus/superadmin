import * as React from 'react'
import { db } from '@/services/db'
import type { Client } from '@/types/client'

/**
 * Subscribe na cache de clientes. Usa useSyncExternalStore (idiomático
 * pra stores externas em React 18+) e mantém referência estável quando
 * o snapshot não mudou, evitando re-renders em consumidores.
 */
export function useClients(): Client[] {
  return React.useSyncExternalStore(
    db.subscribe,
    db.getClients,
    db.getClients,
  )
}

/**
 * Subscribe em UM cliente. Usa um selector com useSyncExternalStore — como a
 * cache mantém referência estável dos clientes que não mudaram, este hook só
 * re-renderiza quando ESTE cliente muda (não a cada alteração de qualquer
 * outro cliente da lista). Importante pro ClientDrawer não re-renderizar à toa.
 */
export function useClient(id: string | undefined): Client | undefined {
  const getSnapshot = React.useCallback(
    () => (id ? db.getClient(id) : undefined),
    [id],
  )
  return React.useSyncExternalStore(db.subscribe, getSnapshot, getSnapshot)
}

export function useCurrentUser(): [string, (v: string) => void] {
  const subscribe = React.useCallback(
    (fn: () => void) => db.subscribe(fn),
    [],
  )
  const user = React.useSyncExternalStore(
    subscribe,
    db.getCurrentUser,
    db.getCurrentUser,
  )
  return [user, (v: string) => db.setCurrentUser(v)]
}

export function useSettings() {
  return React.useSyncExternalStore(
    db.subscribe,
    db.getSettings,
    db.getSettings,
  )
}
