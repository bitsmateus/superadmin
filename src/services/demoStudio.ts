import { api } from './api'
import type { CtaConfig, DemoSettings, DemoTheme, PlayerDemo, StepKind } from '@/lib/demoStudio/types'
import type { Caixa } from '@/lib/demoStudio/layout'

/** API do Demo Studio (rotas /api/ds/* do servidor — ver docs/demo-studio/ADAPTACAO.md). */

const API_URL = import.meta.env.VITE_API_URL ?? ''

/** Endpoint de coleta de eventos do player (§8.2). */
export const URL_COLETA = `${API_URL}/api/t`

/** URL pública de um arquivo do storage (frame, miniatura). */
export function urlDoArquivo(chave: string | null | undefined): string {
  return chave ? `${API_URL}/files/${chave}` : ''
}

/** Endereço público da demo. Usa o domínio do Demo Studio quando configurado (PUBLIC_BASE_URL no servidor). */
export function urlPublicaDaDemo(slug: string, base: string | null | undefined): string {
  return `${(base || window.location.origin).replace(/\/+$/, '')}/d/${slug}`
}

export type DemoStatus = 'DRAFT' | 'PUBLISHED' | 'ARCHIVED'

export interface DemoResumo {
  id: string
  name: string
  slug: string
  description: string | null
  status: DemoStatus
  isTemplate: boolean
  segment: string | null
  theme: DemoTheme
  settings: DemoSettings
  coverFrameId: string | null
  publishedVersionId: string | null
  createdAt: string
  updatedAt: string
  stepsCount: number
  coverThumb: string | null
  views30d: number
  leads30d: number
}

export interface Frame {
  id: string
  name: string | null
  image: string
  thumb: string
  width: number
  height: number
  pixelRatio: number
  displayUrl: string | null
  createdAt: string
}

export interface Etapa {
  id: string
  order: number
  kind: StepKind
  frameId: string
  chapterId: string | null
  hotspot: Caixa | null
  title: string
  body: string
  placement: string
  buttonLabel: string | null
  cta: CtaConfig | null
  form: PlayerDemo['steps'][number]['form']
}

export interface DemoCompleta extends Omit<DemoResumo, 'stepsCount' | 'coverThumb' | 'views30d' | 'leads30d'> {
  frames: Frame[]
  steps: Etapa[]
  chapters: { id: string; name: string; order: number }[]
  versionsCount: number
  lastPublishedAt: string | null
}

export interface Versao {
  id: string
  number: number
  createdAt: string
  publishedBy: string | null
  stepsCount: number
  isCurrent: boolean
}

export interface MeuAcesso {
  role: 'ADMIN' | 'EDITOR' | 'SELLER'
  publicBaseUrl: string | null
}

export const demoStudio = {
  eu: () => api.get<MeuAcesso>('/api/ds/me'),
  listar: () => api.get<DemoResumo[]>('/api/ds/demos'),
  criar: (name: string, fromTemplateId?: string) => api.post<{ id: string }>('/api/ds/demos', { name, fromTemplateId }),
  obter: (id: string) => api.get<DemoCompleta>(`/api/ds/demos/${id}`),
  editar: (id: string, dados: Partial<Pick<DemoCompleta, 'name' | 'slug' | 'description' | 'isTemplate' | 'segment' | 'coverFrameId' | 'theme' | 'settings'>>) =>
    api.patch<{ ok: true }>(`/api/ds/demos/${id}`, dados),
  apagar: (id: string) => api.delete(`/api/ds/demos/${id}`),
  duplicar: (id: string) => api.post<{ id: string }>(`/api/ds/demos/${id}/duplicate`),
  rascunho: (id: string) => api.get<PlayerDemo>(`/api/ds/demos/${id}/draft`),
  publicar: (id: string) => api.post<{ ok: true; version: number; url: string }>(`/api/ds/demos/${id}/publish`),
  despublicar: (id: string) => api.post<{ ok: true }>(`/api/ds/demos/${id}/unpublish`),
  versoes: (id: string) => api.get<Versao[]>(`/api/ds/demos/${id}/versions`),
  restaurar: (id: string, n: number) => api.post<{ ok: true }>(`/api/ds/demos/${id}/versions/${n}/restore`),

  enviarFrame: (id: string, dados: { dataUrl: string; name?: string; pixelRatio?: number; displayUrl?: string; createStep?: StepKind }) =>
    api.post<Frame>(`/api/ds/demos/${id}/frames`, dados),
  editarFrame: (frameId: string, dados: { name?: string | null; displayUrl?: string | null }) =>
    api.patch<Frame>(`/api/ds/frames/${frameId}`, dados),
  apagarFrame: (frameId: string) => api.delete(`/api/ds/frames/${frameId}`),

  criarEtapa: (id: string, dados: { kind: StepKind; frameId: string; afterOrder?: number; hotspot?: Caixa | null }) =>
    api.post<Etapa>(`/api/ds/demos/${id}/steps`, dados),
  editarEtapa: (stepId: string, dados: Partial<Omit<Etapa, 'id' | 'order' | 'chapterId'>>) =>
    api.patch<Etapa>(`/api/ds/steps/${stepId}`, dados),
  apagarEtapa: (stepId: string) => api.delete(`/api/ds/steps/${stepId}`),
  reordenar: (id: string, ids: string[]) => api.post<{ ok: true }>(`/api/ds/demos/${id}/steps/reorder`, { ids }),
}

/* ------------------------------------------------------------------ analytics (M2) */

export interface FiltroAnalytics {
  from: string
  to: string
  demoId?: string
  linkId?: string
  sellerId?: string
}

export interface ResumoAnalytics {
  views: number
  unicos: number
  taxaConclusao: number
  tempoMedioMs: number
  engajamentoMedio: number
  cliquesCta: number
  sessoesComLead: number
  conversaoLead: number
}

export interface Contagem {
  chave: string
  views: number
  concluidas: number
}

export interface SessaoResumo {
  id: string
  startedAt: string
  lastSeenAt: string
  demo: { id: string; name: string }
  lead: { id: string; name: string | null; company: string | null } | null
  link: { id: string; label: string } | null
  channel: string
  device: string | null
  browser: string | null
  os: string | null
  activeMs: number
  stepsViewed: number
  totalSteps: number
  maxStepOrder: number
  completed: boolean
  ctaClicked: boolean
}

export interface VisaoGeral {
  periodo: { de: string; ate: string }
  resumo: ResumoAnalytics
  leads: number
  serie: { dia: string; views: number; unicos: number }[]
  dispositivos: Contagem[]
  canais: Contagem[]
  demos: (Contagem & { nome: string })[]
  aoVivo: number
  recentes: SessaoResumo[]
}

export interface LinhaFunil {
  order: number
  title: string
  kind: string
  sessoes: number
  pct: number
  queda: number
}

export interface EventoDaSessao {
  type: string
  stepId: string | null
  order: number | null
  data: Record<string, unknown> | null
  ts: string
}

export interface SessaoDetalhe extends SessaoResumo {
  internal: boolean
  utm: Record<string, string>
  steps: { id: string; order: number; title: string; kind: string }[]
  events: EventoDaSessao[]
}

export interface OpcoesDeFiltro {
  links: { id: string; label: string; kind: string; demoId: string; demoName: string }[]
  vendedores: { id: string; name: string }[]
}

function qs(f: object): string {
  const p = new URLSearchParams()
  Object.entries(f).forEach(([k, v]) => { if (v !== undefined && v !== '') p.set(k, String(v)) })
  return p.toString()
}

export const analytics = {
  visaoGeral: (f: FiltroAnalytics) => api.get<VisaoGeral>(`/api/ds/analytics?${qs(f)}`),
  funil: (f: FiltroAnalytics & { demoId: string }) => api.get<LinhaFunil[]>(`/api/ds/analytics/funnel?${qs(f)}`),
  filtros: () => api.get<OpcoesDeFiltro>('/api/ds/analytics/filters'),
  sessoes: (f: FiltroAnalytics & { limit?: number; offset?: number }) =>
    api.get<{ total: number; sessions: SessaoResumo[] }>(`/api/ds/sessions?${qs(f)}`),
  sessao: (id: string) => api.get<SessaoDetalhe>(`/api/ds/sessions/${id}`),
}

/* ------------------------------------------------------------------ links, leads e configurações (M3) */

export type StatusLead = 'NOVO' | 'EM_CONTATO' | 'QUALIFICADO' | 'GANHO' | 'PERDIDO'
export const ROTULO_STATUS: Record<StatusLead, string> = {
  NOVO: 'Novo',
  EM_CONTATO: 'Em contato',
  QUALIFICADO: 'Qualificado',
  GANHO: 'Ganho',
  PERDIDO: 'Perdido',
}

export interface LinkDemo {
  id: string
  code: string
  kind: 'CHANNEL' | 'PERSONAL'
  label: string
  demo: { id: string; name: string; slug: string; status: DemoStatus }
  createdBy: { id: string; name: string | null } | null
  lead: { id: string; name: string | null; company: string | null } | null
  variables: { nome?: string; empresa?: string; vendedor?: string }
  utm: { source?: string; medium?: string; campaign?: string }
  active: boolean
  expiresAt: string | null
  createdAt: string
  views: number
  leads: number
  completed: number
  lastSeenAt: string | null
}

export interface Lead {
  id: string
  name: string | null
  company: string | null
  phone: string | null
  email: string | null
  role: string | null
  cnpj: string | null
  status: StatusLead
  score: number
  hot: boolean
  owner: { id: string; name: string | null } | null
  source: { demoId: string | null; demoName: string | null; linkLabel: string | null; channel: string | null }
  notes: string | null
  firstSeenAt: string
  lastSeenAt: string
  sessions: number
  maxPct: number
  ctaClicked: boolean
}

export interface LeadDetalhe extends Lead {
  sessionsList: { id: string; startedAt: string; activeMs: number; stepsViewed: number; totalSteps: number; completed: boolean; ctaClicked: boolean; device: string | null; demoName: string; linkLabel: string | null }[]
  links: LinkDemo[]
}

export interface Webhook {
  id: string
  url: string
  secret: string
  events: string[]
  active: boolean
  createdAt: string
  failed: number
  lastDeliveryAt: string | null
}

export interface EntregaWebhook {
  id: string
  event: string
  status: 'PENDING' | 'SUCCESS' | 'FAILED'
  attempts: number
  responseCode: number | null
  responseBody: string | null
  createdAt: string
  nextAttemptAt: string
}

export interface UsuarioDoModulo {
  id: string
  name: string | null
  email: string
  role: string
  hasAccess: boolean
  dsRole: 'ADMIN' | 'EDITOR' | 'SELLER'
}

export interface ConfigWorkspace {
  ctaDefault?: { phone?: string; message?: string }
  privacyUrl?: string
  consentText?: string
}

export type NovoLink =
  | { kind: 'CHANNEL'; label: string; utm?: { source?: string; medium?: string; campaign?: string }; expiresAt?: string | null }
  | { kind: 'PERSONAL'; nome: string; empresa: string; whatsapp: string; label?: string; expiresAt?: string | null }

export const crm = {
  links: (f: { demoId?: string; scope?: 'mine' | 'all' } = {}) => api.get<LinkDemo[]>(`/api/ds/links?${qs(f)}`),
  criarLink: (demoId: string, dados: NovoLink) => api.post<LinkDemo>(`/api/ds/demos/${demoId}/links`, dados),
  editarLink: (id: string, dados: { label?: string; active?: boolean; expiresAt?: string | null }) => api.patch<LinkDemo>(`/api/ds/links/${id}`, dados),
  leads: (f: { status?: string; ownerId?: string; demoId?: string; q?: string; quentes?: '1' } = {}) => api.get<Lead[]>(`/api/ds/leads?${qs(f)}`),
  lead: (id: string) => api.get<LeadDetalhe>(`/api/ds/leads/${id}`),
  editarLead: (id: string, dados: Partial<{ status: StatusLead; ownerId: string | null; notes: string | null; name: string | null; company: string | null; phone: string | null; email: string | null; role: string | null }>) =>
    api.patch<Lead>(`/api/ds/leads/${id}`, dados),
  apagarLead: (id: string) => api.delete(`/api/ds/leads/${id}`),
  pessoas: () => api.get<{ id: string; name: string | null }[]>('/api/ds/people'),
  usuarios: () => api.get<UsuarioDoModulo[]>('/api/ds/users'),
  editarUsuario: (id: string, dados: { hasAccess?: boolean; dsRole?: 'EDITOR' | 'SELLER' }) => api.patch(`/api/ds/users/${id}`, dados),
  config: () => api.get<ConfigWorkspace>('/api/ds/settings'),
  salvarConfig: (dados: ConfigWorkspace) => api.patch('/api/ds/settings', dados),
  webhooks: () => api.get<Webhook[]>('/api/ds/webhooks'),
  criarWebhook: (dados: { url: string; events: string[] }) => api.post<{ id: string }>('/api/ds/webhooks', dados),
  editarWebhook: (id: string, dados: { url?: string; events?: string[]; active?: boolean; regenerateSecret?: boolean }) => api.patch(`/api/ds/webhooks/${id}`, dados),
  apagarWebhook: (id: string) => api.delete(`/api/ds/webhooks/${id}`),
  testarWebhook: (id: string) => api.post<{ ok: boolean; status: number | null; body: string }>(`/api/ds/webhooks/${id}/test`),
  entregas: (id: string) => api.get<EntregaWebhook[]>(`/api/ds/webhooks/${id}/deliveries`),
}

/** Endereço público de um link nomeado/personalizado. */
export function urlDoLink(code: string, base: string | null | undefined): string {
  return `${(base || window.location.origin).replace(/\/+$/, '')}/l/${code}`
}

export interface LinkPublico {
  demo: PlayerDemo
  linkCode: string
  variables: { nome: string; empresa: string; vendedor: string }
  utm: Record<string, string>
  leadKnown: boolean
}

/** Link nomeado/personalizado, sem login. */
export async function linkPublico(code: string): Promise<LinkPublico | null> {
  const res = await fetch(`${API_URL}/api/public/ds/links/${encodeURIComponent(code)}`)
  if (res.status === 404) return null
  if (!res.ok) throw new Error('Não foi possível carregar a demo.')
  return res.json()
}

/** Envio do formulário de lead / CTA com nome e empresa, sem login. */
export async function enviarLeadPublico(dados: {
  demoId: string
  sessionId: string
  visitorId: string
  linkCode?: string
  origem: 'form' | 'cta'
  consent?: boolean
  fields: Record<string, string>
}): Promise<void> {
  const res = await fetch(`${API_URL}/api/public/ds/leads`, {
    method: 'POST',
    // text/plain = requisição simples: sem preflight de CORS entre o domínio da demo e o da API.
    headers: { 'Content-Type': 'text/plain' },
    body: JSON.stringify(dados),
    keepalive: dados.origem === 'cta',
  })
  if (!res.ok && res.status !== 204) {
    const corpo = await res.json().catch(() => ({}))
    throw new Error((corpo as { message?: string }).message || 'Não foi possível enviar. Tente de novo.')
  }
}

/** Versão publicada, sem login (player público). */
export async function demoPublicada(slug: string): Promise<PlayerDemo | null> {
  const res = await fetch(`${API_URL}/api/public/ds/demos/${encodeURIComponent(slug)}`)
  if (res.status === 404) return null
  if (!res.ok) throw new Error('Não foi possível carregar a demo.')
  return res.json()
}

/** Lê um arquivo do computador como data URL (upload de telas). */
export function lerComoDataUrl(arquivo: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(String(r.result))
    r.onerror = () => reject(new Error('Não foi possível ler o arquivo.'))
    r.readAsDataURL(arquivo)
  })
}
