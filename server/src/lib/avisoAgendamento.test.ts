import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chaveDoAviso, dataDoAviso, montarAvisoAgendamento, quemAgendouAviso, telefoneDoAviso } from './avisoAgendamento.js';

test('aviso: mensagem completa', () => {
  assert.equal(
    montarAvisoAgendamento({
      nome: 'João Silva', empresa: 'Clínica Sorriso', telefone: '5531981083381',
      numero_atendentes: '4 a 10 atendentes', agendamento: '2026-11-06T14:00', quem: 'SDR Arthur',
    }),
    [
      '✅ *Agendou!*',
      '',
      '👤 *Nome:* João Silva',
      '🏢 *Empresa:* Clínica Sorriso',
      '📞 *Telefone:* +55 (31) 98108-3381',
      '👥 *Qtd. usuários:* 4 a 10 atendentes',
      '📅 *Data:* sexta, 06/11 às 14:00',
      '🙋 *Quem agendou:* SDR Arthur',
    ].join('\n')
  );
});

test('aviso: o que falta vira "Sem informação"', () => {
  const t = montarAvisoAgendamento({ nome: 'Ana', empresa: '', telefone: '', numero_atendentes: '', agendamento: '', quem: 'IA Luiza' });
  assert.match(t, /Empresa:\* Sem informação/);
  assert.match(t, /Telefone:\* Sem informação/);
  assert.match(t, /Qtd\. usuários:\* Sem informação/);
  assert.match(t, /Data:\* Sem informação/);
});

test('aviso: nº de atendentes só com número ganha a palavra', () => {
  assert.match(montarAvisoAgendamento({ nome: 'A', empresa: '', telefone: '', numero_atendentes: '7', agendamento: '', quem: '' }),
    /Qtd\. usuários:\* 7 atendentes/);
  assert.match(montarAvisoAgendamento({ nome: 'A', empresa: '', telefone: '', numero_atendentes: '2 a 3', agendamento: '', quem: '' }),
    /Qtd\. usuários:\* 2 a 3 atendentes/);
});

test('aviso: telefone e data', () => {
  assert.equal(telefoneDoAviso('(31) 98108-3381'), '+55 (31) 98108-3381');
  assert.equal(telefoneDoAviso('+55 11 3333-4444'), '+55 (11) 3333-4444');
  assert.equal(telefoneDoAviso('351912345678'), '+351912345678');
  assert.equal(dataDoAviso('2026-11-09'), 'segunda, 09/11');
});

test('aviso: quem agendou', () => {
  assert.equal(quemAgendouAviso('Arthur Souza', ''), 'SDR Arthur');
  assert.equal(quemAgendouAviso('Luis Henrique', ''), 'SDR Luis');
  assert.equal(quemAgendouAviso('automação', 'IA Luiza'), 'IA Luiza');
  assert.equal(quemAgendouAviso('automação', 'Arthur'), 'Arthur');
});

test('aviso: a mesma lead em qualquer aba tem a mesma chave', () => {
  const original = { id: 'a', telefone: '5531981083381', espelho_origem_id: null, copia_ia_origem_id: null };
  const doCloser = { id: 'b', telefone: '(31) 98108-3381', espelho_origem_id: 'a', copia_ia_origem_id: null };
  assert.equal(chaveDoAviso(original), chaveDoAviso(doCloser));
  assert.equal(chaveDoAviso({ id: 'c', telefone: '', espelho_origem_id: 'a', copia_ia_origem_id: null }), 'a');
});
