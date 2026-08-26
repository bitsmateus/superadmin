import { FastifyInstance } from 'fastify';
import bcrypt from 'bcrypt';
import { query, queryOne } from '../db.js';
import { getOnlineUserIds, broadcastToUser } from '../sse.js';

interface Profile {
  id: string;
  email: string;
  name: string | null;
  role: string;
  /** Área no funil: 'comercial' | 'entrega' | 'ambos'. Nulo = ambos. */
  area: string | null;
  /** Trava opcional de acesso (só relevante pro papel 'suporte'/"Usuário"): restringe a itens de
   * menu e quadros específicos (ver user_menu_access/user_board_access). Default false = sem restrição. */
  restrictAccess: boolean;
  /** Preferência de tema salva na conta — null = nunca escolheu, usa o padrão do dispositivo. */
  theme: 'light' | 'dark' | null;
  created_at: string;
  /** Só preenchido quando restrictAccess=true — os itens de menu que esse usuário pode ver. */
  menuAccess?: string[];
}

/** Anexa a allowlist de itens de menu do próprio usuário — só relevante quando ele está restrito;
 * é isso que o front usa (Sidebar/rotas) pra saber exatamente o que essa sessão pode enxergar. */
async function attachMenuAccess<T extends { id: string; restrictAccess: boolean }>(profile: T): Promise<T & { menuAccess?: string[] }> {
  if (!profile.restrictAccess) return profile;
  const rows = await query<{ menu_key: string }>('SELECT menu_key FROM user_menu_access WHERE user_id = $1', [profile.id]);
  return { ...profile, menuAccess: rows.map((r) => r.menu_key) };
}

export async function authRoutes(app: FastifyInstance) {
  // POST /api/auth/login
  app.post<{ Body: { email: string; password: string } }>(
    '/api/auth/login',
    { schema: { body: { type: 'object', required: ['email', 'password'], properties: { email: { type: 'string' }, password: { type: 'string' } } } } },
    async (req, reply) => {
      const { email, password } = req.body;
      const profile = await queryOne<Profile & { password_hash: string }>(
        `SELECT id, email, name, role, area, restrict_access AS "restrictAccess", theme, created_at, password_hash
         FROM profiles WHERE lower(email) = lower($1)`,
        [email.trim()]
      );
      if (!profile) return reply.status(401).send({ message: 'Credenciais inválidas' });

      const valid = await bcrypt.compare(password, profile.password_hash);
      if (!valid) return reply.status(401).send({ message: 'Credenciais inválidas' });

      const token = app.jwt.sign(
        { sub: profile.id, email: profile.email, role: profile.role },
        { expiresIn: '7d' }
      );

      const { password_hash: _, ...user } = profile;
      return { token, user: await attachMenuAccess(user) };
    }
  );

  // GET /api/auth/me
  app.get('/api/auth/me', { onRequest: [app.authenticate] }, async (req, reply) => {
    const { sub } = req.user as { sub: string };
    const profile = await queryOne<Profile>(
      'SELECT id, email, name, role, area, restrict_access AS "restrictAccess", theme, created_at FROM profiles WHERE id = $1',
      [sub]
    );
    if (!profile) return reply.status(404).send({ message: 'Usuário não encontrado' });
    return attachMenuAccess(profile);
  });

  // GET /api/users — admin only
  app.get('/api/users', { onRequest: [app.authenticate] }, async (req, reply) => {
    const { role } = req.user as { role: string };
    if (role !== 'admin') return reply.status(403).send({ message: 'Acesso negado' });
    return query<Profile>(
      'SELECT id, email, name, role, area, restrict_access AS "restrictAccess", created_at FROM profiles ORDER BY created_at'
    );
  });

  // GET /api/team — lista enxuta (id/name/email) para seletor de responsável.
  // Disponível a qualquer usuário autenticado (ferramenta interna do time).
  app.get('/api/team', { onRequest: [app.authenticate] }, async () => {
    return query('SELECT id, name, email, role, area FROM profiles ORDER BY name NULLS LAST, email');
  });

  // POST /api/users — admin only, creates a new user
  app.post<{ Body: { email: string; name: string; password: string; role: string; area?: string; restrictAccess?: boolean } }>(
    '/api/users',
    { onRequest: [app.authenticate] },
    async (req, reply) => {
      const { role: actorRole } = req.user as { role: string };
      if (actorRole !== 'admin') return reply.status(403).send({ message: 'Acesso negado' });

      const { email, name, password, role, area, restrictAccess } = req.body;
      const hash = await bcrypt.hash(password, 10);
      const [created] = await query<Profile>(
        `INSERT INTO profiles (email, name, role, area, restrict_access, password_hash)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING id, email, name, role, area, restrict_access AS "restrictAccess", created_at`,
        [email.trim().toLowerCase(), name, role || 'suporte', area || 'ambos', restrictAccess ?? false, hash]
      );
      return reply.status(201).send(created);
    }
  );

  // PATCH /api/users/:id
  app.patch<{ Params: { id: string }; Body: { name?: string; email?: string; role?: string; area?: string; restrictAccess?: boolean; password?: string; theme?: 'light' | 'dark' } }>(
    '/api/users/:id',
    { onRequest: [app.authenticate] },
    async (req, reply) => {
      const { sub, role: actorRole } = req.user as { sub: string; role: string };
      const { id } = req.params;
      const { name, email, role, area, restrictAccess, password, theme } = req.body;

      // Tema é preferência pessoal — qualquer um pode mudar o PRÓPRIO, mas não o de outra pessoa
      // (nem admin edita o tema de outro usuário por essa rota).
      if (theme !== undefined && id !== sub) {
        return reply.status(403).send({ message: 'Só é possível alterar o próprio tema' });
      }

      // Only admin can change roles or edit other users
      if (id !== sub && actorRole !== 'admin') {
        return reply.status(403).send({ message: 'Acesso negado' });
      }
      if (role && actorRole !== 'admin') {
        return reply.status(403).send({ message: 'Somente admin pode alterar roles' });
      }
      if (email && actorRole !== 'admin') {
        return reply.status(403).send({ message: 'Somente admin pode alterar o e-mail' });
      }
      // Área e a trava de acesso são atributos organizacionais — só admin.
      if (area && actorRole !== 'admin') {
        return reply.status(403).send({ message: 'Somente admin pode alterar a área' });
      }
      if (restrictAccess !== undefined && actorRole !== 'admin') {
        return reply.status(403).send({ message: 'Somente admin pode alterar a restrição de acesso' });
      }

      const sets: string[] = [];
      const params: unknown[] = [];
      let i = 1;

      if (name !== undefined) { sets.push(`name = $${i++}`); params.push(name); }
      if (email !== undefined) { sets.push(`email = $${i++}`); params.push(email.trim().toLowerCase()); }
      if (role !== undefined) { sets.push(`role = $${i++}`); params.push(role); }
      if (area !== undefined) { sets.push(`area = $${i++}`); params.push(area); }
      if (restrictAccess !== undefined) { sets.push(`restrict_access = $${i++}`); params.push(restrictAccess); }
      if (theme !== undefined) { sets.push(`theme = $${i++}`); params.push(theme); }
      if (password !== undefined) {
        const hash = await bcrypt.hash(password, 10);
        sets.push(`password_hash = $${i++}`);
        params.push(hash);
      }
      if (!sets.length) return reply.status(400).send({ message: 'Nada para atualizar' });

      params.push(id);
      const [updated] = await query<Profile>(
        `UPDATE profiles SET ${sets.join(', ')} WHERE id = $${i} RETURNING id, email, name, role, area, restrict_access AS "restrictAccess", theme, created_at`,
        params
      );
      if (!updated) return reply.status(404).send({ message: 'Usuário não encontrado' });
      return updated;
    }
  );

  // GET /api/users/online — admin only. Estado inicial de "quem está online" (ver sse.ts,
  // presence) — depois disso a tela de Equipe se atualiza sozinha pelos eventos de presence.
  app.get('/api/users/online', { onRequest: [app.authenticate] }, async (req, reply) => {
    const { role } = req.user as { role: string };
    if (role !== 'admin') return reply.status(403).send({ message: 'Acesso negado' });
    return getOnlineUserIds();
  });

  // POST /api/users/:id/logout — admin only. "Desloga" a pessoa: qualquer token dela emitido
  // antes de agora vira inválido (ver session_invalidated_at em app.authenticate), e quem estiver
  // com o app aberto agora é avisado na hora pelo SSE, sem precisar esperar a próxima requisição
  // falhar pra perceber.
  app.post<{ Params: { id: string } }>(
    '/api/users/:id/logout',
    { onRequest: [app.authenticate] },
    async (req, reply) => {
      const { role } = req.user as { role: string };
      if (role !== 'admin') return reply.status(403).send({ message: 'Acesso negado' });
      const [updated] = await query<{ id: string }>(
        'UPDATE profiles SET session_invalidated_at = NOW() WHERE id = $1 RETURNING id',
        [req.params.id]
      );
      if (!updated) return reply.status(404).send({ message: 'Usuário não encontrado' });
      broadcastToUser(req.params.id, 'auth', 'force_logout', { user_id: req.params.id });
      return reply.status(204).send();
    }
  );

  // DELETE /api/users/:id — admin only
  app.delete<{ Params: { id: string } }>(
    '/api/users/:id',
    { onRequest: [app.authenticate] },
    async (req, reply) => {
      const { role } = req.user as { role: string };
      if (role !== 'admin') return reply.status(403).send({ message: 'Acesso negado' });
      await query('DELETE FROM profiles WHERE id = $1', [req.params.id]);
      return reply.status(204).send();
    }
  );
}
