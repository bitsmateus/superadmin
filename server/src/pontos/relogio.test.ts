import test from 'node:test';
import assert from 'node:assert/strict';
import * as XLSX from 'xlsx';
import { lerPlanilha, lerPeriodoDoTexto, tipoDoTurno, vincularNome } from './planilha.js';
import { calcularPeriodo, formatarMinutos, type ConfigColaborador, type TurnoDoDia } from './calculo.js';
import { compararComResumo } from './conferencia.js';

/**
 * Exportação do relógio de ponto (dados fictícios no MESMO formato da planilha real: abas resumo, Turnos, Registros,
 * Anormal e 12.13; período em texto com TAB; dias 1..31 na linha 4 com a coluna A = dia 1; cada colaborador em 2 linhas,
 * "No:" na coluna C, "Nome:" na K e "Dept:" na U; batidas separadas por quebra de linha).
 */
const DIAS = 16; // 2026/11/01 ~ 11/16
const SEMANA = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa']; // 01/11/2026 é domingo

function linhaColaborador(no: number, nome: string): string[] {
  const l = Array<string>(22).fill('');
  l[2] = 'No:'; l[3] = String(no); l[10] = 'Nome:'; l[11] = nome; l[20] = 'Dept:'; l[21] = 'nx digital';
  return l;
}
function linhaBatidas(porDia: Record<number, string[]>): string[] {
  return Array.from({ length: DIAS }, (_, i) => (porDia[i + 1] ? porDia[i + 1].map((h) => `${h}\n`).join('') : ''));
}

// "Ausência" do relógio: dias úteis sem batida desde o dia 1 (ele não sabe do início do controle) + o 16 em andamento.
const JOAO = { 10: ['15:12', '18:26'], 11: ['08:26', '18:22'], 12: ['08:18', '12:16', '13:55', '18:10'], 13: ['08:10', '12:14', '13:30', '18:00'], 16: ['08:08', '12:03', '13:30'] };
const JEAN = { 10: ['15:16', '18:26'], 11: ['07:43', '18:00'], 12: ['08:18', '12:00', '13:30', '18:05'], 13: ['07:56', '12:01', '13:30', '18:00'], 16: ['07:50', '12:04', '13:22'] };

export function planilhaDoRelogio(bookType: 'xlsx' | 'biff8' = 'xlsx', extra: { turnos?: Record<number, string> } = {}): Buffer {
  const wb = XLSX.utils.book_new();
  const resumo = [
    ['Relatório resumo'], ['2026/11/01 ~ 11/16\t( nx digital )'],
    ['No', 'Nome', 'Dept', 'Normal', 'Real', 'Atraso (min)', 'Ausência'],
    ['1', 'joao vitor', 'nx digital', '68:00', '28:27', '18', '9'],
    ['2', 'jean may', 'nx digital', '68:00', '28:49', '18', '9'],
  ];
  const turnosLinha = Array.from({ length: DIAS }, (_, i) => {
    const dow = (i) % 7; // dia 1 = domingo
    return extra.turnos?.[i + 1] ?? (dow === 0 || dow === 6 ? '' : '1');
  });
  const turnos = [
    ['Turnos'], ['2026/11/01 ~ 11/16\t( nx digital )'],
    Array.from({ length: DIAS }, (_, i) => String(i + 1)),
    Array.from({ length: DIAS }, (_, i) => SEMANA[i % 7]),
    turnosLinha,
    ['Legenda: 1 = turno; 25 = licença; 26 = viagem; férias'],
  ];
  const registros = [
    ['Relatório de registros'],
    ['2026/11/01 ~ 11/16\t( nx digital )'],
    [''],
    Array.from({ length: DIAS }, (_, i) => i + 1),
    linhaColaborador(1, 'joao vitor'), linhaBatidas(JOAO),
    linhaColaborador(2, 'jean may'), linhaBatidas(JEAN),
  ];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(resumo), 'resumo');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(turnos), 'Turnos');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(registros), 'Registros');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['Anormal'], ['joao vitor', '2026-11-03', 'Ausência']]), 'Anormal');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['12.13'], ['qualquer coisa']]), '12.13');
  return XLSX.write(wb, { type: 'buffer', bookType });
}

const CFG: ConfigColaborador = {
  diasSemana: [1, 2, 3, 4, 5], minutosDia: 510, minutosSabado: 240, minutosDomingo: 0,
  entradaPrevista: '08:00', saidaPrevista: '18:00', intervaloMinutos: 90, intervaloInicio: '12:00', toleranciaMinutos: 10,
  salarioBaseCentavos: 0, divisorMensal: 220, valorHoraCentavos: null, pctExtraUtil: 50, pctExtraDomingoFeriado: 100,
  destinoExtra: 'banco', inicioControle: '2026-11-10',
};

test('período em texto: "2026/11/01 ~ 11/16\\t( nx digital )"', () => {
  assert.deepEqual(lerPeriodoDoTexto('2026/11/01 ~ 11/16\t( nx digital )'), { inicio: '2026-11-01', fim: '2026-11-16' });
  assert.deepEqual(lerPeriodoDoTexto('2026/12/21 ~ 01/20'), { inicio: '2026-12-21', fim: '2027-01-20' });
  assert.deepEqual(lerPeriodoDoTexto('2026/10/26 ~ 2026/11/25'), { inicio: '2026-10-26', fim: '2026-11-25' });
  assert.equal(lerPeriodoDoTexto('Relatório'), null);
});

test('código da aba Turnos: vazio = sem turno, 1 = turno, 25/26/férias = justificada', () => {
  assert.equal(tipoDoTurno('').tipo, 'sem_turno');
  assert.equal(tipoDoTurno('1').tipo, 'turno');
  assert.deepEqual(tipoDoTurno('25'), { tipo: 'justificada', codigo: '25' });
  assert.equal(tipoDoTurno('26').tipo, 'justificada');
  assert.equal(tipoDoTurno('Férias').tipo, 'justificada');
});

for (const bookType of ['xlsx', 'biff8'] as const) {
  test(`lê a exportação do relógio (${bookType === 'biff8' ? '.xls' : '.xlsx'}): Registros, Turnos e resumo`, () => {
    const l = lerPlanilha(planilhaDoRelogio(bookType, { turnos: { 3: '25' } }));
    assert.equal(l.formato, 'relogio');
    assert.deepEqual(l.periodoArquivo, { inicio: '2026-11-01', fim: '2026-11-16' });
    assert.deepEqual(l.nomes, ['joao vitor', 'jean may']);
    assert.equal(l.abas.length, 1);
    assert.equal(l.abas[0].precisaMapeamento, false);
    const joao = l.registros.filter((r) => r.nome === 'joao vitor');
    assert.deepEqual(joao.map((r) => r.data), ['2026-11-10', '2026-11-11', '2026-11-12', '2026-11-13', '2026-11-16']);
    assert.deepEqual(joao[2].horas, ['08:18', '12:16', '13:55', '18:10']);
    assert.deepEqual(joao[4].horas, ['08:08', '12:03', '13:30']);
    // Turnos: uma linha só (vale pra todos), 16 dias; dia 3 com código 25 (licença); fim de semana sem turno.
    assert.equal(l.turnos.length, 16);
    assert.ok(l.turnos.every((t) => t.nome === '*'));
    assert.deepEqual(l.turnos.find((t) => t.data === '2026-11-03'), { nome: '*', data: '2026-11-03', tipo: 'justificada', codigo: '25' });
    assert.equal(l.turnos.find((t) => t.data === '2026-11-14')!.tipo, 'sem_turno');
    assert.equal(l.turnos.find((t) => t.data === '2026-11-16')!.tipo, 'turno');
    // resumo: só pra conferência.
    assert.equal(l.conferencia.length, 2);
    assert.equal(l.conferencia[0].campos['Ausência'], '9');
    assert.match(l.observacoes.join(' '), /resumo, Anormal, 12\.13/);
  });
}

test('apelidos "joao vitor" e "jean may" reconhecem João e Jean; Arthur fica de fora', () => {
  const colabs = [
    { id: 'j', nome: 'João', apelidos: ['joao vitor'], ativo: true },
    { id: 'e', nome: 'Jean', apelidos: ['jean may'], ativo: true },
    { id: 'a', nome: 'Arthur', apelidos: [], ativo: true },
  ];
  assert.equal(vincularNome('joao vitor', colabs), 'j');
  assert.equal(vincularNome('jean may', colabs), 'e');
});

test('planilha do relógio -> cálculo: bate com o resultado esperado (seção 5) e avisa a divergência do resumo', () => {
  const l = lerPlanilha(planilhaDoRelogio());
  const turnos = new Map<string, TurnoDoDia>(l.turnos.map((t) => [t.data, { tipo: t.tipo, codigo: t.codigo }]));
  const cobertos = new Set(l.turnos.map((t) => t.data));
  const calc = (nome: string) => {
    const batidas = new Map(l.registros.filter((r) => r.nome === nome).map((r) => [r.data, r.horas]));
    return calcularPeriodo({
      inicio: '2026-11-01', fim: '2026-11-16', cfg: CFG, batidas, feriados: new Map([['2026-11-02', 'Finados'], ['2026-11-15', 'Proclamação da República']]),
      ajustes: new Map(), cobertos, turnos, hoje: '2026-11-16',
    });
  };
  const joao = calc('joao vitor');
  const linha = (d: string) => joao.dias.find((x) => x.data === d)!;
  assert.deepEqual(
    ['10', '11', '12', '13'].map((d) => [formatarMinutos(linha(`2026-11-${d}`).trabalhadoMinutos), formatarMinutos(linha(`2026-11-${d}`).saldoMinutos)]),
    [['3h14', '-5h16'], ['8h26', '0h00'], ['8h13', '-0h17'], ['8h34', '0h00']],
  );
  assert.equal(linha('2026-11-12').atrasoMinutos, 43);
  assert.equal(linha('2026-11-16').status, 'em_andamento');
  assert.equal(formatarMinutos(joao.resumo.bancoMinutos), '-5h33');
  assert.equal(joao.resumo.faltas, 0);
  // Dias 03 a 09 (antes do controle) não viram falta, mesmo o relógio contando "Ausência".
  assert.ok(['2026-11-03', '2026-11-04', '2026-11-09'].every((d) => linha(d).status === 'fora_controle'));

  const jean = calc('jean may');
  assert.equal(formatarMinutos(jean.resumo.bancoMinutos), '-5h16');
  assert.equal(formatarMinutos(jean.resumo.extraMinutos), '0h17');

  // Conferência: o relógio diz 9 ausências e 18 min de atraso; o nosso cálculo diz 0 falta e 181 min de atraso bruto (João: 102 + 26 + 43 + 10).
  const avisos = compararComResumo(l.conferencia[0].campos, joao.resumo, joao.dias.filter((d) => d.atrasoMinutos > 0).length);
  assert.equal(avisos.length, 2);
  assert.match(avisos[0], /Atraso \(min\)" no relógio = 18; no nosso cálculo = 181 min \(atraso bruto\)/);
  assert.match(avisos[1], /Ausência" no relógio = 9; no nosso cálculo = 0 falta/);
});
