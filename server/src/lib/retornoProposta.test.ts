import test from 'node:test';
import assert from 'node:assert/strict';
import {
  contarHistorico, ehQuadroDeProposta, estadoEmReuniao, rotuloDoEventoDeRetorno, rotuloDoEventoEmReuniao, textoDaNotaDeRetorno, validarRetorno,
} from './retornoProposta.js';

const agora = new Date('2026-10-27T13:30:00Z'); // 10:30 em Brasília
const semHistorico = { adiamentos: 0, tentativas: 0 };
const erroDe = (r: ReturnType<typeof validarRetorno>) => ('erro' in r ? r.erro : '');
const conversa = 'Falei com ele, quer ajustar o plano pra 3 atendentes.';

test('ehQuadroDeProposta: Proposta enviada e Follow-up (os jeitos de escrever), mais nada', () => {
  for (const n of ['Proposta enviada', 'Proposta Enviada', 'Follow-up Propostas', 'FOLLOW UP PROPOSTAS (APÓS 3 TENTATIVAS)', 'Followup Propostas']) {
    assert.equal(ehQuadroDeProposta(n), true, n);
  }
  for (const n of ['Reunião agendada', 'Vendido', 'Perdidos']) assert.equal(ehQuadroDeProposta(n), false, n);
});

test('contarHistorico: adiamentos seguidos e tentativas desde o último contato', () => {
  assert.deepEqual(contarHistorico([]), { adiamentos: 0, tentativas: 0 });
  assert.deepEqual(contarHistorico(['Adiado pra x', 'Adiado pra y', 'Sem resposta · 1ª tentativa']), { adiamentos: 2, tentativas: 1 });
  assert.deepEqual(contarHistorico(['Sem resposta · 2ª', 'Adiado pra y', 'Sem resposta · 1ª', 'Retornou · ainda negociando', 'Sem resposta · 1ª']),
    { adiamentos: 0, tentativas: 2 });
});

test('retornou: conversa obrigatória e o desfecho pede o que precisa', () => {
  assert.match(erroDe(validarRetorno({ resultado: 'retornou', observacao: 'curto', desfecho: 'negociando' }, agora, semHistorico)), /conversado/);
  assert.match(erroDe(validarRetorno({ resultado: 'retornou', observacao: conversa }, agora, semHistorico)), /como ficou/);
  assert.match(erroDe(validarRetorno({ resultado: 'retornou', observacao: conversa, desfecho: 'negociando' }, agora, semHistorico)), /nova data/);
  assert.match(erroDe(validarRetorno({ resultado: 'retornou', observacao: conversa, desfecho: 'negociando', retornar_novo: '2026-10-27T09:00' }, agora, semHistorico)), /futuro/);
  const neg = validarRetorno({ resultado: 'retornou', observacao: conversa, desfecho: 'negociando', retornar_novo: '2026-10-29T14:00' }, agora, semHistorico);
  assert.ok('ok' in neg && neg.ok.retornarNovo === '2026-10-29T14:00');
  assert.match(erroDe(validarRetorno({ resultado: 'retornou', observacao: conversa, desfecho: 'perdeu', motivo: 'Sem orçamento' }, agora, semHistorico)), /Detalhe/);
  const perdeu = validarRetorno({ resultado: 'retornou', observacao: conversa, desfecho: 'perdeu', motivo: 'Sem orçamento', motivo_detalhe: 'achou caro demais' }, agora, semHistorico);
  assert.ok('ok' in perdeu && perdeu.ok.motivoPerda === 'Sem orçamento: achou caro demais');
  assert.match(erroDe(validarRetorno({ resultado: 'retornou', observacao: conversa, desfecho: 'fechou', valor_mrr: '', valor_implementacao: 'R$ 0,00', origem: 'bio' }, agora, semHistorico)), /MRR/);
  const fechou = validarRetorno({ resultado: 'retornou', observacao: conversa, desfecho: 'fechou', valor_mrr: 'R$ 637,00', valor_implementacao: 'R$ 0,00', origem: 'bio' }, agora, semHistorico);
  assert.ok('ok' in fechou && fechou.ok.valorMrr === 'R$ 637,00');
});

test('sem resposta: por onde tentou + novo retorno; na 3ª pode ir pro Follow-up', () => {
  assert.match(erroDe(validarRetorno({ resultado: 'sem_resposta', observacao: 'zap', retornar_novo: '2026-10-28T10:00' }, agora, semHistorico)), /tentou/);
  const primeira = validarRetorno({ resultado: 'sem_resposta', observacao: 'WhatsApp e ligação', retornar_novo: '2026-10-28T10:00', mover_follow_up: true }, agora, semHistorico);
  assert.ok('ok' in primeira && primeira.ok.moverProFollowUp === false); // só na 3ª
  const terceira = validarRetorno({ resultado: 'sem_resposta', observacao: 'WhatsApp e ligação', retornar_novo: '2026-10-28T10:00', mover_follow_up: true }, agora, { adiamentos: 0, tentativas: 2 });
  assert.ok('ok' in terceira && terceira.ok.moverProFollowUp === true);
});

test('adiar: motivo + nova data no futuro, no máximo 2 vezes seguidas', () => {
  assert.match(erroDe(validarRetorno({ resultado: 'adiar', observacao: 'cliente viajando', retornar_novo: '2026-10-28T10:00' }, agora, { adiamentos: 2, tentativas: 0 })), /2 vezes/);
  assert.match(erroDe(validarRetorno({ resultado: 'adiar', observacao: 'x', retornar_novo: '2026-10-28T10:00' }, agora, semHistorico)), /adiar/);
  const ok = validarRetorno({ resultado: 'adiar', observacao: 'Cliente viajando até quarta', retornar_novo: '2026-10-29T10:00' }, agora, { adiamentos: 1, tentativas: 0 });
  assert.ok('ok' in ok && ok.ok.retornarNovo === '2026-10-29T10:00');
});

test('Atualização e evento da Linha do tempo', () => {
  const v = validarRetorno({ resultado: 'sem_resposta', observacao: 'WhatsApp e ligação', retornar_novo: '2026-10-28T10:00' }, agora, { adiamentos: 0, tentativas: 1 });
  assert.ok('ok' in v);
  const t = textoDaNotaDeRetorno(v.ok, '2026-10-27T10:00', 2);
  assert.match(t, /previsto pra 27\/10\/2026 10:00/);
  assert.match(t, /NÃO RESPONDEU \(2ª tentativa\)/);
  assert.match(t, /Próximo retorno: 28\/10\/2026 10:00/);
  assert.equal(rotuloDoEventoDeRetorno(v.ok, 2), 'Sem resposta · 2ª tentativa');
  // O rótulo é o que o contarHistorico lê de volta.
  assert.deepEqual(contarHistorico([rotuloDoEventoDeRetorno(v.ok, 2)]), { adiamentos: 0, tentativas: 1 });
});

test('Estou em reunião: some por 1h, conta só os seguidos e não quebra a conta de adiamentos', () => {
  const ha = (min: number) => new Date(agora.getTime() - min * 60_000);
  assert.deepEqual(estadoEmReuniao([], agora), { usados: 0, escondidoAte: null });
  const recente = estadoEmReuniao([{ to_value: 'Em reunião · 1ª vez, volta às 11:10', created_at: ha(20) }], agora);
  assert.equal(recente.usados, 1);
  assert.equal(recente.escondidoAte?.getTime(), ha(20).getTime() + 60 * 60_000);
  // Passou 1h: volta a aparecer, mas continua contando como usado.
  assert.deepEqual(estadoEmReuniao([
    { to_value: 'Em reunião · 2ª vez', created_at: ha(61) }, { to_value: 'Em reunião · 1ª vez', created_at: ha(130) },
    { to_value: 'Adiado pra x', created_at: ha(3000) }, { to_value: 'Em reunião · 1ª vez', created_at: ha(4000) },
  ], agora), { usados: 2, escondidoAte: null });
  assert.deepEqual(contarHistorico(['Em reunião · 1ª vez', 'Adiado pra x', 'Em reunião · 2ª vez', 'Adiado pra y']), { adiamentos: 2, tentativas: 0 });
  assert.equal(rotuloDoEventoEmReuniao(1, new Date('2026-10-27T14:30:00Z')), 'Em reunião · 1ª vez, volta às 11:30');
});
