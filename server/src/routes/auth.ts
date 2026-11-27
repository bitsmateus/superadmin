import { podeVerFinanceiro } from '../lib/financeiro.js';
import { FastifyInstance } from 'fastify';
import bcrypt from 'bcrypt';
import { query, queryOne } from '../db.js';
import { getOnlineUserIds, broadcastToUser } from '../sse.js';
import { limparPreferenciasDaInicio, type PreferenciasDaInicio } from '../lib/preferenciasDaInicio.js';

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
  /** Ordem do menu lateral escolhida por essa pessoa: { grupo: [chave do item, ...] }. */
  sidebarOrder: Record<string, string[]> | null;
  /** Itens do menu fixados por essa pessoa (chave do item) — aparecem num grupo "Fixados" no topo. */
  pinnedMenu: string[] | null;
  /** Tela inicial: os 3 atalhos e o acesso rápido que a pessoa escolheu (caminhos das telas). */
  homePrefs: PreferenciasDaInicio | null;
  created_at: string;
  /** Só preenchido quando restrictAccess=true — os itens de menu que esse usuário pode ver. */
  menuAccess?: string[];
}

/** Anexa a allowlist de itens de menu do próprio usuário — só relevante quando ele está restrito;
 * é isso que o front usa (Sidebar/rotas) pra saber exatamente o que essa sessão pode enxergar. */
async function attachMenuAccess<T extends { id: string; restrictAccess: boolean; role?: string }>(profile: T): Promise<T & { menuAccess?: string[]; financeiro: boolean }> {
  // "financeiro" diz ao front se mostra o Financeiro. Quem decide é o servidor (lib/financeiro.ts), e a API
  // recusa de qualquer jeito pra quem não é Ian ou Mateus.
  const financeiro = podeVerFinanceiro(profile.id, profile.role);
  if (!profile.restrictAccess) return { ...profile, financeiro };
  const rows = await query<{ menu_key: string }>('SELECT menu_key FROM user_menu_access WHERE user_id = $1', [profile.id]);
  return { ...profile, menuAccess: rows.map((r) => r.menu_key), financeiro };
}

export async function authRoutes(app: FastifyInstance) {
  // POST /api/auth/login
  app.post<{ Body: { email: string; password: string } }>(
    '/api/auth/login',
    { schema: { body: { type: 'object', required: ['email', 'password'], properties: { email: { type: 'string' }, password: { type: 'string' } } } } },
    async (req, reply) => {
      const { email, password } = req.body;
      const profile = await queryOne<Profile & { password_hash: string; suspended_at: string | null }>(
        `SELECT id, email, name, role, area, restrict_access AS "restrictAccess", theme,
                sidebar_order AS "sidebarOrder", pinned_menu AS "pinnedMenu", home_prefs AS "homePrefs", created_at, password_hash, suspended_at
         FROM profiles WHERE lower(email) = lower($1)`,
        [email.trim()]
      );
      if (!profile) return reply.status(401).send({ message: 'Credenciais inválidas' });

      const valid = await bcrypt.compare(password, profile.password_hash);
      if (!valid) return reply.status(401).send({ message: 'Credenciais inválidas' });
      if (profile.suspended_at) return reply.status(403).send({ message: 'Usuário suspenso. Fale com um administrador.' });

      const token = app.jwt.sign(
        { sub: profile.id, email: profile.email, role: profile.role },
        { expiresIn: '7d' }
      );

      const { password_hash: _, suspended_at: __, ...user } = profile;
      return { token, user: await attachMenuAccess(user) };
    }
  );

  // GET /api/auth/me
  app.get('/api/auth/me', { onRequest: [app.authenticate] }, async (req, reply) => {
    const { sub } = req.user as { sub: string };
    const profile = await queryOne<Profile>(
      `SELECT id, email, name, role, area, restrict_access AS "restrictAccess", theme,
              sidebar_order AS "sidebarOrder", pinned_menu AS "pinnedMenu", home_prefs AS "homePrefs", created_at
       FROM profiles WHERE id = $1`,
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
      `SELECT id, email, name, role, area, restrict_access AS "restrictAccess", created_at,
              suspended_at AS "suspendedAt", removed_at AS "removedAt" FROM profiles ORDER BY created_at`
    );
  });

  // GET /api/team — lista enxuta (id/name/email) para seletor de responsável.
  // Disponível a qualquer usuário autenticado (ferramenta interna do time).
  app.get('/api/team', { onRequest: [app.authenticate] }, async () => {
    // inativo: suspenso ou removido — o front tira o nome dele das listas de escolha (ex.: SDR), não do que já está gravado.
    return query(`SELECT id, name, email, role, area, (suspended_at IS NOT NULL OR removed_at IS NOT NULL) AS inativo
                  FROM profiles ORDER BY name NULLS LAST, email`);
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
        // Perfil Usuário (suporte) nasce e fica SEMPRE restrito: só vê o que o admin marcar em Permissões.
        [email.trim().toLowerCase(), name, role || 'suporte', area || 'ambos', (role || 'suporte') === 'suporte' ? true : (restrictAccess ?? false), hash]
      );
      return reply.status(201).send(created);
    }
  );

  // PATCH /api/users/:id
  app.patch<{ Params: { id: string }; Body: { name?: string; email?: string; role?: string; area?: string; restrictAccess?: boolean; password?: string; theme?: 'light' | 'dark'; sidebarOrder?: Record<string, string[]>; pinnedMenu?: string[]; homePrefs?: unknown } }>(
    '/api/users/:id',
    { onRequest: [app.authenticate] },
    async (req, reply) => {
      const { sub, role: actorRole } = req.user as { sub: string; role: string };
      const { id } = req.params;
      const { name, email, role, area, restrictAccess, password, theme, sidebarOrder, pinnedMenu } = req.body;
      // A tela inicial é da pessoa, igual ao menu: só a própria.
      if (req.body.homePrefs !== undefined && id !== sub) {
        return reply.status(403).send({ message: 'Só é possível alterar a própria tela inicial' });
      }
      const homePrefs = req.body.homePrefs === undefined ? undefined : limparPreferenciasDaInicio(req.body.homePrefs);
      if (homePrefs === null) return reply.status(400).send({ message: 'Preferências da tela inicial inválidas.' });

      // Tema é preferência pessoal — qualquer um pode mudar o PRÓPRIO, mas não o de outra pessoa
      // (nem admin edita o tema de outro usuário por essa rota).
      if (theme !== undefined && id !== sub) {
        return reply.status(403).send({ message: 'Só é possível alterar o próprio tema' });
      }
      // A ordem do menu e os fixados são da pessoa, igual ao tema — nem admin mexe no menu dos outros.
      if (sidebarOrder !== undefined && id !== sub) {
        return reply.status(403).send({ message: 'Só é possível alterar o próprio menu' });
      }
      if (pinnedMenu !== undefined && id !== sub) {
        return reply.status(403).send({ message: 'Só é possível alterar os próprios fixados' });
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
      if (sidebarOrder !== undefined) { sets.push(`sidebar_order = $${i++}`); params.push(JSON.stringify(sidebarOrder)); }
      if (pinnedMenu !== undefined) { sets.push(`pinned_menu = $${i++}`); params.push(JSON.stringify(pinnedMenu)); }
      if (homePrefs !== undefined) { sets.push(`home_prefs = $${i++}`); params.push(JSON.stringify(homePrefs)); }
      if (password !== undefined) {
        const hash = await bcrypt.hash(password, 10);
        sets.push(`password_hash = $${i++}`);
        params.push(hash);
      }
      if (!sets.length) return reply.status(400).send({ message: 'Nada para atualizar' });

      params.push(id);
      const [updated] = await query<Profile>(
        `UPDATE profiles SET ${sets.join(', ')} WHERE id = $${i}
         RETURNING id, email, name, role, area, restrict_access AS "restrictAccess", theme,
                   sidebar_order AS "sidebarOrder", pinned_menu AS "pinnedMenu", home_prefs AS "homePrefs", created_at`,
        params
      );
      // Usuário (suporte) não tem "acesso total": qualquer edição o mantém restrito ao que estiver marcado.
      if (updated && (updated as { role?: string }).role === 'suporte' && !(updated as { restrictAccess?: boolean }).restrictAccess) {
        await query('UPDATE profiles SET restrict_access = true WHERE id = $1', [id]);
        (updated as { restrictAccess?: boolean }).restrictAccess = true;
      }
      if (!updated) return reply.status(404).send({ message: 'Usuário não encontrado' });
      // Quem edita o PRÓPRIO perfil (tema, ordem do menu, fixados, nome, senha) recebe de volta também as
      // permissões e a marca do Financeiro — sem isso o front trocava o perfil por um sem permissões e o menu
      // "sumia" depois de fixar um item.
      if (updated && id === sub) return attachMenuAccess(updated as Profile);
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

  // POST /api/users/:id/suspender { suspenso } — admin only. Suspenso não entra e é deslogado na hora; lembretes, tarefas
  // e histórico ficam como estão. Reativar (suspenso=false) também desfaz o "remover".
  app.post<{ Params: { id: string }; Body: { suspenso?: boolean } }>(
    '/api/users/:id/suspender',
    { onRequest: [app.authenticate] },
    async (req, reply) => {
      const { sub, role } = req.user as { sub: string; role: string };
      if (role !== 'admin') return reply.status(403).send({ message: 'Acesso negado' });
      const suspenso = req.body?.suspenso !== false;
      if (suspenso && req.params.id === sub) return reply.status(400).send({ message: 'Você não pode suspender a si mesmo.' });
      const [updated] = await query<{ id: string }>(
        suspenso
          ? 'UPDATE profiles SET suspended_at = COALESCE(suspended_at, NOW()), session_invalidated_at = NOW() WHERE id = $1 RETURNING id'
          : 'UPDATE profiles SET suspended_at = NULL, removed_at = NULL WHERE id = $1 RETURNING id',
        [req.params.id]
      );
      if (!updated) return reply.status(404).send({ message: 'Usuário não encontrado' });
      if (suspenso) broadcastToUser(req.params.id, 'auth', 'force_logout', { user_id: req.params.id });
      return reply.status(204).send();
    }
  );

  // DELETE /api/users/:id — admin only. NÃO apaga a linha (apagaria lembretes, tarefas e avisos dele em cascata): some
  // da Equipe e fica sem acesso.
  app.delete<{ Params: { id: string } }>(
    '/api/users/:id',
    { onRequest: [app.authenticate] },
    async (req, reply) => {
      const { role } = req.user as { role: string };
      if (role !== 'admin') return reply.status(403).send({ message: 'Acesso negado' });
      const { sub } = req.user as { sub: string };
      if (req.params.id === sub) return reply.status(400).send({ message: 'Você não pode remover a si mesmo.' });
      await query(
        'UPDATE profiles SET removed_at = NOW(), suspended_at = COALESCE(suspended_at, NOW()), session_invalidated_at = NOW() WHERE id = $1',
        [req.params.id]
      );
      broadcastToUser(req.params.id, 'auth', 'force_logout', { user_id: req.params.id });
      return reply.status(204).send();
    }
  );
}
