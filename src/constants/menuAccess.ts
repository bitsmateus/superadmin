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
}

export const MENU_ACCESS_GROUP_LABEL: Record<MenuAccessGroup, string> = {
  comercial: 'Comercial',
  suporte: 'Suporte',
}

// O Comercial NÃO tem um item aqui — cada aba (Novos Leads, CRM NX Luis, CRM NX Arthur, Vendas,
// Contrato, e o que um admin criar/duplicar depois) é marcada direto na tela de Permissões, uma
// por uma, sem uma marcação "todas as abas" por cima (ver UsersPage.tsx — a seção comercial é
// montada a partir de `GET /api/lead-pages`, não desta lista). "comercial" ainda existe como
// MENU_KEY (ver leadPages.ts/leadBoards.ts no servidor), só que agora é derivado: fica marcado
// sozinho quando pelo menos uma aba está liberada, sem precisar de um checkbox próprio.
export const MENU_ACCESS_ITEMS: MenuAccessItem[] = [
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
