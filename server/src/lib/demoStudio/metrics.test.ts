import { test } from 'node:test';
import assert from 'node:assert/strict';
import { aoVivo, canalDaSessao, contarPor, funil, resumo, serieDiaria, type SessaoMetrica } from './metrics.js';
import { ehRobo, horarioDoEvento, criarLimitador, lerDispositivo, resumoDoLote } from './coleta.js';

let n = 0;
function sessao(p: Partial<SessaoMetrica>): SessaoMetrica {
  n++;
  return {
    id: `s${n}`, visitorId: `v${n}`, demoId: 'd1', linkId: null, linkLabel: null, leadId: null,
    startedAt: new Date('2026-11-03T15:00:00Z'), lastSeenAt: new Date('2026-11-03T15:03:00Z'),
    activeMs: 0, maxStepOrder: 0, stepsViewed: 0, totalSteps: 15, completed: false, ctaClicked: false,
    device: 'desktop', referrer: null, ...p,
  };
}

test('aceite do M2: 3 navegadores, 1 até o fim → 3 views, 3 únicos, 33% de conclusão', () => {
  const s = [
    sessao({ maxStepOrder: 15, stepsViewed: 15, completed: true, activeMs: 180_000, ctaClicked: true }),
    sessao({ maxStepOrder: 4, stepsViewed: 4, activeMs: 40_000, device: 'mobile' }),
    sessao({ maxStepOrder: 1, stepsViewed: 1, activeMs: 5_000 }),
  ];
  const r = resumo(s);
  assert.equal(r.views, 3);
  assert.equal(r.unicos, 3);
  assert.equal(Math.round(r.taxaConclusao * 100), 33);
  assert.equal(r.tempoMedioMs, 75_000);
  assert.equal(r.cliquesCta, 1);
  assert.ok(Math.abs(r.engajamentoMedio - (15 + 4 + 1) / 45) < 1e-9);

  const f = funil(s, [1, 2, 4, 5, 15].map((order) => ({ order, title: `E${order}`, kind: 'HOTSPOT' })));
  assert.deepEqual(f.map((l) => l.sessoes), [3, 2, 2, 1, 1]);
  assert.equal(f[1].queda, 1 / 3);
  assert.equal(f[3].queda, 0.5);
  assert.equal(f[4].pct, 1 / 3);
});

test('mesmo visitante em duas sessões conta 2 views e 1 único; sem sessões tudo zero', () => {
  const r = resumo([sessao({ visitorId: 'x' }), sessao({ visitorId: 'x' })]);
  assert.equal(r.views, 2);
  assert.equal(r.unicos, 1);
  assert.deepEqual(resumo([]), {
    views: 0, unicos: 0, taxaConclusao: 0, tempoMedioMs: 0, engajamentoMedio: 0, cliquesCta: 0, sessoesComLead: 0, conversaoLead: 0,
  });
});

test('série diária no fuso de São Paulo, com dias vazios', () => {
  // 02:30 UTC do dia 4 ainda é dia 3 em São Paulo (UTC-3).
  const s = [sessao({ startedAt: new Date('2026-11-04T02:30:00Z') }), sessao({ startedAt: new Date('2026-11-05T13:00:00Z') })];
  const serie = serieDiaria(s, new Date('2026-11-03T03:00:00Z'), new Date('2026-11-06T02:59:59Z'));
  assert.deepEqual(serie.map((d) => [d.dia, d.views]), [['2026-11-03', 1], ['2026-11-04', 0], ['2026-11-05', 1]]);
});

test('canais, dispositivos e ao vivo', () => {
  const s = [
    sessao({ linkLabel: 'Site' }),
    sessao({ referrer: 'https://www.instagram.com/x' }),
    sessao({ referrer: 'lixo' }),
    sessao({ device: 'mobile', completed: true }),
  ];
  assert.deepEqual(s.map(canalDaSessao), ['Site', 'instagram.com', 'Direto', 'Direto']);
  assert.equal(canalDaSessao(sessao({ utmSource: 'instagram', referrer: 'https://l.facebook.com/' })), 'instagram');
  assert.deepEqual(contarPor(s, (x) => x.device ?? '?')[0], { chave: 'desktop', views: 3, concluidas: 0 });
  assert.equal(aoVivo(s, new Date('2026-11-03T15:06:00Z').getTime()), 4);
  assert.equal(aoVivo(s, new Date('2026-11-03T15:09:00Z').getTime()), 0);
});

test('coleta: robôs, dispositivo, horário e lote', () => {
  assert.ok(ehRobo('WhatsApp/2.23.20.0 A'));
  assert.ok(ehRobo('facebookexternalhit/1.1'));
  assert.ok(ehRobo(undefined));
  assert.ok(!ehRobo('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36'));
  assert.equal(lerDispositivo('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1').device, 'mobile');
  assert.equal(lerDispositivo('Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/130.0').device, 'desktop');
  const agora = Date.now();
  assert.equal(horarioDoEvento(agora - 1000, agora).getTime(), agora - 1000);
  assert.equal(horarioDoEvento(agora + 3600_000, agora).getTime(), agora);
  assert.deepEqual(
    resumoDoLote([
      { t: 'step_view', ts: 0, stepId: '00000000-0000-4000-8000-000000000000', order: 3 },
      { t: 'heartbeat', ts: 0, activeMs: 15000 },
      { t: 'heartbeat', ts: 0, activeMs: 50000 },
      { t: 'complete', ts: 0 },
    ]),
    { activeMs: 35000, maxOrder: 3, completed: true, cta: false }
  );
  const pode = criarLimitador(2, 1000);
  assert.deepEqual([pode('ip', 0), pode('ip', 10), pode('ip', 20), pode('ip', 1001)], [true, true, false, true]);
});
