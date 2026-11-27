import * as React from 'react'
import { useLocation } from 'react-router-dom'
import { useAuth } from '@/hooks/useAuth'
import { useLeadPages, useLeadPagesBooted } from '@/hooks/useLeadPages'
import { useLeadBoards, useLeadBoardsBooted } from '@/hooks/useLeadBoards'
import { useSupportPages, useSupportPagesBooted } from '@/hooks/useSupportPages'
import { liberadoParaRestrito, type Contexto } from '@/routes/ProtectedRoute'
import { MENU_KEY_BY_PATH } from '@/constants/menuAccess'
import { canSeeFinancials } from '@/services/supabase'
import { abaDeFora } from '@/lib/abasJuntas'
import { catalogoDePaginas, paginaDoEndereco, registrarRecente, type PaginaDoSistema } from '@/lib/paginasDaInicio'

const ehDoFinanceiro = (to: string) =>
  to === '/gestao' || to.startsWith('/gestao/') || to === '/comando' || to === '/trafego' || to.startsWith('/trafego/')

/**
 * As telas que ESTA pessoa pode abrir — as mesmas regras do ProtectedRoute (o que ela não abriria, não aparece) e do
 * menu (tela do Suporte arquivada some; Vendas/Contrato só existem se houver o quadro).
 */
export function usePaginasDoUsuario(): PaginaDoSistema[] {
  const { profile } = useAuth()
  const pages = useLeadPages()
  const pagesBooted = useLeadPagesBooted()
  const boards = useLeadBoards()
  const boardsBooted = useLeadBoardsBooted()
  const supportPages = useSupportPages()
  const supportBooted = useSupportPagesBooted()

  return React.useMemo(() => {
    if (!profile) return []
    const ctx: Contexto = {
      allowed: new Set(profile.menuAccess ?? []), pages, pagesBooted, boards, boardsBooted, supportPages, supportBooted,
    }
    const financeiro = canSeeFinancials(profile)
    const temVendas = boards.some((b) => b.isVendas)
    const temContrato = boards.some((b) => b.isContrato)
    const podeAbrir = (to: string) => {
      if (ehDoFinanceiro(to) && !financeiro) return false
      if (to === '/gestao/vendas' && !temVendas) return false
      if (to === '/gestao/contrato' && !temContrato) return false
      const chave = MENU_KEY_BY_PATH[to]
      if (chave && to !== '/dashboard-suporte' && supportBooted && !supportPages.some((p) => p.id === chave)) return false
      if (profile.role === 'admin') return true
      return liberadoParaRestrito(to, ctx) === true
    }
    return catalogoDePaginas({
      abas: pages,
      abasFinanceiras: new Set(boards.filter((b) => b.isVendas || b.isContrato).map((b) => b.page)),
      copiasDoSuporte: supportPages,
      abaDeFora,
      podeAbrir,
    })
  }, [profile, pages, pagesBooted, boards, boardsBooted, supportPages, supportBooted])
}

const chaveDosRecentes = (userId: string) => `nx.inicio.recentes.${userId}`
const EVENTO = 'nx-paginas-recentes'

function lerRecentes(userId: string): string[] {
  try {
    const v = JSON.parse(window.localStorage.getItem(chaveDosRecentes(userId)) ?? '[]')
    return Array.isArray(v) ? v.filter((s): s is string => typeof s === 'string') : []
  } catch {
    return []
  }
}

/** No Layout: cada tela aberta entra nas "Páginas recentes" da pessoa (neste navegador). */
export function useRegistrarPaginaRecente() {
  const { pathname } = useLocation()
  const { profile } = useAuth()
  const catalogo = usePaginasDoUsuario()
  const userId = profile?.id
  React.useEffect(() => {
    if (!userId) return
    const pagina = paginaDoEndereco(catalogo, pathname)
    if (!pagina) return
    const atual = lerRecentes(userId)
    if (atual[0] === pagina.to) return
    try {
      window.localStorage.setItem(chaveDosRecentes(userId), JSON.stringify(registrarRecente(atual, pagina.to)))
      window.dispatchEvent(new Event(EVENTO))
    } catch { /* navegador sem armazenamento: só fica sem recentes */ }
  }, [pathname, userId, catalogo])
}

/** As últimas 5 telas abertas, só as que a pessoa ainda pode abrir. */
export function usePaginasRecentes(catalogo: PaginaDoSistema[]): PaginaDoSistema[] {
  const { profile } = useAuth()
  const userId = profile?.id
  const [caminhos, setCaminhos] = React.useState<string[]>(() => (userId ? lerRecentes(userId) : []))
  React.useEffect(() => {
    if (!userId) return
    const atualizar = () => setCaminhos(lerRecentes(userId))
    atualizar()
    window.addEventListener(EVENTO, atualizar)
    window.addEventListener('storage', atualizar)
    return () => { window.removeEventListener(EVENTO, atualizar); window.removeEventListener('storage', atualizar) }
  }, [userId])
  return React.useMemo(() => {
    const porCaminho = new Map(catalogo.map((x) => [x.to, x]))
    return caminhos.map((c) => porCaminho.get(c)).filter((x): x is PaginaDoSistema => !!x)
  }, [caminhos, catalogo])
}
