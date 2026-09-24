import { query, queryOne } from '../db.js';

/**
 * Asaas -> painel: quem é cliente de quem, e quanto cada um paga de verdade.
 *
 * A mensalidade nunca existiu no cadastro do cliente (nasceu no Suporte, onde ninguém preenchia
 * valor), então a tela "Clientes Geral" dependia de digitação manual. Quem sabe o valor de verdade
 * é o Asaas: é lá que a assinatura é cobrada. Este job liga cada cliente ao customer do Asaas e
 * copia o valor da assinatura ATIVA pra monthly_value.
 *
 * O casamento é heurístico, na mesma escada de sempre e sempre exigindo UM único candidato:
 * CNPJ/CPF (o mais forte, vem da ficha de cadastro) -> e-mail -> telefone (últimos 8 dígitos) ->
 * nome/empresa. Vínculo já gravado (asaas_customer_id) não é recalculado: confirmação manual
 * ou de rodada anterior vale mais que heurística.
 *
 * Direção única, Asaas -> painel. Nada aqui cria, altera ou cancela cobrança lá.
 */

const API = 'https://api.asaas.com/v3';
const SANDBOX = 'https://sandbox.asaas.com/api/v3';
const INTERVALO_PADRAO_MIN = 15;

type Customer = { id: string; name: string; email: string | null; cpfCnpj: string | null; phone: string | null; mobilePhone: string | null };
type Subscription = { id: string; customer: string; value: number; status: string; cycle: string; nextDueDate: string | null };

async function config(): Promise<{ chave: string; base: string; intervalo: number } | null> {
  const row = await queryOne<{ asaas_api_key: string | null; asaas_environment: string | null; asaas_sync_interval_min: number | null }>(
    'SELECT asaas_api_key, asaas_environment, asaas_sync_interval_min FROM settings WHERE id = true'
  );
  const chave = (process.env.ASAAS_API_KEY ?? row?.asaas_api_key ?? '').trim();
  if (!chave) return null;
  return {
    chave,
    base: (row?.asaas_environment ?? 'production') === 'production' ? API : SANDBOX,
    intervalo: row?.asaas_sync_interval_min ?? INTERVALO_PADRAO_MIN,
  };
}

/** Lista uma coleção inteira (o Asaas pagina de 100 em 100). */
async function listar<T>(base: string, chave: string, caminho: string): Promise<T[]> {
  const tudo: T[] = [];
  let offset = 0;
  for (let i = 0; i < 100; i++) {
    const res = await fetch(`${base}${caminho}${caminho.includes('?') ? '&' : '?'}limit=100&offset=${offset}`, {
      headers: { access_token: chave },
    });
    if (!res.ok) throw new Error(`Asaas respondeu ${res.status} em ${caminho}`);
    const json = (await res.json()) as { data?: T[]; hasMore?: boolean };
    tudo.push(...(json.data ?? []));
    if (!json.hasMore) break;
    offset += 100;
  }
  return tudo;
}

const soDigitos = (s: string | null | undefined) => (s ?? '').replace(/\D/g, '');
const fimDoTelefone = (s: string | null | undefined) => {
  const d = soDigitos(s);
  return d.length >= 8 ? d.slice(-8) : null;
};
const normaliza = (s: string | null | undefined) =>
  (s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');

/** Nome curto casa com qualquer coisa por containment — exige um mínimo dos dois lados. */
const MIN_NOME = 8;

export interface ResultadoSync {
  clientes: number;
  customers: number;
  assinaturasAtivas: number;
  vinculados: number;
  porCriterio: Record<string, number>;
  valoresAtualizados: number;
  mrrLigado: number;
  semVinculo: number;
}

export async function sincronizarAsaas(opts: { dryRun?: boolean } = {}): Promise<ResultadoSync | null> {
  const cfg = await config();
  if (!cfg) return null;

  const [customers, subscriptions] = await Promise.all([
    listar<Customer>(cfg.base, cfg.chave, '/customers'),
    listar<Subscription>(cfg.base, cfg.chave, '/subscriptions'),
  ]);

  const assinaturaAtiva = new Map<string, Subscription>();
  for (const s of subscriptions) {
    if (s.status !== 'ACTIVE') continue;
    // Mais de uma assinatura ativa no mesmo customer: fica a de maior valor (é a principal;
    // as menores costumam ser adicionais já embutidos no que a pessoa chama de "mensalidade").
    const atual = assinaturaAtiva.get(s.customer);
    if (!atual || (s.value ?? 0) > (atual.value ?? 0)) assinaturaAtiva.set(s.customer, s);
  }

  const clientes = await query<{
    id: string; name: string; company: string; phone: string; email: string;
    cnpj: string | null; asaas_customer_id: string | null; monthly_value: string | null;
  }>(
    `SELECT id, name, company, phone, email, ficha_cadastro->>'cnpj' AS cnpj,
            asaas_customer_id, monthly_value
     FROM clients WHERE archived_at IS NULL`
  );

  const porDoc = new Map<string, Customer[]>();
  const porEmail = new Map<string, Customer[]>();
  const porTelefone = new Map<string, Customer[]>();
  for (const k of customers) {
    const d = soDigitos(k.cpfCnpj);
    if (d.length >= 11) porDoc.set(d, [...(porDoc.get(d) ?? []), k]);
    const e = (k.email ?? '').trim().toLowerCase();
    if (e) porEmail.set(e, [...(porEmail.get(e) ?? []), k]);
    const t = fimDoTelefone(k.mobilePhone || k.phone);
    if (t) porTelefone.set(t, [...(porTelefone.get(t) ?? []), k]);
  }

  const resultado: ResultadoSync = {
    clientes: clientes.length,
    customers: customers.length,
    assinaturasAtivas: assinaturaAtiva.size,
    vinculados: 0,
    porCriterio: {},
    valoresAtualizados: 0,
    mrrLigado: 0,
    semVinculo: 0,
  };

  for (const cl of clientes) {
    let customerId = cl.asaas_customer_id;
    let criterio = 'já ligado';

    if (!customerId) {
      const unico = (lista: Customer[] | undefined) => (lista && lista.length === 1 ? lista[0] : null);
      const doc = soDigitos(cl.cnpj);
      const achado =
        (doc.length >= 11 ? unico(porDoc.get(doc)) : null) ??
        unico(porEmail.get((cl.email ?? '').trim().toLowerCase())) ??
        unico(porTelefone.get(fimDoTelefone(cl.phone) ?? '')) ??
        (() => {
          const alvo = normaliza(cl.company) || normaliza(cl.name);
          if (alvo.length < MIN_NOME) return null;
          const casaram = customers.filter((k) => {
            const n = normaliza(k.name);
            return n.length >= MIN_NOME && (n.includes(alvo) || alvo.includes(n));
          });
          return casaram.length === 1 ? casaram[0] : null;
        })();

      if (!achado) { resultado.semVinculo++; continue; }
      customerId = achado.id;
      criterio =
        doc.length >= 11 && porDoc.get(doc)?.length === 1 ? 'cnpj'
        : porEmail.get((cl.email ?? '').trim().toLowerCase())?.length === 1 ? 'email'
        : porTelefone.get(fimDoTelefone(cl.phone) ?? '')?.length === 1 ? 'telefone'
        : 'nome';
      resultado.vinculados++;
      resultado.porCriterio[criterio] = (resultado.porCriterio[criterio] ?? 0) + 1;
      if (!opts.dryRun) {
        await query('UPDATE clients SET asaas_customer_id = $1, updated_at = NOW() WHERE id = $2', [customerId, cl.id]);
      }
    }

    const assinatura = assinaturaAtiva.get(customerId);
    if (!assinatura) continue;
    resultado.mrrLigado += assinatura.value ?? 0;

    // O valor que vale é o que está sendo cobrado. Só mexe quando muda de verdade, pra não
    // carimbar updated_at de meio mundo a cada rodada.
    const atual = Math.round(Number(cl.monthly_value ?? 0) * 100);
    const doAsaas = Math.round((assinatura.value ?? 0) * 100);
    if (doAsaas && doAsaas !== atual) {
      resultado.valoresAtualizados++;
      if (!opts.dryRun) {
        const diaVencimento = assinatura.nextDueDate ? Number(assinatura.nextDueDate.slice(8, 10)) : null;
        await query(
          `UPDATE clients
           SET monthly_value = $1, asaas_subscription_id = $2,
               due_day = COALESCE($3, due_day), updated_at = NOW()
           WHERE id = $4`,
          [(assinatura.value ?? 0).toFixed(2), assinatura.id, diaVencimento, cl.id]
        );
      }
    } else if (!opts.dryRun) {
      await query('UPDATE clients SET asaas_subscription_id = $1 WHERE id = $2 AND asaas_subscription_id IS DISTINCT FROM $1', [
        assinatura.id, cl.id,
      ]);
    }
  }

  if (!opts.dryRun) {
    await query('UPDATE settings SET asaas_last_sync_at = NOW() WHERE id = true').catch(() => {});
  }
  return resultado;
}

let rodando = false;

/** Liga a sincronização periódica (intervalo configurado em Configurações; 15 min por padrão). */
export function startAsaasSync(): void {
  const tick = async () => {
    if (rodando) return;
    rodando = true;
    try {
      const r = await sincronizarAsaas();
      if (r) {
        console.log(
          `[asaas-sync] ${r.vinculados} vínculo(s) novo(s), ${r.valoresAtualizados} valor(es) atualizado(s), ` +
          `MRR ligado R$ ${r.mrrLigado.toFixed(2)}, ${r.semVinculo} cliente(s) sem par`
        );
      }
    } catch (err) {
      console.error('[asaas-sync] erro', err);
    } finally {
      rodando = false;
    }
  };

  setTimeout(tick, 45_000);
  setInterval(tick, INTERVALO_PADRAO_MIN * 60_000);
  console.log('[asaas-sync] sincronização de assinaturas ativa');
}
