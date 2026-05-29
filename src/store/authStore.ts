import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export interface ServerConfig {
  id: string
  name: string
  baseUrl: string
  apiToken: string
  loginUrl: string
  enabled: boolean
}

// API tokens dos servidores externos não devem estar hardcoded no bundle JS.
// Os defaults aqui ficam com apiToken vazio — o operador configura em
// /settings (persistido em localStorage por usuário). Em DEV é possível
// pré-popular via .env (VITE_DEV_TOKEN_CHAT etc.) — não use em produção.
function devToken(key: string): string {
  if (!import.meta.env.DEV) return ''
  return (import.meta.env[`VITE_DEV_TOKEN_${key}` as const] as string) ?? ''
}

export const DEFAULT_SERVERS: ServerConfig[] = [
  {
    id: 'chat',
    name: 'Chat',
    baseUrl: 'https://chatapi.nxsystems.com.br',
    apiToken: devToken('CHAT'),
    loginUrl: 'https://chat.nxsystems.com.br/login',
    enabled: true,
  },
  {
    id: 'app',
    name: 'App',
    baseUrl: 'https://appapi.nxsystems.com.br',
    apiToken: devToken('APP'),
    loginUrl: 'https://app.nxsystems.com.br/login',
    enabled: true,
  },
  {
    id: 'web',
    name: 'Web',
    baseUrl: 'https://webapi.nxsystems.com.br',
    apiToken: devToken('WEB'),
    loginUrl: 'https://web.nxsystems.com.br/login',
    enabled: true,
  },
]

function deriveLoginUrlFromBaseUrl(baseUrl: string): string {
  try {
    const u = new URL(baseUrl)
    u.hostname = u.hostname.replace(/^([a-z0-9-]+)api\./i, '$1.')
    u.pathname = '/login'
    u.search = ''
    u.hash = ''
    return u.toString()
  } catch {
    return baseUrl
  }
}

interface AuthState {
  servers: ServerConfig[]
  selectedServerId: string
  setSelectedServer: (id: string) => void
  /** Bulk-replace servers — called when syncing from backend. */
  setServers: (servers: ServerConfig[]) => void
  upsertServer: (server: ServerConfig) => void
  removeServer: (id: string) => void
  toggleServer: (id: string, enabled: boolean) => void
  resetServers: () => void
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      servers: DEFAULT_SERVERS,
      selectedServerId: DEFAULT_SERVERS[0].id,
      setSelectedServer: (id) =>
        set((s) =>
          s.servers.find((x) => x.id === id) ? { selectedServerId: id } : {},
        ),
      setServers: (servers) => set({ servers }),
      upsertServer: (server) =>
        set((s) => {
          const idx = s.servers.findIndex((x) => x.id === server.id)
          if (idx === -1) return { servers: [...s.servers, server] }
          const next = s.servers.slice()
          next[idx] = server
          return { servers: next }
        }),
      removeServer: (id) =>
        set((s) => {
          const next = s.servers.filter((x) => x.id !== id)
          const selected =
            s.selectedServerId === id && next[0]
              ? next[0].id
              : s.selectedServerId
          return { servers: next, selectedServerId: selected }
        }),
      toggleServer: (id, enabled) =>
        set((s) => ({
          servers: s.servers.map((x) => (x.id === id ? { ...x, enabled } : x)),
        })),
      resetServers: () =>
        set({
          servers: DEFAULT_SERVERS,
          selectedServerId: DEFAULT_SERVERS[0].id,
        }),
    }),
    {
      name: 'tenanthub-auth',
      // v6: servers são compartilhados via backend (settings), MAS mantemos
      // uma cópia local também — assim um deploy/migração nunca apaga um token
      // de API já configurado. Na inicialização o backend vence quando tem
      // dados; o localStorage serve de fallback e de semente.
      version: 6,
      migrate: (persisted, _fromVersion) => {
        const old = persisted as Partial<AuthState> | undefined
        const oldServers = old?.servers
        return {
          servers:
            Array.isArray(oldServers) && oldServers.length > 0
              ? oldServers
              : DEFAULT_SERVERS,
          selectedServerId: old?.selectedServerId ?? DEFAULT_SERVERS[0].id,
        } as AuthState
      },
      // Persistimos servers (backup local) + servidor selecionado.
      partialize: (state) => ({
        servers: state.servers,
        selectedServerId: state.selectedServerId,
      }),
    },
  ),
)

export function getActiveServer(): ServerConfig {
  const { servers, selectedServerId } = useAuthStore.getState()
  return (
    servers.find((x) => x.id === selectedServerId) ??
    servers[0] ??
    DEFAULT_SERVERS[0]
  )
}

export function getServerById(id: string | undefined): ServerConfig | undefined {
  if (!id) return undefined
  return useAuthStore.getState().servers.find((s) => s.id === id)
}

export function useServerById(id: string | undefined): ServerConfig | undefined {
  return useAuthStore((s) =>
    id ? s.servers.find((x) => x.id === id) : undefined,
  )
}

export function useActiveServer(): ServerConfig {
  const servers = useAuthStore((s) => s.servers)
  const selectedServerId = useAuthStore((s) => s.selectedServerId)
  return (
    servers.find((x) => x.id === selectedServerId) ??
    servers[0] ??
    DEFAULT_SERVERS[0]
  )
}
