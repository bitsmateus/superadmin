import { query } from '../db.js';
import { sendOfficialTemplate } from '../lib/officialApi.js';

/**
 * Disparo mensal do "pulso de satisfação": manda a pergunta sim/não pro WhatsApp de clientes ativos
 * via template aprovado da API Oficial (mesmo canal/credencial dos avisos de canal desconectado, ver
 * server/src/lib/officialApi.ts). Fica DESLIGADO por padrão — só liga quando o template estiver
 * aprovado na Meta e a env PULSE_DISPATCH=on for configurada (ver comentário em startPulseDispatch).
 *
 * Mesma regra de elegibilidade do POST /api/pulses/queue (uso manual continua funcionando em
 * paralelo, sem duplicar — o NOT EXISTS olha pra client_pulses independente de quem inseriu a linha).
 */
const INTERVAL_MS = 24 * 60 * 60 * 1000; // 1x/dia
const DEFAULT_DAYS = 30;
const DEFAULT_TEMPLATE = 'pulso_satisfacao';
// Limite de quantos pulsos manda por rodada (1x/dia) — evita disparar pra base inteira de uma vez
// na primeira ativação; quem fica de fora hoje entra na fila do dia seguinte (ORDER BY estável).
const DEFAULT_LIMIT = 15;
// Pausa entre um envio e outro — mandar tudo de uma vez (15 mensagens em segundos) parece disparo
// em massa e pode acender alerta de spam na própria Meta/WABA. 50s entre cada um imita o ritmo de
// alguém mandando na mão.
const DEFAULT_DELAY_MS = 50_000;

interface ElegivelRow {
  id: string;
  name: string;
  company: string | null;
  phone: string | null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function dispatchOnce(days: number, templateName: string, limit: number, delayMs: number): Promise<void> {
  const eligible = await query<ElegivelRow>(
    `SELECT c.id, c.name, c.company, c.phone
     FROM clients c
     WHERE c.stage <> 'churned' AND c.archived_at IS NULL
       AND c.phone IS NOT NULL AND c.phone <> ''
       AND NOT EXISTS (
         SELECT 1 FROM client_pulses p
         WHERE p.client_id = c.id AND p.sent_at > NOW() - ($1 || ' days')::interval
       )
     ORDER BY c.company NULLS LAST, c.name
     LIMIT $2`,
    [days, limit],
  );
  if (eligible.length === 0) return;

  let enviados = 0;
  for (let i = 0; i < eligible.length; i++) {
    const c = eligible[i];
    if (i > 0) await sleep(delayMs); // espera ANTES de cada envio a partir do segundo — nunca depois do último
    const empresa = (c.company && c.company.trim()) || c.name;
    const res = await sendOfficialTemplate(c.phone as string, templateName, [empresa]);
    if (!res.ok) {
      console.warn('[pulse-dispatch] falha ao enviar pro cliente', c.id, res.reason ?? res.status ?? res.detail);
      continue;
    }
    await query(
      `INSERT INTO client_pulses (client_id, phone, question, status, sent_at)
       VALUES ($1, $2, $3, 'aguardando', NOW())`,
      [c.id, c.phone, `[template:${templateName}] Você está satisfeito(a) com o nosso atendimento?`],
    );
    enviados++;
  }
  console.log(`[pulse-dispatch] ${enviados}/${eligible.length} pulso(s) disparado(s) via template "${templateName}"`);
}

// DESLIGADO — a pedido, o disparo automático de pulso (e qualquer mensagem que ele tentasse mandar)
// fica fora do ar até alguém tirar esse `return` manualmente no código e revisar de novo. Não
// depende mais de PULSE_DISPATCH no ambiente: mesmo que essa env esteja "on" em algum lugar, o job
// nem entra na fila do setInterval.
const HARD_DISABLED = true;

export function startPulseDispatch(): void {
  if (HARD_DISABLED) {
    console.log('[pulse-dispatch] desativado no código (HARD_DISABLED) — não manda nada, não entra na fila de jobs');
    return;
  }
  // Desligado até o template ser aprovado na Meta — ligar com PULSE_DISPATCH=on no ambiente
  // (opcionalmente PULSE_TEMPLATE_NAME se o nome final do template aprovado for diferente de
  // "pulso_satisfacao", e PULSE_DISPATCH_DAYS pra mudar a frequência de 30 dias).
  if (process.env.PULSE_DISPATCH !== 'on') {
    console.log('[pulse-dispatch] desativado (defina PULSE_DISPATCH=on quando o template estiver aprovado)');
    return;
  }
  const days = Math.max(1, Number(process.env.PULSE_DISPATCH_DAYS) || DEFAULT_DAYS);
  const templateName = (process.env.PULSE_TEMPLATE_NAME || DEFAULT_TEMPLATE).trim();
  const limit = Math.max(1, Number(process.env.PULSE_DISPATCH_LIMIT) || DEFAULT_LIMIT);
  const delayMs = Math.max(0, Number(process.env.PULSE_DISPATCH_DELAY_MS) || DEFAULT_DELAY_MS);
  const tick = () => {
    dispatchOnce(days, templateName, limit, delayMs).catch((err) => console.error('[pulse-dispatch] erro', err));
  };
  setTimeout(tick, 45_000);
  setInterval(tick, INTERVAL_MS);
  console.log(
    `[pulse-dispatch] agendador ativo (1x/dia, ate ${limit} por rodada, ${Math.round(delayMs / 1000)}s entre cada envio, ` +
    `${days} dia(s) sem pulso, template "${templateName}")`,
  );
}
