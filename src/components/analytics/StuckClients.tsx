import * as React from 'react'
import { useNavigate } from 'react-router-dom'
import { AlertTriangle, ArrowRight } from 'lucide-react'
import { useClients } from '@/hooks/useClients'
import { STAGE_COLORS, STAGE_SLA_DAYS } from '@/constants/stageColors'
import { daysSince } from '@/lib/time'
import { cn } from '@/lib/utils'
import type { Client, PipelineStage } from '@/types/client'

interface StuckRow {
  client: Client
  stage: PipelineStage
  days: number
  over: number
}

/**
 * "Aging": clientes parados na etapa atual ALÉM do SLA — complementa o
 * StageDurations (média histórica) mostrando quem precisa de ação agora.
 */
export function StuckClients() {
  const clients = useClients()
  const navigate = useNavigate()

  const stuck = React.useMemo<StuckRow[]>(() => {
    const out: StuckRow[] = []
    for (const c of clients) {
      const sla = STAGE_SLA_DAYS[c.stage]
      if (sla == null) continue // lead/active/churned não têm SLA
      const days = daysSince(c.stageUpdatedAt ?? c.createdAt)
      if (days > sla) out.push({ client: c, stage: c.stage, days, over: days - sla })
    }
    return out.sort((a, b) => b.over - a.over)
  }, [clients])

  return (
    <section className="rounded-xl border border-line bg-card p-5">
      <header className="mb-3 flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold text-foreground">Clientes parados (aging)</h2>
          <p className="text-xs text-foreground/55">
            Acima do SLA da etapa — precisam de ação
          </p>
        </div>
        <span
          className={cn(
            'rounded-full px-2 py-0.5 text-xs font-semibold ring-1',
            stuck.length > 0
              ? 'bg-danger/10 text-danger ring-danger/20'
              : 'bg-success/10 text-success ring-success/20',
          )}
        >
          {stuck.length}
        </span>
      </header>

      {stuck.length === 0 ? (
        <div className="rounded-lg border border-success/20 bg-success/[0.04] px-3 py-4 text-center text-xs text-success">
          Ninguém parado além do SLA 🎉
        </div>
      ) : (
        <ul className="space-y-2">
          {stuck.slice(0, 8).map(({ client, stage, days, over }) => {
            const style = STAGE_COLORS[stage]
            return (
              <li
                key={client.id}
                className="flex items-center gap-3 rounded-lg border border-danger/15 bg-danger/[0.03] px-3 py-2"
              >
                <AlertTriangle className="h-4 w-4 shrink-0 text-danger" />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm text-foreground">
                    {client.company || client.name}
                  </div>
                  <div className="mt-0.5 flex items-center gap-1.5 text-[10px] text-foreground/45">
                    <span
                      className="rounded px-1.5 py-0.5 font-medium"
                      style={{ background: style.bg, color: style.text }}
                    >
                      {style.label}
                    </span>
                    {client.responsavel ? <span>· {client.responsavel}</span> : null}
                  </div>
                </div>
                <div className="shrink-0 text-right">
                  <div className="text-xs font-semibold text-danger">
                    {days}d <span className="font-normal text-danger/70">(+{over})</span>
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
          {stuck.length > 8 && (
            <li>
              <button
                onClick={() => navigate('/pipeline')}
                className="flex w-full items-center justify-center gap-1 rounded-lg border border-line bg-elevate/[0.02] px-3 py-2 text-xs text-foreground/70 hover:bg-elevate/[0.04]"
              >
                Ver todos no Pipeline
                <ArrowRight className="h-3 w-3" />
              </button>
            </li>
          )}
        </ul>
      )}
    </section>
  )
}
