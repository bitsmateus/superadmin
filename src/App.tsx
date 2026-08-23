import * as React from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import { Layout } from './components/layout/Layout'
import { PageFallback } from './components/layout/PageFallback'
import { ProtectedRoute } from './routes/ProtectedRoute'
import { LoginPage } from './pages/LoginPage'

// Lazy-load das rotas internas pra reduzir o bundle inicial. Briefing
// público também fica em chunk próprio (visitante anônimo não baixa o CRM).
const DashboardPage = React.lazy(() =>
  import('./pages/DashboardPage').then((m) => ({ default: m.DashboardPage })),
)
const TenantsPage = React.lazy(() =>
  import('./pages/TenantsPage').then((m) => ({ default: m.TenantsPage })),
)
const TenantDetailPage = React.lazy(() =>
  import('./pages/TenantDetailPage').then((m) => ({ default: m.TenantDetailPage })),
)
const UsersPage = React.lazy(() =>
  import('./pages/UsersPage').then((m) => ({ default: m.UsersPage })),
)
const SettingsPage = React.lazy(() =>
  import('./pages/SettingsPage').then((m) => ({ default: m.SettingsPage })),
)
const ClientsPage = React.lazy(() =>
  import('./pages/ClientsPage').then((m) => ({ default: m.ClientsPage })),
)
const PipelinePage = React.lazy(() =>
  import('./pages/PipelinePage').then((m) => ({ default: m.PipelinePage })),
)
const ArchivedClientsPage = React.lazy(() =>
  import('./pages/ArchivedClientsPage').then((m) => ({ default: m.ArchivedClientsPage })),
)
const CanaisPage = React.lazy(() =>
  import('./pages/CanaisPage').then((m) => ({ default: m.CanaisPage })),
)
const ComercialPage = React.lazy(() =>
  import('./pages/ComercialPage').then((m) => ({ default: m.ComercialPage })),
)
// Cópias do menu Suporte ("Duplicar"): abrem a tela do item de origem com a visão salva delas.
const SupportViewPage = React.lazy(() =>
  import('./pages/SupportViewPage').then((m) => ({ default: m.SupportViewPage })),
)
const ComercialDashboardPage = React.lazy(() =>
  import('./pages/ComercialDashboardPage').then((m) => ({ default: m.ComercialDashboardPage })),
)
const FinancePage = React.lazy(() =>
  import('./pages/FinancePage').then((m) => ({ default: m.FinancePage })),
)
const TicketsPage = React.lazy(() =>
  import('./pages/TicketsPage').then((m) => ({ default: m.TicketsPage })),
)
const TemplatesPage = React.lazy(() =>
  import('./pages/TemplatesPage').then((m) => ({ default: m.TemplatesPage })),
)
const KnowledgeBasePage = React.lazy(() =>
  import('./pages/KnowledgeBasePage').then((m) => ({ default: m.KnowledgeBasePage })),
)
const NpsPage = React.lazy(() =>
  import('./pages/NpsPage').then((m) => ({ default: m.NpsPage })),
)
const CommandCenterPage = React.lazy(() =>
  import('./pages/CommandCenterPage').then((m) => ({ default: m.CommandCenterPage })),
)
const TeamPerformancePage = React.lazy(() =>
  import('./pages/TeamPerformancePage').then((m) => ({ default: m.TeamPerformancePage })),
)
const SupportWorkspacePage = React.lazy(() =>
  import('./pages/SupportWorkspacePage').then((m) => ({ default: m.SupportWorkspacePage })),
)
const AuditLogPage = React.lazy(() =>
  import('./pages/AuditLogPage').then((m) => ({ default: m.AuditLogPage })),
)
const NpsPublicPage = React.lazy(() =>
  import('./pages/NpsPublicPage').then((m) => ({ default: m.NpsPublicPage })),
)
const BriefingPublicPage = React.lazy(() =>
  import('./pages/BriefingPublicPage').then((m) => ({
    default: m.BriefingPublicPage,
  })),
)
const PendenciasPublicPage = React.lazy(() =>
  import('./pages/PendenciasPublicPage').then((m) => ({
    default: m.PendenciasPublicPage,
  })),
)
const FichaPublicPage = React.lazy(() =>
  import('./pages/FichaPublicPage').then((m) => ({ default: m.FichaPublicPage })),
)
const SupportPublicPage = React.lazy(() =>
  import('./pages/SupportPublicPage').then((m) => ({
    default: m.SupportPublicPage,
  })),
)

export default function App() {
  return (
    <React.Suspense fallback={<PageFallback />}>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/briefing/:token" element={<BriefingPublicPage />} />
        <Route path="/pendencias/:token" element={<PendenciasPublicPage />} />
        <Route path="/ficha" element={<FichaPublicPage />} />
        <Route path="/suporte" element={<SupportPublicPage />} />
        <Route path="/nps/:token" element={<NpsPublicPage />} />

        <Route
          element={
            <ProtectedRoute>
              <Layout />
            </ProtectedRoute>
          }
        >
          <Route index element={<DashboardPage />} />
          <Route path="/pipeline" element={<PipelinePage />} />
          <Route path="/canais" element={<CanaisPage />} />
          <Route path="/comercial" element={<Navigate to="/comercial/novos_leads" replace />} />
          <Route path="/comercial-dashboard" element={<ComercialDashboardPage />} />
          {/* Compat com os links antigos (hifenizados) das 3 abas de sempre. */}
          <Route path="/comercial/novos-leads" element={<Navigate to="/comercial/novos_leads" replace />} />
          <Route path="/comercial/crm-nx-luis" element={<Navigate to="/comercial/crm_luis" replace />} />
          <Route path="/comercial/crm-nx-arthur" element={<Navigate to="/comercial/crm_arthur" replace />} />
          <Route path="/comercial/:pageId" element={<ComercialPage />} />
          <Route path="/tarefas" element={<SupportWorkspacePage />} />
          {/* Uma cópia do menu Suporte tem rota só dela — ver SupportViewPage. */}
          <Route path="/visao/:pageId" element={<SupportViewPage />} />
          <Route path="/clients" element={<ClientsPage />} />
          <Route path="/arquivados" element={<ArchivedClientsPage />} />
          <Route path="/tenants" element={<TenantsPage />} />
          <Route path="/tenants/:serverId/:id" element={<TenantDetailPage />} />
          <Route path="/financeiro" element={<FinancePage />} />
          <Route path="/tickets" element={<TicketsPage />} />
          <Route path="/tickets/:id" element={<TicketsPage />} />
          <Route path="/templates" element={<TemplatesPage />} />
          <Route path="/kb" element={<KnowledgeBasePage />} />
          <Route path="/nps" element={<NpsPage />} />
          <Route path="/comando" element={<CommandCenterPage />} />
          <Route path="/equipe" element={<TeamPerformancePage />} />
          <Route path="/auditoria" element={<AuditLogPage />} />
          <Route path="/users" element={<UsersPage />} />
          <Route path="/settings" element={<SettingsPage />} />
        </Route>

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </React.Suspense>
  )
}
