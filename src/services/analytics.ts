import { api, onSseEvent } from '@/services/api'
import type { AuditEntry, PipelineStage, StageHistoryEntry } from '@/types/client'

type StageHistoryRow = { id: string; client_id: string; from_stage: PipelineStage | null; to_stage: PipelineStage; at: string }
type AuditRow = { id: string; actor_id: string | null; actor_email: string | null; actor_name: string | null; entity_type: string; entity_id: string | null; action: string; summary: string | null; changes: Record<string, unknown> | null; at: string }

function rowToStageHistory(r: StageHistoryRow): StageHistoryEntry {
  return { id: r.id, clientId: r.client_id, fromStage: r.from_stage, toStage: r.to_stage, at: r.at }
}

function rowToAudit(r: AuditRow): AuditEntry {
  return {
    id: r.id, actorId: r.actor_id ?? undefined, actorEmail: r.actor_email ?? undefined,
    actorName: r.actor_name ?? undefined, entityType: r.entity_type, entityId: r.entity_id ?? undefined,
    action: r.action, summary: r.summary ?? undefined, changes: r.changes ?? undefined, at: r.at,
  }
}

let stageHistory: StageHistoryEntry[] = []
let auditEntries: AuditEntry[] = []
let booted = false
let bootingPromise: Promise<void> | null = null
let unsubSse: (() => void) | null = null

const subscribers = new Set<() => void>()
function notify() { for (const fn of subscribers) fn() }

export function isAnalyticsBooted(): boolean { return booted }

export async function bootAnalytics(): Promise<void> {
  if (bootingPromise) return bootingPromise
  bootingPromise = (async () => {
    try {
      const [hist, audit] = await Promise.allSettled([
        api.get<StageHistoryRow[]>('/api/stage-history'),
        api.get<AuditRow[]>('/api/audit-log'),
      ])
      if (hist.status === 'fulfilled') stageHistory = hist.value.map(rowToStageHistory)
      if (audit.status === 'fulfilled') auditEntries = audit.value.map(rowToAudit)
      subscribeRealtime()
      booted = true
      notify()
    } catch {
      booted = true
      notify()
    }
  })()
  return bootingPromise
}

export async function teardownAnalytics(): Promise<void> {
  unsubSse?.(); unsubSse = null
  stageHistory = []; auditEntries = []
  booted = false; bootingPromise = null
  notify()
}

function subscribeRealtime() {
  if (unsubSse) return
  unsubSse = onSseEvent((table, type, data) => {
    if (table === 'stage_history' && type === 'INSERT') {
      stageHistory = [rowToStageHistory(data as StageHistoryRow), ...stageHistory]
      notify()
    } else if (table === 'audit_log' && type === 'INSERT') {
      auditEntries = [rowToAudit(data as AuditRow), ...auditEntries]
      notify()
    }
  })
}

export const analyticsService = {
  subscribe(fn: () => void): () => void { subscribers.add(fn); return () => { subscribers.delete(fn) } },
  getStageHistory(): StageHistoryEntry[] { return stageHistory },
  getAuditEntries(): AuditEntry[] { return auditEntries },

  async recordEvent(input: { entityType: string; entityId?: string; action: string; summary?: string; changes?: Record<string, unknown> }): Promise<void> {
    try {
      await api.post('/api/audit-log', {
        entity_type: input.entityType, entity_id: input.entityId ?? null,
        action: input.action, summary: input.summary ?? null, changes: input.changes ?? null,
      })
    } catch (err) {
      console.warn('[analytics] recordEvent failed', err)
    }
  },
}
