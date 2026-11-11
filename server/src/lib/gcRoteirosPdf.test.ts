import test from 'node:test';
import assert from 'node:assert/strict';
import { montarHtmlRoteirosPdf, nomeArquivoRoteiros } from './gcRoteirosPdf.js';

const r = { titulo: 'Alô, <Bairro>! Fibra chegou', objetivo: 'conversa', duracao: '20s', gancho: 'Internet chegou', cenas: ['Cena 1', 'Cena 2'], cta: 'Chama no WhatsApp', legenda: 'linha 1\nlinha 2' };

test('PDF leva o nome do cliente, os roteiros e escapa HTML', () => {
  const html = montarHtmlRoteirosPdf({ cliente: 'Fibruz', geradoEm: '11/11/2026', roteiros: [r, { ...r, titulo: 'Outro' }] });
  assert.match(html, /Roteiros de vídeo — Fibruz/);
  assert.match(html, /2 roteiros/);
  assert.match(html, /Alô, &lt;Bairro&gt;! Fibra chegou/);
  assert.match(html, /<li>Cena 2<\/li>/);
  assert.match(html, /linha 1<br>linha 2/);
  assert.doesNotMatch(html, /<Bairro>/);
});

test('nome do arquivo com o cliente', () => {
  assert.equal(nomeArquivoRoteiros('Fibruz'), 'Roteiros - Fibruz.pdf');
  assert.equal(nomeArquivoRoteiros('Escola Nova Arte / ENAC'), 'Roteiros - Escola Nova Arte ENAC.pdf');
  assert.equal(nomeArquivoRoteiros('  '), 'Roteiros - cliente.pdf');
});
