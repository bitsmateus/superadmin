/**
 * Cliente da API do Enge Envio (/engeenvio). Token PRÓPRIO (login separado do painel), como o
 * açougue — por isso não usa o `api` de @/services/api: o token vive em outra chave do
 * localStorage e não pode vazar pras rotas internas nem ser limpo junto com o logout do painel.
 */

const BASE_URL = import.meta.env.VITE_API_URL ?? ''
const TOKEN_KEY = 'engeenvio_token'

export const engeToken = {
  get: () => {
    try {
      return localStorage.getItem(TOKEN_KEY)
    } catch {
      return null
    }
  },
  set: (t: string) => localStorage.setItem(TOKEN_KEY, t),
  clear: () => localStorage.removeItem(TOKEN_KEY),
}

export interface EngeUsuario {
  id: string
  email: string
  nome: string | null
  created_at?: string
}

export interface EngeEmpreendimento {
  id: string
  nome: string
  cidade: string | null
  entrega: string | null
  sindico: string | null
  emails: string | null
  telefone: string | null
  construtora: string | null
  observacoes: string | null
}

export interface EngeGarantia {
  id: string
  empreendimentoId: string
  item: string
  prazo: string | null
  vencimento: string
  chamadoEm: string | null
  chamadoProtocolo: string | null
}

export type EngeEnvioStatus = 'agendado' | 'enviado' | 'erro' | 'cancelado'

export interface EngeEnvio {
  id: string
  garantiaId: string
  enviarEm: string
  status: EngeEnvioStatus
  destinatarios: string | null
  assunto: string | null
  enviadoEm: string | null
  erro: string | null
  cienteEm: string | null
  cienteNome: string | null
  canalEmail: boolean
  canalWhatsapp: boolean
  whatsappPara: string | null
  whatsappEnviadoEm: string | null
  whatsappErro: string | null
}

export interface EngeCanais {
  email: boolean
  whatsapp: boolean
}

export interface EngeTudo {
  empreendimentos: EngeEmpreendimento[]
  garantias: EngeGarantia[]
  envios: EngeEnvio[]
}

export interface EngeSmtp {
  host?: string
  port?: number
  secure?: boolean
  user?: string
  password?: string
  fromEmail?: string
  fromName?: string
  temSenha?: boolean
}

/** Conexão da Enge na NX (Z-PRO). `template` = número oficial (WABA): fora da janela de 24h só sai template aprovado. */
export interface EngeNx {
  apiId?: string
  token?: string
  baseUrl?: string
  modo?: 'texto' | 'template'
  template?: string
  idioma?: string
  parametros?: string[]
  temToken?: boolean
}

export interface EngeConfig {
  smtp: EngeSmtp
  copiaOculta: string
  assunto: string
  corpo: string
  smtpOk: boolean
  nx: EngeNx
  whatsappTexto: string
  nxOk: boolean
}

export type EmpreendimentoDados = Omit<EngeEmpreendimento, 'id'>
export interface NovaGarantia {
  item: string
  prazo: string
  vencimento: string
  /** Dia/hora de cada aviso, "YYYY-MM-DDTHH:mm" no horário de Brasília. */
  envios: string[]
}

/** 401/403 = sessão do Enge Envio caiu — quem chama volta pro login. */
export class EngeSemSessao extends Error {}

async function req<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = engeToken.get()
  const res = await fetch(`${BASE_URL}/api/public/engeenvio${path}`, {
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
    if ((res.status === 401 || res.status === 403) && !path.startsWith('/login') && !path.startsWith('/ciente')) {
      engeToken.clear()
      throw new EngeSemSessao(msg)
    }
    throw new Error(msg)
  }
  if (res.status === 204) return undefined as T
  return (await res.json()) as T
}

const post = <T>(path: string, body?: unknown) =>
  req<T>(path, { method: 'POST', ...(body !== undefined ? { body: JSON.stringify(body) } : {}) })
const put = <T>(path: string, body: unknown) => req<T>(path, { method: 'PUT', body: JSON.stringify(body) })
const del = <T>(path: string) => req<T>(path, { method: 'DELETE' })

const origem = () => window.location.origin

export const engeApi = {
  status: () => req<{ temUsuario: boolean }>('/status'),
  login: (email: string, senha: string) =>
    post<{ token: string; usuario: EngeUsuario }>('/login', { email, senha, origem: origem() }),
  primeiroAcesso: (email: string, nome: string, senha: string) =>
    post<{ token: string; usuario: EngeUsuario }>('/primeiro-acesso', { email, nome, senha, origem: origem() }),
  me: () => req<EngeUsuario>('/me'),

  usuarios: () => req<EngeUsuario[]>('/usuarios'),
  criarUsuario: (email: string, nome: string, senha: string) => post<EngeUsuario>('/usuarios', { email, nome, senha }),
  removerUsuario: (id: string) => del<{ ok: true }>(`/usuarios/${id}`),

  config: () => req<EngeConfig>('/config'),
  salvarConfig: (dados: Partial<Omit<EngeConfig, 'smtpOk' | 'nxOk'>>) =>
    put<{ ok: true; smtpOk: boolean; nxOk: boolean }>('/config', dados),
  testarEnvio: (para: string) => post<{ ok: true }>('/config/teste', { para }),
  testarWhatsApp: (numero: string) => post<{ ok: true }>('/config/teste-whatsapp', { numero }),
  previa: (dados: { assunto?: string; corpo?: string; whatsappTexto?: string; garantiaId?: string; data?: string }) =>
    post<{ assunto: string; html: string; whatsapp: string }>('/previa', dados),

  tudo: () => req<EngeTudo>('/tudo'),
  criarEmpreendimento: (dados: EmpreendimentoDados & { garantias: NovaGarantia[]; canais: EngeCanais }) =>
    post<EngeEmpreendimento>('/empreendimentos', dados),
  salvarEmpreendimento: (id: string, dados: EmpreendimentoDados) => put<EngeEmpreendimento>(`/empreendimentos/${id}`, dados),
  removerEmpreendimento: (id: string) => del<{ ok: true }>(`/empreendimentos/${id}`),

  criarGarantia: (empreendimentoId: string, dados: NovaGarantia & { canais: EngeCanais }) =>
    post<{ id: string }>(`/empreendimentos/${empreendimentoId}/garantias`, dados),
  salvarGarantia: (
    id: string,
    dados: Partial<Pick<EngeGarantia, 'item' | 'prazo' | 'vencimento' | 'chamadoEm' | 'chamadoProtocolo'>> & {
      cancelarPendentes?: boolean
    },
  ) => put<{ ok: true }>(`/garantias/${id}`, dados),
  removerGarantia: (id: string) => del<{ ok: true }>(`/garantias/${id}`),

  agendarEnvio: (garantiaId: string, enviarEm: string, canais: EngeCanais) =>
    post<{ id: string }>(`/garantias/${garantiaId}/envios`, { enviarEm, ...canais }),
  remarcarEnvio: (id: string, enviarEm: string, canais?: EngeCanais) => put<{ id: string }>(`/envios/${id}`, { enviarEm, ...canais }),
  cancelarEnvio: (id: string) => post<{ ok: true }>(`/envios/${id}/cancelar`),
  enviarAgora: (id: string) => post<{ ok: true }>(`/envios/${id}/enviar-agora`),
  verEnvio: (id: string) =>
    req<EngeEnvio & { html: string | null; cienteIp: string | null; whatsappTexto: string | null }>(`/envios/${id}`),

  ciente: (token: string) =>
    req<{ item: string; vencimento: string; empreendimento: string; enviadoEm: string; cienteEm: string | null; cienteNome: string | null }>(
      `/ciente/${token}`,
    ),
  confirmarCiente: (token: string, nome: string) =>
    post<{ cienteEm: string; cienteNome: string }>(`/ciente/${token}`, { nome }),
}
