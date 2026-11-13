import { pool, query, queryOne } from '../db.js';
import { chaveTelefone } from './integracaoCards.js';
import { logLeadEvent, sincronizarContagemNotas, statusDoQuadro } from '../routes/leadBoards.js';

/**
 * Acerto dos leads de Tubarão (pedido de 13/11, conferido em /admin/tubarao e confirmado pelo Ian). UMA VEZ SÓ, na
 * subida (reserva em traffic_report_log). Cada lead fica com um card só, no CRM TUBARAO; o card que já existe é
 * MOVIDO (não se cria outro), mantendo atualizações, etiquetas, agendamento e o dia em que entrou na coluna (a régua
 * não recomeça). A cópia do CRM LUIS CLOSER fica.
 *
 *  - Rodolfo (…99766500): fica o card do CRM TUBARAO (id 57c1fa61…). Os 2 do CRM IA LUIZA — o duplicado (f32e833c…)
 *    e a cópia automática da IA (6a293fe1…) — vão pra lixeira; as atualizações do duplicado passam pro card que fica;
 *    a cópia do closer passa a apontar pro card do Tubarão.
 *  - Fabi/Fabiana (…99184471, id 3ca2b291…): CRM IA LUIZA "Qualificado" -> CRM TUBARAO "Primeiro contato", SDR IA Luiza.
 *  - Luiz Carlos - Tesba (…88248302, id de444eba…): CRM ARTHUR "Disparo em massa" -> CRM TUBARAO "Disparo em massa",
 *    SDR Arthur.
 *  - Patrícia Rechia: já está certa (nada muda).
 *
 * Trava de segurança: cada passo só roda se achar exatamente os cards do print (telefone + começo do id). Achou
 * diferente = não mexe naquele lead e avisa no log.
 */
const TUBARAO = 'crm-outbound';
const AUTOR = 'Sistema (acerto CRM TUBARAO)';

type Card = { id: string; page: string; board: string; espelho_origem_id: string | null; copia_ia_origem_id: string | null; entrou_coluna_em: string | null };

async function cardsDoTelefone(telefone: string): Promise<Card[]> {
  const ultimos8 = chaveTelefone(telefone)!.ultimos8;
  return query<Card>(
    `SELECT r.id, lb.page, lb.name AS board, r.espelho_origem_id, r.copia_ia_origem_id, r.entrou_coluna_em
     FROM lead_rows r JOIN lead_boards lb ON lb.id = r.board_id
     WHERE r.deleted_at IS NULL AND lb.is_vendas = false
       AND right(regexp_replace(r.telefone, '\\D', '', 'g'), 8) = $1`,
    [ultimos8]
  );
}

async function nota(id: string, texto: string) {
  await query(
    `INSERT INTO lead_notes (lead_row_id, author_id, author_name, content, attachments) VALUES ($1, NULL, $2, $3, '[]')`,
    [id, AUTOR, `<p>${texto}</p>`]
  );
  await sincronizarContagemNotas(id);
}

/** Move o card pro quadro `coluna` do CRM TUBARAO sem perder o "entrou na coluna em" (a régua não recomeça). */
async function moverProTubarao(card: Card, coluna: string): Promise<boolean> {
  const destino = await queryOne<{ id: string; name: string }>(
    `SELECT id, name FROM lead_boards WHERE page = $1 AND lower(name) = lower($2) LIMIT 1`, [TUBARAO, coluna]
  );
  if (!destino) { console.warn(`[acerto-tubarao] coluna "${coluna}" não existe no CRM TUBARAO — card ${card.id} não foi movido`); return false; }
  const status = (await statusDoQuadro(destino.id)) ?? destino.name;
  const [{ max }] = await query<{ max: number | null }>('SELECT MAX(position) AS max FROM lead_rows WHERE board_id = $1', [destino.id]);
  await query('UPDATE lead_rows SET board_id = $2, status = $3, position = $4 WHERE id = $1', [card.id, destino.id, status, (max ?? -1) + 1]);
  // O gatilho de troca de coluna marca "agora"; volta pro dia em que ele entrou na coluna de antes.
  await query('UPDATE lead_rows SET entrou_coluna_em = $2 WHERE id = $1', [card.id, card.entrou_coluna_em]);
  await logLeadEvent(card.id, 'board', card.board, destino.name, AUTOR).catch(() => undefined);
  await nota(card.id, `Card movido do ${card.page === 'crm-ia-luiza' ? 'CRM IA LUIZA' : card.page === 'crm-arthur' ? 'CRM ARTHUR' : card.page} / ${card.board} para o CRM TUBARAO / ${destino.name} (acerto dos leads de Tubarão, 13/11).`);
  return true;
}

async function acertarRodolfo() {
  const cards = await cardsDoTelefone('5548999766500');
  const fica = cards.filter((c) => c.page === TUBARAO && c.id.startsWith('57c1fa61') && !c.espelho_origem_id && !c.copia_ia_origem_id);
  const saem = cards.filter((c) => c.page === 'crm-ia-luiza' && (c.id.startsWith('f32e833c') || c.id.startsWith('6a293fe1')));
  if (fica.length !== 1 || saem.length !== 2) {
    console.warn(`[acerto-tubarao] Rodolfo: esperava 1 card no Tubarão e 2 no CRM IA LUIZA, achei ${fica.length} e ${saem.length} — não mexi`);
    return;
  }
  const k = fica[0].id;
  const ids = saem.map((c) => c.id);
  // As atualizações dos que saem passam pro card que fica (a cópia da IA não tem histórico próprio).
  const { rowCount } = await pool.query('UPDATE lead_notes SET lead_row_id = $1 WHERE lead_row_id = ANY($2)', [k, ids]);
  // A cópia do closer (e qualquer outra) que apontava pros que saem passa a apontar pro que fica.
  await query('UPDATE lead_rows SET espelho_origem_id = $1 WHERE espelho_origem_id = ANY($2) AND deleted_at IS NULL', [k, ids]);
  await query(
    `UPDATE lead_rows SET espelho_origens_extras = ARRAY(SELECT x FROM unnest(espelho_origens_extras) x WHERE NOT (x = ANY($1)))
     WHERE espelho_origens_extras && $1::uuid[]`,
    [ids]
  );
  await query('UPDATE lead_rows SET copia_ia_origem_id = NULL WHERE copia_ia_origem_id = ANY($1) AND deleted_at IS NULL', [ids]);
  await query('UPDATE lead_rows SET deleted_at = NOW() WHERE id = ANY($1)', [ids]);
  for (const id of ids) await logLeadEvent(id, 'excluido', null, 'Duplicado do card do CRM TUBARAO (acerto de 13/11)', AUTOR).catch(() => undefined);
  await nota(k, `Acerto dos leads de Tubarão (13/11): os cards duplicados do CRM IA LUIZA foram pra lixeira e as atualizações deles (${rowCount ?? 0}) vieram pra este card.`);
  console.log(`[acerto-tubarao] Rodolfo: fica ${k}; lixeira ${ids.join(', ')}; ${rowCount ?? 0} atualização(ões) movida(s)`);
}

async function acertarUm(rotulo: string, telefone: string, prefixo: string, pagina: string, coluna: string) {
  const cards = await cardsDoTelefone(telefone);
  const alvo = cards.filter((c) => c.id.startsWith(prefixo) && c.page === pagina && !c.espelho_origem_id && !c.copia_ia_origem_id);
  if (alvo.length !== 1) {
    console.warn(`[acerto-tubarao] ${rotulo}: não achei o card ${prefixo}… em ${pagina} — não mexi`);
    return;
  }
  const ok = await moverProTubarao(alvo[0], coluna);
  if (ok) console.log(`[acerto-tubarao] ${rotulo}: ${alvo[0].id} -> CRM TUBARAO / ${coluna}`);
}

export async function acertarLeadsTubarao(): Promise<void> {
  const { rows } = await pool.query(
    `INSERT INTO traffic_report_log (dia, kind) VALUES ('2026-11-13'::date, 'acerto_leads_tubarao') ON CONFLICT DO NOTHING RETURNING dia`
  );
  if (!rows.length) return;
  const tubarao = await queryOne('SELECT 1 FROM lead_pages WHERE id = $1', [TUBARAO]);
  if (!tubarao) { console.warn('[acerto-tubarao] CRM TUBARAO não existe — nada feito'); return; }
  for (const [rotulo, passo] of [
    ['Rodolfo', () => acertarRodolfo()],
    ['Fabi', () => acertarUm('Fabi/Fabiana', '5548999184471', '3ca2b291', 'crm-ia-luiza', 'Primeiro contato')],
    ['Luiz Tesba', () => acertarUm('Luiz Carlos - Tesba', '5548988248302', 'de444eba', 'crm-arthur', 'Disparo em massa')],
  ] as const) {
    try { await passo(); } catch (err) { console.error(`[acerto-tubarao] erro no ${rotulo}`, err); }
  }
}
