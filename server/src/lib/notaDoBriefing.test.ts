import test from 'node:test';
import assert from 'node:assert/strict';
import { comNotaDoBriefing, ID_NOTA_BRIEFING, textoDaNotaDoBriefing } from './notaDoBriefing.js';

const BRIEFING = {
  razaoSocial: 'AUTO CENTER LTDA',
  nomeFantasia: 'Auto Center',
  cnpj: '12.345.678/0001-90',
  site: 'www.autocenter.com.br',
  users: [{ name: 'Maria', email: 'maria@x.com', sectors: ['Vendas', 'Suporte'], role: 'atendente' }],
  schedule: [{ day: 'Segunda', active: true, start: '08:00', end: '18:00' }, { day: 'Domingo', active: false, start: '', end: '' }],
  timezone: 'America/Sao_Paulo',
  whatsappNumbers: ['5548999990000'],
  whatsappType: 'api_oficial',
  useFacebook: true,
  facebookEmail: 'login@x.com',
  facebookPassword: 'SENHA-SECRETA-123',
  facebookToken: 'TOKEN-SECRETO',
  greetingMessage: 'Olá! Como posso ajudar?',
  offHoursEnabled: false,
  departments: ['Vendas', 'Suporte'],
  useAI: true,
  aiTone: 'casual',
  aiServices: 'Troca de óleo e alinhamento',
  channelAccess: { instagram: { email: 'ig@x.com', password: 'SENHA-IG-999' } },
  customAnswers: { horario_feriado: 'Fecha nos feriados' },
  submittedAt: '2026-11-23T14:00:00Z',
};

test('a nota traz o que o cliente respondeu, por seção, em português', () => {
  const t = textoDaNotaDoBriefing(BRIEFING, new Date('2026-11-23T17:05:00Z'));
  assert.match(t, /^📋 BRIEFING PREENCHIDO PELO CLIENTE — 23\/11\/2026,? 14:05/);
  assert.match(t, /EMPRESA\nRazão social: AUTO CENTER LTDA\nNome fantasia: Auto Center\nCNPJ: 12\.345\.678\/0001-90\nSite: www\.autocenter\.com\.br/);
  assert.match(t, /ATENDENTES\n• Maria — maria@x\.com · setor: Vendas, Suporte · atendente/);
  assert.match(t, /HORÁRIO DE ATENDIMENTO\n• Segunda: 08:00 às 18:00\nFuso: America\/Sao_Paulo/);
  assert.doesNotMatch(t, /Domingo/); // dia inativo não entra
  assert.match(t, /Números: 5548999990000/);
  assert.match(t, /Mensagem fora do horário: não enviar/);
  assert.match(t, /Usa IA: Sim\nTom: Casual/);
  assert.match(t, /Serviços\/produtos: Troca de óleo e alinhamento/);
  assert.match(t, /horario_feriado: Fecha nos feriados/);
});

test('senhas, tokens e e-mails de login de redes NUNCA vão pra nota', () => {
  const t = textoDaNotaDoBriefing(BRIEFING);
  for (const segredo of ['SENHA-SECRETA-123', 'TOKEN-SECRETO', 'SENHA-IG-999', 'login@x.com', 'ig@x.com']) assert.ok(!t.includes(segredo), segredo);
  assert.match(t, /Acessos por canal informados: instagram/);
});

test('sem nada respondido não gera nota', () => {
  assert.equal(textoDaNotaDoBriefing({}), '');
  assert.equal(textoDaNotaDoBriefing(null), '');
  assert.equal(textoDaNotaDoBriefing({ razaoSocial: '  ', users: [], whatsappNumbers: [] }), '');
});

test('comNotaDoBriefing: entra no topo, marcada como nota interna; reenvio troca a antiga em vez de empilhar', () => {
  const minha = { id: 'abc', text: 'nota do suporte', author: 'Jean', createdAt: '2026-11-20T10:00:00Z', internal: true, origem: 'notas_internas' };
  const a = comNotaDoBriefing([minha], BRIEFING, new Date('2026-11-23T17:00:00Z')) as Array<{ id: string; origem?: string; internal?: boolean; author: string }>;
  assert.equal(a.length, 2);
  assert.equal(a[0].id, ID_NOTA_BRIEFING);
  assert.equal(a[0].origem, 'notas_internas');
  assert.equal(a[0].internal, true);
  assert.equal(a[0].author, 'Cliente (briefing)');
  assert.equal(a[1].id, 'abc');
  const b = comNotaDoBriefing(a, { ...BRIEFING, site: 'novo.com.br' }, new Date('2026-11-24T10:00:00Z')) as Array<{ id: string; text: string }>;
  assert.equal(b.length, 2);
  assert.match(b[0].text, /Site: novo\.com\.br/);
  // sem conteúdo útil, mantém as notas como estavam (e tira a do briefing, que ficou vazia)
  assert.deepEqual(comNotaDoBriefing([minha], {}), [minha]);
  assert.deepEqual(comNotaDoBriefing(undefined, BRIEFING).length, 1);
});
