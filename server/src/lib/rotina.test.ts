import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ROTINAS_INICIAIS, agoraLocal, ehDiaDeRotina, estadoDoBloco, podeMarcar, segundaDaSemana, validarBlocos,
} from './rotina.js';

const bloco = { inicio: '10:00', fim: '10:45' };
const dia = '2026-10-27'; // terça
const as = (hora: string, data = dia) => ({ data, hora });

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

test('estadoDoBloco: futuro, agora, não feito depois do horário; feito vale sempre', () => {
  assert.equal(estadoDoBloco(bloco, dia, as('09:59'), false), 'futuro');
  assert.equal(estadoDoBloco(bloco, dia, as('10:00'), false), 'agora');
  assert.equal(estadoDoBloco(bloco, dia, as('10:45'), false), 'nao_feito');
  assert.equal(estadoDoBloco(bloco, '2026-10-26', as('08:00'), false), 'nao_feito', 'dia anterior sem marcar');
  assert.equal(estadoDoBloco(bloco, '2026-10-28', as('17:00'), false), 'futuro', 'dia seguinte');
  assert.equal(estadoDoBloco(bloco, dia, as('09:00'), true), 'feito', 'marcou antes do horário');
});

test('bloco criado depois do horário não conta como não feito', () => {
  assert.equal(estadoDoBloco(bloco, '2026-10-26', as('15:00'), false, '2026-10-27T14:30'), 'fora');
  assert.equal(estadoDoBloco(bloco, dia, as('15:00'), false, `${dia}T14:30`), 'fora');
  assert.equal(estadoDoBloco(bloco, dia, as('15:00'), false, `${dia}T10:20`), 'nao_feito', 'criado no meio do bloco: conta');
});

test('podeMarcar: só o dia de hoje', () => {
  assert.equal(podeMarcar(dia, as('07:00')), true);
  assert.equal(podeMarcar('2026-10-26', as('09:00')), false);
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

test('rotinas iniciais: válidas e sem bloco sobreposto', () => {
  for (const [pagina, blocos] of Object.entries(ROTINAS_INICIAIS)) {
    const v = validarBlocos({ blocos });
    assert.ok('ok' in v, pagina);
    for (let i = 1; i < blocos.length; i++) assert.ok(blocos[i].inicio >= blocos[i - 1].fim, `${pagina}: ${blocos[i].inicio}`);
  }
  assert.equal(ROTINAS_INICIAIS['crm-arthur'].length, 7);
  assert.equal(ROTINAS_INICIAIS['crm-luis-closer'].length, 14);
});
