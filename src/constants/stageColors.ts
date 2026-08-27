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
  setup_start: {
    bg: 'rgba(129,140,248,0.15)',
    text: '#818CF8',
    ring: 'rgba(129,140,248,0.30)',
    dot: '#818CF8',
    label: 'Iniciar Configuração',
  },
  setup: {
    bg: 'rgba(52,211,153,0.15)',
    text: '#34D399',
    ring: 'rgba(52,211,153,0.30)',
    dot: '#34D399',
    label: 'Em Configuração',
  },
  setup_done: {
    bg: 'rgba(45,212,191,0.15)',
    text: '#2DD4BF',
    ring: 'rgba(45,212,191,0.30)',
    dot: '#2DD4BF',
    label: 'Pronto para Entrega',
  },
  delivery: {
    bg: 'rgba(251,146,60,0.15)',
    text: '#FB923C',
    ring: 'rgba(251,146,60,0.30)',
    dot: '#FB923C',
    label: 'Entrega Marcado',
  },
  delivered: {
    bg: 'rgba(34,211,238,0.15)',
    text: '#22D3EE',
    ring: 'rgba(34,211,238,0.30)',
    dot: '#22D3EE',
    label: 'Entregas Recentes',
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
  'setup_start',
  'setup',
  'setup_done',
  'delivery',
  'delivered',
  'active',
]

export const NEXT_STAGE: Partial<Record<PipelineStage, PipelineStage>> = {
  welcome: 'contract',
  contract: 'briefing',
  briefing: 'setup_start',
  setup_start: 'setup',
  setup: 'setup_done',
  setup_done: 'delivery',
  delivery: 'delivered',
  delivered: 'active',
}

export const PREV_STAGE: Partial<Record<PipelineStage, PipelineStage>> = {
  contract: 'welcome',
  briefing: 'contract',
  setup_start: 'briefing',
  setup: 'setup_start',
  setup_done: 'setup',
  delivery: 'setup_done',
  delivered: 'delivery',
  active: 'delivered',
}

/**
 * SLA (em dias) esperado por etapa. Usado no pipeline pra destacar quem está
 * parado tempo demais. Etapas sem SLA (lead, active, churned) não alertam.
 * "Entregas Recentes" (delivered) usa 30 dias: passado esse prazo, é o sinal
 * para mover manualmente o cliente para Ativo.
 */
export const STAGE_SLA_DAYS: Partial<Record<PipelineStage, number>> = {
  welcome: 2,
  contract: 3,
  briefing: 5,
  setup_start: 2,
  setup: 3,
  setup_done: 2,
  delivery: 3,
  delivered: 30,
}

/** Etapas que têm SLA configurável (as demais — lead/active/churned — não). */
export const SLA_STAGES: PipelineStage[] = [
  'welcome',
  'contract',
  'briefing',
  'setup_start',
  'setup',
  'setup_done',
  'delivery',
  'delivered',
]

/**
 * SLA (em dias) da etapa: usa o override das configurações quando presente
 * (número > 0); senão cai para o default de STAGE_SLA_DAYS. Retorna undefined
 * para etapas sem SLA (lead/active/churned).
 */
export function resolveStageSla(
  stage: PipelineStage,
  overrides?: Partial<Record<PipelineStage, number>>,
): number | undefined {
  const o = overrides?.[stage]
  if (typeof o === 'number' && o > 0) return o
  return STAGE_SLA_DAYS[stage]
}
