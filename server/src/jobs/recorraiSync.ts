import { query } from '../db.js';

/**
 * Recorrai -> painel (SOMENTE LEITURA). Segunda fonte de cobrança recorrente, pros clientes que NÃO
 * são cobrados via Asaas (clients.asaas_customer_id vazio) — hoje o painel de Risco de Churn só
 * enxergava atraso de quem está no Asaas. Nada aqui cria, cancela ou move cliente de etapa; isso
 * continua território exclusivo do Asaas (ver asaasSync.ts) — este job só espelha um status.
 *
 * Casamento: por CNPJ/documento — clients.cnpj, ou ficha_cadastro->>'cnpj' quando o campo dedicado
 * está vazio (mesmo fallback do asaasSync) — contra o campo `doc` de GET /v1/clientes. Reconfere o
 * casamento a cada rodada (a base é pequena, não precisa cachear).
 *
 * Status: GET /v1/cobrancas?status=VENCIDA traz quem está com cobrança atrasada agora. Cliente
 * casado com pelo menos uma cobrança nessa lista vira recorrai_payment_status='overdue'; casado sem
 * nenhuma vira 'paid'. Mesma escala do enum `payment_status` já usado pelo Asaas — o painel de Risco
 * de Churn não precisa de lógica duplicada pra decidir "tá em atraso".
 *
 * Os nomes de status na Recorrai (confirmados testando a API de verdade) são em maiúsculas e no
 * feminino: PENDENTE, PAGA, VENCIDA, CANCELADA — variações de caixa/gênero (ex. "vencida",
 * "ATRASADA") derrubam a API com 500. Guardar isso aqui pra não redescobrir do zero depois.
 */

const API = 'https://appapi.recorrai.com.br/api';
const INTERVALO_PADRAO_MIN = 30;
const PAGE_SIZE = 100;

interface RecorraiCliente {
  id: string;
  nome: string;
  doc: string | null;
}
interface RecorraiCobranca {
  id: string;
  customerId: string;
  status: string;
}
interface RecorraiPage<T> {
  items?: T[];
  total?: number;
}

/** Lista uma coleção inteira (a Recorrai pagina por `page`/`pageSize`, default 50). */
async function listarPaginas<T>(caminho: string, chave: string): Promise<T[]> {
  const tudo: T[] = [];
  let page = 1;
  for (let i = 0; i < 50; i++) {
    const sep = caminho.includes('?') ? '&' : '?';
    const res = await fetch(`${API}${caminho}${sep}page=${page}&pageSize=${PAGE_SIZE}`, {
      headers: { 'x-api-key': chave },
    });
    if (!res.ok) throw new Error(`Recorrai respondeu ${res.status} em ${caminho}`);
    const json = (await res.json()) as RecorraiPage<T>;
    const items = json.items ?? [];
    tudo.push(...items);
    if (items.length < PAGE_SIZE || tudo.length >= (json.total ?? tudo.length)) break;
    page++;
  }
  return tudo;
}

const soDigitos = (s: string | null | undefined) => (s ?? '').replace(/\D/g, '');

export interface ResultadoRecorraiSync {
  clientesSemAsaas: number;
  recorraiClientes: number;
  vinculados: number;
  emAtraso: number;
  emDia: number;
}

export async function sincronizarRecorrai(): Promise<ResultadoRecorraiSync | null> {
  const chave = (process.env.RECORRAI_API_TOKEN ?? '').trim();
  if (!chave) return null;

  // Só quem NÃO é cobrado via Asaas — pra esse grupo, o Asaas simplesmente não tem opinião sobre
  // pagamento (payment_status fica sempre nulo), então não há risco de um pisar no dado do outro.
  const clientes = await query<{ id: string; cnpj: string | null; ficha_cnpj: string | null }>(
    `SELECT id, cnpj, ficha_cadastro->>'cnpj' AS ficha_cnpj
     FROM clients
     WHERE stage <> 'churned' AND archived_at IS NULL
       AND (asaas_customer_id IS NULL OR asaas_customer_id = '')`,
  );
  const resultado: ResultadoRecorraiSync = {
    clientesSemAsaas: clientes.length,
    recorraiClientes: 0,
    vinculados: 0,
    emAtraso: 0,
    emDia: 0,
  };
  if (clientes.length === 0) return resultado;

  const [recorraiClientes, vencidas] = await Promise.all([
    listarPaginas<RecorraiCliente>('/v1/clientes', chave),
    listarPaginas<RecorraiCobranca>('/v1/cobrancas?status=VENCIDA', chave),
  ]);
  resultado.recorraiClientes = recorraiClientes.length;

  const porDoc = new Map<string, RecorraiCliente>();
  for (const k of recorraiClientes) {
    const d = soDigitos(k.doc);
    if (d.length >= 11 && !porDoc.has(d)) porDoc.set(d, k);
  }
  const customerIdsVencidos = new Set(vencidas.map((c) => c.customerId));

  for (const cl of clientes) {
    const doc = soDigitos(cl.cnpj) || soDigitos(cl.ficha_cnpj);
    if (doc.length < 11) continue;
    const achado = porDoc.get(doc);
    if (!achado) continue;

    resultado.vinculados++;
    const emAtraso = customerIdsVencidos.has(achado.id);
    if (emAtraso) resultado.emAtraso++;
    else resultado.emDia++;

    await query(
      `UPDATE clients
       SET recorrai_customer_id = $1, recorrai_payment_status = $2, recorrai_synced_at = NOW()
       WHERE id = $3`,
      [achado.id, emAtraso ? 'overdue' : 'paid', cl.id],
    );
  }

  return resultado;
}

let rodando = false;

/** Liga a sincronização periódica (30 min por padrão). Sem RECORRAI_API_TOKEN, fica inerte. */
export function startRecorraiSync(): void {
  const tick = async () => {
    if (rodando) return;
    rodando = true;
    try {
      const r = await sincronizarRecorrai();
      if (r && r.vinculados > 0) {
        console.log(
          `[recorrai-sync] ${r.vinculados} vinculado(s) de ${r.clientesSemAsaas} sem Asaas — ` +
          `${r.emAtraso} em atraso, ${r.emDia} em dia`,
        );
      }
    } catch (err) {
      console.error('[recorrai-sync] erro', err);
    } finally {
      rodando = false;
    }
  };

  setTimeout(tick, 50_000);
  setInterval(tick, INTERVALO_PADRAO_MIN * 60_000);
  console.log('[recorrai-sync] sincronização de status de pagamento ativa (Recorrai, clientes sem Asaas)');
}
