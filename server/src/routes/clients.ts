import { FastifyInstance } from 'fastify';
import { v4 as uuidv4 } from 'uuid';
import { query, queryOne } from '../db.js';
import { findMatchingLeadRowId } from '../lib/leadMatch.js';
import { sendMail } from '../lib/mailer.js';
import { renderFullHtmlToPdf } from '../lib/htmlPdf.js';

const FINANCE_COLS = [
  'contract_url','contract_sent_at','contract_signed_at',
  'asaas_customer_id','asaas_payment_id','asaas_subscription_id',
  'implementation_value','monthly_value','due_day',
  'payment_status','last_payment_check','payments','extra_links','finance_notes',
];

export async function clientRoutes(app: FastifyInstance) {
  // GET /api/clients — lista. Por padrão remove contract_file (base64 pesado)
  // pra aliviar o payload do boot; ?full=1 traz tudo (usado pelo backup).
  app.get<{ Querystring: { full?: string } }>(
    '/api/clients',
    { onRequest: [app.authenticate] },
    async (req) => {
      const rows = await query('SELECT * FROM clients ORDER BY created_at DESC');
      if (req.query.full) return rows;
      for (const r of rows as Record<string, unknown>[]) delete r.contract_file;
      return rows;
    }
  );

  // GET /api/clients/:id
  app.get<{ Params: { id: string } }>(
    '/api/clients/:id',
    { onRequest: [app.authenticate] },
    async (req, reply) => {
      const row = await queryOne('SELECT * FROM clients WHERE id = $1', [req.params.id]);
      if (!row) return reply.status(404).send({ message: 'Cliente não encontrado' });
      return row;
    }
  );

  // GET /api/clients/:id/contract — resumo do contrato desse cliente (id + venda_lead_id já
  // confirmado), SEM checar restrictedBoardFilter de propósito: GET /api/contracts filtra por
  // quadro, então voltava sempre vazio pro Suporte (aba Pipeline > "Lead do CRM", ver CrmLeadTab) —
  // mesmo com o contrato já existindo e assinado, a aba dizia "cliente ainda não tem contrato".
  app.get<{ Params: { id: string } }>(
    '/api/clients/:id/contract',
    { onRequest: [app.authenticate] },
    async (req, reply) => {
      const client = await queryOne<{ id: string }>('SELECT id FROM clients WHERE id = $1', [req.params.id]);
      if (!client) return reply.status(404).send({ message: 'Cliente não encontrado' });
      const contract = await queryOne<{ id: string; venda_lead_id: string | null }>(
        'SELECT id, venda_lead_id FROM contracts WHERE client_id = $1 ORDER BY created_at DESC LIMIT 1',
        [req.params.id]
      );
      return { contractId: contract?.id ?? null, vendaLeadId: contract?.venda_lead_id ?? null };
    }
  );

  // GET /api/clients/:id/crm-lead — sugere qual lead_row (card do CRM) provavelmente é o mesmo
  // prospect (não existe vínculo direto entre clients e lead_rows — são cadastros separados; ver
  // findMatchingLeadRowId, lib/leadMatch.ts, pra heurística telefone→nome/empresa e a garantia de
  // só sugerir em caso de match INEQUÍVOCO). Só uma SUGESTÃO — a aba Contrato deixa a pessoa
  // confirmar/trocar esse vínculo à mão (contracts.venda_lead_id), pra contrato avulso (sem lead
  // nenhuma no funil) ou quando a heurística erra.
  app.get<{ Params: { id: string } }>(
    '/api/clients/:id/crm-lead',
    { onRequest: [app.authenticate] },
    async (req, reply) => {
      const client = await queryOne<{ phone: string | null; name: string | null; company: string | null }>(
        'SELECT phone, name, company FROM clients WHERE id = $1',
        [req.params.id]
      );
      if (!client) return reply.status(404).send({ message: 'Cliente não encontrado' });

      const leadId = await findMatchingLeadRowId(client.phone, client.name, client.company);
      return { leadId };
    }
  );

  // POST /api/clients/:id/access-pdf — gera o PDF de acessos de verdade (Chromium headless), sem
  // passar pelo diálogo de impressão do navegador. O front manda o HTML já pronto (renderAccessSheetHtml,
  // com a senha de cada usuário) e só usa essa rota pra transformar em PDF — mesmo padrão de
  // /api/contracts/:id/pdf (ver server/src/lib/contractPdf.ts).
  app.post<{ Params: { id: string }; Body: { html?: string } }>(
    '/api/clients/:id/access-pdf',
    { onRequest: [app.authenticate] },
    async (req, reply) => {
      const client = await queryOne<{ id: string }>('SELECT id FROM clients WHERE id = $1', [req.params.id]);
      if (!client) return reply.status(404).send({ message: 'Cliente não encontrado' });

      const html = req.body?.html;
      if (!html?.trim()) return reply.status(400).send({ message: 'html é obrigatório' });

      try {
        const pdf = await renderFullHtmlToPdf(html);
        reply.header('Content-Type', 'application/pdf');
        reply.header('Content-Disposition', 'attachment; filename="acessos.pdf"');
        return reply.send(pdf);
      } catch (err) {
        return reply.status(500).send({ message: `Falha ao gerar PDF: ${(err as Error).message}` });
      }
    }
  );

  // POST /api/clients/:id/send-access-email — envio automático (SMTP) do e-mail de acessos, disparado
  // em background ao clicar "Baixar acessos" (ver DeliveryTab.tsx). O front monta a mensagem curta
  // (buildAccessDeliveryEmail) e manda o PDF já gerado (ver /access-pdf acima) como anexo em base64 —
  // assim o e-mail sempre carrega o mesmo PDF que a pessoa acabou de baixar.
  app.post<{
    Params: { id: string };
    Body: { to?: string; subject?: string; html?: string; attachmentBase64?: string; attachmentFilename?: string };
  }>(
    '/api/clients/:id/send-access-email',
    { onRequest: [app.authenticate] },
    async (req, reply) => {
      const client = await queryOne<{ id: string }>('SELECT id FROM clients WHERE id = $1', [req.params.id]);
      if (!client) return reply.status(404).send({ message: 'Cliente não encontrado' });

      const { to, subject, html, attachmentBase64, attachmentFilename } = req.body ?? {};
      if (!to?.trim() || !subject?.trim() || !html?.trim()) {
        return reply.status(400).send({ message: 'to, subject e html são obrigatórios' });
      }

      try {
        await sendMail({
          to: to.trim(),
          subject,
          html,
          attachments: attachmentBase64
            ? [{ filename: attachmentFilename || 'acessos.pdf', content: Buffer.from(attachmentBase64, 'base64') }]
            : undefined,
        });
        return { ok: true };
      } catch (err) {
        return reply.status(400).send({ message: err instanceof Error ? err.message : 'Falha ao enviar e-mail' });
      }
    }
  );

  // POST /api/clients
  app.post<{ Body: Record<string, unknown> }>(
    '/api/clients',
    { onRequest: [app.authenticate] },
    async (req, reply) => {
      const b = req.body;
      const id = (b.id as string) || uuidv4();
      const [row] = await query(
        `INSERT INTO clients (
          id, name, email, phone, company, responsavel, stage,
          tenant_id, tenant_server_id, tenant_api_id, tenant_name,
          support_email, support_password,
          contract_url, contract_sent_at, contract_signed_at,
          asaas_customer_id, asaas_payment_id, asaas_subscription_id,
          implementation_value, monthly_value, due_day, payment_status,
          last_payment_check, payments, extra_links, finance_notes,
          briefing_token, briefing_status, briefing_sent_at, briefing_data,
          briefing_approved_at, briefing_revision_note,
          delivery_checklist, delivery_handoff_checklist, delivery_date,
          delivery_notes, delivery_completed_at,
          followup_active, followups, notes, logs
        ) VALUES (
          $1,$2,$3,$4,$5,$6,$7,
          $8,$9,$10,$11,
          $12,$13,
          $14,$15,$16,
          $17,$18,$19,
          $20,$21,$22,$23,
          $24,$25,$26,$27,
          $28,$29,$30,$31,
          $32,$33,
          $34,$35,$36,
          $37,$38,
          $39,$40,$41,$42
        ) RETURNING *`,
        [
          id, b.name, b.email, b.phone, b.company, b.responsavel ?? null, b.stage ?? 'welcome',
          b.tenant_id ?? null, b.tenant_server_id ?? null, b.tenant_api_id ?? null, b.tenant_name ?? null,
          b.support_email ?? null, b.support_password ?? null,
          b.contract_url ?? null, b.contract_sent_at ?? null, b.contract_signed_at ?? null,
          b.asaas_customer_id ?? null, b.asaas_payment_id ?? null, b.asaas_subscription_id ?? null,
          b.implementation_value ?? null, b.monthly_value ?? null, b.due_day ?? null, b.payment_status ?? null,
          b.last_payment_check ?? null,
          JSON.stringify(b.payments ?? []), JSON.stringify(b.extra_links ?? []), b.finance_notes ?? null,
          b.briefing_token ?? null, b.briefing_status ?? null, b.briefing_sent_at ?? null,
          b.briefing_data ? JSON.stringify(b.briefing_data) : null,
          b.briefing_approved_at ?? null, b.briefing_revision_note ?? null,
          JSON.stringify(b.delivery_checklist ?? []),
          JSON.stringify(b.delivery_handoff_checklist ?? []),
          b.delivery_date ?? null, b.delivery_notes ?? null, b.delivery_completed_at ?? null,
          b.followup_active ?? false,
          JSON.stringify(b.followups ?? []),
          JSON.stringify(b.notes ?? []),
          JSON.stringify(b.logs ?? []),
        ]
      );
      return reply.status(201).send(row);
    }
  );

  // PATCH /api/clients/:id
  app.patch<{ Params: { id: string }; Body: Record<string, unknown> }>(
    '/api/clients/:id',
    { onRequest: [app.authenticate] },
    async (req, reply) => {
      const { role } = req.user as { role: string };
      const patch = req.body;

      // Guard: suporte cannot touch finance/contract fields
      if (role === 'suporte') {
        const restricted = FINANCE_COLS.filter((col) => col in patch);
        if (restricted.length > 0) {
          return reply.status(403).send({
            message: `Role "suporte" não pode alterar: ${restricted.join(', ')}`,
          });
        }
      }

      const sets: string[] = [];
      const params: unknown[] = [];
      let i = 1;

      for (const [key, val] of Object.entries(patch)) {
        sets.push(`${key} = $${i++}`);
        // Stringify JSON fields
        if (val !== null && typeof val === 'object') {
          params.push(JSON.stringify(val));
        } else {
          params.push(val);
        }
      }

      if (!sets.length) return reply.status(400).send({ message: 'Nada para atualizar' });

      params.push(req.params.id);
      const [updated] = await query(
        `UPDATE clients SET ${sets.join(', ')} WHERE id = $${i} RETURNING *`,
        params
      );
      if (!updated) return reply.status(404).send({ message: 'Cliente não encontrado' });

      return updated;
    }
  );

  // DELETE /api/clients/:id — admin only
  app.delete<{ Params: { id: string } }>(
    '/api/clients/:id',
    { onRequest: [app.authenticate] },
    async (req, reply) => {
      const { role } = req.user as { role: string };
      if (role !== 'admin') return reply.status(403).send({ message: 'Acesso negado' });
      await query('DELETE FROM clients WHERE id = $1', [req.params.id]);
      return reply.status(204).send();
    }
  );
}
