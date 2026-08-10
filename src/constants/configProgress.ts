import type { MetaVerificationStatus, PartnerAccessStatus } from '@/types/client'

/**
 * Passos da configuração de API Oficial e de IA. São checklists COM ESTADO
 * (feito/pendente + timestamp), não um único checkbox binário — servem para
 * enxergar em que pé está a config de cada cliente antes de marcar reunião.
 */
export interface ConfigStepDef {
  key: string
  label: string
}

export const API_CONFIG_STEPS: ConfigStepDef[] = [
  { key: 'bm_verificado', label: 'BM verificado' },
  { key: 'numero_adicionado', label: 'Número adicionado' },
  { key: 'display_name_aprovado', label: 'Display name aprovado' },
  { key: 'webhook_token', label: 'Webhook/token configurado' },
  { key: 'testado', label: 'Testado' },
]

export const IA_CONFIG_STEPS: ConfigStepDef[] = [
  { key: 'prompt_criado', label: 'Prompt criado' },
  { key: 'base_conhecimento', label: 'Base de conhecimento carregada' },
  { key: 'testado', label: 'Testado' },
  { key: 'demo_realizada', label: 'Demo realizada' },
  { key: 'entrega_realizada', label: 'Entrega realizada' },
]

export const META_VERIFICATION_LABELS: Record<MetaVerificationStatus, string> = {
  nao_iniciada: 'Não iniciada',
  em_analise: 'Em análise',
  aprovada: 'Aprovada',
}

export const PARTNER_ACCESS_LABELS: Record<PartnerAccessStatus, string> = {
  pendente: 'Pendente',
  concedido: 'Concedido',
}
