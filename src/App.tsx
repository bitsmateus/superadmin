import { Routes, Route, Navigate } from 'react-router-dom'
import { Layout } from './components/layout/Layout'
import { ProtectedRoute } from './routes/ProtectedRoute'
import { LoginPage } from './pages/LoginPage'
import { DashboardPage } from './pages/DashboardPage'
import { TenantsPage } from './pages/TenantsPage'
import { TenantDetailPage } from './pages/TenantDetailPage'
import { UsersPage } from './pages/UsersPage'
import { SettingsPage } from './pages/SettingsPage'
import { ClientsPage } from './pages/ClientsPage'
import { PipelinePage } from './pages/PipelinePage'
import { FinancePage } from './pages/FinancePage'
import { BriefingPublicPage } from './pages/BriefingPublicPage'

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/briefing/:token" element={<BriefingPublicPage />} />

      <Route
        element={
          <ProtectedRoute>
            <Layout />
          </ProtectedRoute>
        }
      >
        <Route index element={<DashboardPage />} />
        <Route path="/pipeline" element={<PipelinePage />} />
        <Route path="/clients" element={<ClientsPage />} />
        <Route path="/tenants" element={<TenantsPage />} />
        <Route path="/tenants/:serverId/:id" element={<TenantDetailPage />} />
        <Route path="/financeiro" element={<FinancePage />} />
        <Route path="/users" element={<UsersPage />} />
        <Route path="/settings" element={<SettingsPage />} />
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
