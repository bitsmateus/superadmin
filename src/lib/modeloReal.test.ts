import test from 'node:test'
import assert from 'node:assert/strict'
import { aplicarAutomaticos, marcarManual, montarTabelaDeServicos, prepararModelo } from './modeloDoContrato'

const R = (t: string) => `<span style="color:red;font-weight:bold;">&lt;&lt;${t}&gt;&gt;</span>`

const REAL = `<p>Cláusula 2ª: A CONTRATADA prestará serviços relativos à tabela abaixo:</p>
<table style="border-collapse:collapse;width:100%"><tr><td style="border:1px solid #000;text-align:center"><p style="font-weight:bold"><span style="font-size:11pt">Serviços</span></p></td><td style="border:1px solid #000"><p style="font-weight:bold;text-align:center"><span style="font-size:11pt">Pacote</span></p></td></tr>
<tr><td style="border:1px solid #000;text-align:center"><p><span style="font-size:11pt">01</span></p></td><td style="border:1px solid #000"><p><span style="font-size:11pt">PLATAFORMA NX</span></p></td></tr>
<tr><td style="border:1px solid #000;text-align:center"><p><span style="font-size:11pt">02</span></p></td><td style="border:1px solid #000"><p><span style="font-size:11pt">ATÉ 3 NÚMEROS CONECTADOS À API OFICIAL DO WHATSAPP</span></p></td></tr>
</table>
<p>Cláusula 5ª: A CONTRATANTE se compromete a pagar à CONTRATADA, o valor de instalação e mão de obra para configuração da plataforma, o valor de R$${R('VALOR')} via PIX ou CARTÃO DE CRÉDITO (em até 10x c/juros) na mesma data da assinatura do presente contrato e, por meio de pagamento via PIX/BOLETO, o valor total de R$${R('VALOR')}, referente ao plano de ${R('3 / 6 / 12')} meses, em ${R('X')} parcelas de R$${R('VALOR')} com o primeiro vencimento em ${R('DATA')}.</p>`

test('o primeiro VALOR antes do total é a instalação, mesmo com a palavra "instalação" mais longe', () => {
  const m = prepararModelo(REAL)
  assert.deepEqual(m.campos.map((c) => c.nome), [
    'Tabela de Serviços', 'Valor da Instalação', 'Valor Total', '3 / 6 / 12', 'Número de Parcelas', 'Valor das Parcelas', 'Data do Primeiro Vencimento', 'Valor Mensal',
  ])
  assert.equal(m.campos.find((c) => c.nome === 'Valor Mensal')?.implicito, true)
})

test('parcelas: número = meses da fidelidade e valor = total ÷ parcelas (369 × 3 = 1.107,00 em 3 parcelas de 369,00)', () => {
  const m = prepararModelo(REAL)
  const c = aplicarAutomaticos({ 'Valor Mensal': '369', '3 / 6 / 12': '3' }, m.campos)
  assert.equal(c['Valor Total'], '1.107,00')
  assert.equal(c['Número de Parcelas'], '3')
  assert.equal(c['Valor das Parcelas'], '369,00')
  // Mudou o número de parcelas à mão: o valor de cada uma acompanha.
  const mudou = aplicarAutomaticos(marcarManual({ ...c, 'Número de Parcelas': '2' }, 'Número de Parcelas'), m.campos)
  assert.equal(mudou['Valor das Parcelas'], '553,50')
})

test('tabela de serviços do modelo vira campo editável e mantém o visual', () => {
  const m = prepararModelo(REAL)
  assert.ok(m.servicos)
  assert.deepEqual(m.servicos!.linhasPadrao, [
    { codigo: '01', nome: 'PLATAFORMA NX' },
    { codigo: '02', nome: 'ATÉ 3 NÚMEROS CONECTADOS À API OFICIAL DO WHATSAPP' },
  ])
  assert.ok(m.html.includes('&lt;&lt;Tabela de Serviços&gt;&gt;') && !m.html.includes('<table'))
  const nova = montarTabelaDeServicos(m.servicos!, [...m.servicos!.linhasPadrao, { codigo: '03', nome: 'SUPORTE DEDICADO' }])
  assert.equal((nova.match(/<tr/g) ?? []).length, 4)
  assert.ok(nova.includes('SUPORTE DEDICADO') && nova.includes('border:1px solid #000') && nova.includes('font-size:11pt'))
  // O cabeçalho continua o do modelo.
  assert.ok(nova.indexOf('Serviços') < nova.indexOf('PLATAFORMA NX'))
})
