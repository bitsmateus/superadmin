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
   * a itens de menu específicos e, dentro do Comercial, a quadros específicos. Default false = sem
   * restrição. */
  restrictAccess?: boolean
  /** Só vem preenchido quando restrictAccess=true — chaves de src/constants/menuAccess.ts. */
  menuAccess?: string[]
  /** Preferência de tema salva na conta (não no navegador) — null/undefined = nunca escolheu,
   * usa o que já estava aplicado localmente. */
  theme?: 'light' | 'dark' | null
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
