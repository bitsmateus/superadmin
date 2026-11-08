import { test } from 'node:test';
import assert from 'node:assert/strict';
import { contarLetras, textoDeVerdade } from './textoDeVerdade.js';

test('texto de verdade: passa o que foi escrito', () => {
  for (const t of [
    'cliente pediu pra falar na quinta',
    'mandei no WhatsApp e liguei 2x',
    'mandei msg no wpp, sem resposta',
    'Ele está viajando, volta segunda',
    'falei com ele, quer ajustar o plano pra 3 atendentes',
    'achou caro, fechou com outro sistema',
    'instrução do sócio: esperar a reunião',
    'WhatsApp e ligação', 'cliente viajando', 'certo, aberto amanhã',
  ]) assert.equal(textoDeVerdade(t, 10), true, t);
});

test('texto de verdade: barra o que só bate o mínimo', () => {
  for (const t of [
    '..........', '. . . . . . . . . . . .', '1234567890123', 'aaaaaaaaaaaa', 'kkkkkkkkkkkk',
    'asdfasdfasdf', 'qwerqwerqwer', 'sdfgh dfghj fghjk', 'asdasd asdasd asd', 'teste teste teste',
    'ok ok ok ok ok ok', 'jkhgdf bvcnxm', 'asdasd qweqwe', 'sdfsdf ghjghj', 'adiar.........', 'aaa bbb ccc ddd',
  ]) assert.equal(textoDeVerdade(t, 10), false, t);
});

test('texto de verdade: só letras contam pro mínimo', () => {
  assert.equal(contarLetras('ligo amanhã... 10h!'), 11);
  assert.equal(textoDeVerdade('vou ligar dps', 10), true);
  assert.equal(textoDeVerdade('vou ligar dps', 20), false);
});
