import { query, queryOne } from '../db.js';
import { sincronizarContagemNotas } from '../routes/leadBoards.js';
import { diasAtras } from '../lib/metaInsights.js';
import { gastoMedioDiarioDaConta, totaisDoCliente } from '../lib/gcTrafego.js';
import { totaisGoogleDoCliente } from '../lib/gcGoogleAds.js';
import { interpretarFinanceiro, type FinanceiroMeta } from '../lib/gcSaldo.js';
import {
  CRMS_DE_GESTOR, DIAS_DE_GESTAO, hojeAs, normalizar, notaDeCobranca, notaDeGestao, precisaCobrar, primeiroNome,
} from '../lib/gcCrmGestorRegras.js';

/**
 * Cards automáticos no CRM do gestor de tráfego (hoje: /demandas/crm-mateus, clientes em que o Mateus é o
 * gestor de tráfego). Regras em lib/gcCrmGestorRegras.ts.
 *
 *  - Segunda e quinta, a partir das 08h (São Paulo): um card no quadro "A fazer" por cliente de tráfego dele.
 *  - Depois de cada leitura de saldo (de hora em hora): saldo pré-pago em 30% ou menos do que tinha depois da
 *    última recarga, ou zerado → card "Cobrar pagamento". Um por recarga: recarregou e baixou de novo, nasce outro.
 *
 * Nunca duplica: cada card tem uma chave em gc_crm_cards_auto. Card apagado no CRM não volta.
 */

const APP_URL = (process.env.PUBLIC_APP_URL || 'https://app.nxdigital.com.br').replace(/\/$/, '');
const linkTrafego = (clienteId: string) => `${APP_URL}/clientesnxdigital/clientes/${clienteId}?aba=trafego`;

type Quadro = { id: string; name: string };
interface CrmGestor { pagina: string; quadro: Quadro; gestorId: string }

/** CRM (aba + quadro "A fazer") e o perfil do gestor de cada entrada de CRMS_DE_GESTOR que existe. */
async function crmsDosGestores(): Promise<CrmGestor[]> {
  const out: CrmGestor[] = [];
  for (const c of CRMS_DE_GESTOR) {
    // Pela URL (/demandas/crm-mateus); se o id for outro, pela aba de Demandas com o nome do gestor ("Mateus", "CRM Mateus").
    let pagina = await queryOne<{ id: string }>('SELECT id FROM lead_pages WHERE id = $1 AND archived_at IS NULL', [c.pagina]);
    if (!pagina) {
      const abas = await query<{ id: string; name: string }>(`SELECT id, name FROM lead_pages WHERE section = 'demandas' AND archived_at IS NULL`);
      const achadas = abas.filter((a) => normalizar(a.name).replace(/^crm\s+/, '').split(/\s+/)[0] === c.gestor);
      pagina = achadas.length === 1 ? { id: achadas[0].id } : null;
    }
    if (!pagina) continue;
    const quadros = await query<Quadro>(
      'SELECT id, name FROM lead_boards WHERE page = $1 AND NOT is_vendas AND NOT is_contrato ORDER BY position, created_at', [pagina.id],
    );
    const quadro = quadros.find((q) => normalizar(q.name) === 'a fazer') ?? quadros.find((q) => normalizar(q.name).startsWith('a fazer')) ?? quadros[0];
    if (!quadro) continue;
    const perfis = await query<{ id: string; name: string | null }>(`SELECT id, name FROM profiles`);
    const gestor = perfis.filter((p) => primeiroNome(p.name) === c.gestor);
    if (gestor.length !== 1) {
      if (gestor.length > 1) console.warn(`[crm-gestor] mais de um perfil com o nome "${c.gestor}": não criei cards`);
      continue;
    }
    out.push({ pagina: pagina.id, quadro, gestorId: gestor[0].id });
  }
  return out;
}

/** Cria o card (com a nota) se a chave ainda não foi usada. Devolve se criou. */
async function criarCard(chave: string, quadro: Quadro, d: { nome: string; empresa: string; telefone: string; finalizarAte: string; nota: string }): Promise<boolean> {
  const reservado = await queryOne<{ chave: string }>(
    'INSERT INTO gc_crm_cards_auto (chave) VALUES ($1) ON CONFLICT (chave) DO NOTHING RETURNING chave', [chave],
  );
  if (!reservado) return false;
  try {
    const [{ max }] = await query<{ max: number | null }>('SELECT MAX(position) AS max FROM lead_rows WHERE board_id = $1', [quadro.id]);
    const [novo] = await query<{ id: string }>(
      `INSERT INTO lead_rows (board_id, nome, empresa, telefone, status, agendamento, position)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
      [quadro.id, d.nome, d.empresa, d.telefone, quadro.name, d.finalizarAte, (max ?? -1) + 1],
    );
    await query(
      `INSERT INTO lead_notes (lead_row_id, author_id, author_name, content, attachments) VALUES ($1, NULL, 'Tráfego', $2, '[]')`,
      [novo.id, d.nota],
    );
    await sincronizarContagemNotas(novo.id);
    await query('UPDATE gc_crm_cards_auto SET lead_row_id = $2 WHERE chave = $1', [chave, novo.id]);
    return true;
  } catch (err) {
    // Não criou: libera a chave pra tentar de novo na próxima passada.
    await query('DELETE FROM gc_crm_cards_auto WHERE chave = $1', [chave]);
    throw err;
  }
}

/** Clientes ATIVOS de tráfego do gestor: com conta Meta/Google vinculada ou serviço de tráfego ativo. */
async function clientesDoGestor(gestorId: string) {
  return query<{ id: string; nome_empresa: string; whatsapp_contato: string }>(
    `SELECT c.id, c.nome_empresa, c.whatsapp_contato FROM gc_clientes c
     WHERE c.status = 'ativo' AND c.gestor_trafego_id = $1 AND (
       EXISTS (SELECT 1 FROM gc_trafego_contas t WHERE t.gc_cliente_id = c.id AND t.ativo)
       OR EXISTS (SELECT 1 FROM gc_google_contas g WHERE g.gc_cliente_id = c.id AND g.ativo)
       OR EXISTS (SELECT 1 FROM gc_servicos s WHERE s.gc_cliente_id = c.id AND s.status = 'ativo' AND s.tipo IN ('trafego_meta','trafego_google')))
     ORDER BY c.nome_empresa`,
    [gestorId],
  );
}

/** Segunda e quinta: um card de gestão por cliente. `hoje` = YYYY-MM-DD em São Paulo. */
export async function cardsDeGestao(hoje: string, diaSemana: number): Promise<number> {
  const rotulo = DIAS_DE_GESTAO[diaSemana];
  if (!rotulo) return 0;
  let criados = 0;
  for (const crm of await crmsDosGestores()) {
    for (const c of await clientesDoGestor(crm.gestorId)) {
      const [meta, google, contas, alertas] = await Promise.all([
        totaisDoCliente(c.id, diasAtras(7), diasAtras(1)),
        totaisGoogleDoCliente(c.id, diasAtras(7), diasAtras(1)),
        query<{ financeiro: FinanceiroMeta | null }>('SELECT financeiro FROM gc_trafego_contas WHERE gc_cliente_id = $1 AND ativo', [c.id]),
        query<{ mensagem: string }>('SELECT mensagem FROM gc_trafego_alertas WHERE gc_cliente_id = $1 AND resolved_at IS NULL ORDER BY created_at DESC', [c.id]),
      ]);
      const saldos = contas.map((x) => (x.financeiro ? interpretarFinanceiro(x.financeiro) : null)).filter((f) => f?.prePaga && f.saldoDisponivel !== null);
      const nota = notaDeGestao(c.nome_empresa, rotulo, {
        metaGasto: meta.gasto, metaResultados: meta.resultados, metaCusto: meta.custoResultado,
        googleGasto: google.gasto, googleConversoes: google.conversoes,
        saldo: saldos.length ? saldos.reduce((s, f) => s + (f!.saldoDisponivel ?? 0), 0) : null,
        alertas: alertas.map((a) => a.mensagem),
      }, linkTrafego(c.id));
      const ok = await criarCard(`gestao:${crm.pagina}:${c.id}:${hoje}`, crm.quadro, {
        nome: `${rotulo} — ${c.nome_empresa}`, empresa: c.nome_empresa, telefone: c.whatsapp_contato ?? '', finalizarAte: hojeAs(hoje), nota,
      });
      if (ok) criados++;
    }
  }
  return criados;
}

/** Saldo pré-pago em 30% (ou zerado): card "Cobrar pagamento", uma vez por recarga. */
export async function cardsDeCobranca(hoje: string): Promise<number> {
  let criados = 0;
  for (const crm of await crmsDosGestores()) {
    const contas = await query<{
      id: string; ad_account_id: string; nome: string; financeiro: FinanceiroMeta; saldo_referencia: string | null;
      saldo_referencia_em: string | null; cliente_id: string; nome_empresa: string; whatsapp_contato: string;
    }>(
      `SELECT t.id, t.ad_account_id, t.nome, t.financeiro, t.saldo_referencia, t.saldo_referencia_em,
              c.id AS cliente_id, c.nome_empresa, c.whatsapp_contato
       FROM gc_trafego_contas t JOIN gc_clientes c ON c.id = t.gc_cliente_id
       WHERE t.ativo AND t.financeiro IS NOT NULL AND c.status = 'ativo' AND c.gestor_trafego_id = $1`,
      [crm.gestorId],
    );
    for (const t of contas) {
      const fin = interpretarFinanceiro(t.financeiro);
      if (!fin.prePaga) continue;
      const referencia = t.saldo_referencia === null ? null : Number(t.saldo_referencia);
      if (!precisaCobrar(fin.saldoDisponivel, referencia)) continue;
      const gastoDia = await gastoMedioDiarioDaConta(t.ad_account_id);
      const ciclo = t.saldo_referencia_em ? new Date(t.saldo_referencia_em).toISOString() : 'inicio';
      const ok = await criarCard(`cobranca:${crm.pagina}:${t.id}:${ciclo}`, crm.quadro, {
        nome: `Cobrar pagamento — ${t.nome_empresa}`, empresa: t.nome_empresa, telefone: t.whatsapp_contato ?? '', finalizarAte: hojeAs(hoje),
        nota: notaDeCobranca(t.nome_empresa, t.nome || t.ad_account_id, fin.saldoDisponivel ?? 0, referencia, gastoDia, linkTrafego(t.cliente_id)),
      });
      if (ok) criados++;
    }
  }
  return criados;
}
