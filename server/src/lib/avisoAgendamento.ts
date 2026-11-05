import { chaveTelefone } from './integracaoCards.js';
import { quemAgendou } from './resumoAgendamentos.js';

/**
 * Texto do aviso "Agendou ✅" no grupo LEADS do WhatsApp quando uma lead entra em "Reunião agendada" (Arthur, Luis, IA Luiza ou
 * quem for, em qualquer aba do comercial). Sai pela mesma conexão do resumo das 19h (settings.leads_group); sem ela, não
 * envia nada.
 *
 * Um aviso por lead e horário marcado (agendamento_avisos): a mesma lead tem linhas em mais de uma aba (a original, a
 * cópia do closer, a da IA), e mexer de novo no status não pode repetir a mensagem. Reagendar pra outro horário avisa
 * de novo. Nunca lança: falhar aqui não desfaz a mudança do card.
 */

const SEM_INFO = 'Sem informação';
const DIAS_SEMANA = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];

export interface DadosDoAviso {
  nome: string;
  empresa: string;
  telefone: string;
  numero_atendentes: string;
  agendamento: string;
  /** Quem agendou, já no formato do resumo ("SDR Arthur", "IA Luiza"…). */
  quem: string;
}

/** "5531981083381" → "+55 (31) 98108-3381". Sem DDI, assume Brasil. */
export function telefoneDoAviso(raw: string): string {
  let d = (raw ?? '').replace(/\D/g, '');
  if (!d) return SEM_INFO;
  if (d.length === 10 || d.length === 11) d = `55${d}`;
  const br = /^55(\d{2})(\d{4,5})(\d{4})$/.exec(d);
  return br ? `+55 (${br[1]}) ${br[2]}-${br[3]}` : `+${d}`;
}

/** "2026-11-06T14:00" → "quinta, 06/11 às 14:00". */
export function dataDoAviso(agendamento: string): string {
  const v = (agendamento ?? '').trim();
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?/.exec(v);
  if (!m) return v || SEM_INFO;
  const semana = DIAS_SEMANA[new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])).getUTCDay()];
  return `${semana}, ${m[3]}/${m[2]}${m[4] ? ` às ${m[4]}:${m[5]}` : ''}`;
}

/** Nº de atendentes é texto livre: "7" vira "7 atendentes"; "4 a 10 atendentes" fica como está. */
function atendentesDoAviso(v: string): string {
  const t = (v ?? '').trim();
  if (!t) return SEM_INFO;
  return /^\d+(\s*(a|-|até)\s*\d+)?$/i.test(t) ? `${t} atendentes` : t;
}

export function montarAvisoAgendamento(d: DadosDoAviso): string {
  const ou = (v: string) => v.trim() || SEM_INFO;
  return [
    '✅ *Agendou!*',
    '',
    `👤 *Nome:* ${ou(d.nome)}`,
    `🏢 *Empresa:* ${ou(d.empresa)}`,
    `📞 *Telefone:* ${telefoneDoAviso(d.telefone)}`,
    `👥 *Qtd. usuários:* ${atendentesDoAviso(d.numero_atendentes)}`,
    `📅 *Data:* ${dataDoAviso(d.agendamento)}`,
    `🙋 *Quem agendou:* ${ou(d.quem)}`,
  ].join('\n');
}

/** Quem agendou: a IA quando o SDR é a Luiza; senão quem mexeu no card, ou o SDR quando foi a automação. */
export function quemAgendouAviso(autor: string, sdr: string): string {
  const q = quemAgendou({ autor: /automa/i.test(autor) ? '' : autor, sdr, canal: '' });
  return q === 'Não informado' && sdr.trim() ? sdr.trim() : q;
}

/** A mesma lead em qualquer aba: pelo telefone; sem telefone, pela linha original. */
export function chaveDoAviso(r: { id: string; telefone: string; espelho_origem_id: string | null; copia_ia_origem_id: string | null }): string {
  return chaveTelefone(r.telefone)?.ultimos8 ?? r.espelho_origem_id ?? r.copia_ia_origem_id ?? r.id;
}

/** Condição SQL de "está em Reunião agendada" (r = lead_rows, lb = lead_boards), a mesma do espelho do closer. */
export const SQL_EM_REUNIAO_AGENDADA = `(r.status = 'Reunião agendada' OR lower(lb.name) LIKE '%agendada%')`;

/**
 * Estreia do aviso: as reuniões agendadas desde AVISO_DESDE (dia em que o aviso entrou, antes de ele existir) saem uma
 * vez no grupo, na ordem em que foram marcadas. Só a lead original (sem a cópia do closer, da IA e de Vendas), pela 1ª
 * ida pra "Reunião agendada" na linha do tempo, como o resumo das 19h. $1 = AVISO_DESDE.
 */
export const AVISO_DESDE = '2026-11-05T03:00:00.000Z';
export const SQL_AGENDADAS_DESDE = `
  SELECT DISTINCT ON (r.id) r.id, r.telefone, r.espelho_origem_id, r.copia_ia_origem_id,
         COALESCE(le.actor_name, '') AS autor, le.created_at AS agendou_em
  FROM lead_events le
  JOIN lead_rows r ON r.id = le.lead_row_id
  JOIN lead_boards lb ON lb.id = r.board_id
  WHERE le.type = 'status' AND le.to_value = 'Reunião agendada' AND le.created_at >= $1::timestamptz
    AND r.deleted_at IS NULL AND NOT lb.is_vendas
    AND r.espelho_origem_id IS NULL AND r.copia_ia_origem_id IS NULL AND r.venda_origem_id IS NULL
  ORDER BY r.id, le.created_at`;
