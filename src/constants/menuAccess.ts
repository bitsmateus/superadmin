/**
 * Itens de menu que dá pra liberar/restringir por usuário (papel "suporte"/"Usuário").
 * Cada item corresponde a uma entrada real do Sidebar — usado tanto pra montar a tela
 * de Permissões em Equipe quanto pra filtrar o próprio Sidebar/rotas de quem está restrito.
 * Itens admin-only (Equipe, Auditoria, Conhecimento) ou de financeiro (Comando, Financeiro,
 * Performance) ficam de fora — esses já têm gate próprio por papel, não precisam entrar aqui.
 * Agenda também fica de fora de propósito: é a MESMA agenda, só com um atalho dentro de Suporte e
 * outro dentro de Comercial — a separação entre o que cada área vê não é por essa allowlist, é
 * automática por profile.area dentro da própria AgendaPage (ver resolveArea/useAgenda*).
 */
export type MenuAccessGroup = 'comercial' | 'suporte' | 'nxdigital'

export interface MenuAccessItem {
  key: string
  label: string
  path: string
  group: MenuAccessGroup
  /**
   * Item que se libera/restringe mas NÃO é uma página do Suporte arquivável: fica fora de
   * MENU_KEY_BY_PATH (que o menu usa pra arquivar/duplicar itens do Suporte) e tem a checagem própria.
   */
  fixo?: boolean
}

export const MENU_ACCESS_GROUP_LABEL: Record<MenuAccessGroup, string> = {
  comercial: 'Comercial',
  suporte: 'Suporte',
  nxdigital: 'NX DIGITAL',
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
  { key: 'followups', label: 'Follow-ups', path: '/followups', group: 'suporte' },
  { key: 'canais', label: 'Canais', path: '/canais', group: 'suporte' },
  { key: 'tenants', label: 'Tenants', path: '/tenants', group: 'suporte' },
  { key: 'configuracoes', label: 'Configurações', path: '/settings', group: 'suporte' },
  { key: 'arquivados', label: 'Clientes arquivados', path: '/arquivados', group: 'suporte' },
  { key: 'tickets', label: 'Tickets', path: '/tickets', group: 'suporte' },
  { key: 'templates', label: 'Templates', path: '/templates', group: 'suporte' },
  // Agenda: a mesma tela é atalho do Suporte e do Comercial. Quem tem o Comercial liberado a enxerga por
  // lá (ver `acessoAAgenda`); quem só tem NX DIGITAL não vê a agenda do suporte sem esta marca.
  { key: 'agenda', label: 'Agenda', path: '/agenda', group: 'suporte', fixo: true },
  // Grupo NX DIGITAL (gestão dos clientes de tráfego): uma chave POR aba, marcadas uma a uma como o
  // resto do menu. As telas de detalhe do cliente (/clientesnxdigital/clientes/<id>) valem pela chave de
  // Clientes.
  { key: 'nxdigital_clientes', label: 'Clientes', path: '/clientesnxdigital/clientes', group: 'nxdigital' },
]

/** As chaves das abas do NX DIGITAL. */
export const CHAVES_NX_DIGITAL = ['nxdigital_clientes'] as const

/** A pessoa restrita pode abrir a Agenda? Com a marca "Agenda" ou com o Comercial liberado. */
export function acessoAAgenda(allowed: Set<string>): boolean {
  return allowed.has('agenda') || allowed.has('comercial')
}

export const MENU_KEY_BY_PATH: Record<string, string> = Object.fromEntries(
  MENU_ACCESS_ITEMS.filter((item) => !item.fixo).map((item) => [item.path, item.key]),
)
