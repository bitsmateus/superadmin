import { query, queryAsActor } from '../db.js';
import { sincronizarContagemNotas } from '../routes/leadBoards.js';

/**
 * Cliente do Pipeline do Suporte com responsável de entrega Jean ou João também aparece no CRM dele (aba de Demandas
 * dentro do Pipeline, lead_pages.no_pipeline, com o mesmo primeiro nome do responsável), como card ligado ao cliente
 * (clients.crm_card_id):
 *
 * - da etapa "Iniciar configuração" em diante (Iniciar configuração, Em configuração, Pronto para entrega, Entrega
 *   marcada), nasce em "Demandas pendentes": nome e empresa = empresa do cliente, telefone, "Finalizar até" = data da
 *   entrega (quando tem); uma nota diz a etapa;
 * - trocou o responsável entre Jean e João: o MESMO card vai pro CRM do outro;
 * - entregue/ativo, ou deixou de ser do Jean/João: o card vai pro "Finalizado";
 * - o card nasce uma vez: apagado no CRM (lixeira), não volta. O que o Jean/João fazem no card não é desfeito.
 *
 * Roda na subida, a cada 2 minutos e logo depois de editar um cliente. Uma passada por vez (fila), então duas
 * chamadas juntas não criam dois cards.
 */

const ETAPAS_DO_CRM: Record<string, string> = {
  setup_start: 'Iniciar configuração', setup: 'Em configuração', setup_done: 'Pronto para entrega', delivery: 'Entrega marcada',
};
const ETAPAS_FINAIS = new Set(['delivered', 'active']);
const INTERVALO_MS = 2 * 60_000;

const normalizar = (s: string | null | undefined) =>
  (s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9 ]/g, '').trim();
const primeiroNome = (s: string | null | undefined) => normalizar(s).split(/\s+/)[0] ?? '';

type Quadro = { id: string; name: string };
type Crm = { page: string; inicial: Quadro; finalizado: Quadro | null };

async function crmsDoSuporte(): Promise<Map<string, Crm>> {
  const abas = await query<{ id: string; name: string }>(
    `SELECT id, name FROM lead_pages WHERE no_pipeline AND section = 'demandas' AND archived_at IS NULL`
  );
  const out = new Map<string, Crm>();
  for (const a of abas) {
    const quadros = await query<Quadro>(
      `SELECT id, name FROM lead_boards WHERE page = $1 AND NOT is_vendas AND NOT is_contrato ORDER BY position, created_at`, [a.id]
    );
    if (!quadros.length) continue;
    const inicial = quadros.find((q) => normalizar(q.name) === 'demandas pendentes') ?? quadros[0];
    out.set(primeiroNome(a.name), { page: a.id, inicial, finalizado: quadros.find((q) => normalizar(q.name) === 'finalizado') ?? null });
  }
  return out;
}

async function moverCard(cardId: string, quadro: Quadro): Promise<void> {
  const [{ max }] = await query<{ max: number | null }>('SELECT MAX(position) AS max FROM lead_rows WHERE board_id = $1', [quadro.id]);
  await queryAsActor('Pipeline', 'UPDATE lead_rows SET board_id = $2, status = $3, position = $4 WHERE id = $1',
    [cardId, quadro.id, quadro.name, (max ?? -1) + 1]);
}

async function passada(clientId?: string): Promise<void> {
  const crms = await crmsDoSuporte();
  if (!crms.size) return;
  const porPagina = new Map([...crms.values()].map((c) => [c.page, c]));
  const clientes = await query<{
    id: string; name: string | null; company: string | null; phone: string | null; stage: string;
    responsavel_entrega: string | null; delivery_date: string | null; crm_card_id: string | null;
    card_board: string | null; card_page: string | null; card_quadro: string | null; card_apagado: boolean | null;
  }>(
    `SELECT c.id, c.name, c.company, c.phone, c.stage, c.responsavel_entrega, c.delivery_date, c.crm_card_id,
            r.board_id AS card_board, lb.page AS card_page, lb.name AS card_quadro, (r.deleted_at IS NOT NULL) AS card_apagado
     FROM clients c
     LEFT JOIN lead_rows r ON r.id = c.crm_card_id
     LEFT JOIN lead_boards lb ON lb.id = r.board_id
     WHERE c.archived_at IS NULL AND (c.crm_card_id IS NOT NULL OR c.stage = ANY($1))
       AND ($2::uuid IS NULL OR c.id = $2)`,
    [Object.keys(ETAPAS_DO_CRM), clientId ?? null]
  );
  for (const c of clientes) {
    const crm = crms.get(primeiroNome(c.responsavel_entrega)) ?? null;
    const etapa = ETAPAS_DO_CRM[c.stage];
    const card = c.crm_card_id && c.card_apagado === false ? c.crm_card_id : null;

    if (etapa && crm) {
      if (!c.crm_card_id) {
        const empresa = c.company?.trim() || c.name?.trim() || '';
        const entrega = /^\d{4}-\d{2}-\d{2}/.test(c.delivery_date ?? '') ? (c.delivery_date ?? '').slice(0, 16) : '';
        const [{ max }] = await query<{ max: number | null }>('SELECT MAX(position) AS max FROM lead_rows WHERE board_id = $1', [crm.inicial.id]);
        const [novo] = await query<{ id: string }>(
          `INSERT INTO lead_rows (board_id, nome, empresa, telefone, status, agendamento, position)
           VALUES ($1, $2, $2, $3, $4, $5, $6) RETURNING id`,
          [crm.inicial.id, empresa, c.phone ?? '', crm.inicial.name, entrega, (max ?? -1) + 1]
        );
        await query('UPDATE clients SET crm_card_id = $2 WHERE id = $1', [c.id, novo.id]);
        await query(
          `INSERT INTO lead_notes (lead_row_id, author_id, author_name, content, attachments) VALUES ($1, NULL, 'Pipeline', $2, '[]')`,
          [novo.id, `<p>Cliente do Pipeline do Suporte — etapa: ${etapa}.</p>`]
        );
        await sincronizarContagemNotas(novo.id);
      } else if (card && c.card_page !== crm.page) {
        // Trocou o responsável (Jean <-> João): o mesmo card vai pro CRM do outro.
        await moverCard(card, crm.inicial);
      }
      continue;
    }

    // Entregue/ativo, ou não é mais do Jean/João: o card vai pro "Finalizado" do CRM em que está.
    if (card && (ETAPAS_FINAIS.has(c.stage) || !crm)) {
      const fin = c.card_page ? porPagina.get(c.card_page)?.finalizado : null;
      const fechado = /^(finalizado|vendas do mes)/.test(normalizar(c.card_quadro));
      if (fin && c.card_board !== fin.id && !fechado) await moverCard(card, fin);
    }
  }
}

let fila: Promise<void> = Promise.resolve();

/** Sincroniza um cliente (ou todos). Nunca lança. */
export function sincronizarClientesNoCrm(clientId?: string): Promise<void> {
  fila = fila.then(() => passada(clientId)).catch((err) => {
    console.error('[pipeline->crm] erro ao sincronizar clientes no CRM do suporte', err instanceof Error ? err.message : err);
  });
  return fila;
}

export function startClientesNoCrm(): void {
  setTimeout(() => void sincronizarClientesNoCrm(), 30_000);
  setInterval(() => void sincronizarClientesNoCrm(), INTERVALO_MS);
}
