import * as React from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import {
  AlertCircle,
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  Clock3,
  ExternalLink,
  Link2,
  Mail,
  MessageCircle,
  Phone,
  Search,
  Send,
  Sparkles,
  StickyNote,
  User as UserIcon,
  X,
} from 'lucide-react'
import { toast } from 'sonner'
import { TopBar } from '@/components/layout/TopBar'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
import { Badge } from '@/components/ui/Badge'
import { EmptyState } from '@/components/ui/EmptyState'
import { Modal } from '@/components/ui/Modal'
import { Skeleton } from '@/components/ui/Skeleton'
import {
  useActiveTickets,
  useTicket,
  useTicketCategories,
  useTickets,
  useTicketsBooted,
} from '@/hooks/useTickets'
import { useClients } from '@/hooks/useClients'
import { useAuth } from '@/hooks/useAuth'
import { ticketsService } from '@/services/tickets'
import { db } from '@/services/db'
import { useServerById } from '@/store/authStore'
import { cn, formatDateShort, asText, initials } from '@/lib/utils'
import { timeAgo } from '@/lib/time'
import type {
  Ticket,
  TicketMessage,
  TicketPriority,
  TicketStatus,
} from '@/types/ticket'
import {
  TICKET_PRIORITY_LABEL,
  TICKET_PRIORITY_TONE,
  TICKET_STATUS_LABEL,
  TICKET_STATUS_TONE,
} from '@/types/ticket'
import type { Client } from '@/types/client'

export function TicketsPage() {
  const navigate = useNavigate()
  const { id } = useParams()
  const tickets = useTickets()
  const booted = useTicketsBooted()
  const active = useActiveTickets()
  const [search, setSearch] = React.useState('')
  const [statusFilter, setStatusFilter] = React.useState<TicketStatus | 'all' | 'active'>('active')
  const [priorityFilter, setPriorityFilter] = React.useState<TicketPriority | 'all'>('all')
  const [assigneeFilter, setAssigneeFilter] = React.useState<'all' | 'mine' | 'unassigned'>('all')

  const { profile } = useAuth()

  const filtered = React.useMemo(() => {
    return tickets.filter((t) => {
      if (statusFilter === 'active') {
        if (t.status !== 'new' && t.status !== 'open' && t.status !== 'pending_customer') return false
      } else if (statusFilter !== 'all' && t.status !== statusFilter) {
        return false
      }
      if (priorityFilter !== 'all' && t.priority !== priorityFilter) return false
      if (assigneeFilter === 'mine' && t.assigneeId !== profile?.id) return false
      if (assigneeFilter === 'unassigned' && t.assigneeId) return false
      if (search.trim()) {
        const q = search.toLowerCase()
        const blob = (
          t.subject +
          ' ' +
          (t.customerName ?? '') +
          ' ' +
          (t.customerEmail ?? '') +
          ' ' +
          (t.customerCompany ?? '') +
          ' #' +
          t.number
        ).toLowerCase()
        if (!blob.includes(q)) return false
      }
      return true
    })
  }, [tickets, statusFilter, priorityFilter, assigneeFilter, search, profile?.id])

  const sorted = React.useMemo(
    () =>
      [...filtered].sort((a, b) => {
        // Urgência: prioridade desc, depois SLA mais próximo
        const pri: Record<TicketPriority, number> = {
          urgent: 0,
          high: 1,
          normal: 2,
          low: 3,
        }
        if (pri[a.priority] !== pri[b.priority]) return pri[a.priority] - pri[b.priority]
        return (a.slaDueAt ?? a.openedAt).localeCompare(b.slaDueAt ?? b.openedAt)
      }),
    [filtered],
  )

  if (id) {
    return <TicketDetail ticketId={id} onClose={() => navigate('/tickets')} />
  }

  return (
    <>
      <TopBar
        title="Tickets"
        subtitle={
          booted
            ? `${active.length} ativo(s) · ${tickets.length} total`
            : 'Carregando…'
        }
        rightSlot={
          <Button
            variant="secondary"
            onClick={() => window.open('/suporte', '_blank', 'noopener')}
            leftIcon={<ExternalLink className="h-4 w-4" />}
          >
            Ver portal público
          </Button>
        }
      />

      <div className="px-8 py-6 space-y-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
          <Input
            placeholder="Buscar por assunto, cliente, e-mail, #número…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            leftIcon={<Search className="h-4 w-4" />}
            containerClassName="lg:max-w-md"
          />

          <div className="flex flex-wrap items-center gap-2">
            <Select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as typeof statusFilter)}
              options={[
                { value: 'active', label: 'Ativos' },
                { value: 'all', label: 'Todos' },
                { value: 'new', label: 'Novos' },
                { value: 'open', label: 'Em andamento' },
                { value: 'pending_customer', label: 'Aguardando cliente' },
                { value: 'resolved', label: 'Resolvidos' },
                { value: 'closed', label: 'Fechados' },
              ]}
            />
            <Select
              value={priorityFilter}
              onChange={(e) => setPriorityFilter(e.target.value as typeof priorityFilter)}
              options={[
                { value: 'all', label: 'Qualquer prioridade' },
                { value: 'urgent', label: 'Urgente' },
                { value: 'high', label: 'Alta' },
                { value: 'normal', label: 'Normal' },
                { value: 'low', label: 'Baixa' },
              ]}
            />
            <Select
              value={assigneeFilter}
              onChange={(e) => setAssigneeFilter(e.target.value as typeof assigneeFilter)}
              options={[
                { value: 'all', label: 'Qualquer atendente' },
                { value: 'mine', label: 'Meus' },
                { value: 'unassigned', label: 'Sem atribuição' },
              ]}
            />
          </div>
        </div>

        {!booted ? (
          <div className="space-y-2">
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-16 w-full" />
          </div>
        ) : sorted.length === 0 ? (
          <EmptyState
            icon={<MessageCircle className="h-5 w-5" />}
            title={tickets.length === 0 ? 'Nenhum ticket ainda' : 'Nada encontrado'}
            description={
              tickets.length === 0
                ? 'Quando alguém abrir um ticket pelo /suporte, ele aparece aqui em tempo real.'
                : 'Ajuste os filtros pra ver mais.'
            }
          />
        ) : (
          <ul className="space-y-2">
            {sorted.map((t) => (
              <TicketRow
                key={t.id}
                ticket={t}
                onOpen={() => navigate(`/tickets/${t.id}`)}
              />
            ))}
          </ul>
        )}
      </div>
    </>
  )
}

function TicketRow({ ticket, onOpen }: { ticket: Ticket; onOpen: () => void }) {
  const overdue =
    ticket.slaDueAt &&
    new Date(ticket.slaDueAt) < new Date() &&
    (ticket.status === 'new' || ticket.status === 'open')

  return (
    <li>
      <button
        onClick={onOpen}
        className={cn(
          'w-full rounded-xl border border-line bg-card px-4 py-3 text-left transition-colors hover:border-accent/40 hover:bg-accent/[0.03]',
          overdue && 'border-danger/30 bg-danger/[0.04]',
        )}
      >
        <div className="flex items-start gap-3">
          <div className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-white/[0.04] text-[11px] font-medium text-white/80 ring-1 ring-line">
            {initials(ticket.customerName ?? ticket.customerCompany ?? ticket.customerEmail) || (
              <UserIcon className="h-4 w-4" />
            )}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="text-[10px] uppercase tracking-wider text-white/35">
                #{ticket.number}
              </span>
              <Badge tone={TICKET_STATUS_TONE[ticket.status]} dot>
                {TICKET_STATUS_LABEL[ticket.status]}
              </Badge>
              <Badge tone={TICKET_PRIORITY_TONE[ticket.priority]}>
                {TICKET_PRIORITY_LABEL[ticket.priority]}
              </Badge>
              {ticket.needsLinking && (
                <Badge tone="warning">Vincular cliente</Badge>
              )}
              {overdue && (
                <Badge tone="danger">
                  <AlertTriangle className="h-3 w-3 mr-1" />
                  SLA vencido
                </Badge>
              )}
            </div>
            <div className="mt-1 text-sm font-medium text-white truncate">
              {ticket.subject}
            </div>
            <div className="mt-0.5 text-xs text-white/55 truncate">
              {ticket.customerName ?? '—'}
              {ticket.customerCompany && ` · ${ticket.customerCompany}`}
              {' · '}
              <span className="text-white/40">{ticket.customerEmail}</span>
            </div>
          </div>
          <div className="shrink-0 text-right text-[11px] text-white/45">
            <div>{timeAgo(ticket.lastMessageAt)}</div>
            {ticket.slaDueAt && (
              <div
                className={cn(
                  'mt-1 inline-flex items-center gap-1',
                  overdue && 'text-danger',
                )}
              >
                <Clock3 className="h-3 w-3" />
                SLA {formatDateShort(ticket.slaDueAt)}
              </div>
            )}
          </div>
        </div>
      </button>
    </li>
  )
}

// =====================================================================
// Detalhe do ticket — thread + sidebar com contexto do cliente/tenant
// =====================================================================

function TicketDetail({ ticketId, onClose }: { ticketId: string; onClose: () => void }) {
  const ticket = useTicket(ticketId)
  const categories = useTicketCategories()
  const [messages, setMessages] = React.useState<TicketMessage[]>([])
  const [loading, setLoading] = React.useState(true)
  const [reply, setReply] = React.useState('')
  const [isInternal, setIsInternal] = React.useState(false)
  const [posting, setPosting] = React.useState(false)
  const [linkOpen, setLinkOpen] = React.useState(false)
  const { profile } = useAuth()

  React.useEffect(() => {
    if (!ticketId) return
    void (async () => {
      setLoading(true)
      const list = await ticketsService.loadTicketMessages(ticketId, true)
      setMessages(list)
      setLoading(false)
    })()
  }, [ticketId])

  // Subscribe a inserções na thread em tempo real (badge / nova msg)
  React.useEffect(() => {
    return ticketsService.subscribe(async () => {
      if (!ticketId) return
      // Recarrega só se o ticket ainda existe na cache
      const list = await ticketsService.loadTicketMessages(ticketId, true)
      setMessages(list)
    })
  }, [ticketId])

  if (!ticket) {
    return (
      <>
        <TopBar
          title="Ticket"
          breadcrumbs={[
            { label: 'TenantHub', to: '/' },
            { label: 'Tickets', to: '/tickets' },
            { label: '…' },
          ]}
        />
        <div className="px-8 py-6">
          <EmptyState
            icon={<AlertCircle className="h-5 w-5" />}
            title="Ticket não encontrado"
            description="Pode ter sido removido ou o link está incorreto."
            action={<Button onClick={onClose}>Voltar pra lista</Button>}
          />
        </div>
      </>
    )
  }

  const category = categories.find((c) => c.id === ticket.categoryId)

  const sendReply = async () => {
    if (!reply.trim() || !profile) return
    setPosting(true)
    const r = await ticketsService.postMessage(ticketId, {
      content: reply.trim(),
      authorId: profile.id,
      authorName: profile.name ?? profile.email,
      authorType: 'agent',
      isInternal,
    })
    setPosting(false)
    if (r) {
      setReply('')
      setIsInternal(false)
      const list = await ticketsService.loadTicketMessages(ticketId, true)
      setMessages(list)
    }
  }

  const claim = async () => {
    if (!profile) return
    await ticketsService.claimTicket(ticketId, profile.id)
    toast.success('Ticket atribuído a você')
  }

  const changeStatus = async (status: TicketStatus) => {
    await ticketsService.updateTicket(ticketId, { status })
    toast.success(`Status: ${TICKET_STATUS_LABEL[status]}`)
  }

  const changePriority = async (priority: TicketPriority) => {
    await ticketsService.updateTicket(ticketId, { priority })
  }

  return (
    <>
      <TopBar
        title={`#${ticket.number} · ${ticket.subject}`}
        breadcrumbs={[
          { label: 'TenantHub', to: '/' },
          { label: 'Tickets', to: '/tickets' },
          { label: `#${ticket.number}` },
        ]}
        rightSlot={
          <div className="flex items-center gap-2">
            {ticket.assigneeId !== profile?.id && (
              <Button size="sm" variant="secondary" onClick={claim}>
                Atribuir a mim
              </Button>
            )}
            <Select
              value={ticket.status}
              onChange={(e) => changeStatus(e.target.value as TicketStatus)}
              options={[
                { value: 'new', label: 'Novo' },
                { value: 'open', label: 'Em andamento' },
                { value: 'pending_customer', label: 'Aguardando cliente' },
                { value: 'resolved', label: 'Resolvido' },
                { value: 'closed', label: 'Fechado' },
              ]}
              className="!h-8 !text-xs"
            />
          </div>
        }
      />

      <div className="px-8 py-6">
        <div className="grid grid-cols-1 gap-6 xl:grid-cols-[1fr_360px]">
          {/* Thread */}
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={TICKET_PRIORITY_TONE[ticket.priority]}>
                Prioridade: {TICKET_PRIORITY_LABEL[ticket.priority]}
              </Badge>
              {category && <Badge tone="info">{category.name}</Badge>}
              <Select
                value={ticket.priority}
                onChange={(e) => changePriority(e.target.value as TicketPriority)}
                options={[
                  { value: 'low', label: 'Baixa' },
                  { value: 'normal', label: 'Normal' },
                  { value: 'high', label: 'Alta' },
                  { value: 'urgent', label: 'Urgente' },
                ]}
                className="!h-7 !text-xs ml-auto !w-32"
              />
            </div>

            {ticket.triagePath.length > 0 && (
              <details className="rounded-xl border border-line bg-white/[0.02] px-4 py-3">
                <summary className="cursor-pointer text-xs text-white/55 hover:text-white">
                  Triagem feita pelo cliente ({ticket.triagePath.length} passo(s))
                </summary>
                <ul className="mt-2 space-y-1 text-xs text-white/70">
                  {ticket.triagePath.map((p, i) => (
                    <li key={i}>
                      <span className="text-white/45">{p.question}</span> →{' '}
                      <strong className="text-white/90">{p.answer}</strong>
                    </li>
                  ))}
                </ul>
              </details>
            )}

            {loading ? (
              <Skeleton className="h-32 w-full" />
            ) : (
              <ThreadMessages messages={messages} />
            )}

            {/* Reply box */}
            <div className="rounded-xl border border-line bg-card p-4">
              <textarea
                value={reply}
                onChange={(e) => setReply(e.target.value)}
                rows={4}
                placeholder={
                  isInternal
                    ? 'Nota interna — só o time vê'
                    : 'Resposta ao cliente…'
                }
                className={cn(
                  'w-full rounded-lg bg-surface px-3 py-2 text-sm text-white border border-white/10 placeholder:text-white/30 focus:outline-none focus:border-accent focus:ring-4 focus:ring-accent/15 resize-y min-h-[100px]',
                  isInternal && 'border-warning/30 bg-warning/[0.03]',
                )}
                maxLength={5000}
              />
              <div className="mt-2 flex items-center justify-between">
                <label className="inline-flex items-center gap-2 text-xs text-white/65 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={isInternal}
                    onChange={(e) => setIsInternal(e.target.checked)}
                    className="h-3.5 w-3.5 accent-[#4F8EF7]"
                  />
                  <StickyNote className="h-3.5 w-3.5" />
                  Nota interna (cliente não vê)
                </label>
                <Button
                  onClick={sendReply}
                  loading={posting}
                  disabled={!reply.trim()}
                  size="sm"
                  leftIcon={<Send className="h-3.5 w-3.5" />}
                >
                  Enviar
                </Button>
              </div>
            </div>
          </div>

          {/* Sidebar de contexto */}
          <aside className="space-y-3 xl:sticky xl:top-20 xl:self-start">
            <ContextCard ticket={ticket} onOpenLink={() => setLinkOpen(true)} />
          </aside>
        </div>
      </div>

      <LinkClientModal
        open={linkOpen}
        onClose={() => setLinkOpen(false)}
        ticket={ticket}
      />
    </>
  )
}

function ThreadMessages({ messages }: { messages: TicketMessage[] }) {
  if (messages.length === 0) {
    return (
      <div className="rounded-xl border border-line bg-white/[0.02] px-4 py-6 text-center text-sm text-white/45">
        Sem mensagens ainda.
      </div>
    )
  }
  return (
    <div className="space-y-2.5">
      {messages.map((m) => {
        const isAgent = m.authorType === 'agent'
        return (
          <div
            key={m.id}
            className={cn(
              'rounded-xl border px-4 py-3',
              m.isInternal
                ? 'border-warning/30 bg-warning/[0.06]'
                : isAgent
                  ? 'border-accent/30 bg-accent/[0.05]'
                  : 'border-line bg-white/[0.02]',
            )}
          >
            <div className="mb-1 flex items-center justify-between gap-2">
              <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-wider text-white/55">
                <span>{m.authorName ?? (isAgent ? 'Suporte' : 'Cliente')}</span>
                {m.isInternal && (
                  <span className="inline-flex items-center gap-1 rounded bg-warning/15 px-1.5 py-0.5 text-warning">
                    <StickyNote className="h-3 w-3" />
                    interna
                  </span>
                )}
              </div>
              <span className="text-[11px] text-white/35">
                {timeAgo(m.createdAt)}
              </span>
            </div>
            <p className="whitespace-pre-wrap text-sm text-white/90 leading-relaxed">
              {m.content}
            </p>
          </div>
        )
      })}
    </div>
  )
}

function ContextCard({
  ticket,
  onOpenLink,
}: {
  ticket: Ticket
  onOpenLink: () => void
}) {
  const navigate = useNavigate()
  const clients = useClients()
  const client = ticket.clientId
    ? clients.find((c) => c.id === ticket.clientId)
    : null

  const tenantServer = useServerById(client?.tenantServerId)

  return (
    <section className="rounded-xl border border-line bg-card p-4 space-y-4">
      {/* Identificação */}
      <div>
        <h3 className="text-[10px] uppercase tracking-wider text-white/45">
          Cliente
        </h3>
        <div className="mt-2 text-sm text-white">
          {ticket.customerName ?? ticket.customerCompany ?? ticket.customerEmail}
        </div>
        <div className="mt-1 space-y-0.5 text-xs text-white/55">
          <div className="inline-flex items-center gap-1.5">
            <Mail className="h-3 w-3" /> {ticket.customerEmail}
          </div>
          {ticket.customerPhone && (
            <div className="inline-flex items-center gap-1.5">
              <Phone className="h-3 w-3" /> {ticket.customerPhone}
            </div>
          )}
          {ticket.customerCnpj && (
            <div>CNPJ: {ticket.customerCnpj}</div>
          )}
        </div>
      </div>

      {ticket.needsLinking ? (
        <div className="space-y-3 rounded-lg border border-warning/30 bg-warning/[0.06] p-3">
          <div className="flex items-start gap-2 text-xs text-warning">
            <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>
              Cliente não vinculado ao CRM. Faça o vínculo pra ver pagamentos,
              tenant e histórico.
            </span>
          </div>
          <Button
            size="sm"
            variant="primary"
            onClick={onOpenLink}
            leftIcon={<Link2 className="h-3.5 w-3.5" />}
          >
            Vincular cliente
          </Button>
        </div>
      ) : client ? (
        <>
          <div className="rounded-lg border border-line bg-white/[0.02] p-3 space-y-2 text-xs">
            <div className="flex items-center justify-between">
              <span className="text-white/45">Empresa</span>
              <span className="text-white/90 truncate ml-2">{client.company || client.name}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-white/45">Etapa</span>
              <Badge tone="info">{client.stage}</Badge>
            </div>
            {client.responsavel && (
              <div className="flex items-center justify-between">
                <span className="text-white/45">Responsável</span>
                <span className="text-white/90">{client.responsavel}</span>
              </div>
            )}
          </div>

          {/* Tenant */}
          {client.tenantId && (
            <div className="rounded-lg border border-line bg-white/[0.02] p-3 space-y-2 text-xs">
              <div className="flex items-center justify-between">
                <span className="text-white/45">Tenant</span>
                <span className="text-white/90 truncate ml-2">
                  {client.tenantName ?? client.tenantId}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-white/45">Servidor</span>
                <span className="text-white/90">{tenantServer?.name ?? client.tenantServerId}</span>
              </div>
              {client.supportEmail && (
                <div className="flex items-center justify-between">
                  <span className="text-white/45">E-mail suporte</span>
                  <span className="text-white/85 truncate ml-2">{client.supportEmail}</span>
                </div>
              )}
              {tenantServer?.loginUrl && (
                <a
                  href={tenantServer.loginUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 text-accent hover:underline"
                >
                  Acessar painel <ExternalLink className="h-3 w-3" />
                </a>
              )}
            </div>
          )}

          {/* Financeiro */}
          <FinanceSummary client={client} />

          {/* Briefing/Contrato */}
          <div className="rounded-lg border border-line bg-white/[0.02] p-3 space-y-1.5 text-xs">
            <Row
              label="Contrato"
              value={
                client.contractSignedAt
                  ? `Assinado · ${formatDateShort(client.contractSignedAt)}`
                  : client.contractSentAt
                    ? `Enviado · ${formatDateShort(client.contractSentAt)}`
                    : 'Não enviado'
              }
            />
            <Row
              label="Briefing"
              value={
                client.briefingStatus === 'filled'
                  ? 'Preenchido'
                  : client.briefingStatus === 'approved'
                    ? 'Aprovado'
                    : client.briefingStatus === 'sent'
                      ? 'Enviado'
                      : 'Não enviado'
              }
            />
            <Row
              label="Entrega"
              value={
                client.deliveryCompletedAt
                  ? `Concluída · ${formatDateShort(client.deliveryCompletedAt)}`
                  : 'Pendente'
              }
            />
          </div>

          <Button
            size="sm"
            variant="secondary"
            onClick={() => navigate(`/clients?open=${client.id}`)}
            leftIcon={<ExternalLink className="h-3.5 w-3.5" />}
          >
            Abrir cliente completo
          </Button>
        </>
      ) : (
        <div className="text-xs text-white/45">Cliente vinculado mas não encontrado em cache.</div>
      )}

      {/* SLA */}
      {ticket.slaDueAt && (
        <div className="rounded-lg border border-line bg-white/[0.02] p-3 text-xs">
          <div className="flex items-center justify-between">
            <span className="text-white/45">SLA</span>
            <span
              className={cn(
                'inline-flex items-center gap-1',
                new Date(ticket.slaDueAt) < new Date() && ticket.status !== 'resolved' && ticket.status !== 'closed'
                  ? 'text-danger'
                  : 'text-white/85',
              )}
            >
              <Clock3 className="h-3 w-3" />
              {formatDateShort(ticket.slaDueAt)}
            </span>
          </div>
          {ticket.firstResponseAt && (
            <div className="mt-1 flex items-center justify-between text-success">
              <span className="text-white/45">Respondido</span>
              <span className="inline-flex items-center gap-1">
                <CheckCircle2 className="h-3 w-3" />
                {timeAgo(ticket.firstResponseAt)}
              </span>
            </div>
          )}
        </div>
      )}
    </section>
  )
}

function FinanceSummary({ client }: { client: Client }) {
  const payments = client.payments ?? []
  const paid = payments
    .filter((p) => p.paidAt)
    .reduce((acc, p) => acc + (p.value || 0), 0)
  const pending = payments
    .filter((p) => !p.paidAt)
    .reduce((acc, p) => acc + (p.value || 0), 0)
  const overdue = payments.some(
    (p) => !p.paidAt && p.dueDate && new Date(p.dueDate) < new Date(),
  )

  return (
    <div
      className={cn(
        'rounded-lg border p-3 space-y-1.5 text-xs',
        overdue ? 'border-danger/30 bg-danger/[0.04]' : 'border-line bg-white/[0.02]',
      )}
    >
      {overdue && (
        <div className="mb-1 inline-flex items-center gap-1 text-danger">
          <AlertTriangle className="h-3 w-3" />
          Tem pagamento vencido
        </div>
      )}
      <Row
        label="Mensalidade"
        value={
          client.monthlyValue
            ? `R$ ${client.monthlyValue.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`
            : '—'
        }
      />
      <Row
        label="Total pago"
        value={`R$ ${paid.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`}
      />
      {pending > 0 && (
        <Row
          label="Pendente"
          value={`R$ ${pending.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`}
        />
      )}
    </div>
  )
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-white/45">{label}</span>
      <span className="text-white/85 truncate ml-2">{value}</span>
    </div>
  )
}

// =====================================================================
// Modal de vínculo manual de cliente
// =====================================================================

function LinkClientModal({
  open,
  onClose,
  ticket,
}: {
  open: boolean
  onClose: () => void
  ticket: Ticket
}) {
  const clients = useClients()
  const [query, setQuery] = React.useState('')
  const [creating, setCreating] = React.useState(false)

  React.useEffect(() => {
    if (open) {
      // Sugere busca por email / empresa do ticket
      setQuery(ticket.customerCompany || ticket.customerEmail || '')
    }
  }, [open, ticket])

  const filtered = React.useMemo(() => {
    if (!query.trim()) return clients.slice(0, 10)
    const q = query.toLowerCase()
    return clients
      .filter((c) => {
        const blob =
          (c.name + ' ' + c.email + ' ' + c.company + ' ' + (c.tenantName ?? '')).toLowerCase()
        return blob.includes(q)
      })
      .slice(0, 20)
  }, [clients, query])

  const link = async (clientId: string) => {
    await ticketsService.updateTicket(ticket.id, { clientId })
    toast.success('Cliente vinculado')
    onClose()
  }

  const createAndLink = async () => {
    setCreating(true)
    try {
      const created = db.createClient({
        name: ticket.customerName || ticket.customerEmail,
        company: ticket.customerCompany || ticket.customerName || ticket.customerEmail,
        email: ticket.customerEmail,
        phone: ticket.customerPhone ?? '',
        stage: 'active',
      })
      await ticketsService.updateTicket(ticket.id, { clientId: created.id })
      toast.success('Cliente criado e vinculado')
      onClose()
    } catch (err) {
      toast.error('Falha: ' + (err instanceof Error ? err.message : String(err)))
    } finally {
      setCreating(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Vincular cliente ao ticket"
      description="Busca por e-mail, empresa ou nome. Ou cria um novo cliente a partir dos dados do ticket."
      size="lg"
    >
      <div className="space-y-4">
        <Input
          placeholder="Buscar cliente…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          leftIcon={<Search className="h-4 w-4" />}
        />

        <div className="max-h-80 overflow-y-auto space-y-1.5">
          {filtered.length === 0 && (
            <p className="text-xs text-white/45 text-center py-4">
              Nenhum cliente encontrado.
            </p>
          )}
          {filtered.map((c) => (
            <button
              key={c.id}
              onClick={() => link(c.id)}
              className="flex w-full items-center justify-between gap-3 rounded-lg border border-line bg-white/[0.02] px-3 py-2 text-left hover:bg-accent/[0.04] hover:border-accent/40 transition-colors"
            >
              <div className="min-w-0">
                <div className="text-sm text-white truncate">
                  {c.company || c.name}
                </div>
                <div className="text-xs text-white/55 truncate">{c.email}</div>
              </div>
              <Link2 className="h-4 w-4 text-white/40" />
            </button>
          ))}
        </div>

        <div className="rounded-lg border border-dashed border-line bg-white/[0.02] p-3 text-xs">
          <div className="flex items-start gap-2">
            <Sparkles className="mt-0.5 h-3.5 w-3.5 text-accent" />
            <div className="flex-1">
              <p className="text-white/65">
                Não achou? Cria um cliente novo no CRM com os dados que o ticket
                trouxe (e-mail{' '}
                <strong className="text-white">{ticket.customerEmail}</strong>
                {ticket.customerCompany && (
                  <>
                    , empresa{' '}
                    <strong className="text-white">{ticket.customerCompany}</strong>
                  </>
                )}
                ).
              </p>
              <Button
                size="sm"
                variant="primary"
                className="mt-2"
                onClick={createAndLink}
                loading={creating}
              >
                Criar novo cliente e vincular
              </Button>
            </div>
          </div>
        </div>

        <div className="flex justify-end">
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
        </div>
      </div>

      {/* Suprime unused import warning de X */}
      <X className="hidden" />
    </Modal>
  )
}

// (ArrowLeft está aqui pra ser usado eventualmente — não remove)
const _arrowLeft = ArrowLeft
void _arrowLeft
