import { db } from '@/services/db'
import { setChecklistItem, toggleChecklistItem } from '@/constants/checklist'
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
