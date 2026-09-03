import { query } from '../db.js';
import { resolveNxCredentials } from '../lib/wabaAccess.js';
import { sendNxTemplate } from '../lib/nxTemplateSend.js';

/**
 * Motor de disparo em massa (portal "Laundry" e futuros clientes, ver routes/massCampaigns.ts) —
 * de propósito simples: sem fila externa, sem worker separado. A cada rodada, varre destinatários
 * "queued" de campanhas "running" cujo scheduled_for já venceu, manda um por um (o espaçamento já
 * foi gravado em scheduled_for na hora de iniciar a campanha) e marca o resultado. Sobrevive a
 * reinício do servidor sem perder nem duplicar envio: o estado inteiro mora no banco, nunca em
 * memória — se o processo cair no meio, a próxima rodada simplesmente continua de onde parou.
 */
const INTERVAL_MS = 15_000; // 15s
const BATCH_SIZE = 20;

interface DueRecipient {
  id: string;
  client_id: string;
  phone: string;
  template_name: string;
  template_language: string;
  template_params: string[];
}

export function startMassCampaignDispatch() {
  if (process.env.MASS_CAMPAIGN_DISPATCH === 'off') {
    console.log('[massCampaignDispatch] desativado (MASS_CAMPAIGN_DISPATCH=off)');
    return;
  }
  const tick = () => {
    runOnce().catch((err) => console.error('[massCampaignDispatch] erro:', err));
  };
  setTimeout(tick, 10_000);
  setInterval(tick, INTERVAL_MS);
  console.log('[massCampaignDispatch] job iniciado (a cada 15s)');
}

async function runOnce() {
  const due = await query<DueRecipient>(
    `SELECT r.id, c.client_id, r.phone, c.template_name, c.template_language, r.template_params
     FROM mass_campaign_recipients r
     JOIN mass_campaigns c ON c.id = r.campaign_id
     WHERE r.status = 'queued' AND c.status = 'running'
       AND (r.scheduled_for IS NULL OR r.scheduled_for <= NOW())
     ORDER BY r.scheduled_for ASC NULLS FIRST
     LIMIT $1`,
    [BATCH_SIZE]
  );
  if (!due.length) return;

  for (const r of due) {
    const nx = await resolveNxCredentials(r.client_id);
    if (!nx) {
      await markFailed(r.id, 'Credenciais do WhatsApp oficial não encontradas pra esse cliente.');
      continue;
    }
    try {
      await sendNxTemplate(nx, r.phone, r.template_name, r.template_language, r.template_params ?? []);
      await query(`UPDATE mass_campaign_recipients SET status = 'sent', sent_at = NOW() WHERE id = $1`, [r.id]);
    } catch (err) {
      await markFailed(r.id, err instanceof Error ? err.message : 'Falha ao enviar.');
    }
  }

  // Campanha "running" sem nenhum destinatário "queued" restante → concluída.
  await query(
    `UPDATE mass_campaigns SET status = 'done', finished_at = NOW()
     WHERE status = 'running'
       AND NOT EXISTS (SELECT 1 FROM mass_campaign_recipients WHERE campaign_id = mass_campaigns.id AND status = 'queued')`
  );
}

async function markFailed(recipientId: string, message: string): Promise<void> {
  await query(
    `UPDATE mass_campaign_recipients SET status = 'failed', error_message = $1 WHERE id = $2`,
    [message.slice(0, 500), recipientId]
  );
}
