import test from 'node:test';
import assert from 'node:assert/strict';
import { montarRelatorio, normalizarAgentes, normalizarLigacao, quando, segundos, type Ligacao } from './tresC.js';

test('segundos: número, HH:MM:SS, MM:SS e texto', () => {
  assert.equal(segundos(95), 95);
  assert.equal(segundos('00:01:35'), 95);
  assert.equal(segundos('01:35'), 95);
  assert.equal(segundos('120'), 120);
  assert.equal(segundos(null), 0);
  assert.equal(segundos('abc'), 0);
});

test('quando: data da 3C sem fuso fica como está; com fuso vira Brasília', () => {
  assert.deepEqual(quando('2026-10-29 09:31:10'), { dia: '2026-10-29', hora: 9, hhmm: '09:31', iso: '2026-10-29T09:31' });
  assert.deepEqual(quando('2026-10-29T12:31:10Z'), { dia: '2026-10-29', hora: 9, hhmm: '09:31', iso: '2026-10-29T09:31' });
  assert.equal(quando(''), null);
});

test('normalizarLigacao: lê campos em formatos diferentes', () => {
  const a = normalizarLigacao({
    id: 10, call_date: '2026-10-29 10:05:00', agent: 'Arthur', agent_id: 7, campaign: { id: 1, name: 'SDR' },
    number: '48999990000', speaking_with_agent_time: '00:02:10', qualification: { name: 'Agendou' }, call_mode: 'manual',
  })!;
  assert.equal(a.agente, 'Arthur');
  assert.equal(a.campanha, 'SDR');
  assert.equal(a.tempoFalado, 130);
  assert.equal(a.atendida, true);
  assert.equal(a.qualificacao, 'Agendou');
  assert.equal(a.modo, 'manual');

  const b = normalizarLigacao({ id: 'x', call_date: '2026-10-29 10:07:00', agent: { name: 'Luis' }, speaking_time: 0, readable_status_text: 'Não atendida' })!;
  assert.equal(b.agente, 'Luis');
  assert.equal(b.atendida, false);

  assert.equal(normalizarLigacao({ id: 1 }), null, 'sem data não entra');
});

test('montarRelatorio: totais, por agente e por hora', () => {
  const l = (agente: string, hhmm: string, falado: number, q = ''): Ligacao => ({
    id: hhmm, dia: '2026-10-29', hora: Number(hhmm.slice(0, 2)), hhmm, quando: `2026-10-29T${hhmm}`,
    agenteId: '', agente, campanha: '', numero: '', status: '', qualificacao: q, modo: 'discador',
    tempoFalado: falado, tempoEspera: 0, atendida: falado > 0, temGravacao: false,
  });
  const r = montarRelatorio([l('Arthur', '09:40', 60, 'Agendou'), l('Arthur', '10:10', 0), l('Luis', '14:45', 120), l('', '15:00', 0)]);
  assert.equal(r.totais.chamadas, 4);
  assert.equal(r.totais.atendidas, 2);
  assert.equal(r.totais.agentes, 2);
  assert.equal(r.totais.tempoMedio, 90);
  const arthur = r.porAgente.find((a) => a.agente === 'Arthur')!;
  assert.equal(arthur.chamadas, 2);
  assert.equal(arthur.primeira, '2026-10-29T09:40');
  assert.equal(arthur.ultima, '2026-10-29T10:10');
  assert.deepEqual(arthur.qualificacoes, [{ nome: 'Agendou', qtd: 1 }]);
  assert.equal(r.porHora.find((h) => h.hora === 14)!.chamadas, 1);
  assert.equal(r.porHora[0].hora, 8);
  assert.equal(r.ultimas[0].hhmm, '15:00');
});

test('normalizarAgentes: status numérico ou texto', () => {
  const ag = normalizarAgentes({ data: [{ id: 1, name: 'Luis', status: 2 }, { id: 2, name: 'Arthur', status: 'Intervalo - almoço' }] });
  assert.equal(ag[0].nome, 'Arthur');
  assert.equal(ag[0].situacao, 'pausa');
  assert.equal(ag[1].status, 'Em ligação');
  assert.equal(ag[1].situacao, 'ligando');
});

test('ehDaPessoa: primeiro nome por padrão, nome completo quando configurado', async () => {
  const { ehDaPessoa } = await import('../routes/ligacoes3c.js');
  assert.equal(ehDaPessoa('Arthur Rosa de Faveri', 'Arthur'), true);
  assert.equal(ehDaPessoa('Luís Otávio', 'Luis'), true);
  assert.equal(ehDaPessoa('Luiza', 'Luis'), false);
  assert.equal(ehDaPessoa('Arthur Rosa', 'Arthur Rosa'), true);
  assert.equal(ehDaPessoa('Arthur Silva', 'Arthur Rosa'), false);
  assert.equal(ehDaPessoa('', 'Arthur'), false);
});
