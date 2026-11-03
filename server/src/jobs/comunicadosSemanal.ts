import { queryOne, withTransaction } from '../db.js';
import { statusDoQuadro } from '../routes/leadBoards.js';

/**
 * Toda quarta a partir das 09h (America/Sao_Paulo): cria um card nas Demandas do Mateus lembrando de
 * publicar as atualizações da semana e fazer o disparo pelo menu Comunicados. Mesmo esquema de
 * setInterval + janela de horário do demandasAiDiario.ts; o que impede de repetir é comunicado_lembretes
 * (uma linha por semana). Vale a quarta inteira depois das 09h — se o servidor estava fora às 09h,
 * o card sai quando ele voltar.
 *
 * A aba é a crm-mateus (ou a da env COMUNICADOS_DEMANDAS_PAGE); sem ela, a chamada "Mateus" ou a que tem
 * "mateus" no responsável.
 */

const TZ = 'America/Sao_Paulo';
const HORA = 9;
let rodando = false;

function spAgora(): { diaSemana: string; hora: number; data: string } {
  const p = new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ, weekday: 'short', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hour12: false,
  }).formatToParts(new Date());
  const g = (t: string) => p.find((x) => x.type === t)?.value ?? '';
  return { diaSemana: g('weekday'), hora: Number(g('hour')) % 24, data: `${g('year')}-${g('month')}-${g('day')}` };
}

async function criarLembrete(dataHoje: string): Promise<boolean> {
  const { semana } = (await queryOne<{ semana: string }>(
    `SELECT to_char(date_trunc('week', $1::date), 'YYYY-MM-DD') AS semana`, [dataHoje],
  ))!;
  if (await queryOne('SELECT 1 FROM comunicado_lembretes WHERE semana = $1', [semana])) return false;

  // A aba "Mateus" das Demandas tem o id crm-mateus (/demandas/crm-mateus). Se ela sumir ou mudar de id, cai
  // na aba chamada "Mateus" e, por último, na que tem "mateus" no responsável.
  const pageId = (process.env.COMUNICADOS_DEMANDAS_PAGE || 'crm-mateus').trim();
  const pagina = await queryOne<{ id: string }>(
    `SELECT id FROM lead_pages
     WHERE section = 'demandas' AND archived_at IS NULL
       AND (id = $1 OR lower(trim(name)) = 'mateus' OR responsavel ILIKE '%mateus%')
     ORDER BY (id = $1) DESC, (lower(trim(name)) = 'mateus') DESC, position LIMIT 1`,
    [pageId],
  );
  if (!pagina) {
    console.warn('[comunicados] aba de Demandas do Mateus não encontrada — lembrete semanal não criado');
    return false;
  }
  const quadro = await queryOne<{ id: string }>(
    `SELECT id FROM lead_boards WHERE page = $1 AND NOT is_vendas AND NOT is_contrato ORDER BY position LIMIT 1`, [pagina.id],
  );
  if (!quadro) return false;
  const status = (await statusDoQuadro(quadro.id)) ?? '';

  await withTransaction(async (client) => {
    await client.query(`SELECT set_config('app.actor', 'automação', true)`);
    // Trava a semana: dois servidores (ou dois ticks) não criam dois cards.
    const { rowCount } = await client.query(
      'INSERT INTO comunicado_lembretes (semana) VALUES ($1) ON CONFLICT DO NOTHING', [semana],
    );
    if (!rowCount) return;
    const { rows: [{ max }] } = await client.query<{ max: number | null }>(
      'SELECT MAX(position) AS max FROM lead_rows WHERE board_id = $1', [quadro.id],
    );
    const { rows: [card] } = await client.query<{ id: string }>(
      `INSERT INTO lead_rows (board_id, nome, status, sdr, position) VALUES ($1, $2, $3, '', $4) RETURNING id`,
      [quadro.id, 'Publicar atualizações da semana + disparo aos clientes', status, (max ?? -1) + 1],
    );
    await client.query(
      `INSERT INTO lead_notes (lead_row_id, author_name, content) VALUES ($1, 'Automação', $2)`,
      [
        card.id,
        'Rotina de quarta:\n' +
          '1. Menu Comunicados → Atualizações: cadastrar e publicar o que mudou na semana.\n' +
          '2. Conferir a página pública /novidades.\n' +
          '3. Comunicados → Disparos: enviar o template "Atualizações da semana" pros contatos incluídos.',
      ],
    );
    await client.query('UPDATE comunicado_lembretes SET lead_row_id = $2 WHERE semana = $1', [semana, card.id]);
  });
  return true;
}

export function startComunicadosSemanal(): void {
  setInterval(() => {
    const { diaSemana, hora, data } = spAgora();
    if (diaSemana !== 'Wed' || hora < HORA || rodando) return;
    rodando = true;
    criarLembrete(data)
      .then((criou) => { if (criou) console.log('[comunicados] card da rotina de quarta criado nas Demandas'); })
      .catch((err) => console.error('[comunicados] erro no lembrete semanal', err instanceof Error ? err.message : err))
      .finally(() => { rodando = false; });
  }, 60_000);
  console.log('[comunicados] lembrete semanal ativo (quarta 09h, America/Sao_Paulo)');
}
