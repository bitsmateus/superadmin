import { Navigate, useLocation } from 'react-router-dom'
import { Loader2 } from 'lucide-react'
import { useAuth } from '@/hooks/useAuth'
import { useLeadBoards, useLeadBoardsBooted } from '@/hooks/useLeadBoards'
import { useLeadPages, useLeadPagesBooted } from '@/hooks/useLeadPages'
import { useSupportPages, useSupportPagesBooted } from '@/hooks/useSupportPages'
import { MENU_ACCESS_ITEMS, acessoAAgenda } from '@/constants/menuAccess'
import { canSeeFinancials } from '@/services/supabase'
import type { LeadBoard, LeadPage } from '@/types/leadBoard'
import type { SupportPage } from '@/services/supportPages'

/** Links antigos de aba que só redirecionam pra rota nova (onde a trava é aplicada de novo). */
const ABAS_QUE_SO_REDIRECIONAM = new Set(['novos-leads', 'crm-nx-luis', 'crm-nx-arthur', 'vendas', 'contrato'])

type Contexto = {
  allowed: Set<string>
  pages: LeadPage[]
  pagesBooted: boolean
  boards: LeadBoard[]
  boardsBooted: boolean
  supportPages: SupportPage[]
  supportBooted: boolean
}

const casa = (path: string, base: string) => path === base || path.startsWith(base + '/')

/**
 * Usuário RESTRITO só abre o que está marcado em Permissões. É uma lista fechada: o que não está liberado
 * aqui não abre, mesmo digitando o endereço. 'carregando' = ainda falta saber quais abas a pessoa tem.
 */
function liberadoParaRestrito(path: string, c: Contexto): boolean | 'carregando' {
  // Telas com marca (Suporte, NX Digital, Agenda, Dashboard Comercial)
  if (path === '/') return c.allowed.has('dashboard')
  const item = MENU_ACCESS_ITEMS
    .filter((i) => i.path !== '/' && casa(path, i.path))
    .sort((a, b) => b.path.length - a.path.length)[0]
  if (item) return item.key === 'agenda' ? acessoAAgenda(c.allowed) : c.allowed.has(item.key)
  if (casa(path, '/comercial-dashboard-mensal')) return c.allowed.has('comercial_dashboard')

  // Abas do Comercial / Demandas: só as que o servidor devolve pra pessoa (já vêm filtradas por aba liberada)
  const aba = path.match(/^\/(comercial|demandas)(?:\/([^/]+))?\/?$/)
  if (aba) {
    if (aba[2] && ABAS_QUE_SO_REDIRECIONAM.has(aba[2])) return true
    if (!c.pagesBooted) return 'carregando'
    // Aba de Financeiro (Vendas/Contrato) não abre por aqui também, mesmo que tenha sido marcada no passado.
    const financeiras = new Set(c.boards.filter((b) => b.isVendas || b.isContrato).map((b) => b.page))
    if (!c.boardsBooted) return 'carregando'
    const abas = c.pages.filter((p) => !financeiras.has(p.id))
    return aba[2] ? abas.some((p) => p.id === aba[2]) : abas.length > 0
  }

  // Financeiro inteiro (Vendas, Contrato, Contas a Pagar, Clientes Geral, painel financeiro): só administrador.
  if (casa(path, '/financeiro')) return false

  // Cópia de uma tela do Suporte: vale a marca da tela de origem
  const visao = path.match(/^\/visao\/([^/]+)/)
  if (visao) {
    if (!c.supportBooted) return 'carregando'
    const origem = c.supportPages.find((p) => p.id === visao[1])?.sourceKey
    return !!origem && (origem === 'agenda' ? acessoAAgenda(c.allowed) : c.allowed.has(origem))
  }

  // Todo o resto (Equipe, Auditoria, Conhecimento, Tráfego, Comando, Financeiro, Performance, NPS, relatórios…)
  // não tem marca: é de admin/gestão, e quem é restrito não abre.
  return false
}

/** Primeiro lugar que a pessoa pode abrir — pra onde vai quem tentou entrar onde não pode. */
function primeiroLiberado(c: Contexto): string | null {
  const item = MENU_ACCESS_ITEMS.find((i) => (i.key === 'agenda' ? acessoAAgenda(c.allowed) : c.allowed.has(i.key)))
  if (item) return item.path
  const financeiras = new Set(c.boards.filter((b) => b.isVendas || b.isContrato).map((b) => b.page))
  const aba = c.pages.find((p) => !financeiras.has(p.id))
  if (aba) return `/${aba.section === 'demandas' ? 'demandas' : 'comercial'}/${aba.id}`
  return null
}

function Carregando() {
  return (
    <div className="grid min-h-screen place-items-center bg-bg text-foreground/55">
      <span className="inline-flex items-center gap-2 text-sm">
        <Loader2 className="h-4 w-4 animate-spin" />
        Carregando…
      </span>
    </div>
  )
}

export function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { profile: session, loading } = useAuth()
  const location = useLocation()
  const pages = useLeadPages()
  const pagesBooted = useLeadPagesBooted()
  const boards = useLeadBoards()
  const boardsBooted = useLeadBoardsBooted()
  const supportPages = useSupportPages()
  const supportBooted = useSupportPagesBooted()

  if (loading) return <Carregando />

  if (!session) {
    return (
      <Navigate
        to="/login"
        replace
        state={{ from: location.pathname + location.search }}
      />
    )
  }

  // Financeiro (e o que é dinheiro da empresa): só Ian e Mateus — vale até pra outro administrador.
  const caminho = location.pathname
  const ehTelaDoFinanceiro = caminho === '/financeiro' || caminho.startsWith('/financeiro/') || caminho === '/comando'
    || caminho === '/trafego' || caminho.startsWith('/trafego/')
  if (ehTelaDoFinanceiro && !canSeeFinancials(session)) return <Navigate to="/" replace />

  // Só administrador vê tudo. Qualquer outro perfil abre apenas o que foi marcado em Permissões.
  if (session.role !== 'admin') {
    const ctx: Contexto = {
      allowed: new Set(session.menuAccess ?? []),
      pages, pagesBooted, boards, boardsBooted, supportPages, supportBooted,
    }
    const liberado = liberadoParaRestrito(location.pathname, ctx)
    if (liberado === 'carregando') return <Carregando />
    if (!liberado) {
      const destino = primeiroLiberado(ctx)
      if (destino && destino !== location.pathname) return <Navigate to={destino} replace />
      return (
        <div className="grid min-h-screen place-items-center bg-bg px-6 text-center">
          <div>
            <p className="text-base font-semibold text-foreground">Nada liberado pra você ainda</p>
            <p className="mt-1 text-sm text-foreground/55">Peça pra um administrador marcar as telas que você usa em Equipe → Permissões.</p>
          </div>
        </div>
      )
    }
  }

  return <>{children}</>
}
