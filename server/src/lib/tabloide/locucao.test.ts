import test from 'node:test';
import assert from 'node:assert/strict';
import { extenso, precoFalado, falaDoItem, roteiroPadrao, segundosDoMp3, gerarVozes, motivoDaVoz } from './locucao.js';
import { DADOS_VAZIOS } from './layout.js';

test('números e preços por extenso', () => {
  assert.equal(extenso(21), 'vinte e um');
  assert.equal(extenso(100), 'cem');
  assert.equal(extenso(123), 'cento e vinte e três');
  assert.equal(extenso(1050), 'mil e cinquenta');
  assert.equal(precoFalado('8,99'), 'oito reais e noventa e nove centavos');
  assert.equal(precoFalado('10,00'), 'dez reais');
  assert.equal(precoFalado('1,01'), 'um real e um centavo');
});

test('roteiro: abertura, produtos e fechamento', () => {
  const d = { ...DADOS_VAZIOS(), titulo: 'Ofertas da semana' };
  d.itens = [
    { id: '1', nome: 'ARROZ TIO JOÃO', detalhe: '5kg', preco: '27,90', precoDe: '', unidade: '', produtoId: null, destaque: false },
    { id: '2', nome: 'Banana prata', detalhe: '', preco: '4,99', precoDe: '', unidade: 'kg', produtoId: null, destaque: false },
  ];
  assert.match(falaDoItem(d.itens[1]), /banana prata, por apenas quatro reais e noventa e nove centavos o quilo/);
  const r = roteiroPadrao(d, 4);
  assert.ok(r.length >= 1);
  assert.match(r[0], /^Olha só as ofertas da semana!/);
  assert.match(r[r.length - 1], /por tempo limitado/);
  assert.match(r[0], /arroz tio joão 5 quilos/);
});

test('duração do mp3 de 128 kbps', () => {
  assert.equal(segundosDoMp3(Buffer.alloc(16_000)), 1);
});

test('vozes: no máximo 2 pedidos ao mesmo tempo e o 429 é repetido', async () => {
  const original = globalThis.fetch;
  const chave = process.env.ELEVENLABS_API_KEY;
  process.env.ELEVENLABS_API_KEY = 'teste';
  let abertos = 0;
  let pico = 0;
  let pedidos = 0;
  globalThis.fetch = (async () => {
    const n = ++pedidos;
    pico = Math.max(pico, ++abertos);
    await new Promise((ok) => setTimeout(ok, 5));
    abertos--;
    return n === 1 ? new Response('too_many_concurrent_requests', { status: 429 }) : new Response('mp3');
  }) as typeof fetch;
  try {
    const audios = await gerarVozes(['a', 'b', '', 'c', 'd'], undefined, 1);
    assert.deepEqual(audios.map((a) => a?.toString() ?? null), ['mp3', 'mp3', null, 'mp3', 'mp3']);
    assert.equal(pico, 2);
    assert.equal(pedidos, 5);
  } finally {
    globalThis.fetch = original;
    if (chave === undefined) delete process.env.ELEVENLABS_API_KEY;
    else process.env.ELEVENLABS_API_KEY = chave;
  }
});

test('motivo da falha de voz em português', () => {
  assert.match(motivoDaVoz('ElevenLabs 401: {"detail":{"status":"quota_exceeded"}}'), /créditos/);
  assert.match(motivoDaVoz('ElevenLabs 429: too_many_concurrent_requests'), /ao mesmo tempo/);
});
