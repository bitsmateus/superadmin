import test from 'node:test';
import assert from 'node:assert/strict';
import {
  compararAchadosPorTelefone, normalizarOrigem, resolverQuadro, validarCriacaoIntegracao,
  chaveValida, colunasQueCasam, mesmoTelefone, montarEtiquetas, resolverEtiquetas, parseDataIntegracao, telefoneComDdi, textoParaHtml, validarPatchIntegracao,
} from './integracaoCards.js';

test('telefoneComDdi: só dígitos e com 55', () => {
  assert.equal(telefoneComDdi('(11) 98765-4321'), '5511987654321');
  assert.equal(telefoneComDdi('+55 11 98765-4321'), '5511987654321');
  assert.equal(telefoneComDdi('011 3333-4444'), '551133334444');
  assert.equal(telefoneComDdi('98765-4321'), null); // sem DDD
  assert.equal(telefoneComDdi(''), null);
});

test('mesmoTelefone: tolera 55 e o 9', () => {
  assert.ok(mesmoTelefone('11987654321', '5511987654321'));
  assert.ok(mesmoTelefone('1187654321', '5511987654321')); // sem o 9
  assert.ok(mesmoTelefone('+55 (11) 98765-4321', '1187654321'));
  assert.ok(mesmoTelefone('987654321', '5511987654321')); // sem DDD: só os 8 finais
  assert.ok(!mesmoTelefone('11987654321', '21987654321')); // DDD diferente
  assert.ok(!mesmoTelefone('11987654321', '11987654322'));
  assert.ok(!mesmoTelefone('', '11987654321'));
});

const colunas = [
  { id: 'a1', name: 'Disparo em massa após 7 dias', page: 'crm-arthur' },
  { id: 'a2', name: 'Followup Propostas', page: 'crm-arthur' },
  { id: 'a3', name: 'Vendido', page: 'crm-arthur' },
  { id: 'l1', name: 'Disparo em massa', page: 'crm-luis' },
  { id: 'l2', name: 'Disparo em massa após 7 dias', page: 'crm-luis' },
  { id: 'l3', name: 'Follow-up Propostas', page: 'crm-luis' },
];

test('colunasQueCasam: ignora caixa/espaço/acento e aceita "começa com"', () => {
  assert.deepEqual(colunasQueCasam(colunas, 'DISPARO EM MASSA').sort(), ['a1', 'l1']); // Luis: igual ganha do prefixo
  assert.deepEqual(colunasQueCasam(colunas, '  follow up propostas ').sort(), ['a2', 'l3']);
  assert.deepEqual(colunasQueCasam(colunas, 'vendido'), ['a3']);
  assert.deepEqual(colunasQueCasam(colunas, 'inexistente'), []);
  assert.deepEqual(colunasQueCasam(colunas, '   '), []);
});

test('parseDataIntegracao', () => {
  assert.equal(parseDataIntegracao('2026-10-01')?.toISOString(), '2026-10-01T03:00:00.000Z');
  assert.equal(parseDataIntegracao('2026-10-01T10:00:00Z')?.toISOString(), '2026-10-01T10:00:00.000Z');
  assert.equal(parseDataIntegracao('ontem'), null);
  assert.equal(parseDataIntegracao(undefined), null);
});

test('chaveValida', () => {
  assert.ok(chaveValida('segredo', 'segredo'));
  assert.ok(!chaveValida('errada', 'segredo'));
  assert.ok(!chaveValida(undefined, 'segredo'));
  assert.ok(!chaveValida('', ''));
});

test('validarPatchIntegracao', () => {
  const ok = validarPatchIntegracao({ coluna: 'Vendido', regua: 'Disparo', regua_etapa: 'D7', dor: 'x', mrr: 199, optout: 'sim' });
  assert.equal(ok.erro, undefined);
  assert.equal(ok.coluna, 'Vendido');
  assert.deepEqual(ok.campos, {
    regua: 'disparo', regua_etapa: 'D7', dor_cliente: 'x', valor_mrr: '199', optout: true, regua_status: 'optout',
  });
  assert.ok(validarPatchIntegracao({ regua: 'outra' }).erro);
  assert.ok(validarPatchIntegracao({ regua_status: 'x' }).erro);
  assert.ok(validarPatchIntegracao({ board_id: 'nao-uuid' }).erro);
  assert.ok(validarPatchIntegracao({ apelido: 'Fulano' }).erro); // campo fora da lista
  assert.ok(validarPatchIntegracao({ coluna: 'A', board_id: '11111111-1111-1111-1111-111111111111' }).erro);
  assert.ok(validarPatchIntegracao({}).erro);
  assert.ok(validarPatchIntegracao({ regua_ultimo_envio_em: 'xx' }).erro);
  assert.equal(validarPatchIntegracao({ optout: true, regua_status: 'ativa' }).campos.regua_status, 'ativa');
  assert.equal(validarPatchIntegracao({ regua: null }).campos.regua, '');
});

test('textoParaHtml escapa HTML', () => {
  assert.equal(textoParaHtml('Luiza: <b>D7</b>\nok'), '<p>Luiza: &lt;b&gt;D7&lt;/b&gt;<br>ok</p>');
});

const opcoes = {
  disparo: ['D7', 'D14', 'D30', 'D45', 'D60', 'D90', 'ENCERRADO'],
  followup: ['D1', 'D3', 'D5', 'D7', 'D14', 'D21'],
  status: ['Primeiro contato', 'Vendido'],
  tipo: ['Lead'],
};

test('montarEtiquetas: só colunas com etiqueta na aba, vazio vira ""', () => {
  assert.deepEqual(montarEtiquetas({ disparo: 'D7', followup: '', status: 'Vendido', tipo: null }, opcoes), {
    Tipo: '', Status: 'Vendido', 'Follow-up': '', Disparo: 'D7',
  });
  assert.deepEqual(montarEtiquetas({ disparo: 'D7' }, {}), {});
});

test('resolverEtiquetas: ignora caixa/acento, aceita nome da tela ou field, nunca cria', () => {
  const r = resolverEtiquetas({ disparo: 'encerrado', 'FOLLOW UP': 'd3' }, opcoes);
  assert.equal(r.erro, undefined);
  assert.deepEqual(r.campos, { disparo: 'ENCERRADO', followup: 'D3' });
  assert.deepEqual(resolverEtiquetas({ Disparo: '' }, opcoes).campos, { disparo: '' });
  assert.deepEqual(resolverEtiquetas({ Disparo: null }, opcoes).campos, { disparo: '' });
});

test('resolverEtiquetas: coluna ou etiqueta inexistente -> erro com as válidas', () => {
  const a = resolverEtiquetas({ Disparo: 'D8' }, opcoes);
  assert.match(a.erro!, /D8.*Disparo.*D7, D14/);
  assert.deepEqual(a.validas?.Disparo, opcoes.disparo);
  const b = resolverEtiquetas({ Inexistente: 'D7' }, opcoes);
  assert.match(b.erro!, /Inexistente.*Válidas: .*Disparo/);
  assert.ok(resolverEtiquetas({ Disparo: 7 }, opcoes).erro);
  assert.ok(resolverEtiquetas({ Disparo: 'D7', disparo: 'D14' }, opcoes).erro); // duplicada
  assert.ok(resolverEtiquetas({ SDR: 'x' }, opcoes).erro); // aba sem etiquetas de SDR
  assert.ok(resolverEtiquetas('D7', opcoes).erro);
});

test('validarPatchIntegracao aceita "etiquetas"', () => {
  const v = validarPatchIntegracao({ etiquetas: { Disparo: 'D7' } });
  assert.equal(v.erro, undefined);
  assert.deepEqual(v.etiquetas, { Disparo: 'D7' });
  assert.ok(validarPatchIntegracao({ etiquetas: 'D7' }).erro);
});

test('resolverQuadro: id, nome e palavras ("crm-luiza" acha "CRM IA LUIZA")', () => {
  const qs = [
    { id: 'crm-arthur', name: 'CRM ARTHUR' }, { id: 'crm-luis-2', name: 'CRM LUIS' },
    { id: 'crm-luis-closer', name: 'CRM LUIS CLOSER' }, { id: 'crm-ia-luiza', name: 'CRM IA LUIZA' },
  ];
  assert.equal(resolverQuadro(qs, 'crm-ia-luiza').id, 'crm-ia-luiza');
  assert.equal(resolverQuadro(qs, 'crm-luiza').id, 'crm-ia-luiza');
  assert.equal(resolverQuadro(qs, 'CRM LUIZA').id, 'crm-ia-luiza');
  assert.equal(resolverQuadro(qs, 'CRM IA LUIZA').id, 'crm-ia-luiza');
  assert.equal(resolverQuadro(qs, 'CRM LUIS').id, 'crm-luis-2'); // nome igual ganha do "contém"
  assert.match(resolverQuadro(qs, 'crm-mateus').erro ?? '', /não existe/);
  assert.match(resolverQuadro(qs, 'crm').erro ?? '', /ambíguo/);
  assert.match(resolverQuadro(qs, '').erro ?? '', /obrigatório/);
});

test('normalizarOrigem: códigos do n8n, os da tela, "outros: …" e inválidos', () => {
  assert.equal(normalizarOrigem('bio_instagram'), 'bio_instagram');
  assert.equal(normalizarOrigem('LP_TESTE'), 'lp_teste');
  assert.equal(normalizarOrigem('meta'), 'meta');
  assert.equal(normalizarOrigem('Outros: feira'), 'outros: feira');
  assert.equal(normalizarOrigem(''), '');
  assert.equal(normalizarOrigem('instagram'), null);
  assert.equal(normalizarOrigem(3), null);
});

test('validarCriacaoIntegracao: obrigatórios, telefone, campos e lista de erros', () => {
  const ok = validarCriacaoIntegracao({
    quadro: 'crm-luiza', coluna: 'Primeiro contato', nome: 'Lorena Luísa', telefone: '82 98705-6959',
    empresa: 'Pet Vida', origem: 'bio_instagram', descricao: 'quer organizar', dor_cliente: 'demora',
    numero_atendentes: 3, email: 'a@b.com', ramo: 'pet', ticket_nx: '370651', sdr: 'Luiza',
  });
  assert.deepEqual(ok.erros, []);
  assert.equal(ok.campos.telefone, '5582987056959');
  assert.equal(ok.campos.observacoes, 'quer organizar');
  assert.equal(ok.campos.nicho, 'pet');
  assert.equal(ok.campos.numero_atendentes, '3');
  assert.equal(ok.sdr, 'Luiza');
  const ruim = validarCriacaoIntegracao({ telefone: '123', origem: 'xx', campo_doido: 1 });
  assert.ok(ruim.erros.some((e) => e.includes('"quadro"')));
  assert.ok(ruim.erros.some((e) => e.includes('"nome"')));
  assert.ok(ruim.erros.some((e) => e.includes('"telefone" inválido')));
  assert.ok(ruim.erros.some((e) => e.includes('"origem" inválida')));
  assert.ok(ruim.erros.some((e) => e.includes('campo_doido')));
  assert.ok(validarCriacaoIntegracao({ quadro: 'x', nome: 'y' }).erros.some((e) => e.includes('"telefone" é obrigatório')));
});

test('compararAchadosPorTelefone: Date ou null (o bug do localeCompare), original antes de cópia', () => {
  const lista = [
    { id: 'velho', copia: false, entrou_coluna_em: new Date('2026-10-01T10:00:00Z') },
    { id: 'sem-data', copia: false, entrou_coluna_em: null },
    { id: 'copia', copia: true, entrou_coluna_em: new Date('2026-10-22T10:00:00Z') },
    { id: 'novo', copia: false, entrou_coluna_em: new Date('2026-10-20T10:00:00Z') },
  ];
  assert.deepEqual(lista.sort(compararAchadosPorTelefone).map((x) => x.id), ['novo', 'velho', 'sem-data', 'copia']);
});

test('validarPatchIntegracao: aceita descricao, empresa, nome, origem, email e ramo', () => {
  const v = validarPatchIntegracao({ descricao: 'x', empresa: 'Pet', nome: 'Lo', origem: 'lp_teste', email: 'a@b', ramo: 'pet', ticket_nx: 1 });
  assert.equal(v.erro, undefined);
  assert.deepEqual(v.campos, { observacoes: 'x', empresa: 'Pet', nome: 'Lo', origem: 'lp_teste', email: 'a@b', nicho: 'pet', ticket_nx: '1' });
  assert.match(validarPatchIntegracao({ origem: 'tiktok' }).erro ?? '', /origem/);
  assert.match(validarPatchIntegracao({ nome: '  ' }).erro ?? '', /nome/);
});
