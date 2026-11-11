import test from 'node:test';
import assert from 'node:assert/strict';
import { limparMensagem, pedidoDaMensagem, SISTEMA_MENSAGEM } from './gcMensagemTrafego.js';

test('pedido leva o primeiro nome do contato e as anotações', () => {
  const p = pedidoDaMensagem({ empresa: 'Escola ENAC', contato: 'Maria Souza', texto: '  pausei o anúncio 2  ' });
  assert.match(p, /Cliente: Escola ENAC/);
  assert.match(p, /Contato: Maria\n/);
  assert.match(p, /pausei o anúncio 2$/);
  assert.match(pedidoDaMensagem({ empresa: '', contato: '', texto: 'x' }), /Contato: \(não informado\)/);
});

test('regras da IA: não inventar e ignorar o que é interno', () => {
  assert.match(SISTEMA_MENSAGEM, /Não invente números/);
  assert.match(SISTEMA_MENSAGEM, /Ignore comentários internos/);
});

test('limpa aspas em volta da resposta', () => {
  assert.equal(limparMensagem('  "Olá, Maria!\nTudo certo."  '), 'Olá, Maria!\nTudo certo.');
  assert.equal(limparMensagem('Olá "time"'), 'Olá "time"');
});
