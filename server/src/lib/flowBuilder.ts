import type {
  FlowSpec,
  FlowStep,
  FlowMenuStep,
  FlowOption,
  FlowJson,
  FlowNode,
  FlowLine,
  FlowCondition,
  FlowInteraction,
} from './flowSpec.js';

export interface BuildOpts {
  /** Nome do fluxo no JSON final (default: spec.name). */
  flowName?: string;
  /** Mensagem de boas-vindas e de fora do horário vindas do briefing.
   *  DECISÃO DE CONTRATO: mantemos a boas-vindas no PRIMEIRO nó (é a mensagem do
   *  passo `start` da spec) e deixamos `configurations` com os defaults do doc.
   *  Só moveríamos para configurations.welcomeMessage/outOpenHours se tivéssemos
   *  certeza de que a ferramenta aceita — como não temos, ficam como defaults. */
  greeting?: string;
  offHours?: string;
  /** Canal API Oficial — usado pela IA para preferir botões; o builder é neutro. */
  apiOficial?: boolean;
}

const LINE_STYLE = { strokeWidth: 3, stroke: '#5c67f2' } as const;

/** Config padrão do nó `configurations` (igual ao golden koimas — tudo vazio). */
function defaultConfigurations(): Record<string, unknown> {
  return {
    notOptionsSelectMessage: { message: '', stepReturn: 'A' },
    notResponseMessage: { time: 10, type: 1, destiny: '', message: '' },
    welcomeMessage: { message: '' },
    farewellMessage: { message: '' },
    maxRetryBotMessage: { number: 3, type: 1, destiny: '' },
    outOpenHours: { type: 1, destiny: null },
    firstInteraction: { type: 1, destiny: null },
    keyword: { message: '', messages: [] },
  };
}

/** Passos que um passo aponta (destinos de próximo nó, sem transferências). */
function outgoingStepIds(step: FlowStep): string[] {
  if (step.type === 'ask') return [step.next];
  if (step.type === 'menu')
    return step.options.map((o) => o.next).filter((x): x is string => Boolean(x));
  return [];
}

/**
 * Converte um FlowSpec no JSON final do chatbot de forma DETERMINÍSTICA:
 * ids sequenciais (sem Date.now), layout por profundidade e limites do WhatsApp
 * respeitados. A mesma spec gera exatamente o mesmo JSON (golden test / diff).
 */
export function buildFlowJson(
  spec: FlowSpec,
  opts: BuildOpts = {},
): { json: FlowJson; warnings: string[] } {
  const warnings: string[] = [];

  // Contadores determinísticos (prefixo + incremento a partir de base fixa).
  let nodeSeq = 0;
  let intSeq = 0;
  let condSeq = 0;
  const newIntId = () => `int-${++intSeq}`;
  const newCondId = () => `cond-${++condSeq}`;

  // Mapa stepId -> nodeId (o passo `start` vira `nodeC`).
  const nodeIdOf = new Map<string, string>();
  for (const step of spec.steps) {
    nodeIdOf.set(step.id, step.id === spec.start ? 'nodeC' : `node-${++nodeSeq}`);
  }
  const resolve = (stepId: string | undefined): string =>
    (stepId && nodeIdOf.get(stepId)) || '';

  const byId = new Map(spec.steps.map((s) => [s.id, s]));

  // ── Layout: BFS a partir do start. left = 26 + profundidade*320; irmãos
  //    empilhados com 180px. (O golden compara estrutura, não coordenadas.)
  const depth = new Map<string, number>();
  const queue: string[] = [];
  if (byId.has(spec.start)) {
    depth.set(spec.start, 0);
    queue.push(spec.start);
  }
  while (queue.length) {
    const id = queue.shift()!;
    const step = byId.get(id);
    if (!step) continue;
    for (const target of outgoingStepIds(step)) {
      if (byId.has(target) && !depth.has(target)) {
        depth.set(target, (depth.get(id) ?? 0) + 1);
        queue.push(target);
      }
    }
  }
  const perDepthCount = new Map<number, number>();
  const posOf = (stepId: string): { left: string; top: string } => {
    const d = depth.get(stepId) ?? 0;
    const idx = perDepthCount.get(d) ?? 0;
    perDepthCount.set(d, idx + 1);
    return { left: `${26 + d * 320}px`, top: `${100 + idx * 180}px` };
  };

  // ── Nós fixos ──
  const nodeList: FlowNode[] = [
    {
      id: 'start',
      name: 'Início',
      type: 'start',
      left: '26px',
      top: '100px',
      ico: 'mdi-play',
      viewOnly: true,
      status: 'success',
      style: {},
    },
    {
      id: 'configurations',
      name: 'Configurações',
      type: 'configurations',
      left: '340px',
      top: '100px',
      viewOnly: true,
      ico: 'mdi-alert-circle-outline',
      configurations: defaultConfigurations(),
    },
  ];

  const lineList: FlowLine[] = [
    { from: 'start', to: 'nodeC', paintStyle: { ...LINE_STYLE } },
  ];

  // ── Interação de um passo ──
  function buildInteraction(step: FlowStep): FlowInteraction {
    if (step.type === 'ask' || step.type === 'end') {
      return { id: newIntId(), type: 'MessageField', data: { message: step.message } };
    }
    const menu = step as FlowMenuStep;
    const useButtons =
      menu.render === 'buttons' ||
      ((menu.render ?? 'auto') === 'auto' && menu.options.length <= 3);
    if (useButtons) {
      const labels = menu.options.map((o) => o.label);
      if (labels.length > 3) {
        warnings.push(
          `Menu "${menu.name}" tem ${labels.length} opções como botões; só as 3 primeiras entram.`,
        );
      }
      const [b1, b2, b3] = labels;
      const data: { message: string; button1: string; button2?: string; button3?: string } = {
        message: menu.message,
        button1: b1 ?? '',
      };
      if (b2 !== undefined) data.button2 = b2;
      if (b3 !== undefined) data.button3 = b3;
      return { id: newIntId(), type: 'ButtonField', data };
    }
    // Lista — agrupa por `section` na ordem de primeira aparição.
    const sections: { title: string; rows: { title: string; desc: string }[] }[] = [];
    const sectionIndex = new Map<string, number>();
    for (const o of menu.options) {
      const title = o.section?.trim() || 'Opções';
      if (!sectionIndex.has(title)) {
        sectionIndex.set(title, sections.length);
        sections.push({ title, rows: [] });
      }
      sections[sectionIndex.get(title)!].rows.push({ title: o.label, desc: o.desc ?? '' });
    }
    return {
      id: newIntId(),
      type: 'ListField',
      data: { message: menu.message, sections, choices: [] },
    };
  }

  // ── Condições (saídas) de um passo ──
  function buildConditions(step: FlowStep): FlowCondition[] {
    if (step.type === 'ask') {
      return [
        {
          id: newCondId(),
          action: 0,
          nextStepId: resolve(step.next),
          type: 'US',
          comparisonType: '',
          condition: [],
          value: '',
        },
      ];
    }
    if (step.type === 'end') {
      if (!step.transferToQueue) return [];
      return [
        {
          id: newCondId(),
          action: 1,
          nextStepId: '',
          queueId: step.transferToQueue,
          type: 'US',
          comparisonType: '',
          condition: [],
          value: '',
        },
      ];
    }
    // Menu: agrupa opções por destino (fila ou próximo passo), 1 condição cada.
    const menu = step as FlowMenuStep;
    const groups: { key: string; queueId?: string; next?: string; labels: string[] }[] = [];
    const groupIndex = new Map<string, number>();
    for (const o of menu.options) {
      const key = o.transferToQueue ? `q:${o.transferToQueue}` : `n:${o.next}`;
      if (!groupIndex.has(key)) {
        groupIndex.set(key, groups.length);
        groups.push({ key, queueId: o.transferToQueue, next: o.next, labels: [] });
      }
      groups[groupIndex.get(key)!].labels.push(o.label);
    }
    return groups.map((g) => {
      const value = g.labels.join(',');
      if (g.queueId) {
        return {
          id: newCondId(),
          action: 1 as const,
          nextStepId: '',
          queueId: g.queueId,
          type: 'R' as const,
          comparisonType: 'equals' as const,
          condition: g.labels,
          value,
        };
      }
      return {
        id: newCondId(),
        action: 0 as const,
        nextStepId: resolve(g.next),
        type: 'R' as const,
        comparisonType: 'equals' as const,
        condition: g.labels,
        value,
      };
    });
  }

  // ── Emite um nó por passo (na ordem da spec) ──
  for (const step of spec.steps) {
    const id = nodeIdOf.get(step.id)!;
    const { left, top } = posOf(step.id);
    const conditions = buildConditions(step);
    const node: FlowNode = {
      id,
      name: step.name,
      type: 'node',
      left,
      top,
      ...(id === 'nodeC' ? {} : { ico: 'mdi-robot-outline' }),
      interactions: [buildInteraction(step)],
      conditions,
      actions: [],
    };
    nodeList.push(node);

    // Linhas: uma por condição que aponta para um próximo nó (action 0).
    for (const c of conditions) {
      if (c.action === 0 && c.nextStepId) {
        lineList.push({
          from: id,
          to: c.nextStepId,
          ...(c.value ? { label: c.value } : {}),
          paintStyle: { ...LINE_STYLE },
        });
      }
    }
  }

  const json: FlowJson = { name: opts.flowName || spec.name, nodeList, lineList };
  return { json, warnings };
}
