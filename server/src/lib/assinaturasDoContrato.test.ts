import test from 'node:test';
import assert from 'node:assert/strict';
import { montarPosicoes } from './assinaturasDoContrato.js';

const linhas = [{ xPct: 50, yPct: 50.9 + 6.5 }, { xPct: 50, yPct: 75.6 }];

test('rubrica em todas as páginas menos a última; assinatura só na última', () => {
  const p = montarPosicoes(4, linhas);
  for (const lado of [p.nx, p.cliente]) {
    assert.deepEqual(lado.filter((x) => x.element === 'INITIALS').map((x) => x.z), [1, 2, 3]);
    const ass = lado.filter((x) => x.element === 'SIGNATURE');
    assert.equal(ass.length, 1);
    assert.equal(ass[0].z, 4);
  }
  assert.equal(p.paginas, 4);
  assert.equal(p.linhasAchadas, true);
});

test('contrato de uma página só: sem rubrica, só a assinatura', () => {
  const p = montarPosicoes(1, linhas);
  assert.equal(p.nx.length, 1);
  assert.equal(p.nx[0].element, 'SIGNATURE');
  assert.equal(p.nx[0].z, 1);
});

test('assinatura em cima da linha: cliente na primeira linha, NX na segunda', () => {
  const p = montarPosicoes(2, linhas);
  const cli = p.cliente.find((x) => x.element === 'SIGNATURE')!;
  const nx = p.nx.find((x) => x.element === 'SIGNATURE')!;
  assert.ok(Number(cli.y) < Number(nx.y));
  // A caixa fica acima da linha e centrada nela (linha em x=50).
  assert.ok(Number(nx.y) < 75.6 && Number(nx.y) > 60);
  assert.ok(Number(nx.x) > 30 && Number(nx.x) < 50);
});

test('sem linhas no PDF: assinaturas lado a lado no fim da última página', () => {
  const p = montarPosicoes(3, []);
  assert.equal(p.linhasAchadas, false);
  assert.ok(p.nx.some((x) => x.element === 'SIGNATURE' && x.z === 3));
  assert.ok(p.cliente.some((x) => x.element === 'SIGNATURE' && x.z === 3));
  assert.equal(p.nx.filter((x) => x.element === 'INITIALS').length, 2);
});

test('valores no formato do Autentique (texto com uma casa, escala, ângulo)', () => {
  const [a] = montarPosicoes(2, linhas).nx;
  assert.match(a.x, /^\d+\.\d$/);
  assert.match(a.y, /^\d+\.\d$/);
  assert.equal(a.angle, 0);
  assert.ok(a.scale >= 0.5 && a.scale <= 4);
});
