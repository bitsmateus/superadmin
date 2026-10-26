import test from 'node:test';
import assert from 'node:assert/strict';
import { lerNotificacaoDaIntegracao, linkDoCard, quemRecebePorPadrao } from './notificacoes.js';

test('lerNotificacaoDaIntegracao: tipo desconhecido é ignorado; opcionais tortos não recusam', () => {
  assert.deepEqual(lerNotificacaoDaIntegracao({ tipo: 'qualquer' }), { ignorar: true });
  assert.deepEqual(lerNotificacaoDaIntegracao(null), { ignorar: true });
  const r = lerNotificacaoDaIntegracao({
    tipo: 'REUNIAO_AGENDADA_IA', destino: 'ignora', nome: 'Ana', telefone: 5582999990001, card_id: 'nao-e-uuid',
    reuniao_em: 'amanhã', para: ['Arthur', 'LUIS', 'arthur', 7],
  });
  assert.equal(r.ignorar, false);
  if (!('dados' in r)) return;
  assert.equal(r.dados.tipo, 'reuniao_agendada_ia');
  assert.equal(r.dados.telefone, '5582999990001');
  assert.equal(r.dados.card_id, null);
  assert.equal(r.dados.reuniao_em, null);
  assert.deepEqual(r.para, ['arthur', 'luis', '7']);
  assert.equal('destino' in r.dados, false);
  const iso = lerNotificacaoDaIntegracao({ tipo: 'resposta_proposta', reuniao_em: '2026-10-28T10:00:00-03:00' });
  assert.ok('dados' in iso && iso.dados.reuniao_em === '2026-10-28T13:00:00.000Z' && iso.para === null);
});

test('quemRecebePorPadrao: os 3 tipos da conversa vão pros dois; lead novo só pro SDR', () => {
  for (const t of ['transferencia_ia', 'reuniao_agendada_ia', 'resposta_proposta'] as const) {
    assert.deepEqual(quemRecebePorPadrao(t), ['sdr', 'closer'], t);
  }
  assert.deepEqual(quemRecebePorPadrao('lead_novo_ia'), ['sdr']);
  assert.deepEqual(quemRecebePorPadrao('lead_qualificado_ia'), ['sdr']);
});

test('linkDoCard: o CRM IA LUIZA abre como aba do CRM ARTHUR', () => {
  assert.equal(linkDoCard('crm-ia-luiza', 'x'), '/comercial/crm-arthur?quadro=crm-ia-luiza&lead=x');
  assert.equal(linkDoCard('crm-luis-closer', 'y'), '/comercial/crm-luis-closer?lead=y');
});
