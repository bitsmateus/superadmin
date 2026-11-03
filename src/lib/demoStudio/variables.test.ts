// Roda pelo `npm test` do servidor (node --test + tsx).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  aplicarVariaveis,
  aplicarVariaveisSemFrasesVazias,
  formatarTelefone,
  linkWhatsapp,
  trechosDoTexto,
} from './variables'

test('variáveis com valor, com padrão e vazias', () => {
  const t = 'Tour para a {{empresa|sua empresa}}, {{ nome }}! {{vendedor}}'
  assert.equal(aplicarVariaveis(t, { empresa: 'Pedal Bikes', nome: 'Ana' }), 'Tour para a Pedal Bikes, Ana! ')
  assert.equal(aplicarVariaveis(t, {}), 'Tour para a sua empresa, ! ')
  assert.equal(aplicarVariaveis(t, { empresa: '   ' }), 'Tour para a sua empresa, ! ')
})

test('mensagem do WhatsApp tira a frase cuja variável ficou vazia', () => {
  const m = 'Olá! Sou {{nome}} da {{empresa}}. Acabei de ver o tour do NX Systems.'
  assert.equal(aplicarVariaveisSemFrasesVazias(m, { nome: 'Ana', empresa: 'Pedal Bikes' }), 'Olá! Sou Ana da Pedal Bikes. Acabei de ver o tour do NX Systems.')
  assert.equal(aplicarVariaveisSemFrasesVazias(m, {}), 'Olá! Acabei de ver o tour do NX Systems.')
  assert.equal(aplicarVariaveisSemFrasesVazias('Oi {{nome|tudo bem}}?', {}), 'Oi tudo bem?')
})

test('telefone e link wa.me', () => {
  assert.equal(formatarTelefone('5548936181649'), '(48) 93618-1649')
  assert.equal(formatarTelefone('4833334444'), '(48) 3333-4444')
  assert.equal(formatarTelefone('123'), '123')
  assert.equal(linkWhatsapp('(48) 93618-1649', 'Oi & tchau'), 'https://wa.me/5548936181649?text=Oi%20%26%20tchau')
})

test('negrito e quebra de linha viram trechos, sem HTML', () => {
  assert.deepEqual(trechosDoTexto('Um **dois**\n<b>três</b>'), [
    { tipo: 'texto', valor: 'Um ' },
    { tipo: 'negrito', valor: 'dois' },
    { tipo: 'quebra' },
    { tipo: 'texto', valor: '<b>três</b>' },
  ])
})
