import { NavLink, useLocation, useNavigate } from 'react-router-dom'
import * as React from 'react'
import { toast } from 'sonner'
import { createPortal } from 'react-dom'
import {
  Archive,
  BookOpen,
  Briefcase,
  Building2,
  ChevronDown,
  ClipboardList,
  Columns3,
  Contact,
  Copy,
  FileSearch,
  FileText,
  LayoutDashboard,
  LifeBuoy,
  LogOut,
  MessageCircle,
  MessageSquare,
  Moon,
  MoreHorizontal,
  Pencil,
  SlidersHorizontal,
  PanelLeftClose,
  Plus,
  Radio,
  RotateCcw,
  Settings,
  ShieldCheck,
  ShoppingBag,
  Star,
  Sun,
  Trash2,
  Trophy,
  UserCircle2,
  Users,
  Wallet,
  Zap,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import logoNx from '@/assets/logo-nx.jpg'
import { signOut, useAuth, saveOwnTheme } from '@/hooks/useAuth'
import { canManageUsers, canSeeFinancials } from '@/services/supabase'
import { useMyOpenTaskCount } from '@/hooks/useTickets'
import { useTheme } from '@/hooks/useTheme'
import { useOutsideClose } from '@/hooks/useOutsideClose'
import { useLeadPages } from '@/hooks/useLeadPages'
import { useLeadBoards } from '@/hooks/useLeadBoards'
import { useSupportPages, useSupportPagesBooted } from '@/hooks/useSupportPages'
import { MENU_KEY_BY_PATH, MENU_ACCESS_ITEMS } from '@/constants/menuAccess'
import { leadPagesService } from '@/services/leadPages'
import { supportPagesService, isSupportCopy } from '@/services/supportPages'
import type { SupportDuplicateMode } from '@/services/supportPages'
import { supportViewFields, describeSupportView } from '@/lib/supportViews'
import type { SupportViewField } from '@/lib/supportViews'
import type { SupportPage } from '@/services/supportPages'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import type { LeadPage } from '@/types/leadBoard'
import { ServerSwitcher } from './ServerSwitcher'

// "Tarefas" (/tarefas) saiu daqui de propósito — agora só se chega lá pela aba dentro de
// Pipeline (ver PipelineSectionTabs), não mais como item próprio do menu. A rota continua
// funcionando normal (por isso segue em SUPORTE_ROUTES, pra "Suporte" acender como seção ativa).
const suporteItems = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard, end: true },
  { to: '/pipeline', label: 'Pipeline', icon: Columns3 },
  { to: '/clients', label: 'Clientes', icon: Users },
  { to: '/canais', label: 'Canais', icon: Radio },
  { to: '/tenants', label: 'Tenants', icon: Building2 },
]

const SUPORTE_ROUTES = ['/', '/tarefas', '/pipeline', '/clients', '/canais', '/tenants', '/nps']

/** Intercala cópias ("Duplicar") logo depois do item original de cada rota. A cópia herda só o
 * ícone; o nome, o id e a ROTA são próprios dela: `/visao/<id>`, que abre a mesma tela do original
 * com a visão salva da cópia (ver SupportViewPage). Antes as duas apontavam pra mesma URL, então
 * clicar na cópia não saía do lugar e os dois itens acendiam como ativos ao mesmo tempo.
 * Itens sem entrada em MENU_KEY_BY_PATH (Conhecimento, Equipe…) nunca têm cópia. */
function withDuplicates<T extends { to: string; label: string }>(
  items: T[],
  duplicatesByKey: Map<string, SupportPage[]>,
): (T & { pageId?: string; sourceKey?: string })[] {
  return items.flatMap((item) => {
    const key = MENU_KEY_BY_PATH[item.to]
    const dups = key ? duplicatesByKey.get(key) ?? [] : []
    return [
      { ...item, pageId: key, sourceKey: key } as T & { pageId?: string; sourceKey?: string },
      ...dups.map(
        (d) =>
          ({
            ...item,
            to: `/visao/${d.id}`,
            label: d.name,
            pageId: d.id,
            sourceKey: d.sourceKey,
          }) as T & { pageId?: string; sourceKey?: string },
      ),
    ]
  })
}

const ROLE_LABELS = {
  admin: 'Administrador',
  supervisor: 'Supervisor',
  suporte: 'Usuário',
} as const

export interface SidebarProps {
  open: boolean
  onClose: () => void
  onToggle: () => void
}

export function Sidebar({ open, onClose, onToggle }: SidebarProps) {
  const navigate = useNavigate()
  const location = useLocation()
  const { profile } = useAuth()
  const [theme, setTheme] = useTheme()

  // No mobile/tablet, ao navegar fechamos o menu. No desktop mantemos aberto.
  const closeOnMobile = React.useCallback(() => {
    if (typeof window !== 'undefined' && window.matchMedia('(max-width: 1023px)').matches) {
      onClose()
    }
  }, [onClose])

  const onLogout = async () => {
    await signOut()
    navigate('/login', { replace: true })
  }

  const isAdmin = canManageUsers(profile?.role)
  const seeFinancials = canSeeFinancials(profile?.role)
  const myTasks = useMyOpenTaskCount(profile?.id)

  // Usuário com acesso restrito só enxerga os itens liberados em Permissões (Equipe).
  // Itens fora dessa lista (admin-only, financeiro) já têm gate próprio por papel.
  const menuAllowed = profile?.restrictAccess ? new Set(profile.menuAccess ?? []) : null
  const canSee = React.useCallback(
    (to: string) => {
      if (menuAllowed === null) return true
      // Comercial é tudo-ou-nada por uma chave só — as abas são dinâmicas, então o caminho
      // exato (/comercial/<id>) nunca bate igualzinho num dicionário fixo.
      if (to.startsWith('/comercial')) return menuAllowed.has('comercial')
      const key = MENU_KEY_BY_PATH[to]
      return key ? menuAllowed.has(key) : true
    },
    [menuAllowed],
  )

  // Itens do Suporte podem ser arquivados individualmente por um admin (some do menu, fica
  // salvo em "Abas do Suporte" pra restaurar) — Dashboard fica de fora, é a rota raiz.
  const supportPages = useSupportPages()
  const supportPagesBooted = useSupportPagesBooted()
  const isSupportPageVisible = React.useCallback((to: string) => {
    if (to === '/' || !supportPagesBooted) return true
    const key = MENU_KEY_BY_PATH[to]
    if (!key) return true
    return supportPages.some((p) => p.id === key)
  }, [supportPages, supportPagesBooted])

  // Cópias ("Duplicar") de um item do Suporte — abrem a MESMA rota do original, com nome
  // próprio. Agrupadas pelo id do item de origem pra saber onde encaixar cada uma no menu.
  const duplicatesByKey = React.useMemo(() => {
    const map = new Map<string, SupportPage[]>()
    for (const p of supportPages) {
      if (p.id === p.sourceKey) continue
      const list = map.get(p.sourceKey) ?? []
      list.push(p)
      map.set(p.sourceKey, list)
    }
    return map
  }, [supportPages])

  const [archivedOpen, setArchivedOpen] = React.useState(false)
  const [supportArchiveOpen, setSupportArchiveOpen] = React.useState(false)
  const [comercialOpen, setComercialOpen] = React.useState(() =>
    location.pathname.startsWith('/comercial'),
  )
  const [financeiroOpen, setFinanceiroOpen] = React.useState(() =>
    location.pathname.startsWith('/financeiro'),
  )
  const [suporteOpen, setSuporteOpen] = React.useState(() =>
    SUPORTE_ROUTES.some((r) => (r === '/' ? location.pathname === '/' : location.pathname.startsWith(r))),
  )
  const [newPageOpen, setNewPageOpen] = React.useState(false)
  const [pagesArchiveOpen, setPagesArchiveOpen] = React.useState(false)

  const suporte = withDuplicates(
    [
      ...suporteItems,
      ...(seeFinancials ? [{ to: '/nps', label: 'NPS', icon: Star }] : []),
    ].filter((item) => canSee(item.to) && isSupportPageVisible(item.to)),
    duplicatesByKey,
  )
  const leadPages = useLeadPages()
  const leadBoards = useLeadBoards()
  // Vendas e Contrato saíram do grupo "Comercial" e viraram subpáginas de "Financeiro" — a aba
  // continua sendo uma lead_page comum por trás, só não aparece mais duas vezes no menu.
  const financeiroPageIds = React.useMemo(
    () => new Set(leadBoards.filter((b) => b.isVendas || b.isContrato).map((b) => b.page)),
    [leadBoards],
  )
  const visibleComercialItems = canSee('/comercial')
    ? leadPages
        .filter((p) => !financeiroPageIds.has(p.id))
        .map((p) => ({ to: `/comercial/${p.id}`, label: p.name, icon: Contact, page: p }))
    : []
  const hasVendasBoard = leadBoards.some((b) => b.isVendas)
  const hasContratoBoard = leadBoards.some((b) => b.isContrato)
  const visibleFinanceiroItems = canSee('/comercial')
    ? [
        ...(hasVendasBoard ? [{ to: '/financeiro/vendas', label: 'Vendas', icon: ShoppingBag }] : []),
        ...(hasContratoBoard ? [{ to: '/financeiro/contrato', label: 'Contrato', icon: FileText }] : []),
        { to: '/financeiro/gestao-interna', label: 'Gestão Interna', icon: ClipboardList },
        { to: '/financeiro/contas-a-pagar', label: 'Contas a Pagar', icon: Wallet },
      ]
    : []
  // Numa cópia a URL é /visao/<id>, que não diz nada sobre qual grupo do menu destacar/abrir —
  // quem decide é a TELA de origem dela. Sem isso, abrir "Pipeline (cópia)" deixava o grupo
  // "Suporte" fechado e sem destaque, como se nada tivesse acontecido.
  const activePath = React.useMemo(() => {
    const match = location.pathname.match(/^\/visao\/(.+)$/)
    if (!match) return location.pathname
    const page = supportPages.find((p) => p.id === match[1])
    if (!page) return location.pathname
    return MENU_ACCESS_ITEMS.find((i) => i.key === page.sourceKey)?.path ?? location.pathname
  }, [location.pathname, supportPages])

  const suporteActive = SUPORTE_ROUTES.some((r) =>
    r === '/' ? activePath === '/' : activePath.startsWith(r),
  )

  // O grupo abre sozinho ao entrar numa cópia — o estado inicial não pode saber disso, porque
  // as páginas do Suporte ainda não carregaram na primeira renderização.
  React.useEffect(() => {
    if (suporteActive) setSuporteOpen(true)
  }, [suporteActive])

  const secondaryItems = withDuplicates(
    [
      ...(isAdmin
        ? [{ to: '/kb', label: 'Conhecimento', icon: BookOpen }]
        : []),
      ...(isAdmin
        ? [{ to: '/users', label: 'Equipe', icon: ShieldCheck }]
        : []),
      ...(isAdmin
        ? [{ to: '/auditoria', label: 'Auditoria', icon: FileSearch }]
        : []),
      { to: '/settings', label: 'Configurações', icon: Settings },
    ].filter((item) => canSee(item.to) && isSupportPageVisible(item.to)),
    duplicatesByKey,
  )

  // Movidos para "Arquivados" (acessíveis, fora do caminho do dia a dia).
  const archivedItems = withDuplicates(
    [
      { to: '/arquivados', label: 'Clientes arquivados', icon: Archive },
      { to: '/tickets', label: 'Tickets', icon: MessageCircle },
      ...(seeFinancials
        ? [
            { to: '/comando', label: 'Comando', icon: Zap },
            { to: '/financeiro', label: 'Financeiro', icon: Wallet },
          ]
        : []),
      { to: '/templates', label: 'Templates', icon: MessageSquare },
      ...(isAdmin ? [{ to: '/equipe', label: 'Performance', icon: Trophy }] : []),
    ].filter((item) => canSee(item.to) && isSupportPageVisible(item.to)),
    duplicatesByKey,
  )

  return (
    <aside
      className={cn(
        'fixed left-0 top-0 z-40 flex h-screen w-[220px] flex-col border-r border-line bg-sidebar transition-transform duration-200 ease-out',
        open ? 'translate-x-0' : '-translate-x-full',
      )}
    >
      <div className="flex items-center gap-2 px-5 py-5">
        <img src={logoNx} alt="Grupo NX Digital" className="h-8 w-8 shrink-0 rounded-lg object-cover" />
        <div className="flex flex-col leading-tight">
          <span className="text-sm font-semibold text-foreground">GRUPO NX DIGITAL</span>
          <span className="text-[10px] uppercase tracking-wider text-foreground/40">
            Painel interno
          </span>
        </div>
        <button
          type="button"
          onClick={onToggle}
          aria-label="Recolher menu"
          className="ml-auto grid h-7 w-7 shrink-0 place-items-center rounded-lg text-foreground/45 transition-colors hover:bg-elevate/[0.05] hover:text-foreground/80"
        >
          <PanelLeftClose className="h-4 w-4" />
        </button>
      </div>

      <nav className="mt-2 flex flex-1 flex-col gap-0.5 px-3">
        {/* Suporte — grupo expansível com subpáginas */}
        {suporte.length > 0 && (
        <>
        <button
          type="button"
          onClick={() => setSuporteOpen((o) => !o)}
          className={cn(
            'group flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-colors',
            suporteActive
              ? 'text-foreground'
              : 'text-foreground/55 hover:bg-elevate/[0.03] hover:text-foreground/90',
          )}
        >
          <LifeBuoy
            className={cn(
              'h-4 w-4 shrink-0',
              suporteActive ? 'text-accent' : 'text-foreground/50 group-hover:text-foreground/75',
            )}
          />
          <span>Suporte</span>
          <ChevronDown
            className={cn(
              'ml-auto h-3.5 w-3.5 shrink-0 transition-transform',
              suporteOpen ? '' : '-rotate-90',
            )}
          />
        </button>
        {suporteOpen &&
          suporte.map((item) => {
            const Icon = item.icon
            const badge =
              'badgeKey' in item && item.badgeKey === 'tasks' && myTasks > 0
                ? myTasks
                : null
            return (
              <NavLink
                key={item.pageId ?? item.to}
                to={item.to}
                end={'end' in item ? item.end : undefined}
                onClick={closeOnMobile}
                className={({ isActive }) =>
                  cn(
                    'group flex items-center gap-2.5 rounded-lg px-3 py-2 pl-5 text-sm transition-colors',
                    isActive
                      ? 'bg-elevate/[0.05] text-foreground'
                      : 'text-foreground/45 hover:bg-elevate/[0.03] hover:text-foreground/80',
                  )
                }
              >
                {({ isActive }) => (
                  <>
                    <Icon
                      className={cn(
                        'h-4 w-4 shrink-0',
                        isActive ? 'text-accent' : 'text-foreground/40 group-hover:text-foreground/70',
                      )}
                    />
                    <span className="truncate">{item.label}</span>
                    {badge !== null && (
                      <span className="ml-auto inline-flex h-5 min-w-[1.25rem] items-center justify-center rounded-full bg-danger px-1.5 text-[10px] font-semibold text-white">
                        {badge > 99 ? '99+' : badge}
                      </span>
                    )}
                    {isAdmin && item.pageId && item.pageId !== 'dashboard' && (
                      <SidebarPageMenu
                        pageId={item.pageId}
                        pageName={item.label}
                        sourceKey={item.sourceKey ?? item.pageId}
                      />
                    )}
                  </>
                )}
              </NavLink>
            )
          })}
        </>
        )}

        {/* Comercial — grupo expansível com subpáginas */}
        {visibleComercialItems.length > 0 && (
        <>
        <button
          type="button"
          onClick={() => setComercialOpen((o) => !o)}
          className={cn(
            'group flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-colors',
            location.pathname.startsWith('/comercial')
              ? 'text-foreground'
              : 'text-foreground/55 hover:bg-elevate/[0.03] hover:text-foreground/90',
          )}
        >
          <Briefcase
            className={cn(
              'h-4 w-4 shrink-0',
              location.pathname.startsWith('/comercial')
                ? 'text-accent'
                : 'text-foreground/50 group-hover:text-foreground/75',
            )}
          />
          <span>Comercial</span>
          {isAdmin && (
            <span
              role="button"
              tabIndex={0}
              onClick={(e) => { e.stopPropagation(); setNewPageOpen(true) }}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.stopPropagation(); setNewPageOpen(true) } }}
              title="Nova aba"
              className="ml-auto grid h-5 w-5 shrink-0 place-items-center rounded text-foreground/35 hover:bg-elevate/[0.06] hover:text-foreground/70"
            >
              <Plus className="h-3.5 w-3.5" />
            </span>
          )}
          <ChevronDown
            className={cn(
              'h-3.5 w-3.5 shrink-0 transition-transform',
              comercialOpen ? '' : '-rotate-90',
              isAdmin ? '' : 'ml-auto',
            )}
          />
        </button>
        {comercialOpen && (
          <>
            <NavLink
              to="/comercial-dashboard"
              onClick={closeOnMobile}
              className={({ isActive }) =>
                cn(
                  'group flex items-center gap-2.5 rounded-lg px-3 py-2 pl-5 text-sm transition-colors',
                  isActive
                    ? 'bg-elevate/[0.05] text-foreground'
                    : 'text-foreground/45 hover:bg-elevate/[0.03] hover:text-foreground/80',
                )
              }
            >
              {({ isActive }) => (
                <>
                  <LayoutDashboard
                    className={cn(
                      'h-4 w-4 shrink-0',
                      isActive ? 'text-accent' : 'text-foreground/35 group-hover:text-foreground/60',
                    )}
                  />
                  <span>Dashboard Comercial</span>
                </>
              )}
            </NavLink>
            {visibleComercialItems.map(({ to, label, icon: Icon }) => (
              <NavLink
                key={to}
                to={to}
                onClick={closeOnMobile}
                className={({ isActive }) =>
                  cn(
                    'group flex items-center gap-2.5 rounded-lg px-3 py-2 pl-5 text-sm transition-colors',
                    isActive
                      ? 'bg-elevate/[0.05] text-foreground'
                      : 'text-foreground/45 hover:bg-elevate/[0.03] hover:text-foreground/80',
                  )
                }
              >
                {({ isActive }) => (
                  <>
                    <Icon
                      className={cn(
                        'h-4 w-4 shrink-0',
                        isActive ? 'text-accent' : 'text-foreground/40 group-hover:text-foreground/70',
                      )}
                    />
                    <span>{label}</span>
                  </>
                )}
              </NavLink>
            ))}
          </>
        )}
        </>
        )}

        {/* Financeiro — grupo expansível com Vendas e Contrato */}
        {visibleFinanceiroItems.length > 0 && (
        <>
        <button
          type="button"
          onClick={() => setFinanceiroOpen((o) => !o)}
          className={cn(
            'group flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-colors',
            location.pathname.startsWith('/financeiro')
              ? 'text-foreground'
              : 'text-foreground/55 hover:bg-elevate/[0.03] hover:text-foreground/90',
          )}
        >
          <Wallet
            className={cn(
              'h-4 w-4 shrink-0',
              location.pathname.startsWith('/financeiro')
                ? 'text-accent'
                : 'text-foreground/50 group-hover:text-foreground/75',
            )}
          />
          <span>Financeiro</span>
          <ChevronDown
            className={cn(
              'ml-auto h-3.5 w-3.5 shrink-0 transition-transform',
              financeiroOpen ? '' : '-rotate-90',
            )}
          />
        </button>
        {financeiroOpen && visibleFinanceiroItems.map(({ to, label, icon: Icon }) => (
          <NavLink
            key={to}
            to={to}
            onClick={closeOnMobile}
            className={({ isActive }) =>
              cn(
                'group flex items-center gap-2.5 rounded-lg px-3 py-2 pl-5 text-sm transition-colors',
                isActive
                  ? 'bg-elevate/[0.05] text-foreground'
                  : 'text-foreground/45 hover:bg-elevate/[0.03] hover:text-foreground/80',
              )
            }
          >
            {({ isActive }) => (
              <>
                <Icon
                  className={cn(
                    'h-4 w-4 shrink-0',
                    isActive ? 'text-accent' : 'text-foreground/40 group-hover:text-foreground/70',
                  )}
                />
                <span>{label}</span>
              </>
            )}
          </NavLink>
        ))}
        </>
        )}

        {(secondaryItems.length > 0 || archivedItems.length > 0) && (
        <>
        <div className="my-2 h-px bg-elevate/[0.05]" />

        {secondaryItems.map(({ to, label, icon: Icon, pageId, sourceKey }) => (
          <NavLink
            key={pageId ?? to}
            to={to}
            onClick={closeOnMobile}
            className={({ isActive }) =>
              cn(
                'group flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-colors',
                isActive
                  ? 'bg-elevate/[0.05] text-foreground'
                  : 'text-foreground/55 hover:bg-elevate/[0.03] hover:text-foreground/90',
              )
            }
          >
            {({ isActive }) => (
              <>
                <Icon
                  className={cn(
                    'h-4 w-4 shrink-0',
                    isActive
                      ? 'text-accent'
                      : 'text-foreground/50 group-hover:text-foreground/75',
                  )}
                />
                <span className="truncate">{label}</span>
                {isAdmin && pageId && (
                  <SidebarPageMenu pageId={pageId} pageName={label} sourceKey={sourceKey ?? pageId} />
                )}
              </>
            )}
          </NavLink>
        ))}

        {/* Arquivados — recolhido por padrão */}
        {archivedItems.length > 0 && (
          <>
            <div className="my-2 h-px bg-elevate/[0.05]" />
            <button
              type="button"
              onClick={() => setArchivedOpen((o) => !o)}
              className="flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-medium uppercase tracking-wider text-foreground/40 transition-colors hover:bg-elevate/[0.03] hover:text-foreground/70"
            >
              <Archive className="h-3.5 w-3.5 shrink-0" />
              <span>Arquivados</span>
              <ChevronDown
                className={cn(
                  'ml-auto h-3.5 w-3.5 transition-transform',
                  archivedOpen ? '' : '-rotate-90',
                )}
              />
            </button>
            {archivedOpen &&
              archivedItems.map(({ to, label, icon: Icon, pageId, sourceKey }) => (
                <NavLink
                  key={pageId ?? to}
                  to={to}
                  onClick={closeOnMobile}
                  className={({ isActive }) =>
                    cn(
                      'group flex items-center gap-2.5 rounded-lg px-3 py-2 pl-5 text-sm transition-colors',
                      isActive
                        ? 'bg-elevate/[0.05] text-foreground'
                        : 'text-foreground/45 hover:bg-elevate/[0.03] hover:text-foreground/80',
                    )
                  }
                >
                  {({ isActive }) => (
                    <>
                      <Icon
                        className={cn(
                          'h-4 w-4 shrink-0',
                          isActive ? 'text-accent' : 'text-foreground/40 group-hover:text-foreground/70',
                        )}
                      />
                      <span className="truncate">{label}</span>
                      {isAdmin && pageId && (
                        <SidebarPageMenu pageId={pageId} pageName={label} sourceKey={sourceKey ?? pageId} />
                      )}
                    </>
                  )}
                </NavLink>
              ))}
            {archivedOpen && isAdmin && (
              <button
                type="button"
                onClick={() => setPagesArchiveOpen(true)}
                className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 pl-5 text-sm text-foreground/45 transition-colors hover:bg-elevate/[0.03] hover:text-foreground/80"
              >
                <Briefcase className="h-4 w-4 shrink-0 text-foreground/40" />
                <span>Abas do Comercial</span>
              </button>
            )}
            {archivedOpen && isAdmin && (
              <button
                type="button"
                onClick={() => setSupportArchiveOpen(true)}
                className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 pl-5 text-sm text-foreground/45 transition-colors hover:bg-elevate/[0.03] hover:text-foreground/80"
              >
                <LifeBuoy className="h-4 w-4 shrink-0 text-foreground/40" />
                <span>Abas do Suporte</span>
              </button>
            )}
          </>
        )}
        </>
        )}
      </nav>

      <div className="border-t border-line p-3 space-y-1">
        <div className="mb-2">
          <ServerSwitcher />
        </div>

        {/* Usuário */}
        <div className="flex items-center gap-2 rounded-lg px-2 py-1.5">
          <div className="grid h-7 w-7 place-items-center rounded-full bg-elevate/[0.05] text-foreground/70 ring-1 ring-line">
            <UserCircle2 className="h-4 w-4" />
          </div>
          <div className="min-w-0 leading-tight">
            <div className="truncate text-xs font-medium text-foreground/90">
              {profile?.name || profile?.email || '—'}
            </div>
            <div className="text-[10px] uppercase tracking-wider text-foreground/50">
              {profile ? ROLE_LABELS[profile.role] : '…'}
            </div>
          </div>
        </div>

        {/* Tema */}
        <button
          onClick={() => {
            const next = theme === 'dark' ? 'light' : 'dark'
            setTheme(next)
            void saveOwnTheme(next)
          }}
          className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-sm text-foreground/65 transition-colors hover:bg-elevate/[0.04] hover:text-foreground"
        >
          {theme === 'dark'
            ? <Sun className="h-4 w-4 shrink-0" />
            : <Moon className="h-4 w-4 shrink-0" />}
          <span>{theme === 'dark' ? 'Tema claro' : 'Tema escuro'}</span>
        </button>

        {/* Sair */}
        <button
          onClick={onLogout}
          className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-sm text-foreground/65 transition-colors hover:bg-elevate/[0.04] hover:text-foreground"
        >
          <LogOut className="h-4 w-4 shrink-0" />
          Sair
        </button>

        {/* Versão */}
        <div className="pt-1 text-center text-[10px] text-foreground/30 select-none">
          v{__APP_VERSION__}
        </div>
      </div>

      <NewComercialPageModal
        open={newPageOpen}
        onClose={() => setNewPageOpen(false)}
        onCreated={(id) => { navigate(`/comercial/${id}`); closeOnMobile() }}
      />
      <ArchivedComercialPagesModal open={pagesArchiveOpen} onClose={() => setPagesArchiveOpen(false)} />
      <ArchivedSupportPagesModal open={supportArchiveOpen} onClose={() => setSupportArchiveOpen(false)} />
    </aside>
  )
}

/** "..." de um item do menu Suporte — admin only. "Duplicar" cria uma segunda entrada no menu
 * com nome próprio, mas que abre a MESMA tela do original (essas telas não são um container
 * genérico como o Comercial, então uma cópia não tem dados independentes — é um atalho nomeado
 * pra mesma rota, útil pra organizar/rotular sem duplicar nada por trás). */
function SidebarPageMenu({
  pageId,
  pageName,
  sourceKey,
}: {
  pageId: string
  pageName: string
  /** Tela de origem — define quais filtros o modal de duplicar oferece. */
  sourceKey: string
}) {
  const [open, setOpen] = React.useState(false)
  const [coords, setCoords] = React.useState<{ top: number; left: number } | null>(null)
  const [duplicateOpen, setDuplicateOpen] = React.useState(false)
  const [editViewOpen, setEditViewOpen] = React.useState(false)
  const [renameOpen, setRenameOpen] = React.useState(false)
  // Só cópia tem visão própria pra editar — o item de origem define o padrão da tela.
  const pages = useSupportPages()
  const page = pages.find((p) => p.id === pageId)
  const isCopy = page ? isSupportCopy(page) : false
  const btnRef = React.useRef<HTMLButtonElement>(null)
  const popRef = React.useRef<HTMLDivElement>(null)
  useOutsideClose(popRef, open, () => setOpen(false))

  const openMenu = (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    const rect = btnRef.current?.getBoundingClientRect()
    if (rect) setCoords({ top: rect.bottom + 4, left: Math.min(rect.left, window.innerWidth - 180) })
    setOpen((o) => !o)
  }

  const excluir = async (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    if (!window.confirm(`Arquivar "${pageName}"? Some do menu, mas fica salva pra restaurar depois.`)) return
    setOpen(false)
    try {
      await supportPagesService.archive(pageId)
      toast.success(`"${pageName}" arquivada.`)
    } catch (err) {
      toast.error('Falha ao arquivar: ' + (err as Error).message)
    }
  }

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        onClick={openMenu}
        title="Mais opções"
        className="ml-auto shrink-0 rounded p-1 text-foreground/40 opacity-0 transition-opacity hover:bg-elevate/[0.08] hover:text-foreground/80 group-hover:opacity-100"
      >
        <MoreHorizontal className="h-3.5 w-3.5" />
      </button>
      {open && coords && createPortal(
        <div
          ref={popRef}
          style={{ position: 'fixed', top: coords.top, left: coords.left }}
          className="z-50 w-44 rounded-lg border border-line bg-card p-1 shadow-xl"
        >
          <button
            type="button"
            onClick={(e) => { e.preventDefault(); e.stopPropagation(); setOpen(false); setDuplicateOpen(true) }}
            className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs text-foreground/80 hover:bg-elevate/[0.06]"
          >
            <Copy className="h-3.5 w-3.5" />
            Duplicar
          </button>
          <button
            type="button"
            onClick={(e) => { e.preventDefault(); e.stopPropagation(); setOpen(false); setRenameOpen(true) }}
            className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs text-foreground/80 hover:bg-elevate/[0.06]"
          >
            <Pencil className="h-3.5 w-3.5" />
            Renomear
          </button>
          {isCopy && supportViewFields(sourceKey).length > 0 && (
            <button
              type="button"
              onClick={(e) => { e.preventDefault(); e.stopPropagation(); setOpen(false); setEditViewOpen(true) }}
              className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs text-foreground/80 hover:bg-elevate/[0.06]"
            >
              <SlidersHorizontal className="h-3.5 w-3.5" />
              Editar visão
            </button>
          )}
          <button
            type="button"
            onClick={excluir}
            className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs text-danger hover:bg-danger/10"
          >
            <Trash2 className="h-3.5 w-3.5" />
            Excluir aba
          </button>
        </div>,
        document.body,
      )}
      {/* Este menu vive DENTRO do <NavLink> do item, e os modais abrem por portal. Portal tira o
          DOM de dentro do link, mas o evento do React continua subindo pela árvore de componentes
          — sem parar aqui, cada clique no modal chegava ao NavLink e virava navegação, o que
          travava os radios de "O que duplicar" na primeira opção. Segurar na borda cobre tudo que
          está dentro dos modais de uma vez (radios, checkboxes, selects, inputs e botões). */}
      <span onClick={(e) => e.stopPropagation()}>
        <DuplicateSupportPageModal
          open={duplicateOpen}
          onClose={() => setDuplicateOpen(false)}
          sourceId={pageId}
          sourceName={pageName}
          sourceKey={sourceKey}
          initialConfig={page?.viewConfig ?? {}}
        />
        <RenameSupportPageModal
          open={renameOpen}
          onClose={() => setRenameOpen(false)}
          pageId={pageId}
          currentName={pageName}
        />
        {isCopy && page && (
          <EditSupportViewModal
            open={editViewOpen}
            onClose={() => setEditViewOpen(false)}
            pageId={page.id}
            pageName={page.name}
            sourceKey={page.sourceKey}
            current={page.viewConfig}
          />
        )}
      </span>
    </>
  )
}

/**
 * Estado dos campos de visão (o que a cópia mostra) — compartilhado por "Duplicar" e "Editar
 * visão". Só o que estiver marcado vira view_config; o resto a tela resolve com o padrão dela.
 */
function useViewFieldsState(sourceKey: string, initial: Record<string, string>, open: boolean) {
  const fields = React.useMemo(() => supportViewFields(sourceKey), [sourceKey])
  const [enabled, setEnabled] = React.useState<Set<string>>(new Set())
  const [values, setValues] = React.useState<Record<string, string>>({})

  // Reabrir recomeça do que está salvo — sem isso o modal guardaria a edição abandonada.
  React.useEffect(() => {
    if (!open) return
    setEnabled(new Set(fields.filter((f) => initial[f.key] !== undefined).map((f) => f.key)))
    setValues(Object.fromEntries(fields.map((f) => [f.key, initial[f.key] ?? f.default])))
    // `initial` vem de objeto novo a cada render do pai; a dependência real é abrir/fechar.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, fields])

  const toggle = (key: string) => {
    setEnabled((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  const build = (): Record<string, string> => {
    const config: Record<string, string> = {}
    for (const field of fields) {
      if (!enabled.has(field.key)) continue
      const value = values[field.key] ?? ''
      if (value.trim() !== '') config[field.key] = value.trim()
    }
    return config
  }

  return { fields, enabled, setEnabled, values, setValues, toggle, build }
}

/** Lista de filtros marcáveis de uma tela — o "o que você quer duplicar daquilo". */
function ViewFieldsEditor({
  fields,
  enabled,
  setEnabled,
  values,
  setValues,
  toggle,
  emptyHint,
}: {
  fields: SupportViewField[]
  enabled: Set<string>
  setEnabled: (next: Set<string>) => void
  values: Record<string, string>
  setValues: React.Dispatch<React.SetStateAction<Record<string, string>>>
  toggle: (key: string) => void
  emptyHint: string
}) {
  if (fields.length === 0) return null
  return (
    <div className="mt-4">
      <div className="mb-2 flex items-center justify-between">
        <label className="text-xs font-medium text-foreground/70">O que essa aba deve mostrar</label>
        <button
          type="button"
          onClick={() => setEnabled(enabled.size === fields.length ? new Set() : new Set(fields.map((f) => f.key)))}
          className="text-[11px] text-accent hover:underline"
        >
          {enabled.size === fields.length ? 'Desmarcar todos' : 'Marcar todos'}
        </button>
      </div>
      <div className="max-h-64 space-y-2 overflow-y-auto rounded-lg border border-line p-2">
        {fields.map((field) => {
          const on = enabled.has(field.key)
          return (
            <div key={field.key} className="rounded-md px-1 py-1">
              <label className="flex items-center gap-2 text-xs text-foreground/80">
                <input
                  type="checkbox"
                  checked={on}
                  onChange={() => toggle(field.key)}
                  className="h-3.5 w-3.5 accent-accent"
                />
                {field.label}
              </label>
              {on && (
                <div className="mt-1.5 pl-5">
                  {field.type === 'select' ? (
                    <select
                      value={values[field.key] ?? field.default}
                      onChange={(e) => setValues((v) => ({ ...v, [field.key]: e.target.value }))}
                      className="h-8 w-full rounded-lg border border-line bg-elevate/[0.04] px-2 text-xs text-foreground/80 outline-none focus:border-accent/40"
                    >
                      {field.options?.map((o) => (
                        <option key={o.value} value={o.value}>{o.label}</option>
                      ))}
                    </select>
                  ) : (
                    <input
                      type="text"
                      value={values[field.key] ?? ''}
                      placeholder={field.placeholder}
                      onChange={(e) => setValues((v) => ({ ...v, [field.key]: e.target.value }))}
                      className="h-8 w-full rounded-lg border border-line bg-elevate/[0.04] px-2 text-xs text-foreground/80 outline-none focus:border-accent/40"
                    />
                  )}
                  {field.hint && <p className="mt-1 text-[11px] text-foreground/45">{field.hint}</p>}
                </div>
              )}
            </div>
          )
        })}
      </div>
      <p className="mt-2 text-[11px] text-foreground/45">{emptyHint}</p>
    </div>
  )
}

const DUPLICATE_MODES: { value: SupportDuplicateMode; label: string; hint: string }[] = [
  {
    value: 'full',
    label: 'Com tudo',
    hint: 'Os quadros e os clientes de hoje, já distribuídos. Os clientes são os mesmos — mover ou editar aqui não duplica ninguém no sistema.',
  },
  {
    value: 'structure',
    label: 'Só os quadros',
    hint: 'As mesmas colunas, sem nenhum cliente. Você adiciona quem quiser depois.',
  },
  {
    value: 'view',
    label: 'Só um recorte',
    hint: 'Sem quadros próprios: abre a tela original filtrada do jeito que você escolher abaixo.',
  },
]

/**
 * "Duplicar" um item do Suporte — admin only.
 *
 * Pergunta o nome E o que a cópia deve mostrar: cada tela expõe seus próprios filtros/modo de
 * exibição em SUPPORT_VIEW_FIELDS, e só o que for marcado é salvo na visão da cópia. É isso que
 * faz "Pipeline (entregas do Arthur)" ser uma tela diferente de "Pipeline", e não um atalho
 * repetido. Ao terminar, navega pra cópia — antes ela era criada e você continuava onde estava,
 * que é o que dava a impressão de que "duplicar não abriu".
 */
function DuplicateSupportPageModal({
  open,
  onClose,
  sourceId,
  sourceName,
  sourceKey,
  initialConfig,
}: {
  open: boolean
  onClose: () => void
  sourceId: string
  sourceName: string
  sourceKey: string
  /** Duplicar uma cópia parte dos filtros dela; a partir do item de origem, começa do padrão. */
  initialConfig: Record<string, string>
}) {
  const navigate = useNavigate()
  const [name, setName] = React.useState('')
  const [mode, setMode] = React.useState<SupportDuplicateMode>('view')
  const [saving, setSaving] = React.useState(false)
  const view = useViewFieldsState(sourceKey, initialConfig, open)
  // Só o Pipeline sabe se desenhar a partir das etapas da cópia, saindo igual à tela original.
  // Nas outras, oferecer "com tudo" entregaria um layout diferente do que a pessoa duplicou —
  // então nem mostramos a escolha (o back também cai pra 'view' se vier forçado).
  const stageable = sourceKey === 'pipeline'

  React.useEffect(() => {
    if (!open) return
    setName(`${sourceName} (cópia)`)
    setMode(stageable ? 'full' : 'view')
  }, [open, sourceName, stageable])

  const submit = async () => {
    const trimmed = name.trim()
    if (!trimmed) return
    setSaving(true)
    try {
      const page = await supportPagesService.duplicate(
        sourceId,
        trimmed,
        mode,
        mode === 'view' ? view.build() : undefined,
      )
      const summary = mode === 'view' ? describeSupportView(page.sourceKey, page.viewConfig) : ''
      toast.success(
        mode === 'full'
          ? `"${page.name}" criada com os quadros e os clientes de hoje.`
          : mode === 'structure'
            ? `"${page.name}" criada só com os quadros, sem clientes.`
            : summary
              ? `"${page.name}" criada — ${summary}.`
              : `"${page.name}" criada.`,
      )
      onClose()
      navigate(`/visao/${page.id}`)
    } catch (err) {
      toast.error('Falha ao duplicar: ' + (err as Error).message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Duplicar aba"
      description={
        view.fields.length > 0
          ? `A cópia abre a mesma tela de "${sourceName}", com os filtros que você marcar aqui. Os dados são os mesmos — o que muda é o recorte.`
          : `A cópia abre a mesma tela de "${sourceName}". Essa tela não tem filtros para pré-configurar, então a cópia só ganha um nome próprio no menu.`
      }
      size="sm"
    >
      <Input
        label="Nome da cópia"
        value={name}
        onChange={(e) => setName(e.target.value)}
        autoFocus
        onKeyDown={(e) => { if (e.key === 'Enter' && !stageable && view.fields.length === 0) void submit() }}
      />

      {stageable && (
        <div className="mt-4">
          <label className="mb-2 block text-xs font-medium text-foreground/70">O que duplicar</label>
          <div className="space-y-1.5">
            {DUPLICATE_MODES.map((opt) => (
              <label
                key={opt.value}
                className={cn(
                  'flex cursor-pointer gap-2.5 rounded-lg border p-2.5 transition-colors',
                  mode === opt.value
                    ? 'border-accent/50 bg-accent/[0.06]'
                    : 'border-line hover:bg-elevate/[0.03]',
                )}
              >
                <input
                  type="radio"
                  name="duplicate-mode"
                  checked={mode === opt.value}
                  onChange={() => setMode(opt.value)}
                  className="mt-0.5 h-3.5 w-3.5 shrink-0 accent-accent"
                />
                <span>
                  <span className="block text-xs font-medium text-foreground/85">{opt.label}</span>
                  <span className="mt-0.5 block text-[11px] leading-snug text-foreground/50">{opt.hint}</span>
                </span>
              </label>
            ))}
          </div>
        </div>
      )}

      {mode === 'view' && <ViewFieldsEditor
        fields={view.fields}
        enabled={view.enabled}
        setEnabled={view.setEnabled}
        values={view.values}
        setValues={view.setValues}
        toggle={view.toggle}
        emptyHint={`Nada marcado = a cópia abre igual a "${sourceName}".`}
      />}
      <div className="mt-5 flex justify-end gap-2">
        <Button variant="ghost" onClick={onClose} disabled={saving}>Cancelar</Button>
        <Button onClick={submit} disabled={!name.trim()} loading={saving}>Duplicar</Button>
      </div>
    </Modal>
  )
}

/** Renomear um item do menu Suporte — admin only. Vale pro item de origem e pra cópia; o id (que
 * é a URL da cópia) nunca muda junto, senão links já compartilhados parariam de funcionar. */
function RenameSupportPageModal({
  open,
  onClose,
  pageId,
  currentName,
}: {
  open: boolean
  onClose: () => void
  pageId: string
  currentName: string
}) {
  const [name, setName] = React.useState('')
  const [saving, setSaving] = React.useState(false)

  React.useEffect(() => { if (open) setName(currentName) }, [open, currentName])

  const submit = async () => {
    const trimmed = name.trim()
    if (!trimmed || trimmed === currentName) { onClose(); return }
    setSaving(true)
    try {
      const page = await supportPagesService.rename(pageId, trimmed)
      toast.success(`Agora chama "${page.name}".`)
      onClose()
    } catch (err) {
      toast.error('Falha ao renomear: ' + (err as Error).message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Renomear" size="sm">
      <Input
        label="Nome"
        value={name}
        onChange={(e) => setName(e.target.value)}
        autoFocus
        onKeyDown={(e) => { if (e.key === 'Enter') void submit() }}
      />
      <div className="mt-5 flex justify-end gap-2">
        <Button variant="ghost" onClick={onClose} disabled={saving}>Cancelar</Button>
        <Button onClick={submit} disabled={!name.trim()} loading={saving}>Salvar</Button>
      </div>
    </Modal>
  )
}

/** "Editar visão" de uma cópia — admin only. Sem isso, corrigir um filtro exigiria apagar a cópia
 * e refazer. Não aparece no item de origem: mexer nele mudaria o padrão da tela pra todo mundo. */
function EditSupportViewModal({
  open,
  onClose,
  pageId,
  pageName,
  sourceKey,
  current,
}: {
  open: boolean
  onClose: () => void
  pageId: string
  pageName: string
  sourceKey: string
  current: Record<string, string>
}) {
  const [saving, setSaving] = React.useState(false)
  const view = useViewFieldsState(sourceKey, current, open)

  const submit = async () => {
    setSaving(true)
    try {
      const page = await supportPagesService.saveView(pageId, view.build())
      const summary = describeSupportView(page.sourceKey, page.viewConfig)
      toast.success(summary ? `"${page.name}" — ${summary}.` : `"${page.name}" voltou ao padrão da tela.`)
      onClose()
    } catch (err) {
      toast.error('Falha ao salvar: ' + (err as Error).message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Editar visão"
      description={`Define o recorte que "${pageName}" mostra ao abrir. Os dados são os mesmos da tela original.`}
      size="sm"
    >
      {view.fields.length === 0 ? (
        <p className="text-xs text-foreground/55">Essa tela não tem filtros para pré-configurar.</p>
      ) : (
        <ViewFieldsEditor
          fields={view.fields}
          enabled={view.enabled}
          setEnabled={view.setEnabled}
          values={view.values}
          setValues={view.setValues}
          toggle={view.toggle}
          emptyHint="Nada marcado = abre igual à tela original."
        />
      )}
      <div className="mt-5 flex justify-end gap-2">
        <Button variant="ghost" onClick={onClose} disabled={saving}>Cancelar</Button>
        <Button onClick={submit} loading={saving} disabled={view.fields.length === 0}>Salvar</Button>
      </div>
    </Modal>
  )
}

/** Itens do Suporte arquivados — admin only. Restaurar devolve pro menu na hora; a tela e os
 * dados dela nunca deixaram de existir, só ficaram escondidos. */
function ArchivedSupportPagesModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [loading, setLoading] = React.useState(false)
  const [pages, setPages] = React.useState<SupportPage[]>([])
  const [restoringId, setRestoringId] = React.useState<string | null>(null)

  React.useEffect(() => {
    if (!open) return
    setLoading(true)
    supportPagesService.getArchived()
      .then(setPages)
      .catch((err) => toast.error('Falha ao carregar abas arquivadas: ' + (err as Error).message))
      .finally(() => setLoading(false))
  }, [open])

  const restore = async (page: SupportPage) => {
    setRestoringId(page.id)
    try {
      await supportPagesService.restore(page.id)
      setPages((prev) => prev.filter((p) => p.id !== page.id))
      toast.success(`"${page.name}" restaurada.`)
    } catch (err) {
      toast.error('Falha ao restaurar: ' + (err as Error).message)
    } finally {
      setRestoringId(null)
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Abas do Suporte arquivadas" description="A tela e os dados continuam salvos — restaure se precisar." size="sm">
      {loading ? (
        <p className="py-6 text-center text-xs text-foreground/40">Carregando…</p>
      ) : pages.length === 0 ? (
        <p className="py-6 text-center text-xs text-foreground/40">Nenhuma aba arquivada.</p>
      ) : (
        <ul className="space-y-1.5">
          {pages.map((p) => (
            <li key={p.id} className="flex items-center justify-between gap-2 rounded-lg border border-line bg-elevate/[0.02] px-3 py-2">
              <span className="truncate text-sm text-foreground/85">{p.name}</span>
              <Button size="sm" variant="secondary" onClick={() => restore(p)} loading={restoringId === p.id} leftIcon={<RotateCcw className="h-3.5 w-3.5" />}>
                Restaurar
              </Button>
            </li>
          ))}
        </ul>
      )}
    </Modal>
  )
}

/** Nova aba do Comercial — admin only, cria vazia (sem quadro nenhum, dá pra montar depois). */
function NewComercialPageModal({
  open,
  onClose,
  onCreated,
}: {
  open: boolean
  onClose: () => void
  onCreated: (id: string) => void
}) {
  const [name, setName] = React.useState('')
  const [saving, setSaving] = React.useState(false)

  React.useEffect(() => { if (open) setName('') }, [open])

  const submit = async () => {
    const trimmed = name.trim()
    if (!trimmed) return
    setSaving(true)
    try {
      const page = await leadPagesService.create(trimmed)
      toast.success(`Aba "${page.name}" criada.`)
      onClose()
      onCreated(page.id)
    } catch (err) {
      toast.error('Falha ao criar aba: ' + (err as Error).message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Nova aba do Comercial" size="sm">
      <Input
        label="Nome da aba"
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Ex.: CRM NX Time 2"
        autoFocus
        onKeyDown={(e) => { if (e.key === 'Enter') void submit() }}
      />
      <div className="mt-5 flex justify-end gap-2">
        <Button variant="ghost" onClick={onClose} disabled={saving}>Cancelar</Button>
        <Button onClick={submit} disabled={!name.trim()} loading={saving}>Criar aba</Button>
      </div>
    </Modal>
  )
}

/** Abas arquivadas do Comercial — admin only. Restaurar devolve pro menu na hora; quadros e
 * leads da aba nunca foram apagados, só ficaram escondidos. */
function ArchivedComercialPagesModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [loading, setLoading] = React.useState(false)
  const [pages, setPages] = React.useState<LeadPage[]>([])
  const [restoringId, setRestoringId] = React.useState<string | null>(null)

  React.useEffect(() => {
    if (!open) return
    setLoading(true)
    leadPagesService.getArchived()
      .then(setPages)
      .catch((err) => toast.error('Falha ao carregar abas arquivadas: ' + (err as Error).message))
      .finally(() => setLoading(false))
  }, [open])

  const restore = async (page: LeadPage) => {
    setRestoringId(page.id)
    try {
      await leadPagesService.restore(page.id)
      setPages((prev) => prev.filter((p) => p.id !== page.id))
      toast.success(`"${page.name}" restaurada.`)
    } catch (err) {
      toast.error('Falha ao restaurar: ' + (err as Error).message)
    } finally {
      setRestoringId(null)
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Abas arquivadas" description="Os quadros e leads continuam salvos — restaure se precisar." size="sm">
      {loading ? (
        <p className="py-6 text-center text-xs text-foreground/40">Carregando…</p>
      ) : pages.length === 0 ? (
        <p className="py-6 text-center text-xs text-foreground/40">Nenhuma aba arquivada.</p>
      ) : (
        <ul className="space-y-1.5">
          {pages.map((p) => (
            <li key={p.id} className="flex items-center justify-between gap-2 rounded-lg border border-line bg-elevate/[0.02] px-3 py-2">
              <span className="truncate text-sm text-foreground/85">{p.name}</span>
              <Button size="sm" variant="secondary" onClick={() => restore(p)} loading={restoringId === p.id} leftIcon={<RotateCcw className="h-3.5 w-3.5" />}>
                Restaurar
              </Button>
            </li>
          ))}
        </ul>
      )}
    </Modal>
  )
}
