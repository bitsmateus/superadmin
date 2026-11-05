import test from 'node:test';
import assert from 'node:assert/strict';
import { DADOS_VAZIOS, lerLinha, montarPaginas, paginar, type ItemTabloide } from './layout.js';
import { semelhanca } from './busca.js';
import { eanValido } from './ean.js';

test('lerLinha entende a lista do jeito que vem do WhatsApp', () => {
  assert.deepEqual(lerLinha('Arroz Tio João 5kg 27,90'), { ean: '', nome: 'Arroz Tio João', detalhe: '5KG', preco: '27,90', precoDe: '', unidade: '' });
  assert.deepEqual(lerLinha('Coca-Cola 2L 9,99 de 11,49'), { ean: '', nome: 'Coca-Cola', detalhe: '2L', preco: '9,99', precoDe: '11,49', unidade: '' });
  assert.deepEqual(lerLinha('de 11,49 por 9,99 Coca 2L'), { ean: '', nome: 'Coca', detalhe: '2L', preco: '9,99', precoDe: '11,49', unidade: '' });
  assert.equal(lerLinha('Picanha kg 69,90')?.unidade, 'kg');
  assert.equal(lerLinha('Picanha kg 69,90')?.nome, 'Picanha');
  assert.equal(lerLinha('Banana prata - R$ 4,99/kg')?.unidade, 'kg');
  assert.equal(lerLinha('7894900011517 Coca-Cola 2L 9,99')?.ean, '7894900011517');
  assert.equal(lerLinha('Sabão em pó Omo 1,6kg 24.90')?.preco, '24,90');
  assert.equal(lerLinha('Cerveja Brahma lata 350ml 3,29 un')?.nome, 'Cerveja Brahma lata');
  assert.equal(lerLinha('Cerveja Brahma lata 350ml 3,29 un')?.unidade, 'un');
  assert.equal(lerLinha('Televisão 1.299,90')?.preco, '1299,90');
  assert.equal(lerLinha('   '), null);
});

test('semelhanca acha o produto pelo nome e respeita a medida', () => {
  const coca2l = 'refrigerante coca cola original garrafa 2l 2l coca cola';
  assert.ok(semelhanca('Coca-Cola 2L', coca2l) >= 0.6);
  assert.ok(semelhanca('Coca-Cola 350ml', coca2l) < 0.6, 'medida diferente não pode casar');
  assert.ok(semelhanca('Açúcar União 1kg', 'uniao refinado 1kg tio joao') >= 0.6);
  assert.ok(semelhanca('Picanha', coca2l) < 0.2);
});

test('eanValido confere o dígito verificador', () => {
  assert.equal(eanValido('7894900027013'), true);
  assert.equal(eanValido('7894900027014'), false);
  assert.equal(eanValido('123'), false);
});

const item = (i: number, destaque = false): ItemTabloide => ({
  id: String(i), nome: `Produto ${i}`, detalhe: '', preco: '9,99', precoDe: '', unidade: '', produtoId: null, destaque,
});

test('paginar divide por formato e põe o destaque na frente', () => {
  const itens = Array.from({ length: 30 }, (_, i) => item(i, i === 7));
  const feed = paginar(itens, 'feed', 0);
  assert.equal(feed.length, 3);
  assert.equal(feed.flat().length, 30);
  assert.equal(feed[0][0].destaque, true);
  assert.equal(paginar(itens.slice(0, 5), 'feed', 0).length, 1);
  assert.equal(paginar(itens, 'a4', 0).length, 2);
});

test('montarPaginas escapa o texto (nada de HTML vindo da lista)', () => {
  const dados = { ...DADOS_VAZIOS(), titulo: '<script>x</script>', itens: [{ ...item(1), nome: '<img src=x onerror=alert(1)>' }] };
  const [p] = montarPaginas(dados, '');
  assert.ok(!p.html.includes('<script>'));
  assert.ok(!p.html.includes('<img src=x'));
  assert.ok(p.html.includes('&lt;img src=x'));
});
