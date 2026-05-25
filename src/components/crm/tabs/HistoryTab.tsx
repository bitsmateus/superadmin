import * as React from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Activity,
  CalendarCheck,
  CreditCard,
  ExternalLink,
  MessageCircle,
  MessageSquare,
  Send,
  Sparkles,
  Star,
  StickyNote,
  UserCircle2,
} from 'lucide-react'
import { Section } from '../ClientDrawer'
import { Badge } from '@/components/ui/Badge'
import { EmptyState } from '@/components/ui/EmptyState'
import { useNpsForClient } from '@/hooks/useTickets'
import { ticketsService } from '@/services/tickets'
import { cn } from '@/lib/utils'
import { timeAgo } from '@/lib/time'
import type { Client, Payment } from '@/types/client'
import type { Ticket } from '@/types/ticket'

/**
 * Timeline unificada por cliente: junta notas, logs, pagamentos, tickets,
 * follow-ups e NPS num feed cronológico único.
 *
 * Ideal pro suporte/responsável bater o olho e entender tudo que rolou.
 */
export function HistoryTab({ client }: { client: Client }) {
  const navigate = useNavigate()
  const nps = useNpsForClient(client.id)
  const [tickets, setTickets] = React.useState<Ticket[]>([])

  React.useEffect(() => {
    // Pega tickets desse cliente da cache + se necessário busca também
    setTickets(ticketsService.getTicketsByClient(client.id))
    return ticketsService.subscribe(() => {
      setTickets(ticketsService.getTicketsByClient(client.id))
    })
  }, [client.id])

  const events = React.useMemo<TimelineEvent[]>(() => {
    const out: TimelineEvent[] = []

    // Notas
    for (const n of client.notes ?? []) {
      out.push({
        id: `note:${n.id}`,
        kind: 'note',
        at: n.createdAt,
        title: n.author || 'Nota',
        description: n.text,
        internal: n.internal,
      })
    }

    // Logs
    for (const l of client.logs ?? []) {
      out.push({
        id: `log:${l.id}`,
        kind: 'log',
        at: l.createdAt,
        title: l.action,
        description: l.detail,
      })
    }

    // Pagamentos
    for (const p of client.payments ?? []) {
      out.push({
        id: `pay:${p.id}`,
        kind: 'payment',
        at: p.paidAt ?? p.dueDate ?? p.createdAt ?? new Date().toISOString(),
        title: p.paidAt ? 'Pagamento recebido' : 'Pagamento em aberto',
        description: paymentDescription(p),
        tone: p.paidAt ? 'success' : 'warning',
      })
    }

    // Follow-ups (enviados)
    for (const f of client.followUps ?? []) {
      if (!f.sentAt) continue
      out.push({
        id: `fu:${f.id}`,
        kind: 'followup',
        at: f.sentAt,
        title: `Follow-up dia ${f.dayNumber}`,
        description: f.message?.slice(0, 200),
      })
    }

    // Tickets
    for (const t of tickets) {
      out.push({
        id: `tk:${t.id}`,
        kind: 'ticket',
        at: t.openedAt,
        title: `Ticket #${t.number}: ${t.subject}`,
        description: `Status: ${t.status} · Prioridade: ${t.priority}`,
        ticketId: t.id,
        tone: t.priority === 'urgent' ? 'danger' : t.priority === 'high' ? 'warning' : 'info',
      })
      if (t.resolvedAt) {
        out.push({
          id: `tk-resolved:${t.id}`,
          kind: 'ticket_resolved',
          at: t.resolvedAt,
          title: `Ticket #${t.number} resolvido`,
          description: t.subject,
          ticketId: t.id,
          tone: 'success',
        })
      }
    }

    // NPS
    for (const n of nps) {
      if (n.respondedAt && typeof n.score === 'number') {
        out.push({
          id: `nps:${n.id}`,
          kind: 'nps',
          at: n.respondedAt,
          title: `NPS respondido: nota ${n.score}`,
          description: n.comment,
          tone:
            n.classification === 'promoter'
              ? 'success'
              : n.classification === 'detractor'
                ? 'danger'
                : 'warning',
        })
      }
    }

    return out.sort((a, b) => b.at.localeCompare(a.at))
  }, [client, tickets, nps])

  // Agrupa por dia
  const groups = React.useMemo(() => {
    const map = new Map<string, TimelineEvent[]>()
    for (const ev of events) {
      const day = ev.at.slice(0, 10)
      if (!map.has(day)) map.set(day, [])
      map.get(day)!.push(ev)
    }
    return Array.from(map.entries())
  }, [events])

  return (
    <div className="space-y-4">
      <Section
        title={
          <span className="flex items-center gap-2">
            <Activity className="h-3.5 w-3.5 text-accent" />
            Histórico unificado
          </span>
        }
        action={
          <Badge tone="neutral">{events.length} evento(s)</Badge>
        }
      >
        {events.length === 0 ? (
          <EmptyState
            title="Sem histórico ainda"
            description="Notas, pagamentos, tickets, follow-ups e respostas NPS aparecem aqui em ordem cronológica."
          />
        ) : (
          <ol className="space-y-5">
            {groups.map(([day, items]) => (
              <li key={day}>
                <div className="mb-2 text-[10px] uppercase tracking-wider text-foreground/40">
                  {formatDay(day)}
                </div>
                <ol className="relative space-y-2 border-l border-line pl-5">
                  {items.map((ev) => (
                    <TimelineRow
                      key={ev.id}
                      event={ev}
                      onOpenTicket={(id) => navigate(`/tickets/${id}`)}
                    />
                  ))}
                </ol>
              </li>
            ))}
          </ol>
        )}
      </Section>
    </div>
  )
}

interface TimelineEvent {
  id: string
  kind:
    | 'note'
    | 'log'
    | 'payment'
    | 'followup'
    | 'ticket'
    | 'ticket_resolved'
    | 'nps'
  at: string
  title: string
  description?: string
  internal?: boolean
  ticketId?: string
  tone?: 'success' | 'danger' | 'warning' | 'info' | 'neutral'
}

function TimelineRow({
  event,
  onOpenTicket,
}: {
  event: TimelineEvent
  onOpenTicket: (id: string) => void
}) {
  const { Icon, tone } = kindMeta(event)

  return (
    <li className="relative">
      <span
        className={cn(
          'absolute -left-[27px] top-1 grid h-4 w-4 place-items-center rounded-full ring-4 ring-card',
          toneBg(tone),
        )}
      >
        <Icon className="h-2.5 w-2.5" />
      </span>
      <div
        className={cn(
          'rounded-lg border p-3 transition-colors',
          event.internal
            ? 'border-warning/30 bg-warning/[0.05]'
            : 'border-line bg-elevate/[0.02]',
        )}
      >
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5">
              <span className="text-sm font-medium text-foreground">
                {event.title}
              </span>
              {event.internal && (
                <span className="inline-flex items-center gap-1 rounded bg-warning/15 px-1.5 py-0.5 text-[10px] text-warning">
                  <StickyNote className="h-3 w-3" />
                  interna
                </span>
              )}
            </div>
            {event.description && (
              <p className="mt-1 whitespace-pre-wrap text-xs text-foreground/65 line-clamp-3">
                {event.description}
              </p>
            )}
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            <span className="text-[10px] text-foreground/35">
              {timeAgo(event.at)}
            </span>
            {event.ticketId && (
              <button
                onClick={() => onOpenTicket(event.ticketId!)}
                className="rounded-md p-1 text-foreground/40 hover:bg-elevate/[0.06] hover:text-foreground"
                title="Abrir ticket"
              >
                <ExternalLink className="h-3 w-3" />
              </button>
            )}
          </div>
        </div>
      </div>
    </li>
  )
}

function kindMeta(ev: TimelineEvent): {
  Icon: React.ComponentType<{ className?: string }>
  tone: 'success' | 'danger' | 'warning' | 'info' | 'neutral'
} {
  if (ev.tone) {
    return { Icon: getIconForKind(ev.kind), tone: ev.tone }
  }
  switch (ev.kind) {
    case 'note':
      return { Icon: MessageSquare, tone: ev.internal ? 'warning' : 'info' }
    case 'log':
      return { Icon: Sparkles, tone: 'neutral' }
    case 'payment':
      return { Icon: CreditCard, tone: 'success' }
    case 'followup':
      return { Icon: Send, tone: 'info' }
    case 'ticket':
      return { Icon: MessageCircle, tone: 'info' }
    case 'ticket_resolved':
      return { Icon: CalendarCheck, tone: 'success' }
    case 'nps':
      return { Icon: Star, tone: 'success' }
    default:
      return { Icon: UserCircle2, tone: 'neutral' }
  }
}

function getIconForKind(kind: TimelineEvent['kind']): React.ComponentType<{ className?: string }> {
  switch (kind) {
    case 'note': return MessageSquare
    case 'log': return Sparkles
    case 'payment': return CreditCard
    case 'followup': return Send
    case 'ticket': return MessageCircle
    case 'ticket_resolved': return CalendarCheck
    case 'nps': return Star
    default: return UserCircle2
  }
}

function toneBg(tone: 'success' | 'danger' | 'warning' | 'info' | 'neutral'): string {
  switch (tone) {
    case 'success':
      return 'bg-success/20 text-success'
    case 'danger':
      return 'bg-danger/20 text-danger'
    case 'warning':
      return 'bg-warning/20 text-warning'
    case 'info':
      return 'bg-accent/20 text-accent'
    default:
      return 'bg-elevate/[0.06] text-foreground/55'
  }
}

function paymentDescription(p: Payment): string {
  const valor = `R$ ${p.value.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`
  const tipo = p.type === 'monthly' ? 'Mensalidade' : p.type === 'implementation' ? 'Implementação' : 'Outro'
  return `${tipo} · ${valor}${p.method ? ` · ${p.method}` : ''}${p.reference ? ` · ${p.reference}` : ''}`
}

function formatDay(iso: string): string {
  const today = new Date()
  const d = new Date(iso + 'T00:00:00')
  const todayStr = today.toISOString().slice(0, 10)
  const yesterday = new Date(today.getTime() - 86_400_000).toISOString().slice(0, 10)
  if (iso === todayStr) return 'Hoje'
  if (iso === yesterday) return 'Ontem'
  return d.toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long' })
}

