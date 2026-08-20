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

const TIME_OPTIONS = Array.from({ length: 48 }, (_, i) => `${pad(Math.floor(i / 2))}:${i % 2 === 0 ? '00' : '30'}`)

export interface RetornarFieldProps {
  value: string
  onSave: (next: string) => void
  className?: string
  placeholder?: string
}

/** Data + hora num calendário flutuante moderno — o campo de horário só aparece depois que a data é escolhida. */
export function RetornarField({ value, onSave, className, placeholder = 'Selecionar…' }: RetornarFieldProps) {
  const [open, setOpen] = React.useState(false)
  const [timeOpen, setTimeOpen] = React.useState(false)
  const [coords, setCoords] = React.useState<{ top: number; left: number } | null>(null)
  const parsed = React.useMemo(() => parseValue(value), [value])
  const [viewYear, setViewYear] = React.useState(() => (parsed.date ?? new Date()).getFullYear())
  const [viewMonth, setViewMonth] = React.useState(() => (parsed.date ?? new Date()).getMonth())
  const btnRef = React.useRef<HTMLButtonElement>(null)
  const popRef = React.useRef<HTMLDivElement>(null)
  const activeTimeRef = React.useRef<HTMLButtonElement>(null)
  useOutsideClose(popRef, open, () => setOpen(false))

  React.useEffect(() => { if (!open) setTimeOpen(false) }, [open])
  React.useEffect(() => {
    if (timeOpen) activeTimeRef.current?.scrollIntoView({ block: 'center' })
  }, [timeOpen])

  const openPicker = () => {
    const rect = btnRef.current?.getBoundingClientRect()
    if (rect) setCoords({ top: rect.bottom + 4, left: Math.min(rect.left, window.innerWidth - 300) })
    const base = parsed.date ?? new Date()
    setViewYear(base.getFullYear())
    setViewMonth(base.getMonth())
    setOpen(true)
  }

  const pickDay = (d: Date) => {
    onSave(toValue(d, parsed.time || '09:00'))
    if (d.getMonth() !== viewMonth || d.getFullYear() !== viewYear) {
      setViewYear(d.getFullYear())
      setViewMonth(d.getMonth())
    }
    if (!parsed.date) setTimeOpen(true)
  }

  const setTime = (time: string) => {
    onSave(toValue(parsed.date ?? new Date(viewYear, viewMonth, 1), time))
    setTimeOpen(false)
  }

  const clear = () => { onSave(''); setOpen(false) }

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
        <Calendar className="h-3.5 w-3.5 shrink-0 text-gray-400" />
        {value ? (
          <span className="truncate">{formatDisplay(value)}</span>
        ) : (
          <span className="truncate text-gray-300">{placeholder}</span>
        )}
      </button>

      {open && coords && createPortal(
        <div
          ref={popRef}
          style={{ position: 'fixed', top: coords.top, left: coords.left }}
          className="z-50 w-72 rounded-2xl border border-gray-200 bg-white p-3 shadow-2xl"
        >
          <div className="mb-1 flex items-center justify-between">
            <button
              type="button"
              onClick={prevMonth}
              className="grid h-7 w-7 place-items-center rounded-full text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-700"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <span className="text-sm font-semibold text-[#323338]">{MONTHS[viewMonth]} {viewYear}</span>
            <button
              type="button"
              onClick={nextMonth}
              className="grid h-7 w-7 place-items-center rounded-full text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-700"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>

          <div className="grid grid-cols-7 text-center text-[11px] font-medium text-gray-400">
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
                    !current && 'text-gray-300 hover:bg-gray-50',
                    current && !selected && 'text-gray-700 hover:bg-accent/10',
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
            <div className="relative mt-2.5 border-t border-gray-100 pt-2.5">
              <button
                type="button"
                onClick={() => setTimeOpen((o) => !o)}
                className="flex h-8 w-full items-center gap-2 rounded-md border border-gray-200 bg-white px-2 text-sm text-gray-800 transition-colors hover:border-accent/60"
              >
                <Clock className="h-4 w-4 shrink-0 text-accent" />
                <span className="flex-1 text-left font-medium">{parsed.time || '09:00'}</span>
              </button>
              {timeOpen && (
                <div className="absolute inset-x-0 top-full z-10 mt-1 max-h-40 overflow-y-auto rounded-md border border-gray-200 bg-white p-1 shadow-lg">
                  {TIME_OPTIONS.map((t) => {
                    const active = t === (parsed.time || '09:00')
                    return (
                      <button
                        key={t}
                        ref={active ? activeTimeRef : undefined}
                        type="button"
                        onClick={() => setTime(t)}
                        className={cn(
                          'block w-full rounded px-2 py-1 text-left text-xs',
                          active ? 'bg-accent font-semibold text-white' : 'text-gray-600 hover:bg-accent/10',
                        )}
                      >
                        {t}
                      </button>
                    )
                  })}
                </div>
              )}
            </div>
          )}

          <div className="mt-2.5 flex items-center justify-between border-t border-gray-100 pt-2.5">
            <button
              type="button"
              onClick={clear}
              className="text-xs font-medium text-gray-400 hover:text-danger"
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
