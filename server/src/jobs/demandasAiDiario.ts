import { gerarPlanosDoDia } from '../lib/demandasAi.js';

/**
 * Organização diária das Demandas com IA às 08h00 (America/Sao_Paulo): gera e guarda o plano de cada
 * aba de Demandas pra aparecer pronto ao abrir "Organizar com IA". O próprio plano do dia (lead_page_plans.dia)
 * evita repetir; a janela 08:00–08:20 dá folga pra tentar de novo se o servidor ou a IA falharem.
 */

const TZ = 'America/Sao_Paulo';
const HORA = 8;
const MIN_FIM = 20;
let rodando = false;

function spAgora(): { hora: number; minuto: number } {
  const p = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(new Date());
  const g = (t: string) => Number(p.find((x) => x.type === t)?.value ?? '0');
  return { hora: g('hour') % 24, minuto: g('minute') };
}

export function startDemandasAiDiario(): void {
  if (!process.env.ANTHROPIC_API_KEY) {
    console.log('[demandas-ia] sem ANTHROPIC_API_KEY — organização diária desligada');
    return;
  }
  setInterval(() => {
    const { hora, minuto } = spAgora();
    if (hora !== HORA || minuto >= MIN_FIM || rodando) return;
    rodando = true;
    gerarPlanosDoDia()
      .then((n) => { if (n) console.log(`[demandas-ia] ${n} plano(s) gerado(s)`); })
      .catch((err) => console.error('[demandas-ia] erro', err instanceof Error ? err.message : err))
      .finally(() => { rodando = false; });
  }, 60_000);
  console.log('[demandas-ia] organização diária das demandas ativa (08h, America/Sao_Paulo)');
}
