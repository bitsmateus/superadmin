import type { PipelineStage } from '@/types/client'

export interface StageStyle {
  bg: string
  text: string
  label: string
  ring: string
  dot: string
}

export const STAGE_COLORS: Record<PipelineStage, StageStyle> = {
  lead: {
    bg: 'rgba(136,135,128,0.15)',
    text: '#A0A0A0',
    ring: 'rgba(136,135,128,0.30)',
    dot: '#A0A0A0',
    label: 'Lead',
  },
  welcome: {
    bg: 'rgba(79,142,247,0.15)',
    text: '#4F8EF7',
    ring: 'rgba(79,142,247,0.30)',
    dot: '#4F8EF7',
    label: 'Boas-vindas',
  },
  contract: {
    bg: 'rgba(167,139,250,0.15)',
    text: '#A78BFA',
    ring: 'rgba(167,139,250,0.30)',
    dot: '#A78BFA',
    label: 'Contrato',
  },
  briefing: {
    bg: 'rgba(245,158,11,0.15)',
    text: '#F59E0B',
    ring: 'rgba(245,158,11,0.30)',
    dot: '#F59E0B',
    label: 'Briefing',
  },
  setup: {
    bg: 'rgba(52,211,153,0.15)',
    text: '#34D399',
    ring: 'rgba(52,211,153,0.30)',
    dot: '#34D399',
    label: 'Configuração',
  },
  delivery: {
    bg: 'rgba(251,146,60,0.15)',
    text: '#FB923C',
    ring: 'rgba(251,146,60,0.30)',
    dot: '#FB923C',
    label: 'Entrega',
  },
  active: {
    bg: 'rgba(34,197,94,0.15)',
    text: '#22C55E',
    ring: 'rgba(34,197,94,0.30)',
    dot: '#22C55E',
    label: 'Ativo',
  },
  churned: {
    bg: 'rgba(248,113,113,0.15)',
    text: '#F87171',
    ring: 'rgba(248,113,113,0.30)',
    dot: '#F87171',
    label: 'Cancelado',
  },
}

export const PIPELINE_STAGES: PipelineStage[] = [
  'welcome',
  'contract',
  'briefing',
  'setup',
  'delivery',
  'active',
]

export const NEXT_STAGE: Partial<Record<PipelineStage, PipelineStage>> = {
  welcome: 'contract',
  contract: 'briefing',
  briefing: 'setup',
  setup: 'delivery',
  delivery: 'active',
}
