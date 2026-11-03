import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { emailNormalizado, pontuacao, telefoneE164 } from './leads.js';
import { assinar, depoisDaFalha } from './webhooks.js';

test('WhatsApp em E.164', () => {
  assert.equal(telefoneE164('(48) 99999-0000'), '+5548999990000');
  assert.equal(telefoneE164('48 3333-4444'), '+554833334444');
  assert.equal(telefoneE164('+55 48 99999-0000'), '+5548999990000');
  assert.equal(telefoneE164('005548999990000'), '+5548999990000');
  assert.equal(telefoneE164('999'), null);
  assert.equal(telefoneE164(''), null);
});

test('e-mail normalizado', () => {
  assert.equal(emailNormalizado('  Ana@Pedal.COM.br '), 'ana@pedal.com.br');
  assert.equal(emailNormalizado('ana@'), null);
});

test('pontuação do lead (§8.3)', () => {
  assert.equal(pontuacao([]), 0);
  // concluiu (40) + 2min (20) + 1 sessão (0) + CTA (25) = 85 → quente
  assert.equal(pontuacao([{ completed: true, activeMs: 120_000, ctaClicked: true }]), 85);
  // 1min (10) em 3 sessões (15), sem concluir nem CTA
  assert.equal(pontuacao([{ completed: false, activeMs: 20_000, ctaClicked: false }, { completed: false, activeMs: 20_000, ctaClicked: false }, { completed: false, activeMs: 20_000, ctaClicked: false }]), 25);
  // 2 sessões contam metade do bônus
  assert.equal(pontuacao([{ completed: true, activeMs: 0, ctaClicked: false }, { completed: false, activeMs: 0, ctaClicked: false }]), 48);
});

test('assinatura HMAC confere com o que o n8n vai recalcular', () => {
  const corpo = '{"event":"session.completed"}';
  assert.equal(assinar('segredo', corpo), 'sha256=' + createHmac('sha256', 'segredo').update(corpo).digest('hex'));
});

test('retentativas: 1 min, 5 min, 30 min e desiste', () => {
  const t = 1_000_000;
  assert.deepEqual(depoisDaFalha(1, t), { status: 'PENDING', proxima: new Date(t + 60_000) });
  assert.deepEqual(depoisDaFalha(2, t), { status: 'PENDING', proxima: new Date(t + 300_000) });
  assert.deepEqual(depoisDaFalha(3, t), { status: 'PENDING', proxima: new Date(t + 1_800_000) });
  assert.deepEqual(depoisDaFalha(4, t), { status: 'FAILED', proxima: null });
});
