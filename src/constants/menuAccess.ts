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
  /** Marca esse item como liberado por quadro (user_board_access), não por página inteira —
   * só o "comercial" tem isso, já que as abas viraram dinâmicas (gerenciáveis por admin). */
  boardsPicker?: boolean
}

export const MENU_ACCESS_GROUP_LABEL: Record<MenuAccessGroup, string> = {
  comercial: 'Comercial',
  suporte: 'Suporte',
}

export const MENU_ACCESS_ITEMS: MenuAccessItem[] = [
  // Tudo ou nada pro Comercial inteiro (Novos Leads, CRM NX Luis, CRM NX Arthur, e o que um
  // admin criar/duplicar depois) — a granularidade fina fica por quadro, marcado abaixo.
  { key: 'comercial', label: 'Comercial (todas as abas)', path: '/comercial', group: 'comercial', boardsPicker: true },
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
