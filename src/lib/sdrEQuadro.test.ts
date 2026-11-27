import test from 'node:test'
import assert from 'node:assert/strict'
import { chaveDoNomeDoQuadro, sdrSuspensoEntre } from './sdrEQuadro'

test('quadro de mesmo nome sem diferenciar maiúscula, acento e espaço', () => {
  assert.equal(chaveDoNomeDoQuadro('LEADS NOVOS'), chaveDoNomeDoQuadro('Leads Novos'))
  assert.equal(chaveDoNomeDoQuadro('REUNIÃO  AGENDADA '), chaveDoNomeDoQuadro('Reuniao agendada'))
  assert.notEqual(chaveDoNomeDoQuadro('Primeiro contato'), chaveDoNomeDoQuadro('Leads Novos'))
})

test('SDR suspenso some da escolha; com alguém ativo de mesmo primeiro nome, não', () => {
  const perfis = [
    { name: 'Arthur Silva', inativo: true },
    { name: 'Luís Otávio', inativo: false },
    { name: 'Ana', inativo: true }, { name: 'Ana Paula', inativo: false },
  ]
  assert.equal(sdrSuspensoEntre(perfis, 'Arthur'), true)
  assert.equal(sdrSuspensoEntre(perfis, 'Luis'), false)
  assert.equal(sdrSuspensoEntre(perfis, 'Ana'), false)
  assert.equal(sdrSuspensoEntre(perfis, 'IA Luiza'), false)
  assert.equal(sdrSuspensoEntre(perfis, ''), false)
})
