import type { FastifyReply, FastifyRequest } from 'fastify';
import { queryOne } from '../db.js';

/**
 * Quem vê qual cliente do NX DIGITAL (pedido do Mateus em 11/11/2026):
 *  - administrador vê todos;
 *  - qualquer outro usuário vê SÓ os clientes em que está vinculado como gestor de tráfego
 *    (gc_clientes.gestor_trafego_id). Dos demais não vê nada: nem na lista, nem a ficha, nem as abas.
 *
 * A checagem é no servidor, sempre. Rotas de um cliente passam pelo hook `guardaDoCliente` (que acha
 * o cliente pela URL); listagens aplicam `sqlSoDoGestor` no WHERE.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface UsuarioGc {
  sub: string;
  role: string;
}

export const veTodosOsClientes = (u: Pick<UsuarioGc, 'role'>): boolean => u.role === 'admin';

/**
 * Condição SQL que restringe aos clientes do gestor (`alias` = alias de gc_clientes na consulta).
 * Admin: 'TRUE'. O id vem do token (já validado) e ainda passa pelo regex antes de ir pro SQL.
 */
export function sqlSoDoGestor(u: UsuarioGc, alias = 'c'): string {
  if (veTodosOsClientes(u)) return 'TRUE';
  if (!UUID_RE.test(u.sub)) return 'FALSE';
  return `${alias}.gestor_trafego_id = '${u.sub}'::uuid`;
}

export async function podeVerCliente(u: UsuarioGc, clienteId: string | null | undefined): Promise<boolean> {
  if (veTodosOsClientes(u)) return true;
  if (!clienteId || !UUID_RE.test(clienteId)) return false;
  const r = await queryOne('SELECT 1 FROM gc_clientes WHERE id = $1 AND gestor_trafego_id = $2', [clienteId, u.sub]);
  return !!r;
}

/**
 * Rotas que apontam para um registro filho (não para o cliente): de que tabela tirar o gc_cliente_id.
 * A chave é o começo do padrão da rota, até o parâmetro.
 */
const DONO_POR_ROTA: { prefixo: string; param: string; sql: string }[] = [
  { prefixo: '/api/gc/arquivos/:id', param: 'id', sql: 'SELECT gc_cliente_id FROM gc_arquivos WHERE id = $1' },
  { prefixo: '/api/gc/checklist/:id', param: 'id', sql: 'SELECT gc_cliente_id FROM gc_checklist_itens WHERE id = $1' },
  { prefixo: '/api/gc/estrategias/:id', param: 'id', sql: 'SELECT gc_cliente_id FROM gc_cliente_estrategias WHERE id = $1' },
  { prefixo: '/api/gc/historico/:id', param: 'id', sql: 'SELECT gc_cliente_id FROM gc_historico WHERE id = $1' },
  { prefixo: '/api/gc/infos/:id', param: 'id', sql: 'SELECT gc_cliente_id FROM gc_infos_mes WHERE id = $1' },
  { prefixo: '/api/gc/jornada/:id', param: 'id', sql: 'SELECT gc_cliente_id FROM gc_cliente_jornada WHERE id = $1' },
  { prefixo: '/api/gc/metas/:id', param: 'id', sql: 'SELECT gc_cliente_id FROM gc_metas WHERE id = $1' },
  { prefixo: '/api/gc/relatorios/:id', param: 'id', sql: 'SELECT gc_cliente_id FROM gc_relatorios WHERE id = $1' },
  { prefixo: '/api/gc/servicos/:id', param: 'id', sql: 'SELECT gc_cliente_id FROM gc_servicos WHERE id = $1' },
  { prefixo: '/api/gc/demandas/:id', param: 'id', sql: 'SELECT gc_cliente_id FROM gc_demandas WHERE id = $1' },
  { prefixo: '/api/gc/social/materiais/:id', param: 'id', sql: 'SELECT gc_cliente_id FROM gc_social_materiais WHERE id = $1' },
  { prefixo: '/api/gc/social/producao/:id', param: 'id', sql: 'SELECT gc_cliente_id FROM gc_social_producao WHERE id = $1' },
  {
    prefixo: '/api/gc/social/agendamentos/:id',
    param: 'id',
    sql: 'SELECT p.gc_cliente_id FROM gc_social_agendamentos a JOIN gc_social_producao p ON p.id = a.gc_producao_id WHERE a.id = $1',
  },
  { prefixo: '/api/gc/trafego/alertas/:id', param: 'id', sql: 'SELECT gc_cliente_id FROM gc_trafego_alertas WHERE id = $1' },
  { prefixo: '/api/gc/trafego/contas/:id', param: 'id', sql: 'SELECT gc_cliente_id FROM gc_trafego_contas WHERE id = $1' },
  { prefixo: '/api/gc/trafego/google/contas/:id', param: 'id', sql: 'SELECT gc_cliente_id FROM gc_google_contas WHERE id = $1' },
  { prefixo: '/api/gc/trafego/edicoes/:edicaoId', param: 'edicaoId', sql: 'SELECT gc_cliente_id FROM gc_trafego_edicoes WHERE id = $1' },
  { prefixo: '/api/gc/trafego/mensagens/:mensagemId', param: 'mensagemId', sql: 'SELECT gc_cliente_id FROM gc_trafego_mensagens WHERE id = $1' },
];

/** Rotas cujo parâmetro já É o id do cliente. */
const CLIENTE_NA_ROTA: { prefixo: string; param: string }[] = [
  { prefixo: '/api/gc/clientes/:id', param: 'id' },
  { prefixo: '/api/gc/social/checklist/:clienteId', param: 'clienteId' },
];

/** Rotas que não são de um cliente (modelos, colunas do kanban...): passam direto. */
const SEM_CLIENTE = ['/api/gc/demandas/colunas', '/api/gc/modelos', '/api/gc/planejamento/modelos'];

const casa = (url: string, prefixo: string) => url === prefixo || url.startsWith(`${prefixo}/`);

export type ResultadoRota = { tipo: 'livre' } | { tipo: 'cliente'; id: string | null } | { tipo: 'filho'; sql: string; id: string };

/** De qual cliente é esta rota? (puro — coberto por gcAcesso.test.ts) */
export function clienteDaRota(url: string, params: Record<string, string | undefined>): ResultadoRota {
  if (SEM_CLIENTE.some((p) => casa(url, p))) return { tipo: 'livre' };
  for (const r of CLIENTE_NA_ROTA) if (casa(url, r.prefixo)) return { tipo: 'cliente', id: params[r.param] ?? null };
  for (const r of DONO_POR_ROTA) if (casa(url, r.prefixo)) return { tipo: 'filho', sql: r.sql, id: params[r.param] ?? '' };
  return { tipo: 'livre' };
}

const NEGADO = { message: 'Você não tem acesso a este cliente.' };

/**
 * Hook (preHandler) dos módulos NX DIGITAL: bloqueia qualquer rota de um cliente que o usuário não
 * gerencia. Roda depois do `authenticate` da rota, então req.user já existe; rota sem usuário
 * (pública) passa direto. Também confere o gc_cliente_id do corpo (criar/mover demanda).
 */
export async function guardaDoCliente(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  const u = req.user as UsuarioGc | undefined;
  const url = req.routeOptions?.url ?? '';
  if (!u?.sub || !url.startsWith('/api/gc/') || veTodosOsClientes(u)) return;

  const params = (req.params ?? {}) as Record<string, string | undefined>;
  const r = clienteDaRota(url, params);
  if (r.tipo === 'cliente' && !(await podeVerCliente(u, r.id))) return void reply.status(403).send(NEGADO);
  if (r.tipo === 'filho') {
    if (!UUID_RE.test(r.id)) return void reply.status(404).send({ message: 'Registro não encontrado' });
    const dono = await queryOne<{ gc_cliente_id: string | null }>(r.sql, [r.id]);
    if (!dono) return; // a própria rota responde o 404
    // Demanda sem cliente não é de ninguém: continua aberta pra quem usa o kanban.
    const semCliente = dono.gc_cliente_id === null && url.startsWith('/api/gc/demandas/');
    if (!semCliente && !(await podeVerCliente(u, dono.gc_cliente_id))) return void reply.status(403).send(NEGADO);
  }

  // Criar/mover algo para um cliente pelo corpo (ex.: demanda): só para cliente dele.
  const corpo = req.body as Record<string, unknown> | undefined;
  const doCorpo = corpo && typeof corpo === 'object' ? corpo.gc_cliente_id : undefined;
  if (typeof doCorpo === 'string' && doCorpo && !(await podeVerCliente(u, doCorpo))) {
    return void reply.status(403).send(NEGADO);
  }
}
