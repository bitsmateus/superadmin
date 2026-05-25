import * as React from 'react'
import { Navigate } from 'react-router-dom'
import {
  Award,
  CheckCircle2,
  MessageCircle,
  TrendingUp,
  Trophy,
  Users,
} from 'lucide-react'
import { TopBar } from '@/components/layout/TopBar'
import { Skeleton } from '@/components/ui/Skeleton'
import { EmptyState } from '@/components/ui/EmptyState'
import { useAuth } from '@/hooks/useAuth'
import { useClients } from '@/hooks/useClients'
import { useTickets } from '@/hooks/useTickets'
import { useAnalyticsBooted, useStageHistory } from '@/hooks/useAnalytics'
import { canManageUsers, supabase, type Profile } from '@/services/supabase'
import { computeAgentPerformance } from '@/lib/analytics'
import { cn, initials } from '@/lib/utils'

export function TeamPerformancePage() {
  const { profile, loading: authLoading } = useAuth()
  const clients = useClients()
  const tickets = useTickets()
  const history = useStageHistory()
  const analyticsBooted = useAnalyticsBooted()
  const [profiles, setProfiles] = React.useState<Profile[]>([])
  const [loadingProfiles, setLoadingProfiles] = React.useState(true)

  React.useEffect(() => {
    if (!canManageUsers(profile?.role)) return
    void (async () => {
      setLoadingProfiles(true)
      const { data } = await supabase
        .from('profiles')
        .select('*')
        .order('created_at', { ascending: true })
      setProfiles((data as Profile[]) ?? [])
      setLoadingProfiles(false)
    })()
  }, [profile?.role])

  const agentMap = React.useMemo(() => {
    const m = new Map<string, { name?: string | null; email: string }>()
    for (const p of profiles) m.set(p.id, { name: p.name, email: p.email })
    return m
  }, [profiles])

  const perf = React.useMemo(
    () => computeAgentPerformance(clients, history, tickets, agentMap),
    [clients, history, tickets, agentMap],
  )

  if (authLoading) return null
  if (!canManageUsers(profile?.role)) return <Navigate to="/" replace />

  const ready = analyticsBooted && !loadingProfiles

  const monthName = new Date().toLocaleDateString('pt-BR', {
    month: 'long',
    year: 'numeric',
  })

  const totalConversions = perf.reduce((acc, p) => acc + p.conversionsThisMonth, 0)
  const totalTickets = perf.reduce((acc, p) => acc + p.ticketsResolvedThisMonth, 0)
  const leader = perf[0]

  return (
    <>
      <TopBar
        title="Performance da equipe"
        subtitle={`Visão consolidada · ${monthName}`}
      />

      <div className="px-8 py-6 space-y-6">
        {/* Resumo */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <SummaryCard
            icon={<Users className="h-4 w-4" />}
            label="Atendentes ativos"
            value={ready ? perf.length : null}
            tone="info"
          />
          <SummaryCard
            icon={<TrendingUp className="h-4 w-4" />}
            label="Conversões no mês"
            value={ready ? totalConversions : null}
            tone="success"
          />
          <SummaryCard
            icon={<CheckCircle2 className="h-4 w-4" />}
            label="Tickets resolvidos no mês"
            value={ready ? totalTickets : null}
            tone="info"
          />
        </div>

        {/* Líder do mês */}
        {ready && leader && (
          <div className="rounded-xl border border-success/30 bg-gradient-to-br from-success/10 to-transparent p-5">
            <div className="flex items-center gap-4">
              <div className="grid h-14 w-14 place-items-center rounded-full bg-success/20 text-success ring-2 ring-success/40">
                <Trophy className="h-6 w-6" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-[10px] uppercase tracking-wider text-success">
                  Líder do mês
                </div>
                <div className="text-lg font-semibold text-foreground">
                  {leader.agentKey}
                </div>
                <div className="text-xs text-foreground/60">
                  {leader.conversionsThisMonth} conversão(ões) ·{' '}
                  {leader.ticketsResolvedThisMonth} ticket(s) resolvido(s) ·{' '}
                  {leader.activeClients} cliente(s) ativo(s)
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Ranking */}
        {!ready ? (
          <div className="space-y-2">
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-16 w-full" />
          </div>
        ) : perf.length === 0 ? (
          <EmptyState
            icon={<Users className="h-5 w-5" />}
            title="Sem dados de equipe ainda"
            description="Atribua responsável aos clientes e/ou tickets pra ver performance individual aqui."
          />
        ) : (
          <section className="rounded-xl border border-line bg-card">
            <header className="border-b border-line px-5 py-3">
              <h2 className="text-sm font-semibold text-foreground">
                Ranking individual
              </h2>
              <p className="text-xs text-foreground/55">
                Ordenado por conversões + tickets resolvidos no mês corrente.
              </p>
            </header>
            <ul className="divide-y divide-line">
              {perf.map((p, i) => (
                <PerfRow key={p.agentKey} agent={p} rank={i + 1} />
              ))}
            </ul>
          </section>
        )}
      </div>
    </>
  )
}

function PerfRow({
  agent,
  rank,
}: {
  agent: ReturnType<typeof computeAgentPerformance>[number]
  rank: number
}) {
  const isPodium = rank <= 3
  return (
    <li className="flex items-center gap-4 px-5 py-3">
      <div
        className={cn(
          'grid h-8 w-8 shrink-0 place-items-center rounded-full text-xs font-semibold',
          rank === 1 && 'bg-yellow-400/15 text-yellow-300 ring-1 ring-yellow-400/30',
          rank === 2 && 'bg-zinc-300/15 text-zinc-200 ring-1 ring-zinc-300/30',
          rank === 3 && 'bg-amber-700/15 text-amber-600 ring-1 ring-amber-700/30',
          !isPodium && 'bg-elevate/[0.04] text-foreground/55 ring-1 ring-line',
        )}
      >
        {rank}
      </div>
      <div className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-elevate/[0.04] text-[11px] font-medium text-foreground/80 ring-1 ring-line">
        {initials(agent.agentKey)}
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium text-foreground truncate">
          {agent.agentKey}
        </div>
        <div className="text-[11px] text-foreground/45">
          {agent.activeClients} cliente(s) ativo(s)
        </div>
      </div>
      <Stat
        icon={<TrendingUp className="h-3.5 w-3.5" />}
        label="Conversões"
        value={agent.conversionsThisMonth}
        tone="success"
      />
      <Stat
        icon={<MessageCircle className="h-3.5 w-3.5" />}
        label="Tickets"
        value={agent.ticketsResolvedThisMonth}
        tone="info"
      />
      {isPodium && (
        <Award
          className={cn(
            'h-4 w-4 shrink-0',
            rank === 1 && 'text-yellow-300',
            rank === 2 && 'text-zinc-300',
            rank === 3 && 'text-amber-600',
          )}
        />
      )}
    </li>
  )
}

function Stat({
  icon,
  label,
  value,
  tone,
}: {
  icon: React.ReactNode
  label: string
  value: number
  tone: 'success' | 'info'
}) {
  return (
    <div className="text-right shrink-0">
      <div
        className={cn(
          'inline-flex items-center gap-1 text-xs',
          tone === 'success' ? 'text-success' : 'text-accent',
        )}
      >
        {icon}
        <span className="font-semibold">{value}</span>
      </div>
      <div className="text-[10px] uppercase tracking-wider text-foreground/45">
        {label}
      </div>
    </div>
  )
}

function SummaryCard({
  icon,
  label,
  value,
  tone,
}: {
  icon: React.ReactNode
  label: string
  value: number | null
  tone: 'info' | 'success'
}) {
  const tones = {
    info: 'bg-accent/10 text-accent ring-accent/20',
    success: 'bg-success/10 text-success ring-success/20',
  }
  return (
    <div className="rounded-xl border border-line bg-card p-4">
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
          <span className="text-2xl font-semibold tracking-tight text-foreground">
            {value.toLocaleString('pt-BR')}
          </span>
        )}
      </div>
    </div>
  )
}
