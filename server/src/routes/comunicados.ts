import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { query, queryOne, withTransaction } from '../db.js';
import { temMarcaDeMenu } from '../lib/acessoMenu.js';
import { telefoneComDdi } from '../lib/integracaoCards.js';
import { sendOfficialTemplate } from '../lib/officialApi.js';
import {
  TEMPLATES_COMUNICADO,
  montarContatos,
  parametrosDoTemplate,
  processarDisparos,
} from '../lib/comunicados.js';

/**
 * Menu "Comunicados": cadastro das atualizações (changelog que o cliente vê em /novidades), base de
 * contatos dos clientes e disparo por template da API Oficial. Ver e editar segue a marca de menu
 * "comunicados"; disparar (inclusive o teste) é só do administrador — sai mensagem pra base inteira.
 */

const TIPOS = ['novidade', 'melhoria', 'correcao', 'aviso'] as const;

interface PostRow {
  id: string;
  titulo: string;
  corpo: string;
  tipo: string;
  publicado_em: string | null;
  criado_por: string;
  created_at: string;
  updated_at: string;
}

type Usuario = { sub: string; role?: string; email?: string };

async function podeVer(req: FastifyRequest, reply: FastifyReply): Promise<boolean> {
  const u = req.user as Usuario;
  if (await temMarcaDeMenu(u.sub, u.role, 'comunicados')) return true;
  reply.status(403).send({ message: 'Acesso negado' });
  return false;
}

function soAdmin(req: FastifyRequest, reply: FastifyReply): boolean {
  if ((req.user as Usuario).role === 'admin') return true;
  reply.status(403).send({ message: 'Só administrador pode disparar' });
  return false;
}

function tipoValido(t: unknown): string {
  return TIPOS.includes(t as (typeof TIPOS)[number]) ? (t as string) : 'novidade';
}

export async function comunicadosRoutes(app: FastifyInstance) {
  // ── Público ────────────────────────────────────────────────────────────────
  app.get('/api/public/novidades', async () =>
    query<Omit<PostRow, 'criado_por' | 'created_at' | 'updated_at'>>(
      `SELECT id, titulo, corpo, tipo, publicado_em FROM comunicado_posts
       WHERE publicado_em IS NOT NULL ORDER BY publicado_em DESC LIMIT 200`,
    ),
  );

  // ── Atualizações ───────────────────────────────────────────────────────────
  app.get('/api/comunicados/posts', { onRequest: [app.authenticate] }, async (req, reply) => {
    if (!(await podeVer(req, reply))) return;
    return query<PostRow>(
      `SELECT * FROM comunicado_posts ORDER BY COALESCE(publicado_em, created_at) DESC`,
    );
  });

  app.post<{ Body: { titulo?: string; corpo?: string; tipo?: string; publicar?: boolean } }>(
    '/api/comunicados/posts',
    { onRequest: [app.authenticate] },
    async (req, reply) => {
      if (!(await podeVer(req, reply))) return;
      const titulo = (req.body?.titulo ?? '').trim();
      if (!titulo) return reply.status(400).send({ message: 'Informe o título' });
      return queryOne<PostRow>(
        `INSERT INTO comunicado_posts (titulo, corpo, tipo, publicado_em, criado_por)
         VALUES ($1, $2, $3, CASE WHEN $4 THEN NOW() END, $5) RETURNING *`,
        [titulo, (req.body?.corpo ?? '').trim(), tipoValido(req.body?.tipo), !!req.body?.publicar, (req.user as Usuario).email ?? ''],
      );
    },
  );

  app.patch<{ Params: { id: string }; Body: { titulo?: string; corpo?: string; tipo?: string; publicado?: boolean } }>(
    '/api/comunicados/posts/:id',
    { onRequest: [app.authenticate] },
    async (req, reply) => {
      if (!(await podeVer(req, reply))) return;
      const b = req.body ?? {};
      if (b.titulo !== undefined && !b.titulo.trim()) return reply.status(400).send({ message: 'Informe o título' });
      // publicado: true mantém a data da 1ª publicação (só preenche se estava em rascunho); false volta pra rascunho.
      const post = await queryOne<PostRow>(
        `UPDATE comunicado_posts SET
           titulo = COALESCE($2, titulo),
           corpo = COALESCE($3, corpo),
           tipo = COALESCE($4, tipo),
           publicado_em = CASE WHEN $5::boolean IS NULL THEN publicado_em
                               WHEN $5 THEN COALESCE(publicado_em, NOW()) ELSE NULL END,
           updated_at = NOW()
         WHERE id = $1 RETURNING *`,
        [
          req.params.id,
          b.titulo?.trim() ?? null,
          b.corpo !== undefined ? b.corpo.trim() : null,
          b.tipo !== undefined ? tipoValido(b.tipo) : null,
          b.publicado ?? null,
        ],
      );
      if (!post) return reply.status(404).send({ message: 'Atualização não encontrada' });
      return post;
    },
  );

  app.delete<{ Params: { id: string } }>('/api/comunicados/posts/:id', { onRequest: [app.authenticate] }, async (req, reply) => {
    if (!(await podeVer(req, reply))) return;
    await query('DELETE FROM comunicado_posts WHERE id = $1', [req.params.id]);
    return { ok: true };
  });

  // ── Contatos ───────────────────────────────────────────────────────────────
  app.get('/api/comunicados/contatos', { onRequest: [app.authenticate] }, async (req, reply) => {
    if (!(await podeVer(req, reply))) return;
    return montarContatos();
  });

  // Liga/desliga o contato no disparo (vale pros contatos que vêm de clients e pros avulsos).
  app.put<{ Params: { numero: string }; Body: { incluido?: boolean } }>(
    '/api/comunicados/contatos/:numero',
    { onRequest: [app.authenticate] },
    async (req, reply) => {
      if (!(await podeVer(req, reply))) return;
      await query(
        `INSERT INTO comunicado_contatos (numero, incluido) VALUES ($1, $2)
         ON CONFLICT (numero) DO UPDATE SET incluido = EXCLUDED.incluido, updated_at = NOW()`,
        [req.params.numero, req.body?.incluido !== false],
      );
      return { ok: true };
    },
  );

  app.post<{ Body: { numero?: string; nome?: string } }>(
    '/api/comunicados/contatos',
    { onRequest: [app.authenticate] },
    async (req, reply) => {
      if (!(await podeVer(req, reply))) return;
      const numero = telefoneComDdi(req.body?.numero);
      if (!numero) return reply.status(400).send({ message: 'Número inválido — use DDD + número' });
      await query(
        `INSERT INTO comunicado_contatos (numero, nome, manual, incluido) VALUES ($1, $2, true, true)
         ON CONFLICT (numero) DO UPDATE SET nome = EXCLUDED.nome, manual = true, incluido = true, updated_at = NOW()`,
        [numero, (req.body?.nome ?? '').trim()],
      );
      return { ok: true };
    },
  );

  // Só some o avulso: os que vêm de clients se tiram pelo switch (ou no cadastro do cliente).
  app.delete<{ Params: { numero: string } }>('/api/comunicados/contatos/:numero', { onRequest: [app.authenticate] }, async (req, reply) => {
    if (!(await podeVer(req, reply))) return;
    await query('DELETE FROM comunicado_contatos WHERE numero = $1 AND manual', [req.params.numero]);
    return { ok: true };
  });

  // ── Templates e disparos ───────────────────────────────────────────────────
  app.get('/api/comunicados/templates', { onRequest: [app.authenticate] }, async (req, reply) => {
    if (!(await podeVer(req, reply))) return;
    return TEMPLATES_COMUNICADO;
  });

  app.post<{ Body: { numero?: string; template?: string; link?: string; texto?: string } }>(
    '/api/comunicados/teste',
    { onRequest: [app.authenticate] },
    async (req, reply) => {
      if (!soAdmin(req, reply)) return;
      const t = TEMPLATES_COMUNICADO.find((x) => x.id === req.body?.template);
      if (!t) return reply.status(400).send({ message: 'Template desconhecido' });
      const numero = telefoneComDdi(req.body?.numero);
      if (!numero) return reply.status(400).send({ message: 'Número inválido' });
      const res = await sendOfficialTemplate(numero, t.nome, parametrosDoTemplate(t, 'Teste', req.body ?? {}));
      if (res.reason === 'not_configured')
        return reply.status(400).send({ message: 'API Oficial não configurada (OFFICIAL_API_URL / OFFICIAL_API_TOKEN).' });
      if (!res.ok) return reply.status(502).send({ message: `Falha no envio: ${[res.status, res.detail].filter(Boolean).join(' — ')}` });
      return { ok: true };
    },
  );

  app.get('/api/comunicados/disparos', { onRequest: [app.authenticate] }, async (req, reply) => {
    if (!(await podeVer(req, reply))) return;
    return query(
      `SELECT d.id, d.template, d.parametros, d.status, d.criado_por, d.created_at, d.finished_at,
              COUNT(i.*)::int AS total,
              COUNT(i.*) FILTER (WHERE i.status = 'enviado')::int AS enviados,
              COUNT(i.*) FILTER (WHERE i.status = 'falhou')::int AS falhas,
              COUNT(i.*) FILTER (WHERE i.status = 'pendente')::int AS pendentes
       FROM comunicado_disparos d LEFT JOIN comunicado_disparo_itens i ON i.disparo_id = d.id
       GROUP BY d.id ORDER BY d.created_at DESC LIMIT 50`,
    );
  });

  app.get<{ Params: { id: string } }>('/api/comunicados/disparos/:id/itens', { onRequest: [app.authenticate] }, async (req, reply) => {
    if (!(await podeVer(req, reply))) return;
    return query(
      `SELECT id, numero, nome, status, detalhe, enviado_em FROM comunicado_disparo_itens
       WHERE disparo_id = $1 ORDER BY nome, numero`,
      [req.params.id],
    );
  });

  app.post<{ Body: { template?: string; link?: string; texto?: string } }>(
    '/api/comunicados/disparos',
    { onRequest: [app.authenticate] },
    async (req, reply) => {
      if (!soAdmin(req, reply)) return;
      const t = TEMPLATES_COMUNICADO.find((x) => x.id === req.body?.template);
      if (!t) return reply.status(400).send({ message: 'Template desconhecido' });
      const link = (req.body?.link ?? '').trim();
      const texto = (req.body?.texto ?? '').trim();
      if (t.variaveis.includes('link') && !link) return reply.status(400).send({ message: 'Informe o link' });
      if (t.variaveis.includes('texto') && !texto) return reply.status(400).send({ message: 'Escreva o texto do aviso' });
      const em = await queryOne("SELECT 1 FROM comunicado_disparos WHERE status = 'enviando'");
      if (em) return reply.status(409).send({ message: 'Já tem um disparo em andamento — espere terminar ou cancele.' });

      const alvo = (await montarContatos()).filter((c) => c.incluido && !c.invalido);
      if (alvo.length === 0) return reply.status(400).send({ message: 'Nenhum contato incluído no disparo' });

      const id = await withTransaction(async (client) => {
        const { rows: [d] } = await client.query<{ id: string }>(
          `INSERT INTO comunicado_disparos (template, parametros, criado_por) VALUES ($1, $2, $3) RETURNING id`,
          [t.id, JSON.stringify({ link, texto }), (req.user as Usuario).email ?? ''],
        );
        await client.query(
          `INSERT INTO comunicado_disparo_itens (disparo_id, numero, nome)
           SELECT $1, x.numero, x.nome FROM jsonb_to_recordset($2::jsonb) AS x(numero TEXT, nome TEXT)`,
          [d.id, JSON.stringify(alvo.map((c) => ({ numero: c.numero, nome: c.nome })))],
        );
        return d.id;
      });
      processarDisparos().catch((err) => console.error('[comunicados] erro no disparo', err instanceof Error ? err.message : err));
      return { id, total: alvo.length };
    },
  );

  app.post<{ Params: { id: string } }>('/api/comunicados/disparos/:id/cancelar', { onRequest: [app.authenticate] }, async (req, reply) => {
    if (!soAdmin(req, reply)) return;
    await query(
      `UPDATE comunicado_disparos SET status = 'cancelado', finished_at = NOW() WHERE id = $1 AND status = 'enviando'`,
      [req.params.id],
    );
    await query(
      `UPDATE comunicado_disparo_itens SET status = 'cancelado' WHERE disparo_id = $1 AND status = 'pendente'`,
      [req.params.id],
    );
    return { ok: true };
  });
}
