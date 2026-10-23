import { useLocation, Link } from 'react-router-dom'
import { ChevronRight } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useSupportView } from '@/components/support/SupportViewContext'

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
  followups: 'Follow-ups',
}

export interface TopBarProps {
  rightSlot?: React.ReactNode
  title?: string
  subtitle?: string
  /** Sobrescreve o tamanho padrão (text-base) do <h1> — ex.: "text-[36px]". */
  titleClassName?: string
  /** Fica ao lado do título (ex.: o seletor de abas do CRM ARTHUR | CRM IA LUIZA). */
  titleAddon?: React.ReactNode
  breadcrumbs?: { label: string; to?: string }[]
  /** No celular: sem migalhas e sem subtítulo, só o título e as ações numa linha. */
  compacto?: boolean
}

export function TopBar({ rightSlot, title, subtitle, titleClassName, titleAddon, breadcrumbs, compacto }: TopBarProps) {
  const location = useLocation()
  const parts = location.pathname.split('/').filter(Boolean)
  // Numa cópia do menu Suporte a URL é /visao/<id>, que viraria um breadcrumb "visao / a1b2c3".
  // Mostra o nome da cópia — é o que confirma pro usuário que ele abriu a cópia, e não a original.
  const supportView = useSupportView()

  const computedCrumbs =
    breadcrumbs ??
    (supportView
      ? [
          { label: 'Grupo NX Digital', to: '/' },
          { label: supportView.pageName },
        ]
      : [
          { label: 'Grupo NX Digital', to: '/' },
          ...parts.map((p, i) => {
            const path = '/' + parts.slice(0, i + 1).join('/')
            return { label: labels[p] || p, to: path }
          }),
        ])

  const heading =
    title ??
    (parts.length === 0 ? 'Dashboard' : labels[parts[0]] ?? 'Página')

  return (
    <header className="sticky top-0 z-20 border-b border-line bg-bg/85 backdrop-blur-md">
      {/* No celular, se as ações não couberem ao lado do título, descem pra uma segunda linha (antes vazavam da tela).
          O compacto continua numa linha só: há páginas com abas grudadas logo abaixo dele (top-[57px]). */}
      <div
        className={cn(
          'flex min-h-14 items-center justify-between gap-x-3 gap-y-1.5 py-1.5 pl-16 pr-4 sm:flex-nowrap sm:gap-4 lg:px-8',
          !compacto && 'flex-wrap',
        )}
      >
        <div className={cn('flex-1', compacto ? 'min-w-0' : 'min-w-[9rem] sm:min-w-0')}>
          <nav className={cn('items-center gap-1 text-xs text-foreground/40', compacto ? 'hidden sm:flex' : 'flex')}>
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
          <div className={cn('mt-0.5 flex items-baseline gap-2', titleAddon && 'flex-wrap gap-y-1')}>
            <h1 className={cn('text-foreground truncate', titleClassName ?? 'text-base font-semibold')}>{heading}</h1>
            {titleAddon}
            {subtitle && <span className={cn('text-xs text-foreground/40', compacto && 'hidden sm:inline')}>{subtitle}</span>}
          </div>
        </div>
        {rightSlot && <div className="max-w-full shrink-0">{rightSlot}</div>}
      </div>
    </header>
  )
}
