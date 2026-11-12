import { query } from '../db.js';

/**
 * Comissão de entrega do time do suporte (pedido de 12/11): card do CRM do Jean/João (aba de Demandas com no_pipeline)
 * que entra no quadro de entregas ("ENTREGAS REALIZADAS") vira um lançamento de comissão de Suporte (commission_entries,
 * a mesma tabela da aba Comissões em Vendas), ligado ao card por lead_row_id:
 *  - o tipo sai do Tipo do card: "API OFICIAL" -> "Entrega API oficial" (ou um tipo de Suporte com o mesmo nome do
 *    Tipo, ex. "Configuração"); valor fixo do tipo. Sem tipo que bata (ou tipo em %), entra com R$ 0 "a definir";
 *  - o mês é o do dia em que o card entrou no quadro (entrou_coluna_em), no horário de Brasília;
 *  - o card saiu do quadro de entregas (ou foi excluído) e a comissão ainda está Pendente: o lançamento sai. Já Paga,
 *    fica;
 *  - trocou o Tipo do card com a comissão Pendente: o tipo e o valor são refeitos.
 * Só conta o que entrou no quadro a partir de COMISSAO_SUPORTE_DESDE (padrão: 01/11/2026), pra não lançar entrega
 * antiga que já foi paga por fora.
 */

const DESDE = process.env.COMISSAO_SUPORTE_DESDE || '2026-11-01T00:00:00-03:00';

export const normalizar = (s: string) =>
  (s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');

/** "ENTREGAS REALIZADAS", "Entrega" etc. */
export const ehQuadroDeEntrega = (nomeDoQuadro: string) => normalizar(nomeDoQuadro).includes('entrega');

/** Quem recebe, pelo nome da aba ("João" -> "Joao", como a aba Comissões já escreve). */
export function pessoaDaAba(nomeDaAba: string): string {
  const primeiro = (nomeDaAba ?? '').trim().split(/\s+/)[0] ?? '';
  const limpo = primeiro.normalize('NFD').replace(/[̀-ͯ]/g, '');
  return limpo ? limpo[0].toUpperCase() + limpo.slice(1).toLowerCase() : '';
}

/** Mês (YYYY-MM) de um instante, no horário de Brasília. */
export function mesEmBrasilia(iso: string | Date): string {
  const d = new Date(iso);
  const p = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit' }).formatToParts(d);
  return `${p.find((x) => x.type === 'year')?.value}-${p.find((x) => x.type === 'month')?.value}`;
}

export type TipoDeComissao = { id: string; label: string; kind: 'fixed' | 'percent'; rate_cents: number | null };

/** O tipo de comissão de Suporte do Tipo do card: "Entrega <tipo>" primeiro, depois um com o mesmo nome do Tipo. */
export function tipoDaEntrega(tipoDoCard: string, tipos: TipoDeComissao[]): TipoDeComissao | null {
  const t = normalizar(tipoDoCard);
  if (!t) return null;
  return tipos.find((x) => normalizar(x.label) === `entrega${t}`) ?? tipos.find((x) => normalizar(x.label) === t) ?? null;
}

/** O lançamento que um card entregue gera (tipo, rótulo e valor). */
export function lancamentoDaEntrega(tipoDoCard: string, tipos: TipoDeComissao[]) {
  const tipo = tipoDaEntrega(tipoDoCard, tipos);
  const rotulo = tipo?.label ?? (tipoDoCard.trim() ? `Entrega ${tipoDoCard.trim()}` : 'Entrega (sem tipo)');
  const valor = tipo?.kind === 'fixed' ? Math.max(0, tipo.rate_cents ?? 0) : 0;
  return { typeId: tipo?.id ?? null, typeLabel: rotulo, amountCents: valor };
}

type CardDoSuporte = {
  id: string; nome: string; empresa: string; tipo: string; entrou: string | null; deleted_at: string | null;
  quadro: string; is_vendas: boolean; page: string; page_name: string; venda_origem_id: string | null;
};

const SELECT_CARD = `
  SELECT r.id, r.nome, r.empresa, r.tipo, COALESCE(r.entrou_coluna_em, r.updated_at) AS entrou, r.deleted_at,
         b.name AS quadro, b.is_vendas, p.id AS page, p.name AS page_name, r.venda_origem_id
  FROM lead_rows r
  JOIN lead_boards b ON b.id = r.board_id
  JOIN lead_pages p ON p.id = b.page AND p.section = 'demandas' AND p.no_pipeline`;

function entregue(c: CardDoSuporte | undefined): c is CardDoSuporte {
  return !!c && !c.deleted_at && !c.is_vendas && !c.venda_origem_id && ehQuadroDeEntrega(c.quadro)
    && !!c.entrou && new Date(c.entrou).getTime() >= new Date(DESDE).getTime();
}

let rodando: Promise<void> | null = null;

/** Deixa os lançamentos iguais aos cards entregues. Idempotente; duas chamadas juntas viram uma só. */
export function sincronizarComissoesDoSuporte(): Promise<void> {
  if (!rodando) rodando = sincronizar().finally(() => { rodando = null; });
  return rodando;
}

async function sincronizar(): Promise<void> {
  const tipos = await query<TipoDeComissao>(
    `SELECT id, label, kind, rate_cents FROM commission_types WHERE role = 'suporte' AND NOT archived ORDER BY position`
  );
  // Os já lançados, com o estado de agora do card (que pode ter saído do suporte, do quadro ou ido pra lixeira).
  const lancados = await query<{ id: string; lead_row_id: string; status: string; reference: string; nome: string }>(
    `SELECT id, lead_row_id, status, reference, nome FROM commission_entries WHERE lead_row_id IS NOT NULL`
  );
  const ids = lancados.map((l) => l.lead_row_id);
  const cardsLancados = ids.length ? await query<CardDoSuporte>(`${SELECT_CARD} WHERE r.id = ANY($1)`, [ids]) : [];
  const porId = new Map(cardsLancados.map((c) => [c.id, c]));

  for (const l of lancados) {
    const c = porId.get(l.lead_row_id);
    if (!entregue(c)) {
      if (l.status === 'pendente') await query(`DELETE FROM commission_entries WHERE id = $1 AND status = 'pendente'`, [l.id]);
      continue;
    }
    const nome = c.nome.trim() || c.empresa.trim();
    if (l.status === 'pendente' && (c.tipo ?? '') !== l.reference) {
      const novo = lancamentoDaEntrega(c.tipo ?? '', tipos);
      await query(
        `UPDATE commission_entries SET type_id = $2, type_label = $3, amount_cents = $4, reference = $5, nome = $6, updated_at = NOW()
         WHERE id = $1 AND status = 'pendente'`,
        [l.id, novo.typeId, novo.typeLabel, novo.amountCents, c.tipo ?? '', nome]
      );
    } else if (nome && nome !== l.nome) {
      await query(`UPDATE commission_entries SET nome = $2, updated_at = NOW() WHERE id = $1`, [l.id, nome]);
    }
  }

  const jaTem = new Set(ids);
  const candidatos = await query<CardDoSuporte>(
    `${SELECT_CARD} WHERE r.deleted_at IS NULL AND NOT b.is_vendas AND r.venda_origem_id IS NULL
       AND COALESCE(r.entrou_coluna_em, r.updated_at) >= $1::timestamptz`,
    [DESDE]
  );
  for (const c of candidatos) {
    if (jaTem.has(c.id) || !entregue(c)) continue;
    const pessoa = pessoaDaAba(c.page_name);
    if (!pessoa) continue;
    const l = lancamentoDaEntrega(c.tipo ?? '', tipos);
    // Entrega feita = comissão devida: nasce como "Assinado" (é o que entra no pagamento na aba Comissões).
    await query(
      `INSERT INTO commission_entries (nome, person, role, type_id, type_label, reference, amount_cents, month, contrato_assinado, lead_row_id)
       VALUES ($1, $2, 'suporte', $3, $4, $5, $6, $7, true, $8)
       ON CONFLICT (lead_row_id) WHERE lead_row_id IS NOT NULL DO NOTHING`,
      [c.nome.trim() || c.empresa.trim(), pessoa, l.typeId, l.typeLabel, c.tipo ?? '', l.amountCents, mesEmBrasilia(c.entrou!), c.id]
    );
  }
}

/** Roda a cada minuto (e na subida): a aba Comissões fica em dia mesmo sem ninguém abrir o CRM do suporte. */
export function startComissaoSuporteSync(): void {
  const tick = () => {
    sincronizarComissoesDoSuporte().catch((err) => console.error('[comissao-suporte] erro ao sincronizar', err));
  };
  setTimeout(tick, 20_000);
  setInterval(tick, 60_000);
  console.log('[comissao-suporte] entregas do CRM do suporte viram comissão (a cada 1 min)');
}
