import { TopBar } from '@/components/layout/TopBar'

/** Subpágina de Financeiro — painel em branco de propósito, pra ser preenchido depois. */
export function FinanceiroGestaoInternaPage() {
  return (
    <>
      <TopBar title="Gestão Interna" subtitle="Financeiro" />
      <div className="px-4 py-4 sm:px-6 sm:py-6 lg:px-8">
        <div className="min-h-[60vh] rounded-2xl bg-card shadow-sm" />
      </div>
    </>
  )
}
