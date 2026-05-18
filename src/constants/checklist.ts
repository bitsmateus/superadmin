import type { BriefingData, ChecklistItem } from '@/types/client'

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
    id: 'chatbot_configured',
    label: 'ChatBot configurado',
    children: [
      { id: 'chatbot_greeting', label: 'Mensagem de saudação' },
      { id: 'chatbot_conditions', label: 'Condições' },
      { id: 'chatbot_general', label: 'Configurações Gerais' },
    ],
  },
  {
    id: 'channels_created',
    label: 'Canais criados',
    children: [
      { id: 'channels_phone_0', label: 'Número 1' },
      { id: 'channels_phone_1', label: 'Número 2' },
      { id: 'channels_instagram', label: 'Instagram' },
      { id: 'channels_facebook', label: 'Facebook' },
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
 * Rebuilds the checklist tree, injecting briefing-derived children for
 * "channels_created" (phone numbers + Instagram/Facebook when applicable),
 * while preserving the check state of items whose IDs already exist.
 */
export function enrichChecklistFromBriefing(
  current: ChecklistItem[] | undefined,
  briefing: BriefingData | undefined,
): ChecklistItem[] {
  const base = current && current.length > 0 ? current : buildDefaultChecklist()
  const existing = indexItems(base)

  const carryState = (it: ChecklistItem): ChecklistItem => {
    const prev = existing.get(it.id)
    return {
      ...it,
      checked: prev?.checked ?? false,
      checkedAt: prev?.checkedAt,
      checkedBy: prev?.checkedBy,
      children: it.children?.map(carryState),
    }
  }

  const tree = buildDefaultChecklist().map(carryState)

  if (briefing) {
    const channels = tree.find((n) => n.id === 'channels_created')
    if (channels) {
      const dynamicChildren: ChecklistItem[] = []

      const phones = briefing.whatsappNumbers ?? []
      phones.forEach((phone, i) => {
        const id = `channels_phone_${i}`
        const prev = existing.get(id)
        dynamicChildren.push({
          id,
          label: `Número ${i + 1} (${phone})`,
          checked: prev?.checked ?? false,
          checkedAt: prev?.checkedAt,
          checkedBy: prev?.checkedBy,
        })
      })

      const igPrev = existing.get('channels_instagram')
      dynamicChildren.push({
        id: 'channels_instagram',
        label: 'Instagram',
        checked: igPrev?.checked ?? false,
        checkedAt: igPrev?.checkedAt,
        checkedBy: igPrev?.checkedBy,
      })

      if (briefing.useFacebook) {
        const fbPrev = existing.get('channels_facebook')
        dynamicChildren.push({
          id: 'channels_facebook',
          label: 'Facebook',
          checked: fbPrev?.checked ?? false,
          checkedAt: fbPrev?.checkedAt,
          checkedBy: fbPrev?.checkedBy,
        })
      }

      channels.children = dynamicChildren
    }
  }

  return tree
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
