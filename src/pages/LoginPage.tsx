import * as React from 'react'
import { useNavigate, useLocation, Navigate } from 'react-router-dom'
import {
  Eye,
  EyeOff,
  KeyRound,
  LogIn,
  Mail,
  ShieldCheck,
} from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { signIn, useAuth } from '@/hooks/useAuth'

export function LoginPage() {
  const navigate = useNavigate()
  const location = useLocation() as { state?: { from?: string } }
  const { profile, loading: authLoading } = useAuth()

  const [email, setEmail] = React.useState('')
  const [pass, setPass] = React.useState('')
  const [show, setShow] = React.useState(false)
  const [loading, setLoading] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  if (!authLoading && profile) {
    return <Navigate to={location.state?.from || '/'} replace />
  }

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!email.trim() || !pass) {
      setError('Informe e-mail e senha')
      return
    }
    setLoading(true)
    setError(null)
    try {
      await signIn(email.trim(), pass)
      toast.success('Bem-vindo de volta')
      navigate(location.state?.from || '/', { replace: true })
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Credenciais inválidas'
      setError(msg.includes('inválid') || msg.includes('Invalid') ? 'E-mail ou senha incorretos' : msg)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="relative grid min-h-screen place-items-center overflow-hidden bg-bg px-4">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            'radial-gradient(60% 50% at 50% 0%, rgba(79,142,247,0.10), transparent 70%)',
        }}
      />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-[0.04]"
        style={{
          backgroundImage:
            'linear-gradient(rgba(255,255,255,0.5) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.5) 1px, transparent 1px)',
          backgroundSize: '48px 48px',
        }}
      />

      <div className="relative z-10 w-full max-w-[400px] animate-fade-in">
        <div className="mb-6 flex flex-col items-center">
          <div className="mb-4 grid h-12 w-12 place-items-center rounded-2xl bg-card ring-1 ring-line shadow-glow">
            <ShieldCheck className="h-6 w-6 text-accent" />
          </div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">
            TenantHub
          </h1>
          <p className="mt-1 text-sm text-foreground/50">
            Painel interno de gestão de tenants
          </p>
        </div>

        <form
          onSubmit={onSubmit}
          className="rounded-2xl border border-line bg-card/80 p-6 shadow-2xl backdrop-blur-sm"
        >
          <div className="mb-1">
            <h2 className="text-sm font-medium text-foreground">Entrar</h2>
            <p className="mt-0.5 text-xs text-foreground/45">
              Acesse com seu e-mail e senha
            </p>
          </div>

          <div className="mt-5 space-y-3">
            <Input
              label="E-mail"
              type="email"
              placeholder="voce@empresa.com"
              autoComplete="email"
              spellCheck={false}
              value={email}
              onChange={(e) => {
                setEmail(e.target.value)
                if (error) setError(null)
              }}
              leftIcon={<Mail className="h-4 w-4" />}
            />
            <Input
              type={show ? 'text' : 'password'}
              label="Senha"
              placeholder="••••••"
              autoComplete="current-password"
              value={pass}
              onChange={(e) => {
                setPass(e.target.value)
                if (error) setError(null)
              }}
              leftIcon={<KeyRound className="h-4 w-4" />}
              rightIcon={
                <button
                  type="button"
                  onClick={() => setShow((s) => !s)}
                  aria-label={show ? 'Ocultar senha' : 'Mostrar senha'}
                  className="pointer-events-auto text-foreground/40 hover:text-foreground/80"
                >
                  {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              }
              error={error || undefined}
            />
          </div>

          <Button
            type="submit"
            className="mt-5 w-full"
            size="lg"
            loading={loading}
            leftIcon={!loading ? <LogIn className="h-4 w-4" /> : undefined}
          >
            {loading ? 'Validando…' : 'Entrar'}
          </Button>

          <div className="mt-5 rounded-lg border border-line bg-elevate/[0.02] px-3 py-2.5">
            <p className="text-[11px] leading-relaxed text-foreground/55">
              Não tem acesso? Peça para um administrador criar sua conta na
              página <span className="text-foreground/85">Usuários</span>.
            </p>
          </div>
        </form>
      </div>
    </div>
  )
}
