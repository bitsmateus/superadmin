import * as React from 'react'
import { CalendarRange, Loader2 } from 'lucide-react'
import { TopBar } from '@/components/layout/TopBar'
import { Input } from '@/components/ui/Input'
import { LeadTodayPanel } from '@/components/comercial/LeadTodayPanel'
import { LeadTodayBySdr } from '@/components/comercial/LeadTodayBySdr'
import { SdrSummaryPanel } from '@/components/comercial/SdrSummaryPanel'
import { LeadDetailModal } from '@/components/comercial/LeadDetailModal'
import { SdrFilterButton } from '@/components/comercial/LeadBoardsView'
import { useAllLeadRows, useLeadBoards, useLeadBoardsBooted } from '@/hooks/useLeadBoards'
import { useLeadPages, useLeadPagesBooted } from '@/hooks/useLeadPages'
import { cn } from '@/lib/utils'

type DateRange = 'today' | '7d' | '30d' | 'custom'

function startOfDay(d: Date): Date {
  const c = new Date(d)
  c.setHours(0, 0, 0, 0)
  return c
}
function daysAgo(n: number): Date {
  const d = startOfDay(new Date())
  d.setDate(d.getDate() - n)
  return d
}
function toISODate(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function RangePill({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors',
        active ? 'bg-accent/10 text-accent ring-1 ring-accent/20' : 'text-gray-500 hover:bg-gray-50',
      )}
    >
      {children}
    </button>
  )
}

/** Visão geral do Comercial — junta TODAS as abas ativas (Novos Leads, CRM NX Luis, CRM NX
 * Arthur e as que forem criadas depois) num só lugar, pra bater o olho e entender o cenário da
 * operação sem entrar aba por aba. Propositalmente diferente (mais resumido/visual) do dashboard
 * de cada aba: sem os gráficos de "leads por quadro/status/dia de contato", só painel do dia
 * combinado + funil e status do dia sempre abertos por SDR (Luis/Arthur, mesmo zerados). Filtro
 * por data e por SDR — parte em "Hoje" por padrão. O total de leads do card usa a data de criação
 * do lead; Agendadas/No-show/Vendas usam a data do próprio evento (ver SdrSummaryPanel). */
export function ComercialDashboardPage() {
  const boardsBooted = useLeadBoardsBooted()
  const pagesBooted = useLeadPagesBooted()
  const booted = boardsBooted && pagesBooted

  const activePages = useLeadPages()
  const allBoards = useLeadBoards()
  const allRows = useAllLeadRows()

  const boards = React.useMemo(() => {
    const activePageIds = new Set(activePages.map((p) => p.id))
    return allBoards.filter((b) => activePageIds.has(b.page))
  }, [allBoards, activePages])

  const pageRows = React.useMemo(() => {
    const boardIds = new Set(boards.map((b) => b.id))
    return allRows.filter((r) => boardIds.has(r.boardId))
  }, [allRows, boards])

  const [dateRange, setDateRange] = React.useState<DateRange>('today')
  const [from, setFrom] = React.useState<string>(() => toISODate(new Date()))
  const [to, setTo] = React.useState<string>(() => toISODate(new Date()))
  const [sdrFilter, setSdrFilter] = React.useState<string | null>(null)
  const [openLeadId, setOpenLeadId] = React.useState<string | null>(null)

  React.useEffect(() => {
    if (dateRange === 'today') { setFrom(toISODate(new Date())); setTo(toISODate(new Date())) }
    else if (dateRange === '7d') { setFrom(toISODate(daysAgo(6))); setTo(toISODate(new Date())) }
    else if (dateRange === '30d') { setFrom(toISODate(daysAgo(29))); setTo(toISODate(new Date())) }
  }, [dateRange])

  const rows = React.useMemo(() => {
    return pageRows.filter((r) => {
      if (sdrFilter && r.sdr !== sdrFilter) return false
      if (from && r.createdAt.slice(0, 10) < from) return false
      if (to && r.createdAt.slice(0, 10) > to) return false
      return true
    })
  }, [pageRows, sdrFilter, from, to])

  // Sem filtro de data — Agendadas/No-show/Vendas do SdrSummaryPanel usam a DATA DO PRÓPRIO
  // EVENTO (não a de criação do lead) pra decidir o que entra no período selecionado.
  const sdrScopedRows = React.useMemo(
    () => pageRows.filter((r) => !sdrFilter || r.sdr === sdrFilter),
    [pageRows, sdrFilter],
  )

  return (
    <>
      <TopBar
        title="Dashboard Comercial"
        subtitle="Comercial · visão geral de todas as abas"
        titleClassName="text-[36px] font-semibold"
        breadcrumbs={[
          { label: 'Grupo NX Digital', to: '/' },
          { label: 'Comercial', to: '/comercial' },
          { label: 'Dashboard Comercial' },
        ]}
      />

      <div className="flex min-h-screen flex-col gap-4 bg-white px-4 py-4 sm:px-6 sm:py-6 lg:px-8">
        {!booted ? (
          <div className="grid min-h-[30vh] place-items-center text-sm text-gray-500">
            <span className="inline-flex items-center gap-2">
              <Loader2 className="h-4 w-4 animate-spin" />
              Carregando…
            </span>
          </div>
        ) : (
          <>
            <div className="flex flex-wrap items-end justify-between gap-3 rounded-xl border border-gray-200 bg-white p-3">
              <div className="flex flex-wrap items-center gap-1.5">
                <CalendarRange className="h-4 w-4 shrink-0 text-gray-400" />
                <RangePill active={dateRange === 'today'} onClick={() => setDateRange('today')}>Hoje</RangePill>
                <RangePill active={dateRange === '7d'} onClick={() => setDateRange('7d')}>Últimos 7 dias</RangePill>
                <RangePill active={dateRange === '30d'} onClick={() => setDateRange('30d')}>Últimos 30 dias</RangePill>
                <RangePill active={dateRange === 'custom'} onClick={() => setDateRange('custom')}>Personalizado</RangePill>
              </div>
              <div className="flex flex-wrap items-end gap-2">
                {dateRange === 'custom' && (
                  <>
                    <Input
                      label="De"
                      type="date"
                      value={from}
                      onChange={(e) => setFrom(e.target.value)}
                      containerClassName="w-36"
                    />
                    <Input
                      label="Até"
                      type="date"
                      value={to}
                      onChange={(e) => setTo(e.target.value)}
                      containerClassName="w-36"
                    />
                  </>
                )}
                <SdrFilterButton value={sdrFilter} onChange={setSdrFilter} />
              </div>
            </div>

            <LeadTodayPanel rows={rows} boards={boards} onOpenLead={setOpenLeadId} />
            <SdrSummaryPanel rows={rows} allRows={sdrScopedRows} from={from} to={to} boards={boards} onOpenLead={setOpenLeadId} />
            <LeadTodayBySdr rows={rows} boards={boards} onOpenLead={setOpenLeadId} />
          </>
        )}
      </div>

      <LeadDetailModal leadRowId={openLeadId} onClose={() => setOpenLeadId(null)} />
    </>
  )
}
