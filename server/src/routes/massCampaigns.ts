import { FastifyInstance } from 'fastify';
import crypto from 'crypto';
import { query, queryOne } from '../db.js';
import { resolveWabaAccesses } from '../lib/wabaAccess.js';
import { listTemplates, bodyVariables } from '../lib/metaGraph.js';
import { parseSpreadsheet, normalizePhone } from '../lib/spreadsheet.js';

interface VariableMappingEntry {
  position: number;
  source: 'column' | 'fixed';
  column?: string;
  value?: string;
}

async function resolveClientByToken(token: string): Promise<{ id: string; name: string; company: string | null } | null> {
  return queryOne<{ id: string; name: string; company: string | null }>(
    'SELECT id, name, company FROM clients WHERE mass_campaign_token = $1',
    [token]
  );
}

interface Contact {
  id: string;
  phone: string;
  row_data: Record<string, string>;
}

// Coluna sintética que representa o telefone do próprio contato — permite mapear uma variável do
// template pro telefone sem depender de a planilha original ter uma coluna com esse nome.
const PHONE_MAPPING_KEY = '__phone__';

async function fetchContacts(clientId: string, ids?: string[]): Promise<Contact[]> {
  if (ids?.length) {
    return query<Contact>(
      'SELECT id, phone, row_data FROM mass_campaign_contacts WHERE client_id = $1 AND id = ANY($2::uuid[])',
      [clientId, ids]
    );
  }
  return query<Contact>('SELECT id, phone, row_data FROM mass_campaign_contacts WHERE client_id = $1', [clientId]);
}

/** Materializa os destinatários de uma campanha a partir da lista de contatos já persistida —
 *  resolve o mapping de variáveis (coluna do contato ou valor fixo) linha a linha e insere em lote. */
async function createRecipientsFromContacts(
  campaignId: string,
  contacts: Contact[],
  mapping: VariableMappingEntry[]
): Promise<void> {
  const positions = [...mapping].sort((a, b) => a.position - b.position);
  const values: unknown[] = [];
  const placeholders: string[] = [];
  let i = 1;
  const flushBatch = async () => {
    if (!placeholders.length) return;
    await query(
      `INSERT INTO mass_campaign_recipients (campaign_id, row_data, phone, template_params) VALUES ${placeholders.join(',')}`,
      values
    );
    placeholders.length = 0;
    values.length = 0;
    i = 1;
  };

  for (const c of contacts) {
    const params = positions.map((m) =>
      m.source === 'fixed' ? (m.value ?? '') : m.column === PHONE_MAPPING_KEY ? c.phone : (c.row_data[m.column ?? ''] ?? '')
    );
    placeholders.push(`($${i++}, $${i++}, $${i++}, $${i++})`);
    values.push(campaignId, JSON.stringify(c.row_data), c.phone, JSON.stringify(params));
    if (placeholders.length >= 500) await flushBatch();
  }
  await flushBatch();
}

/** Portal fixo de disparo em massa (ex.: /laundry/:token) — um cliente entra sozinho (sem login),
 * importa a planilha de contatos, mapeia colunas pras variáveis de um template JÁ aprovado na
 * Meta, e dispara pra todos, espaçado. Motor de envio simples de propósito (ver
 * server/src/jobs/massCampaignDispatch.ts) — nada de fila externa, sobrevive a reinício do
 * servidor sem perder nem duplicar envio. */
export async function massCampaignRoutes(app: FastifyInstance) {
  // POST /api/clients/:id/mass-campaign-portal — gera (ou devolve o já existente) o link fixo
  // desse cliente. Diferente do link de template: não expira nem se consome com o uso, porque o
  // cliente volta aqui toda vez que quiser disparar uma campanha nova.
  app.post<{ Params: { id: string } }>(
    '/api/clients/:id/mass-campaign-portal',
    { onRequest: [app.authenticate] },
    async (req, reply) => {
      const client = await queryOne<{ id: string; mass_campaign_token: string | null }>(
        'SELECT id, mass_campaign_token FROM clients WHERE id = $1',
        [req.params.id]
      );
      if (!client) return reply.status(404).send({ message: 'Cliente não encontrado' });
      if (client.mass_campaign_token) return { token: client.mass_campaign_token };
      const token = crypto.randomBytes(24).toString('base64url');
      await query('UPDATE clients SET mass_campaign_token = $1 WHERE id = $2', [token, req.params.id]);
      return { token };
    }
  );

  // GET /api/public/laundry/:token — nome do cliente + lista de campanhas (com contagem ao vivo,
  // sem coluna denormalizada — evita contador dessincronizado do que o job realmente processou).
  app.get<{ Params: { token: string } }>('/api/public/laundry/:token', async (req, reply) => {
    const client = await resolveClientByToken(req.params.token);
    if (!client) return reply.status(404).send({ message: 'Link inválido.' });

    const campaigns = await query(
      `SELECT c.id, c.name, c.template_name, c.status, c.delay_seconds,
              c.created_at, c.started_at, c.finished_at,
              COUNT(r.id) AS total,
              COUNT(r.id) FILTER (WHERE r.status = 'sent') AS sent,
              COUNT(r.id) FILTER (WHERE r.status = 'failed') AS failed,
              COUNT(r.id) FILTER (WHERE r.status = 'queued') AS queued
       FROM mass_campaigns c
       LEFT JOIN mass_campaign_recipients r ON r.campaign_id = c.id
       WHERE c.client_id = $1
       GROUP BY c.id
       ORDER BY c.created_at DESC`,
      [client.id]
    );
    return { clientName: client.company?.trim() || client.name, campaigns };
  });

  // GET /api/public/laundry/:token/templates — templates JÁ APROVADOS na Meta pro número oficial
  // desse cliente (a criação de template é outro fluxo, ver routes/public.ts). Escopado a UM
  // número (o primeiro WABA do tenant) — disparo em massa aqui não escolhe entre vários números.
  app.get<{ Params: { token: string } }>('/api/public/laundry/:token/templates', async (req, reply) => {
    const client = await resolveClientByToken(req.params.token);
    if (!client) return reply.status(404).send({ message: 'Link inválido.' });

    const accesses = await resolveWabaAccesses(client.id);
    if (!accesses.length) {
      return reply.status(400).send({ message: 'Não encontramos um WhatsApp oficial conectado pra esse cliente.' });
    }
    const access = accesses[0];
    try {
      const raw = await listTemplates(access);
      const templates = raw
        .filter((t) => (t.status || '').toUpperCase() === 'APPROVED')
        .map((t) => {
          const body = (t.components || []).find((c) => (c.type || '').toUpperCase() === 'BODY');
          const buttonsComp = (t.components || []).find((c) => (c.type || '').toUpperCase() === 'BUTTONS');
          const bodyText = body?.text || '';
          return {
            name: t.name,
            language: t.language || 'pt_BR',
            bodyText,
            variableCount: bodyVariables(bodyText).length,
            buttons: ((buttonsComp?.buttons as { type?: string; text?: string }[]) || []).map((b) => ({
              type: b.type,
              text: b.text,
            })),
          };
        });
      return { numberLabel: access.label, templates };
    } catch (err) {
      return reply.status(502).send({ message: err instanceof Error ? err.message : 'Falha ao consultar a Meta.' });
    }
  });

  // POST /api/public/laundry/:token/import-preview — só pra conferência visual antes de importar
  // de verdade pra lista de contatos (mostra cabeçalho + 5 primeiras linhas).
  app.post<{ Params: { token: string }; Body: { data?: string } }>(
    '/api/public/laundry/:token/import-preview',
    async (req, reply) => {
      const client = await resolveClientByToken(req.params.token);
      if (!client) return reply.status(404).send({ message: 'Link inválido.' });
      if (!req.body?.data) return reply.status(400).send({ message: 'Envie o arquivo.' });
      try {
        const { header, rows } = parseSpreadsheet(req.body.data);
        return { header, sample: rows.slice(0, 5), totalRows: rows.length };
      } catch (err) {
        return reply.status(400).send({ message: err instanceof Error ? err.message : 'Falha ao ler o arquivo.' });
      }
    }
  );

  // ── Lista de contatos persistente (por cliente) ──────────────────────────────────────────────
  // Desacoplada de campanha: importa/edita uma vez, reaproveita em quantas campanhas quiser.

  // GET /api/public/laundry/:token/contacts — página de contatos + as colunas disponíveis (união
  // de todas as chaves já vistas em row_data) pra alimentar o mapeamento de variáveis na campanha.
  app.get<{ Params: { token: string }; Querystring: { offset?: string; q?: string } }>(
    '/api/public/laundry/:token/contacts',
    async (req, reply) => {
      const client = await resolveClientByToken(req.params.token);
      if (!client) return reply.status(404).send({ message: 'Link inválido.' });

      const offset = Math.max(0, Number(req.query.offset) || 0);
      const q = (req.query.q ?? '').trim();
      const filter = q ? 'AND (phone ILIKE $2 OR row_data::text ILIKE $2)' : '';
      const filterArgs = q ? [client.id, `%${q}%`] : [client.id];

      const countRow = await queryOne<{ count: string }>(
        `SELECT COUNT(*) AS count FROM mass_campaign_contacts WHERE client_id = $1 ${filter}`,
        filterArgs
      );
      const contacts = await query(
        `SELECT id, phone, row_data, created_at, updated_at FROM mass_campaign_contacts
         WHERE client_id = $1 ${filter}
         ORDER BY created_at DESC LIMIT 200 OFFSET $${filterArgs.length + 1}`,
        [...filterArgs, offset]
      );
      const columnRows = await query<{ k: string }>(
        `SELECT DISTINCT jsonb_object_keys(row_data) AS k FROM mass_campaign_contacts WHERE client_id = $1`,
        [client.id]
      );
      return { total: Number(countRow?.count ?? 0), columns: columnRows.map((r) => r.k), contacts };
    }
  );

  // POST /api/public/laundry/:token/contacts/import — importa a planilha pra dentro da lista
  // persistente: quem já existe (mesmo telefone) é ATUALIZADO (colunas novas sobrescrevem, colunas
  // antigas que não vieram nessa planilha continuam valendo); quem não existe é criado.
  app.post<{
    Params: { token: string };
    Body: { data?: string; phoneColumn?: string; ddi?: string; ddd?: string };
  }>('/api/public/laundry/:token/contacts/import', async (req, reply) => {
    const client = await resolveClientByToken(req.params.token);
    if (!client) return reply.status(404).send({ message: 'Link inválido.' });

    const phoneColumn = (req.body?.phoneColumn ?? '').trim();
    if (!phoneColumn) return reply.status(400).send({ message: 'Escolha qual coluna tem o telefone.' });
    if (!req.body?.data) return reply.status(400).send({ message: 'Envie a planilha de contatos.' });

    let header: string[];
    let rows: Record<string, string>[];
    try {
      ({ header, rows } = parseSpreadsheet(req.body.data));
    } catch (err) {
      return reply.status(400).send({ message: err instanceof Error ? err.message : 'Falha ao ler o arquivo.' });
    }
    if (!header.includes(phoneColumn)) {
      return reply.status(400).send({ message: 'A coluna de telefone escolhida não existe na planilha.' });
    }
    if (!rows.length) return reply.status(400).send({ message: 'A planilha não tem nenhuma linha.' });

    let created = 0;
    let updated = 0;
    let skipped = 0;
    const BATCH = 500;
    for (let i = 0; i < rows.length; i += BATCH) {
      // Dedup dentro do lote (por telefone) — um UPSERT não pode mexer na mesma linha duas vezes.
      const byPhone = new Map<string, Record<string, string>>();
      for (const row of rows.slice(i, i + BATCH)) {
        const phone = normalizePhone(row[phoneColumn], req.body.ddi, req.body.ddd);
        if (!phone) {
          skipped++;
          continue;
        }
        byPhone.set(phone, row);
      }
      if (!byPhone.size) continue;

      const values: unknown[] = [];
      const placeholders: string[] = [];
      let p = 1;
      for (const [phone, row] of byPhone) {
        placeholders.push(`($${p++}, $${p++}, $${p++})`);
        values.push(client.id, phone, JSON.stringify(row));
      }
      const result = await query<{ inserted: boolean }>(
        `INSERT INTO mass_campaign_contacts (client_id, phone, row_data) VALUES ${placeholders.join(',')}
         ON CONFLICT (client_id, phone) DO UPDATE
           SET row_data = mass_campaign_contacts.row_data || EXCLUDED.row_data, updated_at = NOW()
         RETURNING (xmax = 0) AS inserted`,
        values
      );
      for (const r of result) (r.inserted ? created++ : updated++);
    }

    return { created, updated, skipped };
  });

  // POST /api/public/laundry/:token/contacts — adiciona (ou atualiza, se o telefone já existir) UM
  // contato manualmente.
  app.post<{ Params: { token: string }; Body: { phone?: string; fields?: Record<string, string> } }>(
    '/api/public/laundry/:token/contacts',
    async (req, reply) => {
      const client = await resolveClientByToken(req.params.token);
      if (!client) return reply.status(404).send({ message: 'Link inválido.' });

      const phone = (req.body?.phone ?? '').replace(/\D/g, '');
      if (phone.length < 10) {
        return reply.status(400).send({ message: 'Telefone inválido. Digite com DDD (e DDI se for fora do Brasil).' });
      }
      const fields = req.body?.fields ?? {};
      const [row] = await query(
        `INSERT INTO mass_campaign_contacts (client_id, phone, row_data) VALUES ($1,$2,$3)
         ON CONFLICT (client_id, phone) DO UPDATE
           SET row_data = mass_campaign_contacts.row_data || EXCLUDED.row_data, updated_at = NOW()
         RETURNING id, phone, row_data, created_at, updated_at`,
        [client.id, phone, JSON.stringify(fields)]
      );
      return reply.status(201).send(row);
    }
  );

  // PATCH /api/public/laundry/:token/contacts/:contactId — edita telefone e/ou campos de um contato.
  app.patch<{
    Params: { token: string; contactId: string };
    Body: { phone?: string; fields?: Record<string, string> };
  }>('/api/public/laundry/:token/contacts/:contactId', async (req, reply) => {
    const client = await resolveClientByToken(req.params.token);
    if (!client) return reply.status(404).send({ message: 'Link inválido.' });

    let phone: string | null = null;
    if (req.body?.phone !== undefined) {
      phone = req.body.phone.replace(/\D/g, '');
      if (phone.length < 10) return reply.status(400).send({ message: 'Telefone inválido.' });
    }
    try {
      const [row] = await query(
        `UPDATE mass_campaign_contacts SET
           phone = COALESCE($3, phone),
           row_data = COALESCE($4::jsonb, row_data),
           updated_at = NOW()
         WHERE id = $1 AND client_id = $2
         RETURNING id, phone, row_data, created_at, updated_at`,
        [req.params.contactId, client.id, phone, req.body?.fields ? JSON.stringify(req.body.fields) : null]
      );
      if (!row) return reply.status(404).send({ message: 'Contato não encontrado.' });
      return row;
    } catch (err) {
      if ((err as { code?: string })?.code === '23505') {
        return reply.status(409).send({ message: 'Já existe outro contato com esse telefone.' });
      }
      throw err;
    }
  });

  // DELETE /api/public/laundry/:token/contacts/:contactId
  app.delete<{ Params: { token: string; contactId: string } }>(
    '/api/public/laundry/:token/contacts/:contactId',
    async (req, reply) => {
      const client = await resolveClientByToken(req.params.token);
      if (!client) return reply.status(404).send({ message: 'Link inválido.' });
      const result = await query('DELETE FROM mass_campaign_contacts WHERE id = $1 AND client_id = $2 RETURNING id', [
        req.params.contactId,
        client.id,
      ]);
      if (!result.length) return reply.status(404).send({ message: 'Contato não encontrado.' });
      return reply.status(204).send();
    }
  );

  // POST /api/public/laundry/:token — cria a campanha (RASCUNHO) já com os destinatários
  // materializados a partir da lista de contatos persistente (todos, ou só os selecionados).
  app.post<{
    Params: { token: string };
    Body: {
      name?: string;
      templateName?: string;
      templateLanguage?: string;
      delaySeconds?: number;
      contactIds?: string[];
      mapping?: VariableMappingEntry[];
    };
  }>('/api/public/laundry/:token', async (req, reply) => {
    const client = await resolveClientByToken(req.params.token);
    if (!client) return reply.status(404).send({ message: 'Link inválido.' });

    const name = (req.body?.name ?? '').trim();
    const templateName = (req.body?.templateName ?? '').trim();
    const templateLanguage = (req.body?.templateLanguage ?? 'pt_BR').trim() || 'pt_BR';
    const mapping = req.body?.mapping ?? [];
    const delaySeconds = Math.max(5, Math.min(600, Number(req.body?.delaySeconds) || 20));

    if (!name) return reply.status(400).send({ message: 'Dê um nome pra campanha.' });
    if (!templateName) return reply.status(400).send({ message: 'Escolha um template.' });

    const contacts = await fetchContacts(client.id, req.body.contactIds?.length ? req.body.contactIds : undefined);
    if (!contacts.length) {
      return reply.status(400).send({ message: 'Nenhum contato selecionado. Importe ou adicione contatos na aba Contatos primeiro.' });
    }

    const [campaign] = await query<{ id: string }>(
      `INSERT INTO mass_campaigns (client_id, name, template_name, template_language, variable_mapping, delay_seconds)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
      [client.id, name, templateName, templateLanguage, JSON.stringify(mapping), delaySeconds]
    );
    await createRecipientsFromContacts(campaign.id, contacts, mapping);

    return reply.status(201).send({ id: campaign.id, total: contacts.length });
  });

  // POST /api/public/laundry/:token/:campaignId/duplicate — clona nome/template/mapeamento/delay
  // pra uma nova campanha RASCUNHO, já materializada com a lista de contatos ATUAL (reflete edições
  // feitas na lista desde a campanha original).
  app.post<{ Params: { token: string; campaignId: string } }>(
    '/api/public/laundry/:token/:campaignId/duplicate',
    async (req, reply) => {
      const client = await resolveClientByToken(req.params.token);
      if (!client) return reply.status(404).send({ message: 'Link inválido.' });
      const src = await queryOne<{
        name: string;
        template_name: string;
        template_language: string;
        variable_mapping: VariableMappingEntry[];
        delay_seconds: number;
      }>(
        'SELECT name, template_name, template_language, variable_mapping, delay_seconds FROM mass_campaigns WHERE id = $1 AND client_id = $2',
        [req.params.campaignId, client.id]
      );
      if (!src) return reply.status(404).send({ message: 'Campanha não encontrada.' });

      const contacts = await fetchContacts(client.id);
      const [campaign] = await query<{ id: string }>(
        `INSERT INTO mass_campaigns (client_id, name, template_name, template_language, variable_mapping, delay_seconds)
         VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
        [client.id, `${src.name} (cópia)`, src.template_name, src.template_language, JSON.stringify(src.variable_mapping), src.delay_seconds]
      );
      if (contacts.length) await createRecipientsFromContacts(campaign.id, contacts, src.variable_mapping);

      return reply.status(201).send({ id: campaign.id, total: contacts.length });
    }
  );

  // DELETE /api/public/laundry/:token/:campaignId — só permite excluir fora de "running" (pausa
  // primeiro) pra não apagar uma campanha que o job ainda está processando.
  app.delete<{ Params: { token: string; campaignId: string } }>(
    '/api/public/laundry/:token/:campaignId',
    async (req, reply) => {
      const client = await resolveClientByToken(req.params.token);
      if (!client) return reply.status(404).send({ message: 'Link inválido.' });
      const campaign = await queryOne<{ id: string; status: string }>(
        'SELECT id, status FROM mass_campaigns WHERE id = $1 AND client_id = $2',
        [req.params.campaignId, client.id]
      );
      if (!campaign) return reply.status(404).send({ message: 'Campanha não encontrada.' });
      if (campaign.status === 'running') {
        return reply.status(400).send({ message: 'Pause a campanha antes de excluir.' });
      }
      await query('DELETE FROM mass_campaigns WHERE id = $1', [campaign.id]);
      return reply.status(204).send();
    }
  );

  // POST /api/public/laundry/:token/:campaignId/start — sai do RASCUNHO (ou volta de PAUSADA) e
  // passa a valer pro job de disparo. Só estampa o espaçamento (scheduled_for) na primeira vez —
  // retomar depois de pausar não reagenda quem já tinha uma data marcada.
  app.post<{ Params: { token: string; campaignId: string } }>(
    '/api/public/laundry/:token/:campaignId/start',
    async (req, reply) => {
      const client = await resolveClientByToken(req.params.token);
      if (!client) return reply.status(404).send({ message: 'Link inválido.' });
      const campaign = await queryOne<{ id: string; status: string; delay_seconds: number }>(
        'SELECT id, status, delay_seconds FROM mass_campaigns WHERE id = $1 AND client_id = $2',
        [req.params.campaignId, client.id]
      );
      if (!campaign) return reply.status(404).send({ message: 'Campanha não encontrada.' });
      if (campaign.status === 'done') return reply.status(400).send({ message: 'Essa campanha já foi concluída.' });

      if (campaign.status === 'draft') {
        await query(
          `WITH ordenados AS (
             SELECT id, ROW_NUMBER() OVER (ORDER BY created_at) - 1 AS posicao
             FROM mass_campaign_recipients WHERE campaign_id = $1 AND status = 'queued'
           )
           UPDATE mass_campaign_recipients r
           SET scheduled_for = NOW() + (ordenados.posicao * $2 * INTERVAL '1 second')
           FROM ordenados WHERE r.id = ordenados.id`,
          [campaign.id, campaign.delay_seconds]
        );
      }
      const [row] = await query(
        `UPDATE mass_campaigns SET status = 'running', started_at = COALESCE(started_at, NOW()) WHERE id = $1 RETURNING *`,
        [campaign.id]
      );
      return row;
    }
  );

  // POST /api/public/laundry/:token/:campaignId/pause — o job simplesmente ignora recipients de
  // campanha pausada; retomar (rota /start de novo) não perde nem duplica nada.
  app.post<{ Params: { token: string; campaignId: string } }>(
    '/api/public/laundry/:token/:campaignId/pause',
    async (req, reply) => {
      const client = await resolveClientByToken(req.params.token);
      if (!client) return reply.status(404).send({ message: 'Link inválido.' });
      const [row] = await query(
        `UPDATE mass_campaigns SET status = 'paused' WHERE id = $1 AND client_id = $2 AND status = 'running' RETURNING *`,
        [req.params.campaignId, client.id]
      );
      if (!row) return reply.status(404).send({ message: 'Campanha não encontrada ou não está rodando.' });
      return row;
    }
  );

  // GET /api/public/laundry/:token/:campaignId — relatório: contagens + página de destinatários.
  app.get<{ Params: { token: string; campaignId: string }; Querystring: { offset?: string; status?: string } }>(
    '/api/public/laundry/:token/:campaignId',
    async (req, reply) => {
      const client = await resolveClientByToken(req.params.token);
      if (!client) return reply.status(404).send({ message: 'Link inválido.' });
      const campaign = await queryOne(
        'SELECT * FROM mass_campaigns WHERE id = $1 AND client_id = $2',
        [req.params.campaignId, client.id]
      );
      if (!campaign) return reply.status(404).send({ message: 'Campanha não encontrada.' });

      const counts = await queryOne<{ total: string; sent: string; failed: string; queued: string }>(
        `SELECT COUNT(*) AS total,
                COUNT(*) FILTER (WHERE status = 'sent') AS sent,
                COUNT(*) FILTER (WHERE status = 'failed') AS failed,
                COUNT(*) FILTER (WHERE status = 'queued') AS queued
         FROM mass_campaign_recipients WHERE campaign_id = $1`,
        [req.params.campaignId]
      );

      const offset = Math.max(0, Number(req.query.offset) || 0);
      const statusFilter = req.query.status;
      const recipients = await query(
        `SELECT id, phone, status, error_message, scheduled_for, sent_at
         FROM mass_campaign_recipients
         WHERE campaign_id = $1 ${statusFilter ? 'AND status = $3' : ''}
         ORDER BY created_at ASC LIMIT 200 OFFSET $2`,
        statusFilter ? [req.params.campaignId, offset, statusFilter] : [req.params.campaignId, offset]
      );

      return { campaign, counts, recipients };
    }
  );
}
