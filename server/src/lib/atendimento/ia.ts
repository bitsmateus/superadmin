import type { ClasseIa } from './regras.js';

/**
 * Lê a ÚLTIMA mensagem do atendente (com a última do cliente de contexto) e diz se é uma promessa de
 * retorno, uma solução, uma pergunta ao cliente ou outra coisa. É o que separa "vou verificar e sumiu"
 * de "respondeu e o cliente parou". Sem ANTHROPIC_API_KEY, quem decide são as palavras-chave (regras.ts).
 */

const API_URL = 'https://api.anthropic.com/v1/messages';
const MODELO = process.env.ANTHROPIC_MODEL_RAPIDO || 'claude-haiku-5-5';

const SISTEMA = `Você classifica a última mensagem que um atendente de suporte técnico (WhatsApp) mandou para um cliente.
Responda com UMA palavra só, sem pontuação:
- promessa: o atendente ficou de voltar depois (vai verificar, analisar, acionar alguém, pediu para aguardar, "já te retorno") e o assunto NÃO está resolvido.
- resolvido: o atendente entregou a solução, confirmou que ajustou ou encerrou o assunto.
- pergunta: o atendente pediu uma informação, um teste ou uma confirmação ao cliente (a bola está com o cliente).
- outro: saudação, aviso, link, qualquer outra coisa.`;

export function iaDisponivel(): boolean {
  return !!process.env.ANTHROPIC_API_KEY;
}

export async function classificarComIa(textoAtendente: string, textoCliente: string): Promise<ClasseIa | null> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key || !textoAtendente.trim()) return null;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 15_000);
  try {
    const res = await fetch(API_URL, {
      method: 'POST',
      headers: {
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
        ...(process.env.ANTHROPIC_WORKSPACE_ID ? { 'anthropic-workspace-id': process.env.ANTHROPIC_WORKSPACE_ID } : {}),
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: MODELO,
        max_tokens: 10,
        system: SISTEMA,
        messages: [
          {
            role: 'user',
            content: `Última mensagem do cliente: """${textoCliente.slice(0, 600)}"""\nÚltima mensagem do atendente: """${textoAtendente.slice(0, 900)}"""`,
          },
        ],
      }),
      signal: ctrl.signal,
    });
    if (!res.ok) {
      console.warn('[monitorAtendimento] IA', res.status, (await res.text().catch(() => '')).slice(0, 200));
      return null;
    }
    const data = (await res.json()) as { content?: { type: string; text?: string }[] };
    const palavra = (data.content ?? [])
      .map((b) => b.text ?? '')
      .join(' ')
      .trim()
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z]/g, ' ')
      .trim()
      .split(/\s+/)[0];
    return palavra === 'promessa' || palavra === 'resolvido' || palavra === 'pergunta' || palavra === 'outro' ? palavra : null;
  } catch (err) {
    console.warn('[monitorAtendimento] IA falhou', String(err).slice(0, 200));
    return null;
  } finally {
    clearTimeout(timer);
  }
}
