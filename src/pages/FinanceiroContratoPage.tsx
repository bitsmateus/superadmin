import * as React from 'react'
import { FileText, Loader2 } from 'lucide-react'
import { TopBar } from '@/components/layout/TopBar'
import { ContratoView } from '@/components/comercial/ContratoView'
import { useLeadBoards, useLeadBoardsBooted } from '@/hooks/useLeadBoards'

/** Contrato mudou de endereço: antes vivia dentro de "Comercial" (/comercial/contrato), agora é
 * subpágina de "Financeiro" (/financeiro/contrato) — só a navegação mudou, o quadro por trás
 * (lead_boards com isContrato) continua o mesmo, resolvido pelo flag em vez de um id fixo de aba. */
export function FinanceiroContratoPage() {
  const booted = useLeadBoardsBooted()
  const boards = useLeadBoards()
  const board = React.useMemo(() => boards.find((b) => b.isContrato), [boards])

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
        <TopBar title="Contrato" subtitle="Financeiro" />
        <div className="mx-auto mt-10 max-w-md rounded-2xl bg-white p-6 text-center shadow-sm">
          <FileText className="mx-auto h-8 w-8 text-gray-300" />
          <p className="mt-3 text-sm font-medium text-[#323338]">Nenhum quadro de contrato configurado</p>
          <p className="mt-1 text-xs text-gray-500">
            Marque um quadro do Comercial como quadro de contrato (ícone de documento no menu do quadro).
          </p>
        </div>
      </>
    )
  }

  return <ContratoView pageId={board.page} />
}
