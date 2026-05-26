import { NavLink, useNavigate } from 'react-router-dom'
import {
  BookOpen,
  Building2,
  Columns3,
  FileSearch,
  LayoutDashboard,
  LogOut,
  MessageCircle,
  MessageSquare,
  Moon,
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
import { useUnreadTicketsCount } from '@/hooks/useTickets'
import { useTheme } from '@/hooks/useTheme'
import { ServerSwitcher } from './ServerSwitcher'

const primaryItems = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard, end: true },
  { to: '/pipeline', label: 'Pipeline', icon: Columns3 },
  { to: '/clients', label: 'Clientes', icon: Users },
  { to: '/tenants', label: 'Tenants', icon: Building2 },
  { to: '/tickets', label: 'Tickets', icon: MessageCircle, badgeKey: 'tickets' as const },
]

const ROLE_LABELS = {
  admin: 'Administrador',
  supervisor: 'Supervisor',
  suporte: 'Suporte',
} as const

export function Sidebar() {
  const navigate = useNavigate()
  const { profile } = useAuth()
  const [theme, setTheme] = useTheme()

  const onLogout = async () => {
    await signOut()
    navigate('/login', { replace: true })
  }

  const isAdmin = canManageUsers(profile?.role)
  const seeFinancials = canSeeFinancials(profile?.role)
  const unreadTickets = useUnreadTicketsCount()

  const primary = [
    ...primaryItems,
    ...(seeFinancials
      ? [
          { to: '/comando', label: 'Comando', icon: Zap },
          { to: '/financeiro', label: 'Financeiro', icon: Wallet },
          { to: '/nps', label: 'NPS', icon: Star },
        ]
      : []),
  ]

  const secondaryItems = [
    { to: '/templates', label: 'Templates', icon: MessageSquare },
    ...(isAdmin
      ? [{ to: '/kb', label: 'Conhecimento', icon: BookOpen }]
      : []),
    ...(isAdmin
      ? [{ to: '/equipe', label: 'Performance', icon: Trophy }]
      : []),
    ...(isAdmin
      ? [{ to: '/users', label: 'Equipe', icon: ShieldCheck }]
      : []),
    ...(isAdmin
      ? [{ to: '/auditoria', label: 'Auditoria', icon: FileSearch }]
      : []),
    { to: '/settings', label: 'Configurações', icon: Settings },
  ]

  return (
    <aside className="fixed left-0 top-0 z-30 flex h-screen w-[220px] flex-col border-r border-line bg-sidebar">
      <div className="flex items-center gap-2 px-5 py-5">
        <div className="grid h-8 w-8 place-items-center rounded-lg bg-accent/15 ring-1 ring-accent/30">
          <span className="text-accent font-bold leading-none">T</span>
        </div>
        <div className="flex flex-col leading-tight">
          <span className="text-sm font-semibold text-foreground">TenantHub</span>
          <span className="text-[10px] uppercase tracking-wider text-foreground/40">
            Painel interno
          </span>
        </div>
      </div>

      <nav className="mt-2 flex flex-1 flex-col gap-0.5 px-3">
        {primary.map((item) => {
          const Icon = item.icon
          const badge =
            'badgeKey' in item && item.badgeKey === 'tickets' && unreadTickets > 0
              ? unreadTickets
              : null
          return (
            <NavLink
              key={item.to}
              to={item.to}
              end={'end' in item ? item.end : undefined}
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

        <div className="my-2 h-px bg-elevate/[0.05]" />

        {secondaryItems.map(({ to, label, icon: Icon }) => (
          <NavLink
            key={to}
            to={to}
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
      </nav>

      <div className="border-t border-line p-3">
        <div className="mb-3">
          <ServerSwitcher />
        </div>
        <div className="mb-2 flex items-center gap-2 rounded-lg px-2 py-1.5">
          <div className="grid h-7 w-7 place-items-center rounded-full bg-elevate/[0.05] text-foreground/70 ring-1 ring-line">
            <UserCircle2 className="h-4 w-4" />
          </div>
          <div className="min-w-0 leading-tight">
            <div className="truncate text-xs font-medium text-foreground/90">
              {profile?.name || profile?.email || '—'}
            </div>
            <div className="text-[10px] uppercase tracking-wider text-foreground/40">
              {profile ? ROLE_LABELS[profile.role] : '…'}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={onLogout}
            className="flex flex-1 items-center gap-2.5 rounded-lg px-3 py-2 text-sm text-foreground/55 transition-colors hover:bg-elevate/[0.04] hover:text-foreground"
          >
            <LogOut className="h-4 w-4" />
            Sair
          </button>
          <button
            onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
            title={theme === 'dark' ? 'Tema claro' : 'Tema escuro'}
            className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-foreground/45 transition-colors hover:bg-elevate/[0.05] hover:text-foreground/80"
          >
            {theme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
          </button>
        </div>
      </div>
    </aside>
  )
}
