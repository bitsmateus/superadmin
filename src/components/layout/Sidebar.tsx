import { NavLink, useLocation, useNavigate } from 'react-router-dom'
import * as React from 'react'
import { toast } from 'sonner'
import {
  Archive,
  BookOpen,
  Briefcase,
  Building2,
  ChevronDown,
  Columns3,
  Contact,
  FileSearch,
  LayoutDashboard,
  LifeBuoy,
  ListTodo,
  LogOut,
  MessageCircle,
  MessageSquare,
  Moon,
  PanelLeftClose,
  Plus,
  Radio,
  RotateCcw,
  Settings,
  ShieldCheck,
  Star,
  Sun,
  Trophy,
  UserCircle2,
  Users,
  Wallet,
  Zap,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { signOut, useAuth } from '@/hooks/useAuth'
import { canManageUsers, canSeeFinancials } from '@/services/supabase'
import { useMyOpenTaskCount } from '@/hooks/useTickets'
import { useTheme } from '@/hooks/useTheme'
import { useLeadPages } from '@/hooks/useLeadPages'
import { MENU_KEY_BY_PATH } from '@/constants/menuAccess'
import { leadPagesService } from '@/services/leadPages'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import type { LeadPage } from '@/types/leadBoard'
import { ServerSwitcher } from './ServerSwitcher'

const suporteItems = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard, end: true },
  { to: '/tarefas', label: 'Suporte', icon: ListTodo, badgeKey: 'tasks' as const },
  { to: '/pipeline', label: 'Pipeline', icon: Columns3 },
  { to: '/clients', label: 'Clientes', icon: Users },
  { to: '/canais', label: 'Canais', icon: Radio },
  { to: '/tenants', label: 'Tenants', icon: Building2 },
]

const SUPORTE_ROUTES = ['/', '/tarefas', '/pipeline', '/clients', '/canais', '/tenants', '/nps']

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

  const [archivedOpen, setArchivedOpen] = React.useState(false)
  const [comercialOpen, setComercialOpen] = React.useState(() =>
    location.pathname.startsWith('/comercial'),
  )
  const [suporteOpen, setSuporteOpen] = React.useState(() =>
    SUPORTE_ROUTES.some((r) => (r === '/' ? location.pathname === '/' : location.pathname.startsWith(r))),
  )
  const [newPageOpen, setNewPageOpen] = React.useState(false)
  const [pagesArchiveOpen, setPagesArchiveOpen] = React.useState(false)

  const suporte = [
    ...suporteItems,
    ...(seeFinancials ? [{ to: '/nps', label: 'NPS', icon: Star }] : []),
  ].filter((item) => canSee(item.to))
  const leadPages = useLeadPages()
  const visibleComercialItems = canSee('/comercial')
    ? leadPages.map((p) => ({ to: `/comercial/${p.id}`, label: p.name, icon: Contact, page: p }))
    : []
  const suporteActive = SUPORTE_ROUTES.some((r) =>
    r === '/' ? location.pathname === '/' : location.pathname.startsWith(r),
  )

  const secondaryItems = [
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
  ].filter((item) => canSee(item.to))

  // Movidos para "Arquivados" (acessíveis, fora do caminho do dia a dia).
  const archivedItems = [
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
  ].filter((item) => canSee(item.to))

  return (
    <aside
      className={cn(
        'fixed left-0 top-0 z-40 flex h-screen w-[220px] flex-col border-r border-line bg-sidebar transition-transform duration-200 ease-out',
        open ? 'translate-x-0' : '-translate-x-full',
      )}
    >
      <div className="flex items-center gap-2 px-5 py-5">
        <div className="grid h-8 w-8 place-items-center rounded-lg bg-accent">
          <span className="text-[11px] font-extrabold leading-none tracking-tight text-white">NX</span>
        </div>
        <div className="flex flex-col leading-tight">
          <span className="text-sm font-semibold text-foreground">TenantHub</span>
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
          {myTasks > 0 && (
            <span className="ml-auto inline-flex h-5 min-w-[1.25rem] items-center justify-center rounded-full bg-danger px-1.5 text-[10px] font-semibold text-white">
              {myTasks > 99 ? '99+' : myTasks}
            </span>
          )}
          <ChevronDown
            className={cn(
              'h-3.5 w-3.5 shrink-0 transition-transform',
              suporteOpen ? '' : '-rotate-90',
              myTasks > 0 ? '' : 'ml-auto',
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
                key={item.to}
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
                    <span>{item.label}</span>
                    {badge !== null && (
                      <span className="ml-auto inline-flex h-5 min-w-[1.25rem] items-center justify-center rounded-full bg-danger px-1.5 text-[10px] font-semibold text-white">
                        {badge > 99 ? '99+' : badge}
                      </span>
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

        {(secondaryItems.length > 0 || archivedItems.length > 0) && (
        <>
        <div className="my-2 h-px bg-elevate/[0.05]" />

        {secondaryItems.map(({ to, label, icon: Icon }) => (
          <NavLink
            key={to}
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
                <span>{label}</span>
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
              archivedItems.map(({ to, label, icon: Icon }) => (
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
          onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
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
    </aside>
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
