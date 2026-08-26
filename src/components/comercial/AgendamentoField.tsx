import * as React from 'react'
import { createPortal } from 'react-dom'
import { Calendar, ChevronLeft, ChevronRight, Clock } from 'lucide-react'
import { useOutsideClose } from '@/hooks/useOutsideClose'
import { cn } from '@/lib/utils'

const WEEKDAYS = ['D', 'S', 'T', 'Q', 'Q', 'S', 'S']
const MONTHS = [
  'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
  'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro',
]

function pad(n: number): string {
  return String(n).padStart(2, '0')
}

function sameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
}

function parseValue(value: string): { date: Date | null; time: string } {
  const [datePart, timePart] = (value || '').split('T')
  if (!datePart) return { date: null, time: '' }
  const [y, m, d] = datePart.split('-').map(Number)
  if (!y || !m || !d) return { date: null, time: '' }
  return { date: new Date(y, m - 1, d), time: timePart ? timePart.slice(0, 5) : '' }
}

function toValue(date: Date, time: string): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${time || '00:00'}`
}

function formatDisplay(value: string): string {
  const { date, time } = parseValue(value)
  if (!date) return ''
  const d = `${pad(date.getDate())}/${pad(date.getMonth() + 1)}/${date.getFullYear()}`
  return time ? `${d}  ${time}` : d
}

export interface AgendamentoFieldProps {
  value: string
  onChange: (next: string) => void
  className?: string
  placeholder?: string
}

/** Data + hora num calendário flutuante — mesmo componente visual do Retornar (RetornarField),
 * mas sem status de retornado/atrasado: Agendamento não tem essa noção de "feito". */
export function AgendamentoField({ value, onChange, className, placeholder = 'Selecionar…' }: AgendamentoFieldProps) {
  const [open, setOpen] = React.useState(false)
  const [coords, setCoords] = React.useState<{ top?: number; bottom?: number; left: number } | null>(null)
  const parsed = React.useMemo(() => parseValue(value), [value])
  const [viewYear, setViewYear] = React.useState(() => (parsed.date ?? new Date()).getFullYear())
  const [viewMonth, setViewMonth] = React.useState(() => (parsed.date ?? new Date()).getMonth())
  const btnRef = React.useRef<HTMLButtonElement>(null)
  const popRef = React.useRef<HTMLDivElement>(null)
  const timeInputRef = React.useRef<HTMLInputElement>(null)
  useOutsideClose(popRef, open, () => setOpen(false))

  const openPicker = () => {
    const rect = btnRef.current?.getBoundingClientRect()
    if (rect) {
      const left = Math.min(rect.left, window.innerWidth - 300)
      // Calendário + hora + rodapé passa fácil de 400px — se não couber embaixo mas couber em
      // cima, abre pra cima (ancorado por "bottom", sem precisar adivinhar a altura certa).
      const spaceBelow = window.innerHeight - rect.bottom
      if (spaceBelow < 420 && rect.top > spaceBelow) {
        setCoords({ bottom: window.innerHeight - rect.top + 4, left })
      } else {
        setCoords({ top: rect.bottom + 4, left })
      }
    }
    const base = parsed.date ?? new Date()
    setViewYear(base.getFullYear())
    setViewMonth(base.getMonth())
    setOpen(true)
  }

  const pickDay = (d: Date) => {
    const firstPick = !parsed.date
    onChange(toValue(d, parsed.time || '09:00'))
    if (d.getMonth() !== viewMonth || d.getFullYear() !== viewYear) {
      setViewYear(d.getFullYear())
      setViewMonth(d.getMonth())
    }
    if (firstPick) window.setTimeout(() => timeInputRef.current?.focus(), 0)
  }

  const setTime = (time: string) => {
    onChange(toValue(parsed.date ?? new Date(viewYear, viewMonth, 1), time))
  }

  const clear = () => { onChange(''); setOpen(false) }

  const prevMonth = () => {
    if (viewMonth === 0) { setViewMonth(11); setViewYear((y) => y - 1) } else setViewMonth((m) => m - 1)
  }
  const nextMonth = () => {
    if (viewMonth === 11) { setViewMonth(0); setViewYear((y) => y + 1) } else setViewMonth((m) => m + 1)
  }

  const firstOfMonth = new Date(viewYear, viewMonth, 1)
  const start = new Date(firstOfMonth)
  start.setDate(start.getDate() - firstOfMonth.getDay())
  const cells = Array.from({ length: 42 }, (_, i) => {
    const d = new Date(start)
    d.setDate(start.getDate() + i)
    return d
  })
  const today = new Date()

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        onClick={openPicker}
        className={cn('flex h-full w-full items-center gap-1.5 truncate text-left', className)}
      >
        <Calendar className={cn('h-3.5 w-3.5 shrink-0', value ? 'text-accent' : 'text-foreground/40')} />
        {value ? (
          <span className="truncate font-medium text-foreground">{formatDisplay(value)}</span>
        ) : (
          <span className="truncate text-foreground/30">{placeholder}</span>
        )}
      </button>

      {open && coords && createPortal(
        <div
          ref={popRef}
          style={{
            position: 'fixed',
            left: coords.left,
            ...(coords.top !== undefined ? { top: coords.top } : { bottom: coords.bottom }),
          }}
          className="z-50 w-72 rounded-2xl border border-line bg-card p-3 shadow-2xl"
        >
          <div className="mb-1 flex items-center justify-between">
            <button
              type="button"
              onClick={prevMonth}
              className="grid h-7 w-7 place-items-center rounded-full text-foreground/40 transition-colors hover:bg-elevate/[0.08] hover:text-foreground/70"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <span className="text-sm font-semibold text-foreground">{MONTHS[viewMonth]} {viewYear}</span>
            <button
              type="button"
              onClick={nextMonth}
              className="grid h-7 w-7 place-items-center rounded-full text-foreground/40 transition-colors hover:bg-elevate/[0.08] hover:text-foreground/70"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>

          <div className="grid grid-cols-7 text-center text-[11px] font-medium text-foreground/40">
            {WEEKDAYS.map((w, i) => <div key={i} className="py-1">{w}</div>)}
          </div>

          <div className="grid grid-cols-7 gap-y-0.5">
            {cells.map((d, i) => {
              const current = d.getMonth() === viewMonth
              const selected = parsed.date ? sameDay(d, parsed.date) : false
              const isToday = sameDay(d, today)
              return (
                <button
                  key={i}
                  type="button"
                  onClick={() => pickDay(d)}
                  className={cn(
                    'mx-auto grid h-8 w-8 place-items-center rounded-full text-xs transition-colors',
                    !current && 'text-foreground/30 hover:bg-elevate/[0.04]',
                    current && !selected && 'text-foreground/70 hover:bg-accent/10',
                    selected && 'bg-accent font-semibold text-white',
                    isToday && !selected && 'ring-1 ring-inset ring-accent/50',
                  )}
                >
                  {d.getDate()}
                </button>
              )
            })}
          </div>

          {parsed.date && (
            <div className="mt-2.5 border-t border-line/60 pt-2.5">
              <label className="flex h-8 w-full items-center gap-2 rounded-md border border-line bg-card px-2 text-sm text-foreground transition-colors focus-within:border-accent/60">
                <Clock className="h-4 w-4 shrink-0 text-accent" />
                <input
                  ref={timeInputRef}
                  type="time"
                  value={parsed.time || '09:00'}
                  onChange={(e) => setTime(e.target.value)}
                  className="h-full flex-1 bg-transparent font-medium text-foreground outline-none"
                />
              </label>
            </div>
          )}

          <div className="mt-2.5 flex items-center justify-between border-t border-line/60 pt-2.5">
            <button
              type="button"
              onClick={clear}
              className="text-xs font-medium text-foreground/40 hover:text-danger"
            >
              Limpar
            </button>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-white hover:bg-accent/90"
            >
              Concluído
            </button>
          </div>
        </div>,
        document.body,
      )}
    </>
  )
}
