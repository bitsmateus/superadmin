import type { LeadBoardPage } from '@/types/leadBoard'

/**
 * Itens de menu que dá pra liberar/restringir por usuário (papel "suporte"/"Usuário").
 * Cada item corresponde a uma entrada real do Sidebar — usado tanto pra montar a tela
 * de Permissões em Equipe quanto pra filtrar o próprio Sidebar/rotas de quem está restrito.
 * Itens admin-only (Equipe, Auditoria, Conhecimento) ou de financeiro (Comando, Financeiro,
 * Performance) ficam de fora — esses já têm gate próprio por papel, não precisam entrar aqui.
 */
export interface MenuAccessItem {
  key: string
  label: string
  path: string
  /** Presente só nos 3 itens do Comercial — permite refinar pra quadros específicos. */
  boardsPage?: LeadBoardPage
}

export const MENU_ACCESS_ITEMS: MenuAccessItem[] = [
  { key: 'dashboard', label: 'Dashboard', path: '/' },
  { key: 'tarefas', label: 'Suporte (Tarefas)', path: '/tarefas' },
  { key: 'pipeline', label: 'Pipeline', path: '/pipeline' },
  { key: 'clientes', label: 'Clientes', path: '/clients' },
  { key: 'canais', label: 'Canais', path: '/canais' },
  { key: 'tenants', label: 'Tenants', path: '/tenants' },
  { key: 'comercial_novos_leads', label: 'Comercial · Novos Leads', path: '/comercial/novos-leads', boardsPage: 'novos_leads' },
  { key: 'comercial_crm_luis', label: 'Comercial · CRM NX Luis', path: '/comercial/crm-nx-luis', boardsPage: 'crm_luis' },
  { key: 'comercial_crm_arthur', label: 'Comercial · CRM NX Arthur', path: '/comercial/crm-nx-arthur', boardsPage: 'crm_arthur' },
  { key: 'configuracoes', label: 'Configurações', path: '/settings' },
  { key: 'arquivados', label: 'Clientes arquivados', path: '/arquivados' },
  { key: 'tickets', label: 'Tickets', path: '/tickets' },
  { key: 'templates', label: 'Templates', path: '/templates' },
]

export const MENU_KEY_BY_PATH: Record<string, string> = Object.fromEntries(
  MENU_ACCESS_ITEMS.map((item) => [item.path, item.key]),
)
