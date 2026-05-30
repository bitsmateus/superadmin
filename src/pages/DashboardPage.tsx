import * as React from 'react'
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  MessageCircle,
} from 'lucide-react'
import { TopBar } from '@/components/layout/TopBar'
import { AlertsPanel } from '@/components/crm/AlertsPanel'
import { TodayActions } from '@/components/crm/TodayActions'
import { useTickets, useTicketsBooted } from '@/hooks/useTickets'
import { Skeleton } from '@/components/ui/Skeleton'
import { cn } from '@/lib/utils'

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

    let open = 0
    let waitingCustomer = 0
    let slaOverdue = 0
    let resolvedToday = 0

    for (const t of tickets) {
      if (t.status === 'new' || t.status === 'open') open++
      if (t.status === 'pending_customer') waitingCustomer++
      if (
        t.slaDueAt &&
        new Date(t.slaDueAt).getTime() < now &&
        (t.status === 'new' || t.status === 'open')
      )
        slaOverdue++
      if (
        t.resolvedAt &&
        new Date(t.resolvedAt).getTime() >= startMs
      )
        resolvedToday++
    }

    return { open, waitingCustomer, slaOverdue, resolvedToday }
  }, [tickets])

  return (
    <>
      <TopBar
        title="Dashboard"
        subtitle="Painel do suporte — alertas e follow-ups do dia"
      />

      <div className="px-8 py-6">
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <MetricCard
            icon={<MessageCircle className="h-4 w-4" />}
            label="Tickets em aberto"
            value={booted ? metrics.open : null}
            tone="info"
          />
          <MetricCard
            icon={<Clock className="h-4 w-4" />}
            label="Aguardando cliente"
            value={booted ? metrics.waitingCustomer : null}
            tone="warning"
          />
          <MetricCard
            icon={<AlertTriangle className="h-4 w-4" />}
            label="SLA vencido"
            value={booted ? metrics.slaOverdue : null}
            tone="danger"
          />
          <MetricCard
            icon={<CheckCircle2 className="h-4 w-4" />}
            label="Resolvidos hoje"
            value={booted ? metrics.resolvedToday : null}
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
  value,
  tone,
}: {
  icon: React.ReactNode
  label: string
  value: number | null
  tone: 'info' | 'success' | 'danger' | 'warning'
}) {
  const tones = {
    info: 'bg-accent/10 text-accent ring-accent/20',
    success: 'bg-success/10 text-success ring-success/20',
    danger: 'bg-danger/10 text-danger ring-danger/20',
    warning: 'bg-warning/10 text-warning ring-warning/20',
  }
  return (
    <div className="rounded-xl border border-line bg-card p-4 transition-colors hover:border-elevate/10">
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
        {value === null ? (
          <Skeleton className="h-7 w-16" />
        ) : (
          <span
            className={cn(
              'text-2xl font-semibold tracking-tight tabular-nums',
              value === 0 ? 'text-foreground/40' : 'text-foreground',
            )}
          >
            {value.toLocaleString('pt-BR')}
          </span>
        )}
      </div>
    </div>
  )
}
