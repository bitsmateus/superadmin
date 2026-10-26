import { FastifyInstance } from 'fastify';
import { query } from '../db.js';
import { allowedPageIds } from './leadPages.js';

/**
 * Avisos da Luiza na tela do CRM ARTHUR: card novo no CRM IA LUIZA, card que foi pra "Qualificado" e card que foi pra
 * "Reunião agendada" (o gatilho registrar_aviso_luiza, em db.ts, cria o aviso). Cada pessoa vê os que ainda não marcou
 * como lidos, dos últimos 2 dias; o push no celular sai pelo job leadAvisosPush.
 */
const PAGINA_LUIZA = 'crm-ia-luiza';
const JANELA = "INTERVAL '2 days'";

async function podeVerLuiza(userId: string, role: string): Promise<boolean> {
  const abas = await allowedPageIds(userId, role);
  return abas === null || abas.includes(PAGINA_LUIZA);
}

export async function leadAvisosRoutes(app: FastifyInstance) {
  // GET /api/lead-avisos — os avisos não lidos de quem está logado (mais novo primeiro).
  app.get('/api/lead-avisos', { onRequest: [app.authenticate] }, async (req) => {
    const { sub, role } = req.user as { sub: string; role: string };
    if (!(await podeVerLuiza(sub, role))) return [];
    return query(
      `SELECT a.id, a.tipo, a.coluna, a.created_at, r.id AS card_id, COALESCE(r.nome, '') AS nome,
              COALESCE(r.empresa, '') AS empresa, COALESCE(r.origem, '') AS origem, COALESCE(r.agendamento, '') AS agendamento
       FROM lead_avisos a
       JOIN lead_rows r ON r.id = a.lead_row_id AND r.deleted_at IS NULL
       WHERE a.created_at > NOW() - ${JANELA}
         AND NOT EXISTS (SELECT 1 FROM lead_avisos_lidos l WHERE l.aviso_id = a.id AND l.user_id = $1)
       ORDER BY a.created_at DESC
       LIMIT 50`,
      [sub]
    );
  });

  // POST /api/lead-avisos/lidos — { ids: [...] } marca esses; sem ids, marca todos os não lidos.
  app.post<{ Body: { ids?: unknown } }>('/api/lead-avisos/lidos', { onRequest: [app.authenticate] }, async (req, reply) => {
    const { sub } = req.user as { sub: string };
    const ids = req.body?.ids;
    if (ids !== undefined && (!Array.isArray(ids) || ids.some((i) => typeof i !== 'string' || !/^[0-9a-f-]{36}$/i.test(i)))) {
      return reply.status(400).send({ message: '"ids" deve ser uma lista de ids.' });
    }
    await query(
      `INSERT INTO lead_avisos_lidos (aviso_id, user_id)
       SELECT a.id, $1 FROM lead_avisos a
       WHERE ${Array.isArray(ids) ? 'a.id = ANY($2::uuid[])' : `a.created_at > NOW() - ${JANELA}`}
       ON CONFLICT DO NOTHING`,
      Array.isArray(ids) ? [sub, ids] : [sub]
    );
    return { ok: true };
  });
}
