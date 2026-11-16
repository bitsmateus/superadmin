import test from 'node:test';
import assert from 'node:assert/strict';
import { logradouroCompleto } from './cnpj.js';

test('logradouro da Receita: junta o tipo ("RUA") ao nome, sem repetir', () => {
  assert.equal(logradouroCompleto({ descricao_tipo_de_logradouro: 'RUA', logradouro: 'MARECHAL DEODORO' }), 'RUA MARECHAL DEODORO');
  assert.equal(logradouroCompleto({ descricao_tipo_de_logradouro: 'AVENIDA', logradouro: 'AVENIDA BRASIL' }), 'AVENIDA BRASIL');
  assert.equal(logradouroCompleto({ logradouro: 'BR 101' }), 'BR 101');
  // Sem nome de rua (CEP geral da cidade): fica vazio, não vira só "RUA".
  assert.equal(logradouroCompleto({ descricao_tipo_de_logradouro: 'RUA', logradouro: '' }), '');
});
