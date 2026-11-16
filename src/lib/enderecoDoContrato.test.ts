import test from 'node:test';
import assert from 'node:assert/strict';
import { COMPLEMENTO_PADRAO, lerEnderecoDaFicha, mesclarEndereco, precisaConsultarCep } from './enderecoDoContrato.ts';

test('ficha: rua, número, bairro e CEP escritos à mão', () => {
  assert.deepEqual(lerEnderecoDaFicha('Rua das Flores, 123, Centro, Tapiratiba - SP, 13760-000'),
    { cep: '13760000', logradouro: 'Rua das Flores', numero: '123', bairro: 'Centro' });
  assert.deepEqual(lerEnderecoDaFicha('Av. Brasil nº 45 - Jardim Europa, Tubarão/SC'), { logradouro: 'Av. Brasil', numero: '45', bairro: 'Jardim Europa' });
  assert.equal(lerEnderecoDaFicha('Rua X, s/n, Centro, Cidade, SP').numero, 'S/N');
  assert.deepEqual(lerEnderecoDaFicha(''), {});
  assert.deepEqual(lerEnderecoDaFicha(undefined), {});
  // Sem número escrito: não inventa.
  assert.equal(lerEnderecoDaFicha('Rua das Flores, Centro, Tapiratiba, SP').numero, undefined);
});

test('mesclar: CNPJ primeiro, depois a ficha, depois o CEP; complemento vazio vira "Empresa"', () => {
  // O caso da tela: o CNPJ veio sem rua/número/complemento (CEP geral da cidade) e o CEP também não tem rua.
  const sem = mesclarEndereco({ bairro: 'CENTRO', municipio: 'TAPIRATIBA', uf: 'SP', cep: '13760000' }, { bairro: '', localidade: 'Tapiratiba', uf: 'SP' }, '');
  assert.deepEqual(sem, { logradouro: '', numero: '', complemento: COMPLEMENTO_PADRAO, bairro: 'CENTRO', municipio: 'TAPIRATIBA', uf: 'SP', cep: '13760000' });
  assert.equal(COMPLEMENTO_PADRAO, 'Empresa');
  // Com a ficha escrita, rua e número saem dela.
  const comFicha = mesclarEndereco({ bairro: 'CENTRO', municipio: 'TAPIRATIBA', uf: 'SP', cep: '13760000' }, null, 'Rua Quinze de Novembro, 250, Centro, Tapiratiba SP');
  assert.equal(comFicha.logradouro, 'Rua Quinze de Novembro');
  assert.equal(comFicha.numero, '250');
  // O que a Receita trouxe não é trocado pela ficha.
  const cnpj = mesclarEndereco({ logradouro: 'RUA A', numero: '10', complemento: 'SALA 2', bairro: 'B', municipio: 'C', uf: 'SC', cep: '88701005' }, { logradouro: 'Outra rua', bairro: 'X' }, 'Rua Z, 99');
  assert.deepEqual(cnpj, { logradouro: 'RUA A', numero: '10', complemento: 'SALA 2', bairro: 'B', municipio: 'C', uf: 'SC', cep: '88701005' });
  // Rua e bairro que faltam vêm do CEP.
  const viaCep = mesclarEndereco({ numero: '5', municipio: 'TUBARAO', uf: 'SC', cep: '88701005' }, { logradouro: 'Avenida Expedicionário José Pedro Coelho', bairro: 'Centro', localidade: 'Tubarão', uf: 'SC' }, '');
  assert.equal(viaCep.logradouro, 'Avenida Expedicionário José Pedro Coelho');
  assert.equal(viaCep.bairro, 'Centro');
});

test('só consulta o CEP quando falta rua, bairro, cidade ou UF', () => {
  assert.equal(precisaConsultarCep({ logradouro: 'RUA A', bairro: 'B', municipio: 'C', uf: 'SC' }), false);
  assert.equal(precisaConsultarCep({ bairro: 'B', municipio: 'C', uf: 'SC' }), true);
});
