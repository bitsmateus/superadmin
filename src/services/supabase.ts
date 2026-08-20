// Tipos e helpers compartilhados — sem dependência do Supabase

export type UserRole = 'admin' | 'supervisor' | 'suporte'

/**
 * Área no funil — define em qual filtro/seletor a pessoa aparece.
 * Nulo (perfis antigos) é tratado como 'ambos', pra não sumir de lugar nenhum.
 */
export type TeamArea = 'comercial' | 'entrega' | 'ambos'

export interface Profile {
  id: string
  email: string
  name: string | null
  role: UserRole
  area?: TeamArea | null
  /** Trava opcional de acesso (só relevante pro papel 'suporte', exibido como "Usuário"): restringe
   * à área e, dentro dela, a quadros específicos do Comercial. Default false = sem restrição. */
  restrictAccess?: boolean
  created_at: string
}

export const TEAM_AREA_LABEL: Record<TeamArea, string> = {
  comercial: 'Comercial',
  entrega: 'Entrega',
  ambos: 'Comercial e entrega',
}

export function resolveArea(area: TeamArea | null | undefined): TeamArea {
  return area === 'comercial' || area === 'entrega' ? area : 'ambos'
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
