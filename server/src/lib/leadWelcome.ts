import { query, queryOne } from '../db.js';
import { sendNxTemplate } from './nxTemplateSend.js';
import { normalizePhone } from './spreadsheet.js';

/** Primeiro nome com a inicial maiúscula ("maria da silva" -> "Maria"). Vazio se não houver nome. */
export function primeiroNome(nome: string | null | undefined): string {
  const first = (nome ?? '').trim().split(/\s+/)[0] ?? '';
  if (!first) return '';
  return first.charAt(0).toLocaleUpperCase('pt-BR') + first.slice(1).toLocaleLowerCase('pt-BR');
}

async function registrar(leadRowId: string, type: 'template_sent' | 'template_failed', value: string) {
  await query(
    `INSERT INTO lead_events (lead_row_id, type, from_value, to_value, actor_name) VALUES ($1,$2,$3,$4,$5)`,
    [leadRowId, type, null, value.slice(0, 500), 'Automação']
  );
}

/**
 * Manda o template de boas-vindas ao lead que acabou de cair do tráfego pago, com {{1}} = primeiro
 * nome e {{2}} = quem assina (padrão "Arthur"). Resultado vai pra linha do tempo do lead
 * (template_sent / template_failed) e pras colunas boas_vindas_* (selo no card). Nunca lança:
 * quem chama dispara em background e o webhook não pode falhar por causa do WhatsApp.
 */
export async function enviarBoasVindasLead(leadRowId: string): Promise<void> {
  const apiId = process.env.LEAD_WELCOME_NX_API_ID?.trim();
  const apiToken = process.env.LEAD_WELCOME_NX_TOKEN?.trim();
  if (!apiId || !apiToken) {
    console.warn('[lead-welcome] LEAD_WELCOME_NX_API_ID/TOKEN não configurados — boas-vindas desligada');
    return;
  }
  const baseUrl = (process.env.LEAD_WELCOME_NX_BASE_URL?.trim() || 'https://webapi.nxsystems.com.br').replace(/\/$/, '');
  const template = process.env.LEAD_WELCOME_TEMPLATE?.trim() || 'primeiro_dia';
  const language = process.env.LEAD_WELCOME_LANGUAGE?.trim() || 'en';
  const sender = process.env.LEAD_WELCOME_SENDER?.trim() || 'Arthur';

  try {
    const lead = await queryOne<{ nome: string; telefone: string; boas_vindas_enviada_em: string | null }>(
      'SELECT nome, telefone, boas_vindas_enviada_em FROM lead_rows WHERE id = $1',
      [leadRowId]
    );
    if (!lead || lead.boas_vindas_enviada_em) return;

    const phone = normalizePhone(lead.telefone, '55');
    if (!phone) {
      const msg = 'Lead sem telefone válido — mensagem não enviada.';
      await query('UPDATE lead_rows SET boas_vindas_erro = $2 WHERE id = $1', [leadRowId, msg]);
      await registrar(leadRowId, 'template_failed', msg);
      return;
    }

    // Trava atômica: só quem consegue marcar como enviada manda — evita mensagem dupla se o mesmo
    // lead disparar duas vezes. Se o envio falhar, desfaz a marca pra poder tentar de novo.
    const claimed = await queryOne<{ id: string }>(
      `UPDATE lead_rows SET boas_vindas_enviada_em = NOW(), boas_vindas_erro = NULL
       WHERE id = $1 AND boas_vindas_enviada_em IS NULL RETURNING id`,
      [leadRowId]
    );
    if (!claimed) return;

    try {
      // WhatsApp recusa parâmetro vazio — sem nome cadastrado cai num cumprimento neutro.
      const params = [primeiroNome(lead.nome) || 'aí', sender];
      await sendNxTemplate({ baseUrl, apiId, apiToken }, phone, template, language, params, false);
      await registrar(leadRowId, 'template_sent', template);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Falha ao enviar.';
      await query('UPDATE lead_rows SET boas_vindas_enviada_em = NULL, boas_vindas_erro = $2 WHERE id = $1', [
        leadRowId,
        msg.slice(0, 1000),
      ]);
      await registrar(leadRowId, 'template_failed', msg);
    }
  } catch (err) {
    console.error('[lead-welcome] falha inesperada', leadRowId, err);
  }
}
