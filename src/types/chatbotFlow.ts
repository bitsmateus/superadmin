// ── FlowSpec ──────────────────────────────────────────────────────────────────
// Roteiro simples e validável que a IA produz a partir do briefing. O builder
// determinístico (server/src/lib/flowBuilder.ts) converte isto no JSON final do
// chatbot (nodeList/lineList). A IA NUNCA gera o JSON final — só o FlowSpec.
//
// IMPORTANTE: este tipo é espelhado em server/src/lib/flowSpec.ts (o server é um
// projeto TS separado, com rootDir próprio). Mantenha os dois em sincronia.

export interface FlowSpec {
  name: string
  /** id do primeiro passo (vira o nó `nodeC` no JSON final). */
  start: string
  steps: FlowStep[]
}

export type FlowStep = FlowAskStep | FlowMenuStep | FlowEndStep

export interface FlowAskStep {
  id: string // slug kebab-case, ex.: "cnpj"
  name: string // rótulo do nó no canvas (não vai pro cliente)
  type: 'ask' // pergunta aberta (texto livre)
  message: string
  next: string // id do próximo passo
}

export interface FlowMenuStep {
  id: string
  name: string
  type: 'menu'
  message: string
  render?: FlowRender // default 'auto'
  options: FlowOption[]
}

export interface FlowEndStep {
  id: string
  name: string
  type: 'end'
  message: string
  transferToQueue?: string // opcional: joga na fila ao encerrar
}

export type FlowRender = 'auto' | 'buttons' | 'list'

export interface FlowOption {
  label: string // texto do botão / título da linha da lista
  desc?: string // só usado quando vira lista
  section?: string // agrupamento na lista (opcional)
  next?: string // id do próximo passo
  transferToQueue?: string // alternativa a `next`: transfere pra fila
}

// Resultado da validação. Erros bloqueiam; avisos deixam baixar.
export interface FlowValidation {
  errors: string[]
  warnings: string[]
}
