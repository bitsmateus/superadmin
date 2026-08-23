import * as React from 'react'
import { Navigate, useParams } from 'react-router-dom'
import { Loader2 } from 'lucide-react'
import { SupportViewProvider } from '@/components/support/SupportViewContext'
import { SupportPageBoard } from '@/components/support/SupportPageBoard'
import { supportPagesService } from '@/services/supportPages'
import type { SupportPageStage } from '@/services/supportPages'
import { useSupportPages, useSupportPagesBooted } from '@/hooks/useSupportPages'
import { useAuth } from '@/hooks/useAuth'
import { MENU_ACCESS_ITEMS } from '@/constants/menuAccess'

/**
 * Rota das cópias do menu Suporte: /visao/<pageId>.
 *
 * A cópia não é uma tela nova — é a MESMA tela do item de origem (`sourceKey`) aberta com a visão
 * salva dela (filtros/modo de exibição). Ter rota própria é o que faz a cópia "abrir de verdade":
 * o NavLink dela fica ativo sozinho (antes, cópia e original apontavam pra mesma URL e os dois
 * acendiam juntos) e o React remonta a tela ao trocar de cópia, então os filtros novos entram.
 */

const DashboardPage = React.lazy(() =>
  import('./DashboardPage').then((m) => ({ default: m.DashboardPage })),
)
const SupportWorkspacePage = React.lazy(() =>
  import('./SupportWorkspacePage').then((m) => ({ default: m.SupportWorkspacePage })),
)
const PipelinePage = React.lazy(() =>
  import('./PipelinePage').then((m) => ({ default: m.PipelinePage })),
)
const ClientsPage = React.lazy(() =>
  import('./ClientsPage').then((m) => ({ default: m.ClientsPage })),
)
const CanaisPage = React.lazy(() =>
  import('./CanaisPage').then((m) => ({ default: m.CanaisPage })),
)
const TenantsPage = React.lazy(() =>
  import('./TenantsPage').then((m) => ({ default: m.TenantsPage })),
)
const SettingsPage = React.lazy(() =>
  import('./SettingsPage').then((m) => ({ default: m.SettingsPage })),
)
const ArchivedClientsPage = React.lazy(() =>
  import('./ArchivedClientsPage').then((m) => ({ default: m.ArchivedClientsPage })),
)
const TicketsPage = React.lazy(() =>
  import('./TicketsPage').then((m) => ({ default: m.TicketsPage })),
)
const TemplatesPage = React.lazy(() =>
  import('./TemplatesPage').then((m) => ({ default: m.TemplatesPage })),
)

/** sourceKey -> tela. Mesmas chaves de MENU_ACCESS_ITEMS / support_pages. */
const SCREEN_BY_SOURCE: Record<string, React.ComponentType> = {
  dashboard: DashboardPage,
  tarefas: SupportWorkspacePage,
  pipeline: PipelinePage,
  clientes: ClientsPage,
  canais: CanaisPage,
  tenants: TenantsPage,
  configuracoes: SettingsPage,
  arquivados: ArchivedClientsPage,
  tickets: TicketsPage,
  templates: TemplatesPage,
}

function Centered({ children }: { children: React.ReactNode }) {
  return <div className="grid min-h-[60vh] place-items-center text-sm text-foreground/55">{children}</div>
}

export function SupportViewPage() {
  const { pageId } = useParams<{ pageId: string }>()
  const pages = useSupportPages()
  const booted = useSupportPagesBooted()
  const { profile } = useAuth()

  const page = pages.find((p) => p.id === pageId)

  // Uma cópia criada com "Com tudo"/"Só os quadros" tem etapas próprias e vira um quadro de
  // verdade; criada com "Só um recorte", a lista vem vazia e ela renderiza a tela original
  // filtrada. `undefined` = ainda carregando (não dá pra decidir qual das duas ainda).
  const [stages, setStages] = React.useState<SupportPageStage[] | undefined>(undefined)
  React.useEffect(() => {
    if (!pageId) return
    let alive = true
    setStages(undefined)
    supportPagesService
      .getStages(pageId)
      .then((rows) => { if (alive) setStages(rows) })
      .catch(() => { if (alive) setStages([]) })
    return () => { alive = false }
  }, [pageId])

  // Enquanto o cache não carregou não dá pra saber se a cópia existe — esperar evita mandar o
  // usuário pro Dashboard num piscar de olhos logo depois do login.
  if (!booted) {
    return (
      <Centered>
        <span className="inline-flex items-center gap-2">
          <Loader2 className="h-4 w-4 animate-spin" />
          Carregando…
        </span>
      </Centered>
    )
  }

  // Cópia arquivada ou excluída (ou link velho) — volta pro Dashboard em vez de tela branca.
  if (!page) return <Navigate to="/" replace />

  const Screen = SCREEN_BY_SOURCE[page.sourceKey]
  if (!Screen) return <Navigate to="/" replace />

  // A cópia herda a permissão da tela de origem: quem não pode ver /tickets também não vê uma
  // cópia de Tickets. O ProtectedRoute casa por path fixo, então /visao/<id> passa por ele sem
  // bater em nada — o gate real da cópia é aqui.
  if (profile?.restrictAccess) {
    const allowed = new Set(profile.menuAccess ?? [])
    const item = MENU_ACCESS_ITEMS.find((i) => i.key === page.sourceKey)
    if (item && !allowed.has(item.key)) {
      const fallback = MENU_ACCESS_ITEMS.find((i) => allowed.has(i.key))
      return <Navigate to={fallback?.path ?? '/'} replace />
    }
  }

  if (stages === undefined) {
    return (
      <Centered>
        <span className="inline-flex items-center gap-2">
          <Loader2 className="h-4 w-4 animate-spin" />
          Carregando…
        </span>
      </Centered>
    )
  }

  return (
    <SupportViewProvider
      value={{ pageId: page.id, pageName: page.name, sourceKey: page.sourceKey, config: page.viewConfig }}
    >
      <React.Suspense
        fallback={
          <Centered>
            <span className="inline-flex items-center gap-2">
              <Loader2 className="h-4 w-4 animate-spin" />
              Carregando…
            </span>
          </Centered>
        }
      >
        {/* key: trocar de cópia precisa REMONTAR a tela, senão os useState dos filtros ficam
            com os valores da cópia anterior e a nova "não abre" de verdade. */}
        {stages.length > 0 ? (
          <SupportPageBoard key={page.id} pageId={page.id} pageName={page.name} stages={stages} />
        ) : (
          <Screen key={page.id} />
        )}
      </React.Suspense>
    </SupportViewProvider>
  )
}
