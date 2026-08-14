// Espelho de src/types/chatbotFlow.ts (o server é um projeto TS separado, com
// rootDir próprio, e não importa de ../../src). Mantenha os dois em sincronia.

export interface FlowSpec {
  name: string;
  start: string;
  steps: FlowStep[];
}

export type FlowStep = FlowAskStep | FlowMenuStep | FlowEndStep;

export interface FlowAskStep {
  id: string;
  name: string;
  type: 'ask';
  message: string;
  next: string;
}

export interface FlowMenuStep {
  id: string;
  name: string;
  type: 'menu';
  message: string;
  render?: FlowRender;
  options: FlowOption[];
}

export interface FlowEndStep {
  id: string;
  name: string;
  type: 'end';
  message: string;
  transferToQueue?: string;
}

export type FlowRender = 'auto' | 'buttons' | 'list';

export interface FlowOption {
  label: string;
  desc?: string;
  section?: string;
  next?: string;
  transferToQueue?: string;
}

export interface FlowValidation {
  errors: string[];
  warnings: string[];
}

// ── Formato do JSON final do chatbot (o que a ferramenta do NX importa) ──────────
// Só o subconjunto que o builder emite. Ver docs/chatbot-flow-format.md.

export interface FlowJson {
  name: string;
  nodeList: FlowNode[];
  lineList: FlowLine[];
}

export interface FlowNode {
  id: string;
  name: string;
  type: 'start' | 'configurations' | 'node';
  left: string;
  top: string;
  ico?: string;
  viewOnly?: boolean;
  status?: string;
  style?: Record<string, unknown>;
  configurations?: Record<string, unknown>;
  interactions?: FlowInteraction[];
  conditions?: FlowCondition[];
  actions?: unknown[];
}

export type FlowInteraction =
  | { id: string; type: 'MessageField'; data: { message: string } }
  | {
      id: string;
      type: 'ButtonField';
      data: { message: string; button1: string; button2?: string; button3?: string };
    }
  | {
      id: string;
      type: 'ListField';
      data: {
        message: string;
        sections: { title: string; rows: { title: string; desc: string }[] }[];
        choices: unknown[];
      };
    };

export interface FlowCondition {
  id: string;
  action: 0 | 1; // 0 = segue para outro passo · 1 = transfere para fila
  nextStepId: string;
  queueId?: string;
  type: 'R' | 'US'; // R = resposta do cliente · US = texto livre
  comparisonType: 'equals' | 'contains' | '';
  condition: string[];
  value: string;
}

export interface FlowLine {
  from: string;
  to: string;
  label?: string;
  paintStyle: { strokeWidth: number; stroke: string };
}
