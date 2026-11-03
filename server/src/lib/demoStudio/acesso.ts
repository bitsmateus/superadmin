import type { FastifyReply, FastifyRequest } from 'fastify';
import type { ZodSchema } from 'zod';
import { queryOne } from '../../db.js';
import { temMarcaDeMenu } from '../acessoMenu.js';
import { mensagemDoErro } from './schemas.js';

/** Quem pode o quê no Demo Studio (ver docs/demo-studio/ADAPTACAO.md, "Papéis"). */
export type Papel = 'ADMIN' | 'EDITOR' | 'SELLER';
export type Usuario = { sub: string; role?: string };

/** Papel dentro do módulo, ou null sem acesso. Admin do superadmin = ADMIN; os outros precisam da marca. */
export async function papelNoModulo(req: FastifyRequest): Promise<Papel | null> {
  const { sub, role } = req.user as Usuario;
  if (role === 'admin') return 'ADMIN';
  if (!(await temMarcaDeMenu(sub, role, 'demo_studio'))) return null;
  const p = await queryOne<{ ds_role: string | null }>('SELECT ds_role FROM profiles WHERE id = $1', [sub]);
  return p?.ds_role === 'SELLER' ? 'SELLER' : 'EDITOR';
}

const PODE: Record<'ver' | 'editar' | 'admin', Papel[]> = {
  ver: ['ADMIN', 'EDITOR', 'SELLER'],
  editar: ['ADMIN', 'EDITOR'],
  admin: ['ADMIN'],
};

/** preHandler: barra quem não tem o nível pedido. Guarda o papel em `req.dsPapel` pra rota usar. */
export function exigir(nivel: keyof typeof PODE) {
  return async (req: FastifyRequest, reply: FastifyReply) => {
    const papel = await papelNoModulo(req);
    if (!papel) return reply.status(403).send({ message: 'Sem acesso ao Demo Studio. Peça a marca em Equipe → Permissões.' });
    if (!PODE[nivel].includes(papel)) return reply.status(403).send({ message: 'Seu papel no Demo Studio não permite esta ação.' });
    (req as FastifyRequest & { dsPapel?: Papel }).dsPapel = papel;
  };
}

export function papelDaRequisicao(req: FastifyRequest): Papel | undefined {
  return (req as FastifyRequest & { dsPapel?: Papel }).dsPapel;
}

export function validar<T>(schema: ZodSchema<T>, dados: unknown, reply: FastifyReply): T | undefined {
  const r = schema.safeParse(dados ?? {});
  if (!r.success) {
    reply.status(400).send({ message: mensagemDoErro(r.error) });
    return undefined;
  }
  return r.data;
}
