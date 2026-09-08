import { FastifyInstance } from 'fastify';
import crypto from 'crypto';
import { query, queryOne } from '../db.js';
import { resolveWabaAccessById } from '../lib/wabaAccess.js';
import { fetchTemplateStatus } from '../lib/metaGraph.js';

interface RequestTarget {
  wabaId: string;
  label: string;
  status: 'submitted' | 'failed';
  externalId?: string;
  metaStatus?: string;
  errorMessage?: string;
}

/** Gerenciamento (lado da equipe) do link público de criação de template — geração do link,
 * listagem de pedidos de um cliente, e verificação manual de status de um número na Meta. O
 * preenchimento e envio em si acontecem do lado público (ver server/src/routes/public.ts). */
export async function templateRequestRoutes(app: FastifyInstance) {
  // POST /api/clients/:id/template-requests — gera (ou devolve o já existente) o link fixo desse
  // cliente. Não expira nem se consome com o uso (mesmo padrão do link de disparo em massa) — o
  // cliente volta nele toda vez que quiser criar um modelo novo; cada envio vira uma linha nova em
  // template_requests, sem mexer no token.
  app.post<{ Params: { id: string } }>(
    '/api/clients/:id/template-requests',
    { onRequest: [app.authenticate] },
    async (req, reply) => {
      const client = await queryOne<{ id: string; template_portal_token: string | null }>(
        'SELECT id, template_portal_token FROM clients WHERE id = $1',
        [req.params.id]
      );
      if (!client) return reply.status(404).send({ message: 'Cliente não encontrado' });
      if (client.template_portal_token) return { token: client.template_portal_token };

      const token = crypto.randomBytes(24).toString('base64url');
      await query('UPDATE clients SET template_portal_token = $1 WHERE id = $2', [token, req.params.id]);
      return { token };
    }
  );

  // GET /api/clients/:id/template-requests — lista pra mostrar status na aba Entrega.
  app.get<{ Params: { id: string } }>(
    '/api/clients/:id/template-requests',
    { onRequest: [app.authenticate] },
    async (req) => {
      return query(
        `SELECT id, token, status, purpose, template_name, body, category, targets, created_at, submitted_at
         FROM template_requests WHERE client_id = $1 ORDER BY created_at DESC`,
        [req.params.id]
      );
    }
  );

  // POST /api/clients/:id/template-requests/:reqId/refresh-status?wabaId=... — consulta o status
  // atual do template num número específico (aprovado/rejeitado/ainda em revisão) e atualiza o
  // espelho local desse alvo dentro de `targets`.
  app.post<{ Params: { id: string; reqId: string }; Querystring: { wabaId?: string } }>(
    '/api/clients/:id/template-requests/:reqId/refresh-status',
    { onRequest: [app.authenticate] },
    async (req, reply) => {
      const reqRow = await queryOne<{ targets: RequestTarget[] }>(
        'SELECT targets FROM template_requests WHERE id = $1 AND client_id = $2',
        [req.params.reqId, req.params.id]
      );
      if (!reqRow) return reply.status(404).send({ message: 'Pedido não encontrado' });

      const targets = reqRow.targets ?? [];
      const wabaId = req.query.wabaId || targets[0]?.wabaId;
      const target = targets.find((t) => t.wabaId === wabaId);
      if (!target || !target.externalId) {
        return reply.status(400).send({ message: 'Esse número ainda não teve um template enviado à Meta.' });
      }

      const access = await resolveWabaAccessById(req.params.id, target.wabaId);
      if (!access) {
        return reply.status(400).send({ message: 'Não foi possível resolver o acesso a esse número na Meta.' });
      }

      try {
        const status = await fetchTemplateStatus(access, target.externalId);
        const nextTargets = targets.map((t) =>
          t.wabaId === target.wabaId ? { ...t, metaStatus: status.status ?? t.metaStatus } : t
        );
        const [row] = await query('UPDATE template_requests SET targets = $1 WHERE id = $2 RETURNING *', [
          JSON.stringify(nextTargets),
          req.params.reqId,
        ]);
        return row;
      } catch (err) {
        return reply.status(502).send({ message: err instanceof Error ? err.message : 'Falha ao consultar a Meta' });
      }
    }
  );
}
