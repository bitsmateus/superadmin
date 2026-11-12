/**
 * Saldo e forma de pagamento das contas de anúncio dos clientes NX Digital (Meta Ads) — SÓ LEITURA.
 *
 * A Meta não tem um campo único de "saldo": depende de como a conta paga.
 *  - Pré-paga (boleto/Pix, comum no Brasil): o saldo disponível vem no texto da forma de pagamento
 *    (funding_source_details.display_string, ex.: "Saldo disponível (R$ 1.234,56 BRL)").
 *  - Cartão/fatura (pós-paga): não há saldo que acabe; mostramos a forma de pagamento e o valor a pagar.
 *  - Limite de gastos da conta (spend_cap): qualquer conta pode ter; quando chega no limite, os
 *    anúncios param. O que falta = spend_cap − amount_spent.
 * Valores da Meta vêm em centavos (string).
 *
 * Este arquivo é puro (sem banco nem rede): coberto por gcSaldo.test.ts.
 */

export const CAMPOS_FINANCEIRO_META =
  'account_status,disable_reason,currency,balance,amount_spent,spend_cap,is_prepay_account,funding_source_details';

export interface FinanceiroMeta {
  account_status?: number;
  disable_reason?: number;
  currency?: string;
  balance?: string;
  amount_spent?: string;
  spend_cap?: string;
  is_prepay_account?: boolean;
  funding_source_details?: { id?: string; display_string?: string; type?: number };
}

export interface FinanceiroConta {
  status: number;
  statusRotulo: string;
  /** Conta que não está veiculando por problema de conta/pagamento. */
  bloqueada: boolean;
  prePaga: boolean;
  /** "Saldo pré-pago (boleto/Pix)", "Cartão de crédito", "Fatura"... */
  formaPagamento: string;
  /** Texto que a Meta mostra (ex.: "Visa •••• 1234", "Saldo disponível (R$ 50,00 BRL)"). */
  detalhePagamento: string;
  /** Pré-paga: quanto ainda há para gastar. null = não deu pra ler. */
  saldoDisponivel: number | null;
  /** Pós-paga: valor acumulado a pagar. */
  valorAPagar: number | null;
  /** Limite de gastos da conta (null = sem limite). */
  limiteGasto: number | null;
  /** Quanto falta para bater o limite de gastos. */
  restanteLimite: number | null;
}

const STATUS: Record<number, string> = {
  1: 'Ativa',
  2: 'Desativada',
  3: 'Pagamento pendente',
  7: 'Em análise de risco',
  8: 'Aguardando acerto de pagamento',
  9: 'Em período de carência',
  100: 'Encerramento pendente',
  101: 'Encerrada',
  201: 'Ativa',
  202: 'Encerrada',
};
const BLOQUEADAS = new Set([2, 3, 7, 8, 9, 100, 101, 202]);

/** funding_source_details.type → nome da forma de pagamento. */
const FORMAS: Record<number, string> = {
  1: 'Cartão de crédito',
  2: 'Carteira do Facebook',
  3: 'Crédito pago do Facebook',
  4: 'Crédito estendido (fatura)',
  5: 'Pedido',
  6: 'Fatura',
  7: 'Token do Facebook',
  8: 'Financiamento externo',
  12: 'PayPal',
  13: 'PayPal',
  15: 'Depósito externo',
  17: 'Débito automático',
  19: 'Pagamento alternativo',
  20: 'Saldo pré-pago (boleto/Pix)',
};

const centavos = (v: unknown): number | null => {
  if (v === undefined || v === null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n / 100 : null;
};

/**
 * Tira o valor em dinheiro de um texto da Meta: "Saldo disponível (R$ 1.234,56 BRL)",
 * "Available balance (R$1,234.56 BRL)", "R$ 50 BRL". null se não achar.
 */
export function valorDoTexto(texto: string | undefined | null): number | null {
  // O último número do texto é o valor ("... (R$ 1.234,56 BRL)").
  const numeros = String(texto ?? '').match(/-?\d[\d.,]*\d|-?\d/g);
  if (!numeros?.length) return null;
  let n = numeros[numeros.length - 1];
  const ponto = n.lastIndexOf('.');
  const virgula = n.lastIndexOf(',');
  const decimal = Math.max(ponto, virgula);
  // Separador decimal = o último, se tiver 1 ou 2 dígitos depois dele; senão é milhar.
  if (decimal >= 0 && n.length - decimal - 1 <= 2) {
    n = n.slice(0, decimal).replace(/[.,]/g, '') + '.' + n.slice(decimal + 1);
  } else {
    n = n.replace(/[.,]/g, '');
  }
  const v = Number(n);
  return Number.isFinite(v) ? v : null;
}

export function interpretarFinanceiro(f: FinanceiroMeta): FinanceiroConta {
  const status = Number(f.account_status ?? 0);
  const tipo = Number(f.funding_source_details?.type ?? 0);
  const detalhe = String(f.funding_source_details?.display_string ?? '').trim();
  const prePaga = f.is_prepay_account === true || tipo === 20;
  const limite = centavos(f.spend_cap);
  const gasto = centavos(f.amount_spent) ?? 0;
  const temLimite = limite !== null && limite > 0;
  return {
    status,
    statusRotulo: STATUS[status] ?? (status ? `Status ${status}` : 'Desconhecido'),
    bloqueada: BLOQUEADAS.has(status),
    prePaga,
    formaPagamento: FORMAS[tipo] ?? (prePaga ? FORMAS[20] : detalhe ? 'Outra' : 'Não informada'),
    detalhePagamento: detalhe,
    saldoDisponivel: prePaga ? valorDoTexto(detalhe) : null,
    valorAPagar: prePaga ? null : centavos(f.balance),
    limiteGasto: temLimite ? limite : null,
    restanteLimite: temLimite ? Math.max(0, limite! - gasto) : null,
  };
}

/** Avisar quando o que sobra dá para menos que isso de dias (no gasto médio dos últimos 7 dias). */
export const DIAS_AVISO_SALDO = 3;

export interface DisparoSaldo {
  regra: 'conta_bloqueada' | 'saldo_baixo' | 'sem_saldo' | 'limite_perto';
  nivel: 'critico' | 'atencao';
  mensagem: string;
}

const brl = (v: number) => `R$ ${new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(v)}`;
const dias = (n: number) => (n < 1 ? 'menos de 1 dia' : `${Math.floor(n)} ${Math.floor(n) === 1 ? 'dia' : 'dias'}`);

/** Para quantos dias dá um valor no gasto médio diário. null = sem gasto pra estimar. */
export function diasQueDa(valor: number | null, gastoDia: number): number | null {
  if (valor === null || gastoDia <= 0) return null;
  return valor / gastoDia;
}

/** Alertas de saldo de UMA conta. `gastoDia` = média diária dos últimos 7 dias fechados. */
export function alertasDeSaldo(fin: FinanceiroConta, gastoDia: number, nomeConta: string): DisparoSaldo[] {
  const out: DisparoSaldo[] = [];
  const conta = nomeConta ? ` (${nomeConta})` : '';
  if (fin.bloqueada) {
    out.push({ regra: 'conta_bloqueada', nivel: 'critico', mensagem: `Conta de anúncio${conta} com status "${fin.statusRotulo}": os anúncios não estão rodando. Conferir pagamento no Gerenciador.` });
  }
  if (fin.prePaga && fin.saldoDisponivel !== null) {
    const d = diasQueDa(fin.saldoDisponivel, gastoDia);
    if (fin.saldoDisponivel <= 0) {
      out.push({ regra: 'sem_saldo', nivel: 'critico', mensagem: `Saldo pré-pago${conta} zerado: os anúncios param. Pedir ao cliente para adicionar saldo (boleto/Pix).` });
    } else if (d !== null && d < DIAS_AVISO_SALDO) {
      out.push({
        regra: 'saldo_baixo',
        nivel: d < 1 ? 'critico' : 'atencao',
        mensagem: `Saldo de ${brl(fin.saldoDisponivel)}${conta} dá para ${dias(d)} no ritmo atual (${brl(gastoDia)}/dia). Pedir recarga ao cliente.`,
      });
    }
  }
  if (fin.restanteLimite !== null && fin.limiteGasto !== null) {
    const d = diasQueDa(fin.restanteLimite, gastoDia);
    if (fin.restanteLimite <= 0 || (d !== null && d < DIAS_AVISO_SALDO)) {
      out.push({
        regra: 'limite_perto',
        nivel: fin.restanteLimite <= 0 || (d !== null && d < 1) ? 'critico' : 'atencao',
        mensagem: fin.restanteLimite <= 0
          ? `Limite de gastos da conta${conta} (${brl(fin.limiteGasto)}) atingido: os anúncios param. Aumentar ou redefinir o limite.`
          : `Faltam ${brl(fin.restanteLimite)} para o limite de gastos da conta${conta}: dá para ${dias(d!)}. Aumentar ou redefinir o limite.`,
      });
    }
  }
  return out;
}
