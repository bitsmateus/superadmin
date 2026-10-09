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
  breadcrumbs?: { label: string; to?: string }[]
  /** No celular: sem subtítulo, só o título e as ações (as migalhas já somem no celular em toda página). */
  compacto?: boolean
}

export function TopBar({ rightSlot, title, subtitle, titleClassName, breadcrumbs, compacto }: TopBarProps) {
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
      {/* No celular as ações vão pra uma linha própria embaixo do título (quebrando em várias se
       * precisar) — lado a lado elas empurravam a página pra fora da tela e o navegador encolhia
       * tudo pra caber. Do sm pra cima continua igual: título à esquerda, ações à direita. */}
      <div className="flex min-h-14 items-center justify-between gap-3 py-1.5 pl-16 pr-4 max-sm:flex-wrap max-sm:gap-y-2 max-sm:py-2 sm:gap-4 lg:px-8">
        <div className="min-w-0 flex-1">
          {/* Migalhas só do sm pra cima: no celular o cabeçalho é fixo no topo e cada linha a mais
           * come a tela; pra navegar já tem o menu. */}
          <nav className="hidden items-center gap-1 text-xs text-foreground/40 sm:flex">
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
          <div className="mt-0.5 flex items-baseline gap-2 max-sm:mt-0 max-sm:flex-wrap max-sm:gap-y-0">
            <h1 className={cn('text-foreground truncate max-sm:max-w-full', titleClassName ?? 'text-base font-semibold')}>{heading}</h1>
            {subtitle && <span className={cn('text-xs text-foreground/40', compacto && 'hidden sm:inline')}>{subtitle}</span>}
          </div>
        </div>
        {rightSlot && (
          <div className="shrink-0 max-sm:-ml-12 max-sm:min-w-0 max-sm:basis-[calc(100%+3rem)] max-sm:[&>*]:flex-wrap">
            {rightSlot}
          </div>
        )}
      </div>
    </header>
  )
}
