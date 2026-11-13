import test from 'node:test'
import assert from 'node:assert/strict'
import { dddDoTelefone, isLeadTubarao } from './leadTubarao'

test('isLeadTubarao: Tipo começando com "tubarao", sem acento nem maiúscula', () => {
  assert.equal(isLeadTubarao({ tipo: 'Tubarão - anúncio' }), true)
  assert.equal(isLeadTubarao({ tipo: 'tubarao lp' }), true)
  assert.equal(isLeadTubarao({ tipo: '  TUBARÃO' }), true)
  assert.equal(isLeadTubarao({ tipo: 'rmkt - quente > Tubarão' }), false)
  assert.equal(isLeadTubarao({ tipo: '01 - FRIO - LEAD' }), false)
})

test('isLeadTubarao: telefone com DDD 48, com ou sem o 55', () => {
  assert.equal(isLeadTubarao({ telefone: '5548999887766' }), true)
  assert.equal(isLeadTubarao({ telefone: '+55 (48) 99988-7766' }), true)
  assert.equal(isLeadTubarao({ telefone: '48999887766' }), true)
  assert.equal(isLeadTubarao({ telefone: '4833334444' }), true)
  assert.equal(isLeadTubarao({ telefone: '5511999887766' }), false)
  assert.equal(isLeadTubarao({ telefone: '' }), false)
  assert.equal(isLeadTubarao({}), false)
})

test('dddDoTelefone: DDD 55 sem o país não vira "país 55"', () => {
  // 11 dígitos começando com 55 = DDD 55 (RS), não o código do Brasil.
  assert.equal(dddDoTelefone('55999887766'), '55')
  assert.equal(dddDoTelefone('555599887766'), '55')
  assert.equal(dddDoTelefone('grupo'), '')
})
