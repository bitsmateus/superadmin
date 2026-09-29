import test from 'node:test';
import assert from 'node:assert/strict';
import { calcularRateio, custoPorKg, derivarIndices, type Corte } from '../../../src/lib/acougueRateio.js';

const cortes: Corte[] = [
  { id: '1', nome: 'Picanha', participacao: 4, indice: 2.5, precoAtual: 80 },
  { id: '2', nome: 'Coxão mole', participacao: 20, indice: 1.2, precoAtual: 38 },
  { id: '3', nome: 'Músculo', participacao: 16, indice: 0.7, precoAtual: 22 },
  { id: '4', nome: 'Costela', participacao: 30, indice: 0.9, precoAtual: 29 },
];

test('custoPorKg converte arroba, peça e kg', () => {
  assert.equal(custoPorKg({ unidade: 'arroba', custo: 400, margem: 0 }), 400 / 15);
  assert.equal(custoPorKg({ unidade: 'peca', custo: 1000, pesoPeca: 40, margem: 0 }), 25);
  assert.equal(custoPorKg({ unidade: 'kg', custo: 24, margem: 0 }), 24);
});

test('o boi inteiro rende exatamente custo + margem', () => {
  const base = { unidade: 'kg' as const, custo: 24, margem: 30 };
  const r = calcularRateio(base, cortes);
  assert.equal(r.receitaAlvo, 24 * 100 * 1.3);
  // Sem arredondamento, a receita real bate no alvo (centavos de tolerância).
  assert.ok(Math.abs(r.receitaReal - r.receitaAlvo) < 1, `receita ${r.receitaReal} x alvo ${r.receitaAlvo}`);
  assert.ok(Math.abs(r.margemReal - 30) < 0.1);
  // Quem tem índice maior fica mais caro.
  const preco = (nome: string) => r.cortes.find((c) => c.nome === nome)!.precoNovo;
  assert.ok(preco('Picanha') > preco('Coxão mole'));
  assert.ok(preco('Coxão mole') > preco('Músculo'));
  // preço = precoMedio × índice
  assert.ok(Math.abs(preco('Picanha') - r.precoMedio * 2.5) < 0.02);
});

test('quebra reduz o peso vendável e encarece o corte', () => {
  const base = { unidade: 'kg' as const, custo: 24, margem: 30 };
  const semQuebra = calcularRateio(base, cortes);
  const comQuebra = calcularRateio(
    base,
    cortes.map((c) => (c.nome === 'Costela' ? { ...c, quebra: 20 } : c)),
  );
  assert.ok(comQuebra.precoMedio > semQuebra.precoMedio, 'menos peso vendável exige preço maior');
  assert.ok(Math.abs(comQuebra.margemReal - 30) < 0.5, 'a margem continua fechando');
});

test('corte travado mantém o preço e o resto redistribui sem perder a margem', () => {
  const base = { unidade: 'kg' as const, custo: 24, margem: 30 };
  const r = calcularRateio(
    base,
    cortes.map((c) => (c.nome === 'Costela' ? { ...c, travado: true, precoAtual: 19.9 } : c)),
  );
  assert.equal(r.cortes.find((c) => c.nome === 'Costela')!.precoNovo, 19.9)
  assert.ok(Math.abs(r.margemReal - 30) < 0.5, `margem real ${r.margemReal}`);
  // Com a costela barata travada, os outros sobem pra compensar.
  const base2 = calcularRateio(base, cortes);
  assert.ok(r.precoMedio > base2.precoMedio);
});

test('arredondamento em ,90 aplica e a margem fica perto do alvo', () => {
  const r = calcularRateio({ unidade: 'kg', custo: 24, margem: 30, arredondamento: 'centavo90' }, cortes);
  for (const c of r.cortes) assert.equal(Math.round((c.precoNovo % 1) * 100), 90, c.nome);
  assert.ok(Math.abs(r.margemReal - 30) < 2, `margem ${r.margemReal}`);
});

test('derivarIndices reconstrói os preços de hoje', () => {
  const base = { unidade: 'kg' as const, custo: 24, margem: 0 };
  const { cortes: comIndice, margem, erro } = derivarIndices(base, cortes);
  assert.equal(erro, undefined);
  // Recalcular com os índices derivados e a margem derivada devolve os mesmos preços.
  const r = calcularRateio({ ...base, margem }, comIndice);
  for (const c of cortes) {
    const novo = r.cortes.find((x) => x.nome === c.nome)!.precoNovo;
    assert.ok(Math.abs(novo - c.precoAtual!) < 0.02, `${c.nome}: ${novo} x ${c.precoAtual}`);
  }
});

test('boi mais caro sobe todos os preços na mesma proporção', () => {
  const { cortes: comIndice, margem } = derivarIndices({ unidade: 'arroba', custo: 340, margem: 0 }, cortes);
  const antes = calcularRateio({ unidade: 'arroba', custo: 340, margem }, comIndice);
  const depois = calcularRateio({ unidade: 'arroba', custo: 400, margem }, comIndice);
  const fator = 400 / 340;
  for (const c of antes.cortes) {
    const d = depois.cortes.find((x) => x.nome === c.nome)!;
    assert.ok(Math.abs(d.precoNovo / c.precoNovo - fator) < 0.01, `${c.nome} ${d.precoNovo}/${c.precoNovo}`);
  }
});

test('avisa quando as participações não fecham', () => {
  const r = calcularRateio({ unidade: 'kg', custo: 24, margem: 30 }, [
    { id: '1', nome: 'Só um corte', participacao: 10, indice: 1 },
  ]);
  assert.ok(r.avisos.some((a) => a.includes('somam')));
});
