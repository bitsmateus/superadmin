export type PipelineStage =
  | 'lead'
  | 'welcome'
  | 'contract'
  | 'briefing'
  | 'setup'
  | 'delivery'
  | 'active'
  | 'churned'

export interface NoteEntry {
  id: string
  text: string
  author: string
  createdAt: string
  /** Quando true, nota só é visível pra time interno (não aparece em portais públicos). */
  internal?: boolean
}

export interface LogEntry {
  id: string
  action: string
  detail?: string
  createdAt: string
}

export interface FollowUp {
  id: string
  scheduledFor: string
  dayNumber: number
  message: string
  sentAt?: string
  responded?: boolean
}

export interface ChecklistItem {
  id: string
  label: string
  checked: boolean
  checkedAt?: string
  checkedBy?: string
  children?: ChecklistItem[]
}

/**
 * Papel dentro do tenant criado (não confundir com `UserRole` do painel
 * em services/supabase.ts, que é admin/supervisor/suporte).
 */
export type BriefingUserRole = 'atendente' | 'supervisor' | 'admin'

export interface BriefingUser {
  name: string
  email: string
  sector: string
  role: BriefingUserRole
}

export interface BriefingScheduleSlot {
  day: string
  active: boolean
  start: string
  end: string
}

export type WhatsAppType =
  | 'baileys'
  | 'evolution'
  | 'uazapi'
  | 'zapi'
  | 'meow'
  | 'evo'

export type AiTone = 'formal' | 'casual' | 'tecnico'

export interface BriefingData {
  razaoSocial: string
  nomeFantasia: string
  cnpj: string
  site?: string

  users: BriefingUser[]

  schedule: BriefingScheduleSlot[]
  timezone: string

  whatsappNumbers: string[]
  whatsappType: WhatsAppType | string
  useFacebook: boolean
  facebookToken?: string

  mainFlow: string
  greetingMessage: string
  offHoursMessage: string
  departments: string[]

  useAI: boolean
  aiTone?: AiTone
  aiInstructions?: string
  aiRestrictions?: string

  extraNotes?: string

  // Channel-specific info (populated when client submits the public form)
  wavoipInfo?: string
  olxInfo?: string
  mercadolivreInfo?: string
  emailConfig?: string
  externalAutomationInfo?: string

  submittedAt: string
}

export type ConnectionType = 'api_oficial' | 'api_comum'
export type AutomationType = 'chatbot' | 'ia_basica' | 'ia_avancada'
export type BriefingChannel = 'whatsapp' | 'instagram' | 'messenger' | 'wavoip' | 'olx' | 'mercadolivre' | 'email'

export interface BriefingConfig {
  connectionTypes: ConnectionType[]
  automationTypes: AutomationType[]
  channels: BriefingChannel[]
  maxUsers: number
  hasExternalAutomation: boolean
  externalAutomationNotes?: string
}

export type ContractStatus = 'not_sent' | 'sent' | 'signed'
export type BriefingStatus =
  | 'not_sent'
  | 'sent'
  | 'filled'
  | 'approved'
  | 'revision'
export type PaymentStatus = 'pending' | 'paid' | 'overdue'

export type PaymentType = 'implementation' | 'monthly' | 'other'
export type PaymentMethod = 'pix' | 'boleto' | 'card' | 'transfer' | 'asaas' | 'other'

export interface Payment {
  id: string
  type: PaymentType
  value: number
  dueDate?: string
  paidAt?: string
  method?: PaymentMethod
  /** Texto livre indicando onde/como foi pago (ex.: "Infinity Tape", "Sicredi"). */
  paidVia?: string
  reference?: string
  note?: string
  source?: 'manual' | 'asaas'
  /** ID externo (ex.: payment id no Asaas) — usado pra dedup no import. */
  externalId?: string
  createdAt: string
}

export interface ExtraLink {
  id: string
  label: string
  url: string
}

export interface ClientAccess {
  id: string
  name: string
  emailOrPhone?: string
  password?: string
  url?: string
}

export interface Client {
  id: string
  name: string
  email: string
  phone: string
  company: string
  tenantId?: string
  tenantServerId?: string
  tenantApiId?: string
  tenantName?: string
  supportEmail?: string
  supportPassword?: string
  stage: PipelineStage
  responsavel?: string
  createdAt: string
  stageUpdatedAt?: string

  // Etapa 2 — Contrato & Financeiro
  contractUrl?: string
  contractSentAt?: string
  contractSignedAt?: string
  /** Data URL (base64) ou URL externa do arquivo do contrato. */
  contractFile?: string
  /** Nome do arquivo do contrato. */
  contractFileName?: string
  asaasCustomerId?: string
  asaasPaymentId?: string
  asaasSubscriptionId?: string
  implementationValue?: number
  monthlyValue?: number
  dueDay?: number
  paymentStatus?: PaymentStatus
  lastPaymentCheck?: string

  // Plataformas onde o cliente usa o sistema
  platformApp?: boolean
  platformWeb?: boolean
  platformChat?: boolean

  // Acessos (redes sociais, painéis externos, etc.)
  accesses?: ClientAccess[]

  // Financeiro — registros manuais
  payments?: Payment[]
  extraLinks?: ExtraLink[]
  financeNotes?: string

  // Etapa 3 — Briefing
  briefingToken?: string
  briefingStatus?: BriefingStatus
  briefingSentAt?: string
  briefingData?: BriefingData
  briefingApprovedAt?: string
  briefingRevisionNote?: string
  briefingConfig?: BriefingConfig

  // Etapa 4 — Entrega
  deliveryChecklist: ChecklistItem[]
  deliveryHandoffChecklist?: ChecklistItem[]
  deliveryDate?: string
  deliveryNotes?: string
  deliveryCompletedAt?: string

  // Tipo de implementação (marcado pelo time interno). Aparece nos
  // painéis correspondentes do Dashboard.
  hasApiOficial?: boolean
  hasIa?: boolean
  hasAutomacaoExterna?: boolean

  // Etapa 6 — Follow-up
  followUpActive: boolean
  followUps: FollowUp[]

  // Geral
  notes: NoteEntry[]
  logs: LogEntry[]
}

export interface AppSettings {
  asaasApiKey?: string
  asaasEnvironment?: 'sandbox' | 'production'
  /** Intervalo (minutos) do auto-sync de pagamentos Asaas. 0 desliga. */
  asaasSyncIntervalMin?: number
  /** Senha padrão usada na criação de tenant/usuários (não hardcoded no código). */
  defaultTenantPassword?: string
  /** Senha padrão para acessos enviados no PDF de handoff. */
  defaultAccessPassword?: string
  /** Número de suporte impresso no PDF de acessos. */
  supportPhone?: string
  followUpsEnabled?: boolean
  followUpTemplates?: {
    day3?: string
    day7?: string
    day15?: string
    day30?: string
  }
  /** Dias após delivery_completed_at pra disparar NPS automático. */
  npsDelayDays?: number
  /** Liga/desliga criação automática de NPS. */
  npsEnabled?: boolean
  /** URL da Edge Function notify-ticket (notificação por e-mail). */
  notifyEdgeFunctionUrl?: string
  /** Liga/desliga notificação por e-mail. */
  notifyEnabled?: boolean
  /** Meta de novos clientes no mês (clientes que viraram active no período). */
  goalNewClientsMonthly?: number
  /** Meta de MRR (R$) no mês. */
  goalMrrMonthly?: number
  /** Meta de NPS médio do mês. */
  goalNpsMonthly?: number
  /** Liga exibição de metas no dashboard / centro de comando. */
  goalsEnabled?: boolean
  /** Último backup feito (ISO). Usado pra avisar quando passar de N dias. */
  lastBackupAt?: string
  /** Quantos dias sem backup antes de mostrar aviso. Default 7. */
  backupRemindDays?: number
}

export interface StageHistoryEntry {
  id: string
  clientId: string
  fromStage: PipelineStage | null
  toStage: PipelineStage
  at: string
}

export interface AuditEntry {
  id: string
  actorId?: string
  actorEmail?: string
  actorName?: string
  entityType: string
  entityId?: string
  action: string
  summary?: string
  changes?: Record<string, unknown>
  at: string
}
