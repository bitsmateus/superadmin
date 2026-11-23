import test from 'node:test'
import assert from 'node:assert/strict'
import { CATEGORIAS_DA_DEMANDA, buscarClientes, descricaoDeOutroOk, ehCategoriaDeConfiguracao, ehTipoSuporte, finalizarPorExtenso, textoDaNotaDeDemanda } from './demandaDoCliente'

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

test('busca por nome abreviado: várias palavras em qualquer ordem, começo de palavra, razão social e iniciais', () => {
  const lista = [
    { id: 'a', name: 'Fabio Alexandre Fagundes Domingos - ME', company: 'Auto Center Tubarão' },
    { id: 'b', name: 'Maria Souza', company: 'Padaria da Maria', briefingData: { razaoSocial: 'MARIA SOUZA PANIFICADORA LTDA', nomeFantasia: 'Pão Quente' } },
  ]
  assert.deepEqual(buscarClientes(lista, 'auto tubarao').map((c) => c.id), ['a'])
  assert.deepEqual(buscarClientes(lista, 'tubarao auto').map((c) => c.id), ['a'])
  assert.deepEqual(buscarClientes(lista, 'alex fag').map((c) => c.id), ['a'])
  assert.deepEqual(buscarClientes(lista, 'panificadora').map((c) => c.id), ['b']) // razão social
  assert.deepEqual(buscarClientes(lista, 'pao quente').map((c) => c.id), ['b']) // nome fantasia
  assert.deepEqual(buscarClientes(lista, 'fafd').map((c) => c.id), ['a']) // iniciais: Fabio Alexandre Fagundes Domingos
  assert.deepEqual(buscarClientes(lista, 'xyz zzz'), [])
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

test('nota da demanda de configuração: categoria, tipo, quem criou, número, prazo e o que fazer', () => {
  const n = textoDaNotaDeDemanda({ criador: 'Mateus', telefone: '(48) 99999-0000', pelaGrupo: false, categoria: 'CONFIGURAÇÃO NOVA', tipo: 'API OFICIAL', finalizar: '2026-11-25T17:00', demanda: 'Conectar o número novo\nTestar o envio' })
  assert.equal(n, '📌 DEMANDA CRIADA — CONFIGURAÇÃO NOVA · API OFICIAL\nCriada por: Mateus\nVeio por: (48) 99999-0000\nCategoria: CONFIGURAÇÃO NOVA\nTipo: API OFICIAL\nFinalizar até: 25/11/2026 às 17:00\nO que fazer: Conectar o número novo\nTestar o envio')
})

test('nota da demanda de suporte: só a categoria (sem linha de Tipo), grupo do WhatsApp e sem "O que fazer" quando vazio', () => {
  const g = textoDaNotaDeDemanda({ criador: 'Jean', telefone: '', pelaGrupo: true, categoria: 'SUPORTE', tipo: 'SUPORTE', finalizar: '2026-11-26', demanda: '' })
  assert.match(g, /^📌 DEMANDA CRIADA — SUPORTE\n/)
  assert.match(g, /Veio por: Grupo do WhatsApp/)
  assert.match(g, /Categoria: SUPORTE/)
  assert.doesNotMatch(g, /Tipo:/)
  assert.match(g, /Finalizar até: 26\/11\/2026$/m)
  assert.doesNotMatch(g, /O que fazer/)
  assert.equal(finalizarPorExtenso('qualquer coisa'), 'qualquer coisa')
})

test('categorias da demanda: SUPORTE não pede Tipo; as duas de configuração pedem', () => {
  assert.deepEqual([...CATEGORIAS_DA_DEMANDA], ['SUPORTE', 'CONFIGURAÇÃO NOVA', 'CONFIGURAÇÃO NOVO CLIENTE'])
  assert.equal(ehCategoriaDeConfiguracao('SUPORTE'), false)
  assert.equal(ehCategoriaDeConfiguracao('CONFIGURAÇÃO NOVA'), true)
  assert.equal(ehCategoriaDeConfiguracao('CONFIGURAÇÃO NOVO CLIENTE'), true)
  assert.equal(ehCategoriaDeConfiguracao(''), false)
})

test('ehTipoSuporte: SUPORTE (e o antigo SUPORTE COMUM) é suporte; os tipos de configuração não', () => {
  for (const t of ['SUPORTE', 'suporte', 'SUPORTE COMUM']) assert.equal(ehTipoSuporte(t), true, t)
  for (const t of ['API OFICIAL', 'IA BÁSICA', 'API COMUM + IA BÁSICA', '', null, undefined]) assert.equal(ehTipoSuporte(t), false, String(t))
})
