import { query, queryOne } from '../db.js';

/**
 * Campos do card que entram na Linha do tempo quando mudam ("de → para", quem e quando), além dos que já entravam
 * (status, coluna, dia de contato, SDR, retornado). Vale pra tela e pra API do n8n. O nome do campo é o tipo do
 * evento (lead_events.type); o front traduz o rótulo e formata o valor (data, origem…).
 */
export const CAMPOS_DA_LINHA_DO_TEMPO = [
  'agendamento', 'retornar', 'valor_mrr', 'valor_implementacao', 'numero_atendentes', 'origem', 'nicho',
  'motivo_desqualificacao', 'agendado_por', 'nome', 'empresa', 'telefone', 'dor_cliente', 'tipo', 'ligacao',
  'followup', 'disparo', 'closer',
] as const;
const CAMPOS = new Set<string>(CAMPOS_DA_LINHA_DO_TEMPO);
export const ehCampoDaLinhaDoTempo = (campo: string) => CAMPOS.has(campo);

/** Mudanças seguidas do mesmo campo, pela mesma pessoa, nessa janela viram um item só (ex.: digitar um valor aos poucos). */
const JANELA_DE_JUNTAR = "INTERVAL '2 minutes'";

const texto = (v: unknown) => (v === null || v === undefined ? '' : String(v)).trim();

/**
 * Registra a mudança de um campo na Linha do tempo da lead (passe o id da ORIGINAL: é a linha do tempo que a original
 * e as cópias mostram). Se a mesma pessoa mexeu no mesmo campo há menos de 2 min, atualiza aquele item em vez de
 * criar outro — e se voltou ao valor de antes, apaga o item. Nunca lança.
 */
export async function registrarMudancaDeCampo(
  leadRowId: string, campo: string, de: unknown, para: unknown, ator: string,
): Promise<void> {
  try {
    const antes = texto(de);
    const depois = texto(para);
    if (antes === depois) return;
    const recente = await queryOne<{ id: string; from_value: string | null }>(
      `SELECT id, from_value FROM lead_events
       WHERE lead_row_id = $1 AND type = $2 AND actor_name = $3 AND created_at > NOW() - ${JANELA_DE_JUNTAR}
       ORDER BY created_at DESC LIMIT 1`,
      [leadRowId, campo, ator]
    );
    if (recente) {
      if ((recente.from_value ?? '') === depois) {
        await query('DELETE FROM lead_events WHERE id = $1', [recente.id]);
      } else {
        await query('UPDATE lead_events SET to_value = $2, created_at = NOW() WHERE id = $1', [recente.id, depois || null]);
      }
      return;
    }
    await query(
      `INSERT INTO lead_events (lead_row_id, type, from_value, to_value, actor_name) VALUES ($1,$2,$3,$4,$5)`,
      [leadRowId, campo, antes || null, depois || null, ator]
    );
  } catch (err) {
    console.error('[linha do tempo] falha ao registrar', campo, leadRowId, err);
  }
}
