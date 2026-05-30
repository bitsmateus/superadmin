import * as React from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import {
  ArrowRight,
  CreditCard,
  TrendingUp,
} from 'lucide-react'
import { TopBar } from '@/components/layout/TopBar'
import { Button } from '@/components/ui/Button'
import { Skeleton } from '@/components/ui/Skeleton'
import { useAuth } from '@/hooks/useAuth'
import { useClients } from '@/hooks/useClients'
import { useTickets } from '@/hooks/useTickets'
import { useAnalyticsBooted, useStageHistory } from '@/hooks/useAnalytics'
import { AlertsPanel } from '@/components/crm/AlertsPanel'
import { GoalsCard } from '@/components/analytics/GoalsCard'
import { ConversionFunnel } from '@/components/analytics/ConversionFunnel'
import { StageDurations } from '@/components/analytics/StageDurations'
import { StuckClients } from '@/components/analytics/StuckClients'
import { canSeeFinancials } from '@/services/supabase'
import { computeAgentPerformance, formatCurrencyBRL } from '@/lib/analytics'
import { cn, initials } from '@/lib/utils'
import type { Client } from '@/types/client'

export function CommandCenterPage() {
  const { profile, loading: authLoading } = useAuth()
  const clients = useClients()
  const tickets = useTickets()
  const history = useStageHistory()
  const booted = useAnalyticsBooted()
  const navigate = useNavigate()

  if (authLoading) return null
  if (!canSeeFinancials(profile?.role)) return <Navigate to="/" replace />

  const today = new Date()
  const greeting =
    today.getHours() < 12
      ? 'Bom dia'
      : today.getHours() < 18
        ? 'Boa tarde'
        : 'Boa noite'

  return (
    <>
      <TopBar
        title="Centro de Comando"
        subtitle={`${greeting}${profile?.name ? `, ${profile.name.split(' ')[0]}` : ''}. Sua visão consolidada do dia.`}
      />

      <div className="px-8 py-6 space-y-6">
        {/* Linha 1: Metas + Performance resumida */}
        <section className="grid grid-cols-1 gap-5 lg:grid-cols-[1fr_360px]">
          <GoalsCard />
          <TeamSummary
            clients={clients}
            tickets={tickets}
            history={history}
            ready={booted}
            onSeeFull={() => navigate('/equipe')}
          />
        </section>

        {/* Linha 2: Funil + Tempo médio em stage */}
        <section className="grid grid-cols-1 gap-5 xl:grid-cols-2">
          {booted ? <ConversionFunnel /> : <Skeleton className="h-64 w-full" />}
          {booted ? <StageDurations /> : <Skeleton className="h-64 w-full" />}
        </section>

        {/* Linha 2b: Aging — clientes parados acima do SLA */}
        <section>
          <StuckClients />
        </section>

        {/* Linha 3: Alertas + Fila de cobranças */}
        <section className="grid grid-cols-1 gap-5 xl:grid-cols-[1fr_360px]">
          <AlertsPanel />
          <BillingQueue clients={clients} />
        </section>
      </div>
    </>
  )
}

function TeamSummary({
  clients,
  tickets,
  history,
  ready,
  onSeeFull,
}: {
  clients: Client[]
  tickets: ReturnType<typeof useTickets>
  history: ReturnType<typeof useStageHistory>
  ready: boolean
  onSeeFull: () => void
}) {
  const perf = React.useMemo(
    () =>
      computeAgentPerformance(
        clients,
        history,
        tickets,
        // Sem agentMap, tickets resolvidos por id são ignorados aqui — só
        // queremos um resumo top-N por responsável + conversões + clientes.
        new Map(),
      ),
    [clients, history, tickets],
  )

  const top3 = perf.slice(0, 3)

  return (
    <section className="rounded-xl border border-line bg-card p-5">
      <header className="mb-3 flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold text-foreground">Equipe — Top 3</h2>
          <p className="text-xs text-foreground/55">Por conversões no mês</p>
        </div>
        <Button size="sm" variant="secondary" onClick={onSeeFull}>
          Ver tudo
        </Button>
      </header>
      {!ready ? (
        <Skeleton className="h-24 w-full" />
      ) : top3.length === 0 ? (
        <p className="text-xs text-foreground/45">
          Nenhum responsável atribuído a clientes ainda.
        </p>
      ) : (
        <ul className="space-y-2">
          {top3.map((p, i) => (
            <li
              key={p.agentKey}
              className="flex items-center gap-3 rounded-lg border border-line bg-elevate/[0.02] px-3 py-2"
            >
              <div className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-elevate/[0.04] text-[10px] font-semibold text-foreground/80 ring-1 ring-line">
                {i + 1}
              </div>
              <div className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-elevate/[0.04] text-[10px] text-foreground/80 ring-1 ring-line">
                {initials(p.agentKey)}
              </div>
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm text-foreground">{p.agentKey}</div>
                <div className="text-[10px] text-foreground/45">
                  {p.activeClients} cliente(s) ativo(s)
                </div>
              </div>
              <div className="shrink-0 text-right">
                <div className="inline-flex items-center gap-1 text-xs text-success">
                  <TrendingUp className="h-3 w-3" />
                  <strong>{p.conversionsThisMonth}</strong>
                </div>
                <div className="text-[10px] text-foreground/45">conv.</div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

function BillingQueue({ clients }: { clients: Client[] }) {
  const navigate = useNavigate()
  const overdue = React.useMemo(() => {
    const now = Date.now()
    const list: { client: Client; total: number; oldest: string }[] = []
    for (const c of clients) {
      if (!c.payments) continue
      const overduePayments = c.payments.filter(
        (p) => !p.paidAt && p.dueDate && new Date(p.dueDate).getTime() < now,
      )
      if (overduePayments.length === 0) continue
      const total = overduePayments.reduce((s, p) => s + (p.value || 0), 0)
      const oldest = overduePayments
        .map((p) => p.dueDate!)
        .sort()[0]
      list.push({ client: c, total, oldest })
    }
    return list.sort((a, b) => a.oldest.localeCompare(b.oldest))
  }, [clients])

  const totalDue = overdue.reduce((s, o) => s + o.total, 0)

  return (
    <section className="rounded-xl border border-line bg-card p-5">
      <header className="mb-3 flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold text-foreground">Fila de cobrança</h2>
          <p className="text-xs text-foreground/55">
            {overdue.length} cliente(s) com pagamento vencido
          </p>
        </div>
        <div className="text-right">
          <div className="text-xs text-foreground/45">Total devido</div>
          <div
            className={cn(
              'text-sm font-semibold',
              totalDue > 0 ? 'text-danger' : 'text-success',
            )}
          >
            {formatCurrencyBRL(totalDue)}
          </div>
        </div>
      </header>
      {overdue.length === 0 ? (
        <div className="rounded-lg border border-success/20 bg-success/[0.04] px-3 py-4 text-center text-xs text-success">
          Nenhuma cobrança vencida 🎉
        </div>
      ) : (
        <ul className="space-y-2">
          {overdue.slice(0, 6).map(({ client, total, oldest }) => {
            const daysLate = Math.floor(
              (Date.now() - new Date(oldest).getTime()) / (24 * 60 * 60 * 1000),
            )
            return (
              <li
                key={client.id}
                className="flex items-center gap-3 rounded-lg border border-danger/15 bg-danger/[0.03] px-3 py-2"
              >
                <CreditCard className="h-4 w-4 shrink-0 text-danger" />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm text-foreground">
                    {client.company || client.name}
                  </div>
                  <div className="text-[10px] text-foreground/45">
                    {daysLate} dia(s) em atraso
                  </div>
                </div>
                <div className="shrink-0 text-right">
                  <div className="text-xs font-semibold text-danger">
                    {formatCurrencyBRL(total)}
                  </div>
                  <button
                    onClick={() => navigate(`/clients?open=${client.id}`)}
                    className="text-[10px] text-accent hover:underline"
                  >
                    Abrir
                  </button>
                </div>
              </li>
            )
          })}
          {overdue.length > 6 && (
            <li>
              <button
                onClick={() => navigate('/financeiro')}
                className="flex w-full items-center justify-center gap-1 rounded-lg border border-line bg-elevate/[0.02] px-3 py-2 text-xs text-foreground/70 hover:bg-elevate/[0.04]"
              >
                Ver todos no Financeiro
                <ArrowRight className="h-3 w-3" />
              </button>
            </li>
          )}
        </ul>
      )}
    </section>
  )
}

