import test from 'node:test'
import assert from 'node:assert/strict'
import { ehErroDeVersaoNova, podeRecarregarPorVersaoNova } from './versaoNova'

test('reconhece o erro de arquivo de tela que sumiu depois de uma versão nova (Chrome, Firefox, Safari)', () => {
  for (const m of [
    'Failed to fetch dynamically imported module: https://app.nxdigital.com.br/assets/FinanceiroContratoPage-B2q3HzcH.js',
    'error loading dynamically imported module: https://app.nxdigital.com.br/assets/X.js',
    'Importing a module script failed.',
    'Unable to preload CSS for /assets/index-abc.css',
    'Loading chunk 12 failed.',
  ]) assert.equal(ehErroDeVersaoNova(new Error(m)), true, m)
})

test('outro erro qualquer não é versão nova', () => {
  for (const e of [new Error('Cannot read properties of undefined'), new Error(''), 'falha', null, undefined, 42]) {
    assert.equal(ehErroDeVersaoNova(e), false, String(e))
  }
})

test('recarrega uma vez só: dentro de 30s do último reload não recarrega de novo (evita loop)', () => {
  assert.equal(podeRecarregarPorVersaoNova(1_000_000, null), true)
  assert.equal(podeRecarregarPorVersaoNova(1_000_000, 990_000), false)
  assert.equal(podeRecarregarPorVersaoNova(1_000_000, 960_000), true)
  assert.equal(podeRecarregarPorVersaoNova(1_000_000, Number.NaN), true)
})
