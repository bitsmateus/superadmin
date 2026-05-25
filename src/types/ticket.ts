/**
 * Tipos do sistema de suporte (tickets, KB, templates, lembretes).
 *
 * Convenção: snake_case dentro do banco, camelCase do lado do app.
 * Os hooks/serviços mapeiam um pro outro.
 */

export type TicketStatus =
  | 'new'
  | 'open'
  | 'pending_customer'
  | 'resolved'
  | 'closed'

export type TicketPriority = 'low' | 'normal' | 'high' | 'urgent'

export type TicketAuthorType = 'customer' | 'agent' | 'system'

export interface TicketCategory {
  id: string
  name: string
  description?: string
  icon: string
  color: string
  position: number
  active: boolean
  defaultSlaHours: number
  defaultPriority: TicketPriority
  createdAt: string
}

export interface TriageOption {
  label: string
  /** Próximo passo se houver. */
  nextStepId?: string | null
  /** Artigo KB sugerido. */
  kbArticleId?: string | null
}

export interface TicketTriageStep {
  id: string
  categoryId: string
  parentId?: string | null
  question: string
  options: TriageOption[]
  position: number
}

export interface KbArticle {
  id: string
  slug: string
  title: string
  summary?: string
  bodyMarkdown?: string
  videoUrl?: string
  categoryId?: string | null
  tags: string[]
  viewsCount: number
  helpfulCount: number
  notHelpfulCount: number
  published: boolean
  createdAt: string
  updatedAt: string
}

export interface TriagePathEntry {
  question: string
  answer: string
  kbArticleId?: string | null
  resolvedHere?: boolean
}

export interface Ticket {
  id: string
  number: number
  clientId?: string | null
  categoryId?: string | null

  customerName?: string
  customerEmail: string
  customerCnpj?: string
  customerPhone?: string
  customerCompany?: string

  subject: string
  description?: string
  triagePath: TriagePathEntry[]

  status: TicketStatus
  priority: TicketPriority

  assigneeId?: string | null

  slaHours: number
  slaDueAt?: string

  openedAt: string
  firstResponseAt?: string
  resolvedAt?: string
  closedAt?: string
  lastMessageAt: string

  publicToken: string

  needsLinking: boolean
  customerResolvedViaKb: boolean

  createdAt: string
}

export interface TicketMessage {
  id: string
  ticketId: string
  authorType: TicketAuthorType
  authorId?: string | null
  authorName?: string
  content: string
  isInternal: boolean
  attachments: unknown[]
  createdAt: string
}

export interface MessageTemplate {
  id: string
  name: string
  content: string
  scope: 'ticket' | 'email' | 'whatsapp' | 'all'
  category?: string
  shortcut?: string
  createdBy?: string | null
  createdAt: string
  updatedAt: string
}

export interface Reminder {
  id: string
  userId: string
  clientId?: string | null
  title: string
  notes?: string
  dueAt: string
  completedAt?: string
  createdAt: string
}

export type NpsClassification = 'detractor' | 'neutral' | 'promoter'

export interface NpsResponse {
  id: string
  clientId: string
  publicToken: string
  score?: number
  comment?: string
  classification?: NpsClassification
  scheduledFor: string
  sentAt?: string
  respondedAt?: string
  createdAt: string
}

// ---------- Helpers de display ----------

export const TICKET_STATUS_LABEL: Record<TicketStatus, string> = {
  new: 'Novo',
  open: 'Em andamento',
  pending_customer: 'Aguardando cliente',
  resolved: 'Resolvido',
  closed: 'Fechado',
}

export const TICKET_STATUS_TONE: Record<
  TicketStatus,
  'success' | 'danger' | 'warning' | 'info' | 'neutral'
> = {
  new: 'danger',
  open: 'info',
  pending_customer: 'warning',
  resolved: 'success',
  closed: 'neutral',
}

export const TICKET_PRIORITY_LABEL: Record<TicketPriority, string> = {
  low: 'Baixa',
  normal: 'Normal',
  high: 'Alta',
  urgent: 'Urgente',
}

export const TICKET_PRIORITY_TONE: Record<
  TicketPriority,
  'success' | 'danger' | 'warning' | 'info' | 'neutral'
> = {
  low: 'neutral',
  normal: 'info',
  high: 'warning',
  urgent: 'danger',
}
