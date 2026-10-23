import test from 'node:test';
import assert from 'node:assert/strict';
import {
  agendamentoDaIntegracao, agendamentoParaDate, agendamentoParaIso, cardDaPessoa, dateParaAgendamento, ehAPessoa,
  reunioesPendentes, responsaveisDaReuniao,
  linkDeReuniao, validarResultado, chaveDaReuniao, textoDaNotaDeResultado, type CandidatoReuniao,
} from './reuniaoResultado.js';

test('agendamento: Brasília -03:00 nos dois sentidos, data inválida é null', () => {
  assert.equal(agendamentoParaDate('2026-10-27T09:00')?.toISOString(), '2026-10-27T12:00:00.000Z');
  assert.equal(dateParaAgendamento(new Date('2026-10-27T12:00:00Z')), '2026-10-27T09:00');
  assert.equal(agendamentoParaIso('2026-10-27T09:00'), '2026-10-27T09:00:00-03:00');
  assert.equal(agendamentoParaDate('2026-02-30T09:00'), null);
  assert.equal(agendamentoParaDate('amanhã'), null);
  assert.equal(agendamentoParaIso(''), null);
});

test('agendamentoDaIntegracao: ISO com fuso, Z, formato da ficha, limpar e erro', () => {
  assert.deepEqual(agendamentoDaIntegracao('2026-10-27T09:00:00-03:00'), { valor: '2026-10-27T09:00' });
  assert.deepEqual(agendamentoDaIntegracao('2026-10-27T12:00:00Z'), { valor: '2026-10-27T09:00' });
  assert.deepEqual(agendamentoDaIntegracao('2026-10-27T10:00:00-02:00'), { valor: '2026-10-27T09:00' });
  assert.deepEqual(agendamentoDaIntegracao('2026-10-27T09:00'), { valor: '2026-10-27T09:00' });
  assert.deepEqual(agendamentoDaIntegracao(null), { valor: '' });
  assert.ok('erro' in agendamentoDaIntegracao('27/10/2026 09:00'));
  assert.ok('erro' in agendamentoDaIntegracao(123));
});

type Linha = CandidatoReuniao & { pagina: string };
const c = (o: Partial<Linha> & { id: string }): Linha => ({
  familia: o.id, ehCopiaCloser: false, agendamento: '2026-10-27T09:00', board_id: 'b-arthur', pagina: 'CRM ARTHUR', ...o,
});
const agora = new Date('2026-10-27T13:30:00Z'); // 10:30 em Brasília
const desde = new Date('2026-10-23T03:00:00Z');
const sdrs = ['Arthur', 'Luis', 'IA Luiza'];
const todos = () => true;

test('reunioesPendentes: original + espelho do closer = 1 reunião; só depois de 1h, a partir de "desde", sem resultado', () => {
  const p = reunioesPendentes([
    c({ id: 'orig' }),
    c({ id: 'esp', familia: 'orig', ehCopiaCloser: true, board_id: 'b-closer', pagina: 'CRM LUIS CLOSER' }),
    c({ id: 'cedo', agendamento: '2026-10-27T09:45' }), // 45 min atrás: ainda não
    c({ id: 'b', agendamento: '2026-10-26T15:00' }),
    c({ id: 'velha', agendamento: '2026-09-01T10:00' }), // antes de "desde"
    c({ id: 'feita', agendamento: '2026-10-27T07:00' }),
  ], new Set([chaveDaReuniao('feita', '2026-10-27T07:00')]), agora, desde);
  assert.deepEqual(p.map((x) => x.familia), ['b', 'orig']);
  assert.equal(p[1].linhas.length, 2);
});

test('reunioesPendentes: remarcada volta a ser cobrada no novo horário', () => {
  const feitas = new Set([chaveDaReuniao('x', '2026-10-27T07:00')]);
  assert.equal(reunioesPendentes([c({ id: 'x', agendamento: '2026-10-27T07:00' })], feitas, agora, desde).length, 0);
  assert.equal(reunioesPendentes([c({ id: 'x', agendamento: '2026-10-27T08:30' })], feitas, agora, desde).length, 1);
});

const comEspelho = (agendamento: string) => reunioesPendentes([
  c({ id: 'orig', agendamento }),
  c({ id: 'esp', familia: 'orig', ehCopiaCloser: true, board_id: 'b-closer', pagina: 'CRM LUIS CLOSER', agendamento }),
], new Set(), agora, desde)[0];
const pagina = (l: Linha) => l.pagina;

test('responsáveis: Luis (closer) primeiro; Arthur (SDR da original) só depois de 2h sem resposta; admin nunca', () => {
  const r = comEspelho('2026-10-27T09:00'); // 1h30 atrás
  const resp = responsaveisDaReuniao(r, { sdr: 'Arthur', nomeDaPagina: 'CRM ARTHUR' }, pagina, sdrs);
  assert.deepEqual(resp, { primario: 'Luis', secundario: 'Arthur' });
  assert.equal(cardDaPessoa(r, resp, 'Luis Henrique', todos, agora)?.id, 'esp'); // o closer trabalha a cópia dele
  assert.equal(cardDaPessoa(r, resp, 'Arthur Souza', todos, agora), null); // ainda não
  assert.equal(cardDaPessoa(r, resp, 'Mateus Bitencourt', todos, agora), null); // admin não recebe
  const tarde = comEspelho('2026-10-27T07:00'); // 3h30 atrás: passou de 1h + 2h
  assert.equal(cardDaPessoa(tarde, resp, 'Arthur Souza', todos, agora)?.id, 'orig'); // Arthur trabalha a original
  assert.equal(cardDaPessoa(tarde, resp, 'Luis Henrique', todos, agora)?.id, 'esp'); // Luis continua vendo
});

test('responsáveis: lead da IA Luiza vai pro Arthur (dono da tela do CRM IA LUIZA); sem cópia, o SDR é o primeiro', () => {
  const r = comEspelho('2026-10-27T07:00');
  const resp = responsaveisDaReuniao(r, { sdr: 'IA Luiza', nomeDaPagina: 'CRM IA LUIZA', nomeDaAbaDeFora: 'CRM ARTHUR' }, pagina, sdrs);
  assert.deepEqual(resp, { primario: 'Luis', secundario: 'Arthur' });
  const semCopia = reunioesPendentes([c({ id: 's', agendamento: '2026-10-27T09:00' })], new Set(), agora, desde)[0];
  const r2 = responsaveisDaReuniao(semCopia, { sdr: 'Arthur', nomeDaPagina: 'CRM ARTHUR' }, pagina, sdrs);
  assert.deepEqual(r2, { primario: 'Arthur', secundario: '' });
  assert.equal(cardDaPessoa(semCopia, r2, 'Arthur', todos, agora)?.id, 's');
});

test('cardDaPessoa: só card de quadro que a pessoa enxerga', () => {
  const r = comEspelho('2026-10-27T07:00');
  const resp = { primario: 'Luis', secundario: 'Arthur' };
  assert.equal(cardDaPessoa(r, resp, 'Luis', (b) => b === 'b-closer', agora)?.id, 'esp');
  assert.equal(cardDaPessoa(r, resp, 'Arthur', (b) => b === 'b-arthur', agora)?.id, 'orig');
  assert.equal(cardDaPessoa(r, resp, 'Luis', () => false, agora), null);
});

test('ehAPessoa: primeiro nome sem acento; "IA Luiza" não é ninguém', () => {
  assert.equal(ehAPessoa('Luis', 'Luís Henrique'), true);
  assert.equal(ehAPessoa('Arthur', 'arthur'), true);
  assert.equal(ehAPessoa('Arthur', 'Luis'), false);
  assert.equal(ehAPessoa('IA Luiza', 'Luiza Souza'), false);
  assert.equal(ehAPessoa('', 'Luis'), false);
});

const card = { numero_atendentes: '3', valor_mrr: '50000', valor_implementacao: '0', retornar: '2026-10-30T10:00', motivo_desqualificacao: '' };
const agoraV = new Date('2026-10-27T13:30:00Z');
const resumo = 'Reunião boa, quer proposta pra 3 atendentes.';
const erroDe = (r: ReturnType<typeof validarResultado>) => ('erro' in r ? r.erro : '');

test('validarResultado compareceu: tudo obrigatório; proposta pede Retornar; perdido pede motivo', () => {
  assert.ok('ok' in validarResultado({ resultado: 'compareceu', resumo, proxima_etapa: 'Proposta enviada' }, card, agoraV));
  assert.match(erroDe(validarResultado({ resultado: 'compareceu', resumo: 'curto', proxima_etapa: 'Vendido' }, card, agoraV)), /resumo/);
  assert.match(
    erroDe(validarResultado({ resultado: 'compareceu', resumo, proxima_etapa: 'Vendido' }, { ...card, numero_atendentes: '', valor_mrr: '' }, agoraV)),
    /atendentes.*MRR/,
  );
  assert.match(
    erroDe(validarResultado({ resultado: 'compareceu', resumo, proxima_etapa: 'Follow up Propostas' }, { ...card, retornar: '' }, agoraV)),
    /Retornar/,
  );
  assert.match(erroDe(validarResultado({ resultado: 'compareceu', resumo, proxima_etapa: 'Perdido' }, card, agoraV)), /motivo/);
  const comMotivo = validarResultado(
    { resultado: 'compareceu', resumo, proxima_etapa: 'Perdido' },
    { ...card, motivo_desqualificacao: 'Sem orçamento: achou caro demais agora' }, agoraV,
  );
  assert.ok('ok' in comMotivo && comMotivo.ok.motivo === 'Sem orçamento: achou caro demais agora');
  assert.ok('erro' in validarResultado({ resultado: 'compareceu', resumo, proxima_etapa: 'Reunião agendada' }, card, agoraV));
});

test('validarResultado não compareceu: motivo da lista; "Outro" com texto', () => {
  assert.ok('erro' in validarResultado({ resultado: 'nao_compareceu' }, card, agoraV));
  assert.ok('erro' in validarResultado({ resultado: 'nao_compareceu', motivo: 'qualquer' }, card, agoraV));
  assert.ok('erro' in validarResultado({ resultado: 'nao_compareceu', motivo: 'Outro', motivo_outro: 'ab' }, card, agoraV));
  const ok = validarResultado({ resultado: 'nao_compareceu', motivo: 'Outro', motivo_outro: 'Caiu a energia' }, card, agoraV);
  assert.ok('ok' in ok && ok.ok.motivo === 'Outro: Caiu a energia' && ok.ok.proximaEtapa === 'Reunião não comparecida');
});

test('validarResultado remarcar: nova data e hora no futuro', () => {
  assert.ok('erro' in validarResultado({ resultado: 'remarcada' }, card, agoraV));
  assert.ok('erro' in validarResultado({ resultado: 'remarcada', agendamento_novo: '2026-10-27T10:00' }, card, agoraV)); // 10:00 < 10:30
  const ok = validarResultado({ resultado: 'remarcada', agendamento_novo: '2026-10-27T16:00' }, card, agoraV);
  assert.ok('ok' in ok && ok.ok.agendamentoNovo === '2026-10-27T16:00');
});

test('textoDaNotaDeResultado e linkDeReuniao', () => {
  const v = validarResultado({ resultado: 'compareceu', resumo, proxima_etapa: 'Proposta enviada' }, card, agoraV);
  assert.ok('ok' in v);
  const t = textoDaNotaDeResultado(v.ok, '2026-10-27T09:00', card);
  assert.match(t, /COMPARECEU \(agendada pra 27\/10\/2026 09:00\)/);
  assert.match(t, /Retornar: 30\/10\/2026 10:00/);
  assert.match(t, /Valor MRR: R\$\s?500,00/);
  assert.equal(linkDeReuniao('<p>link: https://meet.google.com/abc-defg-hij.</p>'), 'https://meet.google.com/abc-defg-hij');
  assert.equal(linkDeReuniao('nada aqui', null), null);
});
