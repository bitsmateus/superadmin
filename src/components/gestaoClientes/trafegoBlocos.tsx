import { cn } from '@/lib/utils'
import { brl, diaCurto, Vazio } from '@/components/trafego/format'

/**
 * Blocos da aba Tráfego que o Meta Ads e o Google Ads usam igual: quando foi, variação contra o
 * período anterior, o cartão de número (KPI) e o gráfico de gasto por dia.
 */

export function quandoFoi(iso: string | null): string {
  if (!iso) return 'nunca'
  const min = Math.round((Date.now() - new Date(iso).getTime()) / 60_000)
  if (min < 2) return 'agora'
  if (min < 60) return `há ${min} min`
  const h = Math.round(min / 60)
  if (h < 24) return `há ${h} h`
  return `há ${Math.round(h / 24)} dias`
}

/** Variação % entre dois números; `menorMelhor` inverte a cor (custo caindo é bom). */
export function Variacao({ atual, anterior, menorMelhor }: { atual: number | null; anterior: number | null; menorMelhor?: boolean }) {
  if (atual == null || anterior == null || anterior === 0) return null
  const v = (atual - anterior) / anterior
  if (Math.abs(v) < 0.005) return <span className="text-[11px] text-foreground/40">=</span>
  const bom = menorMelhor ? v < 0 : v > 0
  return (
    <span className={cn('text-[11px] font-medium tabular-nums', bom ? 'text-emerald-600 dark:text-emerald-400' : 'text-danger')}>
      {v > 0 ? '▲' : '▼'} {Math.abs(Math.round(v * 100))}%
    </span>
  )
}

export function Kpi({ titulo, valor, detalhe, atual, anterior, menorMelhor }: {
  titulo: string; valor: string; detalhe?: string; atual: number | null; anterior: number | null; menorMelhor?: boolean
}) {
  return (
    <div className="rounded-xl border border-line bg-card px-4 py-3">
      <p className="text-[11px] font-medium uppercase tracking-wide text-foreground/50">{titulo}</p>
      <div className="mt-1 flex items-baseline gap-2">
        <span className="text-xl font-semibold tabular-nums text-foreground">{valor}</span>
        <Variacao atual={atual} anterior={anterior} menorMelhor={menorMelhor} />
      </div>
      {detalhe && <p className="mt-0.5 truncate text-xs text-foreground/50">{detalhe}</p>}
    </div>
  )
}

/** Barras de gasto por dia, com os resultados do dia em cima de cada barra. */
export function GraficoDiario({ serie }: { serie: { dia: string; gasto: number; resultados: number }[] }) {
  const max = Math.max(1, ...serie.map((s) => s.gasto))
  if (serie.every((s) => s.gasto === 0)) return <Vazio>Sem gasto no período.</Vazio>
  return (
    <div className="flex h-40 items-end gap-[3px] overflow-x-auto">
      {serie.map((s) => (
        <div key={s.dia} className="flex min-w-[14px] flex-1 flex-col items-center gap-1" title={`${diaCurto(s.dia)}: ${brl(s.gasto)} · ${s.resultados} resultado(s)`}>
          <span className="text-[10px] tabular-nums text-foreground/50">{s.resultados || ''}</span>
          <div className="w-full rounded-t bg-accent/70 transition-colors hover:bg-accent" style={{ height: `${Math.max(2, (s.gasto / max) * 110)}px` }} />
          <span className="text-[9px] tabular-nums text-foreground/40">{diaCurto(s.dia).slice(0, 2)}</span>
        </div>
      ))}
    </div>
  )
}
