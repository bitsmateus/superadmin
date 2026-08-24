import * as React from 'react'
import { Navigate, useParams } from 'react-router-dom'
import { Loader2 } from 'lucide-react'
import { LeadBoardsView } from '@/components/comercial/LeadBoardsView'
import { VendasView } from '@/components/comercial/VendasView'
import { ContratoView } from '@/components/comercial/ContratoView'
import { useLeadPages, useLeadPagesBooted } from '@/hooks/useLeadPages'
import { useLeadBoards } from '@/hooks/useLeadBoards'

/** Tela do Comercial pra uma aba dinâmica (Novos Leads, CRM NX Luis, CRM NX Arthur, ou qualquer
 * outra que um admin tenha criado/duplicado). Uma rota só (/comercial/:pageId) pras 3 de sempre
 * e pras novas — não são mais páginas fixas no código. */
export function ComercialPage() {
  const { pageId } = useParams<{ pageId: string }>()
  const booted = useLeadPagesBooted()
  const pages = useLeadPages()
  const boards = useLeadBoards()
  // A aba que contém o quadro de vendas não é um CRM: ela é o fechado do período (nome, MRR,
  // implementação e totais), então renderiza outra tela. Casa pelo quadro marcado, não pelo nome
  // da aba — assim renomear "Vendas" não quebra nada.
  const isVendasPage = boards.some((b) => b.page === pageId && b.isVendas)
  // Mesma ideia da aba de Vendas: aba com um quadro marcado como is_contrato vira a tela de
  // geração de contrato (formulário por CNPJ + texto editável), não o quadro genérico.
  const isContratoPage = boards.some((b) => b.page === pageId && b.isContrato)

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

  const exists = pages.some((p) => p.id === pageId)
  if (!exists) {
    // Aba não existe (ou foi arquivada) — manda pra primeira disponível.
    const fallback = pages[0]
    return <Navigate to={fallback ? `/comercial/${fallback.id}` : '/'} replace />
  }

  if (isVendasPage) return <VendasView pageId={pageId as string} />
  if (isContratoPage) return <ContratoView pageId={pageId as string} />

  return <LeadBoardsView page={pageId as string} />
}
