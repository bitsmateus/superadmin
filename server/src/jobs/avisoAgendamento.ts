import { query, queryOne } from '../db.js';
import {
  AVISO_DESDE, chaveDoAviso, montarAvisoAgendamento, quemAgendouAviso, SQL_AGENDADAS_DESDE, SQL_EM_REUNIAO_AGENDADA,
} from '../lib/avisoAgendamento.js';
import { sendToGroupWith } from '../lib/supportGroup.js';

/** Manda o "Agendou ✅" no grupo LEADS (regras em lib/avisoAgendamento.ts). `autor` = quem mexeu no card. */
export async function avisarAgendamentoNoGrupo(leadRowId: string, autor: string): Promise<void> {
  try {
    const r = await queryOne<{
      id: string; nome: string; empresa: string; telefone: string; numero_atendentes: string; agendamento: string;
      sdr: string; espelho_origem_id: string | null; copia_ia_origem_id: string | null;
    }>(
      `SELECT r.id, r.nome, r.empresa, r.telefone, r.numero_atendentes, r.agendamento, r.sdr,
              r.espelho_origem_id, r.copia_ia_origem_id
       FROM lead_rows r
       JOIN lead_boards lb ON lb.id = r.board_id
       JOIN lead_pages lp ON lp.id = lb.page
       WHERE r.id = $1 AND r.deleted_at IS NULL AND NOT lb.is_vendas AND lp.section = 'comercial'
         AND ${SQL_EM_REUNIAO_AGENDADA}`,
      [leadRowId]
    );
    if (!r) return;

    const row = await queryOne<{ leads_group: Record<string, unknown> | null }>('SELECT leads_group FROM settings WHERE id = true');
    const g = (row?.leads_group ?? {}) as Record<string, unknown>;
    const conexao = { apiId: String(g.apiId ?? ''), token: String(g.token ?? ''), baseUrl: String(g.baseUrl ?? '') };
    const grupo = String(g.groupId ?? '');
    if (!conexao.apiId || !conexao.token || !grupo) return;

    const chave = chaveDoAviso(r);
    const horario = (r.agendamento ?? '').slice(0, 16);
    const reservou = await query(
      `INSERT INTO agendamento_avisos (chave, agendamento) VALUES ($1, $2) ON CONFLICT DO NOTHING RETURNING chave`,
      [chave, horario]
    );
    if (!reservou.length) return;

    const texto = montarAvisoAgendamento({ ...r, quem: quemAgendouAviso(autor, r.sdr ?? '') });
    const res = await sendToGroupWith(conexao, grupo, texto, `agendou-${r.id}`);
    if (!res.ok) {
      console.error('[aviso-agendamento] falha ao enviar:', res.reason ?? res.status ?? res.detail);
      await query(`DELETE FROM agendamento_avisos WHERE chave = $1 AND agendamento = $2`, [chave, horario]);
    }
  } catch (err) {
    console.error('[aviso-agendamento] erro', err instanceof Error ? err.message : err);
  }
}

/**
 * Uma vez só (traffic_report_log): manda as reuniões agendadas desde AVISO_DESDE, de quando o aviso ainda não existia.
 * Uma por vez, com intervalo, na ordem em que foram marcadas. As que já saíram não repetem (agendamento_avisos).
 */
export async function avisarAgendamentosDaEstreia(): Promise<void> {
  try {
    const reservou = await query(
      `INSERT INTO traffic_report_log (dia, kind) VALUES ($1::date, 'aviso_agendamento_estreia') ON CONFLICT DO NOTHING RETURNING dia`,
      [AVISO_DESDE.slice(0, 10)]
    );
    if (!reservou.length) return;
    const agendadas = await query<{ id: string; autor: string; agendou_em: string }>(SQL_AGENDADAS_DESDE, [AVISO_DESDE]);
    agendadas.sort((a, b) => new Date(a.agendou_em).getTime() - new Date(b.agendou_em).getTime());
    for (const a of agendadas) {
      await avisarAgendamentoNoGrupo(a.id, a.autor);
      await new Promise((r) => setTimeout(r, 2000));
    }
    console.log(`[aviso-agendamento] estreia: ${agendadas.length} agendamento(s) desde ${AVISO_DESDE.slice(0, 10)} conferido(s)`);
  } catch (err) {
    console.error('[aviso-agendamento] erro na estreia', err instanceof Error ? err.message : err);
  }
}
