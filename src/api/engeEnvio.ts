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
  modeloId: string | null
}

/** Modelo de mensagem: o texto do e-mail e o do WhatsApp de um tipo de aviso. */
export interface EngeModelo {
  id: string
  nome: string
  assunto: string
  corpo: string
  whatsappTexto: string
  /** Só no número oficial (WABA): template aprovado na Meta e as variáveis dele, na ordem. */
  whatsappTemplate: string | null
  whatsappIdioma: string | null
  whatsappParametros: string[]
  padrao: boolean
}
export type ModeloDados = Omit<EngeModelo, 'id' | 'padrao'>

/** Uma etapa da régua: quando sai (em relação ao vencimento), com qual modelo, por quais canais e se repete. */
export interface EtapaRegua {
  id: string
  momento: 'antes' | 'dia' | 'depois'
  dias: number
  hora: string
  modeloId: string | null
  email: boolean
  whatsapp: boolean
  repetir: boolean
  aCada: number
  vezes: number
}

export interface EngeRegua {
  id: string
  nome: string
  etapas: EtapaRegua[]
  padrao: boolean
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
  smtpOk: boolean
  nx: EngeNx
  nxOk: boolean
}

export type EmpreendimentoDados = Omit<EngeEmpreendimento, 'id'>
/** Aviso a criar: dia/hora ("YYYY-MM-DDTHH:mm", horário de Brasília), modelo e canais. */
export interface EnvioNovo {
  enviarEm: string
  modeloId: string | null
  email: boolean
  whatsapp: boolean
}

export interface NovaGarantia {
  item: string
  prazo: string
  vencimento: string
  envios: EnvioNovo[]
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
  /** `senha` vazia mantém a atual; pra trocar a própria senha, `senhaAtual` é obrigatória. */
  editarUsuario: (id: string, dados: { nome: string; email: string; senha?: string; senhaAtual?: string }) =>
    put<EngeUsuario>(`/usuarios/${id}`, dados),
  removerUsuario: (id: string) => del<{ ok: true }>(`/usuarios/${id}`),

  config: () => req<EngeConfig>('/config'),
  salvarConfig: (dados: Partial<Omit<EngeConfig, 'smtpOk' | 'nxOk'>>) =>
    put<{ ok: true; smtpOk: boolean; nxOk: boolean }>('/config', dados),
  testarEnvio: (para: string) => post<{ ok: true }>('/config/teste', { para }),
  testarWhatsApp: (numero: string) => post<{ ok: true }>('/config/teste-whatsapp', { numero }),
  previa: (dados: { assunto?: string; corpo?: string; whatsappTexto?: string; modeloId?: string; garantiaId?: string; data?: string }) =>
    post<{ assunto: string; html: string; whatsapp: string }>('/previa', dados),

  modelos: () => req<EngeModelo[]>('/modelos'),
  criarModelo: (dados: ModeloDados) => post<EngeModelo>('/modelos', dados),
  salvarModelo: (id: string, dados: ModeloDados) => put<EngeModelo>(`/modelos/${id}`, dados),
  tornarModeloPadrao: (id: string) => post<{ ok: true }>(`/modelos/${id}/padrao`),
  removerModelo: (id: string) => del<{ ok: true }>(`/modelos/${id}`),

  reguas: () => req<EngeRegua[]>('/reguas'),
  criarRegua: (nome: string, etapas: EtapaRegua[]) => post<EngeRegua>('/reguas', { nome, etapas }),
  salvarRegua: (id: string, nome: string, etapas: EtapaRegua[]) => put<EngeRegua>(`/reguas/${id}`, { nome, etapas }),
  tornarReguaPadrao: (id: string) => post<{ ok: true }>(`/reguas/${id}/padrao`),
  removerRegua: (id: string) => del<{ ok: true }>(`/reguas/${id}`),

  tudo: () => req<EngeTudo>('/tudo'),
  criarEmpreendimento: (dados: EmpreendimentoDados & { garantias: NovaGarantia[] }) =>
    post<EngeEmpreendimento>('/empreendimentos', dados),
  salvarEmpreendimento: (id: string, dados: EmpreendimentoDados) => put<EngeEmpreendimento>(`/empreendimentos/${id}`, dados),
  removerEmpreendimento: (id: string) => del<{ ok: true }>(`/empreendimentos/${id}`),

  criarGarantia: (empreendimentoId: string, dados: NovaGarantia) =>
    post<{ id: string }>(`/empreendimentos/${empreendimentoId}/garantias`, dados),
  salvarGarantia: (
    id: string,
    dados: Partial<Pick<EngeGarantia, 'item' | 'prazo' | 'vencimento' | 'chamadoEm' | 'chamadoProtocolo'>> & {
      cancelarPendentes?: boolean
    },
  ) => put<{ ok: true }>(`/garantias/${id}`, dados),
  removerGarantia: (id: string) => del<{ ok: true }>(`/garantias/${id}`),

  agendarEnvio: (garantiaId: string, enviarEm: string, canais: EngeCanais, modeloId: string | null) =>
    post<{ id: string }>(`/garantias/${garantiaId}/envios`, { enviarEm, ...canais, modeloId }),
  agendarLote: (garantiaId: string, envios: EnvioNovo[]) =>
    post<{ criados: number }>(`/garantias/${garantiaId}/envios/lote`, { envios }),
  remarcarEnvio: (id: string, enviarEm: string, canais?: EngeCanais, modeloId?: string | null) =>
    put<{ id: string }>(`/envios/${id}`, { enviarEm, ...canais, ...(modeloId !== undefined ? { modeloId } : {}) }),
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
