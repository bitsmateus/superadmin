import { FastifyInstance } from 'fastify';
import { query } from '../db.js';

/**
 * Edição do "modelo padrão" do Briefing público (admin-only): overrides de rótulo pros
 * campos já existentes (briefing_field_overrides, chave = texto original do rótulo) e
 * perguntas de texto livre novas (briefing_custom_questions), consumidas sem autenticação
 * pelo formulário público em GET /api/public/briefing-template (ver public.ts).
 */
export async function briefingTemplateRoutes(app: FastifyInstance) {
  // GET /api/briefing-field-overrides — admin only
  app.get('/api/briefing-field-overrides', { onRequest: [app.authenticate] }, async (req, reply) => {
    const { role } = req.user as { role: string };
    if (role !== 'admin') return reply.status(403).send({ message: 'Acesso negado' });
    return query('SELECT * FROM briefing_field_overrides ORDER BY field_key');
  });

  // PUT /api/briefing-field-overrides/:fieldKey — admin only. Body vazio (sem label/placeholder)
  // remove o override, voltando o campo ao rótulo padrão do código.
  app.put<{ Params: { fieldKey: string }; Body: { label?: string; placeholder?: string } }>(
    '/api/briefing-field-overrides/:fieldKey',
    { onRequest: [app.authenticate] },
    async (req, reply) => {
      const { role } = req.user as { role: string };
      if (role !== 'admin') return reply.status(403).send({ message: 'Acesso negado' });
      const label = req.body.label?.trim() || null;
      const placeholder = req.body.placeholder?.trim() || null;
      if (!label && !placeholder) {
        await query('DELETE FROM briefing_field_overrides WHERE field_key = $1', [req.params.fieldKey]);
        return reply.status(204).send();
      }
      const [row] = await query(
        `INSERT INTO briefing_field_overrides (field_key, label, placeholder, updated_at)
         VALUES ($1, $2, $3, NOW())
         ON CONFLICT (field_key) DO UPDATE SET label = $2, placeholder = $3, updated_at = NOW()
         RETURNING *`,
        [req.params.fieldKey, label, placeholder]
      );
      return row;
    }
  );

  // GET /api/briefing-custom-questions — admin only
  app.get('/api/briefing-custom-questions', { onRequest: [app.authenticate] }, async (req, reply) => {
    const { role } = req.user as { role: string };
    if (role !== 'admin') return reply.status(403).send({ message: 'Acesso negado' });
    return query('SELECT * FROM briefing_custom_questions ORDER BY position, created_at');
  });

  // POST /api/briefing-custom-questions — admin only
  app.post<{ Body: { fieldKey?: string; label?: string; placeholder?: string; type?: string; position?: number } }>(
    '/api/briefing-custom-questions',
    { onRequest: [app.authenticate] },
    async (req, reply) => {
      const { role } = req.user as { role: string };
      if (role !== 'admin') return reply.status(403).send({ message: 'Acesso negado' });
      const label = req.body.label?.trim();
      if (!label) return reply.status(400).send({ message: 'label é obrigatório' });
      const type = req.body.type === 'textarea' ? 'textarea' : 'text';
      const fieldKey = req.body.fieldKey?.trim() || `custom_${Date.now()}`;
      const [row] = await query(
        `INSERT INTO briefing_custom_questions (field_key, label, placeholder, type, position)
         VALUES ($1, $2, $3, $4, $5) RETURNING *`,
        [fieldKey, label, req.body.placeholder?.trim() || null, type, req.body.position ?? 0]
      );
      return reply.status(201).send(row);
    }
  );

  // PATCH /api/briefing-custom-questions/:id — admin only
  app.patch<{
    Params: { id: string };
    Body: { label?: string; placeholder?: string; type?: string; position?: number };
  }>('/api/briefing-custom-questions/:id', { onRequest: [app.authenticate] }, async (req, reply) => {
    const { role } = req.user as { role: string };
    if (role !== 'admin') return reply.status(403).send({ message: 'Acesso negado' });
    const b = req.body;
    const fields: string[] = [];
    const values: unknown[] = [];
    let i = 1;
    if (b.label !== undefined) { fields.push(`label = $${i++}`); values.push(b.label.trim()); }
    if (b.placeholder !== undefined) { fields.push(`placeholder = $${i++}`); values.push(b.placeholder?.trim() || null); }
    if (b.type !== undefined) { fields.push(`type = $${i++}`); values.push(b.type === 'textarea' ? 'textarea' : 'text'); }
    if (b.position !== undefined) { fields.push(`position = $${i++}`); values.push(b.position); }
    if (!fields.length) return reply.status(400).send({ message: 'Nada para atualizar' });
    values.push(req.params.id);
    const [row] = await query(
      `UPDATE briefing_custom_questions SET ${fields.join(', ')} WHERE id = $${i} RETURNING *`,
      values
    );
    if (!row) return reply.status(404).send({ message: 'Pergunta não encontrada' });
    return row;
  });

  // DELETE /api/briefing-custom-questions/:id — admin only
  app.delete<{ Params: { id: string } }>(
    '/api/briefing-custom-questions/:id',
    { onRequest: [app.authenticate] },
    async (req, reply) => {
      const { role } = req.user as { role: string };
      if (role !== 'admin') return reply.status(403).send({ message: 'Acesso negado' });
      await query('DELETE FROM briefing_custom_questions WHERE id = $1', [req.params.id]);
      return reply.status(204).send();
    }
  );
}
