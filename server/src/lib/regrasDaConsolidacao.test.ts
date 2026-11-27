import test from 'node:test';
import assert from 'node:assert/strict';
import { comissoesDaVenda, espelhoQuando, etapaDoCloser, nomeSuspenso, paginaDoCloserQuando } from './regrasDaConsolidacao.js';
import { juntarRotinas, type BlocoModelo } from './rotina.js';

test('antes da consolidação nada muda; depois o closer é o CRM unificado, que não copia pra si mesmo', () => {
  assert.equal(paginaDoCloserQuando(false), 'crm-luis-closer');
  assert.equal(paginaDoCloserQuando(true), 'crm-arthur');
  assert.deepEqual(espelhoQuando(false), { origens: ['crm-arthur', 'crm-ia-luiza', 'crm-outbound'], destino: 'crm-luis-closer' });
  assert.deepEqual(espelhoQuando(true), { origens: ['crm-ia-luiza', 'crm-outbound'], destino: 'crm-arthur' });
});

test('SDR Arthur fechado pelo Luis: Fechamento closer pro Luis e nada de comissão de SDR', () => {
  const base = { sdr: 'Arthur', temCopiaNoCloser: false, consolidado: true, pagina: 'crm-arthur' };
  assert.deepEqual(comissoesDaVenda(base), { closerLuis: true, sdr: false });
  assert.deepEqual(comissoesDaVenda({ ...base, consolidado: false, temCopiaNoCloser: true }), { closerLuis: true, sdr: false });
  assert.deepEqual(comissoesDaVenda({ ...base, sdr: 'Luis' }), { closerLuis: false, sdr: true });
  assert.deepEqual(comissoesDaVenda({ ...base, sdr: 'IA Luiza', temCopiaNoCloser: true, pagina: 'crm-ia-luiza' }), { closerLuis: true, sdr: true });
  assert.deepEqual(comissoesDaVenda({ ...base, consolidado: false }), { closerLuis: false, sdr: true });
});

test('suspenso pelo primeiro nome; com um homônimo ativo, não', () => {
  const perfis = [{ name: 'Arthur Faveri', suspensa: true }, { name: 'Luis Otavio', suspensa: false }];
  assert.equal(nomeSuspenso('Arthur', perfis), true);
  assert.equal(nomeSuspenso('Luis', perfis), false);
  assert.equal(nomeSuspenso('', perfis), false);
  assert.equal(nomeSuspenso('Arthur', [...perfis, { name: 'Arthur Novo', suspensa: false }]), false);
});

test('rotina junta: base do closer, entra o que é só do SDR, sem item repetido entre as duas', () => {
  const b = (inicio: string, titulo: string, itens: string[]): BlocoModelo => ({ inicio, fim: '18:00', titulo, itens, tipo: 'tarefa' });
  const closer = [b('08:00', 'Início do dia', ['Organizar o CRM.', 'Enviar confirmações.']), b('09:00', 'Reunião', ['Sem reunião: propostas.']), b('10:00', 'Reunião', ['Sem reunião: propostas.'])];
  const sdr = [b('08:00', 'Início do dia', ['organizar o crm', 'Cadastrar leads.']), b('08:40', 'Envio do D1 ao D7', []), b('11:30', 'Só repetido', ['Enviar confirmações'])];
  const junta = juntarRotinas(sdr, closer);
  assert.deepEqual(junta.map((x) => `${x.inicio} ${x.titulo}: ${x.itens.join(' / ')}`), [
    '08:00 Início do dia: Organizar o CRM. / Enviar confirmações. / Cadastrar leads.',
    '08:40 Envio do D1 ao D7: ',
    '09:00 Reunião: Sem reunião: propostas.',
    '10:00 Reunião: Sem reunião: propostas.',
  ]);
});

test('etapas do closer: reunião em diante; começo do funil não', () => {
  for (const e of ['Reunião agendada', 'REUNIÃO NÃO COMPARECIDA', 'Proposta enviada', 'Follow up Propostas', 'Followup Propostas', 'Vendido']) assert.equal(etapaDoCloser(e), true, e);
  for (const e of ['Leads Novos', 'Primeiro contato', 'Disparo em massa', 'Qualificado', 'Desqualificado', '']) assert.equal(etapaDoCloser(e), false, e);
});
