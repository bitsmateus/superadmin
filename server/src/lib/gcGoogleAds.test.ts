import test from 'node:test';
import assert from 'node:assert/strict';
import { consultaCampanhas, formatarCustomerId, linhaDaApi, mensagemDeErroGoogle, montarTotaisGoogle, normalizarCustomerId } from './gcGoogleAds.js';

test('ID de cliente do Google Ads: aceita com traço e espaço, recusa o que não tem 10 dígitos', () => {
  assert.equal(normalizarCustomerId('123-456-7890'), '1234567890');
  assert.equal(normalizarCustomerId(' 123 456 7890 '), '1234567890');
  assert.equal(normalizarCustomerId('12345'), null);
  assert.equal(formatarCustomerId('1234567890'), '123-456-7890');
});

test('linha da API (camelCase, valores em micros) vira linha do banco', () => {
  const l = linhaDaApi({
    segments: { date: '2026-11-10' },
    campaign: { id: '987', name: 'Pesquisa - Marca', status: 'ENABLED', advertisingChannelType: 'SEARCH' },
    campaignBudget: { amountMicros: '50000000' },
    metrics: { costMicros: '12345678', impressions: '1000', clicks: '40', conversions: 3.5, conversionsValue: 700 },
  })!;
  assert.deepEqual(l, {
    dia: '2026-11-10', campaignId: '987', nome: 'Pesquisa - Marca', status: 'ENABLED', canal: 'SEARCH', orcamentoDia: 50,
    gasto: 12.35, impressoes: 1000, cliques: 40, conversoes: 3.5, valorConversoes: 700,
  });
  assert.equal(linhaDaApi({ metrics: {} }), null);
  assert.equal(linhaDaApi({ segments: { date: '2026-11-10' }, campaign: { id: '1' } })!.gasto, 0);
});

test('totais: CTR, CPC, custo por conversão e ROAS', () => {
  const t = montarTotaisGoogle({ gasto: '200', impressoes: '10000', cliques: '100', conversoes: '10', valor_conversoes: '1000' });
  assert.equal(t.ctr, 0.01);
  assert.equal(t.cpc, 2);
  assert.equal(t.custoConversao, 20);
  assert.equal(t.roas, 5);
  const vazio = montarTotaisGoogle(null);
  assert.equal(vazio.gasto, 0);
  assert.equal(vazio.cpc, null);
});

test('consulta GAQL usa o período pedido', () => {
  assert.match(consultaCampanhas('2026-11-01', '2026-11-07'), /segments\.date BETWEEN '2026-11-01' AND '2026-11-07'/);
});

test('erro de permissão do Google vira mensagem que diz o que fazer', () => {
  const corpo = [{ error: { message: 'x', status: 'PERMISSION_DENIED', details: [{ errors: [{ errorCode: { authorizationError: 'USER_PERMISSION_DENIED' }, message: "User doesn't have permission" }] }] } }];
  assert.match(mensagemDeErroGoogle(403, corpo), /vincule-a à MCC/);
  assert.match(mensagemDeErroGoogle(500, { error: { message: 'Internal' } }), /Google Ads 500: Internal/);
});
