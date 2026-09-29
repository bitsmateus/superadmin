import { query } from '../db.js';

/**
 * Varredura diária do pulso de satisfação: todo pulso que ficou 'aguardando' resposta por mais de
 * N dias (default 3) vira 'sem_resposta' — isso sozinho já é um sinal pro painel de Risco de Churn
 * (cliente que nem responde "sim"/"não" também preocupa). Idempotente (WHERE status = 'aguardando'),
 * então não tem problema rodar mais de uma vez por dia.
 */
const INTERVAL_MS = 24 * 60 * 60 * 1000; // 1x/dia
const DEFAULT_DAYS = 3;

async function sweepOnce(days: number): Promise<void> {
  const marked = await query<{ id: string }>(
    `UPDATE client_pulses
     SET status = 'sem_resposta'
     WHERE status = 'aguardando' AND sent_at < NOW() - ($1 || ' days')::interval
     RETURNING id`,
    [days],
  );
  if (marked.length > 0) console.log(`[pulse-sweep] ${marked.length} pulso(s) marcado(s) como sem_resposta`);
}

export function startPulseSweep(): void {
  const days = Math.max(1, Number(process.env.PULSE_SWEEP_DAYS) || DEFAULT_DAYS);
  const tick = () => {
    sweepOnce(days).catch((err) => console.error('[pulse-sweep] erro', err));
  };
  setTimeout(tick, 60_000);
  setInterval(tick, INTERVAL_MS);
  console.log(`[pulse-sweep] agendador ativo (1x/dia, ${days} dia(s) sem resposta → sem_resposta)`);
}
