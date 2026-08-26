import { FastifyReply } from 'fastify';

interface SseClient {
  id: string;
  userId: string;
  role: string;
  reply: FastifyReply;
}

const clients = new Map<string, SseClient>();

/** Quantas conexões abertas cada usuário tem agora (pode ter mais de uma aba/dispositivo) — só
 * fica "offline" de verdade quando a ÚLTIMA cai. Usado pra "quem está online" em Equipe. */
const onlineCounts = new Map<string, number>();

export function addSseClient(id: string, userId: string, role: string, reply: FastifyReply) {
  clients.set(id, { id, userId, role, reply });
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

export function broadcast(table: string, type: string, data: Record<string, unknown>) {
  const payload = `data: ${JSON.stringify({ table, type, data })}\n\n`;
  for (const client of clients.values()) {
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
