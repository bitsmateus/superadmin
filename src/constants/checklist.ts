import type { BriefingConfig, BriefingData, ChecklistItem } from '@/types/client'

export interface ChecklistTemplate {
  id: string
  label: string
  children?: ChecklistTemplate[]
}

export const DEFAULT_DELIVERY_CHECKLIST: ChecklistTemplate[] = [
  { id: 'tenant_created', label: 'Tenant criado no sistema' },
  { id: 'users_created', label: 'Usuários criados' },
  { id: 'queues_created', label: 'Filas criadas' },
  {
    id: 'channels_created',
    label: 'Canais criados',
    children: [
      { id: 'channels_phone_0', label: 'Número 1' },
      { id: 'channels_instagram', label: 'Instagram' },
    ],
  },
  {
    id: 'chatbot_configured',
    label: 'ChatBot configurado',
    children: [
      { id: 'chatbot_greeting', label: 'Mensagem de saudação' },
      { id: 'chatbot_conditions', label: 'Condições' },
      { id: 'chatbot_general', label: 'Configurações Gerais' },
    ],
  },
  {
    id: 'users_assigned',
    label: 'Usuários',
    children: [
      {
        id: 'users_assigned_queues_channels',
        label: 'Filas e Canais atribuídos',
      },
    ],
  },
  {
    id: 'schedule_configured',
    label: 'Horário de atendimento',
    children: [
      { id: 'schedule_hours', label: 'Horários configurados' },
      {
        id: 'schedule_off_message',
        label: 'Mensagem de fora de expediente',
      },
    ],
  },
  { id: 'general_settings', label: 'Configurações gerais' },
  { id: 'chatbot_active', label: 'Ativado chatbot ou IA no canal' },
  {
    id: 'support_tested',
    label: 'Número de suporte conectado e realizado testes',
  },
]

function templateToItem(t: ChecklistTemplate): ChecklistItem {
  return {
    id: t.id,
    label: t.label,
    checked: false,
    children: t.children?.map(templateToItem),
  }
}

export function buildDefaultChecklist(): ChecklistItem[] {
  return DEFAULT_DELIVERY_CHECKLIST.map(templateToItem)
}

export const DEFAULT_HANDOFF_CHECKLIST: ChecklistTemplate[] = [
  { id: 'handoff_meeting_scheduled', label: 'Reunião agendada' },
  { id: 'handoff_access_sent', label: 'Acessos do cliente enviados' },
  { id: 'handoff_meeting_done', label: 'Reunião realizada' },
]

export function buildHandoffChecklist(): ChecklistItem[] {
  return DEFAULT_HANDOFF_CHECKLIST.map(templateToItem)
}

/**
 * Walks a checklist tree and returns a flat map of id → item, used to preserve
 * check state when rebuilding the tree from briefing data.
 */
function indexItems(items: ChecklistItem[]): Map<string, ChecklistItem> {
  const map = new Map<string, ChecklistItem>()
  const walk = (list: ChecklistItem[]) => {
    for (const it of list) {
      map.set(it.id, it)
      if (it.children) walk(it.children)
    }
  }
  walk(items)
  return map
}

/**
 * Rebuilds the checklist tree dynamically from briefing data and config,
 * while preserving the check state of items whose IDs already exist.
 *
 * Dynamic behaviour:
 * - channels_created children: derived from briefing phone numbers + cfg channels
 * - api_oficial: added when connectionTypes includes 'api_oficial'
 * - chatbot_configured: shown when chatbot in automationTypes (or no cfg)
 * - ia_configured: added when ia_basica or ia_avancada in automationTypes
 */
export function enrichChecklistFromBriefing(
  current: ChecklistItem[] | undefined,
  briefing: BriefingData | undefined,
  briefingConfig?: BriefingConfig | null,
): ChecklistItem[] {
  const base = current && current.length > 0 ? current : buildDefaultChecklist()
  const existing = indexItems(base)
  const cfg = briefingConfig ?? null

  const carry = (id: string, label: string, children?: ChecklistItem[]): ChecklistItem => {
    const prev = existing.get(id)
    return {
      id,
      label,
      checked: prev?.checked ?? false,
      checkedAt: prev?.checkedAt,
      checkedBy: prev?.checkedBy,
      ...(children !== undefined ? { children } : {}),
    }
  }

  const result: ChecklistItem[] = []

  // Fixed: tenant, users, queues
  result.push(carry('tenant_created', 'Tenant criado no sistema'))
  result.push(carry('users_created', 'Usuários criados'))
  result.push(carry('queues_created', 'Filas criadas'))

  // Channels — dynamic children
  result.push(carry('channels_created', 'Canais criados', buildChannelChildren(briefing, cfg, existing)))

  // API Oficial (conditional)
  if (cfg?.connectionTypes.includes('api_oficial')) {
    result.push(carry('api_oficial', 'API Oficial configurada'))
  }

  // Chatbot (always if no cfg, conditional if cfg)
  if (!cfg || cfg.automationTypes.includes('chatbot')) {
    result.push(carry('chatbot_configured', 'ChatBot configurado', [
      carry('chatbot_greeting', 'Mensagem de saudação'),
      carry('chatbot_conditions', 'Condições'),
      carry('chatbot_general', 'Configurações Gerais'),
    ]))
  }

  // IA (conditional)
  if (cfg?.automationTypes.some((t) => t === 'ia_basica' || t === 'ia_avancada')) {
    const iaChildren: ChecklistItem[] = []
    iaChildren.push(carry('ia_prompt', 'Prompt da IA criado e testado'))
    if (cfg.automationTypes.includes('ia_avancada')) {
      iaChildren.push(carry('ia_integration', 'Integração com sistema externo configurada'))
    }
    const iaLabel = cfg.automationTypes.includes('ia_avancada')
      ? 'IA Avançada configurada'
      : 'IA Básica configurada'
    result.push(carry('ia_configured', iaLabel, iaChildren))
  }

  // Fixed remaining
  result.push(carry('users_assigned', 'Usuários', [
    carry('users_assigned_queues_channels', 'Filas e Canais atribuídos'),
  ]))
  result.push(carry('schedule_configured', 'Horário de atendimento', [
    carry('schedule_hours', 'Horários configurados'),
    carry('schedule_off_message', 'Mensagem de fora de expediente'),
  ]))
  result.push(carry('general_settings', 'Configurações gerais'))
  result.push(carry('chatbot_active', 'Ativado chatbot ou IA no canal'))
  result.push(carry('support_tested', 'Número de suporte conectado e realizado testes'))

  return result
}

const EXTRA_CHANNEL_MAP = [
  { key: 'instagram' as const, id: 'channels_instagram', label: 'Instagram' },
  { key: 'messenger' as const, id: 'channels_facebook', label: 'Facebook / Messenger' },
  { key: 'wavoip' as const, id: 'channels_wavoip', label: 'WaVoip' },
  { key: 'olx' as const, id: 'channels_olx', label: 'OLX' },
  { key: 'mercadolivre' as const, id: 'channels_mercadolivre', label: 'Mercado Livre' },
  { key: 'email' as const, id: 'channels_email', label: 'E-mail' },
]

function buildChannelChildren(
  briefing: BriefingData | undefined,
  cfg: BriefingConfig | null,
  existing: Map<string, ChecklistItem>,
): ChecklistItem[] {
  const children: ChecklistItem[] = []

  const carry = (id: string, label: string): ChecklistItem => {
    const prev = existing.get(id)
    return {
      id,
      label,
      checked: prev?.checked ?? false,
      checkedAt: prev?.checkedAt,
      checkedBy: prev?.checkedBy,
    }
  }

  // WhatsApp numbers from briefing data
  const phones = briefing?.whatsappNumbers ?? []
  if (phones.length > 0) {
    phones.forEach((phone, i) => {
      children.push(carry(`channels_phone_${i}`, `WhatsApp ${i + 1}${phone ? ` (${phone})` : ''}`))
    })
  } else {
    children.push(carry('channels_phone_0', 'Número 1'))
  }

  // Other channels
  for (const { key, id, label } of EXTRA_CHANNEL_MAP) {
    let show: boolean
    if (cfg) {
      show = cfg.channels.includes(key)
    } else {
      // Backward compat when no config: show instagram always, facebook if useFacebook
      show = key === 'instagram' || (key === 'messenger' && (briefing?.useFacebook ?? false))
    }
    if (show) children.push(carry(id, label))
  }

  return children
}

/**
 * Flatten the tree counting checked vs total items (parents + children).
 */
export function checklistProgress(items: ChecklistItem[]): {
  done: number
  total: number
} {
  let done = 0
  let total = 0
  const walk = (list: ChecklistItem[]) => {
    for (const it of list) {
      total++
      if (it.checked) done++
      if (it.children) walk(it.children)
    }
  }
  walk(items)
  return { done, total }
}

/**
 * Toggles a single item by id in the tree, returning a new tree.
 */
export function toggleChecklistItem(
  items: ChecklistItem[],
  id: string,
  user: string | undefined,
): ChecklistItem[] {
  return items.map((it) => {
    if (it.id === id) {
      const next = !it.checked
      return {
        ...it,
        checked: next,
        checkedAt: next ? new Date().toISOString() : undefined,
        checkedBy: next ? user || 'Anônimo' : undefined,
        children: it.children,
      }
    }
    if (it.children) {
      return { ...it, children: toggleChecklistItem(it.children, id, user) }
    }
    return it
  })
}

/**
 * Force-set a single item by id to a desired checked state. Used by
 * "Criar tenant" / "Criar usuários" to mark steps as done.
 */
export function setChecklistItem(
  items: ChecklistItem[],
  id: string,
  checked: boolean,
  user: string | undefined,
): ChecklistItem[] {
  return items.map((it) => {
    if (it.id === id) {
      return {
        ...it,
        checked,
        checkedAt: checked ? new Date().toISOString() : undefined,
        checkedBy: checked ? user || 'Sistema' : undefined,
        children: it.children,
      }
    }
    if (it.children) {
      return {
        ...it,
        children: setChecklistItem(it.children, id, checked, user),
      }
    }
    return it
  })
}
