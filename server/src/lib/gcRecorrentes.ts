import { pool } from '../db.js';

/**
 * Rotina mensal do módulo "Clientes NX Digital": os itens que todo cliente ativo precisa ter, todo
 * mês, sem ninguém lembrar de criar.
 *
 * O item é do MÊS QUE FECHOU e vence no seguinte: o relatório de setembro é devido em 5 de outubro, o
 * alinhamento de setembro até 10 de outubro. Por isso o prazo cai sempre no mês corrente.
 *
 * Gera só o mês que acabou de fechar, não o histórico: cliente que está há dois anos na base não
 * pode acordar com 24 relatórios atrasados. E só pra quem JÁ ERA cliente naquele mês — cobrar o
 * relatório de setembro de quem entrou em outubro seria cobrar um número que nunca existiu.
 */
export const ROTINAS_MENSAIS = [
  {
    chave: 'relatorio',
    titulo: (mes: string) => `Publicar o relatório de ${mes}`,
    diaLimite: 5,
    ordem: 0,
  },
  {
    chave: 'alinhamento',
    titulo: (mes: string) => `Alinhamento de ${mes} com o cliente`,
    diaLimite: 10,
    ordem: 1,
  },
] as const;

const MESES = [
  'janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho',
  'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro',
];

/** 'YYYY-MM' → "setembro de 2026". */
export function rotuloDoMes(periodo: string): string {
  const [ano, mes] = periodo.split('-').map(Number);
  return `${MESES[mes - 1]} de ${ano}`;
}

/** O mês de hoje em Brasília ('YYYY-MM'). Em UTC, de madrugada o mês podia ser o seguinte. */
export function mesCorrente(agora: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
  }).format(agora);
}

/** O mês que acabou de fechar ('YYYY-MM'). */
export function mesQueFechou(agora: Date = new Date()): string {
  const [ano, mes] = mesCorrente(agora).split('-').map(Number);
  return mes === 1 ? `${ano - 1}-12` : `${ano}-${String(mes - 1).padStart(2, '0')}`;
}

/** Último dia de 'YYYY-MM', como 'YYYY-MM-DD'. */
function ultimoDia(periodo: string): string {
  const [ano, mes] = periodo.split('-').map(Number);
  return `${periodo}-${String(new Date(ano, mes, 0).getDate()).padStart(2, '0')}`;
}

// Não precisa rodar a cada abertura de tela: o que muda é por mês, e cliente novo ganha o item na
// próxima janela. Meia hora é o máximo que alguém espera por um item que "devia existir".
let ultimaGeracao: { mes: string; em: number } | null = null;
const INTERVALO_MS = 30 * 60 * 1000;

/**
 * A rotina do relatório e do alinhamento NÃO se marca à mão: o estado vem dos fatos.
 *  - relatório: o relatório daquele mês está PUBLICADO;
 *  - alinhamento: existe uma nota do tipo "Reunião/alinhamento" entre o primeiro dia do mês de
 *    referência e o fim do mês seguinte (a janela em que o alinhamento é feito, prazo dia 10).
 * Sem o fato, o item fica (ou volta a ficar) pendente — apagar a nota ou despublicar reabre.
 * Idempotente e barata: um UPDATE que só toca quem mudou. Sem `clienteId`, vale pra todos.
 */
export async function sincronizarRotinaAutomatica(clienteId?: string): Promise<void> {
  await pool.query(
    `UPDATE gc_checklist_itens i
     SET concluido = f.ok,
         concluido_em = CASE WHEN f.ok THEN COALESCE(i.concluido_em, NOW()) ELSE NULL END,
         concluido_por = CASE WHEN f.ok THEN i.concluido_por ELSE NULL END,
         updated_at = NOW()
     FROM (
       SELECT i2.id,
         CASE i2.recorrente_chave
           WHEN 'relatorio' THEN EXISTS (
             SELECT 1 FROM gc_relatorios r
             WHERE r.gc_cliente_id = i2.gc_cliente_id AND r.status = 'publicado'
               AND r.periodo_inicio = i2.mes_referencia)
           ELSE EXISTS (
             SELECT 1 FROM gc_historico h
             WHERE h.gc_cliente_id = i2.gc_cliente_id AND h.tipo = 'reuniao'
               AND (h.created_at AT TIME ZONE 'America/Sao_Paulo')::date >= i2.mes_referencia
               AND (h.created_at AT TIME ZONE 'America/Sao_Paulo')::date < (i2.mes_referencia + INTERVAL '2 months')::date)
         END AS ok
       FROM gc_checklist_itens i2
       WHERE i2.recorrente_chave IN ('relatorio', 'alinhamento')
         AND ($1::uuid IS NULL OR i2.gc_cliente_id = $1::uuid)
     ) f
     WHERE i.id = f.id AND i.concluido IS DISTINCT FROM f.ok`,
    [clienteId ?? null]
  );
}

/**
 * Garante que todo cliente que conta nos totais tenha os itens da rotina do mês que fechou.
 * Idempotente e barata de chamar: o registro em gc_recorrentes_gerados impede o duplicado, mesmo
 * com duas telas abrindo ao mesmo tempo, e quem apagou um item não o vê ressuscitar.
 */
export async function garantirRecorrentes(agora: Date = new Date(), forcar = false): Promise<number> {
  const mes = mesQueFechou(agora);
  if (!forcar && ultimaGeracao && ultimaGeracao.mes === mes && agora.getTime() - ultimaGeracao.em < INTERVALO_MS) {
    return 0;
  }
  ultimaGeracao = { mes, em: agora.getTime() };

  const referencia = `${mes}-01`;
  const fimDoMes = ultimoDia(mes);
  const corrente = mesCorrente(agora);
  let criados = 0;

  for (const rotina of ROTINAS_MENSAIS) {
    const prazo = `${corrente}-${String(rotina.diaLimite).padStart(2, '0')}`;
    const r = await pool.query(
      `WITH novos AS (
         INSERT INTO gc_recorrentes_gerados (gc_cliente_id, chave, mes_referencia)
         SELECT c.id, $1, $2::date
         FROM gc_clientes c
         WHERE c.status = 'ativo' AND NOT c.fora_dos_totais
           AND (c.created_at AT TIME ZONE 'America/Sao_Paulo')::date <= $3::date
         ON CONFLICT DO NOTHING
         RETURNING gc_cliente_id
       )
       INSERT INTO gc_checklist_itens
         (gc_cliente_id, titulo, ordem, prazo, recorrente_chave, mes_referencia)
       SELECT gc_cliente_id, $4, $5, $6::date, $1, $2::date FROM novos`,
      [rotina.chave, referencia, fimDoMes, rotina.titulo(rotuloDoMes(mes)), rotina.ordem, prazo]
    );
    criados += r.rowCount ?? 0;
  }
  await sincronizarRotinaAutomatica();
  return criados;
}
