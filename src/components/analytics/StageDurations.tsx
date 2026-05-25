import * as React from 'react'
import { Clock3 } from 'lucide-react'
import { useStageHistory } from '@/hooks/useAnalytics'
import { computeStageDurations } from '@/lib/analytics'
import { STAGE_COLORS } from '@/constants/stageColors'

/**
 * Tempo médio em cada stage. Útil pra identificar gargalo do funil
 * (ex.: clientes parados em briefing por 12 dias em média).
 */
export function StageDurations() {
  const history = useStageHistory()
  const durations = React.useMemo(
    () => computeStageDurations(history),
    [history],
  )

  const max = Math.max(
    ...durations.map((d) => d.avgDays ?? 0),
    1,
  )

  return (
    <section className="rounded-xl border border-line bg-card p-5">
      <header className="mb-4">
        <h2 className="text-sm font-semibold text-foreground">
          Tempo médio em cada etapa
        </h2>
        <p className="text-xs text-foreground/55">
          Quanto leva pra um cliente sair desse stage. Útil pra identificar
          gargalo.
        </p>
      </header>

      <ul className="space-y-2">
        {durations.map((d) => {
          const style = STAGE_COLORS[d.stage]
          if (d.avgDays === null) {
            return (
              <li
                key={d.stage}
                className="flex items-center justify-between text-xs"
              >
                <span style={{ color: style.text }}>{style.label}</span>
                <span className="text-foreground/35">sem dados</span>
              </li>
            )
          }
          const width = Math.max((d.avgDays / max) * 100, 5)
          return (
            <li key={d.stage} className="space-y-1">
              <div className="flex items-center justify-between text-xs">
                <span className="font-medium" style={{ color: style.text }}>
                  {style.label}
                </span>
                <span className="inline-flex items-center gap-1 text-foreground/70">
                  <Clock3 className="h-3 w-3" />
                  {d.avgDays.toFixed(1)} dia(s){' '}
                  <span className="text-foreground/35">· {d.sampleSize}x</span>
                </span>
              </div>
              <div className="h-2 w-full rounded-md bg-elevate/[0.03]">
                <div
                  className="h-full rounded-md"
                  style={{
                    width: `${width}%`,
                    backgroundColor: style.text,
                  }}
                />
              </div>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
