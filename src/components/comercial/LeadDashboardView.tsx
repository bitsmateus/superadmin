import * as React from 'react'
import { BarChart3, LayoutGrid, Tags, Users } from 'lucide-react'
import { useLeadLabels } from '@/hooks/useLeadLabels'
import { formatBRLCents, parseBRLCents } from '@/lib/currency'
import { cn } from '@/lib/utils'
import type { LeadBoard, LeadRow } from '@/types/leadBoard'

interface Bucket {
  key: string
  label: string
  color: string
  count: number
}

function BarList({ icon, title, buckets, total }: { icon: React.ReactNode; title: string; buckets: Bucket[]; total: number }) {
  const max = Math.max(1, ...buckets.map((b) => b.count))
  return (
    <div className="rounded-2xl bg-white p-4 shadow-sm">
      <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-[#323338]">
        <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-accent/10 text-accent">{icon}</span>
        {title}
      </div>
      {buckets.length === 0 ? (
        <p className="py-4 text-center text-xs text-gray-400">Sem dados pra mostrar.</p>
      ) : (
        <div className="space-y-2.5">
          {buckets.map((b) => (
            <div key={b.key} className="flex items-center gap-2.5">
              <span className="w-28 shrink-0 truncate text-xs font-medium text-gray-600" title={b.label}>
                {b.label}
              </span>
              <div className="h-5 flex-1 overflow-hidden rounded-full bg-gray-100">
                <div
                  className="h-full rounded-full transition-all"
                  style={{ width: `${(b.count / max) * 100}%`, backgroundColor: b.color }}
                />
              </div>
              <span className="w-16 shrink-0 text-right text-xs font-semibold text-gray-700">
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

export interface LeadDashboardViewProps {
  rows: LeadRow[]
  boards: LeadBoard[]
}

/** Painel só de visualização — nada aqui é editável, é resumo de leitura dos leads filtrados. */
export function LeadDashboardView({ rows, boards }: LeadDashboardViewProps) {
  const statusLabels = useLeadLabels('status')
  const diaContatoLabels = useLeadLabels('diaContato')

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

  const byStatus = React.useMemo<Bucket[]>(() => {
    const counts = new Map<string, number>()
    for (const r of rows) counts.set(r.status || '—', (counts.get(r.status || '—') ?? 0) + 1)
    return Array.from(counts.entries())
      .map(([name, count]) => ({
        key: name,
        label: name,
        color: statusLabels.find((l) => l.name === name)?.color ?? '#9CA3AF',
        count,
      }))
      .sort((a, b) => b.count - a.count)
  }, [rows, statusLabels])

  const byDiaContato = React.useMemo<Bucket[]>(() => {
    const counts = new Map<string, number>()
    for (const r of rows) counts.set(r.diaContato || '—', (counts.get(r.diaContato || '—') ?? 0) + 1)
    return Array.from(counts.entries())
      .map(([name, count]) => ({
        key: name,
        label: name,
        color: diaContatoLabels.find((l) => l.name === name)?.color ?? '#9CA3AF',
        count,
      }))
      .sort((a, b) => b.count - a.count)
  }, [rows, diaContatoLabels])

  return (
    <div className={cn('flex-1 space-y-4')}>
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
    </div>
  )
}
