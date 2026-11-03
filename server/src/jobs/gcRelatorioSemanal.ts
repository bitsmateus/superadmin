import { query, queryOne } from '../db.js';
import { metricasDoMesDeTodos } from '../lib/gcTrafego.js';

/**
 * Toda segunda a partir das 08h (America/Sao_Paulo) — depois da coleta das 07h do Meta: grava nas
 * Métricas e relatórios de cada cliente com conta do Meta os números do mês vindos da aba Tráfego, e
 * abre o rascunho do relatório do mês. Na primeira segunda do mês faz também o mês anterior, pra
 * fechar os últimos dias dele. Publicar continua sendo da equipe (o comentário do gestor é obrigatório).
 *
 * Mesmo esquema do comunicadosSemanal.ts: vale a segunda inteira depois das 08h (servidor fora às 08h
 * roda quando voltar), e gc_relatorio_semanal (uma linha por semana) impede de repetir.
 */

const TZ = 'America/Sao_Paulo';
const HORA = 8;
let rodando = false;

function spAgora(): { diaSemana: string; hora: number; data: string } {
  const p = new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ, weekday: 'short', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hour12: false,
  }).formatToParts(new Date());
  const g = (t: string) => p.find((x) => x.type === t)?.value ?? '';
  return { diaSemana: g('weekday'), hora: Number(g('hour')) % 24, data: `${g('year')}-${g('month')}-${g('day')}` };
}

export async function rodarRelatorioSemanal(dataHoje: string): Promise<void> {
  if (rodando) return;
  rodando = true;
  try {
    await query(`CREATE TABLE IF NOT EXISTS gc_relatorio_semanal (semana DATE PRIMARY KEY, rodado_em TIMESTAMPTZ NOT NULL DEFAULT NOW())`);
    const trava = await queryOne(
      `INSERT INTO gc_relatorio_semanal (semana) VALUES (date_trunc('week', $1::date)) ON CONFLICT DO NOTHING RETURNING semana`,
      [dataHoje],
    );
    if (!trava) return;
    const mes = dataHoje.slice(0, 7);
    const meses = [mes];
    if (Number(dataHoje.slice(8, 10)) <= 7) {
      const [a, m] = mes.split('-').map(Number);
      const d = new Date(a, m - 2, 1);
      meses.unshift(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
    }
    for (const periodo of meses) {
      const r = await metricasDoMesDeTodos(periodo);
      console.log(`[gc-relatorio] ${periodo}: ${r.clientes} cliente(s) atualizado(s) do tráfego, ${r.erros} erro(s)`);
    }
  } catch (err) {
    console.error('[gc-relatorio] erro', err instanceof Error ? err.message : err);
  } finally {
    rodando = false;
  }
}

export function startGcRelatorioSemanal(): void {
  setInterval(() => {
    const { diaSemana, hora, data } = spAgora();
    if (diaSemana !== 'Mon' || hora < HORA) return;
    void rodarRelatorioSemanal(data);
  }, 5 * 60_000);
  console.log('[gc-relatorio] métricas do tráfego nos relatórios: toda segunda a partir das 08h');
}
