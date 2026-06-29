import { query } from '../db.js';
import { reconcileChannels, type ReconciledChannel } from '../routes/channels.js';
import { sendOfficialTemplate, spDateTimeShort, TUTORIAL_URL } from '../lib/officialApi.js';
import { sendToSupportGroupId } from '../lib/supportGroup.js';

/**
 * Grupo de WhatsApp que recebe uma CÓPIA de todos os avisos de canal (enviado
 * pela MESMA credencial do grupo de suporte, não pela API Oficial). Configurável
 * por env ALERT_GROUP_ID; default no grupo informado.
 */
const ALERT_GROUP_ID = (process.env.ALERT_GROUP_ID || '120363409254876877').trim();

async function copyToAlertGroup(text: string) {
  if (!ALERT_GROUP_ID) return;
  const res = await sendToSupportGroupId(ALERT_GROUP_ID, text);
  if (!res.ok) console.warn('[channelAlerts] cópia p/ grupo falhou', res.reason ?? res.status);
}

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

/**
 * Registra a transição de status do canal (todos os canais, com ou sem aviso):
 * atualiza last_status + status_since e, quando envolve queda/retorno, grava um
 * evento no histórico (channel_events) para os relatórios. Insere com
 * alerts_enabled = true para preservar o default "sim" do aviso.
 */
async function recordTransition(ch: ReconciledChannel, status: string) {
  await query(
    `INSERT INTO channel_alerts (channel_key, alerts_enabled, last_status, status_since, updated_at)
     VALUES ($1, true, $2, NOW(), NOW())
     ON CONFLICT (channel_key) DO UPDATE SET
       last_status = EXCLUDED.last_status, status_since = NOW(), updated_at = NOW()`,
    [ch.channel_key, status],
  );
}

async function logEvent(ch: ReconciledChannel, status: string) {
  await query(
    `INSERT INTO channel_events (channel_key, channel_name, channel_number, client_id, client_name, status)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [
      ch.channel_key,
      ch.name || null,
      ch.number || null,
      ch.client_id,
      ch.client_company || ch.client_name || null,
      status,
    ],
  );
}

async function markAlerted(channelKey: string) {
  await query('UPDATE channel_alerts SET last_alert_at = NOW(), updated_at = NOW() WHERE channel_key = $1', [
    channelKey,
  ]);
}

async function runOnce() {
  // Reconcilia SEMPRE (mesmo sem ninguém com aviso ligado) — o histórico de
  // quedas/retornos dos relatórios precisa rastrear todos os canais.
  const { channels } = await reconcileChannels();
  if (channels.length === 0) return;

  // Tenants (clientes) com a notificação de canais ligada → número que recebe.
  const clients = await query<{ id: string; phone: string | null; channel_notify_number: string | null }>(
    `SELECT id, phone, channel_notify_number
     FROM clients
     WHERE channel_notify_enabled = true AND archived_at IS NULL`,
  );
  const numberByClient = new Map<string, string>();
  for (const c of clients) {
    const num = (c.channel_notify_number ?? '').trim() || (c.phone ?? '').trim();
    if (num) numberByClient.set(c.id, num);
  }

  // Config por canal (sim/não) + último status (para "1x por queda").
  const cfgRows = await query<{ channel_key: string; alerts_enabled: boolean; last_status: string | null }>(
    'SELECT channel_key, alerts_enabled, last_status FROM channel_alerts',
  );
  const cfgByKey = new Map(cfgRows.map((r) => [r.channel_key, r]));

  for (const ch of channels) {
    const cfg = cfgByKey.get(ch.channel_key);
    const eff = ch.effective_status;
    const prev = cfg?.last_status ?? null;

    // 1) Rastreio (TODOS os canais): grava transição + histórico de queda/retorno.
    if (eff !== prev) {
      await recordTransition(ch, eff);
      if (eff === 'disconnected') await logEvent(ch, 'disconnected');
      else if (prev === 'disconnected') await logEvent(ch, 'connected');
    }

    // 2) Aviso ao cliente (só tenants com notificação ligada e canal não "não").
    const number = ch.client_id ? numberByClient.get(ch.client_id) : undefined;
    const channelMuted = cfg && cfg.alerts_enabled === false;
    if (!number || channelMuted) continue;

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
      await markAlerted(ch.channel_key);
      if (!res.ok) console.warn('[channelAlerts] desconectado falhou', ch.channel_key, res.reason ?? res.status);
      await copyToAlertGroup(
        `🔴 *Canal desconectado*\n` +
          `Canal: ${ch.name || '—'}\n` +
          `Número: ${ch.number || ch.name || '—'}\n` +
          `Cliente: ${cliente}\n` +
          `Horário: ${horario}`,
      );
    } else if (eff === 'connected' && prev === 'disconnected') {
      // Template canal_reconectado: {{1}} Canal {{2}} Horario
      const res = await sendOfficialTemplate(number, 'canal_reconectado', [ch.name || '—', horario]);
      await markAlerted(ch.channel_key);
      if (!res.ok) console.warn('[channelAlerts] reconectado falhou', ch.channel_key, res.reason ?? res.status);
      await copyToAlertGroup(
        `🟢 *Canal reconectado*\n` +
          `Canal: ${ch.name || '—'}\n` +
          `Cliente: ${cliente}\n` +
          `Horário: ${horario}`,
      );
    }
  }
}
