import * as React from 'react'
import { db } from '@/services/db'
import type { Client } from '@/types/client'

export function useClients(): Client[] {
  const [clients, setClients] = React.useState<Client[]>(() => db.getClients())
  React.useEffect(() => {
    return db.subscribe(() => setClients(db.getClients()))
  }, [])
  return clients
}

export function useClient(id: string | undefined): Client | undefined {
  const clients = useClients()
  return React.useMemo(
    () => (id ? clients.find((c) => c.id === id) : undefined),
    [clients, id],
  )
}

export function useCurrentUser(): [string, (v: string) => void] {
  const [user, setUser] = React.useState<string>(() => db.getCurrentUser())
  React.useEffect(() => db.subscribe(() => setUser(db.getCurrentUser())), [])
  return [user, (v: string) => db.setCurrentUser(v)]
}

export function useSettings() {
  const [settings, setSettings] = React.useState(() => db.getSettings())
  React.useEffect(() => db.subscribe(() => setSettings(db.getSettings())), [])
  return settings
}
