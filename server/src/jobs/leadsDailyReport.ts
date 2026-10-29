import { query, queryOne } from '../db.js';
import { POS_REUNIAO_STATUSES, REUNIAO_STATUSES } from '../routes/leadBoards.js';
import {
  blocoReunioes, blocoRetornos, montarResumoAgendamentos,
  type AgendamentoDoDia, type RetornosDoDia,
} from '../lib/resumoAgendamentos.js';
import { PAGINA_DO_CLOSER, ROTULO_ADIADO, ROTULO_RETORNOU, ROTULO_SEM_RESPOSTA } from '../lib/retornoProposta.js';
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

/**
 * Retornos de proposta do dia: o que o closer registrou no popup (evento "retorno" na Linha do
 * tempo) e o que venceu sem registro nenhum. O rótulo do evento é a fonte — é o mesmo texto que
 * contarHistorico já lê, então não inventamos um campo novo só pro relatório.
 */
export async function retornosDoDia(dia: string): Promise<RetornosDoDia> {
  const eventos = await query<{ rotulo: string }>(
    `SELECT le.to_value AS rotulo
     FROM lead_events le
     WHERE le.type = 'retorno'
       AND (le.created_at AT TIME ZONE '${TZ}')::date = $1::date`,
    [dia]
  );
  let retornou = 0, semResposta = 0, adiado = 0;
  for (const e of eventos) {
    const r = e.rotulo ?? '';
    if (r.startsWith(ROTULO_RETORNOU)) retornou++;
    else if (r.startsWith(ROTULO_SEM_RESPOSTA)) semResposta++;
    else if (r.startsWith(ROTULO_ADIADO)) adiado++;
    // "Em reunião" é adiamento técnico de 1h, não é desfecho — fica de fora da conta.
  }

  // Venceu HOJE e continua sem registro. De propósito só o dia do relatório: arrastar o atrasado
  // de semanas atrás repetiria os mesmos nomes todo dia até o grupo parar de ler. O acúmulo
  // antigo continua cobrado onde é o lugar dele — o popup do closer, que não deixa passar.
  const faltou = await query<{ nome: string }>(
    `SELECT COALESCE(NULLIF(r.empresa, ''), NULLIF(r.nome, ''), 'Sem nome') AS nome
     FROM lead_rows r
     JOIN lead_boards lb ON lb.id = r.board_id
     JOIN lead_pages lp ON lp.id = lb.page
     WHERE lp.id = $1 AND r.deleted_at IS NULL AND lp.archived_at IS NULL
       AND NOT COALESCE(r.retornado, false)
       AND r.retornar ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}'
       AND left(r.retornar, 10) = $2
     ORDER BY r.retornar`,
    [PAGINA_DO_CLOSER, dia]
  );
  return { retornou, semResposta, adiado, faltou: faltou.map((f) => f.nome) };
}

/**
 * As reuniões MARCADAS pro dia e no que deram.
 *
 * Parte do "Agendamento" do card (a reunião daquele dia), não da data em que alguém mexeu no
 * status — senão um no-show de ontem registrado hoje entraria no relatório de hoje.
 *
 * O desfecho vem do status atual: continua "Reunião agendada" = ainda não resolveram; virou
 * "Reunião não comparecida" = no-show; qualquer outro status = a reunião aconteceu e o lead
 * andou (Proposta Enviada, Vendido, Perdidos, e também os status próprios de cada quadro).
 * Ler assim, por exclusão, evita depender do popup de resultado — que o time usa pouco: no dia
 * 27 o popup registrou 1 no-show enquanto o status mostrava 3.
 */
export async function reunioesDoDia(dia: string): Promise<{ compareceu: string[]; noShow: string[]; pendentes: number }> {
  const rows = await query<{ nome: string; status: string }>(
    `SELECT COALESCE(NULLIF(lr.empresa, ''), NULLIF(lr.nome, ''), 'Sem nome') AS nome, lr.status
     FROM lead_rows lr
     JOIN lead_boards lb ON lb.id = lr.board_id
     WHERE lb.is_vendas = false AND lr.deleted_at IS NULL
       AND lr.espelho_origem_id IS NULL AND lr.copia_ia_origem_id IS NULL AND lr.venda_origem_id IS NULL
       AND left(lr.agendamento, 10) = $1
     ORDER BY lr.agendamento`,
    [dia]
  );
  const compareceu: string[] = [];
  const noShow: string[] = [];
  let pendentes = 0;
  for (const r of rows) {
    if (r.status === REUNIAO_STATUSES[1]) noShow.push(r.nome);
    else if (r.status === REUNIAO_STATUSES[0]) pendentes++;
    else compareceu.push(r.nome);
  }
  return { compareceu, noShow, pendentes };
}

export async function montarResumoDoDia(dia: string): Promise<string> {
  const [agendamentos, retornos, reunioes] = await Promise.all([
    agendamentosDoDia(dia), retornosDoDia(dia), reunioesDoDia(dia),
  ]);
  return [
    montarResumoAgendamentos(dia, agendamentos),
    ...blocoReunioes(reunioes),
    ...blocoRetornos(retornos),
  ].join('\n');
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
