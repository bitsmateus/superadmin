const BASE_URL = import.meta.env.VITE_API_URL ?? ''

function getToken(): string | null {
  return localStorage.getItem('auth_token')
}

export function setToken(token: string) {
  localStorage.setItem('auth_token', token)
}

export function clearToken() {
  localStorage.removeItem('auth_token')
}

/**
 * Sessão expirada: o JWT do painel (7 dias) caiu no meio do uso. Limpa o token
 * e manda pro login em vez de deixar o operador preso vendo "Token inválido ou
 * expirado" em toda ação. Evita loop na própria tela de login e não dispara no
 * 401 de credenciais erradas do próprio /api/auth/login.
 */
function handleSessionExpired(path: string): boolean {
  if (path.includes('/api/auth/login')) return false
  if (!getToken()) return false
  clearToken()
  if (typeof window !== 'undefined' && !window.location.pathname.startsWith('/login')) {
    window.location.href = '/login?expired=1'
  }
  return true
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = getToken()
  const res = await fetch(`${BASE_URL}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers as Record<string, string> ?? {}),
    },
  })

  if (res.status === 401 && handleSessionExpired(path)) {
    throw new Error('Sessão expirada — faça login novamente.')
  }

  if (res.status === 204) return undefined as unknown as T

  const body = await res.json().catch(() => ({ message: res.statusText }))
  if (!res.ok) {
    const err = new Error((body as { message?: string }).message ?? 'Erro na requisição') as Error & {
      status?: number
      body?: unknown
    }
    err.status = res.status
    err.body = body
    throw err
  }
  return body as T
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: 'POST', body: JSON.stringify(body) }),
  patch: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: 'PATCH', body: JSON.stringify(body) }),
  put: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: 'PUT', body: JSON.stringify(body) }),
  delete: <T = void>(path: string) => request<T>(path, { method: 'DELETE' }),
}

// SSE connection for realtime updates
type SseHandler = (table: string, type: string, data: Record<string, unknown>) => void
const sseHandlers: SseHandler[] = []
let eventSource: EventSource | null = null

export function onSseEvent(handler: SseHandler) {
  sseHandlers.push(handler)
  return () => {
    const idx = sseHandlers.indexOf(handler)
    if (idx !== -1) sseHandlers.splice(idx, 1)
  }
}

export function startSse() {
  const token = getToken()
  if (!token || eventSource) return

  const url = `${BASE_URL}/api/events?token=${encodeURIComponent(token)}`
  eventSource = new EventSource(url)

  eventSource.onmessage = (e) => {
    try {
      const payload = JSON.parse(e.data) as { table: string; type: string; data: Record<string, unknown> }
      sseHandlers.forEach((h) => h(payload.table, payload.type, payload.data))
    } catch {
      // ignore malformed
    }
  }

  eventSource.onerror = () => {
    // Auto-reconnect handled by browser; just log
    console.warn('[sse] connection error, will reconnect')
  }
}

export function stopSse() {
  eventSource?.close()
  eventSource = null
}
