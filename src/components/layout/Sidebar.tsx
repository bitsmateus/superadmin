import { NavLink, useNavigate } from 'react-router-dom'
import {
  Building2,
  Columns3,
  LayoutDashboard,
  LogOut,
  Settings,
  ShieldCheck,
  UserCircle2,
  Users,
  Wallet,
} from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { signOut, useAuth } from '@/hooks/useAuth'
import { canManageUsers, canSeeFinancials } from '@/services/supabase'
import { ServerSwitcher } from './ServerSwitcher'

const primaryItems = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard, end: true },
  { to: '/pipeline', label: 'Pipeline', icon: Columns3 },
  { to: '/clients', label: 'Clientes', icon: Users },
  { to: '/tenants', label: 'Tenants', icon: Building2 },
]

const ROLE_LABELS = {
  admin: 'Administrador',
  supervisor: 'Supervisor',
  suporte: 'Suporte',
} as const

export function Sidebar() {
  const navigate = useNavigate()
  const { profile } = useAuth()

  const onLogout = async () => {
    const { error } = await signOut()
    if (error) toast.error('Falha ao sair: ' + error.message)
    navigate('/login', { replace: true })
  }

  const isAdmin = canManageUsers(profile?.role)
  const seeFinancials = canSeeFinancials(profile?.role)

  const primary = [
    ...primaryItems,
    ...(seeFinancials
      ? [{ to: '/financeiro', label: 'Financeiro', icon: Wallet }]
      : []),
  ]

  const secondaryItems = [
    ...(isAdmin
      ? [{ to: '/users', label: 'Equipe', icon: ShieldCheck }]
      : []),
    { to: '/settings', label: 'Configurações', icon: Settings },
  ]

  return (
    <aside className="fixed left-0 top-0 z-30 flex h-screen w-[220px] flex-col border-r border-white/[0.05] bg-sidebar">
      <div className="flex items-center gap-2 px-5 py-5">
        <div className="grid h-8 w-8 place-items-center rounded-lg bg-accent/15 ring-1 ring-accent/30">
          <span className="text-accent font-bold leading-none">T</span>
        </div>
        <div className="flex flex-col leading-tight">
          <span className="text-sm font-semibold text-white">TenantHub</span>
          <span className="text-[10px] uppercase tracking-wider text-white/40">
            Painel interno
          </span>
        </div>
      </div>

      <nav className="mt-2 flex flex-1 flex-col gap-0.5 px-3">
        {primary.map(({ to, label, icon: Icon, end }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            className={({ isActive }) =>
              cn(
                'group flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-colors',
                isActive
                  ? 'bg-white/[0.05] text-white'
                  : 'text-white/55 hover:bg-white/[0.03] hover:text-white/90',
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
                      : 'text-white/50 group-hover:text-white/75',
                  )}
                />
                <span>{label}</span>
              </>
            )}
          </NavLink>
        ))}

        <div className="my-2 h-px bg-white/[0.05]" />

        {secondaryItems.map(({ to, label, icon: Icon }) => (
          <NavLink
            key={to}
            to={to}
            className={({ isActive }) =>
              cn(
                'group flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-colors',
                isActive
                  ? 'bg-white/[0.05] text-white'
                  : 'text-white/55 hover:bg-white/[0.03] hover:text-white/90',
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
                      : 'text-white/50 group-hover:text-white/75',
                  )}
                />
                <span>{label}</span>
              </>
            )}
          </NavLink>
        ))}
      </nav>

      <div className="border-t border-white/[0.05] p-3">
        <div className="mb-3">
          <ServerSwitcher />
        </div>
        <div className="mb-2 flex items-center gap-2 rounded-lg px-2 py-1.5">
          <div className="grid h-7 w-7 place-items-center rounded-full bg-white/[0.05] text-white/70 ring-1 ring-line">
            <UserCircle2 className="h-4 w-4" />
          </div>
          <div className="min-w-0 leading-tight">
            <div className="truncate text-xs font-medium text-white/90">
              {profile?.name || profile?.email || '—'}
            </div>
            <div className="text-[10px] uppercase tracking-wider text-white/40">
              {profile ? ROLE_LABELS[profile.role] : '…'}
            </div>
          </div>
        </div>
        <button
          onClick={onLogout}
          className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-sm text-white/55 transition-colors hover:bg-white/[0.04] hover:text-white"
        >
          <LogOut className="h-4 w-4" />
          Sair
        </button>
      </div>
    </aside>
  )
}
