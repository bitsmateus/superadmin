/**
 * Camada de dados pra o sistema de suporte.
 *
 * Implementa a mesma estratégia do db.ts (cache + realtime), mas pra
 * tabelas de tickets. Lookups públicos (portal do cliente) usam RPCs
 * SECURITY DEFINER pra contornar RLS sem expor a tabela toda.
 */

import { toast } from 'sonner'
import { supabase } from './supabase'
import type {
  KbArticle,
  MessageTemplate,
  NpsClassification,
  NpsResponse,
  Reminder,
  Ticket,
  TicketAuthorType,
  TicketCategory,
  TicketMessage,
  TicketPriority,
  TicketStatus,
  TicketTriageStep,
  TriageOption,
  TriagePathEntry,
} from '@/types/ticket'

// ---------- Snake ↔ camel ----------

type CategoryRow = {
  id: string
  name: string
  description: string | null
  icon: string
  color: string
  position: number
  active: boolean
  default_sla_hours: number
  default_priority: TicketPriority
  created_at: string
}

function rowToCategory(r: CategoryRow): TicketCategory {
  return {
    id: r.id,
    name: r.name,
    description: r.description ?? undefined,
    icon: r.icon,
    color: r.color,
    position: r.position,
    active: r.active,
    defaultSlaHours: r.default_sla_hours,
    defaultPriority: r.default_priority,
    createdAt: r.created_at,
  }
}

type TriageRow = {
  id: string
  category_id: string
  parent_id: string | null
  question: string
  options: TriageOption[] | null
  position: number
}

function rowToTriageStep(r: TriageRow): TicketTriageStep {
  return {
    id: r.id,
    categoryId: r.category_id,
    parentId: r.parent_id ?? undefined,
    question: r.question,
    options: r.options ?? [],
    position: r.position,
  }
}

type KbRow = {
  id: string
  slug: string
  title: string
  summary: string | null
  body_markdown: string | null
  video_url: string | null
  category_id: string | null
  tags: string[] | null
  views_count: number
  helpful_count: number
  not_helpful_count: number
  published: boolean
  created_at: string
  updated_at: string
}

function rowToKb(r: KbRow): KbArticle {
  return {
    id: r.id,
    slug: r.slug,
    title: r.title,
    summary: r.summary ?? undefined,
    bodyMarkdown: r.body_markdown ?? undefined,
    videoUrl: r.video_url ?? undefined,
    categoryId: r.category_id,
    tags: r.tags ?? [],
    viewsCount: r.views_count,
    helpfulCount: r.helpful_count,
    notHelpfulCount: r.not_helpful_count,
    published: r.published,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  }
}

type TicketRow = {
  id: string
  number: number
  client_id: string | null
  category_id: string | null
  customer_name: string | null
  customer_email: string
  customer_cnpj: string | null
  customer_phone: string | null
  customer_company: string | null
  subject: string
  description: string | null
  triage_path: TriagePathEntry[] | null
  status: TicketStatus
  priority: TicketPriority
  assignee_id: string | null
  sla_hours: number
  sla_due_at: string | null
  opened_at: string
  first_response_at: string | null
  resolved_at: string | null
  closed_at: string | null
  last_message_at: string
  public_token: string
  needs_linking: boolean
  customer_resolved_via_kb: boolean
  created_at: string
}

function rowToTicket(r: TicketRow): Ticket {
  return {
    id: r.id,
    number: r.number,
    clientId: r.client_id,
    categoryId: r.category_id,
    customerName: r.customer_name ?? undefined,
    customerEmail: r.customer_email,
    customerCnpj: r.customer_cnpj ?? undefined,
    customerPhone: r.customer_phone ?? undefined,
    customerCompany: r.customer_company ?? undefined,
    subject: r.subject,
    description: r.description ?? undefined,
    triagePath: r.triage_path ?? [],
    status: r.status,
    priority: r.priority,
    assigneeId: r.assignee_id,
    slaHours: r.sla_hours,
    slaDueAt: r.sla_due_at ?? undefined,
    openedAt: r.opened_at,
    firstResponseAt: r.first_response_at ?? undefined,
    resolvedAt: r.resolved_at ?? undefined,
    closedAt: r.closed_at ?? undefined,
    lastMessageAt: r.last_message_at,
    publicToken: r.public_token,
    needsLinking: r.needs_linking,
    customerResolvedViaKb: r.customer_resolved_via_kb,
    createdAt: r.created_at,
  }
}

type MessageRow = {
  id: string
  ticket_id: string
  author_type: TicketAuthorType
  author_id: string | null
  author_name: string | null
  content: string
  is_internal: boolean
  attachments: unknown[] | null
  created_at: string
}

function rowToMessage(r: MessageRow): TicketMessage {
  return {
    id: r.id,
    ticketId: r.ticket_id,
    authorType: r.author_type,
    authorId: r.author_id,
    authorName: r.author_name ?? undefined,
    content: r.content,
    isInternal: r.is_internal,
    attachments: r.attachments ?? [],
    createdAt: r.created_at,
  }
}

type TemplateRow = {
  id: string
  name: string
  content: string
  scope: MessageTemplate['scope']
  category: string | null
  shortcut: string | null
  created_by: string | null
  created_at: string
  updated_at: string
}

function rowToTemplate(r: TemplateRow): MessageTemplate {
  return {
    id: r.id,
    name: r.name,
    content: r.content,
    scope: r.scope,
    category: r.category ?? undefined,
    shortcut: r.shortcut ?? undefined,
    createdBy: r.created_by,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  }
}

type ReminderRow = {
  id: string
  user_id: string
  client_id: string | null
  title: string
  notes: string | null
  due_at: string
  completed_at: string | null
  created_at: string
}

function rowToReminder(r: ReminderRow): Reminder {
  return {
    id: r.id,
    userId: r.user_id,
    clientId: r.client_id,
    title: r.title,
    notes: r.notes ?? undefined,
    dueAt: r.due_at,
    completedAt: r.completed_at ?? undefined,
    createdAt: r.created_at,
  }
}

type NpsRow = {
  id: string
  client_id: string
  public_token: string
  score: number | null
  comment: string | null
  classification: NpsClassification | null
  scheduled_for: string
  sent_at: string | null
  responded_at: string | null
  created_at: string
}

function rowToNps(r: NpsRow): NpsResponse {
  return {
    id: r.id,
    clientId: r.client_id,
    publicToken: r.public_token,
    score: r.score ?? undefined,
    comment: r.comment ?? undefined,
    classification: r.classification ?? undefined,
    scheduledFor: r.scheduled_for,
    sentAt: r.sent_at ?? undefined,
    respondedAt: r.responded_at ?? undefined,
    createdAt: r.created_at,
  }
}

// ---------- Cache + pub/sub ----------

let categories: TicketCategory[] = []
let triageSteps: TicketTriageStep[] = []
let kbArticles: KbArticle[] = []
let tickets: Ticket[] = []
let templates: MessageTemplate[] = []
let reminders: Reminder[] = []
let npsResponses: NpsResponse[] = []

const subs = new Set<() => void>()
function notify() {
  for (const fn of subs) fn()
}

let booted = false
let bootingPromise: Promise<void> | null = null
let realtimeChannel: ReturnType<typeof supabase.channel> | null = null

export function isTicketsBooted(): boolean {
  return booted
}

export async function bootTickets(): Promise<void> {
  if (bootingPromise) return bootingPromise
  bootingPromise = (async () => {
    try {
      const [catRes, triRes, kbRes, tkRes, tplRes, remRes, npsRes] = await Promise.all([
        supabase.from('ticket_categories').select('*').order('position'),
        supabase.from('ticket_triage_steps').select('*'),
        supabase.from('kb_articles').select('*'),
        supabase.from('tickets').select('*').order('opened_at', { ascending: false }),
        supabase.from('message_templates').select('*'),
        supabase.from('reminders').select('*').order('due_at'),
        supabase.from('nps_responses').select('*').order('created_at', { ascending: false }),
      ])
      if (catRes.error) console.warn('[tickets] categories', catRes.error)
      else categories = (catRes.data as CategoryRow[] | null ?? []).map(rowToCategory)

      if (triRes.error) console.warn('[tickets] triage', triRes.error)
      else triageSteps = (triRes.data as TriageRow[] | null ?? []).map(rowToTriageStep)

      if (kbRes.error) console.warn('[tickets] kb', kbRes.error)
      else kbArticles = (kbRes.data as KbRow[] | null ?? []).map(rowToKb)

      if (tkRes.error) console.warn('[tickets] tickets', tkRes.error)
      else tickets = (tkRes.data as TicketRow[] | null ?? []).map(rowToTicket)

      if (tplRes.error) console.warn('[tickets] templates', tplRes.error)
      else templates = (tplRes.data as TemplateRow[] | null ?? []).map(rowToTemplate)

      if (remRes.error) console.warn('[tickets] reminders', remRes.error)
      else reminders = (remRes.data as ReminderRow[] | null ?? []).map(rowToReminder)

      if (npsRes.error) console.warn('[tickets] nps', npsRes.error)
      else npsResponses = (npsRes.data as NpsRow[] | null ?? []).map(rowToNps)

      subscribeRealtime()
      booted = true
      notify()
    } catch (err) {
      console.error('[tickets] boot crash', err)
    }
  })()
  return bootingPromise
}

export async function teardownTickets(): Promise<void> {
  if (realtimeChannel) {
    await supabase.removeChannel(realtimeChannel)
    realtimeChannel = null
  }
  categories = []
  triageSteps = []
  kbArticles = []
  tickets = []
  templates = []
  reminders = []
  npsResponses = []
  booted = false
  bootingPromise = null
  notify()
}

function subscribeRealtime() {
  if (realtimeChannel) return
  realtimeChannel = supabase
    .channel('tickets-changes')
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'tickets' },
      (payload) => {
        if (payload.eventType === 'DELETE') {
          const oldId = (payload.old as { id?: string }).id
          if (oldId) tickets = tickets.filter((t) => t.id !== oldId)
        } else {
          const next = rowToTicket(payload.new as TicketRow)
          const idx = tickets.findIndex((t) => t.id === next.id)
          if (idx === -1) tickets = [next, ...tickets]
          else {
            const copy = tickets.slice()
            copy[idx] = next
            tickets = copy
          }
        }
        notify()
      },
    )
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'ticket_messages' },
      () => {
        // mensagens são carregadas sob demanda no detalhe; aqui só notifica
        notify()
      },
    )
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'nps_responses' },
      (payload) => {
        if (payload.eventType === 'DELETE') {
          const oldId = (payload.old as { id?: string }).id
          if (oldId) npsResponses = npsResponses.filter((n) => n.id !== oldId)
        } else {
          const next = rowToNps(payload.new as NpsRow)
          const idx = npsResponses.findIndex((n) => n.id === next.id)
          if (idx === -1) npsResponses = [next, ...npsResponses]
          else {
            const copy = npsResponses.slice()
            copy[idx] = next
            npsResponses = copy
          }
        }
        notify()
      },
    )
    .subscribe()
}

// ---------- Public API ----------

export const ticketsService = {
  subscribe(fn: () => void): () => void {
    subs.add(fn)
    return () => {
      subs.delete(fn)
    }
  },

  // ----- Categorias -----
  // Retorna o array bruto (referência estável) — filtragem por `active` é
  // feita na camada de hook. Necessário pra useSyncExternalStore não entrar
  // em loop (filter() cria nova ref a cada call).
  getCategories(): TicketCategory[] {
    return categories
  },
  getCategoryById(id: string): TicketCategory | undefined {
    return categories.find((c) => c.id === id)
  },

  // ----- Triagem -----
  getTriageStepsByCategory(categoryId: string): TicketTriageStep[] {
    return triageSteps.filter((s) => s.categoryId === categoryId)
  },
  getRootTriageSteps(categoryId: string): TicketTriageStep[] {
    return triageSteps
      .filter((s) => s.categoryId === categoryId && !s.parentId)
      .sort((a, b) => a.position - b.position)
  },

  // ----- KB -----
  // Mesmo motivo de getCategories: ref estável; filter no hook.
  getKbArticles(): KbArticle[] {
    return kbArticles
  },
  getKbArticleById(id: string): KbArticle | undefined {
    return kbArticles.find((a) => a.id === id)
  },
  getKbArticlesByCategory(categoryId: string): KbArticle[] {
    return kbArticles.filter((a) => a.published && a.categoryId === categoryId)
  },

  // ----- Tickets -----
  getTickets(): Ticket[] {
    return tickets
  },
  getTicketById(id: string): Ticket | undefined {
    return tickets.find((t) => t.id === id)
  },
  getTicketsByClient(clientId: string): Ticket[] {
    return tickets.filter((t) => t.clientId === clientId)
  },

  async loadTicketMessages(ticketId: string, includeInternal = true): Promise<TicketMessage[]> {
    let q = supabase.from('ticket_messages').select('*').eq('ticket_id', ticketId)
    if (!includeInternal) q = q.eq('is_internal', false)
    const { data, error } = await q.order('created_at')
    if (error) {
      toast.error('Falha ao carregar mensagens: ' + error.message)
      return []
    }
    return (data as MessageRow[] | null ?? []).map(rowToMessage)
  },

  async postMessage(
    ticketId: string,
    input: {
      content: string
      authorId?: string | null
      authorName?: string
      authorType?: TicketAuthorType
      isInternal?: boolean
    },
  ): Promise<TicketMessage | null> {
    const { data, error } = await supabase
      .from('ticket_messages')
      .insert({
        ticket_id: ticketId,
        author_type: input.authorType ?? 'agent',
        author_id: input.authorId ?? null,
        author_name: input.authorName ?? null,
        content: input.content,
        is_internal: input.isInternal ?? false,
      })
      .select()
      .single()
    if (error) {
      toast.error('Falha ao enviar mensagem: ' + error.message)
      return null
    }
    return rowToMessage(data as MessageRow)
  },

  async updateTicket(id: string, patch: Partial<Ticket>): Promise<void> {
    const row: Record<string, unknown> = {}
    if ('status' in patch) row.status = patch.status
    if ('priority' in patch) row.priority = patch.priority
    if ('assigneeId' in patch) row.assignee_id = patch.assigneeId ?? null
    if ('clientId' in patch) {
      row.client_id = patch.clientId ?? null
      row.needs_linking = !patch.clientId
    }
    if ('subject' in patch) row.subject = patch.subject
    if ('categoryId' in patch) row.category_id = patch.categoryId ?? null
    // Marca resolvido/fechado com timestamp
    if (patch.status === 'resolved') row.resolved_at = new Date().toISOString()
    if (patch.status === 'closed') row.closed_at = new Date().toISOString()

    const { error } = await supabase.from('tickets').update(row).eq('id', id)
    if (error) {
      toast.error('Falha ao atualizar ticket: ' + error.message)
    }
  },

  async claimTicket(id: string, assigneeId: string): Promise<void> {
    return this.updateTicket(id, { assigneeId, status: 'open' })
  },

  // ----- Templates -----
  getTemplates(): MessageTemplate[] {
    return templates
  },

  async upsertTemplate(input: Partial<MessageTemplate> & { name: string; content: string }): Promise<void> {
    const row: Record<string, unknown> = {
      name: input.name,
      content: input.content,
      scope: input.scope ?? 'all',
      category: input.category ?? null,
      shortcut: input.shortcut ?? null,
      updated_at: new Date().toISOString(),
    }
    if (input.id) {
      const { error } = await supabase.from('message_templates').update(row).eq('id', input.id)
      if (error) toast.error('Falha ao salvar template: ' + error.message)
    } else {
      const { error } = await supabase.from('message_templates').insert(row)
      if (error) toast.error('Falha ao criar template: ' + error.message)
    }
  },

  async deleteTemplate(id: string): Promise<void> {
    const { error } = await supabase.from('message_templates').delete().eq('id', id)
    if (error) toast.error('Falha ao remover: ' + error.message)
  },

  // ----- KB CRUD -----
  async upsertKbArticle(
    input: Partial<KbArticle> & { title: string; slug: string },
  ): Promise<void> {
    const row: Record<string, unknown> = {
      title: input.title,
      slug: input.slug,
      summary: input.summary ?? null,
      body_markdown: input.bodyMarkdown ?? null,
      video_url: input.videoUrl ?? null,
      category_id: input.categoryId ?? null,
      tags: input.tags ?? [],
      published: input.published ?? true,
      updated_at: new Date().toISOString(),
    }
    if (input.id) {
      const { error } = await supabase.from('kb_articles').update(row).eq('id', input.id)
      if (error) toast.error('Falha ao salvar artigo: ' + error.message)
    } else {
      const { error } = await supabase.from('kb_articles').insert(row)
      if (error) toast.error('Falha ao criar artigo: ' + error.message)
    }
  },

  async deleteKbArticle(id: string): Promise<void> {
    const { error } = await supabase.from('kb_articles').delete().eq('id', id)
    if (error) toast.error('Falha ao remover artigo: ' + error.message)
  },

  // ----- Categorias CRUD -----
  async upsertCategory(input: Partial<TicketCategory> & { name: string }): Promise<void> {
    const row: Record<string, unknown> = {
      name: input.name,
      description: input.description ?? null,
      icon: input.icon ?? 'HelpCircle',
      color: input.color ?? 'info',
      position: input.position ?? 0,
      active: input.active ?? true,
      default_sla_hours: input.defaultSlaHours ?? 24,
      default_priority: input.defaultPriority ?? 'normal',
    }
    if (input.id) {
      const { error } = await supabase.from('ticket_categories').update(row).eq('id', input.id)
      if (error) toast.error('Falha ao salvar categoria: ' + error.message)
    } else {
      const { error } = await supabase.from('ticket_categories').insert(row)
      if (error) toast.error('Falha ao criar categoria: ' + error.message)
    }
  },

  // ----- Lembretes -----
  getReminders(): Reminder[] {
    return reminders
  },
  getRemindersForUser(userId: string): Reminder[] {
    return reminders.filter((r) => r.userId === userId)
  },
  getOpenRemindersForUser(userId: string): Reminder[] {
    return reminders.filter((r) => r.userId === userId && !r.completedAt)
  },

  async upsertReminder(
    input: Partial<Reminder> & { title: string; dueAt: string; userId: string },
  ): Promise<void> {
    const row: Record<string, unknown> = {
      user_id: input.userId,
      client_id: input.clientId ?? null,
      title: input.title,
      notes: input.notes ?? null,
      due_at: input.dueAt,
    }
    if (input.id) {
      const { error } = await supabase.from('reminders').update(row).eq('id', input.id)
      if (error) toast.error('Falha ao salvar lembrete: ' + error.message)
    } else {
      const { error } = await supabase.from('reminders').insert(row)
      if (error) toast.error('Falha ao criar lembrete: ' + error.message)
    }
    // Recarrega manualmente (não está no realtime)
    await reloadReminders()
  },

  async completeReminder(id: string): Promise<void> {
    const { error } = await supabase
      .from('reminders')
      .update({ completed_at: new Date().toISOString() })
      .eq('id', id)
    if (error) toast.error('Falha ao concluir: ' + error.message)
    await reloadReminders()
  },

  async deleteReminder(id: string): Promise<void> {
    const { error } = await supabase.from('reminders').delete().eq('id', id)
    if (error) toast.error('Falha ao remover: ' + error.message)
    await reloadReminders()
  },

  // ----- NPS -----
  getNpsResponses(): NpsResponse[] {
    return npsResponses
  },
  getNpsByClient(clientId: string): NpsResponse[] {
    return npsResponses.filter((n) => n.clientId === clientId)
  },

  /**
   * Marca um NPS como "enviado" — você gerou o link e mandou pro cliente
   * (por e-mail/WhatsApp). Isso só registra o timestamp, não envia nada.
   */
  async markNpsAsSent(id: string): Promise<void> {
    const { error } = await supabase
      .from('nps_responses')
      .update({ sent_at: new Date().toISOString() })
      .eq('id', id)
    if (error) toast.error('Falha: ' + error.message)
  },

  async deleteNps(id: string): Promise<void> {
    const { error } = await supabase.from('nps_responses').delete().eq('id', id)
    if (error) toast.error('Falha: ' + error.message)
  },
}

async function reloadReminders() {
  const { data, error } = await supabase
    .from('reminders')
    .select('*')
    .order('due_at')
  if (error) return
  reminders = (data as ReminderRow[] | null ?? []).map(rowToReminder)
  notify()
}

// ---------- Public RPCs (portal do cliente) ----------

export const publicSupport = {
  async lookupByEmail(email: string): Promise<{
    clientId: string | null
    clientName?: string
    clientCompany?: string
    openTickets?: number
  }> {
    const { data, error } = await supabase.rpc('support_lookup_by_email', {
      email_in: email,
    })
    if (error) {
      throw new Error(error.message)
    }
    const row = (data as Array<{
      client_id: string
      client_name: string | null
      client_company: string | null
      open_tickets: number
    }> | null)?.[0]
    if (!row) return { clientId: null }
    return {
      clientId: row.client_id,
      clientName: row.client_name ?? undefined,
      clientCompany: row.client_company ?? undefined,
      openTickets: row.open_tickets,
    }
  },

  async createTicket(input: {
    email: string
    name?: string
    cnpj?: string
    phone?: string
    company?: string
    categoryId?: string | null
    subject: string
    description?: string
    triagePath?: TriagePathEntry[]
  }): Promise<{ ticketId: string; ticketNumber: number; publicToken: string }> {
    const { data, error } = await supabase.rpc('create_public_ticket', {
      customer_email_in: input.email,
      customer_name_in: input.name ?? null,
      customer_cnpj_in: input.cnpj ?? null,
      customer_phone_in: input.phone ?? null,
      customer_company_in: input.company ?? null,
      category_id_in: input.categoryId ?? null,
      subject_in: input.subject,
      description_in: input.description ?? null,
      triage_path_in: input.triagePath ?? [],
    })
    if (error) throw new Error(error.message)
    const row = (data as Array<{
      ticket_id: string
      ticket_number: number
      public_token: string
    }> | null)?.[0]
    if (!row) throw new Error('Resposta inesperada do servidor.')
    return {
      ticketId: row.ticket_id,
      ticketNumber: row.ticket_number,
      publicToken: row.public_token,
    }
  },

  async getTicketByToken(token: string): Promise<{
    id: string
    number: number
    subject: string
    status: TicketStatus
    priority: TicketPriority
    customerName?: string
    customerEmail: string
    customerCompany?: string
    openedAt: string
    lastMessageAt: string
    messages: { id: string; authorType: TicketAuthorType; authorName?: string; content: string; createdAt: string }[]
  } | null> {
    const { data, error } = await supabase.rpc('get_public_ticket', {
      token_in: token,
    })
    if (error) throw new Error(error.message)
    const row = (data as Array<{
      id: string
      number: number
      subject: string
      status: TicketStatus
      priority: TicketPriority
      customer_name: string | null
      customer_email: string
      customer_company: string | null
      opened_at: string
      last_message_at: string
      category_id: string | null
      messages: Array<{
        id: string
        author_type: TicketAuthorType
        author_name: string | null
        content: string
        created_at: string
      }>
    }> | null)?.[0]
    if (!row) return null
    return {
      id: row.id,
      number: row.number,
      subject: row.subject,
      status: row.status,
      priority: row.priority,
      customerName: row.customer_name ?? undefined,
      customerEmail: row.customer_email,
      customerCompany: row.customer_company ?? undefined,
      openedAt: row.opened_at,
      lastMessageAt: row.last_message_at,
      messages: (row.messages ?? []).map((m) => ({
        id: m.id,
        authorType: m.author_type,
        authorName: m.author_name ?? undefined,
        content: m.content,
        createdAt: m.created_at,
      })),
    }
  },

  async postMessage(token: string, authorName: string, content: string): Promise<void> {
    const { error } = await supabase.rpc('post_public_ticket_message', {
      token_in: token,
      author_name_in: authorName,
      content_in: content,
    })
    if (error) throw new Error(error.message)
  },

  // --- NPS público ---
  async getNps(token: string): Promise<{
    id: string
    clientCompany?: string
    clientName?: string
    responded: boolean
  } | null> {
    const { data, error } = await supabase.rpc('get_nps_by_token', { token_in: token })
    if (error) throw new Error(error.message)
    const row = (data as Array<{
      id: string
      client_company: string | null
      client_name: string | null
      responded: boolean
    }> | null)?.[0]
    if (!row) return null
    return {
      id: row.id,
      clientCompany: row.client_company ?? undefined,
      clientName: row.client_name ?? undefined,
      responded: row.responded,
    }
  },

  async submitNps(token: string, score: number, comment: string): Promise<void> {
    const { error } = await supabase.rpc('submit_nps', {
      token_in: token,
      score_in: score,
      comment_in: comment,
    })
    if (error) throw new Error(error.message)
  },
}

/** Resolve um caminho dentro da árvore de triagem. */
export function findNextStep(
  steps: TicketTriageStep[],
  fromStepId: string | null,
  optionLabel: string,
): { nextStep?: TicketTriageStep; kbArticleId?: string | null } {
  const step = steps.find((s) => s.id === fromStepId)
  const opt = step?.options.find((o) => o.label === optionLabel)
  if (!opt) return {}
  if (opt.kbArticleId) return { kbArticleId: opt.kbArticleId }
  if (opt.nextStepId) {
    const next = steps.find((s) => s.id === opt.nextStepId)
    return { nextStep: next }
  }
  return {}
}
