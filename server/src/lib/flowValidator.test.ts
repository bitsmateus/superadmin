import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateSpec, validateJson } from './flowValidator.js';
import { buildFlowJson } from './flowBuilder.js';
import type { FlowSpec } from './flowSpec.js';

test('pega next quebrado', () => {
  const spec: FlowSpec = {
    name: 'x',
    start: 'a',
    steps: [{ id: 'a', name: 'A', type: 'ask', message: 'oi', next: 'inexistente' }],
  };
  const { errors } = validateSpec(spec);
  assert.ok(errors.some((e) => /inexistente/.test(e)));
});

test('pega passo órfão (aviso) e sem saída (erro)', () => {
  const spec: FlowSpec = {
    name: 'x',
    start: 'a',
    steps: [
      // 'a' aponta para 'a' — loop sem saída
      { id: 'a', name: 'A', type: 'ask', message: 'oi', next: 'a' },
      { id: 'orf', name: 'Órfão', type: 'end', message: 'fim' },
    ],
  };
  const { errors, warnings } = validateSpec(spec);
  assert.ok(warnings.some((w) => /inalcanç/i.test(w)), 'esperava aviso de órfão');
  assert.ok(errors.some((e) => /loop sem saída/i.test(e)), 'esperava erro de loop');
});

test('pega botão com mais de 20 caracteres', () => {
  const spec: FlowSpec = {
    name: 'x',
    start: 'm',
    steps: [
      {
        id: 'm',
        name: 'M',
        type: 'menu',
        message: 'Escolha',
        render: 'buttons',
        options: [{ label: 'Um botão bem longo demais mesmo', next: 'fim' }],
      },
      { id: 'fim', name: 'Fim', type: 'end', message: 'ok' },
    ],
  };
  const { errors } = validateSpec(spec);
  assert.ok(errors.some((e) => /20 caracteres/.test(e)));
});

test('pega lista com mais de 10 linhas', () => {
  const spec: FlowSpec = {
    name: 'x',
    start: 'm',
    steps: [
      {
        id: 'm',
        name: 'M',
        type: 'menu',
        message: 'Escolha',
        render: 'list',
        options: Array.from({ length: 11 }, (_, i) => ({ label: `Item ${i}`, next: 'fim' })),
      },
      { id: 'fim', name: 'Fim', type: 'end', message: 'ok' },
    ],
  };
  const { errors } = validateSpec(spec);
  assert.ok(errors.some((e) => /máx\. 10/.test(e)));
});

test('pega rótulos duplicados no mesmo menu', () => {
  const spec: FlowSpec = {
    name: 'x',
    start: 'm',
    steps: [
      {
        id: 'm',
        name: 'M',
        type: 'menu',
        message: 'Escolha',
        options: [
          { label: 'Sim', next: 'fim' },
          { label: 'sim', next: 'fim' },
        ],
      },
      { id: 'fim', name: 'Fim', type: 'end', message: 'ok' },
    ],
  };
  const { errors } = validateSpec(spec);
  assert.ok(errors.some((e) => /repetido/.test(e)));
});

test('validateJson pega linha com destino inexistente', () => {
  const spec: FlowSpec = {
    name: 'x',
    start: 'a',
    steps: [{ id: 'a', name: 'A', type: 'end', message: 'fim' }],
  };
  const { json } = buildFlowJson(spec);
  json.lineList.push({ from: 'nodeC', to: 'fantasma', paintStyle: { strokeWidth: 3, stroke: '#000' } });
  const { errors } = validateJson(json);
  assert.ok(errors.some((e) => /fantasma/.test(e)));
});
