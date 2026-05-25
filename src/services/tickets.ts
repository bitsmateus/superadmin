import { toast } from 'sonner'
import { api, onSseEvent } from '@/services/api'
import type {
  KbArticle, MessageTemplate, NpsClassification, NpsResponse, Reminder,
  Ticket, TicketAuthorType, TicketCategory, TicketMessage, TicketPriority,
  TicketStatus, TicketTriageStep, TriageOption, TriagePathEntry,
} from '@/types/ticket'

// ---------- Snake ↔ camel ----------

type CategoryRow = { id: string; name: string; description: string | null; icon: string; color: string; position: number; active: boolean; default_sla_hours: number; default_priority: TicketPriority; created_at: string }
function rowToCategory(r: CategoryRow): TicketCategory {
  return { id: r.id, name: r.name, description: r.description ?? undefined, icon: r.icon, color: r.color, position: r.position, active: r.active, defaultSlaHours: r.default_sla_hours, defaultPriority: r.default_priority, createdAt: r.created_at }
}

type TriageRow = { id: string; category_id: string; parent_id: string | null; question: string; options: TriageOption[] | null; position: number }
function rowToTriageStep(r: TriageRow): TicketTriageStep {
  return { id: r.id, categoryId: r.category_id, parentId: r.parent_id ?? undefined, question: r.question, options: r.options ?? [], position: r.position }
}

type KbRow = { id: string; slug: string; title: string; summary: string | null; body_markdown: string | null; video_url: string | null; category_id: string | null; tags: string[] | null; views_count: number; helpful_count: number; not_helpful_count: number; published: boolean; created_at: string; updated_at: string }
function rowToKb(r: KbRow): KbArticle {
  return { id: r.id, slug: r.slug, title: r.title, summary: r.summary ?? undefined, bodyMarkdown: r.body_markdown ?? undefined, videoUrl: r.video_url ?? undefined, categoryId: r.category_id, tags: r.tags ?? [], viewsCount: r.views_count, helpfulCount: r.helpful_count, notHelpfulCount: r.not_helpful_count, published: r.published, createdAt: r.created_at, updatedAt: r.updated_at }
}

type TicketRow = { id: string; number: number; client_id: string | null; category_id: string | null; customer_name: string | null; customer_email: string; customer_cnpj: string | null; customer_phone: string | null; customer_company: string | null; subject: string; description: string | null; triage_path: TriagePathEntry[] | null; status: TicketStatus; priority: TicketPriority; assignee_id: string | null; sla_hours: number; sla_due_at: string | null; opened_at: string; first_response_at: string | null; resolved_at: string | null; closed_at: string | null; last_message_at: string; public_token: string; needs_linking: boolean; customer_resolved_via_kb: boolean; created_at: string }
function rowToTicket(r: TicketRow): Ticket {
  return { id: r.id, number: r.number, clientId: r.client_id, categoryId: r.category_id, customerName: r.customer_name ?? undefined, customerEmail: r.customer_email, customerCnpj: r.customer_cnpj ?? undefined, customerPhone: r.customer_phone ?? undefined, customerCompany: r.customer_company ?? undefined, subject: r.subject, description: r.description ?? undefined, triagePath: r.triage_path ?? [], status: r.status, priority: r.priority, assigneeId: r.assignee_id, slaHours: r.sla_hours, slaDueAt: r.sla_due_at ?? undefined, openedAt: r.opened_at, firstResponseAt: r.first_response_at ?? undefined, resolvedAt: r.resolved_at ?? undefined, closedAt: r.closed_at ?? undefined, lastMessageAt: r.last_message_at, publicToken: r.public_token, needsLinking: r.needs_linking, customerResolvedViaKb: r.customer_resolved_via_kb, createdAt: r.created_at }
}

type MessageRow = { id: string; ticket_id: string; author_type: TicketAuthorType; author_id: string | null; author_name: string | null; content: string; is_internal: boolean; attachments: unknown[] | null; created_at: string }
function rowToMessage(r: MessageRow): TicketMessage {
  return { id: r.id, ticketId: r.ticket_id, authorType: r.author_type, authorId: r.author_id, authorName: r.author_name ?? undefined, content: r.content, isInternal: r.is_internal, attachments: r.attachments ?? [], createdAt: r.created_at }
}

type TemplateRow = { id: string; name: string; content: string; scope: MessageTemplate['scope']; category: string | null; shortcut: string | null; created_by: string | null; created_at: string; updated_at: string }
function rowToTemplate(r: TemplateRow): MessageTemplate {
  return { id: r.id, name: r.name, content: r.content, scope: r.scope, category: r.category ?? undefined, shortcut: r.shortcut ?? undefined, createdBy: r.created_by, createdAt: r.created_at, updatedAt: r.updated_at }
}

type ReminderRow = { id: string; user_id: string; client_id: string | null; title: string; notes: string | null; due_at: string; completed_at: string | null; created_at: string }
function rowToReminder(r: ReminderRow): Reminder {
  return { id: r.id, userId: r.user_id, clientId: r.client_id, title: r.title, notes: r.notes ?? undefined, dueAt: r.due_at, completedAt: r.completed_at ?? undefined, createdAt: r.created_at }
}

type NpsRow = { id: string; client_id: string; public_token: string; score: number | null; comment: string | null; classification: NpsClassification | null; scheduled_for: string; sent_at: string | null; responded_at: string | null; created_at: string }
function rowToNps(r: NpsRow): NpsResponse {
  return { id: r.id, clientId: r.client_id, publicToken: r.public_token, score: r.score ?? undefined, comment: r.comment ?? undefined, classification: r.classification ?? undefined, scheduledFor: r.scheduled_for, sentAt: r.sent_at ?? undefined, respondedAt: r.responded_at ?? undefined, createdAt: r.created_at }
}

// ---------- Cache ----------
let categories: TicketCategory[] = []
let triageSteps: TicketTriageStep[] = []
let kbArticles: KbArticle[] = []
let tickets: Ticket[] = []
let templates: MessageTemplate[] = []
let reminders: Reminder[] = []
let npsResponses: NpsResponse[] = []

const subs = new Set<() => void>()
function notify() { for (const fn of subs) fn() }

let booted = false
let bootingPromise: Promise<void> | null = null
let unsubSse: (() => void) | null = null

export function isTicketsBooted(): boolean { return booted }

export async function bootTickets(): Promise<void> {
  if (bootingPromise) return bootingPromise
  bootingPromise = (async () => {
    try {
      const [catRes, triRes, kbRes, tkRes, tplRes, remRes, npsRes] = await Promise.allSettled([
        api.get<CategoryRow[]>('/api/ticket-categories'),
        api.get<TriageRow[]>('/api/triage-steps'),
        api.get<KbRow[]>('/api/kb-articles'),
        api.get<TicketRow[]>('/api/tickets'),
        api.get<TemplateRow[]>('/api/message-templates'),
        api.get<ReminderRow[]>('/api/reminders'),
        api.get<NpsRow[]>('/api/nps'),
      ])
      if (catRes.status === 'fulfilled') categories = catRes.value.map(rowToCategory)
      if (triRes.status === 'fulfilled') triageSteps = triRes.value.map(rowToTriageStep)
      if (kbRes.status === 'fulfilled') kbArticles = kbRes.value.map(rowToKb)
      if (tkRes.status === 'fulfilled') tickets = tkRes.value.map(rowToTicket)
      if (tplRes.status === 'fulfilled') templates = tplRes.value.map(rowToTemplate)
      if (remRes.status === 'fulfilled') reminders = remRes.value.map(rowToReminder)
      if (npsRes.status === 'fulfilled') npsResponses = npsRes.value.map(rowToNps)

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
  unsubSse?.(); unsubSse = null
  categories = []; triageSteps = []; kbArticles = []
  tickets = []; templates = []; reminders = []; npsResponses = []
  booted = false; bootingPromise = null
  notify()
}

function subscribeRealtime() {
  if (unsubSse) return
  unsubSse = onSseEvent((table, type, data) => {
    if (table === 'tickets') {
      if (type === 'DELETE') {
        const id = (data as { id?: string }).id
        if (id) { tickets = tickets.filter((t) => t.id !== id) }
      } else {
        const next = rowToTicket(data as TicketRow)
        const idx = tickets.findIndex((t) => t.id === next.id)
        if (idx === -1) tickets = [next, ...tickets]
        else { const copy = tickets.slice(); copy[idx] = next; tickets = copy }
      }
      notify()
    } else if (table === 'ticket_messages') {
      notify() // messages loaded on demand
    } else if (table === 'nps_responses') {
      if (type === 'DELETE') {
        const id = (data as { id?: string }).id
        if (id) npsResponses = npsResponses.filter((n) => n.id !== id)
      } else {
        const next = rowToNps(data as NpsRow)
        const idx = npsResponses.findIndex((n) => n.id === next.id)
        if (idx === -1) npsResponses = [next, ...npsResponses]
        else { const copy = npsResponses.slice(); copy[idx] = next; npsResponses = copy }
      }
      notify()
    }
  })
}

// ---------- Public API ----------

export const ticketsService = {
  subscribe(fn: () => void): () => void { subs.add(fn); return () => { subs.delete(fn) } },

  getCategories(): TicketCategory[] { return categories },
  getCategoryById(id: string): TicketCategory | undefined { return categories.find((c) => c.id === id) },

  getTriageStepsByCategory(categoryId: string): TicketTriageStep[] { return triageSteps.filter((s) => s.categoryId === categoryId) },
  getRootTriageSteps(categoryId: string): TicketTriageStep[] { return triageSteps.filter((s) => s.categoryId === categoryId && !s.parentId).sort((a, b) => a.position - b.position) },

  getKbArticles(): KbArticle[] { return kbArticles },
  getKbArticleById(id: string): KbArticle | undefined { return kbArticles.find((a) => a.id === id) },
  getKbArticlesByCategory(categoryId: string): KbArticle[] { return kbArticles.filter((a) => a.published && a.categoryId === categoryId) },

  getTickets(): Ticket[] { return tickets },
  getTicketById(id: string): Ticket | undefined { return tickets.find((t) => t.id === id) },
  getTicketsByClient(clientId: string): Ticket[] { return tickets.filter((t) => t.clientId === clientId) },

  async loadTicketMessages(ticketId: string, includeInternal = true): Promise<TicketMessage[]> {
    try {
      const url = `/api/tickets/${ticketId}/messages${includeInternal ? '' : '?public_only=true'}`
      const rows = await api.get<MessageRow[]>(url)
      return rows.map(rowToMessage)
    } catch (err) {
      toast.error('Falha ao carregar mensagens: ' + (err as Error).message)
      return []
    }
  },

  async postMessage(ticketId: string, input: { content: string; authorId?: string | null; authorName?: string; authorType?: TicketAuthorType; isInternal?: boolean }): Promise<TicketMessage | null> {
    try {
      const row = await api.post<MessageRow>(`/api/tickets/${ticketId}/messages`, {
        author_type: input.authorType ?? 'agent',
        author_id: input.authorId ?? null,
        author_name: input.authorName ?? null,
        content: input.content,
        is_internal: input.isInternal ?? false,
      })
      return rowToMessage(row)
    } catch (err) {
      toast.error('Falha ao enviar mensagem: ' + (err as Error).message)
      return null
    }
  },

  async updateTicket(id: string, patch: Partial<Ticket>): Promise<void> {
    const row: Record<string, unknown> = {}
    if ('status' in patch) row.status = patch.status
    if ('priority' in patch) row.priority = patch.priority
    if ('assigneeId' in patch) row.assignee_id = patch.assigneeId ?? null
    if ('clientId' in patch) { row.client_id = patch.clientId ?? null; row.needs_linking = !patch.clientId }
    if ('subject' in patch) row.subject = patch.subject
    if ('categoryId' in patch) row.category_id = patch.categoryId ?? null
    if (patch.status === 'resolved') row.resolved_at = new Date().toISOString()
    if (patch.status === 'closed') row.closed_at = new Date().toISOString()
    try {
      await api.patch(`/api/tickets/${id}`, row)
    } catch (err) {
      toast.error('Falha ao atualizar ticket: ' + (err as Error).message)
    }
  },

  async claimTicket(id: string, assigneeId: string): Promise<void> {
    return this.updateTicket(id, { assigneeId, status: 'open' })
  },

  getTemplates(): MessageTemplate[] { return templates },

  async upsertTemplate(input: Partial<MessageTemplate> & { name: string; content: string }): Promise<void> {
    try {
      if (input.id) {
        await api.patch(`/api/message-templates/${input.id}`, { name: input.name, content: input.content, scope: input.scope ?? 'all', category: input.category ?? null, shortcut: input.shortcut ?? null })
      } else {
        await api.post('/api/message-templates', { name: input.name, content: input.content, scope: input.scope ?? 'all', category: input.category ?? null, shortcut: input.shortcut ?? null })
      }
      // Reload templates
      const rows = await api.get<TemplateRow[]>('/api/message-templates')
      templates = rows.map(rowToTemplate)
      notify()
    } catch (err) {
      toast.error('Falha ao salvar template: ' + (err as Error).message)
    }
  },

  async deleteTemplate(id: string): Promise<void> {
    try {
      await api.delete(`/api/message-templates/${id}`)
      templates = templates.filter((t) => t.id !== id)
      notify()
    } catch (err) {
      toast.error('Falha ao remover: ' + (err as Error).message)
    }
  },

  async upsertKbArticle(input: Partial<KbArticle> & { title: string; slug: string }): Promise<void> {
    const row = { title: input.title, slug: input.slug, summary: input.summary ?? null, body_markdown: input.bodyMarkdown ?? null, video_url: input.videoUrl ?? null, category_id: input.categoryId ?? null, tags: input.tags ?? [], published: input.published ?? true }
    try {
      if (input.id) {
        await api.patch(`/api/kb-articles/${input.id}`, row)
      } else {
        await api.post('/api/kb-articles', row)
      }
      const rows = await api.get<KbRow[]>('/api/kb-articles')
      kbArticles = rows.map(rowToKb)
      notify()
    } catch (err) {
      toast.error('Falha ao salvar artigo: ' + (err as Error).message)
    }
  },

  async deleteKbArticle(id: string): Promise<void> {
    try {
      await api.delete(`/api/kb-articles/${id}`)
      kbArticles = kbArticles.filter((a) => a.id !== id)
      notify()
    } catch (err) {
      toast.error('Falha ao remover artigo: ' + (err as Error).message)
    }
  },

  async upsertCategory(input: Partial<TicketCategory> & { name: string }): Promise<void> {
    const row = { name: input.name, description: input.description ?? null, icon: input.icon ?? 'HelpCircle', color: input.color ?? 'info', position: input.position ?? 0, active: input.active ?? true, default_sla_hours: input.defaultSlaHours ?? 24, default_priority: input.defaultPriority ?? 'normal' }
    try {
      if (input.id) {
        await api.patch(`/api/ticket-categories/${input.id}`, row)
      } else {
        await api.post('/api/ticket-categories', row)
      }
      const rows = await api.get<CategoryRow[]>('/api/ticket-categories')
      categories = rows.map(rowToCategory)
      notify()
    } catch (err) {
      toast.error('Falha ao salvar categoria: ' + (err as Error).message)
    }
  },

  getReminders(): Reminder[] { return reminders },
  getRemindersForUser(userId: string): Reminder[] { return reminders.filter((r) => r.userId === userId) },
  getOpenRemindersForUser(userId: string): Reminder[] { return reminders.filter((r) => r.userId === userId && !r.completedAt) },

  async upsertReminder(input: Partial<Reminder> & { title: string; dueAt: string; userId: string }): Promise<void> {
    try {
      if (input.id) {
        await api.patch(`/api/reminders/${input.id}`, { user_id: input.userId, client_id: input.clientId ?? null, title: input.title, notes: input.notes ?? null, due_at: input.dueAt })
      } else {
        await api.post('/api/reminders', { user_id: input.userId, client_id: input.clientId ?? null, title: input.title, notes: input.notes ?? null, due_at: input.dueAt })
      }
      await reloadReminders()
    } catch (err) {
      toast.error('Falha ao salvar lembrete: ' + (err as Error).message)
    }
  },

  async completeReminder(id: string): Promise<void> {
    try {
      await api.patch(`/api/reminders/${id}`, { completed_at: new Date().toISOString() })
      await reloadReminders()
    } catch (err) {
      toast.error('Falha ao concluir: ' + (err as Error).message)
    }
  },

  async deleteReminder(id: string): Promise<void> {
    try {
      await api.delete(`/api/reminders/${id}`)
      await reloadReminders()
    } catch (err) {
      toast.error('Falha ao remover: ' + (err as Error).message)
    }
  },

  getNpsResponses(): NpsResponse[] { return npsResponses },
  getNpsByClient(clientId: string): NpsResponse[] { return npsResponses.filter((n) => n.clientId === clientId) },

  async markNpsAsSent(id: string): Promise<void> {
    try {
      await api.patch(`/api/nps/${id}`, { sent_at: new Date().toISOString() })
    } catch (err) {
      toast.error('Falha: ' + (err as Error).message)
    }
  },

  async deleteNps(id: string): Promise<void> {
    try {
      await api.delete(`/api/nps/${id}`)
    } catch (err) {
      toast.error('Falha: ' + (err as Error).message)
    }
  },
}

async function reloadReminders() {
  try {
    const rows = await api.get<ReminderRow[]>('/api/reminders')
    reminders = rows.map(rowToReminder)
    notify()
  } catch { /* silent */ }
}

// ---------- Public RPCs (portal do cliente) ----------

export const publicSupport = {
  async lookupByEmail(email: string): Promise<{ clientId: string | null; clientName?: string; clientCompany?: string; openTickets?: number }> {
    const rows = await api.post<Array<{ client_id: string; client_name: string | null; client_company: string | null; open_tickets: number }>>('/api/public/support-lookup', { email })
    const row = rows?.[0]
    if (!row) return { clientId: null }
    return { clientId: row.client_id, clientName: row.client_name ?? undefined, clientCompany: row.client_company ?? undefined, openTickets: row.open_tickets }
  },

  async createTicket(input: { email: string; name?: string; cnpj?: string; phone?: string; company?: string; categoryId?: string | null; subject: string; description?: string; triagePath?: TriagePathEntry[] }): Promise<{ ticketId: string; ticketNumber: number; publicToken: string }> {
    const row = await api.post<{ ticket_id: string; ticket_number: number; public_token: string }>('/api/public/tickets', {
      customer_email: input.email, customer_name: input.name ?? null, customer_cnpj: input.cnpj ?? null,
      customer_phone: input.phone ?? null, customer_company: input.company ?? null, category_id: input.categoryId ?? null,
      subject: input.subject, description: input.description ?? null, triage_path: input.triagePath ?? [],
    })
    return { ticketId: row.ticket_id, ticketNumber: row.ticket_number, publicToken: row.public_token }
  },

  async getTicketByToken(token: string) {
    const row = await api.get<{
      id: string; number: number; subject: string; status: TicketStatus; priority: TicketPriority;
      customer_name: string | null; customer_email: string; customer_company: string | null;
      opened_at: string; last_message_at: string;
      messages: Array<{ id: string; author_type: TicketAuthorType; author_name: string | null; content: string; created_at: string }>
    }>(`/api/public/tickets/${token}`)
    if (!row) return null
    return {
      id: row.id, number: row.number, subject: row.subject, status: row.status, priority: row.priority,
      customerName: row.customer_name ?? undefined, customerEmail: row.customer_email,
      customerCompany: row.customer_company ?? undefined, openedAt: row.opened_at, lastMessageAt: row.last_message_at,
      messages: (row.messages ?? []).map((m) => ({ id: m.id, authorType: m.author_type, authorName: m.author_name ?? undefined, content: m.content, createdAt: m.created_at })),
    }
  },

  async postMessage(token: string, authorName: string, content: string): Promise<void> {
    await api.post(`/api/public/tickets/${token}/messages`, { author_name: authorName, content })
  },

  async getNps(token: string): Promise<{ id: string; clientCompany?: string; clientName?: string; responded: boolean } | null> {
    const row = await api.get<{ id: string; client_company: string | null; client_name: string | null; responded: boolean }>(`/api/public/nps/${token}`)
    if (!row) return null
    return { id: row.id, clientCompany: row.client_company ?? undefined, clientName: row.client_name ?? undefined, responded: row.responded }
  },

  async submitNps(token: string, score: number, comment: string): Promise<void> {
    await api.post(`/api/public/nps/${token}`, { score, comment })
  },
}

export function findNextStep(steps: TicketTriageStep[], fromStepId: string | null, optionLabel: string): { nextStep?: TicketTriageStep; kbArticleId?: string | null } {
  const step = steps.find((s) => s.id === fromStepId)
  const opt = step?.options.find((o) => o.label === optionLabel)
  if (!opt) return {}
  if (opt.kbArticleId) return { kbArticleId: opt.kbArticleId }
  if (opt.nextStepId) { const next = steps.find((s) => s.id === opt.nextStepId); return { nextStep: next } }
  return {}
}
