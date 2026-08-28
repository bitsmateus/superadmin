import * as React from 'react'
import { useNavigate } from 'react-router-dom'
import {
  AlertTriangle,
  CheckCircle2,
  ChevronRight,
  Clock,
  MessageCircle,
} from 'lucide-react'
import { TopBar } from '@/components/layout/TopBar'
import { AlertsPanel } from '@/components/crm/AlertsPanel'
import { TodayActions } from '@/components/crm/TodayActions'
import { useTickets, useTicketsBooted } from '@/hooks/useTickets'
import { useOutsideClose } from '@/hooks/useOutsideClose'
import { Skeleton } from '@/components/ui/Skeleton'
import { cn } from '@/lib/utils'
import type { Ticket } from '@/types/ticket'

/**
 * Dashboard principal — visão do suporte:
 *  - 4 cards de métricas de tickets (sempre visíveis, zerados quando vazio)
 *  - AlertsPanel com todas as seções pré-definidas (vazias mostram "Nada por aqui"),
 *    incluindo follow-ups pendentes (copiar mensagem / marcar como enviado)
 *
 * Sem tenants, sem financeiro, sem metas — esses ficam no /comando.
 */
export function DashboardPage() {
  const tickets = useTickets()
  const booted = useTicketsBooted()

  const metrics = React.useMemo(() => {
    const now = Date.now()
    const startOfDay = new Date()
    startOfDay.setHours(0, 0, 0, 0)
    const startMs = startOfDay.getTime()

    const open: Ticket[] = []
    const waitingCustomer: Ticket[] = []
    const slaOverdue: Ticket[] = []
    const resolvedToday: Ticket[] = []

    for (const t of tickets) {
      if (t.status === 'new' || t.status === 'open') open.push(t)
      if (t.status === 'pending_customer') waitingCustomer.push(t)
      if (
        t.slaDueAt &&
        new Date(t.slaDueAt).getTime() < now &&
        (t.status === 'new' || t.status === 'open')
      )
        slaOverdue.push(t)
      if (t.resolvedAt && new Date(t.resolvedAt).getTime() >= startMs)
        resolvedToday.push(t)
    }

    return { open, waitingCustomer, slaOverdue, resolvedToday }
  }, [tickets])

  return (
    <>
      <TopBar
        title="Dashboard Suporte"
        subtitle="Painel do suporte — alertas e follow-ups do dia"
      />

      <div className="px-4 py-4 sm:px-6 sm:py-6 lg:px-8">
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <MetricCard
            icon={<MessageCircle className="h-4 w-4" />}
            label="Tickets em aberto"
            tickets={booted ? metrics.open : null}
            tone="info"
          />
          <MetricCard
            icon={<Clock className="h-4 w-4" />}
            label="Aguardando cliente"
            tickets={booted ? metrics.waitingCustomer : null}
            tone="warning"
          />
          <MetricCard
            icon={<AlertTriangle className="h-4 w-4" />}
            label="SLA vencido"
            tickets={booted ? metrics.slaOverdue : null}
            tone="danger"
          />
          <MetricCard
            icon={<CheckCircle2 className="h-4 w-4" />}
            label="Resolvidos hoje"
            tickets={booted ? metrics.resolvedToday : null}
            tone="success"
          />
        </div>

        <section className="mt-6">
          <TodayActions />
        </section>

        <section className="mt-6">
          <AlertsPanel />
        </section>
      </div>
    </>
  )
}

function MetricCard({
  icon,
  label,
  tickets,
  tone,
}: {
  icon: React.ReactNode
  label: string
  tickets: Ticket[] | null
  tone: 'info' | 'success' | 'danger' | 'warning'
}) {
  const navigate = useNavigate()
  const [open, setOpen] = React.useState(false)
  const ref = React.useRef<HTMLDivElement>(null)
  useOutsideClose(ref, open, () => setOpen(false))

  const tones = {
    info: 'bg-accent/10 text-accent ring-accent/20',
    success: 'bg-success/10 text-success ring-success/20',
    danger: 'bg-danger/10 text-danger ring-danger/20',
    warning: 'bg-warning/10 text-warning ring-warning/20',
  }

  const openTicket = (id: string) => navigate(`/tickets/${id}`)

  const handleClick = () => {
    if (!tickets || tickets.length === 0) return
    // 1 resultado só = já abre direto o ticket. Mais de um = lista pra escolher qual.
    if (tickets.length === 1) { openTicket(tickets[0].id); return }
    setOpen((o) => !o)
  }

  const clickable = Boolean(tickets && tickets.length > 0)

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={handleClick}
        disabled={!clickable}
        className={cn(
          'w-full rounded-2xl border border-line bg-card p-4 text-left shadow-sm transition-all',
          clickable
            ? 'cursor-pointer hover:-translate-y-0.5 hover:border-elevate/20 hover:shadow-md'
            : 'cursor-default',
        )}
      >
        <div className="flex items-center justify-between">
          <span className="text-xs uppercase tracking-wider text-foreground/45">
            {label}
          </span>
          <span
            className={cn(
              'grid h-7 w-7 place-items-center rounded-lg ring-1',
              tones[tone],
            )}
          >
            {icon}
          </span>
        </div>
        <div className="mt-3">
          {tickets === null ? (
            <Skeleton className="h-7 w-16" />
          ) : (
            <span
              className={cn(
                'text-2xl font-semibold tracking-tight tabular-nums',
                tickets.length === 0 ? 'text-foreground/40' : 'text-foreground',
              )}
            >
              {tickets.length.toLocaleString('pt-BR')}
            </span>
          )}
        </div>
      </button>

      {open && tickets && (
        <div className="absolute left-0 top-full z-20 mt-1 w-72 rounded-xl border border-line bg-card p-1.5 shadow-xl animate-fade-in">
          <ul className="max-h-64 overflow-y-auto">
            {tickets.map((t) => (
              <li key={t.id}>
                <button
                  type="button"
                  onClick={() => { openTicket(t.id); setOpen(false) }}
                  className="flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left text-xs text-foreground/70 hover:bg-elevate/[0.05]"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium text-foreground/85">
                      {t.subject || 'Sem assunto'}
                    </span>
                    <span className="block truncate text-[10px] text-foreground/40">
                      {t.customerCompany || t.customerName || t.customerEmail}
                    </span>
                  </span>
                  <ChevronRight className="h-3 w-3 shrink-0 text-foreground/30" />
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
