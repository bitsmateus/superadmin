import { FastifyInstance } from 'fastify';
import bcrypt from 'bcrypt';
import { query, queryOne } from '../db.js';

interface Profile {
  id: string;
  email: string;
  name: string | null;
  role: string;
  created_at: string;
}

export async function authRoutes(app: FastifyInstance) {
  // POST /api/auth/login
  app.post<{ Body: { email: string; password: string } }>(
    '/api/auth/login',
    { schema: { body: { type: 'object', required: ['email', 'password'], properties: { email: { type: 'string' }, password: { type: 'string' } } } } },
    async (req, reply) => {
      const { email, password } = req.body;
      const profile = await queryOne<Profile & { password_hash: string }>(
        'SELECT * FROM profiles WHERE lower(email) = lower($1)',
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
      return { token, user };
    }
  );

  // GET /api/auth/me
  app.get('/api/auth/me', { onRequest: [app.authenticate] }, async (req, reply) => {
    const { sub } = req.user as { sub: string };
    const profile = await queryOne<Profile>(
      'SELECT id, email, name, role, created_at FROM profiles WHERE id = $1',
      [sub]
    );
    if (!profile) return reply.status(404).send({ message: 'Usuário não encontrado' });
    return profile;
  });

  // GET /api/users — admin only
  app.get('/api/users', { onRequest: [app.authenticate] }, async (req, reply) => {
    const { role } = req.user as { role: string };
    if (role !== 'admin') return reply.status(403).send({ message: 'Acesso negado' });
    return query<Profile>('SELECT id, email, name, role, created_at FROM profiles ORDER BY created_at');
  });

  // POST /api/users — admin only, creates a new user
  app.post<{ Body: { email: string; name: string; password: string; role: string } }>(
    '/api/users',
    { onRequest: [app.authenticate] },
    async (req, reply) => {
      const { role: actorRole } = req.user as { role: string };
      if (actorRole !== 'admin') return reply.status(403).send({ message: 'Acesso negado' });

      const { email, name, password, role } = req.body;
      const hash = await bcrypt.hash(password, 10);
      const [created] = await query<Profile>(
        `INSERT INTO profiles (email, name, role, password_hash)
         VALUES ($1, $2, $3, $4)
         RETURNING id, email, name, role, created_at`,
        [email.trim().toLowerCase(), name, role || 'suporte', hash]
      );
      return reply.status(201).send(created);
    }
  );

  // PATCH /api/users/:id
  app.patch<{ Params: { id: string }; Body: { name?: string; role?: string; password?: string } }>(
    '/api/users/:id',
    { onRequest: [app.authenticate] },
    async (req, reply) => {
      const { sub, role: actorRole } = req.user as { sub: string; role: string };
      const { id } = req.params;
      const { name, role, password } = req.body;

      // Only admin can change roles or edit other users
      if (id !== sub && actorRole !== 'admin') {
        return reply.status(403).send({ message: 'Acesso negado' });
      }
      if (role && actorRole !== 'admin') {
        return reply.status(403).send({ message: 'Somente admin pode alterar roles' });
      }

      const sets: string[] = [];
      const params: unknown[] = [];
      let i = 1;

      if (name !== undefined) { sets.push(`name = $${i++}`); params.push(name); }
      if (role !== undefined) { sets.push(`role = $${i++}`); params.push(role); }
      if (password !== undefined) {
        const hash = await bcrypt.hash(password, 10);
        sets.push(`password_hash = $${i++}`);
        params.push(hash);
      }
      if (!sets.length) return reply.status(400).send({ message: 'Nada para atualizar' });

      params.push(id);
      const [updated] = await query<Profile>(
        `UPDATE profiles SET ${sets.join(', ')} WHERE id = $${i} RETURNING id, email, name, role, created_at`,
        params
      );
      if (!updated) return reply.status(404).send({ message: 'Usuário não encontrado' });
      return updated;
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
