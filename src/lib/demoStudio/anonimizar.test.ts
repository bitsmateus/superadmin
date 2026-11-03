// Roda pelo `npm test` do servidor (node --test + tsx).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { criarAnonimizador } from './anonimizar'

test('automáticas: telefone, e-mail, CPF e CNPJ', () => {
  const a = criarAnonimizador([])
  assert.equal(a.texto('Ligue (11) 98765-4321'), 'Ligue (48) 99999-1000')
  assert.match(a.texto('wa: 5511987654321'), /^wa: 55489\d{8}$/)
  assert.equal(a.texto('joao.silva@empresa.com.br'), 'contato@exemplo.com.br')
  assert.equal(a.texto('CPF 123.456.789-09'), 'CPF 000.000.000-00')
  assert.equal(a.texto('CNPJ 12.345.678/0001-90'), 'CNPJ 00.000.000/0001-00')
  assert.equal(a.texto('WABA 123 - 456'), 'WhatsApp Oficial')
})

test('o mesmo valor real vira sempre o mesmo falso; valores diferentes, falsos diferentes', () => {
  const a = criarAnonimizador([])
  const x = a.texto('(11) 98765-4321')
  assert.equal(a.texto('(11) 98765-4321'), x)
  assert.notEqual(a.texto('(21) 91234-5678'), x)
  assert.notEqual(a.texto('outro@x.com'), a.texto('mais@x.com'))
})

test('idempotente: anonimizar o que já foi anonimizado não muda nada (evita loop no MutationObserver)', () => {
  const a = criarAnonimizador([{ find: 'Marcos Vieira', replace: 'Pedro Lima', isRegex: false }])
  const textos = ['Marcos Vieira (11) 98765-4321 joao@x.com 5511987654321 123.456.789-09', 'Fale com Marcos Vieira']
  for (const t of textos) {
    const uma = a.texto(t)
    assert.equal(a.texto(uma), uma)
    assert.equal(a.texto(a.texto(uma)), uma)
  }
})

test('regras do workspace: trecho simples (sem regex) e regex', () => {
  const a = criarAnonimizador([
    { find: 'Bike Center Floripa', replace: 'Pedal Bikes', isRegex: false },
    { find: 'Pedido #\\d+', replace: 'Pedido #1001', isRegex: true },
    { find: '([', replace: 'x', isRegex: true }, // regex inválida: ignorada
  ])
  assert.equal(a.texto('Loja Bike Center Floripa - matriz'), 'Loja Pedal Bikes - matriz')
  assert.equal(a.texto('Pedido #98231 enviado'), 'Pedido #1001 enviado')
  assert.ok(a.trocas() >= 2)
})

test('automáticas podem ser desligadas', () => {
  const a = criarAnonimizador([], { phone: false, email: true, cpf: false, cnpj: false, avatars: false })
  assert.equal(a.texto('(11) 98765-4321 a@b.com'), '(11) 98765-4321 contato@exemplo.com.br')
})

test('datas, horários e valores não são confundidos com telefone', () => {
  const a = criarAnonimizador([])
  for (const t of ['03/11/2026 14:35', 'R$ 1.234,56', 'Protocolo 2026-11', '15 de 15']) assert.equal(a.texto(t), t)
})
