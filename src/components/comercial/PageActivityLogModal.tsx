import * as React from 'react'
import { Loader2, ScrollText } from 'lucide-react'
import { toast } from 'sonner'
import { Modal } from '@/components/ui/Modal'
import { Select } from '@/components/ui/Select'
import { describeEvent, type EventColorMaps } from '@/components/comercial/LeadDetailModal'
import { useLeadBoards } from '@/hooks/useLeadBoards'
import { useLeadLabels } from '@/hooks/useLeadLabels'
import { leadEventsService, type PageLeadEvent } from '@/services/leadEvents'
import { cn, formatDateTimeShort } from '@/lib/utils'
import { timeAgo } from '@/lib/time'

export interface PageActivityLogModalProps {
  open: boolean
  onClose: () => void
  page: string
  onOpenLead: (id: string) => void
}

type DiaFiltro = 'hoje' | 'ontem' | 'personalizado'

/** Início do dia local (00:00) como Date, deslocado por `offsetDias` (0 = hoje, -1 = ontem). */
function startOfLocalDay(offsetDias: number, base = new Date()): Date {
  const d = new Date(base.getFullYear(), base.getMonth(), base.getDate() + offsetDias)
  return d
}
function isoDay(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
/** [from, to) do dia local escolhido — `dia` é "YYYY-MM-DD" (do input date, ou já calculado). */
function dayRange(dia: string): { from: string; to: string } {
  const [y, m, d] = dia.split('-').map(Number)
  const from = new Date(y, m - 1, d)
  const to = new Date(y, m - 1, d + 1)
  return { from: from.toISOString(), to: to.toISOString() }
}

/** Botão "Log" ao lado de Filtro — tudo que aconteceu na aba (todos os SDRs/leads), mais recente
 * primeiro: status, dia de contato, SDR, quadro, criação. Busca sob demanda a cada abertura/troca
 * de dia, sem cache (é uma conferência pontual, não precisa ficar em tempo real). */
export function PageActivityLogModal({ open, onClose, page, onOpenLead }: PageActivityLogModalProps) {
  const [loading, setLoading] = React.useState(false)
  const [events, setEvents] = React.useState<PageLeadEvent[]>([])
  const [sdrFilter, setSdrFilter] = React.useState('')
  const [diaFiltro, setDiaFiltro] = React.useState<DiaFiltro>('hoje')
  const [customDia, setCustomDia] = React.useState(() => isoDay(new Date()))

  React.useEffect(() => {
    if (!open) return
    setDiaFiltro('hoje')
    setCustomDia(isoDay(new Date()))
    setSdrFilter('')
  }, [open])

  const dia = diaFiltro === 'hoje' ? isoDay(startOfLocalDay(0))
    : diaFiltro === 'ontem' ? isoDay(startOfLocalDay(-1))
    : customDia

  const statusLabels = useLeadLabels('status', page)
  const diaContatoLabels = useLeadLabels('diaContato', page)
  const sdrLabels = useLeadLabels('sdr')
  const allBoards = useLeadBoards()

  const eventColors = React.useMemo<EventColorMaps>(() => ({
    status: Object.fromEntries(statusLabels.map((l) => [l.name, l.color])),
    diaContato: Object.fromEntries(diaContatoLabels.map((l) => [l.name, l.color])),
    sdr: Object.fromEntries(sdrLabels.map((l) => [l.name, l.color])),
    board: Object.fromEntries(allBoards.map((b) => [b.name, b.color])),
  }), [statusLabels, diaContatoLabels, sdrLabels, allBoards])

  React.useEffect(() => {
    if (!open) return
    setLoading(true)
    leadEventsService.getPageEvents(page, dayRange(dia))
      .then(setEvents)
      .catch((err) => toast.error('Falha ao carregar o log: ' + (err as Error).message))
      .finally(() => setLoading(false))
  }, [open, page, dia])

  const sdrOptions = React.useMemo(() => {
    const names = new Set(events.map((e) => e.leadSdr).filter(Boolean))
    return Array.from(names).sort()
  }, [events])

  const filtered = React.useMemo(
    () => (sdrFilter ? events.filter((e) => e.leadSdr === sdrFilter) : events),
    [events, sdrFilter],
  )

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Log da aba"
      description="Tudo que aconteceu por aqui — status, dia de contato, SDR e quadro, mais recente primeiro."
      size="lg"
    >
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="inline-flex overflow-hidden rounded-lg border border-line">
          {(['hoje', 'ontem', 'personalizado'] as const).map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => setDiaFiltro(v)}
              className={cn(
                'px-3 py-1.5 text-sm font-medium capitalize transition-colors',
                diaFiltro === v ? 'bg-accent/10 text-accent' : 'text-foreground/50 hover:bg-elevate/[0.04]',
              )}
            >
              {v}
            </button>
          ))}
        </div>
        {diaFiltro === 'personalizado' && (
          <input
            type="date"
            value={customDia}
            onChange={(e) => setCustomDia(e.target.value)}
            className="h-8 rounded-lg border border-line px-2 text-xs text-foreground/70 outline-none focus:border-accent"
          />
        )}
      </div>

      <div className="mb-3">
        <Select
          value={sdrFilter}
          onChange={(e) => setSdrFilter(e.target.value)}
          options={[
            { value: '', label: 'Todos os SDRs' },
            ...sdrOptions.map((s) => ({ value: s, label: s })),
          ]}
        />
      </div>

      {loading ? (
        <div className="grid place-items-center py-10 text-sm text-foreground/50">
          <Loader2 className="h-5 w-5 animate-spin" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="grid place-items-center gap-2 py-10 text-center">
          <ScrollText className="h-6 w-6 text-foreground/25" />
          <p className="text-sm text-foreground/40">Nada por aqui ainda.</p>
        </div>
      ) : (
        <ul className="max-h-[60vh] divide-y divide-line/60 overflow-y-auto">
          {filtered.map((e) => {
            const d = describeEvent(e, eventColors)
            return (
              <li key={e.id} className="flex items-start gap-3 py-2.5">
                <span className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-full bg-elevate/[0.06] text-foreground/50">
                  {d.icon}
                </span>
                <div className="min-w-0 flex-1">
                  <button
                    type="button"
                    onClick={() => onOpenLead(e.leadRowId)}
                    className="truncate text-left text-sm font-medium text-foreground hover:text-accent hover:underline"
                    title="Abrir lead"
                  >
                    {e.leadNome}
                  </button>
                  <p className="mt-0.5 text-xs text-foreground/50">
                    {d.text && <span>{d.text}: </span>}
                    {d.from && <span className="font-medium" style={{ color: d.from.color }}>{d.from.label}</span>}
                    {d.from && d.to && <span className="mx-1">→</span>}
                    {d.to && <span className="font-medium" style={{ color: d.to.color }}>{d.to.label}</span>}
                  </p>
                  <p className="mt-0.5 text-[11px] text-foreground/35">
                    {e.actorName || 'Alguém'}{e.leadSdr && <> · SDR {e.leadSdr}</>} · <span title={formatDateTimeShort(e.createdAt)}>{timeAgo(e.createdAt)}</span>
                  </p>
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </Modal>
  )
}
