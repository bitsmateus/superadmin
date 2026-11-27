import test from 'node:test';
import assert from 'node:assert/strict';
import { lerPrazoESite } from './formularioMeta.js';

const RAW = {
  full_name: 'Maria', form_id: '3762735517212360', campaign_name: 'Campanha X',
  'quando_você_quer_colocar_isso_pra_rodar?': 'nos_próximos_30_dias',
  'qual_o_instagram_ou_site_da_sua_empresa?': '@clinicamaria',
};

test('sem os campos no topo, acha no raw pela pergunta (sem ligar pra acento e maiúscula)', () => {
  assert.deepEqual(lerPrazoESite({ raw: RAW }), { prioridade: 'nos_próximos_30_dias', siteEmpresa: '@clinicamaria' });
  assert.deepEqual(lerPrazoESite({ raw: { 'QUANDO pretende começar?': 'o_quanto_antes', 'Seu SITE': 'empresa.com.br' } }), { prioridade: 'o_quanto_antes', siteEmpresa: 'empresa.com.br' });
});

test('o topo do payload vale mais que o raw: "prazo" ou "prioridade", e "site_empresa"', () => {
  assert.deepEqual(lerPrazoESite({ prazo: 'em_2_a_3_meses', site_empresa: 'a.com', raw: RAW }), { prioridade: 'em_2_a_3_meses', siteEmpresa: 'a.com' });
  assert.equal(lerPrazoESite({ prioridade: 'só_estou_pesquisando' }).prioridade, 'só_estou_pesquisando');
});

test('sem resposta: null (a tela mostra "Sem ID" e "–"); campos extras e tipos estranhos não quebram', () => {
  assert.deepEqual(lerPrazoESite({ lead_id: '1', raw: { full_name: 'João' }, extra: { a: 1 }, outro: [1, 2] }), { prioridade: null, siteEmpresa: null });
  assert.deepEqual(lerPrazoESite({}), { prioridade: null, siteEmpresa: null });
  assert.deepEqual(lerPrazoESite({ prazo: { x: 1 }, site_empresa: null, raw: 'texto' }), { prioridade: null, siteEmpresa: null });
  assert.deepEqual(lerPrazoESite({ raw: { 'quando_rodar?': '', 'instagram?': '   ' } }), { prioridade: null, siteEmpresa: null });
});

test('a pergunta com "rodar" ganha de outra com "quando"; instagram ganha de site; lista vale o primeiro', () => {
  const raw = { 'desde_quando_a_empresa_existe?': '2010', 'quando_quer_rodar?': 'o_quanto_antes', 'tem_site?': 'sim', 'qual_o_instagram?': '@x' };
  assert.deepEqual(lerPrazoESite({ raw }), { prioridade: 'o_quanto_antes', siteEmpresa: '@x' });
  assert.equal(lerPrazoESite({ raw: { 'quando_rodar?': ['em_2_a_3_meses'] } }).prioridade, 'em_2_a_3_meses');
});
