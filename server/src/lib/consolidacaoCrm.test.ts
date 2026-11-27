import test from 'node:test';
import assert from 'node:assert/strict';
import { chaveDoQuadro, montarPlano, type Entrada, type Lead } from './consolidacaoCrm.js';

const abas = [
  { id: 'crm-arthur', name: 'CRM ARTHUR', arquivada: false },
  { id: 'crm-luis', name: 'CRM LUIS', arquivada: false },
  { id: 'crm-luis-closer', name: 'CRM LUIS CLOSER', arquivada: false },
  { id: 'crm-ia-luiza', name: 'CRM IA LUIZA', arquivada: false },
];
const q = (id: string, page: string, name: string, position = 0) => ({ id, page, name, position });
const quadros = [
  q('a-novos', 'crm-arthur', 'Leads Novos', 0), q('a-agendada', 'crm-arthur', 'Reunião agendada', 1), q('a-follow', 'crm-arthur', 'Follow up Propostas', 2),
  q('l-novos', 'crm-luis', 'LEADS NOVOS', 0),
  q('c-agendada', 'crm-luis-closer', 'REUNIÃO AGENDADA', 0), q('c-follow', 'crm-luis-closer', 'FOLLOW UP PROPOSTAS (APÓS 3 TENTATIVAS)', 1),
  q('i-agendada', 'crm-ia-luiza', 'Reunião agendada', 0),
];
const lead = (id: string, board_id: string, extra: Record<string, unknown> = {}): Lead => ({
  id, board_id, deleted_at: null, movido_em: '2026-11-01T10:00:00Z', vinculos: {}, nome: id, telefone: '', email: '', sdr: '', status: '', ...extra,
});
const plano = (leads: Lead[], mais: Partial<Entrada> = {}) => montarPlano({ abas, quadros, etiquetas: [], leads, ...mais });

test('nome de quadro: ignora acento, maiúscula e o que vem entre parênteses', () => {
  assert.equal(chaveDoQuadro('FOLLOW UP PROPOSTAS (APÓS 3 TENTATIVAS)'), chaveDoQuadro('Follow-up Propostas'));
  assert.equal(chaveDoQuadro('REUNIÃO AGENDADA'), chaveDoQuadro('Reunião agendada'));
});

test('quadro sem correspondente vira problema e não é inventado', () => {
  const r = plano([lead('x', 'z')], { quadros: [...quadros, q('z', 'crm-luis', 'Só ligação', 3)] });
  assert.equal(r.mapeamento.find((m) => m.quadro === 'Só ligação')?.destino, null);
  assert.match(r.problemas.join(' '), /Só ligação/);
});

test('duplicado (com/sem 55 e 9): fica o do destino, etapa mais recente, completa só vazios, nada preenchido muda', () => {
  const r = plano([
    lead('dest', 'a-novos', { nome: 'Ana', telefone: '+55 54 99999-1234', sdr: 'Arthur', empresa: '', valor_mrr: 'R$ 100,00' }),
    lead('closer', 'c-follow', { nome: 'Ana', telefone: '5499991234', sdr: 'Luis', empresa: 'Loja', valor_mrr: 'R$ 200,00', movido_em: '2026-11-20T10:00:00Z' }),
    lead('outro', 'l-novos', { telefone: '11988887777' }),
  ]);
  assert.equal(r.duplicados.length, 1);
  const d = r.duplicados[0];
  assert.equal(d.fica.id, 'dest');
  assert.deepEqual(d.saem.map((s) => s.id), ['closer']);
  assert.equal(d.etapaFinal.quadro, 'Follow up Propostas');
  assert.deepEqual(d.completar.map((c) => c.campo), ['empresa']);
  assert.ok(!d.completar.some((c) => ['nome', 'sdr', 'valor_mrr'].includes(c.campo)));
  assert.ok(d.divergentes.some((x) => x.campo === 'sdr' && x.fica === 'Arthur'));
  assert.deepEqual(r.total, { destinoAntes: 1, doLuis: 1, doCloser: 1, arquivados: 1, esperadoNoFinal: 2 });
});

test('só telefone decide: mesmo e-mail não junta; cópia sem telefone não junta e é listada', () => {
  const r = plano([
    lead('luis', 'l-novos', { email: 'a@b.com' }),
    lead('closer', 'c-agendada', { email: 'A@B.com' }),
    lead('origem', 'a-agendada', { telefone: '54911112222' }),
    lead('copia', 'c-agendada', { espelho_origem_id: 'origem' }),
  ]);
  assert.equal(r.duplicados.length, 0);
  assert.deepEqual(r.copiasSeparadas.map((c) => [c.copia.id, c.origem.id]), [['copia', 'origem']]);
  assert.equal(r.total.esperadoNoFinal, 4);
});

test('destino com dois cards do mesmo telefone: a cópia vai pra origem dela; o outro card segue a regra', () => {
  const r = plano([
    lead('d1', 'a-novos', { telefone: '54999990001', vinculos: { atualizações: 5 } }),
    lead('d2', 'a-agendada', { telefone: '54999990001' }),
    lead('copia', 'c-agendada', { telefone: '54999990001', espelho_origem_id: 'd2' }),
    lead('solto', 'l-novos', { telefone: '54999990001' }),
  ]);
  const alvo = Object.fromEntries(r.duplicados.flatMap((d) => d.saem.map((s) => [s.id, d.fica.id])));
  assert.equal(alvo.copia, 'd2');
  assert.equal(alvo.solto, 'd2');
  assert.equal(r.total.esperadoNoFinal, 2);
});

test('régua: etapa final do card que sai traz o estado da régua dele; sem isso, nada muda', () => {
  const r = plano([
    lead('dest', 'a-novos', { telefone: '54977776666', regua: '', regua_etapa: '', entrou_coluna_em: '2026-11-01T00:00:00Z' }),
    lead('sai', 'c-follow', { telefone: '54977776666', regua: 'proposta', regua_etapa: 'D3', entrou_coluna_em: '2026-11-18T00:00:00Z', movido_em: '2026-11-18T00:00:00Z' }),
  ]);
  const d = r.duplicados[0];
  assert.deepEqual(d.regua.map((x) => x.campo).sort(), ['entrou_coluna_em', 'regua', 'regua_etapa']);
  assert.deepEqual(r.reguaAlterada, { disparo: 0, followup: 1, naoCompareceu: 0 });
  assert.ok(!d.completar.some((c) => c.campo.startsWith('regua')));
  const r2 = plano([
    lead('dest', 'a-follow', { telefone: '54977776666', regua: 'proposta', movido_em: '2026-11-20T00:00:00Z' }),
    lead('sai', 'c-agendada', { telefone: '54977776666', regua: 'disparo' }),
  ]);
  assert.deepEqual(r2.duplicados[0].regua, []);
});

test('CRM IA LUIZA não entra na junção: só é listado; lixeira não conta', () => {
  const r = plano([
    lead('closer', 'c-agendada', { telefone: '54999990000' }),
    lead('ia', 'i-agendada', { telefone: '54999990000' }),
    lead('lixo', 'l-novos', { telefone: '54999990000', deleted_at: '2026-11-02' }),
  ]);
  assert.equal(r.duplicados.length, 0);
  assert.deepEqual(r.comProtegidas.map((c) => [c.lead.id, c.protegido.id]), [['closer', 'ia']]);
  assert.equal(r.total.arquivados, 0);
  assert.equal(r.total.esperadoNoFinal, 1);
});

test('etiqueta que só existe na origem é listada para criar; telefone repetido (99999999) não junta', () => {
  const r = plano([
    lead('a', 'l-novos', { status: 'Em análise', telefone: '5499999999' }),
    lead('b', 'c-agendada', { telefone: '5499999999' }),
  ], { etiquetas: [{ field: 'status', name: 'Em análise', color: '#111111', page_id: 'crm-luis' }] });
  assert.equal(r.duplicados.length, 0);
  assert.deepEqual(r.etiquetasACriar, [{ campo: 'status', nome: 'Em análise', cor: '#111111', leads: 1 }]);
});

test('avisa quando a movimentação mais recente faz o lead voltar no funil', () => {
  const r = plano([
    lead('dest', 'a-follow', { telefone: '54999991234' }),
    lead('novo', 'l-novos', { telefone: '54999991234', movido_em: '2026-11-25T10:00:00Z' }),
  ]);
  assert.equal(r.duplicados[0].etapaFinal.quadro, 'Leads Novos');
  assert.ok(r.duplicados[0].alertas.some((a) => a.includes('VOLTA no funil')));
});
