import test from 'node:test';
import assert from 'node:assert/strict';
import { limparPreferenciasDaInicio } from './preferenciasDaInicio.js';

test('tela inicial: aceita caminhos de tela, tira repetido e respeita os limites', () => {
  assert.deepEqual(
    limparPreferenciasDaInicio({ atalhos: ['/clients', '/clients', '/comercial/crm-arthur'], acessoRapido: ['/agenda'] }),
    { atalhos: ['/clients', '/comercial/crm-arthur'], acessoRapido: ['/agenda'] },
  );
  assert.deepEqual(limparPreferenciasDaInicio({}), { atalhos: [], acessoRapido: [] });
  assert.equal(limparPreferenciasDaInicio({ atalhos: ['/a', '/b', '/c', '/d'] }), null);
  assert.equal(limparPreferenciasDaInicio({ acessoRapido: Array.from({ length: 9 }, (_, i) => `/p${i}`) }), null);
});

test('tela inicial: recusa o que não é caminho de tela', () => {
  assert.equal(limparPreferenciasDaInicio({ atalhos: ['https://fora.com'] }), null);
  assert.equal(limparPreferenciasDaInicio({ atalhos: ['/x?y=<script>'] }), null);
  assert.equal(limparPreferenciasDaInicio({ atalhos: [1] }), null);
  assert.equal(limparPreferenciasDaInicio(['/clients']), null);
  assert.equal(limparPreferenciasDaInicio(null), null);
});
