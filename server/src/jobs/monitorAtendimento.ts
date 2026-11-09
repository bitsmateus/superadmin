import { rodarCiclo } from '../lib/atendimento/monitor.js';

/**
 * Monitor de Atendimento: a cada 3 min lê os tickets abertos/pendentes do atendimento da NX, recalcula a
 * situação de cada um e avisa no grupo do suporte o que estourou o prazo (ver lib/atendimento/monitor.ts).
 * Desliga com MONITOR_ATENDIMENTO=off (ou pela chave "Monitor ligado" na tela).
 */
const INTERVALO_MS = 3 * 60 * 1000;

export function startMonitorAtendimento() {
  if (process.env.MONITOR_ATENDIMENTO === 'off') {
    console.log('[monitorAtendimento] desativado (MONITOR_ATENDIMENTO=off)');
    return;
  }
  const tick = () => {
    rodarCiclo().catch((err) => console.error('[monitorAtendimento] erro:', err));
  };
  setTimeout(tick, 45_000);
  setInterval(tick, INTERVALO_MS);
  console.log('[monitorAtendimento] job iniciado (a cada 3 min)');
}
