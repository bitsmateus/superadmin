import test from 'node:test';
import assert from 'node:assert/strict';
import { chaveDoQuadro, montarPlano, primeiroNomeDoLead, type Entrada, type Lead } from './consolidacaoCrm.js';

const abas = [
  { id: 'crm-arthur', name: 'CRM ARTHUR', arquivada: false },
  { id: 'crm-luis', name: 'CRM LUIS', arquivada: false },
  { id: 'crm-luis-closer', name: 'CRM LUIS CLOSER', arquivada: false },
  { id: 'crm-ia-luiza', name: 'CRM IA LUIZA', arquivada: false },
];
const q = (id: string, page: string, name: string, position = 0) => ({ id, page, name, position });
const quadros = [
  q('a-novos', 'crm-arthur', 'Leads Novos', 0), q('a-agendada', 'crm-arthur', 'Reunião agendada', 1), q('a-follow', 'crm-arthur', 'Follow up Propostas', 2),
  q('l-novos', 'crm-luis', 'LEADS NOVOS', 0), q('l-agendada', 'crm-luis', 'REUNIÃO AGENDADA', 1),
  q('c-agendada', 'crm-luis-closer', 'REUNIÃO AGENDADA', 0), q('c-follow', 'crm-luis-closer', 'FOLLOW UP PROPOSTAS (APÓS 3 TENTATIVAS)', 1),
  q('i-agendada', 'crm-ia-luiza', 'Reunião agendada', 0),
];
const lead = (id: string, board_id: string, extra: Record<string, unknown> = {}): Lead => ({
  id, board_id, deleted_at: null, movido_em: '2026-11-01T10:00:00Z', vinculos: {}, nome: id, telefone: '', email: '', sdr: '', status: '', ...extra,
});
const plano = (leads: Lead[], mais: Partial<Entrada> = {}) => montarPlano({ abas, quadros, etiquetas: [], leads, ...mais });

test('nome de quadro e primeiro nome: sem acento, maiúscula, pontuação nem o que vem entre parênteses', () => {
  assert.equal(chaveDoQuadro('FOLLOW UP PROPOSTAS (APÓS 3 TENTATIVAS)'), chaveDoQuadro('Follow-up Propostas'));
  assert.equal(primeiroNomeDoLead('  Júlia  Souza'), 'julia');
  assert.equal(primeiroNomeDoLead('JULIA'), 'julia');
  assert.equal(primeiroNomeDoLead(''), '');
});

test('quadro sem correspondente vira problema e não é inventado', () => {
  const r = plano([lead('x', 'z')], { quadros: [...quadros, q('z', 'crm-luis', 'Só ligação', 3)] });
  assert.equal(r.mapeamento.find((m) => m.quadro === 'Só ligação')?.destino, null);
  assert.match(r.problemas.join(' '), /Só ligação/);
});

test('A) closer com par no ARTHUR (cópia ou telefone): closer arquivado, ARTHUR sem mudança; sem par: move como está', () => {
  const r = plano([
    lead('a1', 'a-agendada', { telefone: '54999991111', nome: 'Ana' }),
    lead('a2', 'a-novos', { telefone: '54988882222', nome: 'Bia' }),
    lead('c1', 'c-follow', { telefone: '', espelho_origem_id: 'a1', empresa: 'Loja' }),
    lead('c2', 'c-agendada', { telefone: '5488882222', nome: 'Outro nome' }),
    lead('c3', 'c-agendada', { telefone: '54977773333' }),
  ]);
  assert.deepEqual(r.closerArquivados.map((c) => [c.closer.id, c.arthur.id, c.motivo]), [['c1', 'a1', 'cópia automática'], ['c2', 'a2', 'mesmo telefone']]);
  assert.deepEqual(r.closerMovidos.map((c) => c.id), ['c3']);
  assert.deepEqual(r.luisDuplicados, []);
  assert.deepEqual(r.total, { destinoAntes: 2, doLuis: 0, doCloser: 3, arquivados: 2, esperadoNoFinal: 3 });
});

test('A) closer sem cópia e com dois cards do ARTHUR no telefone: não escolhe, vira problema', () => {
  const r = plano([
    lead('a1', 'a-novos', { telefone: '54999991111' }), lead('a2', 'a-follow', { telefone: '54999991111' }),
    lead('c1', 'c-agendada', { telefone: '54999991111' }),
  ]);
  assert.equal(r.closerAmbiguos.length, 1);
  assert.match(r.problemas.join(' '), /decidir qual é o par/);
});

test('B) LUIS: duplicado só com telefone E primeiro nome; etapa diferente não junta; completa só vazios, nunca retornar/agendamento/calendar_event_id', () => {
  const r = plano([
    lead('a1', 'a-follow', { telefone: '+55 54 99999-1111', nome: 'Júlia Souza', sdr: 'Arthur', empresa: '', valor_mrr: 'R$ 100,00', agendamento: '', retornar: '' }),
    lead('l1', 'l-novos', { telefone: '5499991111', nome: 'julia', sdr: 'Luis', empresa: 'Loja', valor_mrr: 'R$ 200,00', agendamento: '2026-12-01T10:00', retornar: '2026-12-02T10:00', calendar_event_id: 'x' }),
  ]);
  // Etapas diferentes (Follow up x Leads Novos): não junta, os dois vão.
  assert.deepEqual(r.luisDuplicados, []);
  assert.deepEqual(r.luisEtapaDiferente.map((x) => [x.luis.id, x.arthur.id, x.etapaNoDestino]), [['l1', 'a1', 'Leads Novos']]);
  assert.equal(r.total.esperadoNoFinal, 2);
  const r2 = plano([
    lead('a1', 'a-novos', { telefone: '+55 54 99999-1111', nome: 'Júlia Souza', sdr: 'Arthur', empresa: '', valor_mrr: 'R$ 100,00', agendamento: '', retornar: '', responsavel: 'Arthur' }),
    lead('l1', 'l-novos', { telefone: '5499991111', nome: 'julia', sdr: 'Luis', empresa: 'Loja', valor_mrr: 'R$ 200,00', agendamento: '2026-12-01T10:00', retornar: '2026-12-02T10:00', calendar_event_id: 'x' }),
  ]);
  const d = r2.luisDuplicados[0];
  assert.equal(d.fica.id, 'a1');
  assert.deepEqual(d.completar.map((c) => c.campo), ['empresa']);
  assert.ok(d.divergentes.some((x) => x.campo === 'sdr'));
  assert.equal(r2.total.esperadoNoFinal, 1);
  assert.equal(r2.responsavelMuda, 1);
});

test('B) mesmo telefone com nome diferente: não junta, lista; e-mail igual não conta nada', () => {
  const r = plano([
    lead('a1', 'a-novos', { telefone: '54999991111', nome: 'Carlos', email: 'x@y.com' }),
    lead('l1', 'l-novos', { telefone: '54999991111', nome: 'Paula', email: 'x@y.com' }),
    lead('l2', 'l-novos', { telefone: '54911110000', nome: 'Carlos', email: 'x@y.com' }),
  ]);
  assert.deepEqual(r.luisDuplicados, []);
  assert.deepEqual(r.luisNomeDiferente.map((x) => [x.luis.id, x.arthur.id]), [['l1', 'a1']]);
  assert.equal(r.total.esperadoNoFinal, 3);
});

test('B) mesma etapa não aparece como "etapa diferente"; régua nunca é copiada', () => {
  const r = plano([
    lead('a1', 'a-agendada', { telefone: '54999991111', nome: 'Ana', regua: '' }),
    lead('l1', 'l-agendada', { telefone: '54999991111', nome: 'Ana', regua: 'disparo', regua_etapa: 'D3', entrou_coluna_em: '2026-11-20' }),
  ]);
  assert.equal(r.luisDuplicados.length, 1);
  assert.deepEqual(r.luisEtapaDiferente, []);
  assert.ok(!r.luisDuplicados[0].completar.some((c) => c.campo.startsWith('regua') || c.campo === 'entrou_coluna_em'));
});

test('LUIS x CLOSER no mesmo telefone sem par no ARTHUR: movidos os dois e listados; IA LUIZA só listada; lixeira fora', () => {
  const r = plano([
    lead('l1', 'l-novos', { telefone: '54933334444', nome: 'Rui' }),
    lead('c1', 'c-agendada', { telefone: '54933334444', nome: 'Rui' }),
    lead('ia', 'i-agendada', { telefone: '54933334444' }),
    lead('lixo', 'l-novos', { telefone: '54933334444', deleted_at: '2026-11-02' }),
  ]);
  assert.deepEqual(r.luisCloserMesmoTelefone.map((x) => [x.luis.id, x.closer.id]), [['l1', 'c1']]);
  assert.equal(r.comProtegidas.length, 2);
  assert.equal(r.total.esperadoNoFinal, 2);
});

test('etiqueta que só existe na origem é listada para criar; telefone repetido (99999999) não junta', () => {
  const r = plano([
    lead('a1', 'a-novos', { telefone: '5499999999', nome: 'Ana' }),
    lead('l1', 'l-novos', { status: 'Em análise', telefone: '5499999999', nome: 'Ana' }),
  ], { etiquetas: [{ field: 'status', name: 'Em análise', color: '#111111', page_id: 'crm-luis' }] });
  assert.equal(r.luisDuplicados.length, 0);
  assert.deepEqual(r.etiquetasACriar, [{ campo: 'status', nome: 'Em análise', cor: '#111111', leads: 1 }]);
});
