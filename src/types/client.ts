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

export type UserRole = 'atendente' | 'supervisor' | 'admin'

export interface BriefingUser {
  name: string
  email: string
  sector: string
  role: UserRole
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

  submittedAt: string
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
  reference?: string
  note?: string
  source?: 'manual' | 'asaas'
  createdAt: string
}

export interface ExtraLink {
  id: string
  label: string
  url: string
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
  asaasCustomerId?: string
  asaasPaymentId?: string
  asaasSubscriptionId?: string
  implementationValue?: number
  monthlyValue?: number
  dueDay?: number
  paymentStatus?: PaymentStatus
  lastPaymentCheck?: string

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

  // Etapa 4 — Entrega
  deliveryChecklist: ChecklistItem[]
  deliveryHandoffChecklist?: ChecklistItem[]
  deliveryDate?: string
  deliveryNotes?: string
  deliveryCompletedAt?: string

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
  followUpsEnabled?: boolean
  followUpTemplates?: {
    day3?: string
    day7?: string
    day15?: string
    day30?: string
  }
}
