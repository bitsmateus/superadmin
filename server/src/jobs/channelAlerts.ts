import { query } from '../db.js';
import { reconcileChannels, type ReconciledChannel } from '../routes/channels.js';
import { sendWhatsAppToNumber } from '../lib/supportGroup.js';

/**
 * Job de aviso de queda de canal. Roda periodicamente, reconcilia os canais e,
 * APENAS para os canais com aviso ligado E número configurado, envia uma
 * mensagem ao NÚMERO DE ALERTA (nunca ao cliente) quando o canal cai —
 * 1x por queda (controlado por last_status). Nada é enviado se ninguém ativou.
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
  // Primeira rodada ~30s após o boot, depois a cada INTERVAL_MS.
  setTimeout(tick, 30_000);
  setInterval(tick, INTERVAL_MS);
  console.log('[channelAlerts] job iniciado (a cada 5 min)');
}

function buildMessage(ch: ReconciledChannel): string {
  const who = ch.client_company || ch.client_name || '—';
  const lines = [
    '⚠️ Canal desconectado',
    `${ch.name}${ch.number ? ` (${ch.number})` : ''}`,
    `Cliente: ${who}`,
    `Tipo: ${ch.type}`,
  ];
  if (ch.divergent) {
    lines.push(`(NX mostrava "${ch.nx_status}", provedor real "${ch.real_status}")`);
  }
  return lines.join('\n');
}

async function runOnce() {
  // Só os canais que o operador ligou o aviso e definiu número.
  const cfgRows = await query<{
    channel_key: string;
    alert_number: string | null;
    last_status: string | null;
  }>(
    `SELECT channel_key, alert_number, last_status
     FROM channel_alerts
     WHERE alerts_enabled = true AND alert_number IS NOT NULL AND alert_number <> ''`,
  );
  if (cfgRows.length === 0) return; // ninguém ativou — não reconcilia nem envia

  const { channels } = await reconcileChannels();
  const byKey = new Map(channels.map((c) => [c.channel_key, c]));

  for (const cfg of cfgRows) {
    const ch = byKey.get(cfg.channel_key);
    if (!ch) continue;
    const eff = ch.effective_status;
    const prev = cfg.last_status;

    if (eff === 'disconnected' && prev !== 'disconnected') {
      // Transição para desconectado → avisa o número de alerta (não o cliente).
      const res = await sendWhatsAppToNumber(cfg.alert_number as string, buildMessage(ch));
      await query(
        `UPDATE channel_alerts SET last_status = $1, last_alert_at = NOW() WHERE channel_key = $2`,
        ['disconnected', cfg.channel_key],
      );
      if (!res.ok) console.warn('[channelAlerts] envio falhou', cfg.channel_key, res.reason ?? res.status);
    } else if (eff !== prev) {
      // Voltou / mudou de estado → atualiza para permitir novo aviso numa próxima queda.
      await query(`UPDATE channel_alerts SET last_status = $1 WHERE channel_key = $2`, [
        eff,
        cfg.channel_key,
      ]);
    }
  }
}
