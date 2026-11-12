import test from 'node:test';
import assert from 'node:assert/strict';
import { CRMS_DE_GESTOR, DIAS_DE_GESTAO, notaDeCobranca, notaDeGestao, novaReferencia, precisaCobrar, primeiroNome } from './gcCrmGestorRegras.js';

test('CRM do Mateus, segunda e quinta', () => {
  assert.deepEqual(CRMS_DE_GESTOR, [{ pagina: 'crm-mateus', gestor: 'mateus' }]);
  assert.ok(DIAS_DE_GESTAO[1] && DIAS_DE_GESTAO[4]);
  assert.equal(DIAS_DE_GESTAO[2], undefined);
  assert.equal(primeiroNome('Mateus Bitencourt'), 'mateus');
  assert.equal(primeiroNome('Mátéus'), 'mateus');
});

test('saldo de referência: primeira leitura e cada recarga viram a referência', () => {
  assert.deepEqual(novaReferencia({ ultimo: null, referencia: null }, 500), { referencia: 500, recarga: true });
  assert.deepEqual(novaReferencia({ ultimo: 500, referencia: 500 }, 420), { referencia: 500, recarga: false });
  assert.deepEqual(novaReferencia({ ultimo: 100, referencia: 500 }, 1100), { referencia: 1100, recarga: true });
  assert.deepEqual(novaReferencia({ ultimo: 100, referencia: 500 }, 100.3), { referencia: 500, recarga: false });
});

test('cobrar quando sobra 30% ou menos, ou zerou', () => {
  assert.equal(precisaCobrar(160, 500), false);
  assert.equal(precisaCobrar(150, 500), true);
  assert.equal(precisaCobrar(0, 500), true);
  assert.equal(precisaCobrar(-5, null), true);
  assert.equal(precisaCobrar(50, null), false);
  assert.equal(precisaCobrar(null, 500), false);
});

test('notas dos cards', () => {
  const g = notaDeGestao('Fibruz', 'Gerenciar campanhas', { metaGasto: 350, metaResultados: 12, metaCusto: 29.17, googleGasto: 0, googleConversoes: 0, saldo: 80, alertas: ['Saldo baixo'] }, 'https://x/y');
  assert.match(g, /Gerenciar campanhas — Fibruz/);
  assert.match(g, /Meta \(7 dias\): R\$ 350,00 · 12 resultado\(s\)/);
  assert.doesNotMatch(g, /Google Ads/);
  assert.match(g, /Saldo pré-pago: R\$ 80,00/);
  assert.match(g, /href="https:\/\/x\/y"/);
  const c = notaDeCobranca('Fibruz', 'Conta 1', 120, 500, 40, 'https://x');
  assert.match(c, /Restam R\$ 120,00 \(24% do saldo depois da última recarga, R\$ 500,00\)/);
  assert.match(c, /dá para ~3 dia/);
  assert.match(notaDeCobranca('Fibruz', '', 0, 500, 40, 'https://x'), /zerou/);
});
