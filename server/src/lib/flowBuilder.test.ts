import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildFlowJson } from './flowBuilder.js';
import { validateSpec } from './flowValidator.js';
import type { FlowSpec, FlowNode } from './flowSpec.js';

// Fixture: menu de boas-vindas (2 botões) → coleta de texto → encerramento,
// com um ramo que transfere para uma fila. Cobre ask/menu/end + transfer.
const fixture: FlowSpec = {
  name: 'Fixture',
  start: 'boas-vindas',
  steps: [
    {
      id: 'boas-vindas',
      name: 'Boas vindas',
      type: 'menu',
      message: 'Olá! Como podemos ajudar?',
      options: [
        { label: 'Comprar', next: 'cnpj' },
        { label: 'Suporte', transferToQueue: '312' },
      ],
    },
    { id: 'cnpj', name: 'CNPJ', type: 'ask', message: 'Digite seu CNPJ:', next: 'fim' },
    { id: 'fim', name: 'Encerramento', type: 'end', message: 'Obrigado! Já te chamamos.' },
  ],
};

function nodeByName(nodes: FlowNode[], name: string): FlowNode {
  const n = nodes.find((x) => x.name === name);
  assert.ok(n, `nó "${name}" não encontrado`);
  return n!;
}

test('fixture é válida', () => {
  const { errors } = validateSpec(fixture);
  assert.deepEqual(errors, []);
});

test('emite start + configurations + um nó por passo', () => {
  const { json } = buildFlowJson(fixture);
  assert.equal(json.nodeList[0].type, 'start');
  assert.equal(json.nodeList[1].type, 'configurations');
  assert.equal(json.nodeList.length, 2 + fixture.steps.length); // 2 fixos + 3 passos
});

test('o passo start vira nodeC', () => {
  const { json } = buildFlowJson(fixture);
  const nodeC = json.nodeList.find((n) => n.id === 'nodeC');
  assert.ok(nodeC);
  assert.equal(nodeC!.name, 'Boas vindas');
  // linha start -> nodeC sem label
  const l = json.lineList.find((x) => x.from === 'start' && x.to === 'nodeC');
  assert.ok(l);
  assert.equal(l!.label, undefined);
});

test('menu com 2 opções vira ButtonField; transferência é action 1', () => {
  const { json } = buildFlowJson(fixture);
  const nodeC = nodeByName(json.nodeList, 'Boas vindas');
  assert.equal(nodeC.interactions![0].type, 'ButtonField');
  const transfer = nodeC.conditions!.find((c) => c.action === 1);
  assert.ok(transfer, 'esperava uma condição de transferência');
  assert.equal(transfer!.queueId, '312');
  assert.equal(transfer!.nextStepId, '');
});

test('ask vira MessageField + condição US', () => {
  const { json } = buildFlowJson(fixture);
  const ask = nodeByName(json.nodeList, 'CNPJ');
  assert.equal(ask.interactions![0].type, 'MessageField');
  assert.equal(ask.conditions![0].type, 'US');
  assert.equal(ask.conditions![0].action, 0);
});

test('end sem transferência tem conditions vazio', () => {
  const { json } = buildFlowJson(fixture);
  const end = nodeByName(json.nodeList, 'Encerramento');
  assert.deepEqual(end.conditions, []);
});

test('menu de 3 vira botões; 4 vira lista; 11 é erro de validação', () => {
  const opt = (i: number) => ({ label: `Op ${i}`, next: 'fim' });
  const base = (n: number): FlowSpec => ({
    name: 'x',
    start: 'm',
    steps: [
      { id: 'm', name: 'M', type: 'menu', message: 'Escolha', options: Array.from({ length: n }, (_, i) => opt(i + 1)) },
      { id: 'fim', name: 'Fim', type: 'end', message: 'ok' },
    ],
  });

  const three = buildFlowJson(base(3)).json;
  assert.equal(nodeByName(three.nodeList, 'M').interactions![0].type, 'ButtonField');

  const four = buildFlowJson(base(4)).json;
  assert.equal(nodeByName(four.nodeList, 'M').interactions![0].type, 'ListField');

  const eleven = validateSpec(base(11));
  assert.ok(eleven.errors.some((e) => /máx\. 10|quebre em submenus/i.test(e)));
});

test('determinismo: buildar duas vezes gera JSON idêntico', () => {
  const a = JSON.stringify(buildFlowJson(fixture).json);
  const b = JSON.stringify(buildFlowJson(fixture).json);
  assert.equal(a, b);
});
