import test from 'node:test';
import assert from 'node:assert/strict';
import { canalDoAgendamento, montarResumoAgendamentos, quemAgendou } from './resumoAgendamentos.js';

test('quemAgendou: conta pro SDR da lead, não pra quem clicou', () => {
  assert.equal(quemAgendou({ autor: 'Arthur Faveri', sdr: 'IA Luiza', canal: '' }), 'IA Luiza');
  assert.equal(quemAgendou({ autor: 'Arthur Faveri', sdr: 'Arthur', canal: '' }), 'SDR Arthur');
  assert.equal(quemAgendou({ autor: 'Luis otavio', sdr: 'Luis', canal: '' }), 'SDR Luis');
  // closer (Luis) movendo lead do Arthur pro CRM dele: continua do Arthur
  assert.equal(quemAgendou({ autor: 'Luis otavio', sdr: 'Arthur', canal: '' }), 'SDR Arthur');
  // sem SDR: vale quem mudou o status
  assert.equal(quemAgendou({ autor: 'Ian Silvano', sdr: '', canal: '' }), 'Ian');
  assert.equal(quemAgendou({ autor: '', sdr: '', canal: '' }), 'Não informado');
});

test('canalDoAgendamento: Outro com texto e vazio', () => {
  assert.equal(canalDoAgendamento('Outro: indicação de cliente'), 'Outro (indicação de cliente)');
  assert.equal(canalDoAgendamento(''), 'Não informado');
  assert.equal(canalDoAgendamento('Ligação'), 'Ligação');
});

test('montarResumoAgendamentos: listas somam o total e só mostram quem agendou', () => {
  const ag = [
    { autor: 'Arthur Faveri', sdr: 'Arthur', canal: 'WhatsApp Comercial' },
    { autor: 'Arthur Faveri', sdr: 'Arthur', canal: 'WhatsApp Comercial' },
    { autor: 'Arthur Faveri', sdr: 'Arthur', canal: 'Ligação' },
    { autor: 'Arthur Faveri', sdr: 'IA Luiza', canal: 'WhatsApp Business SDR' },
    { autor: 'Arthur Faveri', sdr: 'IA Luiza', canal: '' },
  ];
  const txt = montarResumoAgendamentos('2026-10-20', ag);
  assert.match(txt, /20\/10 \(terça\)/);
  assert.match(txt, /Total de A\.G:\* 5/);
  assert.match(txt, /• SDR Arthur: 3\n• IA Luiza: 2/);
  assert.ok(!/SDR Luis/.test(txt));
  assert.match(txt, /• WhatsApp Comercial: 2\n• Ligação: 1\n• WhatsApp Business SDR: 1\n• Não informado: 1$/);
});

test('montarResumoAgendamentos: dia sem agendamento', () => {
  assert.match(montarResumoAgendamentos('2026-10-25', []), /Total de A\.G:\* 0\nNenhum agendamento hoje\./);
});
