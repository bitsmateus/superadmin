import { test } from 'node:test';
import assert from 'node:assert/strict';
import { montarAvisoContrato } from './avisoContratoAssinado.js';

test('aviso de contrato: foi pro Briefing', () => {
  assert.equal(
    montarAvisoContrato('Casa do Cartucho', true),
    '✅ *Casa do Cartucho assinou o contrato!*\nMovido para Briefing, aguardando a equipe enviar a ficha.'
  );
});

test('aviso de contrato: cliente já estava em outra etapa, ou sem nome', () => {
  assert.equal(montarAvisoContrato('Clínica Sorriso', false), '✅ *Clínica Sorriso assinou o contrato!*');
  assert.equal(montarAvisoContrato('  ', false), '✅ *Cliente sem nome assinou o contrato!*');
});
