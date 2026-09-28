import { FastifyInstance, FastifyBaseLogger } from 'fastify';
import { query, queryOne } from '../db.js';
import { getChannelsCached } from './channels.js';

/**
 * Painel "Risco de Churn": cruza os sinais que já existem espalhados pelo sistema — pulso de
 * satisfação (client_pulses), pagamento em atraso (Asaas OU Recorrai — ver detalhe abaixo), canais
 * desconectados (NX Monitor, mesma reconciliação da tela Canais, mas lida do cache de
 * `channelAlerts.ts` — ver getChannelsCached), tickets reabertos/com SLA estourado, e um sinal
 * MANUAL (client_churn_flags — alguém do time marcou "isso aqui é risco", sem sinal automático
 * nenhum obrigar) — pra todo cliente ativo. Nada aqui decide nada sozinho; é só leitura + o registro
 * manual pro time priorizar quem ligar.
 *
 * Canais usa o CACHE, não `reconcileChannels()` direto: essa reconciliação é uma rodada de chamadas
 * ao vivo pra NX + provedores por tenant (por isso a tela Canais demora) — chamar de novo aqui
 * deixava o painel inteiro tão lento quanto abrir a tela Canais do zero. `channelAlerts.ts` já
 * reconcilia tudo a cada 3 min em background; o cache só cai pra uma chamada ao vivo se ainda não
 * tiver nada (logo depois do boot) ou aquele job estiver desligado.
 *
 * Pagamento tem DUAS fontes, nunca as duas ao mesmo tempo pro mesmo cliente: quem é cobrado via
 * Asaas usa clients.payment_status; quem não é (server/src/jobs/recorraiSync.ts só mexe nesse
 * grupo) usa o campo espelho clients.recorrai_payment_status. O sinal "pagamento em atraso" acende
 * se QUALQUER UM dos dois disser 'overdue'.
 *
 * Severidade: se tem flag manual, vale a severidade que a pessoa escolheu (a não ser que os sinais
 * automáticos sozinhos já dessem uma severidade maior — nesse caso vale a maior das duas). Sem flag
 * manual, a severidade é só a contagem de sinais automáticos acesos: 1 = atenção, 2 = alto, 3+ =
 * crítico.
 */

export type ChurnSeverity = 'atencao' | 'alto' | 'critico';
const SEVERITY_RANK: Record<ChurnSeverity, number> = { atencao: 1, alto: 2, critico: 3 };

function severityFromSignalCount(n: number): ChurnSeverity | null {
  if (n >= 3) return 'critico';
  if (n === 2) return 'alto';
  if (n === 1) return 'atencao';
  return null;
}

interface ClientRow {
  id: string;
  name: string;
  company: string | null;
  stage: string;
  phone: string | null;
  payment_status: string | null;
  asaas_customer_id: string | null;
  recorrai_payment_status: string | null;
  recorrai_customer_id: string | null;
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

interface FlagRow {
  id: string;
  client_id: string;
  severity: ChurnSeverity;
  reason: string;
  created_by: string | null;
  created_at: string;
}

export interface ChurnRiskItem {
  client_id: string;
  name: string;
  company: string | null;
  stage: string;
  responsavel: string | null;
  responsavelEntrega: string | null;
  hasSignal: boolean;
  /** Só o sinal de canal aceso (nenhum outro) — a tela agrupa isso numa seção minimizada à parte,
   *  porque canal caído sozinho é o sinal mais barulhento e menos decisivo dos quatro. */
  onlySignalIsChannels: boolean;
  severity: ChurnSeverity | null;
  signals: { pulse: boolean; payment: boolean; channels: boolean; tickets: boolean; manual: boolean };
  details: {
    pulseStatus: string | null;
    pulseResponse: string | null;
    pulseSentAt: string | null;
    paymentStatus: string | null;
    paymentSource: 'asaas' | 'recorrai' | null;
    channelsDisconnected: number;
    channelsTotal: number;
    ticketsReopened: number;
    ticketsOverdue: number;
    manualFlag: { id: string; severity: ChurnSeverity; reason: string; createdBy: string | null; createdAt: string } | null;
  };
}

/** Monta a lista inteira (todo cliente ativo, com ou sem sinal) — usada pela rota de lista e pela
 *  de relatório, pra não calcular os mesmos sinais duas vezes de dois jeitos diferentes. */
async function computeChurnRisk(log: FastifyBaseLogger): Promise<ChurnRiskItem[]> {
  const clients = await query<ClientRow>(
    `SELECT id, name, company, stage, phone, payment_status, asaas_customer_id,
            recorrai_payment_status, recorrai_customer_id,
            responsavel, responsavel_entrega
     FROM clients
     WHERE stage <> 'churned' AND archived_at IS NULL`,
  );
  if (clients.length === 0) return [];
  const clientIds = clients.map((c) => c.id);

  const pulseRows = await query<PulseRow>(
    `SELECT DISTINCT ON (client_id) client_id, status, response, sent_at
     FROM client_pulses
     WHERE client_id = ANY($1)
     ORDER BY client_id, sent_at DESC`,
    [clientIds],
  );
  const pulseByClient = new Map(pulseRows.map((p) => [p.client_id, p]));

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

  const channelsByClient = new Map<string, { total: number; disconnected: number }>();
  try {
    const { channels } = await getChannelsCached();
    for (const ch of channels) {
      if (!ch.client_id) continue;
      const cur = channelsByClient.get(ch.client_id) ?? { total: 0, disconnected: 0 };
      cur.total++;
      if (ch.effective_status === 'disconnected') cur.disconnected++;
      channelsByClient.set(ch.client_id, cur);
    }
  } catch (err) {
    log.warn({ err }, '[churn-risk] falha ao reconciliar canais — sinal de canal ficou de fora');
  }

  // Flag manual ativa (resolved_at IS NULL) mais recente por cliente.
  const flagRows = await query<FlagRow>(
    `SELECT DISTINCT ON (client_id) id, client_id, severity, reason, created_by, created_at
     FROM client_churn_flags
     WHERE client_id = ANY($1) AND resolved_at IS NULL
     ORDER BY client_id, created_at DESC`,
    [clientIds],
  );
  const flagByClient = new Map(flagRows.map((f) => [f.client_id, f]));

  const out: ChurnRiskItem[] = [];
  for (const c of clients) {
    const pulse = pulseByClient.get(c.id);
    const pulseSignal = Boolean(
      pulse && (pulse.status === 'sem_resposta' || (pulse.status === 'respondido' && pulse.response === 'nao')),
    );
    const asaasOverdue = Boolean(c.asaas_customer_id && c.payment_status === 'overdue');
    const recorraiOverdue = Boolean(c.recorrai_customer_id && c.recorrai_payment_status === 'overdue');
    const paymentSignal = asaasOverdue || recorraiOverdue;
    const ch = channelsByClient.get(c.id);
    const channelsSignal = Boolean(ch && ch.total > 0 && ch.disconnected === ch.total);
    const tk = ticketSignalByClient.get(c.id);
    const ticketsSignal = Boolean(tk && (tk.reopened > 0 || tk.overdue > 0));
    const flag = flagByClient.get(c.id);
    const manualSignal = Boolean(flag);

    const autoCount = [pulseSignal, paymentSignal, channelsSignal, ticketsSignal].filter(Boolean).length;
    const autoSeverity = severityFromSignalCount(autoCount);
    const severity: ChurnSeverity | null = flag
      ? autoSeverity && SEVERITY_RANK[autoSeverity] > SEVERITY_RANK[flag.severity] ? autoSeverity : flag.severity
      : autoSeverity;

    const hasSignal = pulseSignal || paymentSignal || channelsSignal || ticketsSignal || manualSignal;
    const onlySignalIsChannels = channelsSignal && !pulseSignal && !paymentSignal && !ticketsSignal && !manualSignal;

    out.push({
      client_id: c.id,
      name: c.name,
      company: c.company,
      stage: c.stage,
      responsavel: c.responsavel,
      responsavelEntrega: c.responsavel_entrega,
      hasSignal,
      onlySignalIsChannels,
      severity,
      signals: { pulse: pulseSignal, payment: paymentSignal, channels: channelsSignal, tickets: ticketsSignal, manual: manualSignal },
      details: {
        pulseStatus: pulse?.status ?? null,
        pulseResponse: pulse?.response ?? null,
        pulseSentAt: pulse?.sent_at ?? null,
        paymentStatus: asaasOverdue ? c.payment_status : recorraiOverdue ? c.recorrai_payment_status : (c.payment_status ?? c.recorrai_payment_status),
        paymentSource: asaasOverdue ? 'asaas' : recorraiOverdue ? 'recorrai' : c.asaas_customer_id ? 'asaas' : c.recorrai_customer_id ? 'recorrai' : null,
        channelsDisconnected: ch?.disconnected ?? 0,
        channelsTotal: ch?.total ?? 0,
        ticketsReopened: tk?.reopened ?? 0,
        ticketsOverdue: tk?.overdue ?? 0,
        manualFlag: flag ? { id: flag.id, severity: flag.severity, reason: flag.reason, createdBy: flag.created_by, createdAt: flag.created_at } : null,
      },
    });
  }

  // Mais grave primeiro (crítico > alto > atenção > sem sinal), depois mais sinais acesos.
  out.sort((a, b) => {
    const sa = a.severity ? SEVERITY_RANK[a.severity] : 0;
    const sb = b.severity ? SEVERITY_RANK[b.severity] : 0;
    if (sb !== sa) return sb - sa;
    const na = Object.values(a.signals).filter(Boolean).length;
    const nb = Object.values(b.signals).filter(Boolean).length;
    return nb - na;
  });
  return out;
}

export async function churnRiskRoutes(app: FastifyInstance) {
  // GET /api/churn-risk — todo cliente ativo, com ou sem sinal (front decide o que mostrar por
  // padrão). Sempre a lista inteira pra "ver todos" e os relatórios usarem o mesmo cálculo.
  app.get('/api/churn-risk', { onRequest: [app.authenticate] }, async (req) => {
    return computeChurnRisk(req.log);
  });

  // GET /api/churn-risk/report — agregados pra tela de relatórios/gráficos: contagem por sinal,
  // por severidade, e o histórico de flags manuais (única coisa aqui que tem série temporal de
  // verdade — os outros sinais são estado atual, sem snapshot histórico).
  app.get('/api/churn-risk/report', { onRequest: [app.authenticate] }, async (req) => {
    const items = await computeChurnRisk(req.log);
    const withSignal = items.filter((i) => i.hasSignal);

    const bySignal = { pulse: 0, payment: 0, channels: 0, tickets: 0, manual: 0 };
    const bySeverity: Record<ChurnSeverity, number> = { atencao: 0, alto: 0, critico: 0 };
    for (const i of withSignal) {
      if (i.signals.pulse) bySignal.pulse++;
      if (i.signals.payment) bySignal.payment++;
      if (i.signals.channels) bySignal.channels++;
      if (i.signals.tickets) bySignal.tickets++;
      if (i.signals.manual) bySignal.manual++;
      if (i.severity) bySeverity[i.severity]++;
    }

    // Histórico de flags manuais: quantas novas por mês, últimos 6 meses.
    const historyRows = await query<{ mes: string; novos: string }>(
      `SELECT to_char(date_trunc('month', created_at), 'YYYY-MM') AS mes, count(*)::text AS novos
       FROM client_churn_flags
       WHERE created_at >= date_trunc('month', NOW()) - interval '5 months'
       GROUP BY 1 ORDER BY 1`,
    );
    const manualHistory = historyRows.map((r) => ({ mes: r.mes, novos: parseInt(r.novos, 10) }));
    const [{ ativos: manualAtivos }] = await query<{ ativos: string }>(
      `SELECT count(*)::text AS ativos FROM client_churn_flags WHERE resolved_at IS NULL`,
    );
    const [{ resolvidos: manualResolvidos }] = await query<{ resolvidos: string }>(
      `SELECT count(*)::text AS resolvidos FROM client_churn_flags WHERE resolved_at IS NOT NULL`,
    );

    return {
      totalAtivos: items.length,
      totalComSinal: withSignal.length,
      bySignal,
      bySeverity,
      manualHistory,
      manualAtivos: parseInt(manualAtivos, 10),
      manualResolvidos: parseInt(manualResolvidos, 10),
    };
  });

  // POST /api/churn-risk/:clientId/flag — registra manualmente que esse cliente está em risco.
  // Resolve qualquer flag ativa anterior antes (só uma ativa por cliente de cada vez).
  app.post<{ Params: { clientId: string }; Body: { severity?: ChurnSeverity; reason?: string; createdBy?: string } }>(
    '/api/churn-risk/:clientId/flag',
    { onRequest: [app.authenticate] },
    async (req, reply) => {
      const { clientId } = req.params;
      const severity: ChurnSeverity =
        req.body?.severity && ['atencao', 'alto', 'critico'].includes(req.body.severity) ? req.body.severity : 'atencao';
      const reason = (req.body?.reason ?? '').trim();
      const createdBy = (req.body?.createdBy ?? '').trim() || null;

      const client = await queryOne<{ id: string }>('SELECT id FROM clients WHERE id = $1', [clientId]);
      if (!client) return reply.status(404).send({ message: 'Cliente não encontrado' });

      await query(
        `UPDATE client_churn_flags SET resolved_at = NOW() WHERE client_id = $1 AND resolved_at IS NULL`,
        [clientId],
      );
      const created = await queryOne(
        `INSERT INTO client_churn_flags (client_id, severity, reason, created_by)
         VALUES ($1, $2, $3, $4) RETURNING *`,
        [clientId, severity, reason, createdBy],
      );
      return reply.status(201).send(created);
    },
  );

  // POST /api/churn-risk/:clientId/resolve — encerra a flag manual ativa (o cliente sai do "manual"
  // — se ainda tiver sinal automático aceso, continua aparecendo por causa deles).
  app.post<{ Params: { clientId: string } }>(
    '/api/churn-risk/:clientId/resolve',
    { onRequest: [app.authenticate] },
    async (req, reply) => {
      const updated = await query(
        `UPDATE client_churn_flags SET resolved_at = NOW()
         WHERE client_id = $1 AND resolved_at IS NULL RETURNING id`,
        [req.params.clientId],
      );
      if (updated.length === 0) return reply.status(404).send({ message: 'Nenhuma flag manual ativa pra esse cliente' });
      return { ok: true };
    },
  );
}
