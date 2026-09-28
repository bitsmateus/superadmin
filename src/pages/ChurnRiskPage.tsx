import * as React from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import {
  Building2,
  CreditCard,
  ExternalLink,
  HeartCrack,
  MessageCircleWarning,
  Plus,
  RefreshCw,
  Ticket as TicketIcon,
  Wifi,
} from 'lucide-react'
import { TopBar } from '@/components/layout/TopBar'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { Skeleton } from '@/components/ui/Skeleton'
import { EmptyState } from '@/components/ui/EmptyState'
import { useAuth } from '@/hooks/useAuth'
import { useTeam, teamMemberLabel } from '@/hooks/useTeam'
import { useChurnRisk } from '@/hooks/useChurnRisk'
import { ticketsService } from '@/services/tickets'
import { canSeeFinancials } from '@/services/supabase'
import { STAGE_COLORS } from '@/constants/stageColors'
import { cn } from '@/lib/utils'
import type { ChurnRiskItem } from '@/services/churnRisk'
import type { TeamMember } from '@/hooks/useTeam'

/** Casa o texto livre de responsável (responsavelEntrega/responsavel) com um membro do time —
 *  mesma regra usada em SupportWorkspacePage (PipelinePanel/unifiedTasks) pra "virar tarefa". */
function resolveTeamId(team: TeamMember[], name?: string | null): string | undefined {
  const n = (name ?? '').trim().toLowerCase()
  if (!n) return undefined
  const hit = team.find(
    (m) => (m.name ?? '').trim().toLowerCase() === n || m.email.trim().toLowerCase() === n,
  )
  return hit?.id
}

function signalSummary(item: ChurnRiskItem): string {
  const parts: string[] = []
  const d = item.details
  if (item.signals.pulse) {
    parts.push(
      d.pulseStatus === 'sem_resposta'
        ? 'Pulso de satisfação sem resposta'
        : 'Respondeu "não" no pulso de satisfação',
    )
  }
  if (item.signals.payment) {
    parts.push(`Pagamento em atraso${d.paymentSource === 'recorrai' ? ' (Recorrai)' : d.paymentSource === 'asaas' ? ' (Asaas)' : ''}`)
  }
  if (item.signals.channels) parts.push(`${d.channelsTotal} canal(is) desconectado(s)`)
  if (item.signals.tickets) {
    const t: string[] = []
    if (d.ticketsReopened > 0) t.push(`${d.ticketsReopened} ticket(s) reaberto(s)`)
    if (d.ticketsOverdue > 0) t.push(`${d.ticketsOverdue} ticket(s) com SLA estourado`)
    parts.push(t.join(' · '))
  }
  return parts.join(' · ')
}

export function ChurnRiskPage() {
  const { profile, loading: authLoading } = useAuth()
  const team = useTeam()
  const navigate = useNavigate()
  const { data, isLoading, isFetching, isError, refetch } = useChurnRisk()
  const [creating, setCreating] = React.useState<string | null>(null)

  if (authLoading) return null
  if (!canSeeFinancials(profile?.role)) return <Navigate to="/" replace />

  const items = data ?? []

  const createTask = async (item: ChurnRiskItem) => {
    setCreating(item.client_id)
    try {
      const ownerId =
        resolveTeamId(team, item.responsavelEntrega) ?? resolveTeamId(team, item.responsavel) ?? profile?.id ?? ''
      if (!ownerId) {
        toast.error('Não achei um responsável pra atribuir a tarefa.')
        return
      }
      const due = new Date()
      due.setDate(due.getDate() + 1)
      await ticketsService.upsertReminder({
        userId: ownerId,
        clientId: item.client_id,
        title: `Risco de churn — ligar/agendar reunião — ${item.company || item.name}`,
        notes: signalSummary(item),
        dueAt: due.toISOString(),
        kind: 'pending',
        status: 'todo',
        priority: 'high',
      })
      toast.success('Tarefa criada')
    } finally {
      setCreating(null)
    }
  }

  return (
    <>
      <TopBar
        title="Risco de Churn"
        subtitle={
          isLoading
            ? 'Carregando…'
            : `${items.length} cliente(s) com sinal de risco aceso`
        }
        rightSlot={
          <Button
            variant="secondary"
            onClick={() => void refetch()}
            loading={isFetching && !isLoading}
            leftIcon={<RefreshCw className="h-4 w-4" />}
          >
            Atualizar
          </Button>
        }
      />

      <div className="px-4 py-4 sm:px-6 sm:py-6 lg:px-8">
        <p className="mb-4 text-xs text-foreground/45">
          Cruza 4 sinais por cliente ativo: pulso de satisfação sem resposta ou "não", pagamento em
          atraso (Asaas), todos os canais desconectados (NX Monitor) e tickets reabertos ou com SLA
          estourado. Só aparece aqui quem tem pelo menos um sinal aceso.
        </p>

        {isLoading && (
          <div className="space-y-2">
            {[...Array(4)].map((_, i) => (
              <Skeleton key={i} className="h-24 w-full rounded-xl" />
            ))}
          </div>
        )}

        {isError && !isLoading && (
          <div className="rounded-2xl border border-danger/30 bg-danger/5 px-4 py-8 text-center text-sm text-danger">
            Não consegui carregar o painel. Tente atualizar de novo.
          </div>
        )}

        {!isLoading && !isError && items.length === 0 && (
          <EmptyState
            icon={<HeartCrack className="h-8 w-8" />}
            title="Nenhum sinal de risco no momento"
            description="Nenhum cliente ativo bateu algum dos 4 sinais de risco de churn. 🎉"
          />
        )}

        {!isLoading && !isError && items.length > 0 && (
          <ul className="space-y-2.5">
            {items.map((item) => (
              <li
                key={item.client_id}
                className="rounded-xl border border-warning/30 bg-warning/[0.03] px-4 py-3.5"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <Building2 className="h-3.5 w-3.5 shrink-0 text-foreground/40" />
                      <span className="truncate text-sm font-semibold text-foreground">
                        {item.company || item.name}
                      </span>
                      <span
                        className="rounded-full px-2 py-0.5 text-[10px] font-medium"
                        style={{
                          background: STAGE_COLORS[item.stage]?.bg,
                          color: STAGE_COLORS[item.stage]?.text,
                        }}
                      >
                        {STAGE_COLORS[item.stage]?.label ?? item.stage}
                      </span>
                      <button
                        type="button"
                        onClick={() => navigate(`/clients?open=${item.client_id}`)}
                        title="Abrir cliente"
                        className="grid h-6 w-6 place-items-center rounded text-accent transition-colors hover:bg-accent/10"
                      >
                        <ExternalLink className="h-3.5 w-3.5" />
                      </button>
                    </div>

                    <div className="mt-2 flex flex-wrap items-center gap-1.5">
                      {item.signals.pulse && (
                        <Badge tone="warning">
                          <MessageCircleWarning className="h-3 w-3" />
                          {item.details.pulseStatus === 'sem_resposta' ? 'Pulso sem resposta' : 'Pulso: "não"'}
                        </Badge>
                      )}
                      {item.signals.payment && (
                        <Badge tone="danger">
                          <CreditCard className="h-3 w-3" />
                          Pagamento em atraso
                          {item.details.paymentSource === 'recorrai' && ' · Recorrai'}
                          {item.details.paymentSource === 'asaas' && ' · Asaas'}
                        </Badge>
                      )}
                      {item.signals.channels && (
                        <Badge tone="danger">
                          <Wifi className="h-3 w-3" />
                          {item.details.channelsTotal} canal(is) desconectado(s)
                        </Badge>
                      )}
                      {item.signals.tickets && (
                        <Badge tone="warning">
                          <TicketIcon className="h-3 w-3" />
                          {item.details.ticketsReopened > 0 && `${item.details.ticketsReopened} reaberto(s)`}
                          {item.details.ticketsReopened > 0 && item.details.ticketsOverdue > 0 && ' · '}
                          {item.details.ticketsOverdue > 0 && `${item.details.ticketsOverdue} SLA estourado`}
                        </Badge>
                      )}
                    </div>
                  </div>

                  <Button
                    size="sm"
                    variant="secondary"
                    loading={creating === item.client_id}
                    onClick={() => void createTask(item)}
                    leftIcon={<Plus className="h-3.5 w-3.5" />}
                  >
                    Criar tarefa
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
  )
}
