import test from 'node:test';
import assert from 'node:assert/strict';
import { ATALHOS_MENSAGEM, limparMensagem, pedidoDaMensagem, SISTEMA_MENSAGEM } from './gcMensagemTrafego.js';

test('pedido leva o primeiro nome do contato, o que o gestor quer e os dados', () => {
  const p = pedidoDaMensagem({ contato: 'Maria Souza', pedido: '  resultado da semana ', dados: { trafego_meta: { gasto: 100 } } });
  assert.match(p, /Contato: Maria\n/);
  assert.match(p, /PEDIDO do gestor:\nresultado da semana\n/);
  assert.match(p, /"trafego_meta":\{"gasto":100\}/);
  assert.match(pedidoDaMensagem({ contato: '', pedido: 'x', dados: {} }), /Contato: \(não informado\)/);
});

test('regras da IA: seguir o pedido, não inventar e ignorar o que é interno', () => {
  assert.match(SISTEMA_MENSAGEM, /Faça exatamente o que o pedido diz/);
  assert.match(SISTEMA_MENSAGEM, /Nunca invente número/);
  assert.match(SISTEMA_MENSAGEM, /Ignore comentários internos/);
  assert.ok(ATALHOS_MENSAGEM.includes('Resultado da semana'));
});

test('limpa aspas em volta da resposta', () => {
  assert.equal(limparMensagem('  "Olá, Maria!\nTudo certo."  '), 'Olá, Maria!\nTudo certo.');
  assert.equal(limparMensagem('Olá "time"'), 'Olá "time"');
});
