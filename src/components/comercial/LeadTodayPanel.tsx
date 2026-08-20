import * as React from 'react'
import { AlertTriangle, CalendarCheck2, Clock, FileText, ChevronRight } from 'lucide-react'
import { useOutsideClose } from '@/hooks/useOutsideClose'
import { useLeadActivity } from '@/hooks/useLeadActivity'
import { cn } from '@/lib/utils'
import type { LeadBoard, LeadRow } from '@/types/leadBoard'

const STALE_MS = 24 * 60 * 60 * 1000

/** Etiqueta de Status usada pra achar "propostas" — precisa bater com o texto exato cadastrado. */
const PROPOSTA_STATUS = 'Proposta Enviada'

function todayKey(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function dateKey(iso: string): string {
  return iso ? iso.slice(0, 10) : ''
}

interface StatCard {
  key: string
  icon: React.ReactNode
  label: string
  tone: string
  matches: LeadRow[]
}

function TodayStatCard({
  card,
  boards,
  onOpenLead,
}: {
  card: StatCard
  boards: LeadBoard[]
  onOpenLead: (id: string) => void
}) {
  const [open, setOpen] = React.useState(false)
  const ref = React.useRef<HTMLDivElement>(null)
  useOutsideClose(ref, open, () => setOpen(false))

  const boardName = (boardId: string) => boards.find((b) => b.id === boardId)?.name ?? ''

  const handleClick = () => {
    if (card.matches.length === 0) return
    // 1 resultado só = já abre direto o lead. Mais de um = lista pra escolher qual.
    if (card.matches.length === 1) { onOpenLead(card.matches[0].id); return }
    setOpen((o) => !o)
  }

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={handleClick}
        disabled={card.matches.length === 0}
        className={cn(
          'flex w-full items-center gap-3 rounded-2xl bg-white p-3.5 text-left shadow-sm ring-1 ring-gray-100 transition-shadow',
          card.matches.length > 0 ? 'cursor-pointer hover:shadow-md' : 'cursor-default opacity-60',
        )}
      >
        <span className={cn('grid h-9 w-9 shrink-0 place-items-center rounded-xl', card.tone)}>{card.icon}</span>
        <div className="min-w-0 flex-1">
          <p className="text-xl font-bold leading-none text-[#323338]">{card.matches.length}</p>
          <p className="mt-1 truncate text-[11px] text-gray-500">{card.label}</p>
        </div>
      </button>

      {open && (
        <div className="absolute left-0 top-full z-20 mt-1 w-72 rounded-lg border border-gray-200 bg-white p-1.5 shadow-xl">
          <ul className="max-h-64 overflow-y-auto">
            {card.matches.map((r) => (
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
    </div>
  )
}

export interface LeadTodayPanelProps {
  rows: LeadRow[]
  boards: LeadBoard[]
  onOpenLead: (id: string) => void
}

/** Resumo fixo do dia, acima dos quadros — pra bater o olho ao abrir a tela e já saber o que
 * fazer, sem precisar mexer em filtro nenhum. Sempre calculado em cima de TODOS os leads da
 * aba (não respeita busca/filtro da lista abaixo), pra ser sempre o retrato real do dia. Clicar
 * num card abre o lead direto (se só tiver 1) ou lista pra escolher qual (se tiver mais de 1). */
export function LeadTodayPanel({ rows, boards, onOpenLead }: LeadTodayPanelProps) {
  const today = React.useMemo(() => todayKey(), [])
  const activity = useLeadActivity()
  const activityById = React.useMemo(
    () => new Map(activity.map((a) => [a.id, a.diaContatoUpdatedAt])),
    [activity],
  )

  const groups = React.useMemo(() => {
    const naoAtualizados: LeadRow[] = []
    const atrasados: LeadRow[] = []
    const reunioesHoje: LeadRow[] = []
    const propostasHoje: LeadRow[] = []
    const now = Date.now()
    for (const r of rows) {
      const updatedAt = activityById.get(r.id)
      if (updatedAt && now - new Date(updatedAt).getTime() > STALE_MS) naoAtualizados.push(r)

      const retornarKey = dateKey(r.retornar)
      if (retornarKey && retornarKey < today && !r.retornado) atrasados.push(r)

      if (dateKey(r.agendamento) === today) reunioesHoje.push(r)
      if (r.status === PROPOSTA_STATUS && retornarKey === today) propostasHoje.push(r)
    }
    return { naoAtualizados, atrasados, reunioesHoje, propostasHoje }
  }, [rows, today, activityById])

  const cards: StatCard[] = [
    { key: 'nao-atualizados', icon: <Clock className="h-4 w-4" />, label: 'Status não atualizado (24h+)', tone: 'text-amber-600 bg-amber-50', matches: groups.naoAtualizados },
    { key: 'atrasados', icon: <AlertTriangle className="h-4 w-4" />, label: 'Atrasados (não retornados)', tone: 'text-red-600 bg-red-50', matches: groups.atrasados },
    { key: 'reunioes', icon: <CalendarCheck2 className="h-4 w-4" />, label: 'Reuniões agendadas hoje', tone: 'text-blue-600 bg-blue-50', matches: groups.reunioesHoje },
    { key: 'propostas', icon: <FileText className="h-4 w-4" />, label: 'Propostas p/ retornar hoje', tone: 'text-emerald-600 bg-emerald-50', matches: groups.propostasHoje },
  ]

  return (
    <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
      {cards.map((c) => (
        <TodayStatCard key={c.key} card={c} boards={boards} onOpenLead={onOpenLead} />
      ))}
    </div>
  )
}
