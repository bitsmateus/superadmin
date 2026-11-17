import test from 'node:test'
import assert from 'node:assert/strict'
import { mensagemDoContrato, saudacaoDoDia } from './mensagemDoContrato'

const hora = (h: number, m = 0) => new Date(2026, 10, 17, h, m)

test('saudação pela hora: bom dia até 11:59, boa tarde até 17:59, boa noite depois', () => {
  assert.equal(saudacaoDoDia(hora(0)), 'Bom dia')
  assert.equal(saudacaoDoDia(hora(11, 59)), 'Bom dia')
  assert.equal(saudacaoDoDia(hora(12)), 'Boa tarde')
  assert.equal(saudacaoDoDia(hora(17, 59)), 'Boa tarde')
  assert.equal(saudacaoDoDia(hora(18)), 'Boa noite')
  assert.equal(saudacaoDoDia(hora(23, 59)), 'Boa noite')
})

test('mensagem do contrato: saudação, texto e o link no meio', () => {
  const m = mensagemDoContrato('https://assina.ae/LvFfaAHeOQH9POuza', hora(9))
  assert.equal(
    m,
    'Bom dia, tudo certo? Sejam bem vindos! \n\nSegue contrato no link abaixo para analise e assinatura\n\nhttps://assina.ae/LvFfaAHeOQH9POuza\n\nFico a disposição, qualquer dúvida pode comentar 😊',
  )
})
