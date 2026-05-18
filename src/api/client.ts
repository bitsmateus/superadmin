import axios, { AxiosError, AxiosRequestConfig } from 'axios'
import { toast } from 'sonner'
import { type ServerConfig } from '@/store/authStore'

export function buildBaseURL(server: ServerConfig): string {
  if (import.meta.env.DEV) return `/_proxy/${server.id}`
  return server.baseUrl
}

let warned401: Record<string, number> = {}
function maybeWarn401(server: ServerConfig) {
  const now = Date.now()
  if ((warned401[server.id] ?? 0) + 5_000 > now) return
  warned401[server.id] = now
  toast.error(
    `Token de API inválido para "${server.name}". Atualize em Configurações.`,
  )
  // Auth do painel é gerenciado pelo Supabase agora; um 401 nos servidores
  // externos (chat/app/web) significa só que o token da API daquele servidor
  // está inválido — não desloga o operador do painel.
}

export async function apiRequest<T = unknown>(
  server: ServerConfig,
  options: AxiosRequestConfig,
): Promise<T> {
  try {
    const response = await axios.request<T>({
      ...options,
      baseURL: buildBaseURL(server),
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        ...(options.headers ?? {}),
        Authorization: `Bearer ${server.apiToken}`,
      },
      timeout: 30_000,
    })
    return response.data
  } catch (err) {
    if (axios.isAxiosError(err) && err.response?.status === 401) {
      maybeWarn401(server)
    }
    throw err
  }
}

export function extractErrorMessage(err: unknown, fallback = 'Algo deu errado'): string {
  if (axios.isAxiosError(err)) {
    if (err.code === 'ERR_NETWORK' || err.message === 'Network Error') {
      return 'Falha de rede — verifique a URL em Configurações e se a API permite acesso do navegador (CORS).'
    }
    if (err.code === 'ECONNABORTED') {
      return 'Tempo esgotado ao falar com a API.'
    }
    const raw = err.response?.data
    if (typeof raw === 'string') {
      const trimmed = raw.trim()
      if (trimmed && !trimmed.startsWith('<')) return trimmed.slice(0, 500)
    }
    if (raw && typeof raw === 'object') {
      const data = raw as Record<string, unknown>
      if (typeof data.message === 'string') return data.message
      if (typeof data.error === 'string') return data.error
      const errors = data.errors
      if (errors && typeof errors === 'object') {
        const first = Object.values(errors as Record<string, unknown>)[0]
        if (Array.isArray(first) && typeof first[0] === 'string') return first[0]
        if (typeof first === 'string') return first
      }
    }
    if (err.response?.status) {
      return `Erro ${err.response.status} ao chamar a API`
    }
    if (typeof err.message === 'string') return err.message
  }
  if (err instanceof Error) return err.message
  if (typeof err === 'string') return err
  return fallback
}

export function toMessage(value: unknown, fallback = 'Erro desconhecido'): string {
  if (value == null) return fallback
  if (typeof value === 'string') return value
  if (value instanceof Error) return value.message
  if (typeof value === 'object' && 'message' in (value as object)) {
    const m = (value as { message?: unknown }).message
    if (typeof m === 'string') return m
  }
  return extractErrorMessage(value, fallback)
}

// Backwards-compat shim: legacy code may import `api`. Replaced by apiRequest(server, options).
export const api = {
  request: <T = unknown>(server: ServerConfig, options: AxiosRequestConfig) =>
    apiRequest<T>(server, options),
}
