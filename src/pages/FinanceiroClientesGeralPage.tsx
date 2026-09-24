import { TopBar } from '@/components/layout/TopBar'

/** Aba nova de "Financeiro", ainda em branco — o conteúdo entra depois; por enquanto é só o
 * endereço (/financeiro/clientes-geral) e o lugar dela no menu. */
export function FinanceiroClientesGeralPage() {
  return (
    <>
      <TopBar
        title="CLIENTES GERAL"
        subtitle="Financeiro"
        breadcrumbs={[
          { label: 'Grupo NX Digital', to: '/' },
          { label: 'Financeiro' },
          { label: 'Clientes Geral' },
        ]}
      />
      <div className="px-4 pb-10 lg:px-6" />
    </>
  )
}
