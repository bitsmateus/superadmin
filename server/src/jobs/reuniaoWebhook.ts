import { query, queryOne } from '../db.js';
import { agendamentoParaIso } from '../lib/reuniaoResultado.js';

/**
 * Aviso pro n8n do resultado da reunião (env N8N_WEBHOOK_REUNIAO). Cada resultado guarda em reuniao_resultados se o
 * aviso chegou (webhook_enviado_em), quantas tentativas e o último erro; o que não chegou (n8n fora, timeout, env
 * vazia) é reenviado por este job a cada 5 min. Sem a env, nada sai, mas fica no log e na tabela — antes disso o envio
 * pulava calado e não dava pra saber por que o n8n não recebia.
 */
const TIMEOUT_MS = 5000;
const INTERVALO_MS = 5 * 60 * 1000;
/** Só reenvia depois disso: o envio na hora do popup ainda pode estar em andamento. */
const ESPERA_REENVIO = '2 minutes';
const MAX_TENTATIVAS = 20;

const urlDoWebhook = () => process.env.N8N_WEBHOOK_REUNIAO?.trim() || '';

/** O JSON do webhook, montado do que ficou gravado. O n8n conhece a lead pelo card original (ex.: o do CRM IA LUIZA). */
async function montarPayload(resultadoId: string): Promise<Record<string, unknown> | null> {
  const r = await queryOne<{
    resultado: string; lead_row_id: string; agendamento: string; agendamento_novo: string | null;
    proxima_etapa: string | null; motivo: string | null; resumo: string; user_name: string;
    quadro_id: string | null; telefone: string | null; nome: string | null;
  }>(
    `SELECT rr.resultado, rr.lead_row_id, rr.agendamento, rr.agendamento_novo, rr.proxima_etapa, rr.motivo, rr.resumo,
            rr.user_name, lb.page AS quadro_id, COALESCE(NULLIF(o.telefone, ''), c.telefone) AS telefone,
            COALESCE(NULLIF(o.nome, ''), c.nome) AS nome
     FROM reuniao_resultados rr
     LEFT JOIN lead_rows o ON o.id = rr.lead_row_id
     LEFT JOIN lead_boards lb ON lb.id = o.board_id
     LEFT JOIN lead_rows c ON c.id = rr.card_id
     WHERE rr.id = $1`,
    [resultadoId]
  );
  if (!r) return null;
  return {
    evento: r.resultado,
    card_id: r.lead_row_id,
    quadro_id: r.quadro_id,
    telefone: r.telefone ?? '',
    nome: r.nome ?? '',
    agendamento_anterior: agendamentoParaIso(r.agendamento),
    agendamento_novo: agendamentoParaIso(r.agendamento_novo),
    proxima_etapa: r.proxima_etapa,
    motivo: r.motivo,
    resumo: r.resumo || null,
    usuario: r.user_name,
  };
}

/** Manda um resultado pro n8n e grava como foi. Nunca lança (roda em background depois do popup). */
export async function enviarWebhookDaReuniao(resultadoId: string): Promise<void> {
  try {
    const payload = await montarPayload(resultadoId);
    if (!payload) return;
    const rotulo = `${payload.evento} · ${payload.nome || payload.card_id}`;
    const url = urlDoWebhook();
    let erro: string | null = null;
    if (!url) erro = 'N8N_WEBHOOK_REUNIAO não configurada';
    else {
      try {
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
          signal: AbortSignal.timeout(TIMEOUT_MS),
        });
        if (!res.ok) erro = `n8n respondeu HTTP ${res.status}`;
      } catch (err) {
        erro = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
      }
    }
    await query(
      `UPDATE reuniao_resultados
       SET webhook_tentativas = webhook_tentativas + 1, webhook_erro = $2,
           webhook_enviado_em = CASE WHEN $2::text IS NULL THEN NOW() ELSE NULL END
       WHERE id = $1`,
      [resultadoId, erro]
    );
    if (erro) console.error(`[reuniao] webhook do n8n NÃO enviado (${rotulo}): ${erro}`);
    else console.log(`[reuniao] webhook do n8n enviado (${rotulo})`);
  } catch (err) {
    console.error('[reuniao] falha ao avisar o n8n', resultadoId, err);
  }
}

async function reenviarPendentes() {
  if (!urlDoWebhook()) return;
  const pendentes = await query<{ id: string }>(
    `SELECT id FROM reuniao_resultados
     WHERE webhook_enviado_em IS NULL AND webhook_tentativas < $1 AND created_at < NOW() - INTERVAL '${ESPERA_REENVIO}'
     ORDER BY created_at LIMIT 20`,
    [MAX_TENTATIVAS]
  );
  for (const { id } of pendentes) await enviarWebhookDaReuniao(id);
}

export function startReuniaoWebhook() {
  const url = urlDoWebhook();
  let host = '';
  try { host = url ? new URL(url).host : ''; } catch { host = 'URL inválida'; }
  if (url) console.log(`[reuniao] webhook do n8n configurado (${host}); reenvio do que falhar a cada 5 min`);
  else console.warn('[reuniao] N8N_WEBHOOK_REUNIAO vazia: o resultado da reunião NÃO vai pro n8n (fica na fila pra quando configurar)');
  const tick = () => { reenviarPendentes().catch((err) => console.error('[reuniao] erro no reenvio do webhook:', err)); };
  setTimeout(tick, 30_000);
  setInterval(tick, INTERVALO_MS);
}
