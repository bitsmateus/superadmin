import { FastifyInstance } from 'fastify';
import { query } from '../db.js';
import { reconcileChannels } from './channels.js';

/**
 * Painel "Risco de Churn": cruza os sinais que já existem espalhados pelo sistema — pulso de
 * satisfação (client_pulses), pagamento em atraso (Asaas, clients.payment_status), canais
 * desconectados (NX Monitor, reconcileChannels — mesma reconciliação da tela Canais) e tickets
 * reabertos/com SLA estourado — e devolve só os clientes ativos com pelo menos um sinal aceso.
 * Nada aqui decide nada sozinho; é só leitura pro time priorizar quem ligar.
 */

interface ClientRow {
  id: string;
  name: string;
  company: string | null;
  stage: string;
  phone: string | null;
  payment_status: string | null;
  asaas_customer_id: string | null;
  responsavel: string | null;
  responsavel_entrega: string | null;
}

interface PulseRow {
  client_id: string;
  status: string;
  response: string | null;
  sent_at: string;
}

interface TicketRow {
  client_id: string | null;
  status: string;
  resolved_at: string | null;
  sla_due_at: string | null;
}

export async function churnRiskRoutes(app: FastifyInstance) {
  app.get('/api/churn-risk', { onRequest: [app.authenticate] }, async (req) => {
    const clients = await query<ClientRow>(
      `SELECT id, name, company, stage, phone, payment_status, asaas_customer_id,
              responsavel, responsavel_entrega
       FROM clients
       WHERE stage <> 'churned' AND archived_at IS NULL`,
    );
    if (clients.length === 0) return [];
    const clientIds = clients.map((c) => c.id);

    // Pulso mais recente de cada cliente.
    const pulseRows = await query<PulseRow>(
      `SELECT DISTINCT ON (client_id) client_id, status, response, sent_at
       FROM client_pulses
       WHERE client_id = ANY($1)
       ORDER BY client_id, sent_at DESC`,
      [clientIds],
    );
    const pulseByClient = new Map(pulseRows.map((p) => [p.client_id, p]));

    // Tickets ainda abertos: reaberto (já teve resolved_at e voltou a ficar aberto) ou SLA vencido.
    const ticketRows = await query<TicketRow>(
      `SELECT client_id, status, resolved_at, sla_due_at
       FROM tickets
       WHERE client_id = ANY($1) AND status NOT IN ('resolved', 'closed')`,
      [clientIds],
    );
    const nowMs = Date.now();
    const ticketSignalByClient = new Map<string, { reopened: number; overdue: number }>();
    for (const t of ticketRows) {
      if (!t.client_id) continue;
      const cur = ticketSignalByClient.get(t.client_id) ?? { reopened: 0, overdue: 0 };
      if (t.resolved_at) cur.reopened++;
      if (t.sla_due_at && new Date(t.sla_due_at).getTime() < nowMs) cur.overdue++;
      ticketSignalByClient.set(t.client_id, cur);
    }

    // Canais: reconciliação ao vivo (mesma lógica da tela Canais). Resiliente — sem NX Monitor
    // configurado, ou se a reconciliação falhar, esse sinal só fica de fora dos demais.
    const channelsByClient = new Map<string, { total: number; disconnected: number }>();
    try {
      const { channels } = await reconcileChannels();
      for (const ch of channels) {
        if (!ch.client_id) continue;
        const cur = channelsByClient.get(ch.client_id) ?? { total: 0, disconnected: 0 };
        cur.total++;
        if (ch.effective_status === 'disconnected') cur.disconnected++;
        channelsByClient.set(ch.client_id, cur);
      }
    } catch (err) {
      req.log.warn({ err }, '[churn-risk] falha ao reconciliar canais — sinal de canal ficou de fora');
    }

    const out: Array<{
      client_id: string;
      name: string;
      company: string | null;
      stage: string;
      responsavel: string | null;
      responsavelEntrega: string | null;
      signals: { pulse: boolean; payment: boolean; channels: boolean; tickets: boolean };
      details: {
        pulseStatus: string | null;
        pulseResponse: string | null;
        pulseSentAt: string | null;
        paymentStatus: string | null;
        channelsDisconnected: number;
        channelsTotal: number;
        ticketsReopened: number;
        ticketsOverdue: number;
      };
    }> = [];

    for (const c of clients) {
      const pulse = pulseByClient.get(c.id);
      const pulseSignal = Boolean(
        pulse && (pulse.status === 'sem_resposta' || (pulse.status === 'respondido' && pulse.response === 'nao')),
      );
      const paymentSignal = Boolean(c.asaas_customer_id && c.payment_status === 'overdue');
      const ch = channelsByClient.get(c.id);
      const channelsSignal = Boolean(ch && ch.total > 0 && ch.disconnected === ch.total);
      const tk = ticketSignalByClient.get(c.id);
      const ticketsSignal = Boolean(tk && (tk.reopened > 0 || tk.overdue > 0));

      if (!pulseSignal && !paymentSignal && !channelsSignal && !ticketsSignal) continue;

      out.push({
        client_id: c.id,
        name: c.name,
        company: c.company,
        stage: c.stage,
        responsavel: c.responsavel,
        responsavelEntrega: c.responsavel_entrega,
        signals: { pulse: pulseSignal, payment: paymentSignal, channels: channelsSignal, tickets: ticketsSignal },
        details: {
          pulseStatus: pulse?.status ?? null,
          pulseResponse: pulse?.response ?? null,
          pulseSentAt: pulse?.sent_at ?? null,
          paymentStatus: c.payment_status,
          channelsDisconnected: ch?.disconnected ?? 0,
          channelsTotal: ch?.total ?? 0,
          ticketsReopened: tk?.reopened ?? 0,
          ticketsOverdue: tk?.overdue ?? 0,
        },
      });
    }

    // Mais sinais acesos primeiro — quem acumula mais problemas é quem mais precisa de atenção.
    out.sort((a, b) => {
      const na = Object.values(a.signals).filter(Boolean).length;
      const nb = Object.values(b.signals).filter(Boolean).length;
      return nb - na;
    });
    return out;
  });
}
