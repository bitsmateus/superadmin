import { CalendarRange, Plus, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { monthLabelPt, type MonthFilter } from '@/hooks/useMonthFilter'

/** Barra de mês/período — pills de mês (com "x" pra tirar da barra, sem apagar nada do mês) +
 * "Adicionar mês" (o mês seguinte ao último pill) + "Personalizado" com data de/até livre. Usada
 * no Painel do Mês, na aba Contrato, nas Métricas por SDR e em Contas a Pagar. */
export function MonthFilterBar({ filter }: { filter: MonthFilter }) {
  return (
    <div className="mb-4 flex flex-wrap items-center gap-1.5 rounded-xl border border-line bg-card p-2.5">
      <CalendarRange className="h-4 w-4 shrink-0 text-foreground/40" />
      {filter.months.map((m) => (
        <span
          key={m}
          className={cn(
            'group inline-flex items-center rounded-md text-xs font-medium transition-colors',
            !filter.customMode && filter.selected === m ? 'bg-accent/10 text-accent ring-1 ring-accent/20' : 'text-foreground/50 hover:bg-elevate/[0.04]',
          )}
        >
          <button
            type="button"
            onClick={() => { filter.setSelected(m); filter.setCustomMode(false) }}
            className={cn('py-1.5 pl-2.5', filter.months.length > 1 ? 'pr-1' : 'pr-2.5')}
          >
            {monthLabelPt(m)}
          </button>
          {filter.months.length > 1 && (
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); filter.removeMonth(m) }}
              title={`Tirar ${monthLabelPt(m)} da barra`}
              className="grid h-5 w-5 shrink-0 place-items-center rounded-full opacity-100 hover:bg-danger/15 hover:text-danger lg:opacity-0 lg:group-hover:opacity-100"
            >
              <X className="h-3 w-3" />
            </button>
          )}
        </span>
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
