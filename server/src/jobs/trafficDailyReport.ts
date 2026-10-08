import { query } from '../db.js';
import { sendToSupportGroupId } from '../lib/supportGroup.js';
import { grupoTrafego } from '../lib/trafficAlerts.js';
import { brl, dataSp, rankingTrafego, totaisTrafego, type TotaisTrafego } from '../lib/trafegoMetricas.js';

/**
 * Relatório diário de tráfego no grupo (08h, America/Sao_Paulo) + resumo semanal às segundas.
 * Sem TRAFFIC_REPORT_GROUP_ID não envia nada. Cada relatório sai uma única vez por dia
 * (traffic_report_log), mesmo se o servidor reiniciar dentro da janela.
 */

const TZ = 'America/Sao_Paulo';
const HORA = 8;
const JANELA_MIN = 9;
const DIAS_SEMANA = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];
const MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];

function spAgora(): { dia: string; hora: number; minuto: number; semana: number } {
  const p = new Intl.DateTimeFormat('en-GB', {
    timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
    hour12: false, weekday: 'short',
  }).formatToParts(new Date());
  const g = (t: string) => p.find((x) => x.type === t)?.value ?? '0';
  const semana = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(g('weekday'));
  return { dia: `${g('year')}-${g('month')}-${g('day')}`, hora: Number(g('hour')) % 24, minuto: Number(g('minute')), semana };
}

async function reservar(dia: string, tipo: string): Promise<boolean> {
  const r = await query(
    `INSERT INTO traffic_report_log (dia, kind) VALUES ($1::date, $2) ON CONFLICT DO NOTHING RETURNING dia`, [dia, tipo]);
  return r.length > 0;
}

const linhaTotais = (t: TotaisTrafego) =>
  `Gasto ${brl(t.gasto)} · ${t.leads} leads · CPL ${brl(t.cpl)}\n` +
  `${t.agendadas} agend. · ${t.reunioes} reuniões · ${t.vendas} vendas` +
  (t.vendas > 0 ? ` · CAC ${brl(t.cac)}` : '') + (t.reunioes > 0 ? `\nCusto por reunião ${brl(t.custoReuniao)}` : '');

async function melhoresCriativos(desde: string, ate: string, n: number): Promise<string[]> {
  const ads = (await rankingTrafego('anuncio', desde, ate))
    .filter((a) => a.gasto >= 100 && a.reunioes >= 1 && a.custoReuniao != null)
    .sort((a, b) => (a.custoReuniao as number) - (b.custoReuniao as number))
    .slice(0, n);
  return ads.map((a) => {
    const ctr = a.impressoes > 0 ? ` · CTR ${((a.cliquesLink / a.impressoes) * 100).toFixed(1).replace('.', ',')}%` : '';
    return `${a.nome}\n${brl(a.custoReuniao)} por reunião${ctr}`;
  });
}

async function alertasAbertos(): Promise<string[]> {
  const rows = await query<{ level: string; message: string }>(
    `SELECT level, message FROM traffic_alerts WHERE resolved_at IS NULL AND level IN ('atencao','oportunidade')
     ORDER BY CASE level WHEN 'atencao' THEN 0 ELSE 1 END, created_at LIMIT 8`);
  return rows.map((r) => `${r.level === 'atencao' ? '⚠️' : '💡'} ${r.message}`);
}

export async function montarRelatorioDiario(): Promise<string> {
  const ontem = dataSp(1);
  const inicioMes = `${ontem.slice(0, 8)}01`;
  const [dia, mes] = [Number(ontem.slice(8)), Number(ontem.slice(5, 7))];
  const semana = DIAS_SEMANA[new Date(`${ontem}T12:00:00Z`).getUTCDay()];

  const [tOntem, tMes, melhores, alertas] = await Promise.all([
    totaisTrafego(ontem, ontem), totaisTrafego(inicioMes, ontem), melhoresCriativos(dataSp(7), ontem, 1), alertasAbertos(),
  ]);

  const partes = [
    `*Tráfego NX — ${semana}, ${String(dia).padStart(2, '0')}/${String(mes).padStart(2, '0')}*`,
    `*Ontem*\n${linhaTotais(tOntem)}`,
    `*Mês (${MESES[mes - 1]})*\n${linhaTotais(tMes)}`,
  ];
  if (melhores.length) partes.push(`*Melhor criativo (7 dias)*\n${melhores[0]}`);
  if (alertas.length) partes.push(`*Atenção*\n${alertas.join('\n')}`);
  return partes.join('\n\n');
}

export async function montarResumoSemanal(): Promise<string> {
  const fim = dataSp(1), ini = dataSp(7), fimAnt = dataSp(8), iniAnt = dataSp(14);
  const [atual, anterior, melhores] = await Promise.all([
    totaisTrafego(ini, fim), totaisTrafego(iniAnt, fimAnt), melhoresCriativos(ini, fim, 3),
  ]);
  const delta = (a: number | null, b: number | null) =>
    a == null || b == null || b === 0 ? '' : ` (${a >= b ? '+' : ''}${Math.round(((a - b) / b) * 100)}% vs semana anterior)`;
  const partes = [
    '*Tráfego NX — resumo da semana*',
    `*Últimos 7 dias*\n${linhaTotais(atual)}`,
    `*Comparação com a semana anterior*\nGasto ${brl(anterior.gasto)}${delta(atual.gasto, anterior.gasto)}\n` +
      `Leads ${anterior.leads}${delta(atual.leads, anterior.leads)}\nReuniões ${anterior.reunioes}${delta(atual.reunioes, anterior.reunioes)}`,
  ];
  if (melhores.length) partes.push(`*Melhores criativos*\n${melhores.map((m, i) => `${i + 1}. ${m}`).join('\n')}`);
  return partes.join('\n\n');
}

async function enviar(tipo: string, dia: string, montar: () => Promise<string>): Promise<void> {
  const grupo = grupoTrafego();
  if (!grupo) return;
  if (!(await reservar(dia, tipo))) return;
  try {
    const texto = await montar();
    const res = await sendToSupportGroupId(grupo, texto);
    if (!res.ok) {
      console.error(`[traffic-report] falha ao enviar ${tipo}:`, res.reason ?? res.status ?? res.detail);
      await query(`DELETE FROM traffic_report_log WHERE dia = $1::date AND kind = $2`, [dia, tipo]); // tenta de novo na janela
    }
  } catch (err) {
    console.error(`[traffic-report] erro em ${tipo}`, err instanceof Error ? err.message : err);
    await query(`DELETE FROM traffic_report_log WHERE dia = $1::date AND kind = $2`, [dia, tipo]);
  }
}

export function startTrafficDailyReport(): void {
  setInterval(() => {
    const { dia, hora, minuto, semana } = spAgora();
    if (hora !== HORA || minuto >= JANELA_MIN) return;
    void enviar('diario', dia, montarRelatorioDiario);
    if (semana === 1) void enviar('semanal', dia, montarResumoSemanal);
  }, 60_000);
  console.log('[traffic-report] relatório diário de tráfego ativo (08h, America/Sao_Paulo; sem TRAFFIC_REPORT_GROUP_ID não envia)');
}
