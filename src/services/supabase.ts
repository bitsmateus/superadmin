import { createClient, type SupabaseClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!url || !anonKey) {
  // Surface a clear error during dev. The app cannot work without Supabase.
  // eslint-disable-next-line no-console
  console.error(
    '[supabase] Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY in .env',
  )
}

export const supabase: SupabaseClient = createClient(url ?? '', anonKey ?? '', {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
    storageKey: 'tenanthub-supabase-auth',
  },
})

export type UserRole = 'admin' | 'supervisor' | 'suporte'

export interface Profile {
  id: string
  email: string
  name: string | null
  role: UserRole
  created_at: string
}

/**
 * Capability matrix derived from `role`. Centralising it here lets the UI
 * (`Contrato` tab visibility, delete buttons) ask a single source of truth.
 *
 * Mirrored in the SQL RLS policies — keep both in sync.
 */
export function canSeeFinancials(role: UserRole | null | undefined): boolean {
  return role === 'admin' || role === 'supervisor'
}

export function canDeleteClient(role: UserRole | null | undefined): boolean {
  return role === 'admin'
}

export function canManageUsers(role: UserRole | null | undefined): boolean {
  return role === 'admin'
}
