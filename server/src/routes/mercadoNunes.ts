import { FastifyInstance } from 'fastify';
import { query, withTransaction } from '../db.js';

/** Layouts salvos do gerador de cartazes do Mercado Nunes (/mercadonunes) — página pública, sem
 *  login. Guardado no banco (não no localStorage do navegador) pra todo mundo que usa a ferramenta
 *  ver e reaproveitar o mesmo layout, não só quem salvou. */
export async function mercadoNunesRoutes(app: FastifyInstance) {
  // Pastas — cadastro explícito (criadas num campo próprio, não "adivinhadas" a partir de
  // layouts), pra aparecerem no seletor mesmo antes de qualquer layout ser movido pra dentro.
  app.get('/api/public/mercadonunes/pastas', async () => {
    const pastas = await query('SELECT id, nome, created_at FROM mercadonunes_pastas ORDER BY nome ASC');
    return { pastas };
  });

  app.post<{ Body: { nome?: string } }>('/api/public/mercadonunes/pastas', async (req, reply) => {
    const nome = (req.body?.nome ?? '').trim();
    if (!nome) return reply.status(400).send({ message: 'Dê um nome pra pasta.' });
    // ON CONFLICT: já existe? devolve ela em vez de dar erro — criar duas vezes a mesma pasta
    // não deveria travar quem tá só tentando organizar.
    const [pasta] = await query(
      `INSERT INTO mercadonunes_pastas (nome) VALUES ($1)
       ON CONFLICT (nome) DO UPDATE SET nome = EXCLUDED.nome
       RETURNING id, nome, created_at`,
      [nome]
    );
    return reply.status(201).send(pasta);
  });

  // Renomeia a pasta e atualiza o texto guardado em todo layout que já estava nela (o vínculo é só
  // pelo nome, não por id — sem isso os layouts continuariam apontando pro nome antigo).
  app.patch<{ Params: { id: string }; Body: { nome?: string } }>(
    '/api/public/mercadonunes/pastas/:id',
    async (req, reply) => {
      const nome = (req.body?.nome ?? '').trim();
      if (!nome) return reply.status(400).send({ message: 'Dê um nome pra pasta.' });
      try {
        const pasta = await withTransaction(async (client) => {
          const { rows: antes } = await client.query('SELECT nome FROM mercadonunes_pastas WHERE id = $1', [req.params.id]);
          if (!antes.length) return null;
          const nomeAntigo = antes[0].nome as string;
          const { rows: atualizado } = await client.query(
            'UPDATE mercadonunes_pastas SET nome = $2 WHERE id = $1 RETURNING id, nome, created_at',
            [req.params.id, nome]
          );
          if (nomeAntigo !== nome) {
            await client.query('UPDATE mercadonunes_layouts SET pasta = $2 WHERE pasta = $1', [nomeAntigo, nome]);
          }
          return atualizado[0];
        });
        if (!pasta) return reply.status(404).send({ message: 'Pasta não encontrada.' });
        return pasta;
      } catch (err) {
        // unique_violation (nome já usado por outra pasta)
        if ((err as { code?: string }).code === '23505') {
          return reply.status(409).send({ message: 'Já existe uma pasta com esse nome.' });
        }
        throw err;
      }
    }
  );

  // Apaga a pasta, mas NÃO os layouts que estavam nela — eles voltam a ficar sem pasta.
  app.delete<{ Params: { id: string } }>('/api/public/mercadonunes/pastas/:id', async (req, reply) => {
    const encontrada = await withTransaction(async (client) => {
      const { rows } = await client.query('DELETE FROM mercadonunes_pastas WHERE id = $1 RETURNING nome', [req.params.id]);
      if (!rows.length) return false;
      await client.query('UPDATE mercadonunes_layouts SET pasta = NULL WHERE pasta = $1', [rows[0].nome]);
      return true;
    });
    if (!encontrada) return reply.status(404).send({ message: 'Pasta não encontrada.' });
    return reply.status(204).send();
  });

  app.get('/api/public/mercadonunes/layouts', async () => {
    const layouts = await query(
      'SELECT id, nome, patch, pasta, created_at FROM mercadonunes_layouts ORDER BY created_at ASC'
    );
    return { layouts };
  });

  app.post<{ Body: { nome?: string; patch?: Record<string, unknown>; pasta?: string | null } }>(
    '/api/public/mercadonunes/layouts',
    async (req, reply) => {
      const nome = (req.body?.nome ?? '').trim();
      if (!nome) return reply.status(400).send({ message: 'Dê um nome pro layout.' });
      const patch = req.body?.patch ?? {};
      const pasta = (req.body?.pasta ?? '').toString().trim() || null;
      // Rede de segurança: se por algum motivo chegar uma pasta que ainda não tá cadastrada
      // (cliente antigo, chamada direta na API), cadastra na hora — o seletor não deve "perder"
      // uma pasta que já está em uso.
      if (pasta) await query('INSERT INTO mercadonunes_pastas (nome) VALUES ($1) ON CONFLICT (nome) DO NOTHING', [pasta]);
      const [layout] = await query(
        'INSERT INTO mercadonunes_layouts (nome, patch, pasta) VALUES ($1, $2, $3) RETURNING id, nome, patch, pasta, created_at',
        [nome, JSON.stringify(patch), pasta]
      );
      return reply.status(201).send(layout);
    }
  );

  // Move um layout já salvo pra dentro (ou pra fora, com pasta null/vazia) de uma pasta.
  app.patch<{ Params: { id: string }; Body: { pasta?: string | null } }>(
    '/api/public/mercadonunes/layouts/:id',
    async (req, reply) => {
      const pasta = (req.body?.pasta ?? '').toString().trim() || null;
      if (pasta) await query('INSERT INTO mercadonunes_pastas (nome) VALUES ($1) ON CONFLICT (nome) DO NOTHING', [pasta]);
      const [layout] = await query(
        'UPDATE mercadonunes_layouts SET pasta = $2 WHERE id = $1 RETURNING id, nome, patch, pasta, created_at',
        [req.params.id, pasta]
      );
      if (!layout) return reply.status(404).send({ message: 'Layout não encontrado.' });
      return layout;
    }
  );

  app.delete<{ Params: { id: string } }>('/api/public/mercadonunes/layouts/:id', async (req, reply) => {
    const result = await query('DELETE FROM mercadonunes_layouts WHERE id = $1 RETURNING id', [req.params.id]);
    if (!result.length) return reply.status(404).send({ message: 'Layout não encontrado.' });
    return reply.status(204).send();
  });
}
