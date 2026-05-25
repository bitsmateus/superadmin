// Tipos e helpers compartilhados — sem dependência do Supabase

export type UserRole = 'admin' | 'supervisor' | 'suporte'

export interface Profile {
  id: string
  email: string
  name: string | null
  role: UserRole
  created_at: string
}

export function canSeeFinancials(role: UserRole | null | undefined): boolean {
  return role === 'admin' || role === 'supervisor'
}

export function canDeleteClient(role: UserRole | null | undefined): boolean {
  return role === 'admin'
}

export function canManageUsers(role: UserRole | null | undefined): boolean {
  return role === 'admin'
}
