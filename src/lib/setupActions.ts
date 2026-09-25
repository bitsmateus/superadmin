import { db } from '@/services/db'
import { buildFollowUps, DEFAULT_FOLLOWUP_TEMPLATES } from '@/constants/followup'
import { buildHandoffChecklist, setChecklistItem, toggleChecklistItem } from '@/constants/checklist'
import { setupTree, shouldMoveToSetupDone } from '@/lib/setupSteps'
import type { ChecklistItem, Client } from '@/types/client'

/** Grava o checklist e, se a configuração ficou completa, leva o cliente pra "Pronto para Entrega". */
function persistChecklist(client: Client, next: ChecklistItem[], log: string): { advanced: boolean } {
  const advance = shouldMoveToSetupDone(client, next)
  db.updateClient(client.id, {
    deliveryChecklist: next,
    ...(advance ? { stage: 'setup_done' as const, setupStartedAt: undefined } : {}),
  })
  db.addLog(client.id, 'Checklist atualizado', log)
  if (advance) {
    db.addLog(client.id, 'Etapa: Pronto para Entrega', 'Avançado automaticamente ao concluir tenant, configuração e teste')
  }
  return { advanced: advance }
}

/** Marca/desmarca um item do checklist do cliente. */
export function toggleSetupItem(client: Client, id: string, label: string, user: string | undefined) {
  const tree = setupTree(client)
  const current = tree.find((t) => t.id === id)
  const next = toggleChecklistItem(tree, id, user)
  return persistChecklist(client, next, `${label}: ${current?.checked ? 'desmarcado' : 'concluído'}`)
}

/** Marca um item como feito pelo sistema (ex.: chatbot/IA gerado) — só marca, nunca desmarca. */
export function markSetupItemDone(client: Client, id: string, label: string, by = 'Sistema') {
  const tree = setupTree(client)
  if (tree.find((t) => t.id === id)?.checked) return
  persistChecklist(client, setChecklistItem(tree, id, true, by), `${label}: concluído`)
}

/** Define a data da entrega. Quem está em Configuração passa pra "Entrega" (mesma regra da aba Entrega). */
export function saveDeliveryDate(client: Client, deliveryDate: string, user: string | undefined) {
  const handoff = client.deliveryHandoffChecklist ?? buildHandoffChecklist()
  const willAdvance = Boolean(deliveryDate) && (client.stage === 'setup' || client.stage === 'setup_done')
  db.updateClient(client.id, {
    deliveryDate: deliveryDate || undefined,
    ...(deliveryDate && !handoff.find((i) => i.id === 'handoff_meeting_scheduled')?.checked
      ? { deliveryHandoffChecklist: setChecklistItem(handoff, 'handoff_meeting_scheduled', true, user) }
      : {}),
    ...(willAdvance ? { stage: 'delivery' as const } : {}),
  })
  db.addLog(client.id, 'Data da entrega definida', deliveryDate || undefined)
  if (willAdvance) db.addLog(client.id, 'Etapa: Entrega', 'Avançado automaticamente ao definir a data da entrega')
}

/** Entrega concluída → "Entregas Recentes" + follow-ups (mesma regra do botão da aba Entrega). */
export function completeClientDelivery(client: Client) {
  const now = new Date()
  const templates = db.getSettings().followUpTemplates
    ? { ...DEFAULT_FOLLOWUP_TEMPLATES, ...db.getSettings().followUpTemplates }
    : DEFAULT_FOLLOWUP_TEMPLATES
  db.updateClient(client.id, {
    deliveryCompletedAt: now.toISOString(),
    stage: 'delivered',
    followUpActive: true,
    followUps: buildFollowUps(client, now, templates),
  })
  db.addLog(client.id, 'Entrega concluída', 'Movido para Entregas Recentes · follow-ups dia 3/7/15/30 agendados')
}

/** 100% finalizado → cliente Ativo. */
export function finalizeClient(client: Client) {
  db.updateClient(client.id, { stage: 'active' })
  db.addLog(client.id, 'Etapa: Ativo', 'Configuração e entrega 100% finalizadas')
}
