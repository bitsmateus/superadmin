import test from 'node:test'
import assert from 'node:assert/strict'
import { formatarResposta, ordemDaPrioridade, passaNaPrioridade, prioridadeExibida, textoSeguroNoCsv, OPCOES_DE_PRIORIDADE } from './respostaMeta'

test('troca "_" por espaço e capitaliza a primeira letra', () => {
  assert.equal(formatarResposta('nos_próximos_30_dias'), 'Nos próximos 30 dias')
  assert.equal(formatarResposta('o_quanto_antes'), 'O quanto antes')
  assert.equal(formatarResposta('em_2_a_3_meses'), 'Em 2 a 3 meses')
  assert.equal(formatarResposta('só_estou_pesquisando'), 'Só estou pesquisando')
  assert.equal(formatarResposta('4_a_10_atendentes'), '4 a 10 atendentes')
  assert.equal(formatarResposta('demora_para_responder_clientes'), 'Demora para responder clientes')
  assert.equal(formatarResposta('Já formatado'), 'Já formatado')
  assert.equal(formatarResposta(''), '')
  assert.equal(formatarResposta(null), '')
})

test('prioridade sem resposta = "Sem ID"', () => {
  assert.equal(prioridadeExibida(''), 'Sem ID')
  assert.equal(prioridadeExibida(null), 'Sem ID')
  assert.equal(prioridadeExibida('o_quanto_antes'), 'O quanto antes')
})

test('filtro por prioridade compara o texto exibido; vazio = todos', () => {
  assert.equal(passaNaPrioridade('o_quanto_antes', null), true)
  assert.equal(passaNaPrioridade('o_quanto_antes', 'O quanto antes'), true)
  assert.equal(passaNaPrioridade('o_quanto_antes', 'Sem ID'), false)
  assert.equal(passaNaPrioridade('', 'Sem ID'), true)
})

test('ordena na ordem do formulário, com "Sem ID" por último', () => {
  const lista = ['', 'só_estou_pesquisando', 'o_quanto_antes', 'outra_coisa', 'em_2_a_3_meses', 'nos_próximos_30_dias']
  assert.deepEqual([...lista].sort((a, b) => ordemDaPrioridade(a) - ordemDaPrioridade(b)).map(prioridadeExibida),
    [...OPCOES_DE_PRIORIDADE, 'Outra coisa', 'Sem ID'])
})

test('CSV: valor que o Excel leria como fórmula ganha tabulação na frente', () => {
  assert.equal(textoSeguroNoCsv('@clinica'), '\t@clinica')
  assert.equal(textoSeguroNoCsv('=1+1'), '\t=1+1')
  assert.equal(textoSeguroNoCsv('clinica.com.br'), 'clinica.com.br')
  assert.equal(textoSeguroNoCsv(''), '')
})
