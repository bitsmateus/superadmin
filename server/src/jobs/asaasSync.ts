import { query, queryOne } from '../db.js';

/**
 * Asaas -> painel. O Asaas manda no dinheiro: é lá que a cobrança existe, e é de lá que a tela
 * "Clientes Geral" tira mensalidade, quem virou cliente e quem deixou de ser.
 *
 * As três regras, uma frase cada:
 *
 *  1. CRIOU COBRANÇA LÁ, NASCE CLIENTE AQUI. Assinatura nova sem cadastro correspondente cria o
 *     cliente com nome, empresa, telefone e mensalidade vindos do Asaas. Empresa do grupo e valor
 *     de implementação ficam em branco de propósito — são decisão de gente, preenchidas na tela.
 *
 *  2. REMOVEU A COBRANÇA LÁ, VIRA CANCELADO AQUI. A linha que aponta pra uma assinatura que saiu
 *     do ar (cancelada, expirada ou apagada) registra o cancelamento com a data de hoje e sai dos
 *     ativos. Motivo e observação ficam pra preencher depois, na aba Cancelamentos.
 *
 *  3. MUDOU O VALOR LÁ, MUDA AQUI. Quem já está ligado acompanha o valor da própria assinatura,
 *     sempre — mesma ideia: se mexeu no Asaas, mexe aqui; se não mexeu, nada se move sozinho.
 *
 * O que o Asaas NÃO decide: empresa do grupo, implementação, nome editado à mão e a divisão de um
 * mesmo CNPJ em várias linhas (a JLF tem três cobranças, duas da NX Digital e uma da NX Sistema).
 * Por isso o vínculo forte é a ASSINATURA (clients.asaas_subscription_id), não o cliente: cada
 * linha da tela vale pela cobrança dela.
 *
 * A DATA DE CORTE (settings.asaas_sync_since) vale só pra criar vínculo NOVO: assinatura antiga que
 * ficou sem par — cobrança fora do Asaas, cadastro duplicado, caso ainda em análise — não é mais
 * caçada a cada 15 minutos. Quem já está ligado continua sendo acompanhado, seja de quando for.
 *
 * Direção única: nada aqui cria, altera ou cancela cobrança no Asaas.
 */

const API = 'https://api.asaas.com/v3';
const SANDBOX = 'https://sandbox.asaas.com/api/v3';
const INTERVALO_PADRAO_MIN = 15;

/** Trava de segurança: se uma rodada quiser cancelar mais gente do que isso de uma vez, algo está
 * errado (resposta parcial da API, chave trocada, conta errada) — não aplica e avisa no log. */
const MAX_CANCELAMENTOS_POR_RODADA = 15;

type Customer = {
  id: string; name: string; email: string | null; cpfCnpj: string | null;
  phone: string | null; mobilePhone: string | null;
};
type Subscription = {
  id: string; customer: string; value: number; status: string; cycle: string;
  nextDueDate: string | null; dateCreated: string | null; deleted?: boolean;
};

async function config(): Promise<{ chave: string; base: string; intervalo: number; desde: string | null } | null> {
  const row = await queryOne<{
    asaas_api_key: string | null; asaas_environment: string | null;
    asaas_sync_interval_min: number | null; asaas_sync_since: string | null;
  }>(
    // asaas_sync_since sai como TEXTO 'YYYY-MM-DD' de propósito: como DATE ele volta como objeto
    // Date, e o texto dele ("Fri Sep 25") comparado com a data do Asaas ("2026-09-25") barrava
    // TODAS as assinaturas — inclusive as novas, que era justamente o que devia passar.
    `SELECT asaas_api_key, asaas_environment, asaas_sync_interval_min,
            TO_CHAR(asaas_sync_since, 'YYYY-MM-DD') AS asaas_sync_since
     FROM settings WHERE id = true`
  );
  const chave = (process.env.ASAAS_API_KEY ?? row?.asaas_api_key ?? '').trim();
  if (!chave) return null;
  return {
    chave,
    base: (row?.asaas_environment ?? 'production') === 'production' ? API : SANDBOX,
    intervalo: row?.asaas_sync_interval_min ?? INTERVALO_PADRAO_MIN,
    desde: row?.asaas_sync_since ?? null,
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
  /** Data de corte em vigor ('YYYY-MM-DD') — antes dela, só acompanha quem já está ligado. */
  desde: string | null;
  clientes: number;
  customers: number;
  assinaturasAtivas: number;
  /** Cadastros que já existiam e passaram a apontar pra uma cobrança nesta rodada. */
  vinculados: number;
  porCriterio: Record<string, number>;
  /** Cadastros criados a partir de cobrança nova. */
  criados: number;
  valoresAtualizados: number;
  /** Clientes que viraram cancelados porque a cobrança saiu do ar no Asaas. */
  cancelados: number;
  mrrLigado: number;
}

export async function sincronizarAsaas(opts: { dryRun?: boolean } = {}): Promise<ResultadoSync | null> {
  const cfg = await config();
  if (!cfg) return null;

  const [customers, subscriptions] = await Promise.all([
    listar<Customer>(cfg.base, cfg.chave, '/customers'),
    listar<Subscription>(cfg.base, cfg.chave, '/subscriptions'),
  ]);

  const customerPorId = new Map(customers.map((k) => [k.id, k]));
  const assinaturaPorId = new Map(subscriptions.map((s) => [s.id, s]));
  const estaAtiva = (s: Subscription | undefined) => !!s && s.status === 'ACTIVE' && !s.deleted;
  const ativasPorCustomer = new Map<string, Subscription[]>();
  for (const s of subscriptions) {
    if (!estaAtiva(s)) continue;
    ativasPorCustomer.set(s.customer, [...(ativasPorCustomer.get(s.customer) ?? []), s]);
  }
  const ehNova = (s: Subscription) => !cfg.desde || (s.dateCreated ?? '') >= cfg.desde;

  const clientes = await query<{
    id: string; name: string; company: string; phone: string; email: string; stage: string;
    cnpj: string | null; asaas_customer_id: string | null; asaas_subscription_id: string | null;
    monthly_value: string | null;
  }>(
    `SELECT id, name, company, phone, email, stage::text AS stage,
            COALESCE(NULLIF(cnpj, ''), ficha_cadastro->>'cnpj') AS cnpj,
            asaas_customer_id, asaas_subscription_id, monthly_value
     FROM clients WHERE archived_at IS NULL`
  );

  const resultado: ResultadoSync = {
    desde: cfg.desde,
    clientes: clientes.length,
    customers: customers.length,
    assinaturasAtivas: [...ativasPorCustomer.values()].reduce((n, l) => n + l.length, 0),
    vinculados: 0,
    porCriterio: {},
    criados: 0,
    valoresAtualizados: 0,
    cancelados: 0,
    mrrLigado: 0,
  };

  // Cobrança que já tem dono não pode ser reivindicada por outro cadastro: é o que impede a mesma
  // mensalidade de entrar duas vezes no total e o que preserva a divisão feita à mão.
  const assinaturasComDono = new Set(clientes.map((c) => c.asaas_subscription_id).filter(Boolean) as string[]);
  const customersComDono = new Set(clientes.map((c) => c.asaas_customer_id).filter(Boolean) as string[]);

  // ------------------------------------------------------------- 1. quem já está ligado
  const paraCancelar: typeof clientes = [];

  for (const cl of clientes) {
    if (!cl.asaas_subscription_id) continue;
    const s = assinaturaPorId.get(cl.asaas_subscription_id);

    if (!estaAtiva(s)) {
      // A cobrança saiu do ar lá. Quem já está cancelado aqui não precisa de nada.
      if (cl.stage !== 'churned') paraCancelar.push(cl);
      continue;
    }

    resultado.mrrLigado += s!.value ?? 0;
    const atual = Math.round(Number(cl.monthly_value ?? 0) * 100);
    const doAsaas = Math.round((s!.value ?? 0) * 100);
    if (doAsaas === atual) continue;

    resultado.valoresAtualizados++;
    if (opts.dryRun) continue;
    const venc = s!.nextDueDate;
    await query(
      `UPDATE clients SET monthly_value = $1, due_day = COALESCE($2, due_day), updated_at = NOW()
       WHERE id = $3`,
      [(s!.value ?? 0).toFixed(2), venc ? Number(venc.slice(8, 10)) : null, cl.id]
    );
  }

  if (paraCancelar.length > MAX_CANCELAMENTOS_POR_RODADA) {
    console.error(
      `[asaas-sync] ABORTADO: ${paraCancelar.length} clientes cairiam pra cancelado numa rodada só ` +
      `(limite ${MAX_CANCELAMENTOS_POR_RODADA}). Nada foi alterado — confira a conta/chave do Asaas.`
    );
  } else {
    for (const cl of paraCancelar) {
      resultado.cancelados++;
      if (opts.dryRun) continue;
      // Motivo e observação ficam pra depois: o registro entra na hora só pra tirar o cliente dos
      // ativos, e o "por quê" é preenchido na aba Cancelamentos. asaas_removido já nasce marcado —
      // a baixa lá foi exatamente o que disparou isso.
      await query(
        `INSERT INTO client_cancellations (client_id, canceled_at, motivo, observacao, mrr_cents, asaas_removido)
         VALUES ($1, CURRENT_DATE, 'Cobrança removida no Asaas', '', $2, true)`,
        [cl.id, Math.round(Number(cl.monthly_value ?? 0) * 100)]
      );
      await query(
        `UPDATE clients SET stage = 'churned', stage_updated_at = NOW(), updated_at = NOW() WHERE id = $1`,
        [cl.id]
      );
      console.log('[asaas-sync] cancelado (cobrança removida lá):', cl.name);
    }
  }

  // --------------------------------------------- 2. cadastro que já existe, cobrança é nova
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
  const unico = (lista: Customer[] | undefined) => (lista && lista.length === 1 ? lista[0] : null);

  for (const cl of clientes) {
    if (cl.asaas_subscription_id) continue;

    let customerId = cl.asaas_customer_id;
    let criterio = 'já ligado';
    if (!customerId) {
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
      if (!achado || customersComDono.has(achado.id)) continue;
      criterio =
        doc.length >= 11 && porDoc.get(doc)?.length === 1 ? 'cnpj'
        : porEmail.get((cl.email ?? '').trim().toLowerCase())?.length === 1 ? 'email'
        : porTelefone.get(fimDoTelefone(cl.phone) ?? '')?.length === 1 ? 'telefone'
        : 'nome';
      customerId = achado.id;
    }

    // Só entra cobrança NOVA: o que ficou sem par no passado já foi conferido à mão.
    const livres = (ativasPorCustomer.get(customerId) ?? [])
      .filter((s) => !assinaturasComDono.has(s.id) && ehNova(s));
    if (!livres.length) continue;

    const principal = livres.reduce((maior, s) => ((s.value ?? 0) > (maior.value ?? 0) ? s : maior), livres[0]);
    const total = livres.reduce((soma, s) => soma + (s.value ?? 0), 0);
    for (const s of livres) assinaturasComDono.add(s.id);
    customersComDono.add(customerId);
    resultado.vinculados++;
    resultado.porCriterio[criterio] = (resultado.porCriterio[criterio] ?? 0) + 1;
    resultado.mrrLigado += total;
    if (opts.dryRun) continue;

    const venc = principal.nextDueDate;
    await query(
      `UPDATE clients
       SET asaas_customer_id = $1, asaas_subscription_id = $2, monthly_value = $3,
           due_day = COALESCE($4, due_day), updated_at = NOW()
       WHERE id = $5`,
      [customerId, principal.id, total.toFixed(2), venc ? Number(venc.slice(8, 10)) : null, cl.id]
    );
    console.log('[asaas-sync] cobrança nova ligada a', cl.name, `(por ${criterio})`);
  }

  // ------------------------------------------------------ 3. cobrança nova sem ninguém aqui
  for (const s of subscriptions) {
    if (!estaAtiva(s) || !ehNova(s)) continue;
    if (assinaturasComDono.has(s.id) || customersComDono.has(s.customer)) continue;
    const k = customerPorId.get(s.customer);
    if (!k) continue;

    assinaturasComDono.add(s.id);
    customersComDono.add(s.customer);
    resultado.criados++;
    resultado.mrrLigado += s.value ?? 0;
    if (opts.dryRun) continue;

    const venc = s.nextDueDate;
    // Nasce como cliente ativo (a cobrança já existe), sem empresa do grupo e sem implementação:
    // esses dois são escolha de gente e aparecem na tela como pendência a preencher.
    await query(
      `INSERT INTO clients (name, company, email, phone, cnpj, stage, monthly_value, due_day,
                            asaas_customer_id, asaas_subscription_id)
       VALUES ($1, $1, $2, $3, $4, 'active', $5, $6, $7, $8)`,
      [
        k.name, k.email ?? '', k.mobilePhone || k.phone || '', soDigitos(k.cpfCnpj),
        (s.value ?? 0).toFixed(2), venc ? Number(venc.slice(8, 10)) : null, k.id, s.id,
      ]
    );
    console.log('[asaas-sync] cliente criado a partir de cobrança nova:', k.name, `R$ ${s.value}`);
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
      if (r && (r.criados || r.cancelados || r.vinculados || r.valoresAtualizados)) {
        console.log(
          `[asaas-sync] ${r.criados} cliente(s) criado(s), ${r.cancelados} cancelado(s), ` +
          `${r.vinculados} ligado(s), ${r.valoresAtualizados} valor(es) atualizado(s)`
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
