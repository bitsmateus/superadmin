import { test } from 'node:test';
import assert from 'node:assert/strict';
import { diasEntre, listaEmails, listaTelefones, montarHtml, preencher, textoDias } from './engeEnvio.js';

const dados = {
  sindico: 'Carlos Mendes',
  empreendimento: 'Residencial Vila Aurora',
  item: 'Impermeabilização',
  prazo: '3 anos',
  construtora: 'Plano Alto Engenharia',
  vencimento: '2026-11-10',
  enviadoEm: '2026-10-11',
};

test('diasEntre conta dias corridos', () => {
  assert.equal(diasEntre('2026-10-11', '2026-11-10'), 30);
  assert.equal(diasEntre('2026-11-10', '2026-11-10'), 0);
  assert.equal(diasEntre('2026-11-12', '2026-11-10'), -2);
});

test('textoDias', () => {
  assert.equal(textoDias(30), 'faltam 30 dias');
  assert.equal(textoDias(1), 'falta 1 dia');
  assert.equal(textoDias(0), 'vence hoje');
  assert.equal(textoDias(-3), 'venceu há 3 dias');
});

test('preencher troca as variáveis e mantém as desconhecidas', () => {
  const r = preencher('{sindico}: {item} ({prazo}) do {empreendimento} vence {vencimento}, {dias}. {construtora} {outra}', dados);
  assert.equal(
    r,
    'Carlos Mendes: Impermeabilização (3 anos) do Residencial Vila Aurora vence 10/11/2026, faltam 30 dias. Plano Alto Engenharia {outra}',
  );
});

test('montarHtml escapa o texto e põe o link de ciente', () => {
  const html = montarHtml('Olá <b>x</b>\n\nlinha 2', 'https://painel/engeenvio/ciente/abc');
  assert.ok(html.includes('Olá &lt;b&gt;x&lt;/b&gt;'));
  assert.ok(html.includes('href="https://painel/engeenvio/ciente/abc"'));
  assert.ok(!montarHtml('a', null).includes('ciente'));
});

test('listaEmails separa e descarta inválidos', () => {
  assert.deepEqual(listaEmails('a@x.com, b@y.com.br;\nruim'), ['a@x.com', 'b@y.com.br']);
});

test('listaTelefones põe o 55 e descarta curtos', () => {
  assert.deepEqual(listaTelefones('(43) 99812-4410, 5543991210575 / 123'), ['5543998124410', '5543991210575']);
});

test('preencher troca {link}', () => {
  assert.equal(preencher('ok: {link}', { ...dados, link: 'https://x/c/1' }), 'ok: https://x/c/1');
});
