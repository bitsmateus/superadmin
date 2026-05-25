import * as React from 'react'
import { Award, DollarSign, Star, Users } from 'lucide-react'
import { useClients, useSettings } from '@/hooks/useClients'
import { useStageHistory } from '@/hooks/useAnalytics'
import { useNpsResponses } from '@/hooks/useTickets'
import { computeMonthlyActuals, formatCurrencyBRL } from '@/lib/analytics'
import { cn } from '@/lib/utils'

/**
 * Card de metas do mês — mostra progresso (atual / meta) com barras.
 * Só renderiza se goalsEnabled. Pode ser dispensado se não houver metas.
 */
export function GoalsCard({
  hideIfDisabled = false,
}: {
  hideIfDisabled?: boolean
}) {
  const settings = useSettings()
  const clients = useClients()
  const history = useStageHistory()
  const nps = useNpsResponses()

  const actuals = React.useMemo(
    () => computeMonthlyActuals(clients, history, nps),
    [clients, history, nps],
  )

  if (hideIfDisabled && !settings.goalsEnabled) return null

  const monthName = new Date().toLocaleDateString('pt-BR', {
    month: 'long',
    year: 'numeric',
  })

  const hasAnyGoal =
    !!settings.goalNewClientsMonthly ||
    !!settings.goalMrrMonthly ||
    !!settings.goalNpsMonthly

  return (
    <section className="rounded-xl border border-line bg-card p-5">
      <header className="mb-4 flex items-baseline justify-between">
        <div>
          <h2 className="text-sm font-semibold text-foreground">Metas do mês</h2>
          <p className="text-xs text-foreground/55 capitalize">{monthName}</p>
        </div>
      </header>

      {!hasAnyGoal ? (
        <p className="text-xs text-foreground/45">
          Nenhuma meta definida ainda. Vá em Configurações → Metas pra
          configurar.
        </p>
      ) : (
        <div className="space-y-4">
          {settings.goalNewClientsMonthly !== undefined && (
            <GoalBar
              icon={<Users className="h-3.5 w-3.5" />}
              label="Novos clientes"
              current={actuals.newClients}
              target={settings.goalNewClientsMonthly}
              format={(n) => n.toString()}
              tone="info"
            />
          )}
          {settings.goalMrrMonthly !== undefined && (
            <GoalBar
              icon={<DollarSign className="h-3.5 w-3.5" />}
              label="MRR"
              current={actuals.mrr}
              target={settings.goalMrrMonthly}
              format={formatCurrencyBRL}
              tone="success"
            />
          )}
          {settings.goalNpsMonthly !== undefined && (
            actuals.npsResponses === 0 ? (
              <div>
                <div className="flex items-center justify-between gap-2 text-xs">
                  <span className="inline-flex items-center gap-1.5 text-foreground/70">
                    <Star className="h-3.5 w-3.5" />
                    NPS
                  </span>
                  <span className="text-foreground/40">
                    — / {settings.goalNpsMonthly}
                  </span>
                </div>
                <div className="mt-1.5 h-2 w-full overflow-hidden rounded-md bg-elevate/[0.04]" />
                <div className="mt-1 text-[10px] text-foreground/45">
                  Sem respostas no mês — meta começa a contar a partir da
                  primeira resposta
                </div>
              </div>
            ) : (
              <GoalBar
                icon={<Star className="h-3.5 w-3.5" />}
                label="NPS"
                current={actuals.npsScore ?? 0}
                target={settings.goalNpsMonthly}
                format={(n) => n.toString()}
                tone="warning"
                extra={`${actuals.npsResponses} resposta(s)`}
              />
            )
          )}
        </div>
      )}
    </section>
  )
}

function GoalBar({
  icon,
  label,
  current,
  target,
  format,
  tone,
  extra,
}: {
  icon: React.ReactNode
  label: string
  current: number
  target: number
  format: (n: number) => string
  tone: 'info' | 'success' | 'warning'
  extra?: string
}) {
  const pct = target === 0 ? 0 : Math.max(0, (current / target) * 100)
  const reached = current >= target
  const toneClass = {
    info: 'bg-accent',
    success: 'bg-success',
    warning: 'bg-warning',
  }[tone]
  return (
    <div>
      <div className="flex items-center justify-between gap-2 text-xs">
        <span className="inline-flex items-center gap-1.5 text-foreground/70">
          {icon}
          {label}
        </span>
        <span className="text-foreground/90">
          <strong className={cn(reached && 'text-success')}>
            {format(current)}
          </strong>
          <span className="text-foreground/40"> / {format(target)}</span>
        </span>
      </div>
      <div className="mt-1.5 h-2 w-full overflow-hidden rounded-md bg-elevate/[0.04]">
        <div
          className={cn('h-full transition-all', toneClass)}
          style={{ width: `${Math.min(pct, 100)}%` }}
        />
      </div>
      <div className="mt-1 flex items-center justify-between text-[10px] text-foreground/45">
        <span>
          {reached ? (
            <span className="inline-flex items-center gap-1 text-success">
              <Award className="h-3 w-3" />
              Meta batida!
            </span>
          ) : (
            `${pct.toFixed(0)}% da meta`
          )}
        </span>
        {extra && <span>{extra}</span>}
      </div>
    </div>
  )
}
