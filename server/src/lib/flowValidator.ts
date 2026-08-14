import type { FlowSpec, FlowStep, FlowMenuStep, FlowValidation, FlowJson } from './flowSpec.js';

// Limites do WhatsApp (ver docs/chatbot-flow-format.md).
const LIMITS = {
  buttonsPerMessage: 3,
  buttonText: 20,
  listRowsTotal: 10,
  sectionTitle: 24,
  rowTitle: 24,
  rowDesc: 72,
  messageBody: 1024,
};

/** Render efetivo de um menu (mesma regra do builder). */
function effectiveRender(menu: FlowMenuStep): 'buttons' | 'list' {
  if (menu.render === 'buttons') return 'buttons';
  if (menu.render === 'list') return 'list';
  return menu.options.length <= 3 ? 'buttons' : 'list';
}

/** Passos-destino (próximo nó) — não inclui transferências, que saem do fluxo. */
function outgoing(step: FlowStep): string[] {
  if (step.type === 'ask') return [step.next];
  if (step.type === 'menu')
    return step.options.map((o) => o.next).filter((x): x is string => Boolean(x));
  return [];
}

/** É um ponto de saída do fluxo? (encerramento ou transferência) */
function isTerminal(step: FlowStep): boolean {
  if (step.type === 'end') return true;
  if (step.type === 'menu') return step.options.some((o) => o.transferToQueue);
  return false;
}

export function validateSpec(spec: FlowSpec): FlowValidation {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!spec || !Array.isArray(spec.steps) || spec.steps.length === 0) {
    return { errors: ['O fluxo não tem passos.'], warnings };
  }
  if (!spec.name?.trim()) warnings.push('O fluxo não tem nome.');

  // ids únicos + índice
  const byId = new Map<string, FlowStep>();
  for (const step of spec.steps) {
    if (!step.id?.trim()) {
      errors.push('Há um passo sem id.');
      continue;
    }
    if (byId.has(step.id)) errors.push(`Id de passo repetido: "${step.id}".`);
    byId.set(step.id, step);
  }

  if (!spec.start || !byId.has(spec.start)) {
    errors.push(`O passo inicial "${spec.start}" não existe.`);
  }

  // Validação por passo
  for (const step of spec.steps) {
    const where = `passo "${step.name || step.id}"`;
    if (step.message && step.message.length > LIMITS.messageBody) {
      errors.push(`${where}: a mensagem passa de ${LIMITS.messageBody} caracteres.`);
    }

    if (step.type === 'ask') {
      if (!byId.has(step.next)) errors.push(`${where}: "next" aponta para um passo inexistente ("${step.next}").`);
    } else if (step.type === 'menu') {
      if (!step.options || step.options.length === 0) {
        errors.push(`${where}: menu sem opções.`);
        continue;
      }
      const render = effectiveRender(step);
      const seenLabels = new Set<string>();
      for (const o of step.options) {
        const hasNext = Boolean(o.next);
        const hasQueue = Boolean(o.transferToQueue);
        if (hasNext && hasQueue)
          errors.push(`${where}: a opção "${o.label}" tem "next" E "transferToQueue" (use só um).`);
        if (!hasNext && !hasQueue)
          errors.push(`${where}: a opção "${o.label}" não tem "next" nem "transferToQueue".`);
        if (hasNext && !byId.has(o.next!))
          errors.push(`${where}: a opção "${o.label}" aponta para um passo inexistente ("${o.next}").`);
        const key = o.label.trim().toLowerCase();
        if (seenLabels.has(key)) errors.push(`${where}: opção com rótulo repetido ("${o.label}").`);
        seenLabels.add(key);
      }
      // Limites por tipo de render
      if (render === 'buttons') {
        if (step.options.length > LIMITS.buttonsPerMessage)
          errors.push(`${where}: ${step.options.length} botões (máx. ${LIMITS.buttonsPerMessage}). Use lista ou quebre em submenus.`);
        for (const o of step.options)
          if (o.label.length > LIMITS.buttonText)
            errors.push(`${where}: o botão "${o.label}" passa de ${LIMITS.buttonText} caracteres.`);
      } else {
        if (step.options.length > LIMITS.listRowsTotal)
          errors.push(`${where}: ${step.options.length} itens na lista (máx. ${LIMITS.listRowsTotal}). Quebre em submenus.`);
        const sections = new Set<string>();
        for (const o of step.options) {
          const sec = o.section?.trim() || 'Opções';
          sections.add(sec);
          if (sec.length > LIMITS.sectionTitle)
            errors.push(`${where}: título de seção "${sec}" passa de ${LIMITS.sectionTitle} caracteres.`);
          if (o.label.length > LIMITS.rowTitle)
            errors.push(`${where}: o item "${o.label}" passa de ${LIMITS.rowTitle} caracteres.`);
          if (o.desc && o.desc.length > LIMITS.rowDesc)
            errors.push(`${where}: a descrição de "${o.label}" passa de ${LIMITS.rowDesc} caracteres.`);
        }
      }
    } else if (step.type === 'end') {
      // ok — encerramento; transferToQueue é opcional
    }
  }

  // Alcançabilidade a partir do start
  if (spec.start && byId.has(spec.start)) {
    const reachable = new Set<string>([spec.start]);
    const stack = [spec.start];
    while (stack.length) {
      const cur = byId.get(stack.pop()!)!;
      for (const t of outgoing(cur)) {
        if (byId.has(t) && !reachable.has(t)) {
          reachable.add(t);
          stack.push(t);
        }
      }
    }
    for (const step of spec.steps)
      if (!reachable.has(step.id))
        warnings.push(`O passo "${step.name || step.id}" é inalcançável a partir do início.`);

    // Todo passo alcançável precisa chegar a um encerramento/transferência.
    const canTerminate = new Set<string>();
    for (const step of spec.steps) if (isTerminal(step)) canTerminate.add(step.id);
    let changed = true;
    while (changed) {
      changed = false;
      for (const step of spec.steps) {
        if (canTerminate.has(step.id)) continue;
        if (outgoing(step).some((t) => canTerminate.has(t))) {
          canTerminate.add(step.id);
          changed = true;
        }
      }
    }
    for (const step of spec.steps)
      if (reachable.has(step.id) && !canTerminate.has(step.id))
        errors.push(`O passo "${step.name || step.id}" nunca alcança um encerramento (loop sem saída).`);
  }

  return { errors, warnings };
}

export function validateJson(json: FlowJson): FlowValidation {
  const errors: string[] = [];
  const warnings: string[] = [];
  if (!json || !Array.isArray(json.nodeList) || !Array.isArray(json.lineList)) {
    return { errors: ['JSON do fluxo malformado (falta nodeList/lineList).'], warnings };
  }
  const ids = new Set<string>();
  for (const n of json.nodeList) {
    if (ids.has(n.id)) errors.push(`nodeList com id repetido: "${n.id}".`);
    ids.add(n.id);
  }
  for (const l of json.lineList) {
    if (!ids.has(l.from)) errors.push(`Linha com origem inexistente: "${l.from}".`);
    if (!ids.has(l.to)) errors.push(`Linha com destino inexistente: "${l.to}".`);
  }
  return { errors, warnings };
}
