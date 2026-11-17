import test from 'node:test';
import assert from 'node:assert/strict';
import type { ItemRelatorio } from '../plaquinhas/relatorio.js';
import { GERAL, categoriaDa, modeloDaSecao, separarPorSecao, validadeDos } from './promocao.js';

let seq = 0;
const item = (p: Partial<ItemRelatorio>): ItemRelatorio => ({
  produtoId: String(++seq),
  ean: String(7890000000000 + seq),
  grupo: 'BEBIDAS',
  nomeOriginal: '',
  produto: `PRODUTO TESTE ${seq}`,
  peso: '1KG',
  preco: `${seq},99`,
  precoDe: '',
  minUnidades: '',
  inicio: '16/11/2026',
  fim: '30/11/2026',
  ...p,
});
const varios = (n: number, p: Partial<ItemRelatorio>) => Array.from({ length: n }, () => item(p));

test('seções do ERP viram categorias grandes', () => {
  assert.equal(categoriaDa('BISCOITOS/TORRADAS/WAFER'), 'MERCEARIA');
  assert.equal(categoriaDa('BOMBONIERE'), 'MERCEARIA');
  assert.equal(categoriaDa('PRODUTOS LIMPEZA'), 'LIMPEZA, HIGIENE E CASA');
  assert.equal(categoriaDa('HIGIENE PESSOAL'), 'LIMPEZA, HIGIENE E CASA');
  assert.equal(categoriaDa('UTILIDADES PARA CASA'), 'LIMPEZA, HIGIENE E CASA');
  assert.equal(categoriaDa('REFRIGERANTES'), 'BEBIDAS');
  assert.equal(categoriaDa('FLV'), 'HORTIFRUTI');
  assert.equal(categoriaDa(''), GERAL);
});

test('relatório real (doc 44): 15 produtos em 9 seções viram 2 tabloides cheios', () => {
  const s = separarPorSecao([
    ...varios(3, { grupo: 'BISCOITOS/TORRADAS/WAFER' }),
    item({ grupo: 'CEREAIS/GRAOS/FARINACEOS' }),
    ...varios(2, { grupo: 'CONSERVAS/ENLATADOS/MOLHO' }),
    item({ grupo: 'BOMBONIERE' }),
    item({ grupo: 'PAES/BOLOS' }),
    item({ grupo: 'ACHOCOLATADO' }),
    item({ grupo: 'PRODUTOS LIMPEZA', produto: 'SABÃO EM PÓ BRILHANTE CAIXA CUIDADO TOTAL', peso: '800G', preco: '9,99' }),
    item({ grupo: 'PRODUTOS LIMPEZA', produto: 'SABÃO EM PÓ BRILHANTE CAIXA LIMPEZA TOTAL', peso: '800G', preco: '9,99' }),
    item({ grupo: 'PRODUTOS LIMPEZA' }),
    ...varios(2, { grupo: 'HIGIENE PESSOAL' }),
    item({ grupo: 'UTILIDADES PARA CASA' }),
  ]);
  // 15 produtos, 2 sabões juntos = 14 cards → 7 + 7.
  assert.deepEqual(s.map((x) => [x.secao, x.itens.length]), [['MERCEARIA', 7], ['MERCEARIA + LIMPEZA, HIGIENE E CASA', 7]]);
  // Um destaque por tabloide: o mais caro.
  for (const t of s) assert.equal(t.itens.filter((i) => i.destaque).length, 1);
  const caro = Math.max(...s[0].itens.map((i) => Number(i.preco.replace(',', '.'))));
  assert.equal(s[0].itens.find((i) => i.destaque)!.preco.replace(',', '.'), String(caro));
});

test('no máximo 8 por tabloide, em partes iguais; hortifruti e açougue separados', () => {
  const a = separarPorSecao(varios(10, { grupo: 'BISCOITOS' }));
  assert.deepEqual(a.map((x) => [x.secao, x.itens.length]), [['MERCEARIA 1', 5], ['MERCEARIA 2', 5]]);
  const b = separarPorSecao([...varios(5, { grupo: 'FLV' }), ...varios(2, { grupo: 'REFRIGERANTES' }), ...varios(2, { grupo: 'PRODUTOS LIMPEZA' })]);
  assert.deepEqual(b.map((x) => [x.secao, x.modeloId, x.itens.length]), [
    ['HORTIFRUTI', 'hortifruti', 5],
    ['BEBIDAS + LIMPEZA, HIGIENE E CASA', 'semana', 4],
  ]);
  // Poucos produtos: sem destaque.
  assert.equal(separarPorSecao(varios(3, { grupo: 'BISCOITOS' }))[0].itens.some((i) => i.destaque), false);
});

test('junta variações do mesmo produto com o mesmo preço (fotos juntas)', () => {
  const [s] = separarPorSecao([
    item({ produto: 'REFRIGERANTE COCA COLA', peso: '2L', preco: '9,99', ean: '1' }),
    item({ produto: 'REFRIGERANTE COCA COLA ZERO', peso: '2L', preco: '9,99', ean: '2' }),
    item({ produto: 'REFRIGERANTE COCA COLA', peso: '600ML', preco: '4,99', ean: '3' }), // outro tamanho: separado
    item({ produto: 'REFRIGERANTE COCA COLA ZERO', peso: '2L', preco: '10,49', ean: '4' }), // outro preço: separado
  ]);
  assert.equal(s.itens.length, 3);
  assert.equal(s.itens[0].nome, 'REFRIGERANTE COCA COLA');
  assert.deepEqual(s.itens[0].variacoes.map((v) => v.ean), ['1', '2']);
});

test('nome do item junto = começo comum; marcas diferentes não juntam', () => {
  const [s] = separarPorSecao([
    item({ produto: 'SABÃO EM PÓ BRILHANTE CAIXA CUIDADO TOTAL', peso: '800G', preco: '9,99' }),
    item({ produto: 'SABÃO EM PÓ BRILHANTE CAIXA LIMPEZA TOTAL', peso: '800G', preco: '9,99' }),
    item({ produto: 'SUCO DEL VALLE UVA', peso: '900ML', preco: '4,99' }),
    item({ produto: 'SUCO FRU10 UVA', peso: '900ML', preco: '4,99' }),
  ]);
  assert.equal(s.itens.length, 3);
  assert.equal(s.itens[0].nome, 'SABÃO EM PÓ BRILHANTE CAIXA');
});

test('sem seção no relatório: usa a do cadastro', () => {
  const s = separarPorSecao(varios(4, { grupo: '', produtoId: '999' }), new Map([['999', 'FRIOS']]));
  assert.deepEqual(s.map((x) => x.secao), ['FRIOS E LATICÍNIOS']);
});

test('modelo e validade', () => {
  assert.equal(modeloDaSecao('HORTIFRUTI'), 'hortifruti');
  assert.equal(modeloDaSecao('AÇOUGUE'), 'acougue');
  assert.equal(modeloDaSecao('MERCEARIA'), 'semana');
  assert.equal(validadeDos([item({})]), 'Válido de 16/11 a 30/11');
  assert.equal(validadeDos([item({ inicio: '08/01/2016' })]), 'Válido até 30/11');
  assert.equal(validadeDos([item({ fim: '' })]), '');
});
