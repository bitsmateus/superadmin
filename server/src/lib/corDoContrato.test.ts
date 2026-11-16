import test from 'node:test';
import assert from 'node:assert/strict';
import { tirarVermelho } from './corDoContrato.js';

test('PDF do contrato: vermelho vira preto, outras cores ficam', () => {
  const r = tirarVermelho('<span style="color:red;">a</span><span style="font-weight:600;color:#dc2626">b</span><font color="#ff0000">c</font><span style="color:#1d4ed8">d</span>');
  assert.ok(!/(^|[;\s"'])color:\s*(red|#dc2626)/i.test(r));
  assert.ok(!/color="#ff0000"/i.test(r));
  assert.ok(r.includes('#1d4ed8'));
});
