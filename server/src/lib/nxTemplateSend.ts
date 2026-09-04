import type { NxCredentials } from './wabaAccess.js';

/**
 * Envia UMA mensagem de template do WhatsApp através da API da NX (canal oficial WABA por trás
 * dela) — mesmo endpoint e formato de payload já usados em produção pelo canal NX do Recorrai
 * (github.com/bitsmateus/recorra, src/modules/channels/providers/nx-systems.channel.ts): o corpo
 * é literalmente o formato nativo da WhatsApp Cloud API (`messaging_product`/`type: 'template'`),
 * encapsulado dentro de `{ number, isClosed, templateData }`.
 *
 * `isClosed: true` é o que fecha o ticket/conversa na central de atendimento da NX assim que a
 * mensagem sai — sem isso, cada disparo em massa deixaria uma conversa aberta esperando resposta
 * na fila de atendimento. Não existe uma chamada separada de "fechar": é sempre esse mesmo flag.
 */
export async function sendNxTemplate(
  nx: NxCredentials,
  to: string,
  templateName: string,
  language: string,
  bodyParams: string[],
): Promise<void> {
  // Sempre /templateBody: o atalho /template exige sessão ativa e falha com
  // ERR_API_REQUIRES_SESSION (mesmo problema já contornado em officialApi.ts).
  const url = `${nx.baseUrl}/v2/api/external/${encodeURIComponent(nx.apiId)}/templateBody`;
  const templateData: Record<string, unknown> = {
    messaging_product: 'whatsapp',
    to,
    type: 'template',
    template: {
      name: templateName,
      language: { code: language },
      ...(bodyParams.length
        ? { components: [{ type: 'body', parameters: bodyParams.map((text) => ({ type: 'text', text })) }] }
        : {}),
    },
  };

  const payload = { number: to, isClosed: true, templateData };

  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 20000);
  let res: Response;
  let rawText = '';
  let body: unknown;
  try {
    res = await fetch(url, {
      method: 'POST',
      signal: ctrl.signal,
      headers: { Authorization: `Bearer ${nx.apiToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    rawText = await res.text();
    try {
      body = rawText ? JSON.parse(rawText) : undefined;
    } catch {
      body = rawText;
    }
  } finally {
    clearTimeout(t);
  }

  // A NX às vezes responde 200 mesmo em erro — só o corpo denuncia. Guarda a RESPOSTA CRUA inteira
  // (não só .message/.error): códigos como ERR_API_REQUIRES_SESSION sozinhos não dizem o motivo, e
  // sem o corpo completo não dá pra saber do que ela está reclamando.
  if (!res.ok || (body as { success?: boolean } | undefined)?.success === false) {
    // Log no servidor com request + response completos — o relatório do portal fica com a versão
    // curta, aqui fica o suficiente pra depurar o que a NX recebeu de fato.
    console.error(
      '[nxTemplateSend] falha',
      JSON.stringify({ url, status: res.status, request: payload, response: rawText.slice(0, 2000) })
    );
    const detail = rawText.trim().slice(0, 800) || '(resposta vazia)';
    throw new Error(`NX HTTP ${res.status} — ${detail}`);
  }
}
