import * as React from 'react'
import { Loader2 } from 'lucide-react'
import { TopBar } from '@/components/layout/TopBar'
import { LeadDashboardView } from '@/components/comercial/LeadDashboardView'
import { LeadTodayPanel } from '@/components/comercial/LeadTodayPanel'
import { LeadTodayBySdr } from '@/components/comercial/LeadTodayBySdr'
import { LeadDetailModal } from '@/components/comercial/LeadDetailModal'
import { useAllLeadRows, useLeadBoards, useLeadBoardsBooted } from '@/hooks/useLeadBoards'
import { useLeadPages, useLeadPagesBooted } from '@/hooks/useLeadPages'

/** Visão geral do Comercial — junta TODAS as abas ativas (Novos Leads, CRM NX Luis, CRM NX
 * Arthur e as que forem criadas depois) num só lugar, pra bater o olho e entender o cenário da
 * operação sem entrar aba por aba. Mostra o mesmo painel do dia (combinado) e as mesmas métricas
 * de funil (combinadas e por SDR) já usadas dentro de cada aba, só que somando tudo — mais a
 * quebra por SDR dos 4 status do dia, que só existe aqui. */
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

  const rows = React.useMemo(() => {
    const boardIds = new Set(boards.map((b) => b.id))
    return allRows.filter((r) => boardIds.has(r.boardId))
  }, [allRows, boards])

  const [openLeadId, setOpenLeadId] = React.useState<string | null>(null)

  return (
    <>
      <TopBar
        title="Dashboard Comercial"
        subtitle="Comercial · visão geral de todas as abas"
        titleClassName="text-[36px] font-semibold"
        breadcrumbs={[
          { label: 'TenantHub', to: '/' },
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
            <LeadTodayPanel rows={rows} boards={boards} onOpenLead={setOpenLeadId} />
            <LeadTodayBySdr rows={rows} boards={boards} onOpenLead={setOpenLeadId} />
            <LeadDashboardView rows={rows} boards={boards} />
          </>
        )}
      </div>

      <LeadDetailModal leadRowId={openLeadId} onClose={() => setOpenLeadId(null)} />
    </>
  )
}
