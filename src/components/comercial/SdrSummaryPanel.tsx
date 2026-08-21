import * as React from 'react'
import { Calendar, ShoppingBag, UserRound, UserX } from 'lucide-react'
import { useLeadLabels } from '@/hooks/useLeadLabels'
import { useLeadMilestones } from '@/hooks/useLeadMilestones'
import { MILESTONE_NO_SHOW, MILESTONE_VENDIDO } from '@/components/comercial/LeadDashboardView'
import type { LeadRow } from '@/types/leadBoard'

interface SdrSummary {
  sdr: string
  color: string
  total: number
  agendados: number
  noShow: number
  vendas: number
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (!parts.length) return '?'
  return (parts[0][0] + (parts[1]?.[0] ?? '')).toUpperCase()
}

function StatPill({ icon, label, value, color }: { icon: React.ReactNode; label: string; value: number; color: string }) {
  return (
    <div className="flex flex-1 flex-col items-center gap-1 rounded-xl bg-gray-50/70 px-2 py-2.5">
      <span className="inline-flex items-center gap-1 text-[10px] font-medium text-gray-400">
        <span style={{ color }}>{icon}</span>
        {label}
      </span>
      <span className="text-lg font-bold" style={{ color }}>{value}</span>
    </div>
  )
}

function SdrSummaryCard({ s }: { s: SdrSummary }) {
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
          <p className="text-[11px] text-gray-400">{s.total} lead{s.total === 1 ? '' : 's'} no total</p>
        </div>
        <span className="shrink-0 rounded-full bg-accent/10 px-2.5 py-1 text-sm font-bold text-accent">
          {s.total}
        </span>
      </div>
      <div className="flex gap-2">
        <StatPill icon={<Calendar className="h-3 w-3" />} label="Agendadas" value={s.agendados} color="#4F8EF7" />
        <StatPill icon={<UserX className="h-3 w-3" />} label="No-show" value={s.noShow} color="#EF4444" />
        <StatPill icon={<ShoppingBag className="h-3 w-3" />} label="Vendas" value={s.vendas} color="#22C55E" />
      </div>
    </div>
  )
}

export interface SdrSummaryPanelProps {
  rows: LeadRow[]
}

/** Resumo visual e enxuto do funil por SDR, pra bater o olho — sem os gráficos de "leads por
 * quadro/status" do dashboard de cada aba, só o que interessa pra gestão: quantos leads, quantas
 * reuniões agendadas, no-show e vendas. Sempre mostra os SDRs cadastrados (mesmo zerados) — a
 * ordem e a lista vêm das etiquetas de SDR (Equipe > Etiquetas), não dos leads existentes. */
export function SdrSummaryPanel({ rows }: SdrSummaryPanelProps) {
  const sdrLabels = useLeadLabels('sdr')
  const milestones = useLeadMilestones()
  const milestoneById = React.useMemo(
    () => new Map(milestones.map((m) => [m.id, { milestone: m.milestone, everAgendada: m.everAgendada }])),
    [milestones],
  )

  const summaries = React.useMemo<SdrSummary[]>(() => {
    const buckets = new Map<string, SdrSummary>()
    for (const l of sdrLabels) buckets.set(l.name, { sdr: l.name, color: l.color, total: 0, agendados: 0, noShow: 0, vendas: 0 })
    for (const r of rows) {
      const name = r.sdr || 'Sem SDR'
      const b = buckets.get(name) ?? { sdr: name, color: '#9CA3AF', total: 0, agendados: 0, noShow: 0, vendas: 0 }
      b.total += 1
      const info = milestoneById.get(r.id)
      if (info?.everAgendada) b.agendados += 1
      if (info?.milestone === MILESTONE_NO_SHOW) b.noShow += 1
      else if (info?.milestone === MILESTONE_VENDIDO) b.vendas += 1
      buckets.set(name, b)
    }
    const seededNames = new Set(sdrLabels.map((l) => l.name))
    const seeded = sdrLabels.map((l) => buckets.get(l.name)!)
    const extra = Array.from(buckets.values()).filter((b) => !seededNames.has(b.sdr))
    return [...seeded, ...extra]
  }, [rows, sdrLabels, milestoneById])

  return (
    <div className="rounded-2xl bg-white p-4 shadow-sm">
      <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-[#323338]">
        <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-accent/10 text-accent">
          <UserRound className="h-4 w-4" />
        </span>
        Métricas por SDR
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {summaries.map((s) => <SdrSummaryCard key={s.sdr} s={s} />)}
      </div>
    </div>
  )
}
