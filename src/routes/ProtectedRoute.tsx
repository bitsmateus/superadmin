import { Navigate, useLocation } from 'react-router-dom'
import { Loader2 } from 'lucide-react'
import { useAuth } from '@/hooks/useAuth'
import { MENU_ACCESS_ITEMS } from '@/constants/menuAccess'

export function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { profile: session, loading } = useAuth()
  const location = useLocation()

  if (loading) {
    return (
      <div className="grid min-h-screen place-items-center bg-bg text-foreground/55">
        <span className="inline-flex items-center gap-2 text-sm">
          <Loader2 className="h-4 w-4 animate-spin" />
          Carregando…
        </span>
      </div>
    )
  }

  if (!session) {
    return (
      <Navigate
        to="/login"
        replace
        state={{ from: location.pathname + location.search }}
      />
    )
  }

  // Usuário com acesso restrito só navega pelas páginas liberadas em Permissões (Equipe).
  // Páginas fora da lista gerenciada aqui (admin-only, financeiro) já têm gate próprio por papel.
  if (session.restrictAccess) {
    const allowed = new Set(session.menuAccess ?? [])
    const matched = MENU_ACCESS_ITEMS.find(
      (item) => location.pathname === item.path || (item.path !== '/' && location.pathname.startsWith(item.path)),
    )
    if (matched && !allowed.has(matched.key)) {
      const fallback = MENU_ACCESS_ITEMS.find((item) => allowed.has(item.key))
      return <Navigate to={fallback?.path ?? '/'} replace />
    }
  }

  return <>{children}</>
}
