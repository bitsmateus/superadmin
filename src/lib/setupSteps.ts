import { enrichChecklistFromBriefing } from '@/constants/checklist'
import type { ChecklistItem, Client, PipelineStage } from '@/types/client'

/**
 * As 5 etapas de configuração/entrega — as mesmas colunas pra todo cliente.
 * O estado é DERIVADO do que o cliente já tem (checklist, briefing, tenant, datas, etapa do pipeline),
 * então clientes que já estavam no meio da entrega caem na etapa certa sozinhos.
 */
export type SetupStepKey = 'briefing' | 'tenant' | 'config' | 'test' | 'delivery'

export const SETUP_STEP_ORDER: SetupStepKey[] = ['briefing', 'tenant', 'config', 'test', 'delivery']

export const SETUP_STEP_LABEL: Record<SetupStepKey, string> = {
  briefing: 'Briefing',
  tenant: 'Criação da empresa',
  config: 'Configuração',
  test: 'Teste',
  delivery: 'Entrega',
}

export interface SetupItem {
  id: string
  label: string
  checked: boolean
  checkedBy?: string
  checkedAt?: string
  /** true = item do checklist salvo (dá pra marcar à mão); false = vem do sistema. */
  manual: boolean
}

export interface SetupStep {
  key: SetupStepKey
  label: string
  items: SetupItem[]
  done: boolean
  doneCount: number
}

export interface SetupState {
  steps: SetupStep[]
  /** Etapa em andamento; null = tudo concluído (cliente 100% finalizado). */
  current: SetupStepKey | null
  percent: number
}

/** Etapas do pipeline em que o cliente aparece no quadro de configuração. */
export const SETUP_BOARD_STAGES: PipelineStage[] = [
  'briefing',
  'setup_start',
  'setup',
  'setup_done',
  'delivery',
  'delivered',
]

/** Piso por etapa do pipeline: quem já foi movido pra frente não volta pra uma coluna anterior. */
const MIN_STEP_BY_STAGE: Partial<Record<PipelineStage, SetupStepKey>> = {
  briefing: 'briefing',
  setup_start: 'tenant',
  setup: 'tenant',
  setup_done: 'test',
  delivery: 'delivery',
  delivered: 'delivery',
}

const TENANT_IDS = ['tenant_created', 'users_created', 'queues_created', 'channels_created']
const CONFIG_IDS = [
  'api_oficial',
  'flow_generated',
  'chatbot_configured',
  'ia_configured',
  'users_assigned',
  'schedule_configured',
  'general_settings',
  'chatbot_active',
]

/** Rótulos curtos (o checklist completo continua com os nomes longos em "Avançado"). */
const SHORT_LABEL: Record<string, string> = {
  tenant_created: 'Tenant criado',
  users_created: 'Usuários criados',
  queues_created: 'Filas criadas',
  channels_created: 'Canais criados',
  api_oficial: 'API Oficial configurada',
  flow_generated: 'Chatbot/IA gerado',
  chatbot_configured: 'Chatbot configurado no sistema',
  ia_configured: 'IA configurada no sistema',
  users_assigned: 'Usuários nas filas e canais',
  schedule_configured: 'Horário de atendimento',
  general_settings: 'Configurações gerais',
  chatbot_active: 'Ativado no canal',
  support_tested: 'Chatbot/IA testado',
}

export function setupTree(client: Client): ChecklistItem[] {
  return enrichChecklistFromBriefing(client.deliveryChecklist, client.briefingData, client.briefingConfig)
}

function fromTree(tree: ChecklistItem[], ids: string[], client: Client): SetupItem[] {
  const out: SetupItem[] = []
  for (const id of ids) {
    const it = tree.find((t) => t.id === id)
    if (!it) continue
    let checked = it.checked
    // Vindo de antes do "Chatbot/IA gerado" existir: quem já tinha o chatbot/IA marcado conta como gerado.
    if (id === 'flow_generated' && !checked) {
      checked = Boolean(
        tree.find((t) => t.id === 'chatbot_configured')?.checked || tree.find((t) => t.id === 'ia_configured')?.checked,
      )
    }
    if (id === 'tenant_created' && !checked) checked = Boolean(client.tenantId)
    out.push({
      id,
      label: SHORT_LABEL[id] ?? it.label,
      checked,
      checkedBy: it.checkedBy,
      checkedAt: it.checkedAt,
      manual: true,
    })
  }
  return out
}

function step(key: SetupStepKey, items: SetupItem[]): SetupStep {
  const doneCount = items.filter((i) => i.checked).length
  return { key, label: SETUP_STEP_LABEL[key], items, doneCount, done: items.length > 0 && doneCount === items.length }
}

export function computeSetup(client: Client, tree: ChecklistItem[] = setupTree(client)): SetupState {
  // O briefing só conta como concluído quando o cliente PREENCHE (enviar o link não basta).
  const briefingSent = client.briefingStatus === 'filled' || client.briefingStatus === 'approved'
  const delivered = Boolean(client.deliveryCompletedAt) || client.stage === 'delivered' || client.stage === 'active'

  const steps: SetupStep[] = [
    step('briefing', [
      { id: 'briefing_sent', label: 'Briefing preenchido pelo cliente', checked: briefingSent, manual: false },
    ]),
    step('tenant', fromTree(tree, TENANT_IDS, client)),
    step('config', fromTree(tree, CONFIG_IDS, client)),
    step('test', fromTree(tree, ['support_tested'], client)),
    step('delivery', [
      { id: 'delivery_date', label: 'Data da entrega definida', checked: Boolean(client.deliveryDate), manual: false },
      { id: 'delivery_done', label: 'Entrega realizada ao cliente', checked: delivered, manual: false },
      { id: 'delivery_final', label: '100% finalizado', checked: client.stage === 'active', manual: false },
    ]),
  ]

  const firstOpen = steps.findIndex((s) => !s.done)
  const floorKey = MIN_STEP_BY_STAGE[client.stage]
  const floorIdx = floorKey ? SETUP_STEP_ORDER.indexOf(floorKey) : 0
  const currentIdx = firstOpen === -1 || client.stage === 'active' ? -1 : Math.max(firstOpen, floorIdx)

  // Etapas antes da atual contam como concluídas (o cliente já passou por elas).
  const resolved = steps.map((s, i) => (currentIdx === -1 || i < currentIdx ? { ...s, done: true } : s))
  const total = steps.reduce((n, s) => n + s.items.length, 0)
  const checked = resolved.reduce(
    (n, s) => n + (s.done ? s.items.length : s.doneCount),
    0,
  )
  return {
    steps: resolved,
    current: currentIdx === -1 ? null : SETUP_STEP_ORDER[currentIdx],
    percent: total === 0 ? 0 : Math.round((checked / total) * 100),
  }
}

/** Cliente em "Configuração" cujo tenant, configuração e teste estão completos → "Pronto para Entrega". */
export function shouldMoveToSetupDone(client: Client, nextChecklist: ChecklistItem[]): boolean {
  if (client.stage !== 'setup') return false
  // Calcula sem o piso da etapa do pipeline, pra olhar só o que foi de fato marcado.
  const { steps } = computeSetup({ ...client, stage: 'briefing', deliveryChecklist: nextChecklist }, nextChecklist)
  return ['tenant', 'config', 'test'].every((k) => steps.find((x) => x.key === k)?.done)
}
