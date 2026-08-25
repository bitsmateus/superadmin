import * as React from 'react'
import { Loader2, ShoppingBag } from 'lucide-react'
import { TopBar } from '@/components/layout/TopBar'
import { VendasView } from '@/components/comercial/VendasView'
import { useLeadBoards, useLeadBoardsBooted } from '@/hooks/useLeadBoards'

/** Vendas mudou de endereço: antes vivia dentro de "Comercial" (/comercial/vendas), agora é
 * subpágina de "Financeiro" (/financeiro/vendas) — só a navegação mudou, o quadro por trás
 * (lead_boards com isVendas) continua o mesmo, resolvido pelo flag em vez de um id fixo de aba. */
export function FinanceiroVendasPage() {
  const booted = useLeadBoardsBooted()
  const boards = useLeadBoards()
  const board = React.useMemo(() => boards.find((b) => b.isVendas), [boards])

  if (!booted) {
    return (
      <div className="grid min-h-screen place-items-center text-sm text-gray-500">
        <span className="inline-flex items-center gap-2">
          <Loader2 className="h-4 w-4 animate-spin" />
          Carregando…
        </span>
      </div>
    )
  }

  if (!board) {
    return (
      <>
        <TopBar title="Vendas" subtitle="Financeiro" />
        <div className="mx-auto mt-10 max-w-md rounded-2xl bg-white p-6 text-center shadow-sm">
          <ShoppingBag className="mx-auto h-8 w-8 text-gray-300" />
          <p className="mt-3 text-sm font-medium text-[#323338]">Nenhum quadro de vendas configurado</p>
          <p className="mt-1 text-xs text-gray-500">
            Marque um quadro do Comercial como quadro de vendas (ícone de sacola no menu do quadro).
          </p>
        </div>
      </>
    )
  }

  return <VendasView pageId={board.page} />
}
