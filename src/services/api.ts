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

  if (res.status === 204) return undefined as unknown as T

  const body = await res.json().catch(() => ({ message: res.statusText }))
  if (!res.ok) throw new Error((body as { message?: string }).message ?? 'Erro na requisição')
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
