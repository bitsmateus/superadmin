import { toast } from 'sonner'
import {
  buildDefaultChecklist,
  buildHandoffChecklist,
} from '@/constants/checklist'
import type { Profile } from '@/services/supabase'
import { api, onSseEvent } from '@/services/api'
import { DEFAULT_SERVERS, useAuthStore } from '@/store/authStore'
import type { ServerConfig } from '@/store/authStore'
import type {
  AppSettings,
  Client,
  LogEntry,
  NoteEntry,
  PipelineStage,
} from '@/types/client'

function uuid(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  const bytes = new Uint8Array(16)
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    crypto.getRandomValues(bytes)
  } else {
    for (let i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256)
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x40
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

type ClientRow = {
  id: string
  name: string
  email: string
  phone: string
  company: string
  responsavel: string | null
  stage: PipelineStage
  created_at: string
  stage_updated_at: string
  tenant_id: string | null
  tenant_server_id: string | null
  tenant_api_id: string | null
  tenant_name: string | null
  support_email: string | null
  support_password: string | null
  contract_url: string | null
  contract_sent_at: string | null
  contract_signed_at: string | null
  asaas_customer_id: string | null
  asaas_payment_id: string | null
  asaas_subscription_id: string | null
  implementation_value: number | null
  monthly_value: number | null
  due_day: number | null
  payment_status: 'pending' | 'paid' | 'overdue' | null
  last_payment_check: string | null
  payments: Client['payments']
  extra_links: Client['extraLinks']
  finance_notes: string | null
  briefing_token: string | null
  briefing_status: 'not_sent' | 'sent' | 'filled' | 'approved' | 'revision' | null
  briefing_sent_at: string | null
  briefing_data: Client['briefingData'] | null
  briefing_approved_at: string | null
  briefing_revision_note: string | null
  briefing_config: Client['briefingConfig'] | null
  delivery_checklist: Client['deliveryChecklist']
  delivery_handoff_checklist: Client['deliveryHandoffChecklist']
  delivery_date: string | null
  delivery_notes: string | null
  delivery_completed_at: string | null
  followup_active: boolean
  followups: Client['followUps']
  notes: Client['notes']
  logs: Client['logs']
  has_api_oficial: boolean | null
  has_ia: boolean | null
  has_automacao_externa: boolean | null
  accesses: Client['accesses'] | null
  platform_app: boolean | null
  platform_web: boolean | null
  platform_chat: boolean | null
  contract_file: string | null
  contract_file_name: string | null
}

function rowToClient(r: ClientRow): Client {
  return {
    id: r.id,
    name: r.name,
    email: r.email,
    phone: r.phone,
    company: r.company,
    responsavel: r.responsavel ?? undefined,
    stage: r.stage,
    createdAt: r.created_at,
    stageUpdatedAt: r.stage_updated_at,
    tenantId: r.tenant_id ?? undefined,
    tenantServerId: r.tenant_server_id ?? undefined,
    tenantApiId: r.tenant_api_id ?? undefined,
    tenantName: r.tenant_name ?? undefined,
    supportEmail: r.support_email ?? undefined,
    supportPassword: r.support_password ?? undefined,
    contractUrl: r.contract_url ?? undefined,
    contractSentAt: r.contract_sent_at ?? undefined,
    contractSignedAt: r.contract_signed_at ?? undefined,
    asaasCustomerId: r.asaas_customer_id ?? undefined,
    asaasPaymentId: r.asaas_payment_id ?? undefined,
    asaasSubscriptionId: r.asaas_subscription_id ?? undefined,
    implementationValue: r.implementation_value ?? undefined,
    monthlyValue: r.monthly_value ?? undefined,
    dueDay: r.due_day ?? undefined,
    paymentStatus: r.payment_status ?? undefined,
    lastPaymentCheck: r.last_payment_check ?? undefined,
    payments: r.payments ?? [],
    extraLinks: r.extra_links ?? [],
    financeNotes: r.finance_notes ?? undefined,
    briefingToken: r.briefing_token ?? undefined,
    briefingStatus: r.briefing_status ?? undefined,
    briefingSentAt: r.briefing_sent_at ?? undefined,
    briefingData: r.briefing_data ?? undefined,
    briefingApprovedAt: r.briefing_approved_at ?? undefined,
    briefingRevisionNote: r.briefing_revision_note ?? undefined,
    briefingConfig: r.briefing_config ?? undefined,
    deliveryChecklist: r.delivery_checklist ?? [],
    deliveryHandoffChecklist: r.delivery_handoff_checklist ?? [],
    deliveryDate: r.delivery_date ?? undefined,
    deliveryNotes: r.delivery_notes ?? undefined,
    deliveryCompletedAt: r.delivery_completed_at ?? undefined,
    followUpActive: r.followup_active,
    followUps: r.followups ?? [],
    notes: r.notes ?? [],
    logs: r.logs ?? [],
    hasApiOficial: r.has_api_oficial ?? false,
    hasIa: r.has_ia ?? false,
    hasAutomacaoExterna: r.has_automacao_externa ?? false,
    accesses: r.accesses ?? undefined,
    platformApp: r.platform_app ?? false,
    platformWeb: r.platform_web ?? false,
    platformChat: r.platform_chat ?? false,
    contractFile: r.contract_file ?? undefined,
    contractFileName: r.contract_file_name ?? undefined,
  }
}

function patchToRow(patch: Partial<Client>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  if ('name' in patch) out.name = patch.name
  if ('email' in patch) out.email = patch.email
  if ('phone' in patch) out.phone = patch.phone
  if ('company' in patch) out.company = patch.company
  if ('responsavel' in patch) out.responsavel = patch.responsavel ?? null
  if ('stage' in patch) out.stage = patch.stage
  if ('tenantId' in patch) out.tenant_id = patch.tenantId ?? null
  if ('tenantServerId' in patch) out.tenant_server_id = patch.tenantServerId ?? null
  if ('tenantApiId' in patch) out.tenant_api_id = patch.tenantApiId ?? null
  if ('tenantName' in patch) out.tenant_name = patch.tenantName ?? null
  if ('supportEmail' in patch) out.support_email = patch.supportEmail ?? null
  if ('supportPassword' in patch) out.support_password = patch.supportPassword ?? null
  if ('contractUrl' in patch) out.contract_url = patch.contractUrl ?? null
  if ('contractSentAt' in patch) out.contract_sent_at = patch.contractSentAt ?? null
  if ('contractSignedAt' in patch) out.contract_signed_at = patch.contractSignedAt ?? null
  if ('asaasCustomerId' in patch) out.asaas_customer_id = patch.asaasCustomerId ?? null
  if ('asaasPaymentId' in patch) out.asaas_payment_id = patch.asaasPaymentId ?? null
  if ('asaasSubscriptionId' in patch) out.asaas_subscription_id = patch.asaasSubscriptionId ?? null
  if ('implementationValue' in patch) out.implementation_value = patch.implementationValue ?? null
  if ('monthlyValue' in patch) out.monthly_value = patch.monthlyValue ?? null
  if ('dueDay' in patch) out.due_day = patch.dueDay ?? null
  if ('paymentStatus' in patch) out.payment_status = patch.paymentStatus ?? null
  if ('lastPaymentCheck' in patch) out.last_payment_check = patch.lastPaymentCheck ?? null
  if ('payments' in patch) out.payments = patch.payments ?? []
  if ('extraLinks' in patch) out.extra_links = patch.extraLinks ?? []
  if ('financeNotes' in patch) out.finance_notes = patch.financeNotes ?? null
  if ('briefingToken' in patch) out.briefing_token = patch.briefingToken ?? null
  if ('briefingStatus' in patch) out.briefing_status = patch.briefingStatus ?? null
  if ('briefingSentAt' in patch) out.briefing_sent_at = patch.briefingSentAt ?? null
  if ('briefingData' in patch) out.briefing_data = patch.briefingData ?? null
  if ('briefingApprovedAt' in patch) out.briefing_approved_at = patch.briefingApprovedAt ?? null
  if ('briefingRevisionNote' in patch) out.briefing_revision_note = patch.briefingRevisionNote ?? null
  if ('deliveryChecklist' in patch) out.delivery_checklist = patch.deliveryChecklist ?? []
  if ('deliveryHandoffChecklist' in patch) out.delivery_handoff_checklist = patch.deliveryHandoffChecklist ?? []
  if ('deliveryDate' in patch) out.delivery_date = patch.deliveryDate ?? null
  if ('deliveryNotes' in patch) out.delivery_notes = patch.deliveryNotes ?? null
  if ('deliveryCompletedAt' in patch) out.delivery_completed_at = patch.deliveryCompletedAt ?? null
  if ('followUpActive' in patch) out.followup_active = patch.followUpActive
  if ('followUps' in patch) out.followups = patch.followUps ?? []
  if ('notes' in patch) out.notes = patch.notes ?? []
  if ('logs' in patch) out.logs = patch.logs ?? []
  if ('hasApiOficial' in patch) out.has_api_oficial = patch.hasApiOficial ?? false
  if ('hasIa' in patch) out.has_ia = patch.hasIa ?? false
  if ('hasAutomacaoExterna' in patch) out.has_automacao_externa = patch.hasAutomacaoExterna ?? false
  if ('briefingConfig' in patch) out.briefing_config = patch.briefingConfig ?? null
  if ('accesses' in patch) out.accesses = patch.accesses ?? null
  if ('platformApp' in patch) out.platform_app = patch.platformApp ?? false
  if ('platformWeb' in patch) out.platform_web = patch.platformWeb ?? false
  if ('platformChat' in patch) out.platform_chat = patch.platformChat ?? false
  if ('contractFile' in patch) out.contract_file = patch.contractFile ?? null
  if ('contractFileName' in patch) out.contract_file_name = patch.contractFileName ?? null
  return out
}

type SettingsRow = {
  asaas_api_key: string | null
  asaas_environment: 'sandbox' | 'production' | null
  asaas_sync_interval_min: number | null
  default_tenant_password: string | null
  default_access_password: string | null
  support_phone: string | null
  followups_enabled: boolean | null
  followup_templates: AppSettings['followUpTemplates'] | null
  nps_delay_days: number | null
  nps_enabled: boolean | null
  notify_edge_function_url: string | null
  notify_enabled: boolean | null
  goal_new_clients_monthly: number | null
  goal_mrr_monthly: number | null
  goal_nps_monthly: number | null
  goals_enabled: boolean | null
  last_backup_at: string | null
  backup_remind_days: number | null
  servers: ServerConfig[] | null
}

function rowToSettings(r: SettingsRow | null): AppSettings {
  if (!r) return {}
  return {
    asaasApiKey: r.asaas_api_key ?? undefined,
    asaasEnvironment: r.asaas_environment ?? undefined,
    asaasSyncIntervalMin: r.asaas_sync_interval_min ?? undefined,
    defaultTenantPassword: r.default_tenant_password ?? undefined,
    defaultAccessPassword: r.default_access_password ?? undefined,
    supportPhone: r.support_phone ?? undefined,
    followUpsEnabled: r.followups_enabled ?? undefined,
    followUpTemplates: r.followup_templates ?? undefined,
    npsDelayDays: r.nps_delay_days ?? undefined,
    npsEnabled: r.nps_enabled ?? undefined,
    notifyEdgeFunctionUrl: r.notify_edge_function_url ?? undefined,
    notifyEnabled: r.notify_enabled ?? undefined,
    goalNewClientsMonthly: r.goal_new_clients_monthly ?? undefined,
    goalMrrMonthly: r.goal_mrr_monthly ?? undefined,
    goalNpsMonthly: r.goal_nps_monthly ?? undefined,
    goalsEnabled: r.goals_enabled ?? undefined,
    lastBackupAt: r.last_backup_at ?? undefined,
    backupRemindDays: r.backup_remind_days ?? undefined,
  }
}

function settingsToRow(s: AppSettings): Record<string, unknown> {
  return {
    asaas_api_key: s.asaasApiKey ?? null,
    asaas_environment: s.asaasEnvironment ?? null,
    asaas_sync_interval_min: s.asaasSyncIntervalMin ?? null,
    default_tenant_password: s.defaultTenantPassword ?? null,
    default_access_password: s.defaultAccessPassword ?? null,
    support_phone: s.supportPhone ?? null,
    followups_enabled: s.followUpsEnabled ?? null,
    followup_templates: s.followUpTemplates ?? null,
    nps_delay_days: s.npsDelayDays ?? null,
    nps_enabled: s.npsEnabled ?? null,
    notify_edge_function_url: s.notifyEdgeFunctionUrl ?? null,
    notify_enabled: s.notifyEnabled ?? null,
    goal_new_clients_monthly: s.goalNewClientsMonthly ?? null,
    goal_mrr_monthly: s.goalMrrMonthly ?? null,
    goal_nps_monthly: s.goalNpsMonthly ?? null,
    goals_enabled: s.goalsEnabled ?? null,
    last_backup_at: s.lastBackupAt ?? null,
    backup_remind_days: s.backupRemindDays ?? null,
    servers: useAuthStore.getState().servers,
  }
}

/** Syncs servers from a settings row into authStore. Falls back to DEFAULT_SERVERS. */
function syncServersFromRow(row: SettingsRow | null) {
  const servers = row?.servers
  if (Array.isArray(servers) && servers.length > 0) {
    useAuthStore.getState().setServers(servers as ServerConfig[])
  } else {
    useAuthStore.getState().setServers(DEFAULT_SERVERS)
  }
}

const SETTINGS_LS_KEY = 'tenanthub_crm_settings'
function lsReadSettings(): AppSettings {
  try { return JSON.parse(window.localStorage.getItem(SETTINGS_LS_KEY) ?? 'null') ?? {} } catch { return {} }
}
function lsWriteSettings(s: AppSettings): void {
  try { window.localStorage.setItem(SETTINGS_LS_KEY, JSON.stringify(s)) } catch { /* quota */ }
}

// ---------- State ----------
let clientsCache: Client[] = []
let settingsCache: AppSettings = {}
let currentProfile: Profile | null = null

const subscribers = new Set<() => void>()
function notify() { for (const fn of subscribers) fn() }

let bootingPromise: Promise<void> | null = null
let booted = false
let unsubSse: (() => void) | null = null

export function isBooted(): boolean { return booted }

export async function bootDb(): Promise<void> {
  if (bootingPromise) return bootingPromise
  bootingPromise = (async () => {
    try {
      console.info('[db] boot: loading clients + settings…')
      const [clientRows, settingsRow] = await Promise.all([
        api.get<ClientRow[]>('/api/clients'),
        api.get<SettingsRow | null>('/api/settings').catch(() => null),
      ])
      clientsCache = (clientRows ?? []).map(rowToClient)
      const fromApi = rowToSettings(settingsRow)
      const hasData = Object.keys(fromApi).some((k) => fromApi[k as keyof AppSettings] !== undefined)
      settingsCache = hasData ? fromApi : lsReadSettings()
      if (hasData) lsWriteSettings(fromApi)

      // Sync shared server configs to authStore
      syncServersFromRow(settingsRow)

      subscribeRealtime()
      booted = true
      notify()
    } catch (err) {
      console.error('[db] boot crash', err)
      toast.error('Falha ao inicializar dados')
    }
  })()
  return bootingPromise
}

export async function teardownDb(): Promise<void> {
  unsubSse?.()
  unsubSse = null
  clientsCache = []
  settingsCache = {}
  currentProfile = null
  booted = false
  bootingPromise = null
  notify()
}

function subscribeRealtime() {
  if (unsubSse) return
  unsubSse = onSseEvent((table, type, data) => {
    if (table === 'clients') {
      if (type === 'DELETE') {
        const id = (data as { id?: string }).id
        if (id) { clientsCache = clientsCache.filter((c) => c.id !== id); notify() }
        return
      }
      const next = rowToClient(data as ClientRow)
      const idx = clientsCache.findIndex((c) => c.id === next.id)
      if (idx === -1) { clientsCache = [next, ...clientsCache] }
      else { const copy = clientsCache.slice(); copy[idx] = next; clientsCache = copy }
      notify()
    } else if (table === 'settings') {
      if (type !== 'DELETE') {
        const row = data as SettingsRow
        settingsCache = rowToSettings(row)
        syncServersFromRow(row)
        notify()
      }
    } else if (table === 'profiles') {
      const row = data as unknown as Profile
      if (currentProfile && row.id === currentProfile.id) { currentProfile = row; notify() }
    }
  })
}

export function setCurrentProfile(p: Profile | null): void { currentProfile = p; notify() }
export function getCurrentProfile(): Profile | null { return currentProfile }

export type CreateClientInput = Pick<Client, 'name' | 'email' | 'phone' | 'company' | 'responsavel'> & {
  stage?: PipelineStage
  tenantId?: string; tenantServerId?: string; tenantApiId?: string; tenantName?: string
}

export const db = {
  subscribe(fn: () => void): () => void {
    subscribers.add(fn)
    return () => { subscribers.delete(fn) }
  },

  getClients(): Client[] { return clientsCache },
  getClient(id: string): Client | undefined { return clientsCache.find((c) => c.id === id) },

  createClient(data: CreateClientInput): Client {
    const now = new Date().toISOString()
    const client: Client = {
      id: uuid(), name: data.name, email: data.email, phone: data.phone,
      company: data.company, responsavel: data.responsavel, stage: data.stage ?? 'welcome',
      createdAt: now, stageUpdatedAt: now,
      tenantId: data.tenantId, tenantServerId: data.tenantServerId,
      tenantApiId: data.tenantApiId, tenantName: data.tenantName,
      followUpActive: false, followUps: [],
      deliveryChecklist: buildDefaultChecklist(),
      deliveryHandoffChecklist: buildHandoffChecklist(),
      notes: [],
      logs: [{ id: uuid(), action: 'Cliente criado', createdAt: now }],
    }
    clientsCache = [client, ...clientsCache]
    notify()

    void (async () => {
      const row = patchToRow(client as unknown as Partial<Client>)
      row.id = client.id
      try {
        await api.post('/api/clients', row)
      } catch (err) {
        clientsCache = clientsCache.filter((c) => c.id !== client.id)
        notify()
        toast.error('Falha ao criar cliente: ' + (err as Error).message)
      }
    })()

    return client
  },

  updateClient(id: string, patch: Partial<Client>): Client | undefined {
    const idx = clientsCache.findIndex((c) => c.id === id)
    if (idx === -1) return undefined
    const prev = clientsCache[idx]
    const next: Client = { ...prev, ...patch }
    if (patch.stage && patch.stage !== prev.stage) next.stageUpdatedAt = new Date().toISOString()
    const copy = clientsCache.slice(); copy[idx] = next; clientsCache = copy
    notify()

    void (async () => {
      try {
        await api.patch(`/api/clients/${id}`, patchToRow(patch))
      } catch (err) {
        const rollback = clientsCache.slice()
        const ridx = rollback.findIndex((c) => c.id === id)
        if (ridx !== -1) rollback[ridx] = prev
        clientsCache = rollback
        notify()
        toast.error('Falha ao salvar: ' + (err as Error).message)
      }
    })()

    return next
  },

  async removeClient(id: string): Promise<void> {
    const prev = clientsCache
    clientsCache = clientsCache.filter((c) => c.id !== id)
    notify()
    try {
      await api.delete(`/api/clients/${id}`)
    } catch (err) {
      clientsCache = prev; notify()
      toast.error('Falha ao excluir: ' + (err as Error).message)
      throw err
    }
  },

  addLog(clientId: string, action: string, detail?: string): LogEntry | undefined {
    const client = db.getClient(clientId)
    if (!client) return undefined
    const entry: LogEntry = { id: uuid(), action, detail, createdAt: new Date().toISOString() }
    db.updateClient(clientId, { logs: [entry, ...(client.logs ?? [])] })
    return entry
  },

  addNote(clientId: string, text: string, author: string, internal = false): NoteEntry | undefined {
    const client = db.getClient(clientId)
    if (!client) return undefined
    const note: NoteEntry = { id: uuid(), text, author: author || 'Anônimo', createdAt: new Date().toISOString(), internal: internal || undefined }
    db.updateClient(clientId, { notes: [note, ...(client.notes ?? [])] })
    return note
  },

  getSettings(): AppSettings { return settingsCache },

  saveSettings(s: AppSettings): void {
    const prev = settingsCache
    settingsCache = { ...prev, ...s }
    lsWriteSettings(settingsCache)
    notify()
    void (async () => {
      try {
        await api.put('/api/settings', settingsToRow(settingsCache))
      } catch (err) {
        settingsCache = prev; lsWriteSettings(prev); notify()
        toast.error('Falha ao salvar configurações: ' + (err as Error).message)
      }
    })()
  },

  getCurrentUser(): string { return currentProfile?.name ?? currentProfile?.email ?? '' },

  setCurrentUser(name: string): void {
    if (!currentProfile) return
    const prev = currentProfile
    currentProfile = { ...currentProfile, name }
    notify()
    void (async () => {
      try {
        await api.patch(`/api/users/${prev.id}`, { name })
      } catch {
        currentProfile = prev; notify()
        toast.error('Falha ao salvar nome')
      }
    })()
  },

  createBriefingToken(clientId: string): string {
    const client = db.getClient(clientId)
    if (!client) return ''
    if (client.briefingToken) return client.briefingToken
    const token = uuid()
    db.updateClient(clientId, { briefingToken: token })
    return token
  },

  getClientByToken(token: string): string | undefined {
    return clientsCache.find((c) => c.briefingToken === token)?.id
  },

  newId(): string { return uuid() },
}
