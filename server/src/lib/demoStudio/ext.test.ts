import { test } from 'node:test';
import assert from 'node:assert/strict';
import { enderecoExibido, hotspotDoClique, limparHtml } from '../../routes/demoStudioExt.js';

test('hotspot do clique fica dentro da tela e some quando é pequeno demais', () => {
  assert.deepEqual(hotspotDoClique({ x: 100.4, y: 50.6, w: 200, h: 40 }, 1536, 695), { x: 100, y: 51, w: 200, h: 40 });
  // passou da borda direita/de baixo: corta
  assert.deepEqual(hotspotDoClique({ x: 1500, y: 680, w: 100, h: 40 }, 1536, 695), { x: 1500, y: 680, w: 36, h: 15 });
  // começa fora (negativo): encolhe
  assert.deepEqual(hotspotDoClique({ x: -10, y: -5, w: 50, h: 30 }, 1536, 695), { x: 0, y: 0, w: 40, h: 25 });
  assert.equal(hotspotDoClique({ x: 10, y: 10, w: 2, h: 40 }, 1536, 695), null);
  assert.equal(hotspotDoClique(null, 1536, 695), null);
});

test('endereço da barra falsa sem query nem hash', () => {
  assert.equal(enderecoExibido('https://app.nxsystems.com.br/atendimento?ticket=123&tel=5548#x'), 'app.nxsystems.com.br/atendimento');
  assert.equal(enderecoExibido('https://app.nxsystems.com.br/'), 'app.nxsystems.com.br/');
  assert.equal(enderecoExibido('lixo'), null);
});

test('snapshot HTML sem script, iframe, on* e javascript:', () => {
  const sujo = '<div onclick="roubar()"><script>alert(1)</script><iframe src="x"></iframe><a href="javascript:alert(1)">x</a><img src="a.png" onerror=alert(1)></div>';
  const limpo = limparHtml(sujo);
  assert.ok(!/script|iframe|onclick|onerror|javascript:/i.test(limpo), limpo);
  assert.ok(limpo.includes('<img src="a.png"'));
});
