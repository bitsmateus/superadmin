import test from 'node:test';
import assert from 'node:assert/strict';
import type { ItemRelatorio } from '../plaquinhas/relatorio.js';
import { modeloDaSecao, separarPorSecao, validadeDos } from './promocao.js';

const item = (p: Partial<ItemRelatorio>): ItemRelatorio => ({
  produtoId: '1',
  ean: '7890000000000',
  grupo: 'BEBIDAS',
  nomeOriginal: '',
  produto: 'REFRIGERANTE COCA COLA',
  peso: '2L',
  preco: '9,99',
  precoDe: '',
  minUnidades: '',
  inicio: '16/11/2026',
  fim: '30/11/2026',
  ...p,
});

test('separa por seção na ordem do relatório', () => {
  const s = separarPorSecao([
    item({ grupo: 'BEBIDAS', produto: 'SUCO FRU10 LARANJA' }),
    item({ grupo: 'PRODUTOS LIMPEZA', produto: 'LIMPADOR CASA PERFUMADA' }),
    item({ grupo: 'BEBIDAS', produto: 'CERVEJA SCHIN', preco: '2,79' }),
  ]);
  assert.deepEqual(s.map((x) => [x.secao, x.itens.length]), [['BEBIDAS', 2], ['PRODUTOS LIMPEZA', 1]]);
});

test('junta variações do mesmo produto com o mesmo preço (fotos juntas)', () => {
  const [s] = separarPorSecao([
    item({ produto: 'REFRIGERANTE COCA COLA', ean: '1' }),
    item({ produto: 'REFRIGERANTE COCA COLA ZERO', ean: '2' }),
    item({ produto: 'REFRIGERANTE COCA COLA', peso: '600ML', preco: '4,99', ean: '3' }), // outro tamanho: separado
    item({ produto: 'REFRIGERANTE COCA COLA ZERO', preco: '10,49', ean: '4' }), // outro preço: separado
  ]);
  assert.equal(s.itens.length, 3);
  assert.equal(s.itens[0].nome, 'REFRIGERANTE COCA COLA');
  assert.deepEqual(s.itens[0].variacoes.map((v) => v.ean), ['1', '2']);
  assert.equal(s.itens[1].variacoes.length, 1);
  assert.equal(s.itens[2].variacoes.length, 1);
});

test('nome do item junto = começo comum; marcas diferentes não juntam', () => {
  const [s] = separarPorSecao([
    item({ produto: 'SUCO FRU10 LARANJA', peso: '900ML', preco: '4,99' }),
    item({ produto: 'SUCO FRU10 UVA', peso: '900ML', preco: '4,99' }),
    item({ produto: 'SUCO DEL VALLE UVA', peso: '900ML', preco: '4,99' }),
  ]);
  assert.equal(s.itens.length, 2);
  assert.equal(s.itens[0].nome, 'SUCO FRU10');
  assert.equal(s.itens[0].detalhe, '900ML');
});

test('sem seção no relatório: usa a do cadastro, senão OUTROS', () => {
  const s = separarPorSecao([item({ grupo: '', produtoId: '9' }), item({ grupo: '', produtoId: '8', produto: 'X Y' })], new Map([['9', 'FRIOS']]));
  assert.deepEqual(s.map((x) => x.secao), ['FRIOS', 'OUTROS']);
});

test('modelo e validade', () => {
  assert.equal(modeloDaSecao('HORTIFRUTI'), 'hortifruti');
  assert.equal(modeloDaSecao('AÇOUGUE'), 'acougue');
  assert.equal(modeloDaSecao('PRODUTOS LIMPEZA'), 'semana');
  assert.equal(validadeDos([item({})]), 'Válido de 16/11 a 30/11');
  assert.equal(validadeDos([item({ inicio: '08/01/2016' })]), 'Válido até 30/11');
  assert.equal(validadeDos([item({ fim: '' })]), '');
});
