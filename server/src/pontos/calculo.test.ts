import test from 'node:test';
import assert from 'node:assert/strict';
import {
  calcularDia, calcularPeriodo, resolverViradaDeDia, valorHora, formatarMinutos,
  type AjusteDoDia, type ConfigColaborador, type TurnoDoDia,
} from './calculo.js';

// Horário da casa: 08:00-12:00 e 13:30-18:00 (8h30), tolerância de 10 min sobre o saldo do dia.
const CFG: ConfigColaborador = {
  diasSemana: [1, 2, 3, 4, 5], minutosDia: 510, minutosSabado: 240, minutosDomingo: 0,
  entradaPrevista: '08:00', saidaPrevista: '18:00', intervaloMinutos: 90, intervaloInicio: '12:00', toleranciaMinutos: 10,
  salarioBaseCentavos: 220000, divisorMensal: 220, valorHoraCentavos: null,
  pctExtraUtil: 50, pctExtraDomingoFeriado: 100, destinoExtra: 'banco', inicioControle: '2026-11-10',
};
// 2026-11-16 é segunda; 14 sábado; 15 domingo (e feriado).
const SEG = '2026-11-16';
const dia = (batidas: string[], extra: Partial<Parameters<typeof calcularDia>[0]> = {}) =>
  calcularDia({ data: '2026-11-12', batidas, cfg: CFG, coberto: true, ultimoDiaLido: SEG, hoje: '2026-11-20', ...extra });

test('valor da hora: salário ÷ divisor, ou o informado direto', () => {
  assert.equal(valorHora(CFG), 1000); // R$ 2.200 / 220 = R$ 10,00
  assert.equal(valorHora({ ...CFG, valorHoraCentavos: 1500 }), 1500);
});

test('dia certinho 08:00-12:00 / 13:30-18:00 = 8h30, saldo 0', () => {
  const d = dia(['08:00', '12:00', '13:30', '18:00']);
  assert.equal(d.trabalhadoMinutos, 510);
  assert.equal(d.saldoMinutos, 0);
  assert.equal(d.atrasoMinutos, 0);
  assert.equal(d.status, 'normal');
});

test('tolerância sobre o SALDO do dia: até 10 min vale 0, passou conta inteiro (pros dois lados)', () => {
  assert.equal(dia(['08:10', '12:00', '13:30', '18:00']).saldoMinutos, 0); // -10
  const menos = dia(['08:11', '12:00', '13:30', '18:00']); // -11
  assert.equal(menos.saldoMinutos, -11);
  assert.equal(menos.bancoMinutos, -11);
  assert.equal(menos.status, 'atraso');
  assert.equal(dia(['07:52', '12:00', '13:30', '18:00']).saldoMinutos, 0); // +8
  const mais = dia(['07:45', '12:00', '13:30', '18:00']); // +15
  assert.equal(mais.saldoMinutos, 15);
  assert.equal(mais.extraMinutos, 15);
  assert.equal(mais.status, 'extra');
});

test('atraso bruto é só informação: não entra de novo no banco nem em R$', () => {
  // Chegou 08:30 e saiu 18:30: atraso bruto 30, saldo 0.
  const d = dia(['08:30', '12:00', '13:30', '18:30']);
  assert.equal(d.atrasoMinutos, 30);
  assert.equal(d.saldoMinutos, 0);
  assert.equal(d.bancoMinutos, 0);
  assert.equal(d.descontoCentavos, 0);
});

test('2 batidas sem almoço e mais de 6h: desconta 1h30', () => {
  const d = dia(['08:00', '18:00']);
  assert.equal(d.trabalhadoMinutos, 510);
  assert.equal(d.saldoMinutos, 0);
  assert.equal(d.avisos.length, 1);
});

test('2 batidas da tarde: manhã sem batida (saldo negativo, abonável)', () => {
  const d = dia(['13:30', '18:00']);
  assert.equal(d.status, 'manha_sem_batida');
  assert.equal(d.saldoMinutos, -240);
  assert.equal(d.faltaMinutos, 0);
  assert.equal(d.descontoCentavos, 0); // vai pro banco, não pra R$
  const ab = dia(['13:30', '18:00'], { ajustes: [{ tipo: 'abonar_manha' }] });
  assert.equal(ab.saldoMinutos, 0);
  assert.equal(ab.status, 'abonado');
});

test('foi embora no almoço: tarde sem batida, "abonar tarde" devolve a tarde', () => {
  const d = dia(['08:00', '12:00']);
  assert.equal(d.status, 'tarde_sem_batida');
  assert.equal(d.saldoMinutos, -270);
  assert.equal(dia(['08:00', '12:00'], { ajustes: [{ tipo: 'abonar_tarde' }] }).saldoMinutos, 0);
});

test('falta: dia útil sem batida, coberto, dentro do controle: desconta em R$ e não no banco', () => {
  const f = dia([]);
  assert.equal(f.status, 'falta');
  assert.equal(f.faltaMinutos, 510);
  assert.equal(f.bancoMinutos, 0);
  assert.equal(f.descontoCentavos, 8500); // 8h30 × R$10
  const perdoada = dia([], { ajustes: [{ tipo: 'perdoar_desconto' }] });
  assert.equal(perdoada.descontoCentavos, 0);
  assert.equal(perdoada.bancoMinutos, -510); // não desconta em R$: vai pro banco
  const abonada = dia([], { ajustes: [{ tipo: 'abonar_falta' }] });
  assert.equal(abonada.status, 'abonado');
  assert.equal(abonada.descontoCentavos, 0);
  assert.equal(abonada.bancoMinutos, 0);
  assert.equal(dia([], { coberto: false }).status, 'sem_registro'); // arquivo não trouxe esse colaborador/dia
  assert.equal(dia([], { hoje: '2026-11-12' }).status, 'sem_registro'); // hoje ainda não é falta
});

test('antes do início do controle: nada conta, nem com batida', () => {
  const d = dia([], { data: '2026-11-09' });
  assert.equal(d.status, 'fora_controle');
  assert.equal(d.previstoMinutos, 0);
  assert.equal(d.faltaMinutos, 0);
  const comBatida = dia(['13:00', '18:00'], { data: '2026-11-05' });
  assert.equal(comBatida.status, 'fora_controle');
  assert.equal(comBatida.saldoMinutos, 0);
});

test('fim de semana, feriado e dia sem turno: sem previsto nem falta; batida só avisa', () => {
  assert.equal(dia([], { data: '2026-11-14' }).status, 'folga');
  const sab = dia(['08:00', '12:00'], { data: '2026-11-14' });
  assert.equal(sab.previstoMinutos, 0);
  assert.equal(sab.saldoMinutos, 0);
  assert.equal(sab.extraMinutos, 0);
  assert.match(sab.avisos.join(' '), /fim de semana/);
  const fer = dia(['08:00', '12:00'], { feriado: 'Dia X' });
  assert.equal(fer.status, 'feriado');
  assert.equal(fer.saldoMinutos, 0);
  assert.equal(dia([], { feriado: 'Dia X' }).faltaMinutos, 0);
  const semTurno: TurnoDoDia = { tipo: 'sem_turno' };
  assert.equal(dia([], { turno: semTurno }).status, 'folga');
});

test('converter em hora extra num dia sem jornada: tudo o que trabalhou (domingo/feriado a 100%)', () => {
  const dom = dia(['09:00', '13:00'], { data: '2026-11-15', ajustes: [{ tipo: 'extra_pagamento' }] });
  assert.equal(dom.extraMinutos, 240);
  assert.equal(dom.pctExtra, 100);
  assert.equal(dom.valorExtraCentavos, 8000); // 4h × R$10 × 2
  assert.equal(dom.bancoMinutos, 0);
  const sab = dia(['08:00', '12:00'], { data: '2026-11-14', ajustes: [{ tipo: 'extra_banco' }] });
  assert.equal(sab.bancoMinutos, 240);
});

test('hora extra pra pagamento não entra no banco', () => {
  const d = calcularDia({ data: '2026-11-12', batidas: ['07:00', '12:00', '13:30', '18:00'], cfg: { ...CFG, destinoExtra: 'pagamento' }, coberto: true });
  assert.equal(d.extraMinutos, 60);
  assert.equal(d.bancoMinutos, 0);
  assert.equal(d.valorExtraCentavos, 1500); // 1h × R$10 × 1,5
});

test('ausência justificada (código da aba Turnos ou lançamento): categoria separada, sem desconto', () => {
  const lic = dia([], { turno: { tipo: 'justificada', codigo: '25' } });
  assert.equal(lic.status, 'justificada');
  assert.equal(lic.justificativa, 'Licença');
  assert.equal(lic.faltaMinutos, 0);
  assert.equal(lic.descontoCentavos, 0);
  assert.equal(dia([], { turno: { tipo: 'justificada', codigo: '26' } }).justificativa, 'Viagem');
  assert.equal(dia([], { turno: { tipo: 'justificada', codigo: 'férias' } }).justificativa, 'Férias');
  assert.equal(dia([], { ajustes: [{ tipo: 'justificar' }] }).status, 'justificada');
});

test('batida ímpar no último dia lido: em andamento (sem falta, atraso nem extra); em outro dia: incompleto', () => {
  const d = dia(['08:08', '12:03', '13:30'], { data: SEG });
  assert.equal(d.status, 'em_andamento');
  assert.equal(d.saldoMinutos, 0);
  assert.equal(d.atrasoMinutos, 0);
  assert.equal(d.faltaMinutos, 0);
  const inc = dia(['08:00', '12:00', '13:30']);
  assert.equal(inc.status, 'incompleto');
  assert.equal(inc.saldoMinutos, 0);
});

test('compensação: dia de folga pago com o banco, sem R$', () => {
  const c = dia([], { ajustes: [{ tipo: 'compensacao' }] });
  assert.equal(c.bancoMinutos, -510);
  assert.equal(c.descontoCentavos, 0);
  assert.equal(c.status, 'folga');
});

test('converter saldo negativo em desconto (fechamento): sai do banco e vira R$', () => {
  const d = dia(['08:30', '12:00', '13:30', '18:00'], { ajustes: [{ tipo: 'descontar_saldo' }] });
  assert.equal(d.saldoMinutos, -30);
  assert.equal(d.bancoMinutos, 0);
  assert.equal(d.descontoCentavos, 500);
});

test('correção de batida: vale a corrigida, a original fica guardada', () => {
  const d = dia(['08:00', '12:00', '13:30'], { ajustes: [{ tipo: 'corrigir_batidas', batidas: ['08:00', '12:00', '13:30', '18:00'] }] });
  assert.deepEqual(d.batidasOriginais, ['08:00', '12:00', '13:30']);
  assert.equal(d.trabalhadoMinutos, 510);
  assert.equal(d.status, 'normal');
});

test('virada de dia: saída 02:10 do dia seguinte fecha o turno do dia anterior', () => {
  const m = resolverViradaDeDia(new Map([['2026-11-16', ['18:00']], ['2026-11-17', ['02:10', '08:00']]]));
  assert.deepEqual(m.get('2026-11-16'), ['18:00', '26:10']);
  assert.deepEqual(m.get('2026-11-17'), ['08:00']);
});

// ── Resultado esperado (seção 5 do pedido): controle desde 10/11, dias fechados 10 a 13, 16 em andamento ──
function periodo(batidas: Record<string, string[]>, ajustes: Record<string, AjusteDoDia[]> = {}) {
  return calcularPeriodo({
    inicio: '2026-11-01', fim: '2026-11-16', cfg: CFG,
    batidas: new Map(Object.entries(batidas)),
    feriados: new Map([['2026-11-02', 'Finados'], ['2026-11-15', 'Proclamação da República']]),
    ajustes: new Map(Object.entries(ajustes)),
    cobertos: new Set(Array.from({ length: 16 }, (_, i) => `2026-11-${String(i + 1).padStart(2, '0')}`)),
    hoje: '2026-11-16',
  });
}
const JOAO = {
  '2026-11-10': ['15:12', '18:26'],
  '2026-11-11': ['08:26', '18:22'],
  '2026-11-12': ['08:18', '12:16', '13:55', '18:10'],
  '2026-11-13': ['08:10', '12:14', '13:30', '18:00'],
  '2026-11-16': ['08:08', '12:03', '13:30'],
};
const JEAN = {
  '2026-11-10': ['15:16', '18:26'],
  '2026-11-11': ['07:43', '18:00'],
  '2026-11-12': ['08:18', '12:00', '13:30', '18:05'],
  '2026-11-13': ['07:56', '12:01', '13:30', '18:00'],
  '2026-11-16': ['07:50', '12:04', '13:22'],
};
const h = formatarMinutos;

test('seção 5 — João (joao vitor)', () => {
  const { dias, resumo } = periodo(JOAO);
  const d = (dd: string) => dias.find((x) => x.data === `2026-11-${dd}`)!;
  assert.deepEqual([h(d('10').trabalhadoMinutos), h(d('10').saldoMinutos), d('10').status], ['3h14', '-5h16', 'manha_sem_batida']);
  assert.deepEqual([h(d('11').trabalhadoMinutos), h(d('11').saldoBrutoMinutos), d('11').saldoMinutos], ['8h26', '-0h04', 0]);
  assert.deepEqual([h(d('12').trabalhadoMinutos), h(d('12').saldoMinutos), d('12').atrasoMinutos], ['7h57', '-0h33', 43]);
  assert.deepEqual([h(d('13').trabalhadoMinutos), h(d('13').saldoBrutoMinutos), d('13').saldoMinutos], ['8h20', '-0h10', 0]);
  assert.equal(d('16').status, 'em_andamento');
  for (const x of ['01', '03', '04', '05', '06', '09']) assert.equal(d(x).status, 'fora_controle', x);
  assert.equal(d('14').status, 'folga');
  assert.equal(d('15').status, 'feriado');
  assert.equal(h(resumo.bancoMinutos), '-5h49');
  assert.equal(resumo.faltas, 0);
  assert.equal(resumo.extraMinutos, 0);
  // Com a manhã de 10/11 abonada: -1h49. Com manhã e tarde (dia de teste do relógio): -0h33.
  assert.equal(h(periodo(JOAO, { '2026-11-10': [{ tipo: 'abonar_manha' }] }).resumo.bancoMinutos), '-1h49');
  assert.equal(h(periodo(JOAO, { '2026-11-10': [{ tipo: 'abonar_manha' }, { tipo: 'abonar_tarde' }] }).resumo.bancoMinutos), '-0h33');
});

test('seção 5 — Jean (jean may)', () => {
  const { dias, resumo } = periodo(JEAN);
  const d = (dd: string) => dias.find((x) => x.data === `2026-11-${dd}`)!;
  assert.deepEqual([h(d('10').trabalhadoMinutos), h(d('10').saldoMinutos), d('10').status], ['3h10', '-5h20', 'manha_sem_batida']);
  assert.deepEqual([h(d('11').trabalhadoMinutos), h(d('11').saldoMinutos), d('11').status], ['8h47', '0h17', 'extra']);
  assert.deepEqual([h(d('12').trabalhadoMinutos), h(d('12').saldoMinutos), d('12').atrasoMinutos], ['8h17', '-0h18', 18]);
  assert.deepEqual([h(d('13').trabalhadoMinutos), h(d('13').saldoBrutoMinutos), d('13').saldoMinutos], ['8h34', '0h04', 0]);
  assert.equal(d('16').status, 'em_andamento');
  assert.equal(h(resumo.bancoMinutos), '-5h21');
  assert.equal(resumo.faltas, 0);
  assert.equal(h(resumo.extraMinutos), '0h17');
  assert.equal(h(periodo(JEAN, { '2026-11-10': [{ tipo: 'abonar_manha' }] }).resumo.bancoMinutos), '-1h21');
});

test('Arthur fora do arquivo: nenhum dia coberto, nenhuma falta', () => {
  const { resumo, dias } = calcularPeriodo({
    inicio: '2026-11-01', fim: '2026-11-16', cfg: { ...CFG, inicioControle: null }, batidas: new Map(),
    feriados: new Map(), ajustes: new Map(), cobertos: new Set(), hoje: '2026-11-16',
  });
  assert.equal(resumo.faltas, 0);
  assert.ok(dias.every((d) => d.status === 'sem_registro' || d.status === 'folga'));
});

test('almoço (12:00 às 13:30) não vira hora extra nem acumulado; tolerância de 10 min na manhã e outra na tarde', () => {
  const dia = (batidas: string[]) => calcularDia({ data: '2026-11-12', batidas, cfg: CFG, coberto: true, hoje: '2026-11-20' });
  // Saiu 12:16 e voltou 13:22: os 16 min e os 8 min caem no almoço, não contam.
  const a = dia(['08:00', '12:16', '13:22', '18:00']);
  assert.equal(a.trabalhadoMinutos, 510);
  assert.equal(a.saldoMinutos, 0);
  assert.equal(a.extraMinutos, 0);
  // Sem batida de almoço: o almoço inteiro sai.
  assert.equal(dia(['08:00', '18:00']).trabalhadoMinutos, 510);
  // 08:10 de manhã e 13:40 à tarde: uma tolerância em cada período, nada desconta.
  const b = dia(['08:10', '12:00', '13:40', '18:00']);
  assert.equal(b.trabalhadoMinutos, 490);
  assert.equal(b.saldoMinutos, 0);
  // 08:11 já passa da tolerância da manhã.
  assert.equal(dia(['08:11', '12:00', '13:30', '18:00']).saldoMinutos, -11);
  // Saída 17:50 ainda é tolerância; 17:49 desconta.
  assert.equal(dia(['08:00', '12:00', '13:30', '17:50']).saldoMinutos, 0);
  assert.equal(dia(['08:00', '12:00', '13:30', '17:49']).saldoMinutos, -11);
});
