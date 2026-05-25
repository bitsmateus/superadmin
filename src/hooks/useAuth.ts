import * as React from 'react'
import type { Session, Subscription } from '@supabase/supabase-js'
import { toast } from 'sonner'
import { supabase, type Profile, type UserRole } from '@/services/supabase'
import { bootDb, setCurrentProfile, teardownDb } from '@/services/db'
import { bootTickets, teardownTickets } from '@/services/tickets'
import { bootAnalytics, teardownAnalytics } from '@/services/analytics'

/**
 * Holds the authentication session. On change, hydrates / unloads the CRM
 * cache and surfaces the current user's profile (with role) to the UI.
 *
 * - When a session appears: fetches profile, calls `bootDb()` to populate
 *   the cache and open realtime subscriptions.
 * - When the session disappears: tears down the cache and channel.
 *
 * `onAuthStateChange` já emite um INITIAL_SESSION ao subscrever, então não
 * chamamos `getSession()` manualmente (evita race / double-boot).
 */

interface AuthState {
  session: Session | null
  profile: Profile | null
  loading: boolean
}

const listeners = new Set<(s: AuthState) => void>()
let state: AuthState = { session: null, profile: null, loading: true }

function setState(next: Partial<AuthState>) {
  state = { ...state, ...next }
  for (const fn of listeners) fn(state)
}

let initialized = false
let authSubscription: Subscription | null = null
// Token monotônico: se uma transição mais nova chegar antes do fetchProfile
// antigo terminar, descartamos o resultado obsoleto.
let authTransition = 0

function init() {
  if (initialized) return
  initialized = true

  const { data } = supabase.auth.onAuthStateChange(async (_event, session) => {
    const myToken = ++authTransition
    if (session) {
      const profile = await fetchProfile(session.user.id)
      // Outra transição já aconteceu? Descarta este resultado.
      if (myToken !== authTransition) return

      if (!profile) {
        // Usuário autenticado mas sem profile (trigger handle_new_user falhou
        // ou RLS bloqueou). Trata como erro fatal — desloga.
        // eslint-disable-next-line no-console
        console.error('[auth] sessão sem profile — deslogando')
        toast.error('Perfil não encontrado. Contate o admin.')
        await supabase.auth.signOut()
        return
      }

      setCurrentProfile(profile)
      setState({ session, profile, loading: false })
      void bootDb()
      void bootTickets()
      void bootAnalytics()
    } else {
      await teardownDb()
      await teardownTickets()
      await teardownAnalytics()
      setCurrentProfile(null)
      setState({ session: null, profile: null, loading: false })
    }
  })
  authSubscription = data.subscription
}

// HMR-friendly: limpa subscription quando módulo é substituído em dev.
if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    authSubscription?.unsubscribe()
    authSubscription = null
    initialized = false
    listeners.clear()
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
