import { query } from '../db.js';

/**
 * As reuniões do CRM do Luis (closer), que é onde a reunião acontece e onde ele marca o resultado (pedido de 12/11).
 * Usado no Dashboard Comercial, nas Minhas métricas do CRM do Luis e no relatório do link público:
 *  - realizada: card do CRM do closer que chegou numa etapa pós-reunião (Proposta enviada, Follow-up Propostas,
 *    Vendido) DENTRO do período — vale a primeira vez que chegou lá (linha do tempo de status ou de quadro do próprio
 *    card; sem registro, a data em que entrou no quadro atual);
 *  - no-show: card do CRM do closer que foi pra "Reunião não comparecida" dentro do período;
 *  - vendas: card do CRM do closer que chegou em "Vendido" dentro do período.
 * Os nomes das etapas variam de CRM pra CRM ("Follow up Propostas", "Followup Propostas"…): compara sem acento,
 * maiúscula nem espaço/hífen.
 */
export const PAGINA_DO_CLOSER = 'crm-luis-closer';

export interface ItemDoCloser { id: string; abrir_id: string; nome: string; status: string }
export interface ReunioesDoCloser { realizadas: ItemDoCloser[]; no_show: ItemDoCloser[]; vendas: ItemDoCloser[] }

const norm = (col: string) =>
  `regexp_replace(translate(lower(COALESCE(${col}, '')), 'áàâãéêíóôõúç', 'aaaaeeiooouc'), '[^a-z0-9]', '', 'g')`;
const ehRealizada = (col: string) =>
  `(${norm(col)} LIKE 'propostaenviada%' OR ${norm(col)} LIKE 'followup%proposta%' OR ${norm(col)} = 'vendido')`;
const ehNoShow = (col: string) => `(${norm(col)} = 'reuniaonaocomparecida')`;
const ehVenda = (col: string) => `(${norm(col)} = 'vendido')`;
// Primeira vez que o card do closer chegou numa etapa: pela linha do tempo, ou — sem registro nenhum e estando nela
// agora — pelo dia em que entrou no quadro atual.
const primeiraVez = (teste: (col: string) => string) => `COALESCE(
  (SELECT MIN(le.created_at) FROM lead_events le
   WHERE le.lead_row_id = lr.id AND le.type IN ('status', 'board') AND ${teste('le.to_value')}),
  CASE WHEN ${teste('lr.status')} OR ${teste('lb.name')} THEN COALESCE(lr.entrou_coluna_em, lr.created_at) END
)`;

/** Dia (AAAA-MM-DD) de um instante, no fuso de Brasília. */
const diaEmBrasilia = (iso: string | null) => (iso
  ? new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso))
  : '');

/** Reuniões realizadas, no-shows e vendas do CRM do closer entre `from` e `to` (dias AAAA-MM-DD, inclusive). */
export async function reunioesDoCloser(from: string, to: string): Promise<ReunioesDoCloser> {
  const cards = await query<{ id: string; nome: string; status: string; realizada_em: string | null; no_show_em: string | null; venda_em: string | null }>(
    `SELECT lr.id, COALESCE(NULLIF(lr.nome, ''), NULLIF(lr.empresa, ''), 'Sem nome') AS nome, COALESCE(lr.status, '') AS status,
            ${primeiraVez(ehRealizada)} AS realizada_em,
            ${primeiraVez(ehNoShow)} AS no_show_em,
            ${primeiraVez(ehVenda)} AS venda_em
     FROM lead_rows lr
     JOIN lead_boards lb ON lb.id = lr.board_id
     WHERE lb.page = $1 AND lb.is_vendas = false AND lr.deleted_at IS NULL`,
    [PAGINA_DO_CLOSER]
  );
  const noPeriodo = (iso: string | null) => { const d = diaEmBrasilia(iso); return !!d && d >= from && d <= to; };
  // abrir_id: o próprio card do closer (é o que ele abre).
  const item = (c: { id: string; nome: string; status: string }) => ({ id: c.id, abrir_id: c.id, nome: c.nome, status: c.status });
  return {
    realizadas: cards.filter((c) => noPeriodo(c.realizada_em)).map(item),
    no_show: cards.filter((c) => noPeriodo(c.no_show_em)).map(item),
    vendas: cards.filter((c) => noPeriodo(c.venda_em)).map(item),
  };
}
