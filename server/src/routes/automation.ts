import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { queryOne } from '../db.js';
import { syncTenantUsers } from '../jobs/syncTenantUsers.js';

// Rotas consumidas pela automação (n8n) — protegidas por uma chave simples de
// header (X-Automation-Key), NÃO pelo JWT do painel. Define AUTOMATION_KEY no
// ambiente do servidor e configura o mesmo valor na credencial do n8n.

type StoredServer = { id?: string; baseUrl?: string; apiToken?: string };

const DEFAULT_BASE = 'https://appapi.nxsystems.com.br';

export async function automationRoutes(app: FastifyInstance) {
  const AUTOMATION_KEY = process.env.AUTOMATION_KEY;

  const requireKey = async (req: FastifyRequest, reply: FastifyReply) => {
    if (!AUTOMATION_KEY) {
      return reply.status(500).send({ message: 'AUTOMATION_KEY não configurada no servidor' });
    }
    const key = req.headers['x-automation-key'];
    if (key !== AUTOMATION_KEY) {
      return reply.status(401).send({ message: 'Chave de automação inválida' });
    }
  };

  // Resolve o tenant + nível de acesso a partir do e-mail do funcionário.
  // O agente usa isso para descobrir de qual cliente a pessoa é, mesmo que o
  // número de WhatsApp dela não esteja cadastrado.
  app.get<{ Params: { email: string } }>(
    '/api/automation/users/by-email/:email',
    { onRequest: [requireKey] },
    async (req, reply) => {
      const email = decodeURIComponent(req.params.email || '').trim().toLowerCase();
      if (!email) return reply.status(400).send({ message: 'E-mail obrigatório' });

      const row = await queryOne<{
        email: string;
        name: string | null;
        role: string | null;
        client_id: string;
        client_name: string | null;
        tenant_name: string | null;
        tenant_api_id: string | null;
        tenant_api_token: string | null;
        tenant_server_id: string | null;
      }>(
        `SELECT tu.email, tu.name, tu.role,
                c.id AS client_id, c.name AS client_name, c.tenant_name,
                c.tenant_api_id, c.tenant_api_token, c.tenant_server_id
         FROM tenant_users tu
         JOIN clients c ON c.id = tu.client_id
         WHERE tu.email = $1 AND c.archived_at IS NULL
         ORDER BY tu.updated_at DESC
         LIMIT 1`,
        [email]
      );

      if (!row) return reply.status(404).send({ found: false });

      const settings = await queryOne<{ servers: StoredServer[] | null }>(
        'SELECT servers FROM settings WHERE id = true'
      );
      const servers = Array.isArray(settings?.servers) ? (settings!.servers as StoredServer[]) : [];
      const server = row.tenant_server_id
        ? servers.find((s) => s.id === row.tenant_server_id)
        : undefined;
      const tenantBaseUrl = (server?.baseUrl || DEFAULT_BASE).replace(/\/$/, '');

      return {
        found: true,
        tenantBaseUrl,
        tenantApiId: row.tenant_api_id,
        tenantApiToken: row.tenant_api_token,
        tenantName: row.tenant_name,
        clientName: row.client_name,
        role: row.role || 'user',
        name: row.name || '',
        email: row.email,
      };
    }
  );

  // Dispara a sincronização do índice sob demanda (varre listUsers de cada
  // tenant). Também roda sozinho a cada 6h via startTenantUsersSync().
  app.post(
    '/api/automation/users/sync',
    { onRequest: [requireKey] },
    async () => {
      const result = await syncTenantUsers();
      return { ok: true, ...result };
    }
  );
}
