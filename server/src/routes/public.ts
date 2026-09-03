import { FastifyInstance } from 'fastify';
import { query, queryOne } from '../db.js';
import { v4 as uuidv4 } from 'uuid';
import { sendSupportGroupMessage } from '../lib/supportGroup.js';
import { generateWelcomeMessage } from '../lib/flowAi.js';
import { resolveWabaAccesses } from '../lib/wabaAccess.js';
import {
  createTemplate,
  bodyVariables,
  bodyEdgeVariableIssue,
  suggestTemplateName,
  suggestCategory,
  type ButtonInput,
} from '../lib/metaGraph.js';

export async function publicRoutes(app: FastifyInstance) {
  // POST /api/public/ficha — formulário público de cadastro. Cria um cliente
  // novo na etapa "Boas-vindas" (welcome) do pipeline.
  app.post<{ Body: Record<string, unknown> }>(
    '/api/public/ficha',
    async (req, reply) => {
      const b = req.body ?? {};
      const company = String(b.company ?? '').trim();
      if (!company) return reply.status(400).send({ message: 'Nome da empresa é obrigatório' });

      const ficha = {
        cnpj: b.cnpj ?? null,
        cpfResponsavel: b.cpfResponsavel ?? null,
        paymentDay: b.paymentDay ?? null,
        needsNF: typeof b.needsNF === 'boolean' ? b.needsNF : b.needsNF === 'Sim' ? true : b.needsNF === 'Não' ? false : null,
        nfNumber: b.nfNumber ?? null,
        nfEmail: b.nfEmail ?? null,
        address: b.address ?? null,
        submittedAt: new Date().toISOString(),
      };
      const dayNum = b.paymentDay ? parseInt(String(b.paymentDay), 10) : NaN;
      const dueDay = Number.isFinite(dayNum) && dayNum >= 1 && dayNum <= 31 ? dayNum : null;
      const log = { id: uuidv4(), action: 'Ficha de cadastro preenchida', createdAt: new Date().toISOString() };

      const [row] = await query<{ id: string }>(
        `INSERT INTO clients (name, email, phone, company, stage, due_day, ficha_cadastro, logs)
         VALUES ($1, $2, $3, $4, 'welcome', $5, $6, $7)
         RETURNING id`,
        [
          company,
          String(b.nfEmail ?? ''),
          String(b.nfNumber ?? ''),
          company,
          dueDay,
          JSON.stringify(ficha),
          JSON.stringify([log]),
        ]
      );

      // Notifica o grupo do WhatsApp (não bloqueia a resposta).
      const detalhes: string[] = [];
      if (ficha.cnpj) detalhes.push(`CNPJ: ${ficha.cnpj}`);
      if (ficha.cpfResponsavel) detalhes.push(`CPF resp.: ${ficha.cpfResponsavel}`);
      if (ficha.paymentDay) detalhes.push(`Pagamento: dia ${ficha.paymentDay}`);
      if (ficha.needsNF === true) detalhes.push('Emite NF: sim');
      else if (ficha.needsNF === false) detalhes.push('Emite NF: não');
      if (ficha.nfEmail) detalhes.push(`E-mail: ${ficha.nfEmail}`);
      if (ficha.nfNumber) detalhes.push(`Telefone: ${ficha.nfNumber}`);
      const msg =
        `🆕 Nova ficha de cadastro — ${company}\n` +
        `Entrou na etapa Boas-vindas.` +
        (detalhes.length > 0 ? `\n\n${detalhes.join('\n')}` : '');
      void sendSupportGroupMessage(msg);

      return reply.status(201).send({ ok: true, id: row.id });
    }
  );

  // POST /api/public/briefing/:token — get briefing data
  app.get<{ Params: { token: string } }>(
    '/api/public/briefing/:token',
    async (req, reply) => {
      const row = await queryOne(
        `SELECT id, name, company, briefing_status, briefing_data, briefing_revision_note, briefing_config
         FROM clients WHERE briefing_token = $1`,
        [req.params.token]
      );
      if (!row) return reply.status(404).send({ message: 'Token inválido' });
      return row;
    }
  );

  // GET /api/public/briefing-template — overrides de rótulo/placeholder + perguntas de
  // texto livre novas do admin, pro form público renderizar (sem autenticação: é o mesmo
  // form aberto por token que já lê os dados do cliente acima).
  app.get('/api/public/briefing-template', async () => {
    const [overrides, customQuestions] = await Promise.all([
      query('SELECT field_key, label, placeholder FROM briefing_field_overrides'),
      query('SELECT id, field_key, label, placeholder, type, position FROM briefing_custom_questions ORDER BY position, created_at'),
    ]);
    return { overrides, customQuestions };
  });

  // Gera a abertura do menu sem expor a chave da Anthropic no navegador.
  app.post<{
    Params: { token: string };
    Body: { description?: string; sectors?: string[] };
  }>('/api/public/briefing/:token/generate-welcome', async (req, reply) => {
    const row = await queryOne<{ company: string | null; name: string }>(
      'SELECT company, name FROM clients WHERE briefing_token = $1',
      [req.params.token],
    );
    if (!row) return reply.status(404).send({ message: 'Token inválido' });

    const description = String(req.body?.description ?? '').trim().slice(0, 2000);
    const sectors = Array.isArray(req.body?.sectors)
      ? req.body.sectors.map((sector) => String(sector).trim()).filter(Boolean).slice(0, 20)
      : [];
    if (!description) return reply.status(400).send({ message: 'Preencha o resumo do atendimento primeiro.' });
    if (sectors.length === 0) return reply.status(400).send({ message: 'Cadastre ao menos um setor primeiro.' });

    try {
      const message = await generateWelcomeMessage({
        company: row.company?.trim() || row.name,
        description,
        sectors,
      });
      return { message };
    } catch (error) {
      req.log.error(error, 'Falha ao gerar mensagem de boas-vindas');
      if (error instanceof Error && error.message.includes('ANTHROPIC_API_KEY não configurada')) {
        return reply.status(503).send({
          message: 'A geração com IA ainda não foi configurada no servidor. Contate o responsável pelo sistema.',
        });
      }
      return reply.status(502).send({ message: 'Não foi possível gerar a mensagem com IA. Tente novamente.' });
    }
  });

  // POST /api/public/briefing/:token — submit briefing
  app.post<{ Params: { token: string }; Body: { data: Record<string, unknown> } }>(
    '/api/public/briefing/:token',
    async (req, reply) => {
      const { token } = req.params;
      const { data } = req.body;
      const existing = await queryOne(
        'SELECT id, logs FROM clients WHERE briefing_token = $1',
        [token]
      ) as { id: string; logs: unknown[] } | null;
      if (!existing) return reply.status(404).send({ message: 'Token inválido' });

      const newLog = { id: uuidv4(), action: 'Briefing preenchido pelo cliente', createdAt: new Date().toISOString() };
      const logs = [...(existing.logs as unknown[] ?? []), newLog];

      // Ao preencher, move de "Briefing" para "Iniciar Configuração" (setup_start).
      const [updated] = await query<{ company: string | null; name: string }>(
        `UPDATE clients
         SET briefing_data = $1,
             briefing_status = 'filled',
             stage = CASE WHEN stage = 'briefing' THEN 'setup_start'::pipeline_stage ELSE stage END,
             stage_updated_at = CASE WHEN stage = 'briefing' THEN NOW() ELSE stage_updated_at END,
             logs = $2
         WHERE briefing_token = $3
         RETURNING company, name`,
        [JSON.stringify(data), JSON.stringify(logs), token]
      );

      // Notifica o grupo do WhatsApp (não bloqueia a resposta).
      if (updated) {
        const co = (updated.company && updated.company.trim()) || updated.name;
        void sendSupportGroupMessage(`✅ Briefing preenchido — ${co}. Movido para Iniciar Configuração.`);
      }
      return { ok: true };
    }
  );

  // ── Portal de pendências ────────────────────────────────────────────────
  // Mesma chave do briefing: o cliente completa só o que ficou faltando, sem
  // refazer o formulário inteiro. O front calcula o que falta a partir de
  // briefing_config × briefing_data.

  // GET /api/public/pendencias/:token
  app.get<{ Params: { token: string } }>(
    '/api/public/pendencias/:token',
    async (req, reply) => {
      const row = await queryOne(
        `SELECT id, name, company, briefing_status, briefing_data, briefing_config,
                contract_signed_at, payment_status
         FROM clients WHERE briefing_token = $1`,
        [req.params.token]
      );
      if (!row) return reply.status(404).send({ message: 'Token inválido' });
      return row;
    }
  );

  /**
   * Campos que o portal de pendências pode gravar dentro de briefing_data.
   * Tudo fora dessa lista é ignorado — o portal completa lacunas, não
   * reescreve o briefing.
   */
  const PENDING_FIELDS = new Set([
    'site',
    'whatsappNumbers',
    'channelAccess',
    'officialApi',
    'facebookEmail',
    'facebookPassword',
    'aiCompanyDescription',
    'aiServices',
    'aiAttendanceFlow',
    'aiExternalSystem',
    'aiExternalApiUrl',
    'aiExternalWhatToQuery',
    'aiExternalAuth',
    'aiExternalExamples',
    'externalAutomationInfo',
  ]);

  // POST /api/public/pendencias/:token — merge parcial no briefing_data
  app.post<{ Params: { token: string }; Body: { patch?: Record<string, unknown> } }>(
    '/api/public/pendencias/:token',
    async (req, reply) => {
      const { token } = req.params;
      const patch = req.body?.patch ?? {};
      const existing = await queryOne(
        'SELECT id, logs, briefing_data FROM clients WHERE briefing_token = $1',
        [token]
      ) as { id: string; logs: unknown[]; briefing_data: Record<string, unknown> | null } | null;
      if (!existing) return reply.status(404).send({ message: 'Token inválido' });

      const clean: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(patch)) {
        if (!PENDING_FIELDS.has(k)) continue;
        if (v === undefined || v === null || v === '') continue;
        clean[k] = v;
      }
      if (Object.keys(clean).length === 0) {
        return reply.status(400).send({ message: 'Nada para atualizar' });
      }

      const base = existing.briefing_data ?? {};
      // Merge raso, exceto channelAccess/officialApi que são objetos por canal.
      const merged: Record<string, unknown> = { ...base, ...clean };
      for (const key of ['channelAccess', 'officialApi'] as const) {
        if (clean[key] && typeof clean[key] === 'object') {
          merged[key] = {
            ...((base[key] as Record<string, unknown>) ?? {}),
            ...(clean[key] as Record<string, unknown>),
          };
        }
      }

      const newLog = {
        id: uuidv4(),
        action: 'Pendências enviadas pelo cliente',
        detail: Object.keys(clean).join(', '),
        createdAt: new Date().toISOString(),
      };
      const logs = [...((existing.logs as unknown[]) ?? []), newLog];

      const [updated] = await query<{ company: string | null; name: string }>(
        `UPDATE clients SET briefing_data = $1, logs = $2
         WHERE briefing_token = $3
         RETURNING company, name`,
        [JSON.stringify(merged), JSON.stringify(logs), token]
      );

      if (updated) {
        const co = (updated.company && updated.company.trim()) || updated.name;
        void sendSupportGroupMessage(
          `📎 Pendências enviadas — ${co}: ${Object.keys(clean).join(', ')}`
        );
      }
      return { ok: true };
    }
  );

  // GET /api/public/ticket-categories
  app.get('/api/public/ticket-categories', async () => {
    return query('SELECT * FROM ticket_categories WHERE active = true ORDER BY position');
  });

  // GET /api/public/triage-steps?category_id=xxx
  app.get<{ Querystring: { category_id?: string } }>(
    '/api/public/triage-steps',
    async (req) => {
      if (req.query.category_id) {
        return query('SELECT * FROM ticket_triage_steps WHERE category_id = $1', [req.query.category_id]);
      }
      return query('SELECT * FROM ticket_triage_steps');
    }
  );

  // GET /api/public/kb-articles?category_id=xxx
  app.get<{ Querystring: { category_id?: string } }>(
    '/api/public/kb-articles',
    async (req) => {
      if (req.query.category_id) {
        return query(
          'SELECT * FROM kb_articles WHERE published = true AND category_id = $1',
          [req.query.category_id]
        );
      }
      return query('SELECT * FROM kb_articles WHERE published = true');
    }
  );

  // POST /api/public/kb-helpful
  app.post<{ Body: { article_id: string; helpful: boolean } }>(
    '/api/public/kb-helpful',
    async (req) => {
      const { article_id, helpful } = req.body;
      const col = helpful ? 'helpful_count' : 'not_helpful_count';
      await query(
        `UPDATE kb_articles SET ${col} = ${col} + 1 WHERE id = $1`,
        [article_id]
      );
      return { ok: true };
    }
  );

  // POST /api/public/support-lookup
  app.post<{ Body: { email: string } }>(
    '/api/public/support-lookup',
    async (req) => {
      const { email } = req.body;
      const client = await queryOne<{ id: string; name: string; company: string }>(
        'SELECT id, name, company FROM clients WHERE lower(email) = lower(trim($1)) LIMIT 1',
        [email]
      );
      if (!client) return [];
      const [{ count }] = await query<{ count: string }>(
        `SELECT count(*)::int as count FROM tickets WHERE client_id = $1 AND status NOT IN ('resolved','closed')`,
        [client.id]
      );
      return [{ client_id: client.id, client_name: client.name, client_company: client.company, open_tickets: parseInt(count) }];
    }
  );

  // POST /api/public/tickets — create public ticket
  app.post<{
    Body: {
      customer_email: string;
      customer_name: string;
      customer_cnpj?: string;
      customer_phone?: string;
      customer_company?: string;
      category_id?: string;
      subject: string;
      description?: string;
      triage_path?: unknown[];
    };
  }>(
    '/api/public/tickets',
    async (req, reply) => {
      const b = req.body;

      if (b.subject.length > 200) return reply.status(400).send({ message: 'Assunto muito longo.' });
      if ((b.description ?? '').length > 5000) return reply.status(400).send({ message: 'Descrição muito longa.' });

      // Try to match client by email
      const matchedClient = await queryOne<{ id: string; company: string }>(
        'SELECT id, company FROM clients WHERE lower(email) = lower(trim($1)) LIMIT 1',
        [b.customer_email]
      );

      // Get category defaults
      let slaHours = 24;
      let priority = 'normal';
      if (b.category_id) {
        const cat = await queryOne<{ default_sla_hours: number; default_priority: string }>(
          'SELECT default_sla_hours, default_priority FROM ticket_categories WHERE id = $1',
          [b.category_id]
        );
        if (cat) { slaHours = cat.default_sla_hours; priority = cat.default_priority; }
      }

      const publicToken = uuidv4();
      const [ticket] = await query<{ id: string; number: number; public_token: string }>(
        `INSERT INTO tickets (
          client_id, category_id,
          customer_name, customer_email, customer_cnpj, customer_phone, customer_company,
          subject, description, triage_path,
          needs_linking, sla_hours, priority, public_token
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
        RETURNING id, number, public_token`,
        [
          matchedClient?.id ?? null, b.category_id ?? null,
          b.customer_name, b.customer_email.trim(), b.customer_cnpj ?? null,
          b.customer_phone ?? null,
          b.customer_company ?? matchedClient?.company ?? null,
          b.subject, b.description ?? null,
          JSON.stringify(b.triage_path ?? []),
          matchedClient === null, slaHours, priority, publicToken,
        ]
      );

      // Insert initial message
      await query(
        `INSERT INTO ticket_messages (ticket_id, author_type, author_name, content)
         VALUES ($1, 'customer', $2, $3)`,
        [ticket.id, b.customer_name, b.description ?? '(sem descrição)']
      );

      return reply.status(201).send({
        ticket_id: ticket.id,
        ticket_number: ticket.number,
        public_token: ticket.public_token,
      });
    }
  );

  // GET /api/public/tickets/:token
  app.get<{ Params: { token: string } }>(
    '/api/public/tickets/:token',
    async (req, reply) => {
      const rawToken = req.params.token;
      const ticket = await queryOne(
        `SELECT t.id, t.number, t.subject, t.status, t.priority,
                t.customer_name, t.customer_email, t.customer_company,
                t.opened_at, t.last_message_at, t.category_id
         FROM tickets t WHERE t.public_token = $1 OR t.number::text = $1`,
        [rawToken]
      ) as Record<string, unknown> | null;
      if (!ticket) return reply.status(404).send({ message: 'Ticket não encontrado. Verifique o código.' });

      const messages = await query(
        `SELECT id, author_type, author_name, content, created_at
         FROM ticket_messages WHERE ticket_id = $1 AND is_internal = false ORDER BY created_at`,
        [ticket.id as string]
      );
      return { ...ticket, messages };
    }
  );

  // POST /api/public/tickets/:token/messages
  app.post<{
    Params: { token: string };
    Body: { author_name: string; content: string };
  }>(
    '/api/public/tickets/:token/messages',
    async (req, reply) => {
      const { content } = req.body;
      if (content.length > 5000) return reply.status(400).send({ message: 'Mensagem muito longa.' });

      const ticket = await queryOne<{ id: string; status: string }>(
        'SELECT id, status FROM tickets WHERE public_token = $1',
        [req.params.token]
      );
      if (!ticket) return reply.status(404).send({ message: 'Token inválido.' });
      if (['resolved', 'closed'].includes(ticket.status)) {
        return reply.status(400).send({ message: 'Ticket já encerrado.' });
      }

      await query(
        `INSERT INTO ticket_messages (ticket_id, author_type, author_name, content)
         VALUES ($1, 'customer', $2, $3)`,
        [ticket.id, req.body.author_name, content]
      );
      return { ok: true };
    }
  );

  // GET /api/public/nps/:token
  app.get<{ Params: { token: string } }>(
    '/api/public/nps/:token',
    async (req, reply) => {
      const nps = await queryOne<{ id: string; responded_at: string | null }>(
        `SELECT n.id, c.company as client_company, c.name as client_name, n.responded_at
         FROM nps_responses n JOIN clients c ON c.id = n.client_id
         WHERE n.public_token = $1`,
        [req.params.token]
      ) as Record<string, unknown> | null;
      if (!nps) return reply.status(404).send({ message: 'Token inválido' });
      return { ...nps, responded: nps.responded_at !== null };
    }
  );

  // POST /api/public/nps/:token
  app.post<{
    Params: { token: string };
    Body: { score: number; comment?: string };
  }>(
    '/api/public/nps/:token',
    async (req, reply) => {
      const { score, comment } = req.body;
      const classification =
        score >= 9 ? 'promoter' : score >= 7 ? 'neutral' : 'detractor';

      await query(
        `UPDATE nps_responses
         SET score = $1, comment = $2, classification = $3, responded_at = NOW()
         WHERE public_token = $4`,
        [score, comment ?? null, classification, req.params.token]
      );
      return { ok: true };
    }
  );

  // ── Link público de criação de template do WhatsApp (Meta) ─────────────────────────────
  // Enviado pra equipe copiar/mandar depois da entrega (ver DeliveryTab.tsx). O cliente
  // preenche em linguagem simples (propósito + corpo com variáveis + botões), escolhe em quais
  // números da empresa criar (um tenant pode ter mais de um WhatsApp oficial conectado), e o
  // backend cria o template em cada um, direto na Meta (server/src/lib/wabaAccess.ts).

  interface RequestTarget {
    wabaId: string;
    label: string;
    status: 'submitted' | 'failed';
    externalId?: string;
    metaStatus?: string;
    errorMessage?: string;
  }

  // GET /api/public/template-requests/:token — dados pra renderizar a página (nome do cliente,
  // números disponíveis pra escolher, e se já foi enviado, o resultado por número em vez do form).
  app.get<{ Params: { token: string } }>(
    '/api/public/template-requests/:token',
    async (req, reply) => {
      const row = await queryOne<{
        id: string;
        status: string;
        purpose: string | null;
        template_name: string | null;
        targets: RequestTarget[] | null;
        client_id: string;
      }>(
        `SELECT id, status, purpose, template_name, targets, client_id FROM template_requests WHERE token = $1`,
        [req.params.token]
      );
      if (!row) return reply.status(404).send({ message: 'Link inválido ou expirado.' });
      const client = await queryOne<{ name: string; company: string | null }>(
        'SELECT name, company FROM clients WHERE id = $1',
        [row.client_id]
      );
      // Números disponíveis enquanto ainda dá pra (re)enviar — 'failed' inclui aqui de propósito
      // (nenhum número deu certo, o formulário volta pra tentar de novo); só 'submitted' (pelo
      // menos um número já criado) não precisa mais consultar a NX.
      const numbers = row.status !== 'submitted' ? await resolveWabaAccesses(row.client_id) : [];
      return {
        status: row.status,
        purpose: row.purpose,
        templateName: row.template_name,
        targets: row.targets ?? [],
        numbers: numbers.map((n) => ({ wabaId: n.wabaId, label: n.label })),
        clientName: client?.company?.trim() || client?.name || '',
      };
    }
  );

  // POST /api/public/template-requests/:token/submit — cria o template na Meta, em cada número
  // escolhido (wabaIds — vazio/ausente = todos os números disponíveis do tenant).
  app.post<{
    Params: { token: string };
    Body: {
      purpose?: string;
      header?: string;
      body?: string;
      footer?: string;
      variables?: { position: number; example: string }[];
      buttons?: ButtonInput[];
      wabaIds?: string[];
    };
  }>(
    '/api/public/template-requests/:token/submit',
    async (req, reply) => {
      const row = await queryOne<{ id: string; client_id: string; status: string }>(
        'SELECT id, client_id, status FROM template_requests WHERE token = $1',
        [req.params.token]
      );
      if (!row) return reply.status(404).send({ message: 'Link inválido ou expirado.' });
      if (row.status === 'submitted') {
        return reply.status(400).send({ message: 'Este template já foi enviado.' });
      }

      const purpose = (req.body?.purpose ?? '').trim();
      const header = (req.body?.header ?? '').trim();
      const body = (req.body?.body ?? '').trim();
      const footer = (req.body?.footer ?? '').trim();
      const variables = req.body?.variables ?? [];
      const buttons = req.body?.buttons ?? [];

      if (!purpose) return reply.status(400).send({ message: 'Conte pra gente o propósito dessa mensagem.' });
      if (!body) return reply.status(400).send({ message: 'Escreva o texto da mensagem.' });
      if (body.length > 1024) {
        return reply.status(400).send({ message: 'O texto passa de 1024 caracteres, o limite do WhatsApp.' });
      }
      if (header.length > 60) return reply.status(400).send({ message: 'O cabeçalho passa de 60 caracteres, o limite do WhatsApp.' });
      if (footer.length > 60) return reply.status(400).send({ message: 'O rodapé passa de 60 caracteres, o limite do WhatsApp.' });
      const vars = bodyVariables(body);
      const expected = vars.map((_, i) => i + 1);
      if (vars.join(',') !== expected.join(',')) {
        return reply.status(400).send({
          message: 'As variáveis precisam ser sequenciais a partir de {{1}}, sem pular números.',
        });
      }
      const edgeIssue = bodyEdgeVariableIssue(body);
      if (edgeIssue) {
        return reply.status(400).send({
          message:
            edgeIssue === 'end'
              ? 'A mensagem não pode terminar com uma variável — a Meta exige um texto fixo no final (ex.: uma saudação ou ponto final).'
              : 'A mensagem não pode começar com uma variável — a Meta exige um texto fixo no início.',
        });
      }
      const missingExample = vars.find((n) => !variables.find((v) => v.position === n)?.example?.trim());
      if (missingExample) {
        return reply.status(400).send({ message: `Falta um exemplo pra variável {{${missingExample}}}.` });
      }

      const allNumbers = await resolveWabaAccesses(row.client_id);
      if (!allNumbers.length) {
        return reply.status(400).send({
          message: 'Não conseguimos localizar seu canal do WhatsApp oficial pra criar o template. Fale com nosso suporte.',
        });
      }
      const requestedIds = req.body?.wabaIds?.length ? new Set(req.body.wabaIds) : null;
      const selected = requestedIds ? allNumbers.filter((n) => requestedIds.has(n.wabaId)) : allNumbers;
      if (!selected.length) {
        return reply.status(400).send({ message: 'Escolha ao menos um número.' });
      }

      const name = `${suggestTemplateName(purpose)}_${Date.now().toString(36)}`;
      const category = suggestCategory(body);
      const examples = vars.map((n) => variables.find((v) => v.position === n)?.example.trim() ?? '');

      // Um template por número selecionado — independentes: um número com token vencido não
      // impede os outros de criarem normalmente.
      const targets: RequestTarget[] = await Promise.all(
        selected.map(async (access): Promise<RequestTarget> => {
          try {
            const created = await createTemplate(access, { name, language: 'pt_BR', category, header, body, footer, examples, buttons });
            return {
              wabaId: access.wabaId,
              label: access.label,
              status: 'submitted',
              externalId: created.id,
              metaStatus: created.status ?? 'PENDING',
            };
          } catch (err) {
            return {
              wabaId: access.wabaId,
              label: access.label,
              status: 'failed',
              errorMessage: err instanceof Error ? err.message : 'Falha ao criar o template na Meta.',
            };
          }
        })
      );

      const okCount = targets.filter((t) => t.status === 'submitted').length;
      const finalStatus = okCount > 0 ? 'submitted' : 'failed';
      await query(
        `UPDATE template_requests
         SET status = $1, purpose = $2, template_name = $3, header = $4, body = $5, footer = $6,
             variables = $7, buttons = $8, category = $9, targets = $10, submitted_at = NOW()
         WHERE id = $11`,
        [
          finalStatus, purpose, name, header || null, body, footer || null,
          JSON.stringify(variables), JSON.stringify(buttons), category, JSON.stringify(targets), row.id,
        ]
      );

      if (okCount > 0) {
        void sendSupportGroupMessage(
          `📄 Novo template do WhatsApp criado (aguardando aprovação da Meta): "${name}" em ${okCount} de ${targets.length} número(s)`
        );
      }

      return { ok: okCount > 0, targets };
    }
  );
}
