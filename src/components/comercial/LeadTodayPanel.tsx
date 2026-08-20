import * as React from 'react'
import { AlertTriangle, CalendarCheck2, CalendarClock, FileText } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { LeadRow } from '@/types/leadBoard'

/** Etiqueta de Status usada pra achar "propostas" — precisa bater com o texto exato cadastrado. */
const PROPOSTA_STATUS = 'Proposta Enviada'

function todayKey(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function dateKey(iso: string): string {
  return iso ? iso.slice(0, 10) : ''
}

export interface LeadTodayPanelProps {
  rows: LeadRow[]
}

/** Resumo fixo do dia, acima dos quadros — pra bater o olho ao abrir a tela e já saber o que
 * fazer, sem precisar mexer em filtro nenhum. Sempre calculado em cima de TODOS os leads da
 * aba (não respeita busca/filtro da lista abaixo), pra ser sempre o retrato real do dia. */
export function LeadTodayPanel({ rows }: LeadTodayPanelProps) {
  const today = React.useMemo(() => todayKey(), [])

  const stats = React.useMemo(() => {
    let retornosHoje = 0
    let atrasados = 0
    let reunioesHoje = 0
    let propostasHoje = 0
    for (const r of rows) {
      const retornarKey = dateKey(r.retornar)
      if (retornarKey && !r.retornado) {
        if (retornarKey === today) retornosHoje += 1
        else if (retornarKey < today) atrasados += 1
      }
      if (dateKey(r.agendamento) === today) reunioesHoje += 1
      if (r.status === PROPOSTA_STATUS && retornarKey === today) propostasHoje += 1
    }
    return { retornosHoje, atrasados, reunioesHoje, propostasHoje }
  }, [rows, today])

  const cards: { icon: React.ReactNode; label: string; value: number; tone: string }[] = [
    { icon: <CalendarClock className="h-4 w-4" />, label: 'Retornos de hoje', value: stats.retornosHoje, tone: 'text-amber-600 bg-amber-50' },
    { icon: <AlertTriangle className="h-4 w-4" />, label: 'Atrasados (não retornados)', value: stats.atrasados, tone: 'text-red-600 bg-red-50' },
    { icon: <CalendarCheck2 className="h-4 w-4" />, label: 'Reuniões agendadas hoje', value: stats.reunioesHoje, tone: 'text-blue-600 bg-blue-50' },
    { icon: <FileText className="h-4 w-4" />, label: 'Propostas p/ retornar hoje', value: stats.propostasHoje, tone: 'text-emerald-600 bg-emerald-50' },
  ]

  return (
    <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
      {cards.map((c) => (
        <div key={c.label} className="flex items-center gap-3 rounded-2xl bg-white p-3.5 shadow-sm ring-1 ring-gray-100">
          <span className={cn('grid h-9 w-9 shrink-0 place-items-center rounded-xl', c.tone)}>{c.icon}</span>
          <div className="min-w-0">
            <p className="text-xl font-bold leading-none text-[#323338]">{c.value}</p>
            <p className="mt-1 truncate text-[11px] text-gray-500">{c.label}</p>
          </div>
        </div>
      ))}
    </div>
  )
}
