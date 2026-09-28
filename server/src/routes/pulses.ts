import { FastifyInstance } from 'fastify';
import crypto from 'crypto';
import { query, queryOne } from '../db.js';

/**
 * "Pulso de satisfação": pergunta curta (sim/não) mandada de tempos em tempos pelo WhatsApp, pra
 * pegar sinal de insatisfação antes do cliente virar cancelamento. Quem manda de fato é o n8n (tem
 * a credencial do canal do cliente) — este arquivo só decide QUEM recebe (POST /api/pulses/queue,
 * chamado pelo painel/uma automação com o JWT do time) e registra a resposta que volta (rotas
 * públicas, chamadas pelo n8n quando a mensagem do cliente chega).
 *
 * Segurança das rotas públicas: como não existe um token por-recurso aqui (a "chave" que a pessoa
 * tem é só o próprio telefone, que não dá pra colocar numa URL como token), seguem o MESMO padrão já
 * usado pra outra integração máquina-a-máquina do projeto (webhook do Meta Lead Ads, ver
 * server/src/routes/webhooks.ts): um token fixo em env, comparado em tempo constante contra o header
 * `Authorization: Bearer <token>`. Sem o token configurado, a rota recusa (nunca abre sem proteção).
 */

const DEFAULT_QUESTION =
  'Oi! Por aqui é da equipe da {empresa}. Você está satisfeito(a) com o nosso atendimento? Responda só *sim* ou *não* 🙂';

function renderQuestion(template: string, empresa: string): string {
  return template.replaceAll('{empresa}', empresa);
}

/** Só dígitos, últimos 11 (DDD + número) — compara telefones ignorando DDI/pontuação/formatação. */
function last11Digits(raw: string | null | undefined): string {
  const digits = (raw ?? '').replace(/\D/g, '');
  return digits.slice(-11);
}

function checkPulsesToken(req: { headers: Record<string, unknown> }, reply: { status: (n: number) => { send: (b: unknown) => void } }): boolean {
  const token = process.env.PULSES_WEBHOOK_TOKEN;
  if (!token) {
    reply.status(500).send({ message: 'Webhook de pulso não configurado no servidor (PULSES_WEBHOOK_TOKEN)' });
    return false;
  }
  const authHeader = (req.headers['authorization'] as string | undefined) ?? '';
  const provided = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : authHeader;
  const providedBuf = Buffer.from(provided, 'utf8');
  const expectedBuf = Buffer.from(token, 'utf8');
  const valid = providedBuf.length === expectedBuf.length && crypto.timingSafeEqual(providedBuf, expectedBuf);
  if (!valid) {
    reply.status(401).send({ message: 'Não autorizado' });
    return false;
  }
  return true;
}

interface PulseRow {
  id: string;
  client_id: string;
  phone: string | null;
  question: string;
  sent_at: string;
  status: string;
  response: string | null;
  responded_at: string | null;
  created_at: string;
}

export async function pulseRoutes(app: FastifyInstance) {
  // GET /api/pulses?status=aguardando&from=2026-09-01&to=2026-09-30
  app.get<{ Querystring: { status?: string; from?: string; to?: string } }>(
    '/api/pulses',
    { onRequest: [app.authenticate] },
    async (req) => {
      const { status, from, to } = req.query;
      const where: string[] = [];
      const params: unknown[] = [];
      if (status) { params.push(status); where.push(`p.status = $${params.length}`); }
      if (from) { params.push(from); where.push(`p.sent_at >= $${params.length}`); }
      if (to) { params.push(to); where.push(`p.sent_at <= $${params.length}`); }
      const sql = `
        SELECT p.*, c.name AS client_name, COALESCE(NULLIF(c.company, ''), c.name) AS client_company
        FROM client_pulses p
        JOIN clients c ON c.id = p.client_id
        ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
        ORDER BY p.sent_at DESC
        LIMIT 500`;
      return query(sql, params);
    },
  );

  // POST /api/pulses/queue — seleciona quem recebe um pulso agora e registra (status 'aguardando').
  // Devolve a lista pro n8n de fato mandar a mensagem no WhatsApp de cada um.
  app.post<{ Body: { days?: number; question?: string } }>(
    '/api/pulses/queue',
    { onRequest: [app.authenticate] },
    async (req) => {
      const days = Math.min(365, Math.max(1, Number(req.body?.days) || 30));
      const template = (req.body?.question ?? '').trim() || DEFAULT_QUESTION;

      // Clientes ativos, com telefone, que não receberam pulso nos últimos N dias.
      const eligible = await query<{ id: string; name: string; company: string | null; phone: string | null }>(
        `SELECT c.id, c.name, c.company, c.phone
         FROM clients c
         WHERE c.stage <> 'churned' AND c.archived_at IS NULL
           AND c.phone IS NOT NULL AND c.phone <> ''
           AND NOT EXISTS (
             SELECT 1 FROM client_pulses p
             WHERE p.client_id = c.id AND p.sent_at > NOW() - ($1 || ' days')::interval
           )
         ORDER BY c.company NULLS LAST, c.name`,
        [days],
      );

      if (eligible.length === 0) return { queued: 0, items: [] };

      const values: unknown[] = [];
      const rowsSql: string[] = [];
      const questions: string[] = [];
      eligible.forEach((c, i) => {
        const empresa = (c.company && c.company.trim()) || c.name;
        const question = renderQuestion(template, empresa);
        questions.push(question);
        const base = i * 4;
        values.push(c.id, c.phone, question, 'aguardando');
        rowsSql.push(`($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, NOW())`);
      });

      const inserted = await query<{ id: string; client_id: string }>(
        `INSERT INTO client_pulses (client_id, phone, question, status, sent_at)
         VALUES ${rowsSql.join(', ')}
         RETURNING id, client_id`,
        values,
      );
      const idByClient = new Map(inserted.map((r) => [r.client_id, r.id]));

      const items = eligible.map((c, i) => ({
        pulse_id: idByClient.get(c.id) ?? null,
        client_id: c.id,
        name: (c.company && c.company.trim()) || c.name,
        phone: c.phone,
        question: questions[i],
      }));

      return { queued: items.length, items };
    },
  );

  // POST /api/public/pulses/check — o n8n chama antes de interpretar a resposta do cliente, pra
  // saber se existe um pulso 'aguardando' pra esse telefone e qual foi a pergunta mandada.
  app.post<{ Body: { phone?: string } }>('/api/public/pulses/check', async (req, reply) => {
    if (!checkPulsesToken(req, reply)) return;
    const phone = last11Digits(req.body?.phone);
    if (!phone) return reply.status(400).send({ message: 'phone é obrigatório' });

    const pending = await query<PulseRow>(
      `SELECT * FROM client_pulses WHERE status = 'aguardando' AND phone IS NOT NULL ORDER BY sent_at DESC`,
    );
    const hit = pending.find((p) => last11Digits(p.phone) === phone);
    if (!hit) return { pending: false };
    return { pending: true, pulse_id: hit.id, question: hit.question, sent_at: hit.sent_at };
  });

  // POST /api/public/pulses/respond — o n8n chama quando a resposta (sim/não) chega no WhatsApp.
  app.post<{ Body: { phone?: string; response?: string } }>('/api/public/pulses/respond', async (req, reply) => {
    if (!checkPulsesToken(req, reply)) return;
    const phone = last11Digits(req.body?.phone);
    const response = (req.body?.response ?? '').trim().toLowerCase();
    if (!phone) return reply.status(400).send({ message: 'phone é obrigatório' });
    if (response !== 'sim' && response !== 'nao') {
      return reply.status(400).send({ message: 'response precisa ser "sim" ou "nao"' });
    }

    const pending = await query<PulseRow>(
      `SELECT * FROM client_pulses WHERE status = 'aguardando' AND phone IS NOT NULL ORDER BY sent_at DESC`,
    );
    const hit = pending.find((p) => last11Digits(p.phone) === phone);
    if (!hit) return reply.status(404).send({ message: 'Nenhum pulso aguardando resposta pra esse telefone' });

    const updated = await queryOne<PulseRow>(
      `UPDATE client_pulses SET status = 'respondido', response = $1, responded_at = NOW()
       WHERE id = $2 RETURNING *`,
      [response, hit.id],
    );
    return { ok: true, pulse: updated };
  });
}
