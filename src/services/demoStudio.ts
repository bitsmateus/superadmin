import { api } from './api'
import type { CtaConfig, DemoSettings, DemoTheme, PlayerDemo, StepKind } from '@/lib/demoStudio/types'
import type { Caixa } from '@/lib/demoStudio/layout'

/** API do Demo Studio (rotas /api/ds/* do servidor — ver docs/demo-studio/ADAPTACAO.md). */

const API_URL = import.meta.env.VITE_API_URL ?? ''

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
