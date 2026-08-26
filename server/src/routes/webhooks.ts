import { FastifyInstance } from 'fastify';
import crypto from 'crypto';
import { query, queryOne } from '../db.js';

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
  // Content-type parsers registrados só dentro deste plugin (não afeta o resto do app): capturam
  // o corpo CRU (Buffer), porque a validação HMAC precisa dos bytes exatos recebidos, não de uma
  // reserialização do JSON já parseado.
  const captureRaw = (_req: unknown, body: Buffer, done: (err: Error | null, body?: Buffer) => void) => {
    done(null, body);
  };
  app.addContentTypeParser('application/json', { parseAs: 'buffer' }, captureRaw);
  app.addContentTypeParser('application/x-www-form-urlencoded', { parseAs: 'buffer' }, captureRaw);

  app.post('/api/webhooks/autentique', async (req, reply) => {
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
      const client = await queryOne<{ stage: string }>('SELECT stage FROM clients WHERE id = $1', [contract.client_id]);
      if (client?.stage === 'contract') {
        await query(`UPDATE clients SET stage = 'briefing', contract_signed_at = NOW() WHERE id = $1`, [contract.client_id]);
      }
    }

    return reply.status(200).send({ ok: true, matched: true });
  });
}
