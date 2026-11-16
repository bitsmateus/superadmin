import test from 'node:test'
import assert from 'node:assert/strict'
import { aplicarAutomaticos, dataPorExtenso, formatarMoeda, lerMoeda, marcarManual, prepararModelo, tirarVermelho } from './modeloDoContrato'

const R = (t: string) => `<span style="color:red;">&lt;&lt;${t}&gt;&gt;</span>`
const MODELO = `<p>disponibilização de ${R('NÚMERO DE TELAS')} telas.</p>
<p>Cláusula 5ª: o valor de instalação de R$ ${R('VALOR')} em até ${R('X')} parcelas de R$ ${R('VALOR')}, e o valor mensal de R$ ${R('VALOR')}, fidelidade de ${R('3 / 6 / 12')} meses, totalizando R$ ${R('VALOR')}, com o primeiro vencimento em ${R('DATA')}.</p>
<p>Vigência de ${R('X meses')}.</p>
<p>Tubarão, ${R('DATA')}</p>
<p>${R('Razão Social')} CNPJ ${R('CNPJ')}</p><p>${R('Razão Social')} CNPJ ${R('CNPJ')}</p>`

test('"VALOR", "X" e "DATA" repetidos: cada um vira o campo certo pelo texto em volta', () => {
  const m = prepararModelo(MODELO)
  const nomes = m.campos.map((c) => c.nome)
  assert.deepEqual(nomes, [
    'NÚMERO DE TELAS', 'Valor da Instalação', 'Número de Parcelas', 'Valor das Parcelas', 'Valor Mensal', '3 / 6 / 12',
    'Valor Total', 'Data do Primeiro Vencimento', 'X meses', 'DATA', 'Razão Social', 'CNPJ',
  ])
  const papel = (n: string) => m.campos.find((c) => c.nome === n)?.papel
  assert.equal(papel('Valor Total'), 'total')
  assert.equal(papel('X meses'), 'vigencia')
  assert.equal(papel('DATA'), 'hoje')
  assert.equal(papel('Data do Primeiro Vencimento'), 'primeiroVencimento')
  assert.equal(papel('3 / 6 / 12'), 'fidelidade')
  // "X meses" leva o "meses" junto do valor; razão social e CNPJ (duas vezes) seguem sendo um campo só cada.
  assert.equal(m.campos.find((c) => c.nome === 'X meses')?.sufixo, ' meses')
  assert.equal((m.html.match(/&lt;&lt;CNPJ&gt;&gt;/g) ?? []).length, 2)
  assert.ok(!m.html.includes('&lt;&lt;VALOR&gt;&gt;'))
})

test('campo genérico sem contexto fica separado e numerado (nunca mistura valores diferentes)', () => {
  const m = prepararModelo(`<p>Pague R$ ${R('VALOR')} hoje e R$ ${R('VALOR')} amanhã.</p>`)
  assert.deepEqual(m.campos.map((c) => c.nome), ['VALOR', 'VALOR (2)'])
})

test('total = mensalidade x meses da fidelidade (349 em 3 meses = 1.047,00); vigência acompanha; data de hoje', () => {
  const m = prepararModelo(MODELO)
  const hoje = new Date(2026, 10, 16)
  let c = aplicarAutomaticos({ 'Valor Mensal': '349', '3 / 6 / 12': '3' }, m.campos, { hoje })
  assert.equal(c['Valor Total'], '1.047,00')
  assert.equal(c['X meses'], '3 meses')
  assert.equal(c['DATA'], '16 de novembro de 2026')
  c = aplicarAutomaticos({ ...c, '3 / 6 / 12': '12', 'Valor Mensal': '349,90' }, m.campos)
  assert.equal(c['Valor Total'], '4.198,80')
  // Sem mensalidade ou sem fidelidade: o total fica vazio.
  assert.equal(aplicarAutomaticos({ '3 / 6 / 12': '6' }, m.campos)['Valor Total'], '')
  // Digitado à mão não é mais recalculado.
  const manual = marcarManual({ 'Valor Mensal': '100', '3 / 6 / 12': '6', 'Valor Total': '500,00' }, 'Valor Total')
  assert.equal(aplicarAutomaticos(manual, m.campos)['Valor Total'], '500,00')
})

test('moeda: lê "1.047,00", "349", "349,5" e formata em pt-BR', () => {
  assert.equal(lerMoeda('1.047,00'), 1047)
  assert.equal(lerMoeda('349'), 349)
  assert.equal(lerMoeda('349,5'), 349.5)
  assert.equal(lerMoeda('R$ 2.500'), 2500)
  assert.equal(lerMoeda(''), null)
  assert.equal(formatarMoeda(1047), '1.047,00')
  assert.equal(dataPorExtenso(new Date(2026, 0, 5)), '5 de janeiro de 2026')
})

test('gerar o contrato: nenhum vermelho sobra', () => {
  const html = `<p style="color:red">a</p><span style="font-weight:bold;color:#FF0000;">b</span><span style="color: rgb(255, 0, 0)">c</span><font color="red">d</font><span style="color:#dc2626">e</span><span style="color:#1d4ed8">azul fica</span><span style="color:#000000">preto</span><span style="background-color:red">fundo fica</span>`
  const r = tirarVermelho(html)
  assert.ok(!/(^|[;\s"'])color:\s*(red|#ff0000|rgb\(255|#dc2626)/i.test(r), r)
  assert.ok(!/color="red"/i.test(r))
  assert.ok(r.includes('#1d4ed8'))
  assert.ok(r.includes('background-color:red'))
})

test('lead do CRM: MRR, implementação, fidelidade e atendentes entram no contrato; o total sai da conta', async () => {
  const { camposDaLead } = await import('./modeloDoContrato')
  const m = prepararModelo(MODELO)
  const lead = camposDaLead(m.campos, { valorMrr: 'R$ 349,00', valorImplementacao: 'R$ 997,00', fidelidade: '12 meses', numeroAtendentes: '5' })
  assert.deepEqual(lead, { 'Valor Mensal': '349,00', 'Valor da Instalação': '997,00', '3 / 6 / 12': '12', 'NÚMERO DE TELAS': '5' })
  assert.equal(aplicarAutomaticos(lead, m.campos)['Valor Total'], '4.188,00')
  // Fidelidade fora de 3/6/12 ("sem fidelidade") e valor vazio não entram.
  assert.deepEqual(camposDaLead(m.campos, { valorMrr: '', fidelidade: 'Sem fidelidade' }), {})
})
