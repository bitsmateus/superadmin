import { FastifyInstance } from 'fastify';
import { v4 as uuidv4 } from 'uuid';
import { query, queryOne } from '../db.js';
import { generateFlowSpec } from '../lib/flowAi.js';
import { buildFlowJson, normalizeQueueName } from '../lib/flowBuilder.js';
import { validateSpec, validateJson } from '../lib/flowValidator.js';
import type { FlowSpec, FlowStep } from '../lib/flowSpec.js';

type ClientRow = {
  id: string;
  name: string | null;
  company: string | null;
  briefing_data: Record<string, unknown> | null;
  has_api_oficial: boolean | null;
  briefing_config: { connectionTypes?: string[] } | null;
  tenant_server_id: string | null;
  tenant_api_id: string | null;
  tenant_api_token: string | null;
  chatbot_flow_spec: FlowSpec | null;
  chatbot_flow_json: unknown;
  chatbot_flow_warnings: unknown;
  chatbot_flow_generated_at: string | null;
  chatbot_flow_published_at: string | null;
  logs: unknown[] | null;
};

async function addClientLog(id: string, action: string): Promise<void> {
  const row = await queryOne<{ logs: unknown[] | null }>('SELECT logs FROM clients WHERE id = $1', [id]);
  const logs = [...(row?.logs ?? []), { id: uuidv4(), action, createdAt: new Date().toISOString() }];
  await query('UPDATE clients SET logs = $1 WHERE id = $2', [JSON.stringify(logs), id]);
}

function isApiOficial(c: ClientRow): boolean {
  return Boolean(c.has_api_oficial) || Boolean(c.briefing_config?.connectionTypes?.includes('api_oficial'));
}

/** Base URL do servidor do tenant (settings.servers) + apiId + token. */
async function resolveTenant(
  c: ClientRow,
): Promise<{ baseUrl: string; apiId: string; token: string } | null> {
  if (!c.tenant_api_id || !c.tenant_api_token || !c.tenant_server_id) return null;
  const settings = await queryOne<{ servers: Array<{ id?: string; baseUrl?: string }> | null }>(
    'SELECT servers FROM settings WHERE id = true',
  );
  const baseUrl = (settings?.servers ?? []).find((s) => s.id === c.tenant_server_id)?.baseUrl?.replace(/\/$/, '');
  if (!baseUrl) return null;
  return { baseUrl, apiId: c.tenant_api_id, token: c.tenant_api_token };
}

/** Nomes de setor referenciados no roteiro (transferToQueue). */
function sectorNames(spec: FlowSpec): string[] {
  const out = new Set<string>();
  for (const step of spec.steps) {
    if (step.type === 'end' && step.transferToQueue) out.add(step.transferToQueue);
    if (step.type === 'menu') for (const o of step.options) if (o.transferToQueue) out.add(o.transferToQueue);
  }
  return [...out];
}

/**
 * Tenta listar as filas do tenant e montar o mapa nome(normalizado) -> queueId.
 * Best-effort: se o endpoint não estiver configurado/acessível, devolve {}.
 * Endpoint configurável por env (default segue o padrão listXxxData do NX).
 */
async function fetchQueueMap(tenant: { baseUrl: string; apiId: string; token: string }): Promise<Record<string, string>> {
  const pathTpl = process.env.CHATBOT_FLOW_LIST_QUEUES_PATH || '/v2/api/external/{apiId}/listQueueData';
  const path = pathTpl.replace('{apiId}', encodeURIComponent(tenant.apiId));
  const url = new URL(path, tenant.baseUrl + '/').toString();
  const map: Record<string, string> = {};
  try {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${tenant.token}`, Accept: 'application/json' },
    });
    if (!res.ok) return map;
    const raw = (await res.json()) as unknown;
    const arr = (raw && typeof raw === 'object' && 'data' in (raw as object) ? (raw as { data: unknown }).data : raw) as unknown;
    if (!Array.isArray(arr)) return map;
    for (const item of arr as Record<string, unknown>[]) {
      const id = item.id ?? item.queueId ?? item.queue_id;
      const name = item.queue ?? item.name ?? item.queueName ?? item.title;
      if (id != null && typeof name === 'string' && name.trim())
        map[normalizeQueueName(name)] = String(id);
    }
  } catch {
    /* endpoint desconhecido/offline — segue sem resolver (o operador ajusta à mão) */
  }
  return map;
}

/** Persiste spec + json + warnings e devolve o payload padrão da rota. */
async function saveAndBuild(id: string, spec: FlowSpec, queueMap: Record<string, string> = {}) {
  const specErrors = validateSpec(spec);
  if (specErrors.errors.length > 0) {
    return { ok: false as const, status: 422, errors: specErrors.errors, warnings: specErrors.warnings };
  }
  const { json, warnings: buildWarnings } = buildFlowJson(spec, { queueMap });
  const jsonCheck = validateJson(json);
  // Avisa os setores cujo queueId não foi resolvido (nome ainda no lugar do id).
  const unresolved = sectorNames(spec).filter((n) => !queueMap[normalizeQueueName(n)]);
  const queueWarnings = unresolved.map(
    (n) => `Fila do setor "${n}" não resolvida — ajuste o queueId antes de importar no tenant.`,
  );
  const warnings = [...specErrors.warnings, ...buildWarnings, ...jsonCheck.warnings, ...queueWarnings];
  if (jsonCheck.errors.length > 0) {
    return { ok: false as const, status: 422, errors: jsonCheck.errors, warnings };
  }
  await query(
    `UPDATE clients SET chatbot_flow_spec = $1, chatbot_flow_json = $2,
       chatbot_flow_warnings = $3, chatbot_flow_generated_at = NOW() WHERE id = $4`,
    [JSON.stringify(spec), JSON.stringify(json), JSON.stringify(warnings), id],
  );
  return { ok: true as const, spec, json, warnings };
}

export async function chatbotFlowRoutes(app: FastifyInstance) {
  // Gera o fluxo com a IA a partir do briefing, valida, builda e salva.
  app.post<{ Params: { id: string } }>(
    '/api/clients/:id/chatbot-flow/generate',
    { onRequest: [app.authenticate] },
    async (req, reply) => {
      const c = await queryOne<ClientRow>('SELECT * FROM clients WHERE id = $1', [req.params.id]);
      if (!c) return reply.status(404).send({ message: 'Cliente não encontrado' });

      let result;
      try {
        result = await generateFlowSpec(c.briefing_data, {
          company: c.company || c.name || undefined,
          apiOficial: isApiOficial(c),
        });
      } catch (err) {
        return reply.status(502).send({ message: `Falha ao gerar com a IA: ${(err as Error).message}` });
      }
      if (result.errors.length > 0) {
        return reply
          .status(422)
          .send({ message: 'A IA não produziu um fluxo válido após as tentativas.', errors: result.errors, warnings: result.warnings });
      }

      const tenant = await resolveTenant(c);
      const queueMap = tenant ? await fetchQueueMap(tenant) : {};
      const saved = await saveAndBuild(req.params.id, result.spec, queueMap);
      if (!saved.ok) return reply.status(saved.status).send({ errors: saved.errors, warnings: saved.warnings });

      await addClientLog(req.params.id, 'Fluxo do chatbot gerado com IA');
      return { spec: saved.spec, json: saved.json, warnings: saved.warnings, errors: [] };
    },
  );

  // Retorna o que está salvo.
  app.get<{ Params: { id: string } }>(
    '/api/clients/:id/chatbot-flow',
    { onRequest: [app.authenticate] },
    async (req, reply) => {
      const c = await queryOne<ClientRow>('SELECT * FROM clients WHERE id = $1', [req.params.id]);
      if (!c) return reply.status(404).send({ message: 'Cliente não encontrado' });
      return {
        spec: c.chatbot_flow_spec,
        json: c.chatbot_flow_json,
        warnings: c.chatbot_flow_warnings ?? [],
        generatedAt: c.chatbot_flow_generated_at,
        publishedAt: c.chatbot_flow_published_at,
      };
    },
  );

  // Salva a spec editada à mão, revalida e rebuilda o JSON (sem IA).
  app.put<{ Params: { id: string }; Body: { spec: FlowSpec } }>(
    '/api/clients/:id/chatbot-flow/spec',
    { onRequest: [app.authenticate] },
    async (req, reply) => {
      const c = await queryOne<ClientRow>('SELECT * FROM clients WHERE id = $1', [req.params.id]);
      if (!c) return reply.status(404).send({ message: 'Cliente não encontrado' });
      const spec = req.body?.spec;
      if (!spec) return reply.status(400).send({ message: 'Envie { spec }.' });

      const tenant = await resolveTenant(c);
      const queueMap = tenant ? await fetchQueueMap(tenant) : {};
      const saved = await saveAndBuild(req.params.id, spec, queueMap);
      if (!saved.ok) return reply.status(saved.status === 422 ? 400 : saved.status).send({ errors: saved.errors, warnings: saved.warnings });

      await addClientLog(req.params.id, 'Fluxo do chatbot editado');
      return { spec: saved.spec, json: saved.json, warnings: saved.warnings, errors: [] };
    },
  );

  // Envia o JSON para o tenant. Endpoint de importação configurável por env;
  // sem ela, responde 501 e o download segue funcionando.
  app.post<{ Params: { id: string } }>(
    '/api/clients/:id/chatbot-flow/publish',
    { onRequest: [app.authenticate] },
    async (req, reply) => {
      const importPath = process.env.CHATBOT_FLOW_IMPORT_PATH;
      if (!importPath) {
        return reply.status(501).send({
          message: 'Endpoint de importação de fluxo não configurado (CHATBOT_FLOW_IMPORT_PATH). O download continua disponível.',
        });
      }

      const c = await queryOne<ClientRow>('SELECT * FROM clients WHERE id = $1', [req.params.id]);
      if (!c) return reply.status(404).send({ message: 'Cliente não encontrado' });
      if (!c.chatbot_flow_json) return reply.status(400).send({ message: 'Nenhum fluxo gerado para publicar.' });
      if (!c.tenant_api_id || !c.tenant_api_token || !c.tenant_server_id) {
        return reply.status(400).send({ message: 'Tenant sem apiId/token/servidor — vincule/provisione o tenant antes.' });
      }

      // Resolve a base URL do servidor do tenant (settings.servers).
      const settings = await queryOne<{ servers: Array<{ id?: string; baseUrl?: string }> | null }>(
        'SELECT servers FROM settings WHERE id = true',
      );
      const baseUrl = (settings?.servers ?? []).find((s) => s.id === c.tenant_server_id)?.baseUrl?.replace(/\/$/, '');
      if (!baseUrl) return reply.status(400).send({ message: 'Servidor do tenant não encontrado nas configurações.' });

      const path = importPath.replace('{apiId}', encodeURIComponent(c.tenant_api_id));
      const url = new URL(path, baseUrl + '/').toString();
      try {
        const res = await fetch(url, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${c.tenant_api_token}`,
            'Content-Type': 'application/json',
            Accept: 'application/json',
          },
          body: JSON.stringify(c.chatbot_flow_json),
        });
        if (!res.ok) {
          const detail = await res.text().catch(() => '');
          return reply.status(502).send({ message: `Falha ao importar no tenant (NX ${res.status})`, detail: detail.slice(0, 500) });
        }
      } catch (err) {
        return reply.status(502).send({ message: `Falha de rede ao publicar: ${(err as Error).message}` });
      }

      await query('UPDATE clients SET chatbot_flow_published_at = NOW() WHERE id = $1', [req.params.id]);
      await addClientLog(req.params.id, 'Fluxo do chatbot enviado ao tenant');
      return { ok: true };
    },
  );
}
