import * as React from 'react'
import { TrendingDown, TrendingUp } from 'lucide-react'
import { useStageHistory } from '@/hooks/useAnalytics'
import { computeFunnel } from '@/lib/analytics'
import { STAGE_COLORS } from '@/constants/stageColors'
import { cn } from '@/lib/utils'

/**
 * Funil de conversão: cada barra é um stage, % indica quantos avançaram pro
 * próximo. Sem lib de chart — desenho com div + Tailwind pra manter bundle
 * enxuto.
 */
export function ConversionFunnel({ windowDays }: { windowDays?: number }) {
  const history = useStageHistory()
  const data = React.useMemo(
    () => computeFunnel(history, windowDays),
    [history, windowDays],
  )

  const max = Math.max(...data.map((d) => d.count), 1)

  return (
    <section className="rounded-xl border border-line bg-card p-5">
      <header className="mb-4 flex items-baseline justify-between">
        <div>
          <h2 className="text-sm font-semibold text-white">
            Funil de conversão
          </h2>
          <p className="text-xs text-white/55">
            % avançando entre stages.{' '}
            {windowDays
              ? `Últimos ${windowDays} dias.`
              : 'Histórico completo.'}
          </p>
        </div>
      </header>

      <ul className="space-y-2">
        {data.map((d) => {
          const style = STAGE_COLORS[d.stage]
          const width = Math.max((d.count / max) * 100, 5)
          return (
            <li key={d.stage} className="space-y-1">
              <div className="flex items-center justify-between text-xs">
                <span className="font-medium" style={{ color: style.text }}>
                  {style.label}
                </span>
                <span className="text-white/70">{d.count} cliente(s)</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="h-6 flex-1 rounded-md bg-white/[0.03] overflow-hidden">
                  <div
                    className="h-full rounded-md transition-all"
                    style={{
                      width: `${width}%`,
                      backgroundColor: style.bg,
                      borderRight: `2px solid ${style.text}`,
                    }}
                  />
                </div>
                {d.conversionToNext !== null && (
                  <div
                    className={cn(
                      'inline-flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-[10px] font-semibold w-20 justify-center',
                      d.conversionToNext >= 70
                        ? 'bg-success/10 text-success'
                        : d.conversionToNext >= 40
                          ? 'bg-warning/10 text-warning'
                          : 'bg-danger/10 text-danger',
                    )}
                  >
                    {d.conversionToNext >= 50 ? (
                      <TrendingUp className="h-3 w-3" />
                    ) : (
                      <TrendingDown className="h-3 w-3" />
                    )}
                    {d.conversionToNext.toFixed(0)}%
                  </div>
                )}
              </div>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
