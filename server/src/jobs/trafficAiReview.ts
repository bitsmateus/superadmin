import { query } from '../db.js';
import { rodarVarreduraIa } from '../lib/trafficAiReview.js';

/**
 * Varredura diária de tráfego com IA às 08h05 (America/Sao_Paulo) — logo depois do relatório das 08h.
 * Uma vez por dia (traffic_report_log, kind 'ia'). Sem ANTHROPIC_API_KEY ou sem dados do Meta, não faz nada.
 */

const TZ = 'America/Sao_Paulo';
const HORA = 8;
const MIN_INICIO = 5;
const MIN_FIM = 20;

function spAgora(): { dia: string; hora: number; minuto: number } {
  const p = new Intl.DateTimeFormat('en-GB', {
    timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(new Date());
  const g = (t: string) => p.find((x) => x.type === t)?.value ?? '0';
  return { dia: `${g('year')}-${g('month')}-${g('day')}`, hora: Number(g('hour')) % 24, minuto: Number(g('minute')) };
}

async function rodar(dia: string): Promise<void> {
  const reservado = await query(
    `INSERT INTO traffic_report_log (dia, kind) VALUES ($1::date, 'ia') ON CONFLICT DO NOTHING RETURNING dia`, [dia]);
  if (reservado.length === 0) return;
  try {
    const r = await rodarVarreduraIa();
    console.log(`[traffic-ai] varredura de ${r.dia}: ${r.sugestoes} sugestão(ões)`);
  } catch (err) {
    console.error('[traffic-ai] erro', err instanceof Error ? err.message : err);
    await query(`DELETE FROM traffic_report_log WHERE dia = $1::date AND kind = 'ia'`, [dia]); // tenta de novo na janela
  }
}

export function startTrafficAiReview(): void {
  if (!process.env.ANTHROPIC_API_KEY) {
    console.log('[traffic-ai] sem ANTHROPIC_API_KEY — varredura diária com IA desligada');
    return;
  }
  setInterval(() => {
    const { dia, hora, minuto } = spAgora();
    if (hora !== HORA || minuto < MIN_INICIO || minuto >= MIN_FIM) return;
    void rodar(dia);
  }, 60_000);
  console.log('[traffic-ai] varredura diária de tráfego com IA ativa (08h05, America/Sao_Paulo)');
}
