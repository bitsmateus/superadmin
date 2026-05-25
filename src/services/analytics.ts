/**
 * Camada de dados pra analytics + auditoria.
 *
 *  - stage_history: leitura usada pra funil e tempo médio por stage
 *  - audit_log: lido só por admin (RLS); usado na página /auditoria
 *
 * Mesmo padrão do ticketsService: cache + pub/sub + realtime.
 */
import { supabase } from './supabase'
import type { AuditEntry, PipelineStage, StageHistoryEntry } from '@/types/client'

type StageHistoryRow = {
  id: string
  client_id: string
  from_stage: PipelineStage | null
  to_stage: PipelineStage
  at: string
}

function rowToStageHistory(r: StageHistoryRow): StageHistoryEntry {
  return {
    id: r.id,
    clientId: r.client_id,
    fromStage: r.from_stage,
    toStage: r.to_stage,
    at: r.at,
  }
}

type AuditRow = {
  id: string
  actor_id: string | null
  actor_email: string | null
  actor_name: string | null
  entity_type: string
  entity_id: string | null
  action: string
  summary: string | null
  changes: Record<string, unknown> | null
  at: string
}

function rowToAudit(r: AuditRow): AuditEntry {
  return {
    id: r.id,
    actorId: r.actor_id ?? undefined,
    actorEmail: r.actor_email ?? undefined,
    actorName: r.actor_name ?? undefined,
    entityType: r.entity_type,
    entityId: r.entity_id ?? undefined,
    action: r.action,
    summary: r.summary ?? undefined,
    changes: r.changes ?? undefined,
    at: r.at,
  }
}

let stageHistory: StageHistoryEntry[] = []
let auditEntries: AuditEntry[] = []
let booted = false
let bootingPromise: Promise<void> | null = null
let channel: ReturnType<typeof supabase.channel> | null = null

const subscribers = new Set<() => void>()
function notify() {
  for (const fn of subscribers) fn()
}

export function isAnalyticsBooted(): boolean {
  return booted
}

/**
 * Hidrata caches. audit_log pode dar erro pra não-admin (RLS) — tratamos
 * silenciosamente nesse caso.
 */
export async function bootAnalytics(): Promise<void> {
  if (bootingPromise) return bootingPromise
  bootingPromise = (async () => {
    try {
      const [hist, audit] = await Promise.all([
        supabase
          .from('stage_history')
          .select('*')
          .order('at', { ascending: false })
          .limit(5000),
        supabase
          .from('audit_log')
          .select('*')
          .order('at', { ascending: false })
          .limit(500),
      ])
      if (!hist.error && hist.data) {
        stageHistory = (hist.data as StageHistoryRow[]).map(rowToStageHistory)
      }
      if (!audit.error && audit.data) {
        auditEntries = (audit.data as AuditRow[]).map(rowToAudit)
      }
      // audit_log com erro = sem permissão; segue sem.

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
  if (channel) {
    await supabase.removeChannel(channel)
    channel = null
  }
  stageHistory = []
  auditEntries = []
  booted = false
  bootingPromise = null
  notify()
}

function subscribeRealtime() {
  if (channel) return
  channel = supabase
    .channel('analytics-changes')
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'stage_history' },
      (payload) => {
        const next = rowToStageHistory(payload.new as StageHistoryRow)
        stageHistory = [next, ...stageHistory]
        notify()
      },
    )
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'audit_log' },
      (payload) => {
        const next = rowToAudit(payload.new as AuditRow)
        auditEntries = [next, ...auditEntries]
        notify()
      },
    )
    .subscribe()
}

export const analyticsService = {
  subscribe(fn: () => void): () => void {
    subscribers.add(fn)
    return () => {
      subscribers.delete(fn)
    }
  },

  getStageHistory(): StageHistoryEntry[] {
    return stageHistory
  },

  getAuditEntries(): AuditEntry[] {
    return auditEntries
  },

  /**
   * Registra evento na audit_log via RPC SECURITY DEFINER. O ator vem do
   * JWT (auth.uid()), não precisa passar.
   */
  async recordEvent(input: {
    entityType: string
    entityId?: string
    action: string
    summary?: string
    changes?: Record<string, unknown>
  }): Promise<void> {
    const { error } = await supabase.rpc('audit_event_app', {
      entity_type_in: input.entityType,
      entity_id_in: input.entityId ?? null,
      action_in: input.action,
      summary_in: input.summary ?? null,
      changes_in: input.changes ?? null,
    })
    if (error) {
      // eslint-disable-next-line no-console
      console.warn('[analytics] audit_event_app failed', error)
    }
  },
}
