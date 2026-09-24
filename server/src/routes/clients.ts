import { FastifyInstance } from 'fastify';
import { v4 as uuidv4 } from 'uuid';
import { query, queryOne } from '../db.js';
import { findMatchingLeadRowId, MIN_LEN, normalizeName, phoneKey } from '../lib/leadMatch.js';
import { sendMail } from '../lib/mailer.js';
import { renderFullHtmlToPdf } from '../lib/htmlPdf.js';

const FINANCE_COLS = [
  'contract_url','contract_sent_at','contract_signed_at',
  'asaas_customer_id','asaas_payment_id','asaas_subscription_id',
  'implementation_value','monthly_value','due_day',
  'payment_status','last_payment_check','payments','extra_links','finance_notes',
];

/** "R$ 1.797,00" -> 179700. O valor da venda é texto livre digitado na planilha do Comercial, não
 * número — vale o que estiver escrito, e vazio/bagunçado vira 0 em vez de quebrar a conta. */
function centavosDeTexto(raw: string | null | undefined): number {
  const limpo = (raw ?? '').replace(/[^\d,.-]/g, '').replace(/\./g, '').replace(',', '.');
  const n = Number(limpo);
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) : 0;
}

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

  // GET /api/clients/valores-sugeridos — quanto cada cliente paga, segundo a VENDA dele.
  //
  // Mensalidade e implementação só existem, hoje, na linha da aba Vendas (o cadastro do cliente
  // nasceu no Suporte, onde ninguém preenche valor). A tela "Clientes Geral" usa isso pra sugerir o
  // valor de quem está com o campo vazio, em vez de obrigar a digitar cliente por cliente.
  //
  // Mesma escada de ligação da ficha (ver ficha-status-lote): vínculo confirmado no contrato
  // primeiro, telefone depois, nome por último — e sempre exigindo UM único candidato, pra nunca
  // sugerir o valor da venda de outra pessoa.
  app.get('/api/clients/valores-sugeridos', { onRequest: [app.authenticate] }, async () => {
    const vendas = await query<{
      id: string; nome: string; empresa: string; telefone: string; valor_mrr: string; valor_implementacao: string;
    }>(
      `SELECT r.id, r.nome, r.empresa, r.telefone, r.valor_mrr, r.valor_implementacao
       FROM lead_rows r JOIN lead_boards lb ON lb.id = r.board_id
       WHERE lb.is_vendas AND r.deleted_at IS NULL AND r.venda_revertida IS NOT TRUE`
    );
    if (!vendas.length) return {};

    const clientes = await query<{ id: string; name: string; company: string; phone: string }>(
      `SELECT id, name, company, phone FROM clients WHERE archived_at IS NULL`
    );
    const contratos = await query<{ venda_lead_id: string; client_id: string }>(
      `SELECT venda_lead_id, client_id FROM contracts
       WHERE venda_lead_id IS NOT NULL AND client_id IS NOT NULL ORDER BY created_at`
    );

    const vendaPorId = new Map(vendas.map((v) => [v.id, v]));
    const vendaPorCliente = new Map<string, typeof vendas[number]>();
    for (const ct of contratos) {
      const venda = vendaPorId.get(ct.venda_lead_id);
      if (venda) vendaPorCliente.set(ct.client_id, venda);
    }
    const porTelefone = new Map<string, typeof vendas[number][]>();
    for (const v of vendas) {
      const k = phoneKey(v.telefone);
      if (!k) continue;
      porTelefone.set(k, [...(porTelefone.get(k) ?? []), v]);
    }

    const resultado: Record<string, { mrrCents: number; implCents: number; origem: string }> = {};
    for (const c of clientes) {
      let venda = vendaPorCliente.get(c.id);
      let origem = 'contrato';
      if (!venda) {
        const k = phoneKey(c.phone);
        const porTel = k ? porTelefone.get(k) ?? [] : [];
        if (porTel.length === 1) { venda = porTel[0]; origem = 'telefone'; }
      }
      if (!venda) {
        const alvo = normalizeName(c.company) || normalizeName(c.name);
        if (alvo.length >= MIN_LEN) {
          const achados = vendas.filter((v) => {
            const n = normalizeName(v.empresa) || normalizeName(v.nome);
            return n.length >= MIN_LEN && (n.includes(alvo) || alvo.includes(n));
          });
          if (achados.length === 1) { venda = achados[0]; origem = 'nome'; }
        }
      }
      if (!venda) continue;
      const mrrCents = centavosDeTexto(venda.valor_mrr);
      const implCents = centavosDeTexto(venda.valor_implementacao);
      if (!mrrCents && !implCents) continue;
      resultado[c.id] = { mrrCents, implCents, origem };
    }
    return resultado;
  });

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
