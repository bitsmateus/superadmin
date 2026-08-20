import type { LeadBoardPage } from '@/types/leadBoard'

/**
 * Itens de menu que dá pra liberar/restringir por usuário (papel "suporte"/"Usuário").
 * Cada item corresponde a uma entrada real do Sidebar — usado tanto pra montar a tela
 * de Permissões em Equipe quanto pra filtrar o próprio Sidebar/rotas de quem está restrito.
 * Itens admin-only (Equipe, Auditoria, Conhecimento) ou de financeiro (Comando, Financeiro,
 * Performance) ficam de fora — esses já têm gate próprio por papel, não precisam entrar aqui.
 */
export type MenuAccessGroup = 'comercial' | 'suporte'

export interface MenuAccessItem {
  key: string
  label: string
  path: string
  group: MenuAccessGroup
  /** Presente só nos 3 itens do Comercial — permite refinar pra quadros específicos. */
  boardsPage?: LeadBoardPage
}

export const MENU_ACCESS_GROUP_LABEL: Record<MenuAccessGroup, string> = {
  comercial: 'Comercial',
  suporte: 'Suporte',
}

export const MENU_ACCESS_ITEMS: MenuAccessItem[] = [
  { key: 'comercial_novos_leads', label: 'Novos Leads', path: '/comercial/novos-leads', group: 'comercial', boardsPage: 'novos_leads' },
  { key: 'comercial_crm_luis', label: 'CRM NX Luis', path: '/comercial/crm-nx-luis', group: 'comercial', boardsPage: 'crm_luis' },
  { key: 'comercial_crm_arthur', label: 'CRM NX Arthur', path: '/comercial/crm-nx-arthur', group: 'comercial', boardsPage: 'crm_arthur' },
  { key: 'dashboard', label: 'Dashboard', path: '/', group: 'suporte' },
  { key: 'tarefas', label: 'Suporte (Tarefas)', path: '/tarefas', group: 'suporte' },
  { key: 'pipeline', label: 'Pipeline', path: '/pipeline', group: 'suporte' },
  { key: 'clientes', label: 'Clientes', path: '/clients', group: 'suporte' },
  { key: 'canais', label: 'Canais', path: '/canais', group: 'suporte' },
  { key: 'tenants', label: 'Tenants', path: '/tenants', group: 'suporte' },
  { key: 'configuracoes', label: 'Configurações', path: '/settings', group: 'suporte' },
  { key: 'arquivados', label: 'Clientes arquivados', path: '/arquivados', group: 'suporte' },
  { key: 'tickets', label: 'Tickets', path: '/tickets', group: 'suporte' },
  { key: 'templates', label: 'Templates', path: '/templates', group: 'suporte' },
]

export const MENU_KEY_BY_PATH: Record<string, string> = Object.fromEntries(
  MENU_ACCESS_ITEMS.map((item) => [item.path, item.key]),
)
