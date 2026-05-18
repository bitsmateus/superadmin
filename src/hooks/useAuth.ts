import * as React from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase, type Profile, type UserRole } from '@/services/supabase'
import { bootDb, setCurrentProfile, teardownDb } from '@/services/db'

/**
 * Holds the authentication session. On change, hydrates / unloads the CRM
 * cache and surfaces the current user's profile (with role) to the UI.
 *
 * - When a session appears: fetches profile, calls `bootDb()` to populate
 *   the cache and open realtime subscriptions.
 * - When the session disappears: tears down the cache and channel.
 */

interface AuthState {
  session: Session | null
  profile: Profile | null
  loading: boolean
}

let listeners = new Set<(s: AuthState) => void>()
let state: AuthState = { session: null, profile: null, loading: true }

function setState(next: Partial<AuthState>) {
  state = { ...state, ...next }
  for (const fn of listeners) fn(state)
}

let initialized = false
function init() {
  if (initialized) return
  initialized = true

  // Initial session check.
  supabase.auth.getSession().then(async ({ data }) => {
    const session = data.session
    if (session) {
      const profile = await fetchProfile(session.user.id)
      setCurrentProfile(profile)
      setState({ session, profile, loading: false })
      void bootDb()
    } else {
      setState({ session: null, profile: null, loading: false })
    }
  })

  // Subscribe to subsequent auth changes (login, logout, token refresh).
  supabase.auth.onAuthStateChange(async (_event, session) => {
    if (session) {
      const profile = await fetchProfile(session.user.id)
      setCurrentProfile(profile)
      setState({ session, profile, loading: false })
      void bootDb()
    } else {
      await teardownDb()
      setCurrentProfile(null)
      setState({ session: null, profile: null, loading: false })
    }
  })
}

async function fetchProfile(userId: string): Promise<Profile | null> {
  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', userId)
    .maybeSingle()
  if (error) {
    // eslint-disable-next-line no-console
    console.error('[auth] fetchProfile', error)
    return null
  }
  return data as Profile | null
}

export function useAuth(): AuthState {
  init()
  const [snapshot, setSnapshot] = React.useState<AuthState>(state)
  React.useEffect(() => {
    const fn = (s: AuthState) => setSnapshot(s)
    listeners.add(fn)
    // re-sync if state changed between init() and effect
    setSnapshot(state)
    return () => {
      listeners.delete(fn)
    }
  }, [])
  return snapshot
}

export function useRole(): UserRole | null {
  const { profile } = useAuth()
  return profile?.role ?? null
}

export async function signIn(email: string, password: string) {
  return supabase.auth.signInWithPassword({ email, password })
}

export async function signOut() {
  return supabase.auth.signOut()
}
