import { query, queryOne } from '../db.js';
import { restrictedBoardFilter } from '../routes/leadBoards.js';

/**
 * Trava por marca de Permissões no servidor (o menu e a rota já escondem; isto garante que a API também
 * recuse). Admin passa sempre; quem não é restrito também; restrito precisa ter a marca.
 */
export async function temMarcaDeMenu(userId: string, role: string | undefined, chave: string): Promise<boolean> {
  if (role === 'admin') return true;
  const perfil = await queryOne<{ restrict_access: boolean }>('SELECT restrict_access FROM profiles WHERE id = $1', [userId]);
  if (!perfil?.restrict_access) return true;
  const marca = await queryOne('SELECT 1 FROM user_menu_access WHERE user_id = $1 AND menu_key = $2', [userId, chave]);
  return !!marca;
}

/** A pessoa enxerga algum quadro com essa marca (vendas/contrato) ou de uma aba (ex.: CRM do closer)? */
async function temQuadro(userId: string, role: string | undefined, onde: string, params: unknown[] = []): Promise<boolean> {
  const permitidos = await restrictedBoardFilter(userId, role ?? '');
  if (permitidos === null) return true;
  if (!permitidos.length) return false;
  const achou = await query(`SELECT 1 FROM lead_boards WHERE id = ANY($1) AND ${onde} LIMIT 1`, [permitidos, ...params]);
  return achou.length > 0;
}

/** Vendas (e as comissões que nascem dela): quem tem a aba Vendas liberada, ou Contas a Pagar (que mostra as comissões). */
export async function podeVerVendasOuComissoes(userId: string, role: string | undefined): Promise<boolean> {
  if (role === 'admin') return true;
  if (await temQuadro(userId, role, 'is_vendas')) return true;
  return temMarcaDeMenu(userId, role, 'financeiro_contas_pagar');
}

/** Métricas do closer: quem tem o Dashboard Comercial marcado ou a aba do closer liberada. */
export async function podeVerMetricasDoCloser(userId: string, role: string | undefined): Promise<boolean> {
  if (role === 'admin') return true;
  if (await temQuadro(userId, role, 'page = $2', ['crm-luis-closer'])) return true;
  return temMarcaDeMenu(userId, role, 'comercial_dashboard');
}
