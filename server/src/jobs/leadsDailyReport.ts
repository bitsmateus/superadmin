import { query, queryOne } from '../db.js';
import { POS_REUNIAO_STATUSES, REUNIAO_STATUSES } from '../routes/leadBoards.js';
import { montarResumoAgendamentos, type AgendamentoDoDia } from '../lib/resumoAgendamentos.js';
import { sendToGroupWith } from '../lib/supportGroup.js';

/**
 * Resumo diário de agendamentos no grupo LEADS do WhatsApp (19h, America/Sao_Paulo): total de A.G, quem agendou e
 * por qual canal. Sai pela MESMA conexão que já avisa "Novo lead" no grupo (settings.leads_group: apiId, token,
 * groupId) — sem ela configurada, não envia nada. Um envio por dia (traffic_report_log), mesmo se o servidor
 * reiniciar dentro da janela.
 */

const TZ = 'America/Sao_Paulo';
const HORA = 19;
const JANELA_MIN = 9;
const KIND = 'leads_agendamentos';

function spAgora(): { dia: string; hora: number; minuto: number } {
  const p = new Intl.DateTimeFormat('en-GB', {
    timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(new Date());
  const g = (t: string) => p.find((x) => x.type === t)?.value ?? '0';
  return { dia: `${g('year')}-${g('month')}-${g('day')}`, hora: Number(g('hour')) % 24, minuto: Number(g('minute')) };
}

/**
 * Os agendamentos do dia: leads cuja PRIMEIRA ida pra "Reunião agendada" foi nesse dia e que seguem no funil (mesma
 * regra do "Agendamentos por canal" das métricas). Só a lead original — sem a cópia do closer, a da IA e a de Vendas.
 */
export async function agendamentosDoDia(dia: string): Promise<AgendamentoDoDia[]> {
  return query<AgendamentoDoDia>(
    `SELECT COALESCE(pa.actor_name, '') AS autor, lr.sdr, lr.agendado_por AS canal
     FROM lead_rows lr
     JOIN lead_boards lb ON lb.id = lr.board_id
     JOIN LATERAL (
       SELECT le.actor_name, le.created_at FROM lead_events le
       WHERE le.lead_row_id = lr.id AND le.type = 'status' AND le.to_value = $1
       ORDER BY le.created_at ASC LIMIT 1
     ) pa ON true
     WHERE lb.is_vendas = false AND lr.deleted_at IS NULL
       AND lr.espelho_origem_id IS NULL AND lr.copia_ia_origem_id IS NULL AND lr.venda_origem_id IS NULL
       AND (lr.status = ANY($2) OR lr.status = ANY($3) OR lr.status = 'Perdidos')
       AND (pa.created_at AT TIME ZONE '${TZ}')::date = $4::date`,
    [REUNIAO_STATUSES[0], REUNIAO_STATUSES, POS_REUNIAO_STATUSES, dia]
  );
}

export async function montarResumoDoDia(dia: string): Promise<string> {
  return montarResumoAgendamentos(dia, await agendamentosDoDia(dia));
}

async function enviar(dia: string): Promise<void> {
  const row = await queryOne<{ leads_group: Record<string, unknown> | null }>('SELECT leads_group FROM settings WHERE id = true');
  const g = (row?.leads_group ?? {}) as Record<string, unknown>;
  const conexao = { apiId: String(g.apiId ?? ''), token: String(g.token ?? ''), baseUrl: String(g.baseUrl ?? '') };
  const grupo = String(g.groupId ?? '');
  if (!conexao.apiId || !conexao.token || !grupo) return;

  const reservou = await query(
    `INSERT INTO traffic_report_log (dia, kind) VALUES ($1::date, $2) ON CONFLICT DO NOTHING RETURNING dia`, [dia, KIND]);
  if (!reservou.length) return;
  try {
    const res = await sendToGroupWith(conexao, grupo, await montarResumoDoDia(dia), `resumo-ag-${dia}`);
    if (!res.ok) {
      console.error('[leads-report] falha ao enviar:', res.reason ?? res.status ?? res.detail);
      await query(`DELETE FROM traffic_report_log WHERE dia = $1::date AND kind = $2`, [dia, KIND]); // tenta de novo na janela
    }
  } catch (err) {
    console.error('[leads-report] erro', err instanceof Error ? err.message : err);
    await query(`DELETE FROM traffic_report_log WHERE dia = $1::date AND kind = $2`, [dia, KIND]);
  }
}

export function startLeadsDailyReport(): void {
  setInterval(() => {
    const { dia, hora, minuto } = spAgora();
    if (hora !== HORA || minuto >= JANELA_MIN) return;
    void enviar(dia);
  }, 60_000);
  console.log('[leads-report] resumo de agendamentos no grupo LEADS ativo (19h, America/Sao_Paulo; sem settings.leads_group não envia)');
}
