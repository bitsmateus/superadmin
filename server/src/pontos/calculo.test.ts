import test from 'node:test';
import assert from 'node:assert/strict';
import { calcularDia, calcularPeriodo, resolverViradaDeDia, valorHora, type ConfigColaborador } from './calculo.js';

const CFG: ConfigColaborador = {
  diasSemana: [1, 2, 3, 4, 5], minutosDia: 480, minutosSabado: 240, minutosDomingo: 0,
  entradaPrevista: '08:00', saidaPrevista: '18:00', intervaloMinutos: 120, toleranciaMinutos: 10,
  salarioBaseCentavos: 220000, divisorMensal: 220, valorHoraCentavos: null,
  pctExtraUtil: 50, pctExtraDomingoFeriado: 100, destinoExtra: 'banco',
};
// 2026-11-16 é segunda; 2026-11-14 sábado; 2026-11-15 domingo.
const SEG = '2026-11-16';
const dia = (batidas: string[], extra: Partial<Parameters<typeof calcularDia>[0]> = {}) =>
  calcularDia({ data: SEG, batidas, cfg: CFG, coberto: true, ...extra });

test('valor da hora: salário ÷ divisor, ou o informado direto', () => {
  assert.equal(valorHora(CFG), 1000); // R$ 2.200 / 220 = R$ 10,00
  assert.equal(valorHora({ ...CFG, valorHoraCentavos: 1500 }), 1500);
});

test('dia normal: 08:00-12:00 / 14:00-18:00 = 8h, sem atraso nem extra', () => {
  const d = dia(['08:00', '12:00', '14:00', '18:00']);
  assert.equal(d.trabalhadoMinutos, 480);
  assert.equal(d.atrasoMinutos, 0);
  assert.equal(d.extraMinutos, 0);
  assert.equal(d.saldoMinutos, 0);
  assert.equal(d.status, 'normal');
});

test('tolerância: 10 min de atraso não conta; 11 min conta inteiro', () => {
  assert.equal(dia(['08:10', '12:00', '14:00', '18:00']).atrasoMinutos, 0);
  const d = dia(['08:11', '12:00', '14:00', '18:00']);
  assert.equal(d.atrasoMinutos, 11);
  assert.equal(d.status, 'atraso');
  assert.equal(d.saldoMinutos, -11);
  assert.equal(d.descontoCentavos, Math.round((11 * 1000) / 60)); // 11 min × R$10/h
});

test('saída antecipada: saiu 17:30 (30 min antes)', () => {
  const d = dia(['08:00', '12:00', '14:00', '17:30']);
  assert.equal(d.saidaAntecipadaMinutos, 30);
  assert.equal(d.saldoMinutos, -30);
  assert.equal(d.status, 'atraso');
});

test('hora extra: 1h a mais em dia útil vai pro banco (50% de valor só se for pagamento)', () => {
  const d = dia(['08:00', '12:00', '14:00', '19:00']);
  assert.equal(d.extraMinutos, 60);
  assert.equal(d.status, 'extra');
  assert.equal(d.extraDestino, 'banco');
  assert.equal(d.saldoMinutos, 60);
  assert.equal(d.valorExtraCentavos, 0);
  const pago = calcularDia({ data: SEG, batidas: ['08:00', '12:00', '14:00', '19:00'], cfg: { ...CFG, destinoExtra: 'pagamento' }, coberto: true });
  assert.equal(pago.saldoMinutos, 0);
  assert.equal(pago.valorExtraCentavos, 1500); // 1h × R$10 × 1,5
});

test('hora extra dentro da tolerância não conta', () => {
  assert.equal(dia(['08:00', '12:00', '14:00', '18:08']).extraMinutos, 0);
});

test('domingo e feriado: tudo é extra com 100%', () => {
  const dom = calcularDia({ data: '2026-11-15', batidas: ['09:00', '13:00'], cfg: { ...CFG, destinoExtra: 'pagamento' }, coberto: true });
  assert.equal(dom.previstoMinutos, 0);
  assert.equal(dom.extraMinutos, 240);
  assert.equal(dom.pctExtra, 100);
  assert.equal(dom.valorExtraCentavos, 8000); // 4h × R$10 × 2
  const fer = dia(['08:00', '12:00'], { feriado: 'Natal' });
  assert.equal(fer.previstoMinutos, 0);
  assert.equal(fer.pctExtra, 100);
  assert.equal(dia([], { feriado: 'Natal' }).status, 'feriado');
});

test('sábado com carga diferente (4h) quando trabalha no sábado', () => {
  const cfg = { ...CFG, diasSemana: [1, 2, 3, 4, 5, 6] };
  const d = calcularDia({ data: '2026-11-14', batidas: ['08:00', '12:00'], cfg, coberto: true });
  assert.equal(d.previstoMinutos, 240);
  assert.equal(d.extraMinutos, 0);
  assert.equal(d.saidaAntecipadaMinutos, 0);
});

test('falta: dia previsto, sem batida e coberto pela importação; fora da importação não é falta', () => {
  const f = dia([]);
  assert.equal(f.faltaMinutos, 480);
  assert.equal(f.status, 'falta');
  assert.equal(f.saldoMinutos, -480);
  assert.equal(f.descontoCentavos, 8000); // 8h × R$10
  assert.equal(dia([], { coberto: false }).faltaMinutos, 0);
  assert.equal(dia([], { hoje: '2026-11-10' }).faltaMinutos, 0); // dia futuro
});

test('abono: tira atraso/falta do banco e do desconto', () => {
  const a = dia(['08:40', '12:00', '14:00', '18:00'], { ajustes: [{ tipo: 'abonar_atraso' }] });
  assert.equal(a.atrasoMinutos, 0);
  assert.equal(a.status, 'abonado');
  const f = dia([], { ajustes: [{ tipo: 'abonar_falta' }] });
  assert.equal(f.faltaMinutos, 0);
  assert.equal(f.descontoCentavos, 0);
  assert.equal(f.status, 'abonado');
});

test('perdoar desconto: banco continua negativo, R$ zera', () => {
  const d = dia(['08:30', '12:00', '14:00', '18:00'], { ajustes: [{ tipo: 'perdoar_desconto' }] });
  assert.equal(d.saldoMinutos, -30);
  assert.equal(d.descontoCentavos, 0);
});

test('folga e compensação: folga não deve nada; compensação desconta do banco sem R$', () => {
  const fo = dia([], { ajustes: [{ tipo: 'folga' }] });
  assert.equal(fo.faltaMinutos, 0);
  assert.equal(fo.saldoMinutos, 0);
  assert.equal(fo.status, 'folga');
  const co = dia([], { ajustes: [{ tipo: 'compensacao' }] });
  assert.equal(co.saldoMinutos, -480);
  assert.equal(co.descontoCentavos, 0);
  assert.equal(co.status, 'folga');
});

test('extra por lançamento: converte em pagamento ou em banco', () => {
  const d = dia(['08:00', '12:00', '14:00', '20:00'], { ajustes: [{ tipo: 'extra_pagamento' }] });
  assert.equal(d.extraDestino, 'pagamento');
  assert.equal(d.saldoMinutos, 0);
  assert.equal(d.valorExtraCentavos, 3000); // 2h × R$10 × 1,5
});

test('correção de batida: vale a corrigida, a original fica guardada', () => {
  const d = dia(['08:00', '12:00', '14:00'], { ajustes: [{ tipo: 'corrigir_batidas', batidas: ['08:00', '12:00', '14:00', '18:00'] }] });
  assert.deepEqual(d.batidasOriginais, ['08:00', '12:00', '14:00']);
  assert.deepEqual(d.batidas, ['08:00', '12:00', '14:00', '18:00']);
  assert.equal(d.trabalhadoMinutos, 480);
  assert.equal(d.status, 'normal');
});

test('sem batida de almoço: desconta o intervalo previsto', () => {
  const d = dia(['08:00', '17:00']); // 9h corridas - 2h de almoço = 7h
  assert.equal(d.trabalhadoMinutos, 420);
  assert.equal(d.extraMinutos, 0);
  assert.equal(d.saidaAntecipadaMinutos, 60);
  assert.equal(d.saldoMinutos, -60);
  assert.equal(d.avisos.length, 1);
  // meio período (até 6h) não desconta
  assert.equal(dia(['08:00', '12:00']).trabalhadoMinutos, 240);
});

test('dia sem saída (ímpar): avisa e não conta a batida sobrando', () => {
  const d = dia(['08:00', '12:00', '14:00']);
  assert.equal(d.trabalhadoMinutos, 240);
  assert.equal(d.avisos.length, 1);
});

test('virada de dia: saída 02:10 do dia seguinte fecha o turno do dia anterior', () => {
  const m = resolverViradaDeDia(new Map([['2026-11-16', ['18:00']], ['2026-11-17', ['02:10', '08:00']]]));
  assert.deepEqual(m.get('2026-11-16'), ['18:00', '26:10']);
  assert.deepEqual(m.get('2026-11-17'), ['08:00']);
  const d = calcularDia({ data: SEG, batidas: m.get(SEG)!, cfg: { ...CFG, entradaPrevista: '18:00', saidaPrevista: '02:00', intervaloMinutos: 0 }, coberto: true });
  assert.equal(d.trabalhadoMinutos, 490);
});

test('período: banco de horas = soma dos saldos; resumo soma tudo', () => {
  const batidas = new Map([
    ['2026-11-16', ['08:00', '12:00', '14:00', '19:00']], // +60
    ['2026-11-17', ['08:30', '12:00', '14:00', '18:00']], // -30
  ]);
  const { dias, resumo } = calcularPeriodo({
    inicio: '2026-11-16', fim: '2026-11-18', cfg: CFG, batidas, feriados: new Map(), ajustes: new Map(),
    cobertos: new Set(['2026-11-16', '2026-11-17', '2026-11-18']),
  });
  assert.equal(dias.length, 3);
  assert.equal(dias[2].status, 'falta'); // 18/11 sem batida
  assert.equal(resumo.saldoMinutos, 60 - 30 - 480);
  assert.equal(resumo.extraMinutos, 60);
  assert.equal(resumo.atrasoMinutos, 30);
  assert.equal(resumo.faltas, 1);
});
