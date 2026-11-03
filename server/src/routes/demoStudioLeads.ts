import { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { query, queryOne, withTransaction } from '../db.js';
import { DS_WORKSPACE_ID } from '../db/demoStudio.js';
import { exigir, papelDaRequisicao, validar, type Usuario } from '../lib/demoStudio/acesso.js';
import { criarLimitador, ipDoVisitante } from '../lib/demoStudio/coleta.js';
import { LEAD_QUENTE, apagarLeadComTudo, atualizarPontuacao, ligarLeadAoVisitante, salvarLead } from '../lib/demoStudio/leads.js';
import { codigoDeLink, versaoPublicada } from '../lib/demoStudio/snapshot.js';
import { EVENTOS_DE_WEBHOOK, dispararEvento, entregar, novoSegredo } from '../lib/demoStudio/webhooks.js';

/**
 * M3 do Demo Studio: links (canal e personalizado por lead, §4.4), leads (§4.6), webhooks (§9.1) e
 * configurações (usuários do módulo, CTA padrão). Vendedor (SELLER) só enxerga e mexe no que é dele:
 * links que criou e leads de que é responsável ou que vieram dos links dele.
 */

const uuid = z.string().uuid();
const souVendedor = (req: FastifyRequest) => papelDaRequisicao(req) === 'SELLER';
const eu = (req: FastifyRequest) => (req.user as Usuario).sub;

/* ------------------------------------------------------------------ formatos */

function linkDaLinha(l: Record<string, any>) {
  return {
    id: l.id,
    code: l.code,
    kind: l.kind,
    label: l.label,
    demo: { id: l.demo_id, name: l.demo_name, slug: l.demo_slug, status: l.demo_status },
    createdBy: l.created_by ? { id: l.created_by, name: l.creator_name } : null,
    lead: l.lead_id ? { id: l.lead_id, name: l.lead_name, company: l.lead_company } : null,
    variables: l.variables ?? {},
    utm: l.utm ?? {},
    active: l.active,
    expiresAt: l.expires_at,
    createdAt: l.created_at,
    views: l.views ?? 0,
    leads: l.leads ?? 0,
    completed: l.completed ?? 0,
    lastSeenAt: l.last_seen_at ?? null,
  };
}

const SQL_LINKS = `
  SELECT l.*, d.name AS demo_name, d.slug AS demo_slug, d.status AS demo_status, p.name AS creator_name,
         ld.name AS lead_name, ld.company AS lead_company,
         st.views, st.leads, st.completed, st.last_seen_at
  FROM ds_share_links l
  JOIN ds_demos d ON d.id = l.demo_id
  LEFT JOIN profiles p ON p.id = l.created_by
  LEFT JOIN ds_leads ld ON ld.id = l.lead_id
  LEFT JOIN LATERAL (
    SELECT COUNT(*)::int AS views, COUNT(DISTINCT s.lead_id)::int AS leads,
           COUNT(*) FILTER (WHERE s.completed)::int AS completed, MAX(s.last_seen_at) AS last_seen_at
    FROM ds_view_sessions s WHERE s.link_id = l.id AND NOT s.internal
  ) st ON TRUE`;

function leadDaLinha(r: Record<string, any>) {
  return {
    id: r.id,
    name: r.name,
    company: r.company,
    phone: r.phone_e164,
    email: r.email,
    role: r.role,
    cnpj: r.cnpj,
    status: r.status,
    score: r.score,
    hot: r.score >= LEAD_QUENTE,
    owner: r.owner_id ? { id: r.owner_id, name: r.owner_name } : null,
    source: { demoId: r.source?.demoId ?? null, demoName: r.source_demo ?? null, linkLabel: r.source_link ?? null, channel: r.source?.channel ?? null },
    notes: r.notes,
    firstSeenAt: r.first_seen_at,
    lastSeenAt: r.last_seen_at,
    sessions: r.sessions ?? 0,
    maxPct: Number(r.max_pct ?? 0),
    ctaClicked: !!r.cta,
  };
}

const SQL_LEADS = `
  SELECT ld.*, p.name AS owner_name, d.name AS source_demo, sl.label AS source_link,
         st.sessions, st.max_pct, st.cta
  FROM ds_leads ld
  LEFT JOIN profiles p ON p.id = ld.owner_id
  LEFT JOIN ds_demos d ON d.id::text = ld.source->>'demoId'
  LEFT JOIN ds_share_links sl ON sl.id::text = ld.source->>'linkId'
  LEFT JOIN LATERAL (
    SELECT COUNT(*)::int AS sessions,
           MAX(CASE WHEN s.total_steps > 0 THEN LEAST(s.steps_viewed::numeric / s.total_steps, 1) ELSE 0 END) AS max_pct,
           BOOL_OR(s.cta_clicked) AS cta
    FROM ds_view_sessions s WHERE s.lead_id = ld.id AND NOT s.internal
  ) st ON TRUE`;

/** Vendedor só vê lead de que é responsável ou que veio de um link dele. */
const FILTRO_DO_VENDEDOR = `(ld.owner_id = $X OR EXISTS (SELECT 1 FROM ds_share_links x WHERE x.lead_id = ld.id AND x.created_by = $X)
  OR EXISTS (SELECT 1 FROM ds_view_sessions xs JOIN ds_share_links xl ON xl.id = xs.link_id WHERE xs.lead_id = ld.id AND xl.created_by = $X))`;

async function podeVerLead(req: FastifyRequest, leadId: string): Promise<boolean> {
  if (!souVendedor(req)) return true;
  const r = await queryOne(`SELECT 1 FROM ds_leads ld WHERE ld.id = $1 AND ${FILTRO_DO_VENDEDOR.replace(/\$X/g, '$2')}`, [leadId, eu(req)]);
  return !!r;
}

/* ------------------------------------------------------------------ schemas */

const criarLinkCanal = z.object({
  kind: z.literal('CHANNEL'),
  label: z.string().trim().min(1, 'Dê um nome ao link').max(80),
  utm: z.object({ source: z.string().max(100), medium: z.string().max(100), campaign: z.string().max(100) }).partial().optional(),
  expiresAt: z.string().datetime({ offset: true }).nullable().optional(),
});
const criarLinkPessoal = z.object({
  kind: z.literal('PERSONAL'),
  nome: z.string().trim().max(120).optional().default(''),
  empresa: z.string().trim().max(120).optional().default(''),
  whatsapp: z.string().trim().max(30).optional().default(''),
  label: z.string().trim().max(80).optional(),
  expiresAt: z.string().datetime({ offset: true }).nullable().optional(),
}).refine((d) => d.nome || d.empresa, { message: 'Informe o nome ou a empresa do lead' });
const criarLink = z.union([criarLinkCanal, criarLinkPessoal]);

const editarLink = z.object({
  label: z.string().trim().min(1).max(80),
  active: z.boolean(),
  expiresAt: z.string().datetime({ offset: true }).nullable(),
}).partial();

const STATUS = ['NOVO', 'EM_CONTATO', 'QUALIFICADO', 'GANHO', 'PERDIDO'] as const;
const editarLead = z.object({
  status: z.enum(STATUS),
  ownerId: uuid.nullable(),
  notes: z.string().max(5000).nullable(),
  name: z.string().max(200).nullable(),
  company: z.string().max(200).nullable(),
  phone: z.string().max(30).nullable(),
  email: z.string().max(200).nullable(),
  role: z.string().max(200).nullable(),
}).partial();

const filtroLeads = z.object({
  status: z.enum(STATUS).optional(),
  ownerId: uuid.optional(),
  demoId: uuid.optional(),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  q: z.string().max(100).optional(),
  quentes: z.enum(['1']).optional(),
});

const enviarLead = z.object({
  demoId: uuid,
  sessionId: uuid,
  visitorId: uuid,
  linkCode: z.string().regex(/^[0-9A-Za-z]{7}$/).optional(),
  origem: z.enum(['form', 'cta']),
  consent: z.boolean().optional(),
  fields: z.object({
    nome: z.string().max(200), empresa: z.string().max(200), whatsapp: z.string().max(30),
    email: z.string().max(200), cargo: z.string().max(200), cnpj: z.string().max(30),
  }).partial(),
});

const webhook = z.object({
  url: z.string().url('URL inválida').max(500).refine((u) => /^https?:\/\//.test(u), 'Use http(s)'),
  events: z.array(z.enum(EVENTOS_DE_WEBHOOK)).min(1, 'Escolha pelo menos um evento'),
  active: z.boolean().optional(),
});

/* ------------------------------------------------------------------ rotas */

export async function demoStudioLeadsRoutes(app: FastifyInstance) {
  const ver = { onRequest: [app.authenticate], preHandler: exigir('ver') };
  const soAdmin = { onRequest: [app.authenticate], preHandler: exigir('admin') };

  /* ---------------------------------------------------------------- links */

  app.get<{ Querystring: { demoId?: string; scope?: string } }>('/api/ds/links', ver, async (req) => {
    const so = souVendedor(req) || req.query.scope === 'mine' ? eu(req) : null;
    const demoId = req.query.demoId && uuid.safeParse(req.query.demoId).success ? req.query.demoId : null;
    const rows = await query(
      `${SQL_LINKS} WHERE ($1::uuid IS NULL OR l.created_by = $1) AND ($2::uuid IS NULL OR l.demo_id = $2)
       ORDER BY l.created_at DESC`,
      [so, demoId]
    );
    return rows.map(linkDaLinha);
  });

  app.post<{ Params: { id: string } }>('/api/ds/demos/:id/links', ver, async (req, reply) => {
    const dados = validar(criarLink, req.body, reply);
    if (!dados) return;
    const demo = await queryOne<{ id: string; status: string }>('SELECT id, status FROM ds_demos WHERE id = $1', [req.params.id]);
    if (!demo) return reply.status(404).send({ message: 'Demo não encontrada' });
    if (souVendedor(req)) {
      if (dados.kind !== 'PERSONAL') return reply.status(403).send({ message: 'Vendedor cria só links personalizados.' });
      if (demo.status !== 'PUBLISHED') return reply.status(403).send({ message: 'Essa demo não está publicada.' });
    }
    const quem = await queryOne<{ name: string | null }>('SELECT name FROM profiles WHERE id = $1', [eu(req)]);
    const { linkId, leadCriado, leadId } = await withTransaction(async (db) => {
      let leadId: string | null = null;
      let leadCriado = false;
      let label: string;
      let variables: Record<string, string> = {};
      if (dados.kind === 'PERSONAL') {
        const lead = await salvarLead(
          db,
          { name: dados.nome, company: dados.empresa, phone: dados.whatsapp },
          { ownerId: eu(req), source: { demoId: demo.id, channel: 'Link personalizado' } }
        );
        leadId = lead.id;
        leadCriado = lead.criado;
        label = dados.label || `Lead · ${[dados.nome, dados.empresa].filter(Boolean).join(' / ')}`;
        variables = { nome: dados.nome, empresa: dados.empresa, vendedor: quem?.name ?? '' };
      } else {
        label = dados.label;
      }
      // Código curto aleatório; colisão é rara, mas existe — tenta de novo.
      for (let i = 0; i < 5; i++) {
        const code = codigoDeLink();
        const { rows } = await db.query(
          `INSERT INTO ds_share_links (demo_id, code, kind, label, created_by, lead_id, variables, utm, expires_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) ON CONFLICT (code) DO NOTHING RETURNING id`,
          [demo.id, code, dados.kind, label, eu(req), leadId, JSON.stringify(variables),
            JSON.stringify(dados.kind === 'CHANNEL' ? dados.utm ?? {} : {}), dados.expiresAt ?? null]
        );
        if (rows[0]) {
          if (leadId) {
            await db.query(`UPDATE ds_leads SET source = source || jsonb_build_object('linkId', $2::text) WHERE id = $1 AND NOT (source ? 'linkId')`, [leadId, rows[0].id]);
          }
          return { linkId: rows[0].id as string, leadCriado, leadId };
        }
      }
      throw new Error('Não foi possível gerar um código de link');
    });
    if (leadId) await dispararEvento(leadCriado ? 'lead.created' : 'lead.updated', { leadId });
    const link = await queryOne(`${SQL_LINKS} WHERE l.id = $1`, [linkId]);
    return reply.status(201).send(linkDaLinha(link!));
  });

  app.patch<{ Params: { id: string } }>('/api/ds/links/:id', ver, async (req, reply) => {
    const dados = validar(editarLink, req.body, reply);
    if (!dados) return;
    const l = await queryOne<{ created_by: string | null }>('SELECT created_by FROM ds_share_links WHERE id = $1', [req.params.id]);
    if (!l) return reply.status(404).send({ message: 'Link não encontrado' });
    if (souVendedor(req) && l.created_by !== eu(req)) return reply.status(403).send({ message: 'Esse link não é seu.' });
    await query(
      `UPDATE ds_share_links SET label = COALESCE($2, label), active = COALESCE($3, active),
         expires_at = CASE WHEN $4::boolean THEN $5::timestamptz ELSE expires_at END WHERE id = $1`,
      [req.params.id, dados.label ?? null, dados.active ?? null, 'expiresAt' in dados, dados.expiresAt ?? null]
    );
    const link = await queryOne(`${SQL_LINKS} WHERE l.id = $1`, [req.params.id]);
    return linkDaLinha(link!);
  });

  /* ---------------------------------------------------------------- leads */

  app.get('/api/ds/leads', ver, async (req, reply) => {
    const f = validar(filtroLeads, req.query, reply);
    if (!f) return;
    const cond: string[] = ['ld.workspace_id = $1'];
    const p: unknown[] = [DS_WORKSPACE_ID];
    const add = (sql: string, v: unknown) => { p.push(v); cond.push(sql.replace(/\$X/g, `$${p.length}`)); };
    if (f.status) add('ld.status = $X', f.status);
    if (f.ownerId) add('ld.owner_id = $X', f.ownerId);
    if (f.demoId) add(`ld.source->>'demoId' = $X`, f.demoId);
    if (f.from) add('ld.last_seen_at >= $X', new Date(`${f.from}T00:00:00-03:00`));
    if (f.to) add('ld.first_seen_at <= $X', new Date(`${f.to}T23:59:59.999-03:00`));
    if (f.q) add(`(ld.name ILIKE $X OR ld.company ILIKE $X OR ld.email ILIKE $X OR ld.phone_e164 ILIKE $X)`, `%${f.q}%`);
    if (f.quentes) add('ld.score >= $X', LEAD_QUENTE);
    if (souVendedor(req)) add(FILTRO_DO_VENDEDOR, eu(req));
    const rows = await query(`${SQL_LEADS} WHERE ${cond.join(' AND ')} ORDER BY ld.last_seen_at DESC LIMIT 1000`, p);
    return rows.map(leadDaLinha);
  });

  app.get<{ Params: { id: string } }>('/api/ds/leads/:id', ver, async (req, reply) => {
    if (!uuid.safeParse(req.params.id).success || !(await podeVerLead(req, req.params.id))) {
      return reply.status(404).send({ message: 'Lead não encontrado' });
    }
    const r = await queryOne(`${SQL_LEADS} WHERE ld.id = $1`, [req.params.id]);
    if (!r) return reply.status(404).send({ message: 'Lead não encontrado' });
    const [sessoes, links] = await Promise.all([
      query(
        `SELECT s.id, s.started_at AS "startedAt", s.active_ms AS "activeMs", s.steps_viewed AS "stepsViewed",
                s.total_steps AS "totalSteps", s.completed, s.cta_clicked AS "ctaClicked", s.device,
                d.name AS "demoName", l.label AS "linkLabel"
         FROM ds_view_sessions s JOIN ds_demos d ON d.id = s.demo_id LEFT JOIN ds_share_links l ON l.id = s.link_id
         WHERE s.lead_id = $1 AND NOT s.internal ORDER BY s.started_at DESC`,
        [req.params.id]
      ),
      query(`${SQL_LINKS} WHERE l.lead_id = $1 ORDER BY l.created_at DESC`, [req.params.id]),
    ]);
    return { ...leadDaLinha(r), sessionsList: sessoes, links: links.map(linkDaLinha) };
  });

  app.patch<{ Params: { id: string } }>('/api/ds/leads/:id', ver, async (req, reply) => {
    const dados = validar(editarLead, req.body, reply);
    if (!dados) return;
    if (!(await podeVerLead(req, req.params.id))) return reply.status(404).send({ message: 'Lead não encontrado' });
    if (souVendedor(req) && 'ownerId' in dados && dados.ownerId !== eu(req)) {
      return reply.status(403).send({ message: 'Vendedor não troca o responsável do lead.' });
    }
    const atual = await queryOne<Record<string, any>>('SELECT * FROM ds_leads WHERE id = $1', [req.params.id]);
    if (!atual) return reply.status(404).send({ message: 'Lead não encontrado' });
    if (dados.name !== undefined || dados.company !== undefined || dados.phone !== undefined || dados.email !== undefined || dados.role !== undefined) {
      await withTransaction((db) => salvarLead(db, { name: dados.name, company: dados.company, phone: dados.phone, email: dados.email, role: dados.role }, { leadId: atual.id }));
    }
    await query(
      `UPDATE ds_leads SET status = COALESCE($2, status),
         owner_id = CASE WHEN $3::boolean THEN $4::uuid ELSE owner_id END,
         notes = CASE WHEN $5::boolean THEN $6 ELSE notes END
       WHERE id = $1`,
      [atual.id, dados.status ?? null, 'ownerId' in dados, dados.ownerId ?? null, 'notes' in dados, dados.notes ?? null]
    );
    await dispararEvento('lead.updated', { leadId: atual.id });
    const r = await queryOne(`${SQL_LEADS} WHERE ld.id = $1`, [atual.id]);
    return leadDaLinha(r!);
  });

  app.delete<{ Params: { id: string } }>('/api/ds/leads/:id', soAdmin, async (req, reply) => {
    const ok = await apagarLeadComTudo(req.params.id);
    if (!ok) return reply.status(404).send({ message: 'Lead não encontrado' });
    return reply.status(204).send();
  });

  /* ---------------------------------------------------------------- configurações (admin) */

  app.get('/api/ds/users', soAdmin, async () => {
    return query(
      `SELECT p.id, p.name, p.email, p.role,
              (p.role = 'admin' OR EXISTS (SELECT 1 FROM user_menu_access a WHERE a.user_id = p.id AND a.menu_key = 'demo_studio')) AS "hasAccess",
              CASE WHEN p.role = 'admin' THEN 'ADMIN' WHEN p.ds_role = 'SELLER' THEN 'SELLER' ELSE 'EDITOR' END AS "dsRole"
       FROM profiles p ORDER BY p.name NULLS LAST, p.email`
    );
  });

  app.patch<{ Params: { id: string } }>('/api/ds/users/:id', soAdmin, async (req, reply) => {
    const dados = validar(z.object({ hasAccess: z.boolean(), dsRole: z.enum(['EDITOR', 'SELLER']) }).partial(), req.body, reply);
    if (!dados) return;
    const p = await queryOne('SELECT 1 FROM profiles WHERE id = $1', [req.params.id]);
    if (!p) return reply.status(404).send({ message: 'Usuário não encontrado' });
    if (dados.dsRole) await query(`UPDATE profiles SET ds_role = $2 WHERE id = $1`, [req.params.id, dados.dsRole === 'SELLER' ? 'SELLER' : null]);
    if (dados.hasAccess === true) {
      await query(`INSERT INTO user_menu_access (user_id, menu_key) VALUES ($1, 'demo_studio') ON CONFLICT DO NOTHING`, [req.params.id]);
    } else if (dados.hasAccess === false) {
      await query(`DELETE FROM user_menu_access WHERE user_id = $1 AND menu_key = 'demo_studio'`, [req.params.id]);
    }
    return { ok: true };
  });

  /** Opções de responsável (quem tem acesso ao módulo) — usado na tela do lead. */
  app.get('/api/ds/people', ver, async () => {
    return query(
      `SELECT p.id, p.name FROM profiles p
       WHERE p.role = 'admin' OR EXISTS (SELECT 1 FROM user_menu_access a WHERE a.user_id = p.id AND a.menu_key = 'demo_studio')
       ORDER BY p.name NULLS LAST`
    );
  });

  app.get('/api/ds/settings', ver, async () => {
    const ws = await queryOne<{ settings: Record<string, unknown> }>('SELECT settings FROM ds_workspaces WHERE id = $1', [DS_WORKSPACE_ID]);
    return ws?.settings ?? {};
  });

  app.patch('/api/ds/settings', soAdmin, async (req, reply) => {
    const dados = validar(
      z.object({
        ctaDefault: z.object({ phone: z.string().max(20), message: z.string().max(1000) }).partial(),
        privacyUrl: z.string().url().max(500).or(z.literal('')),
        consentText: z.string().max(500),
      }).partial(),
      req.body,
      reply
    );
    if (!dados) return;
    await query(`UPDATE ds_workspaces SET settings = settings || $2::jsonb WHERE id = $1`, [DS_WORKSPACE_ID, JSON.stringify(dados)]);
    return { ok: true };
  });

  /* ---------------------------------------------------------------- webhooks (admin) */

  app.get('/api/ds/webhooks', soAdmin, async () => {
    return query(
      `SELECT w.id, w.url, w.secret, w.events, w.active, w.created_at AS "createdAt",
              (SELECT COUNT(*)::int FROM ds_webhook_deliveries d WHERE d.webhook_id = w.id AND d.status = 'FAILED') AS "failed",
              (SELECT MAX(d.created_at) FROM ds_webhook_deliveries d WHERE d.webhook_id = w.id) AS "lastDeliveryAt"
       FROM ds_webhooks w WHERE w.workspace_id = $1 ORDER BY w.created_at`,
      [DS_WORKSPACE_ID]
    );
  });

  app.post('/api/ds/webhooks', soAdmin, async (req, reply) => {
    const dados = validar(webhook, req.body, reply);
    if (!dados) return;
    const r = await queryOne(
      `INSERT INTO ds_webhooks (workspace_id, url, secret, events, active) VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [DS_WORKSPACE_ID, dados.url, novoSegredo(), dados.events, dados.active ?? true]
    );
    return reply.status(201).send(r);
  });

  app.patch<{ Params: { id: string } }>('/api/ds/webhooks/:id', soAdmin, async (req, reply) => {
    const dados = validar(webhook.partial().extend({ regenerateSecret: z.boolean().optional() }), req.body, reply);
    if (!dados) return;
    const r = await query(
      `UPDATE ds_webhooks SET url = COALESCE($2, url), events = COALESCE($3, events), active = COALESCE($4, active),
         secret = CASE WHEN $5::boolean THEN $6 ELSE secret END WHERE id = $1 RETURNING id`,
      [req.params.id, dados.url ?? null, dados.events ?? null, dados.active ?? null, !!dados.regenerateSecret, novoSegredo()]
    );
    if (!r.length) return reply.status(404).send({ message: 'Webhook não encontrado' });
    return { ok: true };
  });

  app.delete<{ Params: { id: string } }>('/api/ds/webhooks/:id', soAdmin, async (req, reply) => {
    await query(`DELETE FROM ds_webhooks WHERE id = $1`, [req.params.id]);
    return reply.status(204).send();
  });

  /** "Enviar teste": entrega na hora (sem esperar o worker) e devolve o que o n8n respondeu. */
  app.post<{ Params: { id: string } }>('/api/ds/webhooks/:id/test', soAdmin, async (req, reply) => {
    const w = await queryOne('SELECT 1 FROM ds_webhooks WHERE id = $1', [req.params.id]);
    if (!w) return reply.status(404).send({ message: 'Webhook não encontrado' });
    const payload = {
      event: 'test',
      sentAt: new Date().toISOString(),
      message: 'Teste do NX Demo Studio. Se chegou, o webhook está configurado.',
    };
    const d = await queryOne<{ id: string }>(
      `INSERT INTO ds_webhook_deliveries (webhook_id, event, payload, attempts) VALUES ($1, 'test', $2, 3) RETURNING id`,
      [req.params.id, JSON.stringify(payload)]
    );
    // attempts começa em 3: o teste não fica tentando de novo sozinho se falhar.
    const r = await entregar(d!.id);
    return { ok: r.ok, status: r.status, body: r.corpo };
  });

  app.get<{ Params: { id: string } }>('/api/ds/webhooks/:id/deliveries', soAdmin, async (req) => {
    return query(
      `SELECT id, event, status, attempts, response_code AS "responseCode", response_body AS "responseBody",
              created_at AS "createdAt", next_attempt_at AS "nextAttemptAt"
       FROM ds_webhook_deliveries WHERE webhook_id = $1 ORDER BY created_at DESC LIMIT 50`,
      [req.params.id]
    );
  });

  /* ---------------------------------------------------------------- públicas */

  /** Link nomeado/personalizado → demo publicada + variáveis. Do lead só sai nome e empresa (§12). */
  app.get<{ Params: { code: string } }>('/api/public/ds/links/:code', async (req, reply) => {
    reply.header('Access-Control-Allow-Origin', '*');
    const l = await queryOne<Record<string, any>>(
      `SELECT l.code, l.lead_id, l.variables, l.utm, d.slug FROM ds_share_links l JOIN ds_demos d ON d.id = l.demo_id
       WHERE l.code = $1 AND l.active AND (l.expires_at IS NULL OR l.expires_at > NOW())`,
      [req.params.code]
    );
    const demo = l ? await versaoPublicada(l.slug) : null;
    if (!l || !demo) return reply.status(404).send({ message: 'Link indisponível.' });
    const v = l.variables ?? {};
    return reply.header('Cache-Control', 'no-store').send({
      demo,
      linkCode: l.code,
      variables: { nome: v.nome ?? '', empresa: v.empresa ?? '', vendedor: v.vendedor ?? '' },
      utm: l.utm ?? {},
      leadKnown: !!l.lead_id,
    });
  });

  // Formulário de lead e CTA com nome/empresa (§7.2, §8.2). 10 por minuto por IP (§13).
  const limiteLeads = criarLimitador(10, 60_000);
  app.post('/api/public/ds/leads', { bodyLimit: 16 * 1024 }, async (req, reply) => {
    reply.header('Access-Control-Allow-Origin', '*');
    if (!limiteLeads(ipDoVisitante(req.headers['x-forwarded-for'], req.ip))) {
      return reply.status(429).send({ message: 'Muitas tentativas. Aguarde um minuto.' });
    }
    let corpo: unknown = req.body;
    if (typeof corpo === 'string') {
      try {
        corpo = JSON.parse(corpo);
      } catch {
        return reply.status(400).send({ message: 'Dados inválidos' });
      }
    }
    const dados = validar(enviarLead, corpo, reply);
    if (!dados) return;
    const f = dados.fields;
    if (dados.origem === 'form') {
      if (!dados.consent) return reply.status(400).send({ message: 'É preciso concordar com o contato para enviar.' });
      if (!f.whatsapp?.trim() && !f.email?.trim()) return reply.status(400).send({ message: 'Informe o WhatsApp ou o e-mail.' });
    } else if (!f.nome?.trim() && !f.empresa?.trim()) {
      return reply.status(204).send();
    }
    const demo = await queryOne('SELECT 1 FROM ds_demos WHERE id = $1', [dados.demoId]);
    if (!demo) return reply.status(404).send({ message: 'Demo não encontrada' });
    const link = dados.linkCode
      ? await queryOne<{ id: string; created_by: string | null; lead_id: string | null; label: string }>(
          `SELECT id, created_by, lead_id, label FROM ds_share_links WHERE code = $1 AND demo_id = $2`,
          [dados.linkCode, dados.demoId]
        )
      : null;

    const r = await withTransaction(async (db) => {
      const sessao = (await db.query(`SELECT lead_id, visitor_id FROM ds_view_sessions WHERE id = $1`, [dados.sessionId])).rows[0];
      // Sessão de outro visitante: não liga (alguém tentando grudar lead em sessão alheia).
      const sessaoValida = sessao && sessao.visitor_id === dados.visitorId;
      const visitante = (await db.query(`SELECT lead_id FROM ds_visitors WHERE id = $1`, [dados.visitorId])).rows[0];
      const leadId = (sessaoValida ? sessao.lead_id : null) ?? link?.lead_id ?? visitante?.lead_id ?? null;
      const lead = await salvarLead(
        db,
        { name: f.nome, company: f.empresa, phone: f.whatsapp, email: f.email, role: f.cargo, cnpj: f.cnpj },
        {
          leadId,
          ownerId: link?.created_by ?? null,
          source: { demoId: dados.demoId, ...(link ? { linkId: link.id } : {}), channel: link?.label ?? (dados.origem === 'form' ? 'Formulário' : 'CTA') },
        }
      );
      await db.query(
        `INSERT INTO ds_visitors (id, lead_id) VALUES ($1, $2) ON CONFLICT (id) DO UPDATE SET lead_id = EXCLUDED.lead_id`,
        [dados.visitorId, lead.id]
      );
      if (sessaoValida) await ligarLeadAoVisitante(db, lead.id, dados.sessionId);
      return lead;
    });
    await atualizarPontuacao(r.id);
    if (r.criado) await dispararEvento('lead.created', { leadId: r.id, sessionId: dados.sessionId });
    else if (r.mudou) await dispararEvento('lead.updated', { leadId: r.id, sessionId: dados.sessionId });
    return reply.status(201).send({ ok: true });
  });
}
