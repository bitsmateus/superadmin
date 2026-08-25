import { CalendarRange, Plus } from 'lucide-react'
import { cn } from '@/lib/utils'
import { monthLabelPt, type MonthFilter } from '@/hooks/useMonthFilter'

/** Barra de mês/período — pills de mês + "Adicionar mês" (o mês seguinte ao último pill) +
 * "Personalizado" com data de/até livre. Usada no Painel do Mês, na aba Contrato e nas Métricas
 * por SDR. */
export function MonthFilterBar({ filter }: { filter: MonthFilter }) {
  return (
    <div className="mb-4 flex flex-wrap items-center gap-1.5 rounded-xl border border-line bg-card p-2.5">
      <CalendarRange className="h-4 w-4 shrink-0 text-foreground/40" />
      {filter.months.map((m) => (
        <button
          key={m}
          type="button"
          onClick={() => { filter.setSelected(m); filter.setCustomMode(false) }}
          className={cn(
            'rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors',
            !filter.customMode && filter.selected === m ? 'bg-accent/10 text-accent ring-1 ring-accent/20' : 'text-foreground/50 hover:bg-elevate/[0.04]',
          )}
        >
          {monthLabelPt(m)}
        </button>
      ))}
      <button
        type="button"
        onClick={filter.addMonth}
        className="inline-flex items-center gap-1 rounded-md px-2.5 py-1.5 text-xs font-medium text-foreground/50 hover:bg-elevate/[0.04]"
      >
        <Plus className="h-3 w-3" /> Adicionar mês
      </button>
      <button
        type="button"
        onClick={() => filter.setCustomMode(true)}
        className={cn(
          'rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors',
          filter.customMode ? 'bg-accent/10 text-accent ring-1 ring-accent/20' : 'text-foreground/50 hover:bg-elevate/[0.04]',
        )}
      >
        Personalizado
      </button>
      {filter.customMode && (
        <div className="ml-1 flex items-center gap-2">
          <input
            type="date"
            value={filter.customFrom}
            onChange={(e) => filter.setCustomFrom(e.target.value)}
            className="h-8 rounded-lg border border-line px-2 text-xs text-foreground/70 outline-none focus:border-accent"
          />
          <span className="text-xs text-foreground/40">até</span>
          <input
            type="date"
            value={filter.customTo}
            onChange={(e) => filter.setCustomTo(e.target.value)}
            className="h-8 rounded-lg border border-line px-2 text-xs text-foreground/70 outline-none focus:border-accent"
          />
        </div>
      )}
    </div>
  )
}
