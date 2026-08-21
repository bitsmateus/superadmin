import * as React from 'react'
import { ChevronRight, UserRound } from 'lucide-react'
import { useOutsideClose } from '@/hooks/useOutsideClose'
import { useLeadActivity } from '@/hooks/useLeadActivity'
import { useLeadLabels } from '@/hooks/useLeadLabels'
import { todayKey, classifyLeadToday } from '@/lib/leadDates'
import { cn } from '@/lib/utils'
import type { LeadBoard, LeadRow } from '@/types/leadBoard'

interface SdrToday {
  sdr: string
  color: string
  naoAtualizado: LeadRow[]
  atrasado: LeadRow[]
  reuniaoHoje: LeadRow[]
  propostaHoje: LeadRow[]
}

function CountCell({
  matches,
  boards,
  onOpenLead,
  tone,
}: {
  matches: LeadRow[]
  boards: LeadBoard[]
  onOpenLead: (id: string) => void
  tone: string
}) {
  const [open, setOpen] = React.useState(false)
  const ref = React.useRef<HTMLTableCellElement>(null)
  useOutsideClose(ref, open, () => setOpen(false))

  const boardName = (boardId: string) => boards.find((b) => b.id === boardId)?.name ?? ''

  const handleClick = () => {
    if (matches.length === 0) return
    // 1 resultado só = já abre direto o lead. Mais de um = lista pra escolher qual.
    if (matches.length === 1) { onOpenLead(matches[0].id); return }
    setOpen((o) => !o)
  }

  return (
    <td ref={ref} className="relative px-3 py-2.5 text-center">
      <button
        type="button"
        onClick={handleClick}
        disabled={matches.length === 0}
        className={cn(
          'inline-flex min-w-[2rem] justify-center rounded-md px-2 py-0.5 text-sm font-semibold transition-opacity',
          matches.length > 0 ? cn('cursor-pointer hover:opacity-70', tone) : 'cursor-default text-gray-300',
        )}
      >
        {matches.length}
      </button>

      {open && (
        <div className="absolute left-1/2 top-full z-20 mt-1 w-64 -translate-x-1/2 rounded-lg border border-gray-200 bg-white p-1.5 text-left shadow-xl">
          <ul className="max-h-56 overflow-y-auto">
            {matches.map((r) => (
              <li key={r.id}>
                <button
                  type="button"
                  onClick={() => { onOpenLead(r.id); setOpen(false) }}
                  className="flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left text-xs text-gray-700 hover:bg-gray-50"
                >
                  <span className="min-w-0 flex-1 truncate font-medium">{r.nome || 'Sem nome'}</span>
                  <span className="shrink-0 truncate text-[10px] text-gray-400">{boardName(r.boardId)}</span>
                  <ChevronRight className="h-3 w-3 shrink-0 text-gray-300" />
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </td>
  )
}

export interface LeadTodayBySdrProps {
  rows: LeadRow[]
  boards: LeadBoard[]
  onOpenLead: (id: string) => void
}

/** Mesmos 4 "status do dia" do painel fixo, só que abertos por SDR — pra bater o olho e ver
 * quem tá com pendência sem precisar entrar em cada aba. Clicar num número abre o lead direto
 * (se só tiver 1) ou lista pra escolher qual (se tiver mais de 1), igual o painel do dia. */
export function LeadTodayBySdr({ rows, boards, onOpenLead }: LeadTodayBySdrProps) {
  const today = React.useMemo(() => todayKey(), [])
  const activity = useLeadActivity()
  const sdrLabels = useLeadLabels('sdr')
  const activityById = React.useMemo(
    () => new Map(activity.map((a) => [a.id, a.diaContatoUpdatedAt])),
    [activity],
  )

  const bySdr = React.useMemo<SdrToday[]>(() => {
    const buckets = new Map<string, SdrToday>()
    for (const r of rows) {
      const name = r.sdr || 'Sem SDR'
      const b = buckets.get(name) ?? {
        sdr: name,
        color: sdrLabels.find((l) => l.name === name)?.color ?? '#9CA3AF',
        naoAtualizado: [], atrasado: [], reuniaoHoje: [], propostaHoje: [],
      }
      const c = classifyLeadToday(r, activityById.get(r.id), today)
      if (c.naoAtualizado) b.naoAtualizado.push(r)
      if (c.atrasado) b.atrasado.push(r)
      if (c.reuniaoHoje) b.reuniaoHoje.push(r)
      if (c.propostaHoje) b.propostaHoje.push(r)
      buckets.set(name, b)
    }
    return Array.from(buckets.values()).sort((a, b) => a.sdr.localeCompare(b.sdr))
  }, [rows, today, activityById, sdrLabels])

  return (
    <div className="rounded-2xl bg-white p-4 shadow-sm">
      <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-[#323338]">
        <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-accent/10 text-accent">
          <UserRound className="h-4 w-4" />
        </span>
        Status do dia por SDR
      </div>
      {bySdr.length === 0 ? (
        <p className="py-4 text-center text-xs text-gray-400">Sem dados pra mostrar.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] border-collapse text-left text-xs">
            <thead>
              <tr className="border-b border-gray-200 text-[11px] font-semibold text-gray-500">
                <th className="px-3 py-2">SDR</th>
                <th className="px-3 py-2 text-center">Não atualizado (24h+)</th>
                <th className="px-3 py-2 text-center">Atrasados</th>
                <th className="px-3 py-2 text-center">Reuniões hoje</th>
                <th className="px-3 py-2 text-center">Propostas hoje</th>
              </tr>
            </thead>
            <tbody>
              {bySdr.map((m) => (
                <tr key={m.sdr} className="border-b border-gray-100 last:border-0 hover:bg-gray-50/70">
                  <td className="px-3 py-2.5">
                    <span className="inline-flex items-center gap-1.5 font-medium text-gray-700">
                      <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: m.color }} />
                      {m.sdr}
                    </span>
                  </td>
                  <CountCell matches={m.naoAtualizado} boards={boards} onOpenLead={onOpenLead} tone="text-amber-600 bg-amber-50" />
                  <CountCell matches={m.atrasado} boards={boards} onOpenLead={onOpenLead} tone="text-red-600 bg-red-50" />
                  <CountCell matches={m.reuniaoHoje} boards={boards} onOpenLead={onOpenLead} tone="text-blue-600 bg-blue-50" />
                  <CountCell matches={m.propostaHoje} boards={boards} onOpenLead={onOpenLead} tone="text-emerald-600 bg-emerald-50" />
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
