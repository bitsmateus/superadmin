import { avaliarAlertasClientes, sincronizarTodasAsContas } from '../lib/gcTrafego.js';
import { sincronizarTodosInstagrams } from '../lib/gcInstagram.js';
import { analisesDiarias } from '../lib/gcIa.js';

/**
 * Coleta do Meta dos clientes NX Digital (contas em gc_trafego_contas).
 * - Ao subir o servidor e às 07h, 11h, 15h e 19h (São Paulo): regrava os últimos 7 dias de cada
 *   conta (conta nova puxa 90 dias de histórico) e roda as regras de alerta do painel.
 * - Instagram dos clientes: ao subir e às 07h (os posts não mudam tanto ao longo do dia).
 * - 08h: análise de tráfego da IA pra quem gastou na semana (sem ANTHROPIC_API_KEY, não roda).
 * Sem nenhuma conta cadastrada, cada rodada termina sem chamar a Meta.
 */

const TZ = 'America/Sao_Paulo';
const HORAS = [7, 11, 15, 19];
const HORA_IA = 8;
const JANELA_MIN = 9;

function spAgora(): { dia: string; hora: number; minuto: number } {
  const p = new Intl.DateTimeFormat('en-GB', {
    timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(new Date());
  const g = (t: string) => p.find((x) => x.type === t)?.value ?? '0';
  return { dia: `${g('year')}-${g('month')}-${g('day')}`, hora: Number(g('hour')) % 24, minuto: Number(g('minute')) };
}

let rodando = false;

export async function rodarGcTrafego(comInstagram = false): Promise<void> {
  if (rodando) return;
  rodando = true;
  try {
    if (comInstagram) {
      const ig = await sincronizarTodosInstagrams();
      if (ig.contas) console.log(`[gc-trafego] instagram: ${ig.contas} perfil(is), ${ig.erros} com erro`);
    }
    const s = await sincronizarTodasAsContas();
    if (s.contas === 0) return;
    const a = await avaliarAlertasClientes();
    console.log(`[gc-trafego] ${s.contas} conta(s), ${s.erros} com erro; alertas: ${a.novos} novo(s), ${a.resolvidos} resolvido(s)`);
  } catch (err) {
    console.error('[gc-trafego] erro', err instanceof Error ? err.message : err);
  } finally {
    rodando = false;
  }
}

export function startGcTrafegoSync(): void {
  setTimeout(() => void rodarGcTrafego(true), 90_000);
  let ultimoSlot = '';
  setInterval(() => {
    const { dia, hora, minuto } = spAgora();
    if ((!HORAS.includes(hora) && hora !== HORA_IA) || minuto >= JANELA_MIN) return;
    const slot = `${dia}-${hora}`;
    if (slot === ultimoSlot) return;
    ultimoSlot = slot;
    if (hora === HORA_IA) {
      void analisesDiarias()
        .then((r) => { if (r.geradas || r.erros) console.log(`[gc-ia] análises do dia: ${r.geradas} gerada(s), ${r.erros} erro(s)`); })
        .catch((err) => console.error('[gc-ia] erro', err instanceof Error ? err.message : err));
      return;
    }
    void rodarGcTrafego(hora === 7);
  }, 60_000);
  console.log('[gc-trafego] coleta do Meta dos clientes NX ativa (07h, 11h, 15h, 19h; IA às 08h)');
}
