import * as React from 'react'
import { toast } from 'sonner'
import { api, setToken, clearToken, startSse, stopSse } from '@/services/api'
import type { Profile, UserRole } from '@/services/supabase'
import { bootDb, setCurrentProfile, teardownDb } from '@/services/db'
import { bootTickets, teardownTickets } from '@/services/tickets'
import { bootAnalytics, teardownAnalytics } from '@/services/analytics'

interface AuthState {
  profile: Profile | null
  loading: boolean
}

const listeners = new Set<(s: AuthState) => void>()
let state: AuthState = { profile: null, loading: true }

function setState(next: Partial<AuthState>) {
  state = { ...state, ...next }
  for (const fn of listeners) fn(state)
}

let initialized = false

async function init() {
  if (initialized) return
  initialized = true

  const token = localStorage.getItem('auth_token')
  if (!token) {
    setState({ loading: false })
    return
  }

  try {
    const profile = await api.get<Profile>('/api/auth/me')
    setCurrentProfile(profile)
    setState({ profile, loading: false })
    startSse()
    void bootDb()
    void bootTickets()
    void bootAnalytics()
  } catch {
    clearToken()
    setState({ loading: false })
  }
}

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    initialized = false
    listeners.clear()
  })
}

export function useAuth(): AuthState {
  void init()
  const [snapshot, setSnapshot] = React.useState<AuthState>(state)
  React.useEffect(() => {
    const fn = (s: AuthState) => setSnapshot(s)
    listeners.add(fn)
    setSnapshot(state)
    return () => { listeners.delete(fn) }
  }, [])
  return snapshot
}

export function useRole(): UserRole | null {
  const { profile } = useAuth()
  return profile?.role ?? null
}

export async function signIn(email: string, password: string) {
  const { token, user } = await api.post<{ token: string; user: Profile }>(
    '/api/auth/login',
    { email, password }
  )
  setToken(token)
  setCurrentProfile(user)
  setState({ profile: user, loading: false })
  startSse()
  void bootDb()
  void bootTickets()
  void bootAnalytics()
  return { data: { user }, error: null }
}

export async function signOut() {
  await teardownDb()
  await teardownTickets()
  await teardownAnalytics()
  stopSse()
  clearToken()
  setCurrentProfile(null)
  setState({ profile: null, loading: false })
  // Reload to clear any in-memory state
  window.location.href = '/login'
  return { error: null }
}

// For components that previously used supabase.auth.updateUser
export async function updateCurrentUser(updates: { name?: string; password?: string }) {
  const profile = state.profile
  if (!profile) throw new Error('Não autenticado')
  const updated = await api.patch<Profile>(`/api/users/${profile.id}`, updates)
  setCurrentProfile(updated)
  setState({ profile: updated })
  toast.success('Perfil atualizado')
  return updated
}
