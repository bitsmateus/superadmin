import { FastifyReply } from 'fastify';

interface SseClient {
  id: string;
  userId: string;
  role: string;
  reply: FastifyReply;
}

const clients = new Map<string, SseClient>();

export function addSseClient(id: string, userId: string, role: string, reply: FastifyReply) {
  clients.set(id, { id, userId, role, reply });
}

export function removeSseClient(id: string) {
  clients.delete(id);
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
