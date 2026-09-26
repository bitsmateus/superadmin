import type { Arredondamento, Corte, Unidade } from '@/lib/acougueRateio'

/**
 * Cliente da API do açougue (/mercadonunes/acougue). Tem token PRÓPRIO (login separado do painel),
 * por isso não usa o `api` de @/services/api — o token dele vive em outra chave do localStorage e
 * não deve vazar pras rotas internas nem ser limpo junto com o logout do painel.
 */

const BASE_URL = import.meta.env.VITE_API_URL ?? ''
const TOKEN_KEY = 'acougue_token'

export const acougueToken = {
  get: () => localStorage.getItem(TOKEN_KEY),
  set: (t: string) => localStorage.setItem(TOKEN_KEY, t),
  clear: () => localStorage.removeItem(TOKEN_KEY),
}

export interface AcougueUsuario {
  id: string
  email: string
  nome: string | null
  created_at?: string
}

export interface AcougueBase {
  id: string
  nome: string
  unidade: Unidade
  custo: number
  pesoPeca: number | null
  margem: number
  arredondamento: Arredondamento
  cortes: Corte[]
  updated_at?: string
}

export interface AcougueHistorico {
  id: string
  baseNome: string
  custoKg: number
  margem: number
  usuario: string | null
  cortes: Corte[]
  createdAt: string
}

/** 401/403 aqui significa sessão do açougue caída — quem chama decide voltar pro login. */
export class AcougueSemSessao extends Error {}

async function req<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = acougueToken.get()
  const res = await fetch(`${BASE_URL}/api/public/acougue${path}`, {
    ...options,
    headers: {
      ...(options.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...((options.headers as Record<string, string>) ?? {}),
    },
  })
  if (!res.ok) {
    let msg = `Erro ${res.status}`
    try {
      const body = (await res.json()) as { message?: string }
      if (body?.message) msg = body.message
    } catch {
      /* resposta sem JSON — fica a mensagem genérica */
    }
    if ((res.status === 401 || res.status === 403) && !path.startsWith('/login')) {
      acougueToken.clear()
      throw new AcougueSemSessao(msg)
    }
    throw new Error(msg)
  }
  if (res.status === 204) return undefined as T
  return (await res.json()) as T
}

const post = <T>(path: string, body?: unknown) =>
  req<T>(path, { method: 'POST', ...(body !== undefined ? { body: JSON.stringify(body) } : {}) })

export const acougueApi = {
  status: () => req<{ temUsuario: boolean }>('/status'),
  login: (email: string, senha: string) => post<{ token: string; usuario: AcougueUsuario }>('/login', { email, senha }),
  primeiroAcesso: (email: string, nome: string, senha: string) =>
    post<{ token: string; usuario: AcougueUsuario }>('/primeiro-acesso', { email, nome, senha }),
  me: () => req<AcougueUsuario>('/me'),

  usuarios: () => req<AcougueUsuario[]>('/usuarios'),
  criarUsuario: (email: string, nome: string, senha: string) => post<AcougueUsuario>('/usuarios', { email, nome, senha }),
  removerUsuario: (id: string) => req<{ ok: true }>(`/usuarios/${id}`, { method: 'DELETE' }),

  bases: () => req<AcougueBase[]>('/bases'),
  criarBase: (nome: string) => post<AcougueBase>('/bases', { nome }),
  salvarBase: (id: string, dados: Partial<Omit<AcougueBase, 'id'>>) =>
    req<AcougueBase>(`/bases/${id}`, { method: 'PUT', body: JSON.stringify(dados) }),
  removerBase: (id: string) => req<{ ok: true }>(`/bases/${id}`, { method: 'DELETE' }),
  aplicar: (id: string, cortes: Corte[], custoKg: number, margem: number) =>
    post<{ ok: true }>(`/bases/${id}/aplicar`, { cortes, custoKg, margem }),
  historico: (id: string) => req<AcougueHistorico[]>(`/bases/${id}/historico`),
}
