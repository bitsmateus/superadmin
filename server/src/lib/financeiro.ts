import { query } from '../db.js';

/**
 * FINANCEIRO — quem pode ver dinheiro da empresa. É uma lista FECHADA de contas, no código: Ian e Mateus.
 * Não basta ser administrador (um admin novo criado amanhã NÃO vê) e não existe tela nem marcação que
 * libere: pra mudar esta lista é preciso mudar o código e publicar de novo.
 */
const DONOS_DO_FINANCEIRO = new Set<string>([
  '39443c45-07c0-4f84-815b-75fc2e4bdea0', // Ian Silvano
  '97c4e487-7560-4d65-88c0-6424b40011a8', // Mateus
]);

export function podeVerFinanceiro(userId: string | undefined | null, role: string | undefined | null): boolean {
  return role === 'admin' && !!userId && DONOS_DO_FINANCEIRO.has(userId);
}

/** Tabelas que são só do Financeiro: nem a lista nem os avisos em tempo real chegam a mais ninguém. */
export const TABELAS_DO_FINANCEIRO = new Set<string>([
  'payables_groups', 'payables_entries', 'payables_fixed_catalog',
  'commission_entries', 'commission_types',
  'contracts', 'contract_templates',
  'commercial_months',
]);

/** Valores e dados de cobrança do cliente. O Suporte continua vendo o STATUS do pagamento (inadimplente),
 * que usa no dia a dia, mas não os valores. */
export const CAMPOS_FINANCEIROS_DO_CLIENTE = [
  'implementation_value', 'monthly_value', 'due_day', 'last_payment_check', 'payments', 'finance_notes',
  'asaas_customer_id', 'asaas_payment_id', 'asaas_subscription_id',
  'recorrai_customer_id', 'recorrai_synced_at',
];

export function limparClienteParaQuemNaoEFinanceiro<T extends Record<string, unknown>>(row: T): T {
  const copia: Record<string, unknown> = { ...row };
  for (const c of CAMPOS_FINANCEIROS_DO_CLIENTE) delete copia[c];
  return copia as T;
}

// Quadros de Vendas/Contrato: leads deles também não vão pra quem não é do Financeiro.
let quadrosDoFinanceiro = new Set<string>();
export async function recarregarQuadrosDoFinanceiro(): Promise<void> {
  try {
    const r = await query<{ id: string }>('SELECT id FROM lead_boards WHERE is_vendas OR is_contrato');
    quadrosDoFinanceiro = new Set(r.map((x) => x.id));
  } catch (err) {
    console.error('[financeiro] falha ao carregar os quadros de Vendas/Contrato', err);
  }
}
export function ehQuadroDoFinanceiro(boardId: unknown): boolean {
  return typeof boardId === 'string' && quadrosDoFinanceiro.has(boardId);
}
