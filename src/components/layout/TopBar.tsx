import { useLocation, Link } from 'react-router-dom'
import { ChevronRight } from 'lucide-react'

const labels: Record<string, string> = {
  '': 'Dashboard',
  tenants: 'Tenants',
  clients: 'Clientes',
  pipeline: 'Pipeline',
  financeiro: 'Financeiro',
  users: 'Equipe',
  settings: 'Configurações',
  briefing: 'Briefing',
  edit: 'Editar',
  comando: 'Centro de Comando',
  equipe: 'Performance',
  auditoria: 'Auditoria',
  tickets: 'Tickets',
  templates: 'Templates',
  kb: 'Conhecimento',
  nps: 'NPS',
}

export interface TopBarProps {
  rightSlot?: React.ReactNode
  title?: string
  subtitle?: string
  breadcrumbs?: { label: string; to?: string }[]
}

export function TopBar({ rightSlot, title, subtitle, breadcrumbs }: TopBarProps) {
  const location = useLocation()
  const parts = location.pathname.split('/').filter(Boolean)

  const computedCrumbs =
    breadcrumbs ??
    [
      { label: 'TenantHub', to: '/' },
      ...parts.map((p, i) => {
        const path = '/' + parts.slice(0, i + 1).join('/')
        return { label: labels[p] || p, to: path }
      }),
    ]

  const heading =
    title ??
    (parts.length === 0 ? 'Dashboard' : labels[parts[0]] ?? 'Página')

  return (
    <header className="sticky top-0 z-20 border-b border-line bg-bg/85 backdrop-blur-md">
      <div className="flex h-14 items-center justify-between gap-4 px-8">
        <div className="min-w-0 flex-1">
          <nav className="flex items-center gap-1 text-xs text-foreground/40">
            {computedCrumbs.map((c, i) => (
              <span key={i} className="flex items-center gap-1">
                {i > 0 && <ChevronRight className="h-3 w-3 text-foreground/25" />}
                {c.to ? (
                  <Link
                    to={c.to}
                    className="rounded px-1 hover:bg-elevate/[0.04] hover:text-foreground/70"
                  >
                    {c.label}
                  </Link>
                ) : (
                  <span className="px-1 text-foreground/70">{c.label}</span>
                )}
              </span>
            ))}
          </nav>
          <div className="mt-0.5 flex items-baseline gap-2">
            <h1 className="text-base font-semibold text-foreground truncate">{heading}</h1>
            {subtitle && <span className="text-xs text-foreground/40">{subtitle}</span>}
          </div>
        </div>
        {rightSlot && <div className="shrink-0">{rightSlot}</div>}
      </div>
    </header>
  )
}
