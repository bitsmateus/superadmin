import * as React from 'react'
import { AlertTriangle, CalendarCheck2, Clock, FileText, ChevronRight } from 'lucide-react'
import { useOutsideClose } from '@/hooks/useOutsideClose'
import { useLeadActivity } from '@/hooks/useLeadActivity'
import { todayKey, classifyLeadToday } from '@/lib/leadDates'
import { cn } from '@/lib/utils'
import type { LeadBoard, LeadRow } from '@/types/leadBoard'

export interface StatCard {
  key: string
  icon: React.ReactNode
  label: string
  tone: string
  matches: LeadRow[]
}

export function TodayStatCard({
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
          'flex w-full items-center gap-3 rounded-2xl bg-card p-3.5 text-left shadow-sm ring-1 ring-line transition-shadow',
          card.matches.length > 0 ? 'cursor-pointer hover:shadow-md' : 'cursor-default opacity-60',
        )}
      >
        <span className={cn('grid h-9 w-9 shrink-0 place-items-center rounded-xl', card.tone)}>{card.icon}</span>
        <div className="min-w-0 flex-1">
          <p className="text-xl font-bold leading-none text-foreground">{card.matches.length}</p>
          <p className="mt-1 truncate text-[11px] text-foreground/50">{card.label}</p>
        </div>
      </button>

      {open && (
        <div className="absolute left-0 top-full z-20 mt-1 w-72 rounded-lg border border-line bg-card p-1.5 shadow-xl">
          <ul className="max-h-64 overflow-y-auto">
            {card.matches.map((r) => (
              <li key={r.id}>
                <button
                  type="button"
                  onClick={() => { onOpenLead(r.id); setOpen(false) }}
                  className="flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left text-xs text-foreground/70 hover:bg-elevate/[0.04]"
                >
                  <span className="min-w-0 flex-1 truncate font-medium">{r.nome || 'Sem nome'}</span>
                  <span className="shrink-0 truncate text-[10px] text-foreground/40">{boardName(r.boardId)}</span>
                  <ChevronRight className="h-3 w-3 shrink-0 text-foreground/30" />
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

function boardIdsNamed(boards: LeadBoard[], name: string): Set<string> {
  const target = name.trim().toLowerCase()
  return new Set(boards.filter((b) => b.name.trim().toLowerCase() === target).map((b) => b.id))
}

/** Resumo fixo do dia, acima dos quadros — pra bater o olho ao abrir a tela e já saber o que
 * fazer, sem precisar mexer em filtro nenhum. Sempre calculado em cima de TODOS os leads da
 * aba (não respeita busca/filtro da lista abaixo), pra ser sempre o retrato real do dia. Clicar
 * num card abre o lead direto (se só tiver 1) ou lista pra escolher qual (se tiver mais de 1).
 *
 * Cada card tem seu próprio escopo, não são todos "de toda a aba":
 * - "Status não atualizado" só conta quem está no quadro "Primeiro Contato" (sem esse quadro,
 *   volta a somar tudo — não faz sentido cobrar quem ainda nem teve o 1º contato).
 * - "Reuniões de hoje" só conta quem está no quadro "Reunião agendada" (sem esse quadro, soma
 *   tudo) — não algum lead com agendamento de hoje só que já mudou de quadro/status.
 * - "Atrasados" e "Propostas p/ retornar hoje" somam de QUALQUER quadro da aba, sem restrição —
 *   é sobre a data de retorno, não importa onde o lead está agora. */
export function LeadTodayPanel({ rows, boards, onOpenLead }: LeadTodayPanelProps) {
  const today = React.useMemo(() => todayKey(), [])
  const activity = useLeadActivity()
  const activityById = React.useMemo(
    () => new Map(activity.map((a) => [a.id, a.diaContatoUpdatedAt])),
    [activity],
  )
  const primeiroContatoIds = React.useMemo(() => boardIdsNamed(boards, 'primeiro contato'), [boards])
  const reuniaoAgendadaIds = React.useMemo(() => boardIdsNamed(boards, 'reunião agendada'), [boards])

  const groups = React.useMemo(() => {
    const naoAtualizados: LeadRow[] = []
    const atrasados: LeadRow[] = []
    const reunioesHoje: LeadRow[] = []
    const propostasHoje: LeadRow[] = []
    const inPrimeiroContato = (r: LeadRow) => primeiroContatoIds.size === 0 || primeiroContatoIds.has(r.boardId)
    const inReuniaoAgendada = (r: LeadRow) => reuniaoAgendadaIds.size === 0 || reuniaoAgendadaIds.has(r.boardId)
    for (const r of rows) {
      const c = classifyLeadToday(r, activityById.get(r.id), today)
      if (c.naoAtualizado && inPrimeiroContato(r)) naoAtualizados.push(r)
      if (c.atrasado) atrasados.push(r)
      if (c.reuniaoHoje && inReuniaoAgendada(r)) reunioesHoje.push(r)
      if (c.propostaHoje) propostasHoje.push(r)
    }
    return { naoAtualizados, atrasados, reunioesHoje, propostasHoje }
  }, [rows, today, activityById, primeiroContatoIds, reuniaoAgendadaIds])

  const cards: StatCard[] = [
    { key: 'nao-atualizados', icon: <Clock className="h-4 w-4" />, label: 'Status não atualizado hoje', tone: 'text-warning bg-warning/10', matches: groups.naoAtualizados },
    { key: 'atrasados', icon: <AlertTriangle className="h-4 w-4" />, label: 'Atrasados (não retornados)', tone: 'text-danger bg-danger/10', matches: groups.atrasados },
    { key: 'reunioes', icon: <CalendarCheck2 className="h-4 w-4" />, label: 'Reuniões de hoje', tone: 'text-accent bg-accent/10', matches: groups.reunioesHoje },
    { key: 'propostas', icon: <FileText className="h-4 w-4" />, label: 'Propostas p/ retornar hoje', tone: 'text-success bg-success/10', matches: groups.propostasHoje },
  ]

  return (
    <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
      {cards.map((c) => (
        <TodayStatCard key={c.key} card={c} boards={boards} onOpenLead={onOpenLead} />
      ))}
    </div>
  )
}
