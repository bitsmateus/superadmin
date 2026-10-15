import { query, queryOne } from '../db.js';
import { restrictedBoardFilter } from '../routes/leadBoards.js';

/** Financeiro (Vendas, Contrato, Contas a Pagar, Clientes Geral, comissões, Asaas): SÓ administrador. */
export function ehAdmin(role: string | undefined): boolean {
  return role === 'admin';
}

/**
 * Trava por marca de Permissões no servidor. Administrador passa sempre; qualquer outro perfil precisa ter a
 * marca (não existe mais "acesso total" fora do administrador).
 */
export async function temMarcaDeMenu(userId: string, role: string | undefined, chave: string): Promise<boolean> {
  if (ehAdmin(role)) return true;
  const marca = await queryOne('SELECT 1 FROM user_menu_access WHERE user_id = $1 AND menu_key = $2', [userId, chave]);
  return !!marca;
}

/** Métricas do closer: administrador, quem tem o Dashboard Comercial marcado ou a aba do closer liberada. */
export async function podeVerMetricasDoCloser(userId: string, role: string | undefined): Promise<boolean> {
  if (ehAdmin(role)) return true;
  const permitidos = await restrictedBoardFilter(userId, role ?? '');
  if (permitidos === null) return true;
  if (permitidos.length) {
    const achou = await query(`SELECT 1 FROM lead_boards WHERE id = ANY($1) AND page = 'crm-luis-closer' LIMIT 1`, [permitidos]);
    if (achou.length) return true;
  }
  return temMarcaDeMenu(userId, role, 'comercial_dashboard');
}
