import test from 'node:test'
import assert from 'node:assert/strict'
import { buscarClientes, descricaoDeOutroOk, finalizarPorExtenso, textoDaNotaDeDemanda } from './demandaDoCliente'

const CLIENTES = [
  { id: '1', name: 'Fabio Alexandre Fagundes Domingos - ME', company: 'Fabio Alexandre Fagundes Domingos - ME', phone: '5548999112233', cnpj: '12345678000190' },
  { id: '2', name: 'Maria Souza', company: 'Auto Center Tubarão', phone: '(48) 3622-0000', fichaCadastro: { cnpj: '98.765.432/0001-10' } },
  { id: '3', name: 'Consensus One', company: 'CONSENSUS ONE SERVICOS LTDA', email: 'contato@consensus.com.br' },
]

test('busca por nome, empresa, CNPJ (com ou sem pontos), telefone e e-mail — sem ligar pra acento', () => {
  assert.deepEqual(buscarClientes(CLIENTES, 'fabio').map((c) => c.id), ['1'])
  assert.deepEqual(buscarClientes(CLIENTES, 'tubarao').map((c) => c.id), ['2']) // empresa "Tubarão", sem acento
  assert.deepEqual(buscarClientes(CLIENTES, '12.345.678/0001-90').map((c) => c.id), ['1'])
  assert.deepEqual(buscarClientes(CLIENTES, '98765432').map((c) => c.id), ['2']) // CNPJ da ficha de cadastro
  assert.deepEqual(buscarClientes(CLIENTES, '48 99911').map((c) => c.id), ['1'])
  assert.deepEqual(buscarClientes(CLIENTES, '3622').map((c) => c.id), ['2'])
  assert.deepEqual(buscarClientes(CLIENTES, 'consensus.com').map((c) => c.id), ['3'])
})

test('busca: menos de 2 letras não lista ninguém, 1-2 dígitos não casam telefone; quem começa com o termo vem primeiro', () => {
  assert.deepEqual(buscarClientes(CLIENTES, 'f'), [])
  assert.deepEqual(buscarClientes(CLIENTES, ''), [])
  assert.deepEqual(buscarClientes(CLIENTES, '99'), [])
  const lista = [{ id: 'a', name: 'Auto Maria' }, { id: 'b', name: 'Maria Auto' }]
  assert.deepEqual(buscarClientes(lista, 'maria').map((c) => c.id), ['b', 'a'])
})

test('"Outro": aceita descrições de verdade', () => {
  for (const t of ['Parceiro', 'Cliente novo', 'Lead indicado pelo Arthur', 'CRM', 'Fornecedor de hospedagem', 'Ação', 'Teste de API']) {
    assert.equal(descricaoDeOutroOk(t), '', t)
  }
})

test('"Outro": recusa menos de 3 letras, só número e texto digitado sem pensar', () => {
  for (const t of ['', '  ', 'ab', '12', '123', '123456', '!!!', 'a1', 'aaa', 'aaaaaa', 'kkkk', 'oi oi', 'teste teste teste', 'asdf', 'asdfgh', 'qwerty', 'zxcvb', 'abcd', 'dcba', 'kjhgf', 'dfgdfg', 'asdasd', 'qweqwe', 'sdf', 'xpto 1234']) {
    assert.notEqual(descricaoDeOutroOk(t), '', `"${t}" devia ser recusada`)
  }
})

test('nota da demanda: quem criou, número ou grupo, tipo, finalizar até e o que fazer', () => {
  const n = textoDaNotaDeDemanda({ criador: 'Mateus', telefone: '(48) 99999-0000', pelaGrupo: false, tipo: 'Configuração API Oficial', finalizar: '2026-11-25T17:00', demanda: 'Conectar o número novo\nTestar o envio' })
  assert.equal(n, '📌 DEMANDA CRIADA — Configuração API Oficial\nCriada por: Mateus\nVeio por: (48) 99999-0000\nTipo: Configuração API Oficial\nFinalizar até: 25/11/2026 às 17:00\nO que fazer: Conectar o número novo\nTestar o envio')
  const g = textoDaNotaDeDemanda({ criador: 'Jean', telefone: '', pelaGrupo: true, tipo: 'Ajuste IA', finalizar: '2026-11-26', demanda: '' })
  assert.match(g, /Veio por: Grupo do WhatsApp/)
  assert.match(g, /Finalizar até: 26\/11\/2026$/m)
  assert.doesNotMatch(g, /O que fazer/)
  assert.equal(finalizarPorExtenso('qualquer coisa'), 'qualquer coisa')
})
