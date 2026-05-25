import { toast } from 'sonner'
import {
  buildDefaultChecklist,
  buildHandoffChecklist,
} from '@/constants/checklist'
import { supabase, type Profile } from '@/services/supabase'
import type {
  AppSettings,
  Client,
  LogEntry,
  NoteEntry,
  PipelineStage,
} from '@/types/client'

/**
 * Supabase-backed CRM data layer.
 *
 * STRATEGY:
 * Components were written against a SYNC API (read returns Client[] directly).
 * Supabase is async. To avoid changing every component we keep a local cache
 * mirror that:
 *   - is hydrated once on boot via `boot()`
 *   - is kept fresh by Realtime subscriptions on `clients` and `settings`
 *   - is mutated optimistically by writes, then reconciled by the realtime
 *     event from Postgres
 *
 * Public read methods (`getClients`, `getClient`, `getSettings`) stay sync
 * and read from the cache. Writes (`createClient`, `updateClient`, etc.) kick
 * off a Supabase request in the background and refresh the cache when done.
 * The pub/sub `subscribe(fn)` semantics are unchanged.
 */

// ---------- Helpers ----------

function uuid(): string {
  // Prefer crypto.randomUUID — only available in secure contexts (HTTPS or
  // localhost). When accessing the dev server via a LAN IP (e.g. 192.168.x.x)
  // the API is undefined and we need a fallback that still produces a valid
  // RFC-4122 v4 UUID, otherwise Postgres rejects the value for `uuid` columns.
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  // Fallback usando crypto.getRandomValues (disponível em qualquer contexto,
  // mesmo não-seguro). Math.random como último recurso.
  const bytes = new Uint8Array(16)
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    crypto.getRandomValues(bytes)
  } else {
    for (let i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256)
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x40 // version 4
  bytes[8] = (bytes[8] & 0x3f) | 0x80 // variant 10
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

// Snake_case row → camelCase Client mapping. Listing every field explicitly
// keeps the contract obvious and the two layers loosely coupled.
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
  briefing_status:
    | 'not_sent'
    | 'sent'
    | 'filled'
    | 'approved'
    | 'revision'
    | null
  briefing_sent_at: string | null
  briefing_data: Client['briefingData'] | null
  briefing_approved_at: string | null
  briefing_revision_note: string | null
  delivery_checklist: Client['deliveryChecklist']
  delivery_handoff_checklist: Client['deliveryHandoffChecklist']
  delivery_date: string | null
  delivery_notes: string | null
  delivery_completed_at: string | null
  followup_active: boolean
  followups: Client['followUps']
  notes: Client['notes']
  logs: Client['logs']
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
    deliveryChecklist: r.delivery_checklist ?? [],
    deliveryHandoffChecklist: r.delivery_handoff_checklist ?? [],
    deliveryDate: r.delivery_date ?? undefined,
    deliveryNotes: r.delivery_notes ?? undefined,
    deliveryCompletedAt: r.delivery_completed_at ?? undefined,
    followUpActive: r.followup_active,
    followUps: r.followups ?? [],
    notes: r.notes ?? [],
    logs: r.logs ?? [],
  }
}

// Maps a camelCase patch to snake_case columns. Only keys present in `patch`
// are emitted so partial updates remain partial in Supabase.
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
  return out
}

// settings table is a singleton (id=true). Map camelCase ↔ snake_case.
type SettingsRow = {
  id: boolean
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
    id: true,
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
    updated_at: new Date().toISOString(),
  }
}

// ---------- Settings localStorage backup ----------

const SETTINGS_LS_KEY = 'tenanthub_crm_settings'

function lsReadSettings(): AppSettings {
  try {
    const raw = window.localStorage.getItem(SETTINGS_LS_KEY)
    if (!raw) return {}
    return JSON.parse(raw) as AppSettings
  } catch {
    return {}
  }
}

function lsWriteSettings(s: AppSettings): void {
  try {
    window.localStorage.setItem(SETTINGS_LS_KEY, JSON.stringify(s))
  } catch {
    /* ignore quota errors */
  }
}

const ASAAS_LINKS_LS_KEY = 'tenanthub_asaas_links'

function lsReadAsaasLinks(): Record<string, string> {
  try {
    const raw = window.localStorage.getItem(ASAAS_LINKS_LS_KEY)
    return raw ? (JSON.parse(raw) as Record<string, string>) : {}
  } catch {
    return {}
  }
}

// ---------- Pub/sub + caches ----------

let clientsCache: Client[] = []
let settingsCache: AppSettings = {}
let currentProfile: Profile | null = null

const subscribers = new Set<() => void>()
function notify() {
  for (const fn of subscribers) fn()
}

// ---------- Boot + Realtime ----------

let bootingPromise: Promise<void> | null = null
let booted = false
let realtimeChannel: ReturnType<typeof supabase.channel> | null = null

export function isBooted(): boolean {
  return booted
}

export async function bootDb(): Promise<void> {
  if (bootingPromise) return bootingPromise
  bootingPromise = (async () => {
    try {
      // eslint-disable-next-line no-console
      console.info('[db] boot: loading clients + settings…')
      const [clientsRes, settingsRes] = await Promise.all([
        supabase
          .from('clients')
          .select('*')
          .order('created_at', { ascending: false }),
        supabase.from('settings').select('*').eq('id', true).maybeSingle(),
      ])
      if (clientsRes.error) {
        // eslint-disable-next-line no-console
        console.error('[db] load clients failed', clientsRes.error)
        toast.error('Falha ao carregar clientes: ' + clientsRes.error.message)
      } else {
        clientsCache = (clientsRes.data as ClientRow[] | null ?? []).map(
          rowToClient,
        )
        // eslint-disable-next-line no-console
        console.info('[db] loaded', clientsCache.length, 'clients')
      }
      if (settingsRes.error && settingsRes.error.code !== 'PGRST116') {
        // PGRST116 = no rows; that's fine (singleton may not exist yet).
        // eslint-disable-next-line no-console
        console.error('[db] load settings failed', settingsRes.error)
        // Fall back to localStorage so settings survive even when Supabase
        // is unreachable or the upsert had previously failed silently.
        settingsCache = lsReadSettings()
      } else {
        const fromSupabase = rowToSettings(settingsRes.data as SettingsRow | null)
        // If Supabase returned an empty row (no prior upsert succeeded), prefer
        // the localStorage copy so a restart doesn't wipe the user's config.
        const hasData = Object.keys(fromSupabase).some(
          (k) => fromSupabase[k as keyof AppSettings] !== undefined,
        )
        settingsCache = hasData ? fromSupabase : lsReadSettings()
        // Keep localStorage in sync with whatever Supabase returned.
        if (hasData) lsWriteSettings(fromSupabase)
      }
      // Aplica vínculos Asaas salvos em localStorage caso a coluna
      // asaas_customer_id não exista no Supabase ou o PATCH tenha falhado.
      const asaasLinks = lsReadAsaasLinks()
      if (Object.keys(asaasLinks).length > 0) {
        clientsCache = clientsCache.map((c) => {
          const saved = asaasLinks[c.id]
          return saved && !c.asaasCustomerId ? { ...c, asaasCustomerId: saved } : c
        })
      }

      subscribeRealtime()
      booted = true
      notify()
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[db] boot crash', err)
      toast.error('Falha ao inicializar dados')
    }
  })()
  return bootingPromise
}

export async function teardownDb(): Promise<void> {
  if (realtimeChannel) {
    await supabase.removeChannel(realtimeChannel)
    realtimeChannel = null
  }
  clientsCache = []
  settingsCache = {}
  currentProfile = null
  booted = false
  bootingPromise = null
  notify()
}

function subscribeRealtime() {
  if (realtimeChannel) return
  realtimeChannel = supabase
    .channel('crm-changes')
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'clients' },
      (payload) => {
        if (payload.eventType === 'DELETE') {
          const oldId = (payload.old as { id?: string }).id
          if (oldId) {
            clientsCache = clientsCache.filter((c) => c.id !== oldId)
            notify()
          }
          return
        }
        const next = rowToClient(payload.new as ClientRow)
        const idx = clientsCache.findIndex((c) => c.id === next.id)
        if (idx === -1) {
          clientsCache = [next, ...clientsCache]
        } else {
          const copy = clientsCache.slice()
          copy[idx] = next
          clientsCache = copy
        }
        notify()
      },
    )
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'settings' },
      (payload) => {
        if (payload.eventType === 'DELETE') {
          settingsCache = {}
        } else {
          settingsCache = rowToSettings(payload.new as SettingsRow)
        }
        notify()
      },
    )
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'profiles' },
      (payload) => {
        // If our own profile was updated (role/name), refresh local copy.
        const newRow = payload.new as Profile | undefined
        if (newRow && currentProfile && newRow.id === currentProfile.id) {
          currentProfile = newRow
          notify()
        }
      },
    )
    .subscribe()
}

// ---------- Profile (current user) ----------

export function setCurrentProfile(p: Profile | null): void {
  currentProfile = p
  notify()
}

export function getCurrentProfile(): Profile | null {
  return currentProfile
}

// ---------- Public API ----------

export type CreateClientInput = Pick<
  Client,
  'name' | 'email' | 'phone' | 'company' | 'responsavel'
> & {
  stage?: PipelineStage
  tenantId?: string
  tenantServerId?: string
  tenantApiId?: string
  tenantName?: string
}

export const db = {
  subscribe(fn: () => void): () => void {
    subscribers.add(fn)
    return () => {
      subscribers.delete(fn)
    }
  },

  // ---- Clients ----

  getClients(): Client[] {
    return clientsCache
  },

  getClient(id: string): Client | undefined {
    return clientsCache.find((c) => c.id === id)
  },

  /**
   * Optimistically inserts a client and pushes to Supabase. The realtime
   * event will replace our optimistic copy with the canonical row.
   */
  createClient(data: CreateClientInput): Client {
    const now = new Date().toISOString()
    const client: Client = {
      id: uuid(),
      name: data.name,
      email: data.email,
      phone: data.phone,
      company: data.company,
      responsavel: data.responsavel,
      stage: data.stage ?? 'welcome',
      createdAt: now,
      stageUpdatedAt: now,
      tenantId: data.tenantId,
      tenantServerId: data.tenantServerId,
      tenantApiId: data.tenantApiId,
      tenantName: data.tenantName,
      followUpActive: false,
      followUps: [],
      deliveryChecklist: buildDefaultChecklist(),
      deliveryHandoffChecklist: buildHandoffChecklist(),
      notes: [],
      logs: [
        {
          id: uuid(),
          action: 'Cliente criado',
          createdAt: now,
        },
      ],
    }
    clientsCache = [client, ...clientsCache]
    notify()

    void (async () => {
      const row = {
        id: client.id,
        name: client.name,
        email: client.email,
        phone: client.phone,
        company: client.company,
        responsavel: client.responsavel ?? null,
        stage: client.stage,
        tenant_id: client.tenantId ?? null,
        tenant_server_id: client.tenantServerId ?? null,
        tenant_api_id: client.tenantApiId ?? null,
        tenant_name: client.tenantName ?? null,
        delivery_checklist: client.deliveryChecklist,
        delivery_handoff_checklist: client.deliveryHandoffChecklist,
        followup_active: false,
        followups: [],
        notes: [],
        logs: client.logs,
      }
      // eslint-disable-next-line no-console
      console.info('[db] INSERT clients', { id: client.id, name: client.name })
      const { error } = await supabase.from('clients').insert(row)
      if (error) {
        // eslint-disable-next-line no-console
        console.error('[db] INSERT clients FAILED', error)
        clientsCache = clientsCache.filter((c) => c.id !== client.id)
        notify()
        toast.error('Falha ao criar cliente: ' + error.message)
      } else {
        // eslint-disable-next-line no-console
        console.info('[db] INSERT clients OK', client.id)
      }
    })()

    return client
  },

  updateClient(id: string, patch: Partial<Client>): Client | undefined {
    const idx = clientsCache.findIndex((c) => c.id === id)
    if (idx === -1) {
      // eslint-disable-next-line no-console
      console.warn('[db] updateClient skipped: id not in cache', id)
      return undefined
    }
    const prev = clientsCache[idx]
    const next: Client = { ...prev, ...patch }
    if (patch.stage && patch.stage !== prev.stage) {
      next.stageUpdatedAt = new Date().toISOString()
    }
    const copy = clientsCache.slice()
    copy[idx] = next
    clientsCache = copy
    notify()

    void (async () => {
      const rowPatch = patchToRow(patch)
      // eslint-disable-next-line no-console
      console.info('[db] UPDATE clients', { id, keys: Object.keys(rowPatch) })
      const { data, error } = await supabase
        .from('clients')
        .update(rowPatch)
        .eq('id', id)
        .select('id')
      const rollbackCache = () => {
        const rollback = clientsCache.slice()
        const ridx = rollback.findIndex((c) => c.id === id)
        if (ridx !== -1) rollback[ridx] = prev
        clientsCache = rollback
        notify()
      }
      if (error) {
        // eslint-disable-next-line no-console
        console.error('[db] UPDATE clients FAILED', error)
        // PGRST204 = coluna ausente no schema. Reverte cache pra evitar
        // que o usuário continue vendo dado que não foi persistido.
        if ((error as { code?: string }).code === 'PGRST204') {
          const col = /the '(\w+)' column/.exec(error.message)?.[1] ?? 'coluna'
          rollbackCache()
          toast.error(
            `Coluna "${col}" ausente no Supabase. Execute a migration SQL em Configurações → Supabase.`,
          )
          return
        }
        rollbackCache()
        toast.error('Falha ao salvar: ' + error.message)
      } else if (!data || data.length === 0) {
        // 0 rows: RLS bloqueou ou id sumiu. Reverte o cache — caso contrário
        // o usuário continua editando algo que o servidor já rejeitou.
        // eslint-disable-next-line no-console
        console.warn('[db] UPDATE clients returned 0 rows — RLS blocked or id mismatch', { id })
        rollbackCache()
        toast.error(
          'Salvamento bloqueado pelo banco (verifique permissões/role).',
        )
      } else {
        // eslint-disable-next-line no-console
        console.info('[db] UPDATE clients OK', id, Object.keys(rowPatch))
      }
    })()

    return next
  },

  async removeClient(id: string): Promise<void> {
    const prev = clientsCache
    clientsCache = clientsCache.filter((c) => c.id !== id)
    notify()
    // eslint-disable-next-line no-console
    console.info('[db] DELETE clients', id)
    const { error } = await supabase.from('clients').delete().eq('id', id)
    if (error) {
      // eslint-disable-next-line no-console
      console.error('[db] DELETE clients FAILED', error)
      clientsCache = prev
      notify()
      toast.error('Falha ao excluir: ' + error.message)
      throw error
    }
    // eslint-disable-next-line no-console
    console.info('[db] DELETE clients OK', id)
  },

  addLog(
    clientId: string,
    action: string,
    detail?: string,
  ): LogEntry | undefined {
    const client = db.getClient(clientId)
    if (!client) return undefined
    const entry: LogEntry = {
      id: uuid(),
      action,
      detail,
      createdAt: new Date().toISOString(),
    }
    const nextLogs = [entry, ...(client.logs ?? [])]
    db.updateClient(clientId, { logs: nextLogs })
    return entry
  },

  addNote(
    clientId: string,
    text: string,
    author: string,
    internal = false,
  ): NoteEntry | undefined {
    const client = db.getClient(clientId)
    if (!client) return undefined
    const note: NoteEntry = {
      id: uuid(),
      text,
      author: author || 'Anônimo',
      createdAt: new Date().toISOString(),
      internal: internal || undefined,
    }
    const nextNotes = [note, ...(client.notes ?? [])]
    db.updateClient(clientId, { notes: nextNotes })
    return note
  },

  // ---- Settings ----

  getSettings(): AppSettings {
    return settingsCache
  },

  saveSettings(s: AppSettings): void {
    const prev = settingsCache
    settingsCache = { ...prev, ...s }
    // Persist to localStorage immediately so a page reload never loses the
    // settings even if the Supabase upsert fails or is delayed.
    lsWriteSettings(settingsCache)
    notify()
    void (async () => {
      // eslint-disable-next-line no-console
      console.info('[db] UPSERT settings', Object.keys(s))
      const { error } = await supabase
        .from('settings')
        .upsert(settingsToRow(settingsCache), { onConflict: 'id' })
      if (error) {
        // eslint-disable-next-line no-console
        console.error('[db] UPSERT settings FAILED', error)
        settingsCache = prev
        lsWriteSettings(prev)
        notify()
        toast.error('Falha ao salvar configurações: ' + error.message)
      } else {
        // eslint-disable-next-line no-console
        console.info('[db] UPSERT settings OK')
      }
    })()
  },

  // ---- Current user (profile.name) ----

  getCurrentUser(): string {
    return currentProfile?.name ?? currentProfile?.email ?? ''
  },

  setCurrentUser(name: string): void {
    if (!currentProfile) return
    const prev = currentProfile
    currentProfile = { ...currentProfile, name }
    notify()
    void (async () => {
      const { error } = await supabase
        .from('profiles')
        .update({ name })
        .eq('id', prev.id)
      if (error) {
        currentProfile = prev
        notify()
        toast.error('Falha ao salvar nome: ' + error.message)
      }
    })()
  },

  // ---- Briefing tokens ----
  // Tokens are now stored directly on the client row (briefing_token column).
  // No separate token table needed.

  createBriefingToken(clientId: string): string {
    const client = db.getClient(clientId)
    if (!client) return ''
    if (client.briefingToken) return client.briefingToken
    const token = uuid()
    db.updateClient(clientId, { briefingToken: token })
    return token
  },

  /**
   * Returns the client ID for a given briefing token. Lookups happen in the
   * local cache for authenticated views; the public /briefing/:token page
   * should call the `get_client_by_briefing_token` RPC instead.
   */
  getClientByToken(token: string): string | undefined {
    return clientsCache.find((c) => c.briefingToken === token)?.id
  },

  newId(): string {
    return uuid()
  },
}
