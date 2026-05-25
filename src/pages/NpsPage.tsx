import * as React from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import {
  Award,
  Copy,
  ExternalLink,
  Frown,
  Meh,
  Send,
  Smile,
  Star,
  ThumbsDown,
} from 'lucide-react'
import { toast } from 'sonner'
import { TopBar } from '@/components/layout/TopBar'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { EmptyState } from '@/components/ui/EmptyState'
import { useAuth } from '@/hooks/useAuth'
import { useNpsResponses } from '@/hooks/useTickets'
import { useClients } from '@/hooks/useClients'
import { ticketsService } from '@/services/tickets'
import { canSeeFinancials } from '@/services/supabase'
import { copyToClipboard } from '@/lib/clipboard'
import { cn, formatDateShort } from '@/lib/utils'
import { timeAgo } from '@/lib/time'
import type { NpsResponse } from '@/types/ticket'

export function NpsPage() {
  const { profile, loading } = useAuth()
  const navigate = useNavigate()
  const responses = useNpsResponses()
  const clients = useClients()

  // Todos os useMemo PRECISAM vir antes dos early returns — Rules of Hooks.
  const answered = React.useMemo(
    () => responses.filter((r) => r.respondedAt),
    [responses],
  )
  const pending = React.useMemo(
    () => responses.filter((r) => !r.respondedAt),
    [responses],
  )

  const stats = React.useMemo(() => {
    const promoters = answered.filter((r) => r.classification === 'promoter').length
    const detractors = answered.filter((r) => r.classification === 'detractor').length
    const neutrals = answered.filter((r) => r.classification === 'neutral').length
    const total = answered.length
    const nps = total === 0 ? 0 : Math.round(((promoters - detractors) / total) * 100)
    const avgScore =
      total === 0
        ? 0
        : answered.reduce((acc, r) => acc + (r.score ?? 0), 0) / total
    return { promoters, detractors, neutrals, total, nps, avgScore }
  }, [answered])

  const distribution = React.useMemo(() => {
    const buckets = Array.from({ length: 11 }, () => 0)
    for (const r of answered) {
      if (typeof r.score === 'number') buckets[r.score]++
    }
    return buckets
  }, [answered])

  const detractorList = React.useMemo(
    () =>
      answered
        .filter((r) => r.classification === 'detractor')
        .sort((a, b) => (b.respondedAt ?? '').localeCompare(a.respondedAt ?? '')),
    [answered],
  )

  const recentResponses = React.useMemo(
    () =>
      [...answered]
        .sort((a, b) => (b.respondedAt ?? '').localeCompare(a.respondedAt ?? ''))
        .slice(0, 20),
    [answered],
  )

  if (loading) return null
  if (!canSeeFinancials(profile?.role)) return <Navigate to="/" replace />

  const { promoters, detractors, neutrals, total, nps, avgScore } = stats

  const copyLink = async (token: string) => {
    const url = `${window.location.origin}/nps/${token}`
    const ok = await copyToClipboard(url)
    if (ok) toast.success('Link copiado')
    else toast.error('Falha ao copiar')
  }

  const markSent = async (id: string) => {
    await ticketsService.markNpsAsSent(id)
    toast.success('Marcado como enviado')
  }

  return (
    <>
      <TopBar
        title="NPS"
        subtitle={`${total} resposta(s) · ${pending.length} pendente(s)`}
      />

      <div className="px-8 py-6 space-y-5">
        {/* Header de métricas */}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
          <NpsScoreCard nps={nps} avgScore={avgScore} total={total} />
          <ClassMetric
            label="Promotores"
            value={promoters}
            pct={total === 0 ? 0 : (promoters / total) * 100}
            tone="success"
            icon={<Smile className="h-4 w-4" />}
          />
          <ClassMetric
            label="Neutros"
            value={neutrals}
            pct={total === 0 ? 0 : (neutrals / total) * 100}
            tone="warning"
            icon={<Meh className="h-4 w-4" />}
          />
          <ClassMetric
            label="Detratores"
            value={detractors}
            pct={total === 0 ? 0 : (detractors / total) * 100}
            tone="danger"
            icon={<Frown className="h-4 w-4" />}
          />
        </div>

        {/* Distribuição */}
        {total > 0 && (
          <section className="rounded-xl border border-line bg-card p-4">
            <h3 className="mb-3 text-sm font-medium text-white">
              Distribuição de notas
            </h3>
            <Distribution distribution={distribution} />
          </section>
        )}

        {/* Pendentes (links pra enviar) */}
        {pending.length > 0 && (
          <section className="rounded-xl border border-line bg-card p-4">
            <header className="mb-3 flex items-center justify-between">
              <h3 className="inline-flex items-center gap-2 text-sm font-medium text-white">
                <Send className="h-4 w-4 text-accent" />
                Pesquisas pendentes
              </h3>
              <Badge tone="info">{pending.length}</Badge>
            </header>
            <p className="mb-3 text-xs text-white/55">
              Pesquisas criadas automaticamente após a entrega — copie o link e
              envie pro cliente (WhatsApp, e-mail).
            </p>
            <ul className="space-y-1.5">
              {pending.slice(0, 10).map((r) => {
                const client = clients.find((c) => c.id === r.clientId)
                const due = new Date(r.scheduledFor)
                const ready = due <= new Date()
                return (
                  <li
                    key={r.id}
                    className="flex items-center justify-between gap-3 rounded-lg border border-line bg-white/[0.02] px-3 py-2"
                  >
                    <div className="min-w-0">
                      <div className="text-sm text-white truncate">
                        {client?.company || client?.name || 'Cliente removido'}
                      </div>
                      <div className="text-[11px] text-white/55">
                        {ready ? 'Pronta pra enviar' : `Agendada pra ${formatDateShort(r.scheduledFor)}`}
                        {r.sentAt && ` · Enviada ${timeAgo(r.sentAt)}`}
                      </div>
                    </div>
                    <div className="flex shrink-0 gap-1">
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => copyLink(r.publicToken)}
                        leftIcon={<Copy className="h-3.5 w-3.5" />}
                      >
                        Copiar link
                      </Button>
                      {!r.sentAt && (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => markSent(r.id)}
                        >
                          Marcar enviada
                        </Button>
                      )}
                    </div>
                  </li>
                )
              })}
            </ul>
            {pending.length > 10 && (
              <div className="mt-2 text-center text-[11px] text-white/45">
                + {pending.length - 10} pendentes
              </div>
            )}
          </section>
        )}

        {/* Detratores em destaque */}
        {detractorList.length > 0 && (
          <section className="rounded-xl border border-danger/30 bg-danger/[0.04] p-4">
            <header className="mb-3 flex items-center justify-between">
              <h3 className="inline-flex items-center gap-2 text-sm font-medium text-danger">
                <ThumbsDown className="h-4 w-4" />
                Detratores · atenção
              </h3>
              <Badge tone="danger">{detractorList.length}</Badge>
            </header>
            <p className="mb-3 text-xs text-white/65">
              Clientes que deram nota 0-6. Vale uma ligação pra entender o que
              aconteceu e tentar reverter.
            </p>
            <ul className="space-y-2">
              {detractorList.slice(0, 8).map((r) => {
                const client = clients.find((c) => c.id === r.clientId)
                return (
                  <li
                    key={r.id}
                    className="rounded-lg border border-danger/20 bg-bg/40 p-3"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="grid h-6 w-6 place-items-center rounded-md bg-danger/15 text-danger ring-1 ring-danger/30 text-[11px] font-semibold">
                            {r.score}
                          </span>
                          <span className="text-sm text-white truncate">
                            {client?.company || client?.name || 'Cliente removido'}
                          </span>
                          <span className="text-[10px] text-white/40">
                            {timeAgo(r.respondedAt ?? '')}
                          </span>
                        </div>
                        {r.comment && (
                          <p className="mt-2 text-xs text-white/80 whitespace-pre-wrap">
                            "{r.comment}"
                          </p>
                        )}
                      </div>
                      {client && (
                        <button
                          onClick={() => navigate(`/clients?open=${client.id}`)}
                          className="shrink-0 rounded-md p-1.5 text-white/55 hover:bg-white/[0.06] hover:text-white"
                          title="Abrir cliente"
                        >
                          <ExternalLink className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </div>
                  </li>
                )
              })}
            </ul>
          </section>
        )}

        {/* Histórico recente */}
        <section className="rounded-xl border border-line bg-card p-4">
          <header className="mb-3 flex items-center justify-between">
            <h3 className="text-sm font-medium text-white">Respostas recentes</h3>
            <Badge tone="neutral">{answered.length}</Badge>
          </header>

          {recentResponses.length === 0 ? (
            <EmptyState
              icon={<Star className="h-5 w-5" />}
              title="Sem respostas ainda"
              description="As pesquisas são criadas automaticamente após você concluir a entrega de um cliente. Envie o link pendente pra começar a receber feedback."
            />
          ) : (
            <ul className="space-y-1.5">
              {recentResponses.map((r) => {
                const client = clients.find((c) => c.id === r.clientId)
                return <ResponseRow key={r.id} response={r} clientName={client?.company || client?.name} onOpenClient={client ? () => navigate(`/clients?open=${client.id}`) : undefined} />
              })}
            </ul>
          )}
        </section>
      </div>
    </>
  )
}

function NpsScoreCard({
  nps,
  avgScore,
  total,
}: {
  nps: number
  avgScore: number
  total: number
}) {
  const tone =
    nps >= 50 ? 'success' : nps >= 0 ? 'warning' : 'danger'
  const toneCls = {
    success: 'bg-success/10 text-success ring-success/20',
    warning: 'bg-warning/10 text-warning ring-warning/20',
    danger: 'bg-danger/10 text-danger ring-danger/20',
  }[tone]

  return (
    <div className="rounded-xl border border-line bg-card p-4">
      <div className="flex items-center justify-between">
        <span className="text-xs uppercase tracking-wider text-white/45">
          NPS
        </span>
        <span className={cn('grid h-7 w-7 place-items-center rounded-lg ring-1', toneCls)}>
          <Award className="h-4 w-4" />
        </span>
      </div>
      <div className="mt-3 text-3xl font-semibold tracking-tight text-white tabular-nums">
        {total === 0 ? '—' : nps}
      </div>
      <div className="mt-1 text-[11px] text-white/55">
        Média {avgScore.toFixed(1)} · {total} resposta(s)
      </div>
    </div>
  )
}

function ClassMetric({
  label,
  value,
  pct,
  tone,
  icon,
}: {
  label: string
  value: number
  pct: number
  tone: 'success' | 'warning' | 'danger'
  icon: React.ReactNode
}) {
  const toneCls = {
    success: 'bg-success/10 text-success ring-success/20',
    warning: 'bg-warning/10 text-warning ring-warning/20',
    danger: 'bg-danger/10 text-danger ring-danger/20',
  }[tone]
  return (
    <div className="rounded-xl border border-line bg-card p-4">
      <div className="flex items-center justify-between">
        <span className="text-xs uppercase tracking-wider text-white/45">
          {label}
        </span>
        <span className={cn('grid h-7 w-7 place-items-center rounded-lg ring-1', toneCls)}>
          {icon}
        </span>
      </div>
      <div className="mt-3 text-2xl font-semibold tabular-nums text-white">
        {value}
      </div>
      <div className="mt-1 text-[11px] text-white/55">{pct.toFixed(0)}%</div>
    </div>
  )
}

function Distribution({
  distribution,
}: {
  distribution: number[]
}) {
  const max = Math.max(1, ...distribution)
  return (
    <div className="grid grid-cols-11 gap-1.5">
      {distribution.map((count, i) => {
        const heightPct = (count / max) * 100
        const tone = i <= 6 ? 'danger' : i <= 8 ? 'warning' : 'success'
        return (
          <div key={i} className="flex flex-col items-center">
            <div className="h-24 w-full rounded-md bg-white/[0.04] relative overflow-hidden">
              <div
                className={cn(
                  'absolute inset-x-0 bottom-0 transition-all',
                  tone === 'danger'
                    ? 'bg-danger/70'
                    : tone === 'warning'
                      ? 'bg-warning/70'
                      : 'bg-success/70',
                )}
                style={{ height: `${heightPct}%` }}
              />
            </div>
            <div className="mt-1 text-[10px] text-white/45 tabular-nums">{i}</div>
            <div className="text-[10px] font-medium text-white tabular-nums">{count}</div>
          </div>
        )
      })}
    </div>
  )
}

function ResponseRow({
  response,
  clientName,
  onOpenClient,
}: {
  response: NpsResponse
  clientName?: string
  onOpenClient?: () => void
}) {
  const tone =
    response.classification === 'promoter'
      ? 'success'
      : response.classification === 'detractor'
        ? 'danger'
        : 'warning'
  const Icon =
    response.classification === 'promoter'
      ? Smile
      : response.classification === 'detractor'
        ? Frown
        : Meh

  return (
    <li className="flex items-center gap-3 rounded-lg border border-line bg-white/[0.02] px-3 py-2">
      <span
        className={cn(
          'grid h-7 w-7 place-items-center rounded-md ring-1 text-[11px] font-semibold',
          tone === 'success'
            ? 'bg-success/15 text-success ring-success/30'
            : tone === 'danger'
              ? 'bg-danger/15 text-danger ring-danger/30'
              : 'bg-warning/15 text-warning ring-warning/30',
        )}
      >
        {response.score}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 text-sm text-white">
          <Icon className="h-3.5 w-3.5 opacity-70" />
          <span className="truncate">{clientName ?? 'Cliente'}</span>
          <span className="text-[10px] text-white/40">
            {timeAgo(response.respondedAt ?? '')}
          </span>
        </div>
        {response.comment && (
          <p className="mt-0.5 text-xs text-white/65 truncate">
            "{response.comment}"
          </p>
        )}
      </div>
      {onOpenClient && (
        <button
          onClick={onOpenClient}
          className="shrink-0 rounded-md p-1.5 text-white/40 hover:bg-white/[0.06] hover:text-white"
        >
          <ExternalLink className="h-3.5 w-3.5" />
        </button>
      )}
    </li>
  )
}

