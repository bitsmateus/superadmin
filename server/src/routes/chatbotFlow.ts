import { FastifyInstance } from 'fastify';
import { v4 as uuidv4 } from 'uuid';
import { query, queryOne } from '../db.js';
import { generateFlowSpec } from '../lib/flowAi.js';
import { buildFlowJson, normalizeQueueName } from '../lib/flowBuilder.js';
import { validateSpec, validateJson } from '../lib/flowValidator.js';
import type { FlowSpec, FlowStep } from '../lib/flowSpec.js';
import { buildN8nWorkflow, generateAgentPrompt, sanitizePrompt, slugify, type N8nSector } from '../lib/n8nFlow.js';

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
  tenant_queues: Array<{ name: string; id: string }> | null;
  n8n_flow: N8nStored | null;
  chatbot_flow_spec: FlowSpec | null;
  chatbot_flow_json: unknown;
  chatbot_flow_warnings: unknown;
  chatbot_flow_generated_at: string | null;
  chatbot_flow_published_at: string | null;
  logs: unknown[] | null;
};

type GenJob = { running: boolean; error?: string; errors?: string[] };

/** O que fica salvo em clients.n8n_flow. */
type N8nStored = {
  agentName: string;
  prompt: string;
  warnings: string[];
  json: Record<string, unknown>;
  generatedAt: string;
  webhookPath: string;
};
const n8nJobs = new Map<string, GenJob>();
const generating = new Map<string, GenJob>();

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
    const headers = { Authorization: `Bearer ${tenant.token}`, Accept: 'application/json', 'Content-Type': 'application/json' };
    // O NX costuma usar POST nos endpoints *Data; tenta GET e, se falhar, POST.
    let res = await fetch(url, { headers });
    if (!res.ok) res = await fetch(url, { method: 'POST', headers, body: '{}' });
    if (!res.ok) {
      console.warn(`[chatbot-flow] listar filas falhou: ${res.status} ${url}`);
      return map;
    }
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

/** Filas gravadas na criação do tenant: nome(normalizado) -> queueId. */
function storedQueueMap(c: ClientRow): Record<string, string> {
  const map: Record<string, string> = {};
  for (const q of c.tenant_queues ?? []) if (q?.name && q?.id) map[normalizeQueueName(q.name)] = String(q.id);
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
      // Roda em segundo plano: a geração pode passar de 1 min (várias tentativas)
      // e o proxy corta com 502. Responde 202 e o front consulta o GET.
      const id = req.params.id;
      const c = await queryOne<ClientRow>('SELECT * FROM clients WHERE id = $1', [id]);
      if (!c) return reply.status(404).send({ message: 'Cliente não encontrado' });
      if (generating.get(id)?.running) return reply.status(202).send({ status: 'running' });

      const job: GenJob = { running: true };
      generating.set(id, job);
      void (async () => {
        try {
          const result = await generateFlowSpec(c.briefing_data, {
            company: c.company || c.name || undefined,
            apiOficial: isApiOficial(c),
          });
          if (result.errors.length > 0) {
            job.error = 'A IA não produziu um fluxo válido após as tentativas.';
            job.errors = result.errors;
            return;
          }
          const tenant = await resolveTenant(c);
          const queueMap = { ...(tenant ? await fetchQueueMap(tenant) : {}), ...storedQueueMap(c) };
          const saved = await saveAndBuild(id, result.spec, queueMap);
          if (!saved.ok) {
            job.error = 'O fluxo gerado não passou na validação.';
            job.errors = saved.errors;
            return;
          }
          await addClientLog(id, 'Fluxo do chatbot gerado com IA');
        } catch (err) {
          job.error = `Falha ao gerar com a IA: ${(err as Error).message}`;
        } finally {
          job.running = false;
        }
      })();
      return reply.status(202).send({ status: 'running' });
    },
  );

  // Guarda o id das filas criadas no tenant (nome -> id) para o roteiro usar.
  app.put<{ Params: { id: string }; Body: { queues: Array<{ name: string; id: string }> } }>(
    '/api/clients/:id/tenant-queues',
    { onRequest: [app.authenticate] },
    async (req, reply) => {
      const c = await queryOne<ClientRow>('SELECT tenant_queues FROM clients WHERE id = $1', [req.params.id]);
      if (!c) return reply.status(404).send({ message: 'Cliente não encontrado' });
      const incoming = (req.body?.queues ?? []).filter((q) => q?.name && q?.id);
      const byName = new Map<string, { name: string; id: string }>();
      for (const q of [...(c.tenant_queues ?? []), ...incoming]) byName.set(normalizeQueueName(q.name), { name: q.name, id: String(q.id) });
      await query('UPDATE clients SET tenant_queues = $1 WHERE id = $2', [JSON.stringify([...byName.values()]), req.params.id]);
      return { ok: true };
    },
  );

  // Retorna o que está salvo.
  app.get<{ Params: { id: string } }>(
    '/api/clients/:id/chatbot-flow',
    { onRequest: [app.authenticate] },
    async (req, reply) => {
      const c = await queryOne<ClientRow>('SELECT * FROM clients WHERE id = $1', [req.params.id]);
      if (!c) return reply.status(404).send({ message: 'Cliente não encontrado' });
      const job = generating.get(req.params.id);
      return {
        generating: Boolean(job?.running),
        generateError: job && !job.running ? job.error ?? null : null,
        generateErrors: job && !job.running ? job.errors ?? [] : [],
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
      const queueMap = { ...(tenant ? await fetchQueueMap(tenant) : {}), ...storedQueueMap(c) };
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

  // ── IA no n8n: prompt adaptado ao briefing + workflow importável ─────────────────
  /** Setores do cliente (briefing + filas gravadas) com queueId quando conhecido. */
  async function n8nContext(c: ClientRow) {
    const tenant = await resolveTenant(c);
    const queueMap = { ...(tenant ? await fetchQueueMap(tenant) : {}), ...storedQueueMap(c) };
    const b = (c.briefing_data ?? {}) as { departments?: string[]; users?: Array<{ sectors?: string[]; sector?: string }> };
    const names = new Map<string, string>();
    for (const q of c.tenant_queues ?? []) if (q?.name) names.set(normalizeQueueName(q.name), q.name);
    for (const d of b.departments ?? []) if (d?.trim()) names.set(normalizeQueueName(d), d.trim());
    for (const u of b.users ?? []) {
      for (const s of u.sectors ?? (u.sector ? [u.sector] : [])) if (s?.trim()) names.set(normalizeQueueName(s), s.trim());
    }
    names.delete('pendente');
    const sectors: N8nSector[] = [...names.entries()].map(([norm, name]) => ({
      key: slugify(name),
      name,
      queueId: queueMap[norm] ?? null,
    }));
    return { tenant, sectors, pendingQueueId: queueMap['pendente'] ?? null };
  }

  function n8nChannelInfo(c: ClientRow, servers: Array<{ id?: string; name?: string }>) {
    const server = servers.find((s) => s.id === c.tenant_server_id);
    if (!server || !c.tenant_api_id || !c.tenant_api_token) return null;
    const nums = ((c.briefing_data as { whatsappNumbers?: string[] } | null)?.whatsappNumbers ?? []).filter(Boolean);
    return {
      serverId: c.tenant_server_id,
      serverName: server.name ?? c.tenant_server_id,
      sessionType: c.tenant_server_id === 'chat' ? 'uazapi' : 'evo',
      apiId: c.tenant_api_id,
      numbers: nums,
    };
  }

  app.get<{ Params: { id: string } }>(
    '/api/clients/:id/n8n-flow',
    { onRequest: [app.authenticate] },
    async (req, reply) => {
      const c = await queryOne<ClientRow>('SELECT * FROM clients WHERE id = $1', [req.params.id]);
      if (!c) return reply.status(404).send({ message: 'Cliente não encontrado' });
      const settings = await queryOne<{ servers: Array<{ id?: string; name?: string }> | null }>(
        'SELECT servers FROM settings WHERE id = true',
      );
      const job = n8nJobs.get(req.params.id);
      const stored = c.n8n_flow;
      return {
        generating: Boolean(job?.running),
        generateError: job && !job.running ? job.error ?? null : null,
        channel: n8nChannelInfo(c, settings?.servers ?? []),
        flow: stored
          ? {
              agentName: stored.agentName,
              prompt: stored.prompt,
              warnings: stored.warnings,
              json: stored.json,
              generatedAt: stored.generatedAt,
              webhookPath: stored.webhookPath,
            }
          : null,
      };
    },
  );

  app.post<{ Params: { id: string }; Body: { notes?: string } }>(
    '/api/clients/:id/n8n-flow/generate',
    { onRequest: [app.authenticate] },
    async (req, reply) => {
      const id = req.params.id;
      const c = await queryOne<ClientRow>('SELECT * FROM clients WHERE id = $1', [id]);
      if (!c) return reply.status(404).send({ message: 'Cliente não encontrado' });
      if (!c.tenant_api_id || !c.tenant_api_token || !c.tenant_server_id) {
        return reply.status(400).send({ message: 'Crie o tenant e o canal antes: falta apiId/token do canal.' });
      }
      if (n8nJobs.get(id)?.running) return reply.status(202).send({ status: 'running' });

      const notes = req.body?.notes;
      const job: GenJob = { running: true };
      n8nJobs.set(id, job);
      void (async () => {
        try {
          const ctx = await n8nContext(c);
          if (!ctx.tenant) throw new Error('Servidor do tenant não encontrado nas configurações.');
          const company = c.company || c.name || 'Empresa';
          const agent = await generateAgentPrompt({ company, briefing: c.briefing_data, sectors: ctx.sectors, extraNotes: notes });
          const webhookPath = slugify(company) + '-ia';
          const built = buildN8nWorkflow({
            company,
            agentName: agent.agentName,
            systemPrompt: agent.systemPrompt,
            apiBase: `${ctx.tenant.baseUrl}/v2/api/external/${ctx.tenant.apiId}`,
            token: ctx.tenant.token,
            sectors: ctx.sectors,
            pendingQueueId: ctx.pendingQueueId,
            webhookPath,
          });
          const stored: N8nStored = {
            agentName: agent.agentName,
            prompt: agent.systemPrompt,
            warnings: [...agent.warnings, ...built.warnings],
            json: built.json,
            generatedAt: new Date().toISOString(),
            webhookPath,
          };
          await query('UPDATE clients SET n8n_flow = $1 WHERE id = $2', [JSON.stringify(stored), id]);
          await addClientLog(id, 'Fluxo n8n (IA) gerado');
        } catch (err) {
          job.error = `Falha ao gerar: ${(err as Error).message}`;
        } finally {
          job.running = false;
        }
      })();
      return reply.status(202).send({ status: 'running' });
    },
  );

  // Edita o prompt à mão e rebuilda o workflow (sem IA).
  app.put<{ Params: { id: string }; Body: { prompt: string } }>(
    '/api/clients/:id/n8n-flow/prompt',
    { onRequest: [app.authenticate] },
    async (req, reply) => {
      const c = await queryOne<ClientRow>('SELECT * FROM clients WHERE id = $1', [req.params.id]);
      if (!c) return reply.status(404).send({ message: 'Cliente não encontrado' });
      const stored = c.n8n_flow;
      const prompt = req.body?.prompt?.trim();
      if (!stored) return reply.status(400).send({ message: 'Gere o fluxo primeiro.' });
      if (!prompt) return reply.status(400).send({ message: 'Envie { prompt }.' });
      const ctx = await n8nContext(c);
      if (!ctx.tenant) return reply.status(400).send({ message: 'Servidor do tenant não encontrado nas configurações.' });
      const clean = sanitizePrompt(prompt);
      const built = buildN8nWorkflow({
        company: c.company || c.name || 'Empresa',
        agentName: stored.agentName,
        systemPrompt: clean,
        apiBase: `${ctx.tenant.baseUrl}/v2/api/external/${ctx.tenant.apiId}`,
        token: ctx.tenant.token,
        sectors: ctx.sectors,
        pendingQueueId: ctx.pendingQueueId,
        webhookPath: stored.webhookPath,
      });
      const next: N8nStored = { ...stored, prompt: clean, json: built.json, warnings: built.warnings, generatedAt: new Date().toISOString() };
      await query('UPDATE clients SET n8n_flow = $1 WHERE id = $2', [JSON.stringify(next), req.params.id]);
      return { ok: true };
    },
  );
}
