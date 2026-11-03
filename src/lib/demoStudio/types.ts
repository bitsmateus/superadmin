/**
 * O que o player recebe: a versão publicada (snapshot) ou o rascunho, no mesmo formato.
 * Espelha `server/src/lib/demoStudio/snapshot.ts` — mudou lá, muda aqui.
 */
import type { Caixa } from './layout'

export type StepKind = 'HOTSPOT' | 'MODAL' | 'LEAD_FORM' | 'CTA'

export interface DemoTheme {
  accent?: string
  brandName?: string
  logoText?: string
}

export interface DemoSettings {
  showProgress?: boolean
  showRestart?: boolean
  leadGateStep?: number | null
  ctaPhone?: string
  ctaMessage?: string
}

export interface CtaConfig {
  type: 'WHATSAPP' | 'URL'
  phone?: string
  message?: string
  url?: string
  buttonLabel?: string
  /** Campos que o cartão pede antes do botão (entram na mensagem): 'nome', 'empresa'. */
  collect?: string[]
}

export interface PlayerFrame {
  id: string
  /** Chave no storage; a URL é `${API}/files/${image}`. */
  image: string
  width: number
  height: number
  displayUrl: string | null
}

export interface PlayerStep {
  id: string
  order: number
  kind: StepKind
  frameId: string
  hotspot: Caixa | null
  title: string
  body: string
  placement: string
  buttonLabel: string | null
  chapter: string | null
  cta: CtaConfig | null
  form: { fields: { key: string; label: string; required?: boolean }[]; consentText?: string } | null
}

export interface PlayerDemo {
  id: string
  versionId: string | null
  versionNumber: number | null
  name: string
  slug: string
  description: string | null
  theme: DemoTheme
  settings: DemoSettings
  chapters: string[]
  frames: PlayerFrame[]
  steps: PlayerStep[]
}
