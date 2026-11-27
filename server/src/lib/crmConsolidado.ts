/** Já consolidou os CRMs? A execução da consolidação grava uma linha em `crm_consolidacao` (na mesma transação). */
import { query, queryOne } from '../db.js';
import { espelhoQuando, nomeSuspenso, paginaDoCloserQuando } from './regrasDaConsolidacao.js';

export async function crmConsolidado(): Promise<boolean> {
  return !!(await queryOne('SELECT 1 AS ok FROM crm_consolidacao'));
}
export const paginaDoCloser = async (): Promise<string> => paginaDoCloserQuando(await crmConsolidado());
export const espelhoDeReuniao = async () => espelhoQuando(await crmConsolidado());

/** Usuário suspenso não gera comissão nova nem recebe aviso. `nome`: o texto da coluna SDR/closer ("Arthur"). */
export async function pessoaSuspensa(nome: string): Promise<boolean> {
  return nomeSuspenso(nome, await query<{ name: string | null; suspensa: boolean }>(
    'SELECT name, (suspended_at IS NOT NULL) AS suspensa FROM profiles'));
}
