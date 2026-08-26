import * as React from 'react'
import { toast } from 'sonner'
import { api, setToken, clearToken, startSse, stopSse, onSseEvent } from '@/services/api'
import type { Profile, UserRole } from '@/services/supabase'
import { setThemeGlobal } from '@/hooks/useTheme'
import { bootDb, setCurrentProfile, teardownDb } from '@/services/db'
import { bootTickets, teardownTickets } from '@/services/tickets'
import { bootAnalytics, teardownAnalytics } from '@/services/analytics'
import { bootLeadBoards, teardownLeadBoards } from '@/services/leadBoards'
import { bootLeadPages, teardownLeadPages } from '@/services/leadPages'
import { bootSupportPages, teardownSupportPages } from '@/services/supportPages'

interface AuthState {
  profile: Profile | null
  loading: boolean
}

const listeners = new Set<(s: AuthState) => void>()
let state: AuthState = { profile: null, loading: true }

function setState(next: Partial<AuthState>) {
  state = { ...state, ...next }
  for (const fn of listeners) fn(state)
}

let initialized = false

// Trocar as permissões de alguém (Equipe → Permissões) não muda nenhuma linha de lead_pages/
// lead_boards, então o SSE normal dessas tabelas nunca avisa quem foi restrito — a pessoa
// continuava vendo o que já tinha carregado até recarregar a aba por conta própria. Ouve
// mudanças na PRÓPRIA allowlist (user_page_access/user_menu_access) e recarrega sozinho assim
// que alguém mexe nas permissões dela, pra nunca ficar vendo aba/quadro que acabou de perder acesso.
function watchOwnAccessChanges(userId: string) {
  onSseEvent((table, _type, data) => {
    if (table !== 'user_page_access' && table !== 'user_menu_access') return
    if ((data as { user_id?: string }).user_id !== userId) return
    toast.info('Suas permissões de acesso foram atualizadas — recarregando…')
    window.setTimeout(() => window.location.reload(), 1200)
  })
}

/** Um admin pode "deslogar" alguém em Equipe (ver UsersPage) — se essa sessão é a alvo, sai na
 * hora, sem esperar a próxima chamada de API falhar pra perceber (ela também falharia, já que
 * o servidor recusa o token a partir de session_invalidated_at, mas isso só aconteceria no
 * próximo clique). */
function watchForceLogout(userId: string) {
  onSseEvent((table, type, data) => {
    if (table !== 'auth' || type !== 'force_logout') return
    if ((data as { user_id?: string }).user_id !== userId) return
    toast.error('Sua sessão foi encerrada por um administrador.')
    void signOut()
  })
}

async function init() {
  if (initialized) return
  initialized = true

  const token = localStorage.getItem('auth_token')
  if (!token) {
    setState({ loading: false })
    return
  }

  // O token já é suficiente pra essas rotas — não precisam esperar o /auth/me terminar
  // pra começar a carregar. Disparar junto (em vez de só depois do profile chegar) corta
  // pela metade o tempo até o menu Comercial aparecer no primeiro load da sessão.
  startSse()
  void bootDb()
  void bootTickets()
  void bootAnalytics()
  void bootLeadBoards()
  void bootLeadPages()
  void bootSupportPages()

  try {
    const profile = await api.get<Profile>('/api/auth/me')
    setCurrentProfile(profile)
    setState({ profile, loading: false })
    watchOwnAccessChanges(profile.id)
    watchForceLogout(profile.id)
    // Tema salvo na conta manda mais que o que já estava aplicado localmente nesse navegador —
    // assim a pessoa vê o mesmo tema dela em qualquer dispositivo que logar.
    if (profile.theme) setThemeGlobal(profile.theme)
  } catch {
    clearToken()
    setState({ loading: false })
  }
}

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    initialized = false
    listeners.clear()
  })
}

export function useAuth(): AuthState {
  void init()
  const [snapshot, setSnapshot] = React.useState<AuthState>(state)
  React.useEffect(() => {
    const fn = (s: AuthState) => setSnapshot(s)
    listeners.add(fn)
    setSnapshot(state)
    return () => { listeners.delete(fn) }
  }, [])
  return snapshot
}

export function useRole(): UserRole | null {
  const { profile } = useAuth()
  return profile?.role ?? null
}

export async function signIn(email: string, password: string) {
  const { token, user } = await api.post<{ token: string; user: Profile }>(
    '/api/auth/login',
    { email, password }
  )
  setToken(token)
  setCurrentProfile(user)
  setState({ profile: user, loading: false })
  startSse()
  watchOwnAccessChanges(user.id)
  watchForceLogout(user.id)
  if (user.theme) setThemeGlobal(user.theme)
  void bootDb()
  void bootTickets()
  void bootAnalytics()
  void bootLeadBoards()
  void bootLeadPages()
  void bootSupportPages()
  return { data: { user }, error: null }
}

export async function signOut() {
  await teardownDb()
  await teardownTickets()
  await teardownAnalytics()
  await teardownLeadBoards()
  await teardownLeadPages()
  await teardownSupportPages()
  stopSse()
  clearToken()
  setCurrentProfile(null)
  setState({ profile: null, loading: false })
  // Reload to clear any in-memory state
  window.location.href = '/login'
  return { error: null }
}

/** Salva a escolha de tema na CONTA (não só no navegador) — chamada pelo botão de tema da
 * Sidebar. Sem usuário logado (ex.: tela pública de ficha), não faz nada além de já ter aplicado
 * localmente via setThemeGlobal. */
export async function saveOwnTheme(theme: 'light' | 'dark') {
  const profile = state.profile
  if (!profile) return
  try {
    const updated = await api.patch<Profile>(`/api/users/${profile.id}`, { theme })
    setCurrentProfile(updated)
    setState({ profile: updated })
  } catch {
    // Falha ao salvar não deve travar a troca de tema local — só fica sem sincronizar
    // pros outros dispositivos até a próxima tentativa.
  }
}

// For components that previously used supabase.auth.updateUser
export async function updateCurrentUser(updates: { name?: string; password?: string }) {
  const profile = state.profile
  if (!profile) throw new Error('Não autenticado')
  const updated = await api.patch<Profile>(`/api/users/${profile.id}`, updates)
  setCurrentProfile(updated)
  setState({ profile: updated })
  toast.success('Perfil atualizado')
  return updated
}
