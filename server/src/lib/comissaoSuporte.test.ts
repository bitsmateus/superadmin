import test from 'node:test';
import assert from 'node:assert/strict';
import { ehQuadroDeEntrega, lancamentoDaEntrega, mesEmBrasilia, pessoaDaAba, type TipoDeComissao } from './comissaoSuporte.js';

const TIPOS: TipoDeComissao[] = [
  { id: 'c', label: 'Entrega API comum', kind: 'fixed', rate_cents: 800 },
  { id: 'o', label: 'Entrega API oficial', kind: 'fixed', rate_cents: 1400 },
  { id: 'b', label: 'Entrega IA Básica', kind: 'fixed', rate_cents: 2500 },
  { id: 'v', label: 'Venda IA Básica', kind: 'percent', rate_cents: null },
  { id: 'cfg', label: 'Configuração', kind: 'fixed', rate_cents: 2000 },
];

test('lancamentoDaEntrega: o Tipo do card acha "Entrega <tipo>", sem ligar pra maiúscula e acento', () => {
  assert.deepEqual(lancamentoDaEntrega('API OFICIAL', TIPOS), { typeId: 'o', typeLabel: 'Entrega API oficial', amountCents: 1400 });
  assert.deepEqual(lancamentoDaEntrega('IA BASICA', TIPOS), { typeId: 'b', typeLabel: 'Entrega IA Básica', amountCents: 2500 });
});

test('lancamentoDaEntrega: tipo de comissão com o mesmo nome do Tipo (ex.: Configuração)', () => {
  assert.deepEqual(lancamentoDaEntrega('CONFIGURAÇÃO', TIPOS), { typeId: 'cfg', typeLabel: 'Configuração', amountCents: 2000 });
});

test('lancamentoDaEntrega: sem tipo que bata entra com R$ 0, a definir', () => {
  assert.deepEqual(lancamentoDaEntrega('IA AVANÇADA', TIPOS), { typeId: null, typeLabel: 'Entrega IA AVANÇADA', amountCents: 0 });
  assert.deepEqual(lancamentoDaEntrega('', TIPOS), { typeId: null, typeLabel: 'Entrega (sem tipo)', amountCents: 0 });
});

test('pessoaDaAba: o primeiro nome, sem acento (como a aba Comissões escreve)', () => {
  assert.equal(pessoaDaAba('João'), 'Joao');
  assert.equal(pessoaDaAba('Jean'), 'Jean');
  assert.equal(pessoaDaAba('JOÃO SILVA'), 'Joao');
});

test('ehQuadroDeEntrega e mesEmBrasilia', () => {
  assert.equal(ehQuadroDeEntrega('ENTREGAS REALIZADAS'), true);
  assert.equal(ehQuadroDeEntrega('Finalizado'), false);
  // 01/12 às 01h UTC ainda é 30/11 em Brasília.
  assert.equal(mesEmBrasilia('2026-12-01T01:00:00Z'), '2026-11');
  assert.equal(mesEmBrasilia('2026-12-01T12:00:00Z'), '2026-12');
});
