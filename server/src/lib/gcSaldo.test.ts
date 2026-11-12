import test from 'node:test';
import assert from 'node:assert/strict';
import { alertasDeSaldo, interpretarFinanceiro, valorDoTexto } from './gcSaldo.js';

test('lê o valor do texto da Meta nos dois formatos', () => {
  assert.equal(valorDoTexto('Saldo disponível (R$ 1.234,56 BRL)'), 1234.56);
  assert.equal(valorDoTexto('Available balance (R$1,234.56 BRL)'), 1234.56);
  assert.equal(valorDoTexto('Saldo disponível (R$50,00 BRL)'), 50);
  assert.equal(valorDoTexto('Saldo disponível (R$ 1.500 BRL)'), 1500);
  assert.equal(valorDoTexto('Saldo disponível (R$ -12,30 BRL)'), -12.3);
  assert.equal(valorDoTexto(''), null);
});

test('conta pré-paga: saldo vem do texto da forma de pagamento', () => {
  const f = interpretarFinanceiro({
    account_status: 1, is_prepay_account: true, amount_spent: '500000', spend_cap: '0',
    funding_source_details: { type: 20, display_string: 'Saldo disponível (R$ 80,00 BRL)' },
  });
  assert.equal(f.prePaga, true);
  assert.equal(f.saldoDisponivel, 80);
  assert.equal(f.formaPagamento, 'Saldo pré-pago (boleto/Pix)');
  assert.equal(f.limiteGasto, null);
  assert.equal(f.bloqueada, false);
});

test('conta no cartão: sem saldo, com valor a pagar e limite de gastos', () => {
  const f = interpretarFinanceiro({
    account_status: 1, is_prepay_account: false, balance: '12345', amount_spent: '90000', spend_cap: '100000',
    funding_source_details: { type: 1, display_string: 'Visa •••• 1234' },
  });
  assert.equal(f.formaPagamento, 'Cartão de crédito');
  assert.equal(f.detalhePagamento, 'Visa •••• 1234');
  assert.equal(f.saldoDisponivel, null);
  assert.equal(f.valorAPagar, 123.45);
  assert.equal(f.limiteGasto, 1000);
  assert.equal(f.restanteLimite, 100);
});

test('alertas: saldo para menos de 3 dias, zerado, limite e conta bloqueada', () => {
  const pre = (saldo: string) => interpretarFinanceiro({ account_status: 1, is_prepay_account: true, funding_source_details: { type: 20, display_string: `Saldo disponível (R$ ${saldo} BRL)` } });
  assert.deepEqual(alertasDeSaldo(pre('500,00'), 50, ''), []); // 10 dias
  const baixo = alertasDeSaldo(pre('100,00'), 50, 'Conta X');
  assert.equal(baixo[0].regra, 'saldo_baixo');
  assert.equal(baixo[0].nivel, 'atencao');
  assert.match(baixo[0].mensagem, /dá para 2 dias/);
  assert.equal(alertasDeSaldo(pre('30,00'), 50, '')[0].nivel, 'critico');
  assert.equal(alertasDeSaldo(pre('0,00'), 50, '')[0].regra, 'sem_saldo');
  assert.equal(alertasDeSaldo(pre('0,00'), 0, '')[0].regra, 'sem_saldo');
  assert.deepEqual(alertasDeSaldo(pre('100,00'), 0, ''), []); // sem gasto, não dá pra estimar

  const cartao = interpretarFinanceiro({ account_status: 1, amount_spent: '95000', spend_cap: '100000', funding_source_details: { type: 1 } });
  assert.equal(alertasDeSaldo(cartao, 30, '')[0].regra, 'limite_perto');

  const bloqueada = interpretarFinanceiro({ account_status: 3, funding_source_details: { type: 1 } });
  assert.equal(alertasDeSaldo(bloqueada, 30, '')[0].regra, 'conta_bloqueada');
  assert.match(alertasDeSaldo(bloqueada, 30, '')[0].mensagem, /Pagamento pendente/);
});
