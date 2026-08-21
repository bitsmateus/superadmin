import * as React from 'react'
import { Calendar, ChevronRight, ShoppingBag, UserRound, UserX } from 'lucide-react'
import { useOutsideClose } from '@/hooks/useOutsideClose'
import { useLeadLabels } from '@/hooks/useLeadLabels'
import { useLeadMilestones } from '@/hooks/useLeadMilestones'
import { MILESTONE_NO_SHOW, MILESTONE_VENDIDO } from '@/components/comercial/LeadDashboardView'
import { cn } from '@/lib/utils'
import type { LeadBoard, LeadRow } from '@/types/leadBoard'

interface SdrSummary {
  sdr: string
  color: string
  totalRows: LeadRow[]
  agendadosRows: LeadRow[]
  noShowRows: LeadRow[]
  vendasRows: LeadRow[]
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (!parts.length) return '?'
  return (parts[0][0] + (parts[1]?.[0] ?? '')).toUpperCase()
}

/** Número clicável (total/agendadas/no-show/vendas) — abre o lead direto se só tiver 1, ou uma
 * lista pra escolher qual se tiver mais de 1, igual o painel do dia e o status por SDR. */
function ClickableStat({
  matches,
  boards,
  onOpenLead,
  children,
}: {
  matches: LeadRow[]
  boards: LeadBoard[]
  onOpenLead: (id: string) => void
  children: (onClick: () => void) => React.ReactNode
}) {
  const [open, setOpen] = React.useState(false)
  const ref = React.useRef<HTMLDivElement>(null)
  useOutsideClose(ref, open, () => setOpen(false))

  const boardName = (boardId: string) => boards.find((b) => b.id === boardId)?.name ?? ''

  const handleClick = () => {
    if (matches.length === 0) return
    if (matches.length === 1) { onOpenLead(matches[0].id); return }
    setOpen((o) => !o)
  }

  return (
    <div ref={ref} className="relative">
      {children(handleClick)}
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
    </div>
  )
}

function StatPill({
  icon,
  label,
  matches,
  boards,
  onOpenLead,
  color,
}: {
  icon: React.ReactNode
  label: string
  matches: LeadRow[]
  boards: LeadBoard[]
  onOpenLead: (id: string) => void
  color: string
}) {
  return (
    <ClickableStat matches={matches} boards={boards} onOpenLead={onOpenLead}>
      {(onClick) => (
        <button
          type="button"
          onClick={onClick}
          disabled={matches.length === 0}
          className={cn(
            'flex w-full flex-1 flex-col items-center gap-1 rounded-xl bg-gray-50/70 px-2 py-2.5 transition-opacity',
            matches.length > 0 ? 'cursor-pointer hover:opacity-70' : 'cursor-default',
          )}
        >
          <span className="inline-flex items-center gap-1 text-[10px] font-medium text-gray-400">
            <span style={{ color }}>{icon}</span>
            {label}
          </span>
          <span className="text-lg font-bold" style={{ color }}>{matches.length}</span>
        </button>
      )}
    </ClickableStat>
  )
}

function SdrSummaryCard({ s, boards, onOpenLead }: { s: SdrSummary; boards: LeadBoard[]; onOpenLead: (id: string) => void }) {
  return (
    <div className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-gray-100 transition-shadow hover:shadow-md">
      <div className="mb-3 flex items-center gap-3">
        <span
          className="grid h-11 w-11 shrink-0 place-items-center rounded-full text-sm font-bold text-white"
          style={{ backgroundColor: s.color }}
        >
          {initials(s.sdr)}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-[#323338]">{s.sdr === 'Sem SDR' ? s.sdr : `SDR ${s.sdr}`}</p>
          <p className="text-[11px] text-gray-400">{s.totalRows.length} lead{s.totalRows.length === 1 ? '' : 's'} no total</p>
        </div>
        <ClickableStat matches={s.totalRows} boards={boards} onOpenLead={onOpenLead}>
          {(onClick) => (
            <button
              type="button"
              onClick={onClick}
              disabled={s.totalRows.length === 0}
              className={cn(
                'shrink-0 rounded-full bg-accent/10 px-2.5 py-1 text-sm font-bold text-accent transition-opacity',
                s.totalRows.length > 0 ? 'cursor-pointer hover:opacity-70' : 'cursor-default',
              )}
            >
              {s.totalRows.length}
            </button>
          )}
        </ClickableStat>
      </div>
      <div className="flex gap-2">
        <StatPill icon={<Calendar className="h-3 w-3" />} label="Agendadas" matches={s.agendadosRows} boards={boards} onOpenLead={onOpenLead} color="#4F8EF7" />
        <StatPill icon={<UserX className="h-3 w-3" />} label="No-show" matches={s.noShowRows} boards={boards} onOpenLead={onOpenLead} color="#EF4444" />
        <StatPill icon={<ShoppingBag className="h-3 w-3" />} label="Vendas" matches={s.vendasRows} boards={boards} onOpenLead={onOpenLead} color="#22C55E" />
      </div>
    </div>
  )
}

export interface SdrSummaryPanelProps {
  /** Leads dentro do período selecionado (filtrado por data de criação + SDR) — usado só pro
   * total de leads do card. */
  rows: LeadRow[]
  /** Leads filtrados só por SDR (sem filtro de data) — Agendadas/No-show/Vendas usam a DATA DO
   * PRÓPRIO EVENTO (quando agendou/quando deu no-show/quando vendeu) pra decidir se entram no
   * período, em vez da data de criação do lead. */
  allRows: LeadRow[]
  /** Início/fim do período (YYYY-MM-DD) — vazio = sem limite naquela ponta. */
  from: string
  to: string
  boards: LeadBoard[]
  onOpenLead: (id: string) => void
}

function newBucket(name: string, color: string): SdrSummary {
  return { sdr: name, color, totalRows: [], agendadosRows: [], noShowRows: [], vendasRows: [] }
}

/** Resumo visual e enxuto do funil por SDR, pra bater o olho — sem os gráficos de "leads por
 * quadro/status" do dashboard de cada aba, só o que interessa pra gestão: quantos leads, quantas
 * reuniões agendadas, no-show e vendas. Sempre mostra os SDRs cadastrados (mesmo zerados) — a
 * ordem e a lista vêm das etiquetas de SDR (Equipe > Etiquetas), não dos leads existentes. Cada
 * número é clicável — abre o lead direto (1 resultado) ou uma lista pra escolher (mais de 1).
 *
 * Agendadas/No-show/Vendas contam pela DATA DO EVENTO, não pela data de criação do lead — reunião
 * agendada em julho conta em julho mesmo que o lead tenha sido criado em maio. E se um lead dá
 * no-show e o SDR consegue reagendar de novo, isso NÃO soma um segundo "agendada": a data de
 * "Agendadas" é sempre a do primeiro agendamento da história do lead, e o no-show sai da contagem
 * (o marco atual dele voltou a ser "Reunião agendada"). */
export function SdrSummaryPanel({ rows, allRows, from, to, boards, onOpenLead }: SdrSummaryPanelProps) {
  const sdrLabels = useLeadLabels('sdr')
  const milestones = useLeadMilestones()
  const milestoneById = React.useMemo(
    () => new Map(milestones.map((m) => [m.id, m])),
    [milestones],
  )

  const inRange = React.useCallback((iso: string | null | undefined) => {
    if (!iso) return false
    const key = iso.slice(0, 10)
    if (from && key < from) return false
    if (to && key > to) return false
    return true
  }, [from, to])

  const summaries = React.useMemo<SdrSummary[]>(() => {
    const buckets = new Map<string, SdrSummary>()
    for (const l of sdrLabels) buckets.set(l.name, newBucket(l.name, l.color))

    for (const r of rows) {
      const name = r.sdr || 'Sem SDR'
      const b = buckets.get(name) ?? newBucket(name, '#9CA3AF')
      b.totalRows.push(r)
      buckets.set(name, b)
    }

    for (const r of allRows) {
      const name = r.sdr || 'Sem SDR'
      const b = buckets.get(name) ?? newBucket(name, '#9CA3AF')
      const info = milestoneById.get(r.id)
      if (inRange(info?.firstAgendadaAt)) b.agendadosRows.push(r)
      if (info?.milestone === MILESTONE_NO_SHOW && inRange(info.milestoneAt)) b.noShowRows.push(r)
      else if (info?.milestone === MILESTONE_VENDIDO && inRange(info.milestoneAt)) b.vendasRows.push(r)
      buckets.set(name, b)
    }

    const seededNames = new Set(sdrLabels.map((l) => l.name))
    const seeded = sdrLabels.map((l) => buckets.get(l.name)!)
    const extra = Array.from(buckets.values()).filter((b) => !seededNames.has(b.sdr))
    return [...seeded, ...extra]
  }, [rows, allRows, sdrLabels, milestoneById, inRange])

  return (
    <div className="rounded-2xl bg-white p-4 shadow-sm">
      <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-[#323338]">
        <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-accent/10 text-accent">
          <UserRound className="h-4 w-4" />
        </span>
        Métricas por SDR
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {summaries.map((s) => <SdrSummaryCard key={s.sdr} s={s} boards={boards} onOpenLead={onOpenLead} />)}
      </div>
    </div>
  )
}
