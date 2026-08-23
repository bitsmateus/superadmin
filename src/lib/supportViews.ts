/**
 * O que dá pra escolher ao duplicar cada tela do Suporte.
 *
 * Uma cópia ("Duplicar" nos 3 pontinhos) abre a MESMA tela do item de origem, mas com a própria
 * visão salva — os filtros/modo de exibição definidos aqui. É o que faz "Pipeline (só do Luis)"
 * ser diferente de "Pipeline", em vez de um atalho com outro nome.
 *
 * Cada campo aponta pro estado que a tela já tem hoje (ex.: `statusFilter` em TicketsPage), então
 * a tela só precisa semear o `useState` inicial com o valor salvo — ver `useSupportViewValue`.
 * Telas sem entrada aqui (Dashboard, Configurações) não têm filtro que valha guardar: a cópia
 * ainda funciona, só abre igual à origem.
 */

import { PIPELINE_STAGES, STAGE_COLORS } from '@/constants/stageColors'
import { KIND_META } from '@/lib/supportMeta'

export interface SupportViewOption {
  value: string
  label: string
}

export interface SupportViewField {
  /** Bate com o nome do estado na tela — é a chave dentro de view_config. */
  key: string
  label: string
  /** 'select' = lista fixa; 'text' = busca livre. */
  type: 'select' | 'text'
  /** Valor que a tela já usa quando ninguém escolheu nada. */
  default: string
  options?: SupportViewOption[]
  placeholder?: string
  hint?: string
}

/** Indexado pelo `sourceKey` do item (mesmas chaves de MENU_ACCESS_ITEMS). */
export const SUPPORT_VIEW_FIELDS: Record<string, SupportViewField[]> = {
  tarefas: [
    {
      key: 'view',
      label: 'Modo de exibição',
      type: 'select',
      default: 'list',
      options: [
        { value: 'list', label: 'Lista' },
        { value: 'kanban', label: 'Kanban' },
      ],
    },
    {
      key: 'quick',
      label: 'Recorte',
      type: 'select',
      default: 'all',
      options: [
        { value: 'all', label: 'Todas' },
        { value: 'mine', label: 'Minhas' },
        { value: 'unassigned', label: 'Sem dono' },
        { value: 'overdue', label: 'Atrasadas' },
        { value: 'today', label: 'Hoje' },
      ],
    },
    {
      key: 'filterKind',
      label: 'Tipo',
      type: 'select',
      default: 'all',
      // Deriva de KIND_META pra não divergir dos chips da própria tela.
      options: [
        { value: 'all', label: 'Todos' },
        ...Object.entries(KIND_META).map(([value, meta]) => ({ value, label: meta.label })),
      ],
    },
  ],
  pipeline: [
    {
      key: 'filterComercial',
      label: 'Comercial responsável',
      type: 'text',
      default: '',
      placeholder: 'nome exato, como aparece no filtro',
      // O Pipeline compara com o nome gravado no cliente (responsavelComercial/responsavel),
      // não com um id — escrito diferente, o filtro não casa e a tela abre vazia.
      hint: 'Precisa ser igual ao nome que aparece no seletor "Comercial" da tela.',
    },
    {
      key: 'filterEntrega',
      label: 'Responsável pela entrega',
      type: 'text',
      default: '',
      placeholder: 'nome exato, como aparece no filtro',
      hint: 'Precisa ser igual ao nome que aparece no seletor "Entrega" da tela.',
    },
    {
      key: 'search',
      label: 'Busca fixa',
      type: 'text',
      default: '',
      placeholder: 'termo aplicado ao abrir',
    },
  ],
  clientes: [
    {
      key: 'stageFilter',
      label: 'Etapa',
      type: 'select',
      default: 'all',
      // Mesma fonte que os chips da tela (PIPELINE_STAGES), pra não sair do ar quando mudarem.
      options: [
        { value: 'all', label: 'Todos' },
        ...PIPELINE_STAGES.map((stage) => ({ value: stage, label: STAGE_COLORS[stage].label })),
      ],
    },
    { key: 'search', label: 'Busca fixa', type: 'text', default: '', placeholder: 'termo aplicado ao abrir' },
  ],
  canais: [
    {
      key: 'view',
      label: 'Aba inicial',
      type: 'select',
      default: 'canais',
      options: [
        { value: 'canais', label: 'Canais' },
        { value: 'relatorios', label: 'Relatórios' },
      ],
    },
    {
      key: 'notifyFilter',
      label: 'Avisos',
      type: 'select',
      default: 'all',
      options: [
        { value: 'all', label: 'Notificação: todas' },
        { value: 'on', label: 'Com notificação ativa' },
        { value: 'off', label: 'Sem notificação ativa' },
      ],
    },
    { key: 'search', label: 'Busca fixa', type: 'text', default: '', placeholder: 'termo aplicado ao abrir' },
  ],
  tenants: [
    {
      key: 'statusFilter',
      label: 'Status',
      type: 'select',
      default: 'all',
      options: [
        { value: 'all', label: 'Todos status' },
        { value: 'active', label: 'Ativos' },
        { value: 'inactive', label: 'Inativos' },
      ],
    },
    { key: 'search', label: 'Busca fixa', type: 'text', default: '', placeholder: 'termo aplicado ao abrir' },
  ],
  tickets: [
    {
      key: 'statusFilter',
      label: 'Status',
      type: 'select',
      default: 'active',
      options: [
        { value: 'active', label: 'Ativos' },
        { value: 'all', label: 'Todos' },
        { value: 'new', label: 'Novos' },
        { value: 'open', label: 'Em andamento' },
        { value: 'pending_customer', label: 'Aguard. cliente' },
        { value: 'resolved', label: 'Resolvidos' },
        { value: 'closed', label: 'Fechados' },
      ],
    },
    {
      key: 'priorityFilter',
      label: 'Prioridade',
      type: 'select',
      default: 'all',
      options: [
        { value: 'all', label: 'Todas' },
        { value: 'urgent', label: 'Urgente' },
        { value: 'high', label: 'Alta' },
        { value: 'normal', label: 'Normal' },
        { value: 'low', label: 'Baixa' },
      ],
    },
    {
      key: 'assigneeFilter',
      label: 'Responsável',
      type: 'select',
      default: 'all',
      options: [
        { value: 'all', label: 'Qualquer atendente' },
        { value: 'mine', label: 'Meus' },
        { value: 'unassigned', label: 'Sem atribuição' },
      ],
    },
    { key: 'search', label: 'Busca fixa', type: 'text', default: '', placeholder: 'termo aplicado ao abrir' },
  ],
  templates: [
    {
      key: 'scopeFilter',
      label: 'Escopo',
      type: 'select',
      default: 'all',
      options: [
        { value: 'all', label: 'Todos escopos' },
        { value: 'ticket', label: 'Ticket' },
        { value: 'email', label: 'E-mail' },
        { value: 'whatsapp', label: 'WhatsApp' },
      ],
    },
    { key: 'search', label: 'Busca fixa', type: 'text', default: '', placeholder: 'termo aplicado ao abrir' },
  ],
  arquivados: [
    { key: 'search', label: 'Busca fixa', type: 'text', default: '', placeholder: 'termo aplicado ao abrir' },
  ],
}

export function supportViewFields(sourceKey: string): SupportViewField[] {
  return SUPPORT_VIEW_FIELDS[sourceKey] ?? []
}

/** Resumo curto da visão pro menu/tooltip — só o que difere do padrão da tela. */
export function describeSupportView(sourceKey: string, config: Record<string, string>): string {
  const parts: string[] = []
  for (const field of supportViewFields(sourceKey)) {
    const value = config[field.key]
    if (!value || value === field.default) continue
    const label = field.options?.find((o) => o.value === value)?.label ?? value
    parts.push(`${field.label}: ${label}`)
  }
  return parts.join(' · ')
}
