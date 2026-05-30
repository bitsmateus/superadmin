/**
 * Backup manual de clientes + settings. Mantemos client-side por simplicidade
 * (sem job server-side). O usuário baixa um JSON e guarda onde quiser.
 *
 * Restore aceita o mesmo JSON e faz upsert via Supabase. Como pode sobrescrever
 * dados em produção, é uma operação destrutiva — só admin executa.
 */
import { api } from '@/services/api'
import { analyticsService } from '@/services/analytics'
import { db } from '@/services/db'
import type { AppSettings, Client } from '@/types/client'

export interface BackupPayload {
  version: 1
  createdAt: string
  clients: Client[]
  settings: AppSettings
}

export function buildBackup(): BackupPayload {
  return {
    version: 1,
    createdAt: new Date().toISOString(),
    clients: db.getClients(),
    settings: db.getSettings(),
  }
}

export function downloadBackupFile(): BackupPayload {
  const payload = buildBackup()
  const blob = new Blob([JSON.stringify(payload, null, 2)], {
    type: 'application/json',
  })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
  a.download = `tenanthub-backup-${ts}.json`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)

  // Marca último backup nas settings + audit
  const now = new Date().toISOString()
  db.saveSettings({ lastBackupAt: now })
  void analyticsService.recordEvent({
    entityType: 'backup',
    action: 'export',
    summary: `Backup exportado (${payload.clients.length} clientes)`,
    changes: {
      clientsCount: payload.clients.length,
      hasSettings: Object.keys(payload.settings).length > 0,
    },
  })

  return payload
}

export async function readBackupFile(file: File): Promise<BackupPayload> {
  const text = await file.text()
  const parsed = JSON.parse(text)
  if (!parsed || parsed.version !== 1 || !Array.isArray(parsed.clients)) {
    throw new Error('Arquivo de backup inválido (versão ou formato).')
  }
  return parsed as BackupPayload
}

export interface RestoreResult {
  clientsInserted: number
  clientsUpdated: number
  clientsSkipped: number
  settingsRestored: boolean
  errors: string[]
}

/**
 * Restaura backup com estratégia merge:
 *   - clients: upsert por id (existente é sobrescrito; novo é inserido)
 *   - settings: opcional, off por padrão (sobrescreve config atual)
 *
 * Roda sequencial em lotes pequenos pra não estourar o Postgres.
 */
export async function restoreBackup(
  payload: BackupPayload,
  options: { overwriteSettings?: boolean },
): Promise<RestoreResult> {
  const result: RestoreResult = {
    clientsInserted: 0,
    clientsUpdated: 0,
    clientsSkipped: 0,
    settingsRestored: false,
    errors: [],
  }

  const existing = new Set(db.getClients().map((c) => c.id))

  for (const c of payload.clients) {
    try {
      const row = clientToRowForUpsert(c)
      if (existing.has(c.id)) {
        await api.patch(`/api/clients/${c.id}`, row)
        result.clientsUpdated++
      } else {
        await api.post('/api/clients', row)
        result.clientsInserted++
      }
    } catch (err) {
      result.errors.push(`${c.id}: ${err instanceof Error ? err.message : String(err)}`)
      result.clientsSkipped++
    }
  }

  if (options.overwriteSettings && payload.settings) {
    db.saveSettings(payload.settings)
    result.settingsRestored = true
  }

  await analyticsService.recordEvent({
    entityType: 'backup',
    action: 'restore',
    summary: `Backup restaurado (${result.clientsInserted} novos, ${result.clientsUpdated} atualizados)`,
    changes: {
      inserted: result.clientsInserted,
      updated: result.clientsUpdated,
      skipped: result.clientsSkipped,
      settingsRestored: result.settingsRestored,
      errors: result.errors.length,
    },
  })

  return result
}

/**
 * Converte Client (camelCase) pra ClientRow (snake_case) pra upsert.
 * Espelho do patchToRow do db.ts, mas pra um Client completo.
 */
function clientToRowForUpsert(c: Client): Record<string, unknown> {
  return {
    id: c.id,
    name: c.name,
    email: c.email,
    phone: c.phone,
    company: c.company,
    responsavel: c.responsavel ?? null,
    stage: c.stage,
    tenant_id: c.tenantId ?? null,
    tenant_server_id: c.tenantServerId ?? null,
    tenant_api_id: c.tenantApiId ?? null,
    tenant_api_token: c.tenantApiToken ?? null,
    tenant_name: c.tenantName ?? null,
    support_email: c.supportEmail ?? null,
    support_password: c.supportPassword ?? null,
    contract_url: c.contractUrl ?? null,
    contract_sent_at: c.contractSentAt ?? null,
    contract_signed_at: c.contractSignedAt ?? null,
    asaas_customer_id: c.asaasCustomerId ?? null,
    asaas_payment_id: c.asaasPaymentId ?? null,
    asaas_subscription_id: c.asaasSubscriptionId ?? null,
    implementation_value: c.implementationValue ?? null,
    monthly_value: c.monthlyValue ?? null,
    due_day: c.dueDay ?? null,
    payment_status: c.paymentStatus ?? null,
    last_payment_check: c.lastPaymentCheck ?? null,
    payments: c.payments ?? [],
    extra_links: c.extraLinks ?? [],
    finance_notes: c.financeNotes ?? null,
    briefing_token: c.briefingToken ?? null,
    briefing_status: c.briefingStatus ?? null,
    briefing_sent_at: c.briefingSentAt ?? null,
    briefing_data: c.briefingData ?? null,
    briefing_approved_at: c.briefingApprovedAt ?? null,
    briefing_revision_note: c.briefingRevisionNote ?? null,
    delivery_checklist: c.deliveryChecklist ?? [],
    delivery_handoff_checklist: c.deliveryHandoffChecklist ?? [],
    delivery_date: c.deliveryDate ?? null,
    delivery_notes: c.deliveryNotes ?? null,
    delivery_completed_at: c.deliveryCompletedAt ?? null,
    followup_active: c.followUpActive,
    followups: c.followUps ?? [],
    notes: c.notes ?? [],
    logs: c.logs ?? [],
    has_api_oficial: c.hasApiOficial ?? false,
    has_ia: c.hasIa ?? false,
    has_automacao_externa: c.hasAutomacaoExterna ?? false,
  }
}

/** Dias desde último backup, ou null se nunca foi feito. */
export function daysSinceLastBackup(settings: AppSettings): number | null {
  if (!settings.lastBackupAt) return null
  const ms = Date.now() - new Date(settings.lastBackupAt).getTime()
  return Math.floor(ms / (24 * 60 * 60 * 1000))
}
