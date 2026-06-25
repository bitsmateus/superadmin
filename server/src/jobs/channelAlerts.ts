import { query } from '../db.js';
import { reconcileChannels, type ReconciledChannel } from '../routes/channels.js';
import { sendOfficialTemplate, spDateTimeShort, TUTORIAL_URL } from '../lib/officialApi.js';

/**
 * Aviso de queda de canal POR TENANT. Para cada cliente com a notificação
 * ligada (channel_notify_enabled), verifica seus canais e, quando um canal
 * (marcado como "sim") cai, envia ao NÚMERO do tenant (channel_notify_number,
 * ou o telefone do cliente da Visão Geral) — 1x por queda.
 */
const INTERVAL_MS = 3 * 60 * 1000; // 3 min

export function startChannelAlerts() {
  if (process.env.CHANNEL_ALERTS === 'off') {
    console.log('[channelAlerts] desativado (CHANNEL_ALERTS=off)');
    return;
  }
  const tick = () => {
    runOnce().catch((err) => console.error('[channelAlerts] erro:', err));
  };
  setTimeout(tick, 30_000);
  setInterval(tick, INTERVAL_MS);
  console.log('[channelAlerts] job iniciado (a cada 3 min, por tenant)');
}

async function setLastStatus(channelKey: string, status: string, alerted: boolean) {
  await query(
    `INSERT INTO channel_alerts (channel_key, alerts_enabled, last_status, last_alert_at, updated_at)
     VALUES ($1, true, $2, ${alerted ? 'NOW()' : 'NULL'}, NOW())
     ON CONFLICT (channel_key) DO UPDATE SET
       last_status = EXCLUDED.last_status${alerted ? ', last_alert_at = NOW()' : ''}, updated_at = NOW()`,
    [channelKey, status],
  );
}

async function runOnce() {
  // Tenants (clientes) com a notificação de canais ligada.
  const clients = await query<{
    id: string;
    phone: string | null;
    channel_notify_number: string | null;
  }>(
    `SELECT id, phone, channel_notify_number
     FROM clients
     WHERE channel_notify_enabled = true AND archived_at IS NULL`,
  );
  if (clients.length === 0) return; // ninguém ligou — não reconcilia nem envia

  const numberByClient = new Map<string, string>();
  for (const c of clients) {
    const num = (c.channel_notify_number ?? '').trim() || (c.phone ?? '').trim();
    if (num) numberByClient.set(c.id, num);
  }
  if (numberByClient.size === 0) return;

  // Config por canal (sim/não) + último status (para "1x por queda").
  const cfgRows = await query<{ channel_key: string; alerts_enabled: boolean; last_status: string | null }>(
    'SELECT channel_key, alerts_enabled, last_status FROM channel_alerts',
  );
  const cfgByKey = new Map(cfgRows.map((r) => [r.channel_key, r]));

  const { channels } = await reconcileChannels();

  for (const ch of channels) {
    if (!ch.client_id || !numberByClient.has(ch.client_id)) continue;
    const cfg = cfgByKey.get(ch.channel_key);
    // Default = "sim": só não notifica se o canal estiver explicitamente como não.
    if (cfg && cfg.alerts_enabled === false) continue;
    const number = numberByClient.get(ch.client_id)!;
    const eff = ch.effective_status;
    const prev = cfg?.last_status ?? null;
    const cliente = ch.client_company || ch.client_name || '—';
    const horario = spDateTimeShort();

    if (eff === 'disconnected' && prev !== 'disconnected') {
      // Template canal_desconectado: {{1}} Canal {{2}} Numero {{3}} Cliente {{4}} Horario {{5}} tutorial
      const res = await sendOfficialTemplate(number, 'canal_desconectado', [
        ch.name || '—',
        ch.number || ch.name || '—',
        cliente,
        horario,
        TUTORIAL_URL,
      ]);
      await setLastStatus(ch.channel_key, 'disconnected', true);
      if (!res.ok) console.warn('[channelAlerts] desconectado falhou', ch.channel_key, res.reason ?? res.status);
    } else if (eff === 'connected' && prev === 'disconnected') {
      // Template canal_reconectado: {{1}} Canal {{2}} Horario
      const res = await sendOfficialTemplate(number, 'canal_reconectado', [ch.name || '—', horario]);
      await setLastStatus(ch.channel_key, 'connected', true);
      if (!res.ok) console.warn('[channelAlerts] reconectado falhou', ch.channel_key, res.reason ?? res.status);
    } else if (eff !== prev) {
      await setLastStatus(ch.channel_key, eff, false);
    }
  }
}
