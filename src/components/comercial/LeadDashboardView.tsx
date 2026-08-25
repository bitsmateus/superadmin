import * as React from 'react'
import { BarChart3, Calendar, LayoutGrid, ShoppingBag, Tags, UserRound, UserX, Users } from 'lucide-react'
import { useLeadLabels } from '@/hooks/useLeadLabels'
import { useLeadMilestones } from '@/hooks/useLeadMilestones'
import { formatBRLCents, parseBRLCents } from '@/lib/currency'
import { cn } from '@/lib/utils'
import type { LeadBoard, LeadRow } from '@/types/leadBoard'

/** Etiquetas de Status que "contam" pro funil do SDR — precisam bater com o texto exato
 * cadastrado em Status (ver server/src/routes/leadBoards.ts, MILESTONE_STATUSES). Exportadas pra
 * reuso no resumo por SDR do Dashboard Comercial (SdrSummaryPanel), que usa o mesmo critério. */
export const MILESTONE_NO_SHOW = 'Reunião não comparecida'
export const MILESTONE_VENDIDO = 'Vendido'

interface Bucket {
  key: string
  label: string
  color: string
  count: number
}

function BarList({ icon, title, buckets, total }: { icon: React.ReactNode; title: string; buckets: Bucket[]; total: number }) {
  return (
    <div className="rounded-2xl bg-white p-4 shadow-sm">
      <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-[#323338]">
        <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-accent/10 text-accent">{icon}</span>
        {title}
      </div>
      {buckets.length === 0 ? (
        <p className="py-4 text-center text-xs text-gray-400">Sem dados pra mostrar.</p>
      ) : (
        <div className="space-y-2">
          {buckets.map((b) => (
            <div key={b.key} className="flex items-center gap-2.5 border-b border-gray-50 pb-2 last:border-0 last:pb-0">
              <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: b.color }} />
              <span className="min-w-0 flex-1 truncate text-xs font-medium text-gray-600" title={b.label}>
                {b.label}
              </span>
              <span className="shrink-0 text-xs font-semibold text-gray-700">
                {b.count} {total > 0 ? `(${Math.round((b.count / total) * 100)}%)` : ''}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function SummaryCard({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="flex items-center gap-3 rounded-2xl bg-white p-4 shadow-sm">
      <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-accent/10 text-accent">{icon}</span>
      <div className="min-w-0">
        <p className="text-[11px] font-medium text-gray-400">{label}</p>
        <p className="truncate text-lg font-bold text-[#323338]">{value}</p>
      </div>
    </div>
  )
}

interface SdrMetrics {
  sdr: string
  color: string
  total: number
  agendados: number
  noShow: number
  vendas: number
  pctAgendamento: number
  pctNoShow: number
  pctAgendamentoVenda: number
}

function pct(n: number): string {
  return `${Math.round(n * 100)}%`
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (!parts.length) return '?'
  return (parts[0][0] + (parts[1]?.[0] ?? '')).toUpperCase()
}

function RingStat({
  icon,
  label,
  color,
  count,
  of,
  ratio,
}: {
  icon: React.ReactNode
  label: string
  color: string
  count: number
  of: number
  ratio: number
}) {
  const deg = Math.max(0, Math.min(1, ratio)) * 360
  return (
    <div className="flex flex-col items-center gap-2 rounded-xl bg-gray-50/70 px-2 py-3">
      <div
        className="relative grid h-16 w-16 shrink-0 place-items-center rounded-full"
        style={{ background: `conic-gradient(${color} ${deg}deg, #E5E7EB 0deg)` }}
      >
        <div className="grid h-[52px] w-[52px] place-items-center rounded-full bg-white">
          <span className="text-sm font-bold" style={{ color }}>{pct(ratio)}</span>
        </div>
      </div>
      <div className="flex items-center gap-1 text-[11px] font-semibold text-gray-600">
        <span style={{ color }}>{icon}</span>
        {label}
      </div>
      <div className="text-[10px] text-gray-400">{count} de {Math.max(of, count)}</div>
    </div>
  )
}

function SdrCard({ metrics }: { metrics: SdrMetrics }) {
  const m = metrics
  return (
    <div className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-gray-100 transition-shadow hover:shadow-md">
      <div className="mb-3 flex items-center gap-3">
        <span
          className="grid h-10 w-10 shrink-0 place-items-center rounded-full text-xs font-bold text-white"
          style={{ backgroundColor: m.color }}
        >
          {initials(m.sdr)}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-[#323338]">{m.sdr}</p>
          <p className="text-[11px] text-gray-400">{m.total} lead{m.total === 1 ? '' : 's'} no total</p>
        </div>
        <span className="shrink-0 rounded-full bg-accent/10 px-2 py-0.5 text-[11px] font-semibold text-accent">
          {m.total}
        </span>
      </div>
      <div className="grid grid-cols-3 gap-2">
        <RingStat icon={<Calendar className="h-3 w-3" />} label="Agendada" color="#4F8EF7" count={m.agendados} of={m.total} ratio={m.pctAgendamento} />
        <RingStat icon={<UserX className="h-3 w-3" />} label="No-show" color="#EF4444" count={m.noShow} of={m.agendados} ratio={m.pctNoShow} />
        <RingStat icon={<ShoppingBag className="h-3 w-3" />} label="Venda" color="#22C55E" count={m.vendas} of={m.agendados} ratio={m.pctAgendamentoVenda} />
      </div>
    </div>
  )
}

function MetricCell({ value, sub }: { value: React.ReactNode; sub?: string }) {
  return (
    <td className="px-3 py-2.5 text-center">
      <div className="text-sm font-semibold text-[#323338]">{value}</div>
      {sub && <div className="text-[10px] text-gray-400">{sub}</div>}
    </td>
  )
}

function SdrMetricsTable({ bySdr, title = 'Métricas por SDR' }: { bySdr: SdrMetrics[]; title?: string }) {
  return (
    <div className="rounded-2xl bg-white p-4 shadow-sm">
      <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-[#323338]">
        <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-accent/10 text-accent">
          <UserRound className="h-4 w-4" />
        </span>
        {title}
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[760px] border-collapse text-left text-xs">
          <thead>
            <tr className="border-b border-gray-200 text-[11px] font-semibold text-gray-500">
              <th className="px-3 py-2">SDR</th>
              <th className="px-3 py-2 text-center">Total de leads</th>
              <th className="px-3 py-2 text-center">Reunião agendada</th>
              <th className="px-3 py-2 text-center">% de agendamento</th>
              <th className="px-3 py-2 text-center">Reunião não comparecida</th>
              <th className="px-3 py-2 text-center">% de no show</th>
              <th className="px-3 py-2 text-center">Total de vendas</th>
              <th className="px-3 py-2 text-center">% agend. p/ venda</th>
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
                <MetricCell value={m.total} />
                <MetricCell value={m.agendados} />
                <MetricCell value={pct(m.pctAgendamento)} />
                <MetricCell value={m.noShow} />
                <MetricCell value={pct(m.pctNoShow)} />
                <MetricCell value={m.vendas} />
                <MetricCell value={pct(m.pctAgendamentoVenda)} />
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

/** Métricas por SDR. "Reunião agendada" conta todo lead que JÁ passou por esse marco em algum
 * momento (mesmo se hoje já virou Vendido/No-show) — é o denominador do funil. "No-show" e
 * "Vendas" usam sempre o marco mais recente da linha do tempo de cada lead, não o status literal
 * atual, pra não contar duas vezes reagendamentos. */
export function SdrMetricsGrid({ rows, title }: { rows: LeadRow[]; title?: string }) {
  const milestones = useLeadMilestones()
  const sdrLabels = useLeadLabels('sdr')
  const milestoneById = React.useMemo(
    () => new Map(milestones.map((m) => [m.id, { milestone: m.milestone, everAgendada: m.everAgendada }])),
    [milestones],
  )

  const bySdr = React.useMemo<SdrMetrics[]>(() => {
    const buckets = new Map<string, { total: number; agendados: number; noShow: number; vendas: number }>()
    for (const r of rows) {
      const name = r.sdr || 'Sem SDR'
      const b = buckets.get(name) ?? { total: 0, agendados: 0, noShow: 0, vendas: 0 }
      b.total += 1
      const info = milestoneById.get(r.id)
      if (info?.everAgendada) b.agendados += 1
      if (info?.milestone === MILESTONE_NO_SHOW) b.noShow += 1
      else if (info?.milestone === MILESTONE_VENDIDO) b.vendas += 1
      buckets.set(name, b)
    }
    return Array.from(buckets.entries())
      .map(([name, b]) => ({
        sdr: name,
        color: sdrLabels.find((l) => l.name === name)?.color ?? '#9CA3AF',
        total: b.total,
        agendados: b.agendados,
        noShow: b.noShow,
        vendas: b.vendas,
        pctAgendamento: b.total > 0 ? b.agendados / b.total : 0,
        pctNoShow: b.agendados > 0 ? b.noShow / b.agendados : (b.noShow > 0 ? 1 : 0),
        pctAgendamentoVenda: b.agendados > 0 ? b.vendas / b.agendados : (b.vendas > 0 ? 1 : 0),
      }))
      .sort((a, b) => b.total - a.total)
  }, [rows, milestoneById, sdrLabels])

  if (bySdr.length === 0) {
    return (
      <div className="rounded-2xl bg-white p-8 shadow-sm">
        <p className="text-center text-xs text-gray-400">Sem dados pra mostrar.</p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <SdrMetricsTable bySdr={bySdr} title={title} />
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        {bySdr.map((m) => <SdrCard key={m.sdr} metrics={m} />)}
      </div>
    </div>
  )
}

export interface LeadDashboardViewProps {
  rows: LeadRow[]
  boards: LeadBoard[]
  /** Rótulo da 2ª aba — "Dashboard do SDR" por padrão (Novos Leads, com os 2 SDRs juntos).
   * CRM NX Luis/Arthur passam "Minhas métricas" porque ali só existe o SDR dono da aba. */
  sdrTabLabel?: string
  /** Numa aba travada num SDR só, o "Dashboard geral" (leads por quadro/status/dia de contato de
   * TODOS os SDRs) não faz sentido — some o alternador de abas e mostra só "Minhas métricas". */
  onlySdr?: boolean
}

/** Painel só de visualização — nada aqui é editável, é resumo de leitura dos leads filtrados. */
export function LeadDashboardView({ rows, boards, sdrTabLabel = 'Dashboard do SDR', onlySdr = false }: LeadDashboardViewProps) {
  const [subView, setSubView] = React.useState<'geral' | 'sdr'>(onlySdr ? 'sdr' : 'geral')
  // boards já vem filtrado pra UMA aba só (chamado de dentro de LeadBoardsView).
  const pageId = boards[0]?.page
  const statusLabels = useLeadLabels('status', pageId)
  const diaContatoLabels = useLeadLabels('diaContato', pageId)

  const totalLeads = rows.length
  const totalMrr = React.useMemo(() => rows.reduce((sum, r) => sum + parseBRLCents(r.valorMrr), 0), [rows])
  const totalImplementacao = React.useMemo(
    () => rows.reduce((sum, r) => sum + parseBRLCents(r.valorImplementacao), 0),
    [rows],
  )

  const byBoard = React.useMemo<Bucket[]>(() => {
    return boards
      .map((b) => ({
        key: b.id,
        label: b.name,
        color: b.color,
        count: rows.filter((r) => r.boardId === b.id).length,
      }))
      .sort((a, b) => b.count - a.count)
  }, [rows, boards])

  // Sempre mostra TODAS as etiquetas cadastradas (mesmo com 0 leads), não só as que já têm
  // lead — igual "Leads por quadro" já fazia. Mantém a ordem cadastrada (1º Dia, 2º Dia...),
  // não reordena por quantidade. "Sem status"/"Sem dia de contato" só aparece se tiver algum
  // lead de fato sem essa etiqueta preenchida, e fica sempre por último.
  const byStatus = React.useMemo<Bucket[]>(() => {
    const counts = new Map<string, number>()
    for (const r of rows) counts.set(r.status || '—', (counts.get(r.status || '—') ?? 0) + 1)
    const items: Bucket[] = statusLabels.map((l) => ({
      key: l.name, label: l.name, color: l.color, count: counts.get(l.name) ?? 0,
    }))
    const blank = counts.get('—') ?? 0
    if (blank > 0) items.push({ key: '—', label: 'Sem status', color: '#9CA3AF', count: blank })
    return items
  }, [rows, statusLabels])

  const byDiaContato = React.useMemo<Bucket[]>(() => {
    const counts = new Map<string, number>()
    for (const r of rows) counts.set(r.diaContato || '—', (counts.get(r.diaContato || '—') ?? 0) + 1)
    const items: Bucket[] = diaContatoLabels.map((l) => ({
      key: l.name, label: l.name, color: l.color, count: counts.get(l.name) ?? 0,
    }))
    const blank = counts.get('—') ?? 0
    if (blank > 0) items.push({ key: '—', label: 'Sem dia de contato', color: '#9CA3AF', count: blank })
    return items
  }, [rows, diaContatoLabels])

  return (
    <div className={cn('flex-1 space-y-4')}>
      {!onlySdr && (
        <div className="inline-flex overflow-hidden rounded-lg border border-gray-200">
          <button
            type="button"
            onClick={() => setSubView('geral')}
            className={cn(
              'inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium transition-colors',
              subView === 'geral' ? 'bg-accent/10 text-accent' : 'text-gray-500 hover:bg-gray-50',
            )}
          >
            <BarChart3 className="h-3.5 w-3.5" />
            Dashboard geral
          </button>
          <button
            type="button"
            onClick={() => setSubView('sdr')}
            className={cn(
              'inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium transition-colors',
              subView === 'sdr' ? 'bg-accent/10 text-accent' : 'text-gray-500 hover:bg-gray-50',
            )}
          >
            <UserRound className="h-3.5 w-3.5" />
            {sdrTabLabel}
          </button>
        </div>
      )}

      {(onlySdr || subView === 'sdr') ? (
        <SdrMetricsGrid rows={rows} />
      ) : (
        <>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <SummaryCard icon={<Users className="h-5 w-5" />} label="Total de leads" value={String(totalLeads)} />
            <SummaryCard icon={<BarChart3 className="h-5 w-5" />} label="Valor MRR (total)" value={formatBRLCents(totalMrr)} />
            <SummaryCard icon={<BarChart3 className="h-5 w-5" />} label="Valor Implementação (total)" value={formatBRLCents(totalImplementacao)} />
          </div>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <BarList icon={<LayoutGrid className="h-4 w-4" />} title="Leads por quadro" buckets={byBoard} total={totalLeads} />
            <BarList icon={<Tags className="h-4 w-4" />} title="Leads por status" buckets={byStatus} total={totalLeads} />
            <BarList icon={<Tags className="h-4 w-4" />} title="Leads por dia de contato" buckets={byDiaContato} total={totalLeads} />
          </div>
        </>
      )}
    </div>
  )
}
