import { FastifyInstance } from 'fastify';
import crypto from 'crypto';
import { query, queryOne } from '../db.js';
import { advanceClientToBriefing } from '../lib/briefingHandoff.js';
import { restrictedBoardFilter } from './leadBoards.js';
import { sendPushToUsers } from '../lib/webPush.js';

/**
 * Webhook do Autentique — o contrato é gerado aqui, mas enviado pra assinatura fora do sistema (a
 * pessoa sobe o PDF manualmente no Autentique, não existe criação via API). Quando o Autentique
 * avisa que o documento foi assinado por todo mundo, este endpoint:
 *   1. acha o contrato vinculado (por autentique_document_id, colado à mão na tela do contrato
 *      depois de subir o PDF lá — ver src/services/contracts.ts);
 *   2. marca o contrato como assinado;
 *   3. avança o cliente pra "Briefing", igual o botão manual "Marcar como assinado" já fazia (ver
 *      ContratoView.tsx, setContractStatus) — só avança, nunca regride, e só se o cliente ainda
 *      estiver exatamente na etapa "Contrato".
 *
 * Sem autenticação normal (é o Autentique chamando, não um usuário logado) — a segurança aqui é a
 * validação HMAC da assinatura no header, com AUTENTIQUE_WEBHOOK_SECRET (configurado no .env e no
 * painel de desenvolvedor do Autentique, no cadastro do webhook).
 *
 * Formato do payload: a documentação atual do Autentique descreve um envelope JSON
 * ({ event: { type, data: { object } } }), mas versões antigas da doc mencionavam
 * x-www-form-urlencoded — por segurança, tenta os dois formatos antes de desistir. Loga o payload
 * cru em caso de dúvida, pra ajustar isso com dado real assim que o primeiro webhook chegar.
 */
export async function webhookRoutes(app: FastifyInstance) {
  // Isolado num sub-plugin (encapsulamento próprio do Fastify) porque addContentTypeParser vale
  // pra TODAS as rotas registradas no mesmo escopo — sem isso, o parser de corpo cru abaixo também
  // capturava o body de qualquer outra rota deste arquivo (ex.: meta-leads, mais abaixo), quebrando
  // o parsing de JSON normal delas.
  await app.register(async (autentique) => {
    // Content-type parsers registrados só dentro deste sub-plugin: capturam o corpo CRU (Buffer),
    // porque a validação HMAC precisa dos bytes exatos recebidos, não de uma reserialização do
    // JSON já parseado.
    const captureRaw = (_req: unknown, body: Buffer, done: (err: Error | null, body?: Buffer) => void) => {
      done(null, body);
    };
    autentique.addContentTypeParser('application/json', { parseAs: 'buffer' }, captureRaw);
    autentique.addContentTypeParser('application/x-www-form-urlencoded', { parseAs: 'buffer' }, captureRaw);

    autentique.post('/api/webhooks/autentique', async (req, reply) => {
    const secret = process.env.AUTENTIQUE_WEBHOOK_SECRET;
    const raw = (req.body as Buffer | undefined) ?? Buffer.alloc(0);
    const signatureHeader =
      (req.headers['x-autentique-signature'] as string | undefined) ??
      (req.headers['X-Autentique-Signature'] as string | undefined) ??
      '';

    if (!secret) {
      app.log.error('[autentique] AUTENTIQUE_WEBHOOK_SECRET não configurado — recusando webhook');
      return reply.status(500).send({ message: 'Webhook não configurado no servidor' });
    }

    const expected = crypto.createHmac('sha256', secret).update(raw).digest('hex');
    const providedBuf = Buffer.from(signatureHeader, 'utf8');
    const expectedBuf = Buffer.from(expected, 'utf8');
    const validSignature =
      providedBuf.length === expectedBuf.length && crypto.timingSafeEqual(providedBuf, expectedBuf);

    if (!validSignature) {
      app.log.warn({ signatureHeader }, '[autentique] assinatura HMAC inválida — webhook ignorado');
      return reply.status(401).send({ message: 'Assinatura inválida' });
    }

    const bodyText = raw.toString('utf8');
    let payload: { event?: { type?: string; data?: { object?: { id?: string } } } } | null = null;
    try {
      payload = JSON.parse(bodyText);
    } catch {
      try {
        const form = new URLSearchParams(bodyText);
        const candidate = form.get('payload') ?? form.get('data') ?? form.get('json');
        if (candidate) payload = JSON.parse(candidate);
      } catch {
        payload = null;
      }
    }

    if (!payload?.event) {
      app.log.warn({ bodyPreview: bodyText.slice(0, 1000) }, '[autentique] payload não reconhecido — verificar formato');
      return reply.status(200).send({ ok: true, recognized: false });
    }

    const eventType = payload.event.type;
    const documentId = payload.event.data?.object?.id;

    app.log.info({ eventType, documentId }, '[autentique] webhook recebido');

    if (eventType !== 'document.finished' || !documentId) {
      return reply.status(200).send({ ok: true, ignored: true });
    }

    const contract = await queryOne<{ id: string; client_id: string | null }>(
      'SELECT id, client_id FROM contracts WHERE autentique_document_id = $1',
      [documentId]
    );
    if (!contract) {
      app.log.warn({ documentId }, '[autentique] nenhum contrato com esse autentique_document_id — verifique se foi colado certo na tela do contrato');
      return reply.status(200).send({ ok: true, matched: false });
    }

    await query(
      `UPDATE contracts SET status = 'assinado', signed_at = NOW(), updated_at = NOW() WHERE id = $1`,
      [contract.id]
    );

    if (contract.client_id) {
      await advanceClientToBriefing(contract.client_id);
    }

    return reply.status(200).send({ ok: true, matched: true });
    });
  });

  /**
   * Webhook de leads do Meta Ads (Facebook/Instagram Lead Ads), chamado pelo n8n no lugar do node
   * que hoje cria item no Monday: Meta Ads -> Google Sheets -> Apps Script -> n8n -> aqui -> WhatsApp.
   * Cria o lead direto no quadro de entrada do funil comercial ("Leads Novos"), com o `raw` completo
   * do formulário guardado pra auditoria.
   *
   * Autenticação: token estático em Authorization: Bearer, comparado em tempo constante (mesmo
   * espírito do webhook do Autentique acima, sem precisar de HMAC do corpo aqui porque quem chama
   * é o n8n, não o Meta diretamente).
   *
   * Idempotência: `lead_id` do Meta vira lead_rows.meta_lead_id (índice único parcial). Reenvio do
   * mesmo lead_id NUNCA cria duplicata — responde 200 com duplicate:true, porque o n8n trata
   * qualquer coisa fora da faixa 2xx como falha e tentaria de novo.
   */
  app.post<{
    Body: {
      lead_id?: string;
      nome?: string;
      telefone?: string;
      dor_cliente?: string;
      numero_atendentes?: string;
      raw?: Record<string, unknown>;
    };
  }>(
    '/api/webhooks/meta-leads',
    {
      schema: {
        body: {
          type: 'object',
          required: ['lead_id'],
          properties: {
            lead_id: { type: 'string', minLength: 1 },
            nome: { type: 'string' },
            telefone: { type: 'string' },
            dor_cliente: { type: 'string' },
            numero_atendentes: { type: 'string' },
            raw: { type: 'object' },
          },
        },
      },
    },
    async (req, reply) => {
      const token = process.env.META_LEADS_WEBHOOK_TOKEN;
      if (!token) {
        app.log.error('[meta-leads] META_LEADS_WEBHOOK_TOKEN não configurado — recusando webhook');
        return reply.status(500).send({ message: 'Webhook não configurado no servidor' });
      }

      const authHeader = (req.headers['authorization'] as string | undefined) ?? '';
      const provided = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : authHeader;
      const providedBuf = Buffer.from(provided, 'utf8');
      const expectedBuf = Buffer.from(token, 'utf8');
      const validToken =
        providedBuf.length === expectedBuf.length && crypto.timingSafeEqual(providedBuf, expectedBuf);
      if (!validToken) {
        app.log.warn('[meta-leads] token inválido — webhook recusado');
        return reply.status(401).send({ message: 'Não autorizado' });
      }

      const leadId = req.body.lead_id?.trim();
      if (!leadId) {
        return reply.status(400).send({ message: 'lead_id é obrigatório' });
      }

      app.log.info({ leadId, nome: req.body.nome }, '[meta-leads] webhook recebido');

      const existing = await queryOne<{ id: string }>(
        'SELECT id FROM lead_rows WHERE meta_lead_id = $1',
        [leadId]
      );
      if (existing) {
        app.log.info({ leadId, existingId: existing.id }, '[meta-leads] lead duplicado — ignorado');
        return reply.status(200).send({ success: true, duplicate: true, id: existing.id });
      }

      const raw = req.body.raw ?? {};
      // Campos do formulário do Meta já tratados numa coluna própria — o resto (perguntas de
      // qualificação, que mudam de nome a cada formulário novo) cai em `qualificacao` como JSON.
      const KNOWN_RAW_KEYS = new Set([
        'id', 'created_time', 'ad_id', 'ad_name', 'adset_id', 'adset_name',
        'campaign_id', 'campaign_name', 'form_id', 'form_name', 'is_organic',
        'platform', 'full_name', 'company_name', 'phone', 'lead_status',
      ]);
      const qualificacao: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(raw)) {
        if (!KNOWN_RAW_KEYS.has(key)) qualificacao[key] = value;
      }

      const empresa = typeof raw.company_name === 'string' ? raw.company_name : '';
      const campanha = typeof raw.campaign_name === 'string' ? raw.campaign_name : '';
      const conjunto = typeof raw.adset_name === 'string' ? raw.adset_name : '';
      const origemCampanha = [campanha, conjunto].filter(Boolean).join(' / ');

      // Quadro de destino: por padrão o primeiro quadro da aba "Novos Leads" (o quadro de entrada
      // do funil comercial) — dá pra apontar pra outro quadro específico via META_LEADS_BOARD_ID,
      // sem precisar mexer em código se um dia isso mudar.
      const boardIdEnv = process.env.META_LEADS_BOARD_ID;
      const board = boardIdEnv
        ? await queryOne<{ id: string }>('SELECT id FROM lead_boards WHERE id = $1', [boardIdEnv])
        : await queryOne<{ id: string }>(
            `SELECT id FROM lead_boards WHERE page = 'novos_leads' ORDER BY position ASC LIMIT 1`
          );
      if (!board) {
        app.log.error('[meta-leads] nenhum quadro de destino encontrado — lead não criado');
        return reply.status(500).send({ message: 'Quadro de destino não configurado' });
      }

      const [{ max }] = await query<{ max: number | null }>(
        'SELECT MAX(position) as max FROM lead_rows WHERE board_id = $1',
        [board.id]
      );

      // ON CONFLICT cobre a corrida entre dois webhooks do mesmo lead_id chegando quase juntos
      // (o SELECT acima já resolve o caso comum, mas não é atômico sozinho).
      const [leadRow] = await query<{ id: string }>(
        `INSERT INTO lead_rows (
          board_id, nome, empresa, telefone, position,
          meta_lead_id, origem_campanha, qualificacao, lead_raw,
          dor_cliente, numero_atendentes
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
        ON CONFLICT (meta_lead_id) WHERE meta_lead_id IS NOT NULL DO NOTHING
        RETURNING *`,
        [
          board.id, req.body.nome ?? '', empresa, req.body.telefone ?? '', (max ?? -1) + 1,
          leadId, origemCampanha, JSON.stringify(qualificacao), JSON.stringify(raw),
          req.body.dor_cliente ?? '', req.body.numero_atendentes ?? '',
        ]
      );

      if (!leadRow) {
        const race = await queryOne<{ id: string }>('SELECT id FROM lead_rows WHERE meta_lead_id = $1', [leadId]);
        if (race) return reply.status(200).send({ success: true, duplicate: true, id: race.id });
        app.log.error({ leadId }, '[meta-leads] insert não retornou linha e não achou duplicata — falha inesperada');
        return reply.status(500).send({ message: 'Falha ao criar lead' });
      }

      await query(
        `INSERT INTO lead_events (lead_row_id, type, from_value, to_value, actor_name) VALUES ($1,$2,$3,$4,$5)`,
        [leadRow.id, 'created', null, null, 'Meta Ads (n8n)']
      );

      // Push notification (PWA) pra quem tem acesso ao quadro — em background, não atrasa nem
      // derruba a resposta pro n8n se o envio falhar (assinatura vencida, VAPID não configurado
      // ainda, etc). Recipiente é decidido igual ao GET /api/lead-rows: mesma restrictedBoardFilter.
      void (async () => {
        const profiles = await query<{ id: string; role: string }>('SELECT id, role FROM profiles');
        const recipientIds: string[] = [];
        for (const p of profiles) {
          const allowed = await restrictedBoardFilter(p.id, p.role);
          if (allowed === null || allowed.includes(board.id)) recipientIds.push(p.id);
        }
        const subtitle = [empresa, origemCampanha].filter(Boolean).join(' — ');
        await sendPushToUsers(recipientIds, {
          title: `Novo lead: ${req.body.nome || 'sem nome'}`,
          body: subtitle || 'Lead novo do Meta Ads',
          url: '/comercial/novos_leads',
          tag: `lead-${leadRow.id}`,
        });
      })().catch((err) => app.log.error({ err, leadId }, '[meta-leads] falha ao enviar push'));

      app.log.info({ leadId, id: leadRow.id }, '[meta-leads] lead criado');
      return reply.status(201).send({ success: true, id: leadRow.id });
    }
  );
}
