import { query } from '../db.js';

/**
 * Limpeza diária do Demo Studio (§11): heartbeats com mais de 180 dias saem de ds_events — os agregados
 * já estão na sessão, então nenhuma métrica muda. A limpeza de arquivos órfãos do storage fica para
 * quando houver exclusão de telas em volume (M5, máscaras "assadas").
 */
async function limpar() {
  const r = await query<{ n: number }>(
    `WITH apagados AS (
       DELETE FROM ds_events WHERE type = 'heartbeat' AND ts < NOW() - INTERVAL '180 days' RETURNING 1
     ) SELECT COUNT(*)::int AS n FROM apagados`
  );
  if (r[0]?.n) console.log(`[demo-studio] ${r[0].n} heartbeat(s) antigos apagados`);
}

export function startDemoStudioLimpeza() {
  const rodar = () => limpar().catch((err) => console.error('[demo-studio] limpeza falhou:', err));
  setTimeout(rodar, 5 * 60_000);
  setInterval(rodar, 24 * 3600_000);
}
