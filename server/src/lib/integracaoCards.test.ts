import test from 'node:test';
import assert from 'node:assert/strict';
import {
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
  assert.ok(validarPatchIntegracao({ nome: 'Fulano' }).erro); // campo fora da lista
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
