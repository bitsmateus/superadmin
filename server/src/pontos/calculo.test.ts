import test from 'node:test';
import assert from 'node:assert/strict';
import {
  calcularDia, calcularPeriodo, datasEntre, resolverViradaDeDia, valorHora, formatarMinutos,
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
  assert.equal(dia(['08:00', '12:00', '13:30', '17:50']).saldoMinutos, 0); // -10
  const mais = dia(['08:00', '12:00', '13:30', '18:15']); // +15 depois das 18:00
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
  const d = calcularDia({ data: '2026-11-12', batidas: ['08:00', '12:00', '13:30', '19:00'], cfg: { ...CFG, destinoExtra: 'pagamento' }, coberto: true });
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
  assert.deepEqual([h(d('11').trabalhadoMinutos), h(d('11').saldoMinutos), d('11').status], ['8h40', '0h10', 'extra']);
  assert.deepEqual([h(d('12').trabalhadoMinutos), h(d('12').saldoMinutos), d('12').atrasoMinutos], ['8h17', '-0h13', 18]);
  assert.deepEqual([h(d('13').trabalhadoMinutos), h(d('13').saldoBrutoMinutos), d('13').saldoMinutos], ['8h34', '0h04', 4]);
  assert.equal(d('16').status, 'em_andamento');
  assert.equal(h(resumo.bancoMinutos), '-5h19');
  assert.equal(resumo.faltas, 0);
  assert.equal(h(resumo.extraMinutos), '0h14');
  assert.equal(h(periodo(JEAN, { '2026-11-10': [{ tipo: 'abonar_manha' }] }).resumo.bancoMinutos), '-1h19');
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

test('Arthur: controle começa em 16/11; dias antes não contam; hoje só com a tarde = manhã sem batida (-4h)', () => {
  const cfg = { ...CFG, inicioControle: '2026-11-16' };
  const antes = calcularDia({ data: '2026-11-10', batidas: [], cfg, coberto: true, hoje: '2026-11-16' });
  assert.equal(antes.status, 'fora_controle');
  // Só a batida de entrada da tarde, ainda sem saída: a manhã já está perdida (-4h); a tarde fecha com a saída.
  const aberto = calcularDia({ data: '2026-11-16', batidas: ['13:30'], cfg, coberto: true, hoje: '2026-11-16', ultimoDiaLido: '2026-11-16' });
  assert.equal(aberto.status, 'manha_sem_batida');
  assert.equal(aberto.saldoMinutos, -240);
  const descontado = calcularDia({ data: '2026-11-16', batidas: ['13:30'], cfg: { ...cfg, salarioBaseCentavos: 190000 }, coberto: true, hoje: '2026-11-16', ajustes: [{ tipo: 'descontar_saldo' }] });
  assert.equal(descontado.bancoMinutos, 0);
  assert.ok(descontado.descontoCentavos > 3400);
  // Fechou 18:00: a manhã inteira fica devendo.
  const fechado = calcularDia({ data: '2026-11-16', batidas: ['13:30', '18:00'], cfg, coberto: true, hoje: '2026-11-17' });
  assert.equal(fechado.status, 'manha_sem_batida');
  assert.equal(fechado.saldoMinutos, -240);
});

test('Arthur dia 16: bateu só 13:30 e saiu 18:00, "descontar saldo": a manhã vira R$ (R$ 1.900), não banco', () => {
  const cfg = { ...CFG, inicioControle: '2026-11-10', salarioBaseCentavos: 190000, divisorMensal: 220, destinoExtra: 'banco' as const };
  const d = calcularDia({ data: '2026-11-16', batidas: ['13:30', '18:00'], cfg, coberto: true, hoje: '2026-11-17', ajustes: [{ tipo: 'descontar_saldo' }] });
  assert.equal(d.saldoMinutos, -240);
  assert.equal(d.bancoMinutos, 0);
  assert.equal(d.descontoCentavos, Math.round((240 * valorHora(cfg)) / 60));
  assert.ok(d.descontoCentavos > 3400 && d.descontoCentavos < 3500);
});

test('hora extra: chegar 10 min antes (07:50) já conta; depois das 18:00 conta tudo', () => {
  const dia = (batidas: string[]) => calcularDia({ data: '2026-11-12', batidas, cfg: CFG, coberto: true, hoje: '2026-11-20' });
  const a = dia(['07:50', '12:00', '13:30', '18:00']);
  assert.equal(a.saldoMinutos, 10);
  assert.equal(a.extraMinutos, 10);
  // Antes das 07:50 não conta: chegou 07:43 ou 07:20, são só 10 min.
  assert.equal(dia(['07:43', '12:00', '13:30', '18:00']).extraMinutos, 10);
  assert.equal(dia(['07:20', '12:00', '13:30', '18:00']).extraMinutos, 10);
  assert.equal(dia(['07:55', '12:00', '13:30', '18:00']).extraMinutos, 5);
  // Depois das 18:00: cada minuto conta.
  assert.equal(dia(['08:00', '12:00', '13:30', '18:03']).extraMinutos, 3);
  // O almoço (12:00 às 13:30) nunca vira extra.
  assert.equal(dia(['08:00', '12:40', '13:00', '18:00']).extraMinutos, 0);
});

test('Arthur dia 16: 13:30 às 17:30, sem manhã: -4h30 (manhã inteira + 30 min da tarde), em R$ com "descontar saldo"', () => {
  const cfg = { ...CFG, inicioControle: '2026-11-10', salarioBaseCentavos: 190000, divisorMensal: 220, destinoExtra: 'banco' as const };
  const d = calcularDia({ data: '2026-11-16', batidas: ['13:30', '17:30'], cfg, coberto: true, hoje: '2026-11-16', ajustes: [{ tipo: 'descontar_saldo' }] });
  assert.equal(d.trabalhadoMinutos, 240);
  assert.equal(d.saldoMinutos, -270);
  assert.equal(d.bancoMinutos, 0);
  assert.equal(d.descontoCentavos, Math.round((270 * valorHora(cfg)) / 60));
});

test('DSR: falta desconta as horas + 1 DSR até 15/12/2026 e + 2 DSR (sáb e dom) a partir de 16/12; 1 vez por semana', () => {
  const cfg = { ...CFG, salarioBaseCentavos: 300000, divisorMensal: 220 };
  const per = (inicio: string, fim: string, batidas: Record<string, string[]> = {}, ajustes: Record<string, AjusteDoDia[]> = {}) => {
    const dias = datasEntre(inicio, fim);
    return calcularPeriodo({
      inicio, fim, cfg, batidas: new Map(Object.entries(batidas)), feriados: new Map(), ajustes: new Map(Object.entries(ajustes)),
      cobertos: new Set(dias), hoje: '2027-01-31',
    });
  };
  const dia = 300000 / 30; // R$ 100,00 por DSR, em centavos
  // Duas faltas na mesma semana (ter 10 e qua 11/11, sem batida): horas das duas + um DSR só.
  const a = per('2026-11-09', '2026-11-15', { '2026-11-09': ['08:00', '12:00', '13:30', '18:00'], '2026-11-12': ['08:00', '12:00', '13:30', '18:00'], '2026-11-13': ['08:00', '12:00', '13:30', '18:00'] });
  assert.equal(a.resumo.faltas, 2);
  assert.equal(a.resumo.dsrSemanas, 1);
  assert.equal(a.resumo.descontoDsrCentavos, Math.round(dia));
  assert.equal(a.resumo.descontoCentavos, a.dias.reduce((t, d) => t + d.descontoCentavos, 0) + Math.round(dia));
  // Meio período (manhã sem batida convertida em R$) também gera DSR.
  const meio = per('2026-11-09', '2026-11-15', {
    '2026-11-09': ['08:00', '12:00', '13:30', '18:00'], '2026-11-10': ['13:30', '18:00'], '2026-11-11': ['08:00', '12:00', '13:30', '18:00'],
    '2026-11-12': ['08:00', '12:00', '13:30', '18:00'], '2026-11-13': ['08:00', '12:00', '13:30', '18:00'],
  }, { '2026-11-10': [{ tipo: 'descontar_saldo' }] });
  assert.equal(meio.resumo.dsrSemanas, 1);
  // Mesmo meio período, mas no banco (sem converter): não desconta em R$, não tem DSR.
  const banco = per('2026-11-09', '2026-11-15', {
    '2026-11-09': ['08:00', '12:00', '13:30', '18:00'], '2026-11-10': ['13:30', '18:00'], '2026-11-11': ['08:00', '12:00', '13:30', '18:00'],
    '2026-11-12': ['08:00', '12:00', '13:30', '18:00'], '2026-11-13': ['08:00', '12:00', '13:30', '18:00'],
  });
  assert.equal(banco.resumo.dsrSemanas, 0);
  assert.equal(banco.resumo.descontoCentavos, 0);
  // Falta perdoada: sem desconto e sem DSR. Falta justificada: idem.
  const perdoada = per('2026-11-09', '2026-11-13', {}, { '2026-11-09': [{ tipo: 'perdoar_desconto' }] });
  assert.equal(perdoada.dias[0].descontoCentavos, 0);
  assert.equal(perdoada.dias[0].dsrCentavos, 0);
  // Nova regra 5x2: falta em 16/12/2026 em diante = horas + 2 DSR.
  const nova = per('2026-12-14', '2026-12-18', {
    '2026-12-14': ['08:00', '12:00', '13:30', '18:00'], '2026-12-15': ['08:00', '12:00', '13:30', '18:00'], '2026-12-17': ['08:00', '12:00', '13:30', '18:00'], '2026-12-18': ['08:00', '12:00', '13:30', '18:00'],
  });
  const faltaDia16 = nova.dias.find((d) => d.data === '2026-12-16')!;
  assert.equal(faltaDia16.dsrDias, 2);
  assert.equal(faltaDia16.dsrCentavos, 2 * Math.round(dia));
  // Até 15/12 é 1 DSR.
  const velha = per('2026-12-07', '2026-12-11', { '2026-12-07': ['08:00', '12:00', '13:30', '18:00'], '2026-12-08': ['08:00', '12:00', '13:30', '18:00'], '2026-12-10': ['08:00', '12:00', '13:30', '18:00'], '2026-12-11': ['08:00', '12:00', '13:30', '18:00'] });
  assert.equal(velha.dias.find((d) => d.data === '2026-12-09')!.dsrDias, 1);
});

test('descontar horas (admin): 1h tirada do banco de horas do dia; a batida original não muda', () => {
  const certinho = ['08:00', '12:00', '13:30', '18:00'];
  const d = dia(certinho, { ajustes: [{ tipo: 'descontar_horas', minutos: 60, destino: 'banco', motivo: 'Saiu no meio do expediente (entrevista)' }] });
  assert.equal(d.saldoMinutos, -60);
  assert.equal(d.bancoMinutos, -60);
  assert.equal(d.descontoCentavos, 0);
  assert.equal(d.trabalhadoMinutos, 510); // as horas batidas seguem iguais
  assert.deepEqual(d.batidasOriginais, certinho);
  assert.ok(d.avisos.some((a) => /Desconto manual de 1h00 do banco de horas: Saiu no meio do expediente/.test(a)));
});

test('descontar horas em R$: soma no desconto da folha e não mexe no banco', () => {
  const d = dia(['08:00', '12:00', '13:30', '18:00'], { ajustes: [{ tipo: 'descontar_horas', minutos: 60, destino: 'dinheiro', motivo: 'Chegou atrasado' }] });
  assert.equal(d.descontoCentavos, 1000); // 1h × R$10
  assert.equal(d.bancoMinutos, 0);
  assert.equal(d.saldoMinutos, 0);
});

test('descontar horas: sem destino vale o SALÁRIO (R$); "banco" tira do banco; dois lançamentos no mesmo dia somam', () => {
  const d = dia(['08:00', '12:00', '13:30', '18:00'], {
    ajustes: [{ tipo: 'descontar_horas', minutos: 60, motivo: 'Ficou 1 hora fora' }, { tipo: 'descontar_horas', minutos: 60, destino: 'banco', motivo: 'Atraso' }],
  });
  assert.equal(d.descontoCentavos, 1000); // a 1ª (sem destino) vira R$: 1h × R$10
  assert.equal(d.bancoMinutos, -60); // a 2ª, do banco
  assert.equal(d.saldoMinutos, -60);
});

test('descontar horas vale em cima do que o dia já tem (atraso) e some antes do início do controle', () => {
  const atrasado = dia(['08:40', '12:00', '13:30', '18:00'], { ajustes: [{ tipo: 'descontar_horas', minutos: 30, destino: 'banco' }] });
  assert.equal(atrasado.saldoMinutos, -40 - 30);
  const antes = calcularDia({ data: '2026-11-05', batidas: [], cfg: CFG, coberto: true, ultimoDiaLido: SEG, hoje: '2026-11-20', ajustes: [{ tipo: 'descontar_horas', minutos: 60 }] });
  assert.equal(antes.status, 'fora_controle');
  assert.equal(antes.bancoMinutos, 0);
});

test('atestado abona a falta: dia justificado, sem desconto em R$ e sem banco negativo', () => {
  const d = dia([], { ajustes: [{ tipo: 'atestado' }] });
  assert.equal(d.status, 'justificada');
  assert.equal(d.justificativa, 'Atestado');
  assert.equal(d.descontoCentavos, 0);
  assert.equal(d.bancoMinutos, 0);
  assert.equal(d.faltaMinutos, 0);
});

test('o resumo do período soma os descontos manuais (banco e R$) e o atestado não conta como falta', () => {
  const ajustes = new Map<string, AjusteDoDia[]>([
    ['2026-11-12', [{ tipo: 'descontar_horas', minutos: 60, destino: 'banco' }]],
    ['2026-11-13', [{ tipo: 'descontar_horas', minutos: 60, destino: 'dinheiro' }]],
    ['2026-11-16', [{ tipo: 'atestado' }]],
  ]);
  const batidas = new Map<string, string[]>([['2026-11-12', ['08:00', '12:00', '13:30', '18:00']], ['2026-11-13', ['08:00', '12:00', '13:30', '18:00']]]);
  const r = calcularPeriodo({ inicio: '2026-11-12', fim: '2026-11-16', cfg: CFG, batidas, feriados: new Map(), ajustes, cobertos: new Set(datasEntre('2026-11-12', '2026-11-16')), hoje: '2026-11-20' });
  assert.equal(r.resumo.saldoMinutos, -60);
  assert.equal(r.resumo.descontoCentavos, 1000);
  assert.equal(r.resumo.faltas, 0);
  assert.equal(r.resumo.justificadas, 1);
});

test('atestado de algumas horas (ex.: 1h no dentista): saiu 1h mais cedo, o saldo negativo é abonado e não desconta nada', () => {
  const saiuCedo = ['08:00', '12:00', '13:30', '17:00'];
  const sem = dia(saiuCedo);
  assert.equal(sem.saldoMinutos, -60);
  assert.equal(sem.bancoMinutos, -60);
  const com = dia(saiuCedo, { ajustes: [{ tipo: 'atestado', minutos: 60, motivo: 'Dentista' }] });
  assert.equal(com.saldoMinutos, 0);
  assert.equal(com.bancoMinutos, 0);
  assert.equal(com.descontoCentavos, 0);
  assert.equal(com.status, 'abonado');
  assert.ok(com.avisos.some((a) => /Atestado de 1h00: abonado/.test(a)));
});

test('atestado de 2h cobre só o que faltou: saiu 1h mais cedo com atestado de 2h abona 1h; atestado de 30 min abona só 30', () => {
  const saiuCedo = ['08:00', '12:00', '13:30', '17:00'];
  assert.equal(dia(saiuCedo, { ajustes: [{ tipo: 'atestado', minutos: 120 }] }).saldoMinutos, 0);
  const parcial = dia(saiuCedo, { ajustes: [{ tipo: 'atestado', minutos: 30 }] });
  assert.equal(parcial.saldoMinutos, -30);
  assert.equal(parcial.bancoMinutos, -30);
  assert.equal(parcial.status, 'atraso');
  // dia sem saldo negativo: o atestado de horas não muda nada
  const certo = dia(['08:00', '12:00', '13:30', '18:00'], { ajustes: [{ tipo: 'atestado', minutos: 60 }] });
  assert.equal(certo.saldoMinutos, 0);
  assert.equal(certo.status, 'normal');
});

test('atestado de horas tira também o desconto em R$ quando o saldo negativo já tinha virado desconto', () => {
  const d = dia(['08:00', '12:00', '13:30', '17:00'], { ajustes: [{ tipo: 'descontar_saldo' }, { tipo: 'atestado', minutos: 60 }] });
  assert.equal(d.descontoCentavos, 0);
  assert.equal(d.saldoMinutos, 0);
});

test('atestado SEM horas é o dia inteiro; COM horas não vira dia justificado', () => {
  assert.equal(dia([], { ajustes: [{ tipo: 'atestado' }] }).status, 'justificada');
  assert.equal(dia([], { ajustes: [{ tipo: 'atestado', minutos: 120 }] }).status, 'falta');
});

test('esqueceu de bater a saída do almoço (09:48, 13:30, 18:08): conta só até 12:00 e de 13:30 em diante', () => {
  const d = dia(['09:48', '13:30', '18:08']);
  assert.notEqual(d.status, 'incompleto');
  assert.deepEqual(d.batidas, ['09:48', '12:00', '13:30', '18:08']);
  assert.deepEqual(d.batidasOriginais, ['09:48', '13:30', '18:08']);
  assert.equal(d.trabalhadoMinutos, (12 * 60 - (9 * 60 + 48)) + (18 * 60 + 8 - (13 * 60 + 30))); // 2h12 + 4h38
  assert.ok(d.avisos.some((a) => /saída pro almoço: considerada 12:00/.test(a)));
});

test('esqueceu de bater a volta do almoço (08:00, 12:00, 18:00): conta até 12:00 e de 13:30 em diante, o almoço não soma', () => {
  const d = dia(['08:00', '12:00', '18:00']);
  assert.deepEqual(d.batidas, ['08:00', '12:00', '13:30', '18:00']);
  assert.equal(d.trabalhadoMinutos, 510);
  assert.equal(d.saldoMinutos, 0);
  assert.ok(d.avisos.some((a) => /volta do almoço: considerada 13:30/.test(a)));
});

test('a regra do almoço não mexe no dia em andamento (hoje / último dia lido) nem em batida ímpar que não é de almoço', () => {
  assert.equal(dia(['08:00', '12:00', '13:30'], { hoje: '2026-11-12' }).status, 'em_andamento');
  assert.equal(dia(['08:00', '12:00', '13:30'], { data: SEG, hoje: '2026-11-20' }).status, 'em_andamento'); // último dia lido
  assert.equal(dia(['08:00', '10:00', '18:00']).status, 'incompleto'); // 10:00 não é de almoço
  assert.equal(dia(['08:00', '12:00', '13:30']).status, 'incompleto'); // dia fechado, mas a última batida é a volta: falta a saída
});
