import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ROTINAS_INICIAIS, agoraLocal, blocosComecando, ehDiaDeRotina, estadoDoBloco, marcouAtrasado, podeMarcar, segundaDaSemana,
  textoDoAviso, validarBlocos, validarMarcacao,
} from './rotina.js';

const tarefa = { inicio: '10:00', fim: '10:45', tipo: 'tarefa' as const };
const reuniao = { ...tarefa, tipo: 'reuniao' as const };
const dia = '2026-10-27'; // terça
const as = (hora: string, data = dia) => ({ data, hora });
const feito = { status: 'feito' as const, motivo: '', marcado_em: `${dia}T10:40` };

test('agoraLocal: horário de Brasília (-03:00)', () => {
  assert.deepEqual(agoraLocal(new Date('2026-10-27T13:05:00Z')), { data: '2026-10-27', hora: '10:05' });
  assert.deepEqual(agoraLocal(new Date('2026-10-28T02:30:00Z')), { data: '2026-10-27', hora: '23:30' });
});

test('dias: segunda a sexta, e a segunda da semana', () => {
  assert.equal(ehDiaDeRotina('2026-10-26'), true);
  assert.equal(ehDiaDeRotina('2026-10-30'), true);
  assert.equal(ehDiaDeRotina('2026-10-31'), false);
  assert.equal(ehDiaDeRotina('2026-11-01'), false);
  assert.equal(segundaDaSemana('2026-10-27'), '2026-10-26');
  assert.equal(segundaDaSemana('2026-11-01'), '2026-10-26');
  assert.equal(segundaDaSemana('2026-10-26'), '2026-10-26');
});

test('estadoDoBloco: futuro, agora, pendente por 30 min, depois sem resposta', () => {
  assert.equal(estadoDoBloco(tarefa, dia, as('09:59'), null, false), 'futuro');
  assert.equal(estadoDoBloco(tarefa, dia, as('10:00'), null, false), 'agora');
  assert.equal(estadoDoBloco(tarefa, dia, as('10:44'), null, false), 'agora');
  assert.equal(estadoDoBloco(tarefa, dia, as('10:45'), null, false), 'pendente');
  assert.equal(estadoDoBloco(tarefa, dia, as('11:14'), null, false), 'pendente');
  assert.equal(estadoDoBloco(tarefa, dia, as('11:15'), null, false), 'sem_resposta');
  assert.equal(estadoDoBloco(tarefa, '2026-10-26', as('08:00'), null, false), 'sem_resposta', 'dia anterior sem marcar');
  assert.equal(estadoDoBloco(tarefa, '2026-10-28', as('17:00'), null, false), 'futuro', 'dia seguinte');
});

test('estadoDoBloco: a marcação vale; bloco de reunião com reunião não pede marcação', () => {
  assert.equal(estadoDoBloco(tarefa, dia, as('10:20'), feito, false), 'feito');
  assert.equal(estadoDoBloco(reuniao, dia, as('11:00'), null, true), 'reuniao');
  assert.equal(estadoDoBloco(reuniao, dia, as('10:10'), null, true), 'agora');
  assert.equal(estadoDoBloco(reuniao, dia, as('11:00'), null, false), 'pendente', 'sem reunião: marca a tarefa do lugar');
  assert.equal(estadoDoBloco(reuniao, dia, as('11:00'), { ...feito, status: 'parcial' }, true), 'parcial');
});

test('bloco criado depois do horário não cobra (não vira sem resposta)', () => {
  assert.equal(estadoDoBloco(tarefa, '2026-10-26', as('15:00'), null, false, '2026-10-27T14:30'), 'fora');
  assert.equal(estadoDoBloco(tarefa, dia, as('15:00'), null, false, `${dia}T14:30`), 'fora');
  assert.equal(estadoDoBloco(tarefa, dia, as('15:00'), null, false, `${dia}T10:20`), 'sem_resposta', 'criado no meio do bloco: conta');
  assert.equal(podeMarcar(tarefa, dia, as('15:00'), `${dia}T14:30`), false);
  assert.equal(podeMarcar(tarefa, dia, as('10:30'), `${dia}T10:20`), true);
});

test('podeMarcar: só no dia, depois que começou; atrasado depois de fim + 30 min', () => {
  assert.equal(podeMarcar(tarefa, dia, as('09:59')), false);
  assert.equal(podeMarcar(tarefa, dia, as('10:00')), true);
  assert.equal(podeMarcar(tarefa, dia, as('17:00')), true);
  assert.equal(podeMarcar(tarefa, '2026-10-26', as('09:00')), false);
  assert.equal(marcouAtrasado(tarefa, dia, { ...feito, marcado_em: `${dia}T11:15` }), false);
  assert.equal(marcouAtrasado(tarefa, dia, { ...feito, marcado_em: `${dia}T11:16` }), true);
});

test('validarMarcacao: parcial e não deu pedem motivo', () => {
  assert.deepEqual(validarMarcacao({ status: 'feito' }), { ok: { status: 'feito', motivo: '' } });
  assert.ok('erro' in validarMarcacao({ status: 'parcial', motivo: 'ok' }));
  assert.ok('erro' in validarMarcacao({ status: 'talvez' }));
  assert.deepEqual(validarMarcacao({ status: 'nao_deu', motivo: '  Reunião estourou  ' }), { ok: { status: 'nao_deu', motivo: 'Reunião estourou' } });
});

test('validarBlocos: horários, título, tipo; volta em ordem de horário', () => {
  const ok = validarBlocos({ blocos: [
    { inicio: '13:30', fim: '14:00', titulo: 'B', tipo: 'tarefa', itens: [' x ', '', 3] },
    { inicio: '08:00', fim: '09:00', titulo: 'A', tipo: 'reuniao' },
  ] });
  assert.ok('ok' in ok);
  if ('ok' in ok) {
    assert.deepEqual(ok.ok.map((b) => b.titulo), ['A', 'B']);
    assert.deepEqual(ok.ok[1].itens, ['x']);
  }
  assert.match((validarBlocos({ blocos: [{ inicio: '8:00', fim: '09:00', titulo: 'A', tipo: 'tarefa' }] }) as { erro: string }).erro, /horário/);
  assert.match((validarBlocos({ blocos: [{ inicio: '09:00', fim: '09:00', titulo: 'A', tipo: 'tarefa' }] }) as { erro: string }).erro, /depois/);
  assert.match((validarBlocos({ blocos: [{ inicio: '08:00', fim: '09:00', titulo: ' ', tipo: 'tarefa' }] }) as { erro: string }).erro, /título/);
  assert.match((validarBlocos({ blocos: [{ inicio: '08:00', fim: '09:00', titulo: 'A', tipo: 'x' }] }) as { erro: string }).erro, /tipo/);
});

test('blocosComecando: avisa do horário até 5 min depois', () => {
  const blocos = [{ inicio: '09:00' }, { inicio: '09:45' }];
  assert.deepEqual(blocosComecando(blocos, '08:59'), []);
  assert.deepEqual(blocosComecando(blocos, '09:00'), [{ inicio: '09:00' }]);
  assert.deepEqual(blocosComecando(blocos, '09:04'), [{ inicio: '09:00' }]);
  assert.deepEqual(blocosComecando(blocos, '09:05'), []);
});

test('textoDoAviso: reunião do horário, ou o que fazer sem reunião, e o que falta marcar', () => {
  const b = { inicio: '10:00', fim: '10:45', titulo: 'Reunião', tipo: 'reuniao' as const, itens: ['Sem reunião: retorna as propostas.', 'Social selling.'] };
  assert.deepEqual(textoDoAviso(b, [{ nome: 'Poliane', empresa: 'Loja X', agendamento: '2026-10-27T10:00' }], []),
    { title: '10:00–10:45 · Reunião', body: 'Reunião 10:00: Poliane' });
  assert.equal(textoDoAviso(b, [], []).body, 'Sem reunião: retorna as propostas. Social selling.');
  assert.equal(textoDoAviso({ ...b, tipo: 'tarefa', itens: [] }, [], [{ inicio: '09:00', titulo: 'Início do dia' }]).body,
    'Hora de começar esse bloco. · Falta marcar: 09:00 Início do dia');
});

test('rotinas iniciais: válidas e sem bloco sobreposto', () => {
  for (const [pagina, blocos] of Object.entries(ROTINAS_INICIAIS)) {
    const v = validarBlocos({ blocos });
    assert.ok('ok' in v, pagina);
    for (let i = 1; i < blocos.length; i++) assert.ok(blocos[i].inicio >= blocos[i - 1].fim, `${pagina}: ${blocos[i].inicio}`);
  }
  assert.equal(ROTINAS_INICIAIS['crm-arthur'].length, 7);
  assert.equal(ROTINAS_INICIAIS['crm-luis-closer'].length, 14);
});
