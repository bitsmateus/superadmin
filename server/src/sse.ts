import { FastifyReply } from 'fastify';
import {
  TABELAS_DO_FINANCEIRO, ehQuadroDoFinanceiro, limparClienteParaQuemNaoEFinanceiro, podeVerFinanceiro,
} from './lib/financeiro.js';
import { mascararSettings } from './routes/settings.js';

interface SseClient {
  id: string;
  userId: string;
  role: string;
  /** Ian ou Mateus: recebe também o que é do Financeiro. */
  financeiro: boolean;
  reply: FastifyReply;
}

const clients = new Map<string, SseClient>();

/** Quantas conexões abertas cada usuário tem agora (pode ter mais de uma aba/dispositivo) — só
 * fica "offline" de verdade quando a ÚLTIMA cai. Usado pra "quem está online" em Equipe. */
const onlineCounts = new Map<string, number>();

export function addSseClient(id: string, userId: string, role: string, reply: FastifyReply) {
  clients.set(id, { id, userId, role, financeiro: podeVerFinanceiro(userId, role), reply });
  const wasOffline = (onlineCounts.get(userId) ?? 0) === 0;
  onlineCounts.set(userId, (onlineCounts.get(userId) ?? 0) + 1);
  if (wasOffline) broadcast('presence', 'online', { user_id: userId });
}

export function removeSseClient(id: string) {
  const client = clients.get(id);
  clients.delete(id);
  if (!client) return;
  const count = (onlineCounts.get(client.userId) ?? 1) - 1;
  if (count <= 0) {
    onlineCounts.delete(client.userId);
    broadcast('presence', 'offline', { user_id: client.userId });
  } else {
    onlineCounts.set(client.userId, count);
  }
}

/** Usado pra montar o estado inicial da tela de Equipe (a lista de "quem está online" antes de
 * qualquer evento de presence chegar via SSE). */
export function getOnlineUserIds(): string[] {
  return Array.from(onlineCounts.keys());
}

/**
 * O que um aviso do banco pode levar pra quem não é do Financeiro (e o que NUNCA sai pra ninguém).
 * null = esse aviso não vai pra essa pessoa.
 */
function dadosPara(financeiro: boolean, table: string, data: Record<string, unknown>): Record<string, unknown> | null {
  // Segredos: nunca, pra ninguém.
  if (table === 'profiles') {
    const { password_hash: _senha, ...resto } = data;
    return resto;
  }
  if (table === 'settings') return mascararSettings(data, financeiro);
  if (financeiro) return data;
  // Financeiro: só Ian e Mateus.
  if (TABELAS_DO_FINANCEIRO.has(table)) return null;
  if (table === 'lead_rows' && ehQuadroDoFinanceiro(data.board_id)) return null;
  if (table === 'clients') return limparClienteParaQuemNaoEFinanceiro(data);
  return data;
}

export function broadcast(table: string, type: string, data: Record<string, unknown>) {
  // Calcula as duas versões uma vez só (quem é do Financeiro e quem não é).
  const versoes = new Map<boolean, string | null>()
  const payloadDe = (financeiro: boolean) => {
    if (!versoes.has(financeiro)) {
      const d = dadosPara(financeiro, table, data);
      versoes.set(financeiro, d ? `data: ${JSON.stringify({ table, type, data: d })}\n\n` : null);
    }
    return versoes.get(financeiro)!;
  };
  for (const client of clients.values()) {
    const payload = payloadDe(client.financeiro);
    if (!payload) continue;
    try {
      client.reply.raw.write(payload);
    } catch {
      clients.delete(client.id);
    }
  }
}

export function broadcastToUser(
  userId: string,
  table: string,
  type: string,
  data: Record<string, unknown>
) {
  const payload = `data: ${JSON.stringify({ table, type, data })}\n\n`;
  for (const client of clients.values()) {
    if (client.userId === userId) {
      try {
        client.reply.raw.write(payload);
      } catch {
        clients.delete(client.id);
      }
    }
  }
}
