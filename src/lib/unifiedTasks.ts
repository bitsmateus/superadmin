import { computeSetup, SETUP_BOARD_STAGES, SETUP_STEP_LABEL, type SetupStepKey } from '@/lib/setupSteps'
import { resolveStageSla } from '@/constants/stageColors'
import { daysSince } from '@/lib/time'
import type { Client, PipelineStage } from '@/types/client'
import type { Reminder, ReminderPriority, Ticket, TicketPriority } from '@/types/ticket'
import type { TeamMember } from '@/hooks/useTeam'

/**
 * Unifica as 3 fontes de trabalho da tela "Tarefas" (tarefa manual / ticket de
 * suporte / cliente em implementação) numa única lista, com o mesmo formato
 * visual — usado só pela visão "Lista" (Kanban e Configuração continuam lendo
 * direto de `reminders`/`clients`, sem passar por aqui).
 */
export type UnifiedKind = 'task' | 'ticket' | 'setup'

export const UNIFIED_KIND_LABEL: Record<UnifiedKind, string> = {
  task: 'Tarefa',
  ticket: 'Suporte',
  setup: 'Implementação',
}

export interface UnifiedItem {
  id: string
  kind: UnifiedKind
  title: string
  clientId?: string | null
  company?: string
  dueAt?: string | null
  priority: ReminderPriority
  ownerId?: string | null
  /** Dias além do prazo — só preenchido pra 'setup' (mesma conta do SetupBoard). */
  overdueDays?: number
  reminder?: Reminder
  ticket?: Ticket
  client?: Client
  /** Item pendente do checklist do cliente (só 'setup') — dá pra concluir direto da lista quando `manual`. */
  setupPending?: { id: string; label: string; manual: boolean; stepKey: SetupStepKey }
}

function resolveTeamId(team: TeamMember[], name?: string | null): string | undefined {
  const n = (name ?? '').trim().toLowerCase()
  if (!n) return undefined
  const hit = team.find(
    (m) => (m.name ?? '').trim().toLowerCase() === n || m.email.trim().toLowerCase() === n,
  )
  return hit?.id
}

function ticketPriorityToUnified(p: TicketPriority): ReminderPriority {
  if (p === 'urgent' || p === 'high') return 'high'
  if (p === 'low') return 'low'
  return 'normal'
}

export function buildUnifiedItems(opts: {
  reminders: Reminder[]
  tickets: Ticket[]
  clients: Client[]
  team: TeamMember[]
  slaByStage?: Partial<Record<PipelineStage, number>>
  companyOf: (id?: string | null) => string | undefined
}): UnifiedItem[] {
  const { reminders, tickets, clients, team, slaByStage, companyOf } = opts
  const items: UnifiedItem[] = []

  for (const r of reminders) {
    if (r.completedAt) continue
    items.push({
      id: `task:${r.id}`,
      kind: 'task',
      title: r.title,
      clientId: r.clientId,
      company: companyOf(r.clientId),
      dueAt: r.dueAt,
      priority: r.priority ?? 'normal',
      ownerId: r.userId,
      reminder: r,
    })
  }

  for (const t of tickets) {
    if (t.status === 'resolved' || t.status === 'closed') continue
    items.push({
      id: `ticket:${t.id}`,
      kind: 'ticket',
      title: t.subject,
      clientId: t.clientId,
      company: (t.clientId && companyOf(t.clientId)) || t.customerCompany || t.customerName,
      dueAt: t.slaDueAt ?? null,
      priority: ticketPriorityToUnified(t.priority),
      ownerId: t.assigneeId ?? null,
      ticket: t,
    })
  }

  for (const c of clients) {
    if (!SETUP_BOARD_STAGES.includes(c.stage)) continue
    const s = computeSetup(c)
    if (!s.current) continue // 100% concluído — não entra na lista de pendências
    const cur = s.steps.find((x) => x.key === s.current)!
    const pendingItem = cur.items.find((i) => !i.checked)
    const sla = resolveStageSla(c.stage, slaByStage)
    const days = daysSince(c.stageUpdatedAt ?? c.createdAt)
    const over = sla != null && days > sla ? days - sla : 0
    let dueAt: string | null = null
    if (sla != null) {
      const base = new Date(c.stageUpdatedAt ?? c.createdAt)
      base.setDate(base.getDate() + sla)
      dueAt = base.toISOString()
    }
    items.push({
      id: `setup:${c.id}`,
      kind: 'setup',
      title: pendingItem ? `Falta: ${pendingItem.label}` : `${SETUP_STEP_LABEL[s.current]} — etapa concluída`,
      clientId: c.id,
      company: c.company || c.name,
      dueAt,
      priority: over > 0 ? 'high' : 'normal',
      ownerId: resolveTeamId(team, c.responsavelEntrega) ?? resolveTeamId(team, c.responsavel) ?? null,
      overdueDays: over,
      client: c,
      setupPending: pendingItem
        ? { id: pendingItem.id, label: pendingItem.label, manual: pendingItem.manual, stepKey: s.current }
        : undefined,
    })
  }

  return items
}

const PRIO_RANK: Record<ReminderPriority, number> = { high: 3, normal: 2, low: 1 }

/** Prioridade (desc) e depois prazo mais próximo (asc, sem prazo vai pro fim). */
export function sortUnified(items: UnifiedItem[]): UnifiedItem[] {
  const dueTime = (i: UnifiedItem) => (i.dueAt ? new Date(i.dueAt).getTime() : Number.MAX_SAFE_INTEGER)
  return [...items].sort((a, b) => PRIO_RANK[b.priority] - PRIO_RANK[a.priority] || dueTime(a) - dueTime(b))
}
