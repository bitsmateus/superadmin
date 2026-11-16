import test from 'node:test';
import assert from 'node:assert/strict';
import * as XLSX from 'xlsx';
import { lerPlanilha, lerPeriodoDoTexto, tipoDoTurno, vincularNome } from './planilha.js';
import { calcularPeriodo, formatarMinutos, type ConfigColaborador, type TurnoDoDia } from './calculo.js';
import { compararComResumo } from './conferencia.js';

/**
 * Exportação do relógio de ponto com dados FICTÍCIOS no layout da planilha real (11Resumo-01.xlsx), célula por célula:
 *  - resumo: A2 "Data:", B2 período; cabeçalho em 2 linhas (F3 "Atraso" sobre F4 "Vezes" / G4 "Min"); A5.. colaboradores;
 *  - Turnos: A3 "No" B3 "Nome" C3 "Dept." D3.. dias 1..16; D4.. Su Mo Tu…; A5.. um colaborador por linha, "1" no dia com turno;
 *  - Registros: A3 "Período:", C3 período; A4.. dias 1..16 (coluna A = dia 1); A5 "No:", I5 "Nome:", K5 nome, S5 "Dept:";
 *    linha de baixo: uma célula por dia com as batidas separadas por quebra de linha ("15:12\n18:26\n");
 *  - Anormal e 12.13: não usadas.
 * Só as células preenchidas existem (como no arquivo real: linha 2 da Registros vazia, colunas vazias sem célula).
 */
const DIAS = 16; // 2026/11/01 ~ 11/16
const SEMANA = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa']; // 01/11/2026 é domingo
const PERIODO = '2026/11/01 ~ 11/16\t( nx digital )';
const col = (i: number) => XLSX.utils.encode_col(i);

/** Aba esparsa a partir de { "A1": valor }. */
function aba(celulas: Record<string, string | number>): XLSX.WorkSheet {
  const ws: XLSX.WorkSheet = {};
  let maxR = 0;
  let maxC = 0;
  for (const [end, v] of Object.entries(celulas)) {
    if (v === '' || v == null) continue;
    ws[end] = typeof v === 'number' ? { t: 'n', v } : { t: 's', v };
    const { r, c } = XLSX.utils.decode_cell(end);
    maxR = Math.max(maxR, r);
    maxC = Math.max(maxC, c);
  }
  ws['!ref'] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: maxR, c: maxC } });
  return ws;
}

const JOAO = { 10: ['15:12', '18:26'], 11: ['08:26', '18:22'], 12: ['08:18', '12:16', '13:55', '18:10'], 13: ['08:10', '12:14', '13:30', '18:00'], 16: ['08:08', '12:03', '13:30'] };
const JEAN = { 10: ['15:16', '18:26'], 11: ['07:43', '18:00'], 12: ['08:18', '12:00', '13:30', '18:05'], 13: ['07:56', '12:01', '13:30', '18:00'], 16: ['07:50', '12:04', '13:22'] };

export function planilhaDoRelogio(bookType: 'xlsx' | 'biff8' = 'xlsx', extra: { turnosJoao?: Record<number, string> } = {}): Buffer {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, aba({
    A1: 'Resumo de Atendimento', A2: 'Data:', B2: PERIODO, N2: 'Nota: por favor, preencha a parte de cor laranja manualmente.',
    A3: 'No', B3: 'Nome', C3: 'Dept.', D3: 'Duração do trabalho', F3: 'Atraso', H3: 'Saída precoce', J3: 'Hora extra',
    L3: 'Participar\n(Obrigatório/atual)', M3: 'Viagem de negócios', N3: 'Ausência', O3: 'Deixar', P3: 'Bônus salarial',
    S3: 'Dedução salarial', V3: 'Salário atual', W3: 'Memorando',
    D4: 'Necessário', E4: 'Atual', F4: 'Vezes', G4: 'Min', H4: 'Vezes', I4: 'Min', J4: 'Normal', K4: 'Especial',
    P4: 'nota', Q4: 'Término', R4: 'Toda\nremuneração', S4: 'Tarde/\nM-Cedo', T4: 'Ausência', U4: 'Outras\nDedução',
    A5: '12', B5: 'joao vitor', C5: 'sup', D5: '93.30', E5: '23.05', F5: '3', G5: '145', L5: '11/4', N5: '7',
    A6: '13', B6: 'jean may', C6: 'sup', D6: '93.30', E6: '23.26', F6: '2', G6: '124', L6: '11/4', N6: '7',
  }), 'resumo');

  const turnos: Record<string, string | number> = {
    A1: 'Tabela de turno', A2: 'Data:', B2: PERIODO, R2: 'Especial:25-Deixar,26-Viagem de negócios,espaço,férias',
    A3: 'No', B3: 'Nome', C3: 'Dept.', A5: '12', B5: 'joao vitor', C5: 'sup', A6: '13', B6: 'jean may', C6: 'sup',
  };
  for (let d = 1; d <= DIAS; d++) {
    const c = col(2 + d); // D = dia 1
    turnos[`${c}3`] = d;
    turnos[`${c}4`] = SEMANA[(d - 1) % 7];
    const util = (d - 1) % 7 !== 0 && (d - 1) % 7 !== 6;
    turnos[`${c}5`] = extra.turnosJoao?.[d] ?? (util ? '1' : '');
    turnos[`${c}6`] = util ? '1' : '';
  }
  XLSX.utils.book_append_sheet(wb, aba(turnos), 'Turnos');

  const registros: Record<string, string | number> = {
    A1: 'Lista de registros', A3: 'Período:', C3: PERIODO, AA3: 'Impresso:', AC3: '2026/11/16',
    A5: 'No:', C5: '12', I5: 'Nome:', K5: 'joao vitor', S5: 'Dept:', U5: 'sup',
    A7: 'No:', C7: '13', I7: 'Nome:', K7: 'jean may', S7: 'Dept:', U7: 'sup',
  };
  for (let d = 1; d <= DIAS; d++) {
    registros[`${col(d - 1)}4`] = d;
    const j = (JOAO as Record<number, string[]>)[d];
    const e = (JEAN as Record<number, string[]>)[d];
    if (j) registros[`${col(d - 1)}6`] = j.map((h) => `${h}\n`).join('');
    if (e) registros[`${col(d - 1)}8`] = e.map((h) => `${h}\n`).join('');
  }
  XLSX.utils.book_append_sheet(wb, aba(registros), 'Registros');
  XLSX.utils.book_append_sheet(wb, aba({ A1: 'Overclock Anormal', A2: 'Data:', B2: PERIODO, A5: '12', B5: 'joao vitor', D5: '2026/11/10', G5: '15:12', I5: '102' }), 'Anormal');
  XLSX.utils.book_append_sheet(wb, aba({ A1: 'layout de impressão' }), '12.13');
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
  test(`lê a exportação do relógio no layout real (${bookType === 'biff8' ? '.xls' : '.xlsx'}): Registros, Turnos e resumo`, () => {
    const l = lerPlanilha(planilhaDoRelogio(bookType, { turnosJoao: { 3: '25' } }));
    assert.equal(l.formato, 'relogio');
    assert.deepEqual(l.periodoArquivo, { inicio: '2026-11-01', fim: '2026-11-16' });
    assert.deepEqual(l.nomes, ['joao vitor', 'jean may']);
    assert.equal(l.abas.length, 1);
    assert.equal(l.abas[0].precisaMapeamento, false);
    const joao = l.registros.filter((r) => r.nome === 'joao vitor');
    assert.deepEqual(joao.map((r) => r.data), ['2026-11-10', '2026-11-11', '2026-11-12', '2026-11-13', '2026-11-16']);
    assert.deepEqual(joao[2].horas, ['08:18', '12:16', '13:55', '18:10']);
    assert.deepEqual(joao[4].horas, ['08:08', '12:03', '13:30']);
    assert.equal(l.registros.filter((r) => r.nome === 'jean may').length, 5);
    // Turnos: uma linha por colaborador (coluna "Nome"); dia 3 do João com 25 (licença); fim de semana sem turno.
    assert.equal(l.turnos.length, 32);
    assert.deepEqual(l.turnos.find((t) => t.nome === 'joao vitor' && t.data === '2026-11-03'), { nome: 'joao vitor', data: '2026-11-03', tipo: 'justificada', codigo: '25' });
    assert.equal(l.turnos.find((t) => t.nome === 'jean may' && t.data === '2026-11-03')!.tipo, 'turno');
    assert.equal(l.turnos.find((t) => t.nome === 'jean may' && t.data === '2026-11-14')!.tipo, 'sem_turno');
    assert.equal(l.turnos.find((t) => t.nome === 'joao vitor' && t.data === '2026-11-16')!.tipo, 'turno');
    // resumo: cabeçalho de 2 linhas ("Atraso" sobre "Vezes"/"Min"), só pra conferência.
    assert.equal(l.conferencia.length, 2);
    assert.deepEqual(l.conferencia[0].campos, {
      'Duração do trabalho Necessário': '93.30', 'Duração do trabalho Atual': '23.05', 'Atraso Vezes': '3', 'Atraso Min': '145',
      'Participar (Obrigatório/atual)': '11/4', 'Ausência': '7',
    });
    assert.match(l.observacoes.join(' '), /resumo, Anormal, 12\.13/);
  });
}

test('colaborador sem nenhuma batida no período não "come" o colaborador de baixo', () => {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, aba({
    A3: 'Período:', C3: PERIODO, A4: 1, B4: 2, C4: 3, D4: 4, E4: 5, F4: 6,
    A5: 'No:', C5: '1', I5: 'Nome:', K5: 'sem batida', S5: 'Dept:',
    A7: 'No:', C7: '2', I7: 'Nome:', K7: 'jean may', S7: 'Dept:', B8: '08:00\n12:00\n',
  }), 'Registros');
  const l = lerPlanilha(XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }));
  assert.deepEqual(l.nomes, ['sem batida', 'jean may']);
  assert.deepEqual(l.registros.map((r) => [r.nome, r.data, r.horas.join(' ')]), [['jean may', '2026-11-02', '08:00 12:00']]);
});

test('apelidos "joao vitor" e "jean may" reconhecem João e Jean; Arthur fica de fora', () => {
  const colabs = [
    { id: 'j', nome: 'João', apelidos: ['joao vitor'], ativo: true },
    { id: 'e', nome: 'Jean', apelidos: ['jean may'], ativo: true },
    { id: 'a', nome: 'Arthur', apelidos: [], ativo: true },
  ];
  assert.equal(vincularNome('joao vitor', colabs), 'j');
  assert.equal(vincularNome('jean may', colabs), 'e');
});

test('planilha do relógio -> cálculo: bate com o resultado esperado (seção 5) e avisa as divergências do resumo', () => {
  const l = lerPlanilha(planilhaDoRelogio());
  const calc = (nome: string, ajustes: Map<string, { tipo: any }[]> = new Map()) => {
    const batidas = new Map(l.registros.filter((r) => r.nome === nome).map((r) => [r.data, r.horas]));
    const doColab = l.turnos.filter((t) => t.nome === nome);
    return calcularPeriodo({
      inicio: '2026-11-01', fim: '2026-11-16', cfg: CFG, batidas, feriados: new Map([['2026-11-02', 'Finados'], ['2026-11-15', 'Proclamação da República']]),
      ajustes: ajustes as any, cobertos: new Set(doColab.map((t) => t.data)), hoje: '2026-11-16',
      turnos: new Map<string, TurnoDoDia>(doColab.map((t) => [t.data, { tipo: t.tipo, codigo: t.codigo }])),
    });
  };
  const joao = calc('joao vitor');
  const linha = (d: string) => joao.dias.find((x) => x.data === d)!;
  assert.deepEqual(
    ['10', '11', '12', '13'].map((d) => [formatarMinutos(linha(`2026-11-${d}`).trabalhadoMinutos), formatarMinutos(linha(`2026-11-${d}`).saldoMinutos)]),
    [['3h14', '-5h16'], ['8h26', '0h00'], ['7h57', '-0h33'], ['8h20', '0h00']],
  );
  assert.equal(linha('2026-11-12').atrasoMinutos, 43);
  assert.equal(linha('2026-11-16').status, 'em_andamento');
  assert.equal(formatarMinutos(joao.resumo.bancoMinutos), '-5h49');
  assert.equal(joao.resumo.faltas, 0);
  // Dias 02 a 09 (antes do controle) não viram falta, mesmo o relógio contando "Ausência" (7).
  assert.ok(['2026-11-02', '2026-11-03', '2026-11-04', '2026-11-09'].every((d) => linha(d).status === 'fora_controle'));

  const jean = calc('jean may');
  assert.equal(formatarMinutos(jean.resumo.bancoMinutos), '-5h21');
  assert.equal(formatarMinutos(jean.resumo.extraMinutos), '0h17');

  // Dia 10: bateram certinho (lançado na migração como correção de batidas), o dia fica zerado.
  const abono = new Map([['2026-11-10', [{ tipo: 'corrigir_batidas', batidas: ['08:00', '12:00', '13:30', '18:00'] }]]]);
  const joaoAbonado = calc('joao vitor', abono);
  assert.equal(joaoAbonado.dias.find((d) => d.data === '2026-11-10')!.status, 'normal');
  assert.equal(formatarMinutos(joaoAbonado.resumo.bancoMinutos), '-0h33');
  const jeanAbonado = calc('jean may', abono);
  assert.equal(formatarMinutos(jeanAbonado.resumo.bancoMinutos), '-0h01');

  // Conferência com o resumo real. João: o relógio ignora 11/11 (sem almoço) e 13/11 (tolerância) no atraso (145 x 181),
  // e conta 7 ausências (dias antes do controle e o 16 em andamento).
  const comAtraso = (r: typeof joao) => r.dias.filter((d) => d.atrasoMinutos > 0).length;
  const aj = compararComResumo(l.conferencia[0].campos, joao.resumo, comAtraso(joao));
  assert.equal(aj.length, 4);
  assert.match(aj.join('\n'), /"Duração do trabalho Atual" no relógio = 23\.05 \(23h05\); no nosso cálculo = 27h57/);
  assert.match(aj.join('\n'), /"Atraso Vezes" no relógio = 3; no nosso cálculo = 4 dia\(s\)/);
  assert.match(aj.join('\n'), /"Atraso Min" no relógio = 145; no nosso cálculo = 181 min/);
  assert.match(aj.join('\n'), /"Ausência" no relógio = 7; no nosso cálculo = 0 falta/);
  // Jean: o atraso bate com o relógio (124 min em 2 dias); divergem as horas e as ausências.
  const ae = compararComResumo(l.conferencia[1].campos, jean.resumo, comAtraso(jean));
  assert.equal(ae.length, 2);
  assert.doesNotMatch(ae.join('\n'), /Atraso/);
});
