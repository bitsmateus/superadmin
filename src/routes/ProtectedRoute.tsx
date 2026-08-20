import { Navigate, useLocation } from 'react-router-dom'
import { Loader2 } from 'lucide-react'
import { useAuth } from '@/hooks/useAuth'
import { resolveArea } from '@/services/supabase'

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

  // Usuário com acesso restrito só navega dentro da área liberada — Comercial
  // ou o restante do painel (onde o trabalho de entrega já acontece hoje).
  if (session.restrictAccess) {
    const area = resolveArea(session.area)
    const onComercial = location.pathname.startsWith('/comercial')
    if (area === 'comercial' && !onComercial) {
      return <Navigate to="/comercial/novos-leads" replace />
    }
    if (area === 'entrega' && onComercial) {
      return <Navigate to="/" replace />
    }
  }

  return <>{children}</>
}
