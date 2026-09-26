import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import bcrypt from 'bcrypt';
import { query, queryOne } from '../db.js';

/**
 * Açougue do Mercado Nunes (/mercadonunes/acougue) — rateio do boi.
 *
 * Tem LOGIN PRÓPRIO (e-mail + senha só dessa ferramenta), separado do painel: quem mexe em preço no
 * açougue não precisa de conta no TenantHub, e o custo da carcaça não fica aberto na internet como
 * o gerador de plaquinhas. O token é o mesmo JWT do app, mas carimbado com `scope: 'acougue'` —
 * `app.authenticate` (painel) recusa qualquer token com esse carimbo, então um não vira o outro.
 */

interface Usuario {
  id: string;
  email: string;
  nome: string | null;
  senha_hash?: string;
}

const EMAIL_OK = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function acougueRoutes(app: FastifyInstance) {
  /** Exige um token do açougue (e só dele). */
  async function auth(req: FastifyRequest, reply: FastifyReply) {
    try {
      await req.jwtVerify();
    } catch {
      return reply.status(401).send({ message: 'Sessão expirada — entre de novo.' });
    }
    if ((req.user as { scope?: string }).scope !== 'acougue') {
      return reply.status(403).send({ message: 'Este login não tem acesso ao açougue.' });
    }
  }

  const assinar = (u: Usuario) =>
    app.jwt.sign({ sub: u.id, email: u.email, scope: 'acougue' }, { expiresIn: '30d' });

  // Diz se já existe alguém cadastrado — sem isso a tela não sabe se mostra "entrar" ou
  // "criar primeiro acesso" (evita ter que semear usuário por env/SQL na mão).
  app.get('/api/public/acougue/status', async () => {
    const row = await queryOne<{ total: string }>('SELECT COUNT(*)::text AS total FROM mn_acougue_usuarios');
    return { temUsuario: Number(row?.total ?? 0) > 0 };
  });

  // Primeiro acesso: só funciona enquanto NÃO houver nenhum usuário. Depois disso, novos usuários
  // só saem de dentro do sistema (rota abaixo, já logado).
  app.post<{ Body: { email?: string; nome?: string; senha?: string } }>(
    '/api/public/acougue/primeiro-acesso',
    async (req, reply) => {
      const row = await queryOne<{ total: string }>('SELECT COUNT(*)::text AS total FROM mn_acougue_usuarios');
      if (Number(row?.total ?? 0) > 0) {
        return reply.status(409).send({ message: 'Já existe acesso cadastrado — peça a senha para quem já usa.' });
      }
      const email = (req.body?.email ?? '').trim().toLowerCase();
      const senha = req.body?.senha ?? '';
      if (!EMAIL_OK.test(email)) return reply.status(400).send({ message: 'E-mail inválido.' });
      if (senha.length < 6) return reply.status(400).send({ message: 'A senha precisa de pelo menos 6 caracteres.' });

      const usuario = await queryOne<Usuario>(
        `INSERT INTO mn_acougue_usuarios (email, nome, senha_hash) VALUES ($1, $2, $3)
         RETURNING id, email, nome`,
        [email, (req.body?.nome ?? '').trim() || null, await bcrypt.hash(senha, 10)],
      );
      return reply.status(201).send({ token: assinar(usuario!), usuario });
    },
  );

  app.post<{ Body: { email?: string; senha?: string } }>('/api/public/acougue/login', async (req, reply) => {
    const email = (req.body?.email ?? '').trim().toLowerCase();
    const senha = req.body?.senha ?? '';
    const usuario = await queryOne<Required<Usuario>>(
      'SELECT id, email, nome, senha_hash FROM mn_acougue_usuarios WHERE lower(email) = $1',
      [email],
    );
    if (!usuario || !(await bcrypt.compare(senha, usuario.senha_hash))) {
      return reply.status(401).send({ message: 'E-mail ou senha incorretos.' });
    }
    const { senha_hash: _, ...dados } = usuario;
    return { token: assinar(dados), usuario: dados };
  });

  app.get('/api/public/acougue/me', { onRequest: [auth] }, async (req, reply) => {
    const { sub } = req.user as { sub: string };
    const usuario = await queryOne<Usuario>('SELECT id, email, nome FROM mn_acougue_usuarios WHERE id = $1', [sub]);
    if (!usuario) return reply.status(401).send({ message: 'Acesso removido.' });
    return usuario;
  });

  app.get('/api/public/acougue/usuarios', { onRequest: [auth] }, async () =>
    query<Usuario>('SELECT id, email, nome, created_at FROM mn_acougue_usuarios ORDER BY created_at'),
  );

  app.post<{ Body: { email?: string; nome?: string; senha?: string } }>(
    '/api/public/acougue/usuarios',
    { onRequest: [auth] },
    async (req, reply) => {
      const email = (req.body?.email ?? '').trim().toLowerCase();
      const senha = req.body?.senha ?? '';
      if (!EMAIL_OK.test(email)) return reply.status(400).send({ message: 'E-mail inválido.' });
      if (senha.length < 6) return reply.status(400).send({ message: 'A senha precisa de pelo menos 6 caracteres.' });
      try {
        const usuario = await queryOne<Usuario>(
          `INSERT INTO mn_acougue_usuarios (email, nome, senha_hash) VALUES ($1, $2, $3)
           RETURNING id, email, nome`,
          [email, (req.body?.nome ?? '').trim() || null, await bcrypt.hash(senha, 10)],
        );
        return reply.status(201).send(usuario);
      } catch (err) {
        if ((err as { code?: string }).code === '23505') {
          return reply.status(409).send({ message: 'Esse e-mail já tem acesso.' });
        }
        throw err;
      }
    },
  );

  app.delete<{ Params: { id: string } }>('/api/public/acougue/usuarios/:id', { onRequest: [auth] }, async (req, reply) => {
    const { sub } = req.user as { sub: string };
    if (sub === req.params.id) return reply.status(400).send({ message: 'Você não pode remover o próprio acesso.' });
    const row = await queryOne<{ total: string }>('SELECT COUNT(*)::text AS total FROM mn_acougue_usuarios');
    if (Number(row?.total ?? 0) <= 1) return reply.status(400).send({ message: 'Precisa sobrar pelo menos um acesso.' });
    await query('DELETE FROM mn_acougue_usuarios WHERE id = $1', [req.params.id]);
    return { ok: true };
  });

  // ── Bases (boi desossado, boi campo, suíno…) ────────────────────────────────────
  const SELECT_BASE = `id, nome, unidade, custo::float8 AS custo, peso_peca::float8 AS "pesoPeca",
                       margem::float8 AS margem, arredondamento, cortes, created_at, updated_at`;

  app.get('/api/public/acougue/bases', { onRequest: [auth] }, async () =>
    query(`SELECT ${SELECT_BASE} FROM mn_acougue_bases ORDER BY nome`),
  );

  app.post<{ Body: { nome?: string } }>('/api/public/acougue/bases', { onRequest: [auth] }, async (req, reply) => {
    const nome = (req.body?.nome ?? '').trim();
    if (!nome) return reply.status(400).send({ message: 'Dê um nome pra base (ex.: Boi desossado).' });
    const base = await queryOne(`INSERT INTO mn_acougue_bases (nome) VALUES ($1) RETURNING ${SELECT_BASE}`, [nome]);
    return reply.status(201).send(base);
  });

  app.put<{
    Params: { id: string };
    Body: {
      nome?: string;
      unidade?: string;
      custo?: number;
      pesoPeca?: number | null;
      margem?: number;
      arredondamento?: string;
      cortes?: unknown[];
    };
  }>('/api/public/acougue/bases/:id', { onRequest: [auth] }, async (req, reply) => {
    const b = req.body ?? {};
    const base = await queryOne(
      `UPDATE mn_acougue_bases SET
         nome = COALESCE($2, nome),
         unidade = COALESCE($3, unidade),
         custo = COALESCE($4, custo),
         peso_peca = $5,
         margem = COALESCE($6, margem),
         arredondamento = COALESCE($7, arredondamento),
         cortes = COALESCE($8, cortes),
         updated_at = NOW()
       WHERE id = $1 RETURNING ${SELECT_BASE}`,
      [
        req.params.id,
        b.nome?.trim() || null,
        b.unidade ?? null,
        b.custo ?? null,
        b.pesoPeca ?? null,
        b.margem ?? null,
        b.arredondamento ?? null,
        b.cortes ? JSON.stringify(b.cortes) : null,
      ],
    );
    if (!base) return reply.status(404).send({ message: 'Base não encontrada.' });
    return base;
  });

  app.delete<{ Params: { id: string } }>('/api/public/acougue/bases/:id', { onRequest: [auth] }, async (req) => {
    await query('DELETE FROM mn_acougue_bases WHERE id = $1', [req.params.id]);
    return { ok: true };
  });

  // "Aplicar": os preços novos viram os preços atuais e a tabela inteira entra no histórico.
  app.post<{
    Params: { id: string };
    Body: { cortes?: Array<Record<string, unknown>>; custoKg?: number; margem?: number };
  }>('/api/public/acougue/bases/:id/aplicar', { onRequest: [auth] }, async (req, reply) => {
    const { email } = req.user as { email?: string };
    const cortes = req.body?.cortes ?? [];
    if (!Array.isArray(cortes) || cortes.length === 0) {
      return reply.status(400).send({ message: 'Nada para aplicar.' });
    }
    const base = await queryOne<{ id: string; nome: string }>(
      'SELECT id, nome FROM mn_acougue_bases WHERE id = $1',
      [req.params.id],
    );
    if (!base) return reply.status(404).send({ message: 'Base não encontrada.' });

    await query('UPDATE mn_acougue_bases SET cortes = $2, updated_at = NOW() WHERE id = $1', [
      req.params.id,
      JSON.stringify(cortes),
    ]);
    await query(
      `INSERT INTO mn_acougue_historico (base_id, base_nome, custo_kg, margem, usuario, cortes)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [req.params.id, base.nome, req.body?.custoKg ?? 0, req.body?.margem ?? 0, email ?? null, JSON.stringify(cortes)],
    );
    return { ok: true };
  });

  app.get<{ Params: { id: string } }>('/api/public/acougue/bases/:id/historico', { onRequest: [auth] }, async (req) =>
    query(
      `SELECT id, base_nome AS "baseNome", custo_kg::float8 AS "custoKg", margem::float8 AS margem,
              usuario, cortes, created_at AS "createdAt"
       FROM mn_acougue_historico WHERE base_id = $1 ORDER BY created_at DESC LIMIT 30`,
      [req.params.id],
    ),
  );
}
