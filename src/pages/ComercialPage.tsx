import * as React from 'react'
import { Navigate, useLocation, useParams } from 'react-router-dom'
import { Loader2 } from 'lucide-react'
import { LeadBoardsView } from '@/components/comercial/LeadBoardsView'
import { VendasView } from '@/components/comercial/VendasView'
import { ContratoView } from '@/components/comercial/ContratoView'
import { NotasView } from '@/components/comercial/NotasView'
import { useLeadPages, useLeadPagesBooted } from '@/hooks/useLeadPages'
import { useLeadBoards } from '@/hooks/useLeadBoards'

/** Tela do Comercial E de Demandas pra uma aba dinâmica (Novos Leads, CRM NX Luis, CRM NX
 * Arthur, ou qualquer outra que um admin tenha criado/duplicado — ver lead_pages.section). Uma
 * rota só por menu (/comercial/:pageId e /demandas/:pageId) — não são páginas fixas no código. */
export function ComercialPage() {
  const { pageId } = useParams<{ pageId: string }>()
  const location = useLocation()
  const basePath = location.pathname.startsWith('/demandas') ? '/demandas' : '/comercial'
  const section = basePath === '/demandas' ? 'demandas' : 'comercial'
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
  // Aba marcada is_notas (flag da própria lead_page, não de um quadro — pensada pra abas sem
  // nenhum quadro) vira um bloco de notas simples em vez do quadro genérico.
  const isNotasPage = pages.some((p) => p.id === pageId && p.isNotas)

  if (!booted) {
    return (
      <div className="grid min-h-screen place-items-center text-sm text-foreground/50">
        <span className="inline-flex items-center gap-2">
          <Loader2 className="h-4 w-4 animate-spin" />
          Carregando…
        </span>
      </div>
    )
  }

  const exists = pages.some((p) => p.id === pageId)
  if (!exists) {
    // Aba não existe (ou foi arquivada) — manda pra primeira disponível do MESMO menu (Comercial
    // e Demandas compartilham essa tela, mas não as abas uma da outra).
    const fallback = pages.find((p) => p.section === section)
    return <Navigate to={fallback ? `${basePath}/${fallback.id}` : '/'} replace />
  }

  if (isVendasPage) return <VendasView pageId={pageId as string} />
  if (isContratoPage) return <ContratoView pageId={pageId as string} />
  if (isNotasPage) return <NotasView pageId={pageId as string} />

  return <LeadBoardsView page={pageId as string} />
}
