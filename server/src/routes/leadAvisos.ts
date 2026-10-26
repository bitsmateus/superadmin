import { FastifyInstance } from 'fastify';
import { query, queryOne } from '../db.js';
import { allowedPageIds } from './leadPages.js';
import { abaDeFora } from '../lib/abasJuntas.js';
import { donoDaAba, ehAPessoa } from '../lib/reuniaoResultado.js';

/**
 * Avisos da Luiza na tela do CRM ARTHUR: card novo no CRM IA LUIZA, card que foi pra "Qualificado" e card que foi pra
 * "Reunião agendada" (o gatilho registrar_aviso_luiza, em db.ts, cria o aviso). Todo mundo que abre o CRM ARTHUR vê.
 * O X do dono do CRM ARTHUR (o Arthur) conclui o aviso e ele some pra todos; o X de qualquer outra pessoa só esconde
 * pra ela. Mostra os dos últimos 2 dias; o push no celular sai pelo job leadAvisosPush.
 */
const PAGINA_LUIZA = 'crm-ia-luiza';
const JANELA = "INTERVAL '2 days'";

async function podeVerLuiza(userId: string, role: string): Promise<boolean> {
  const abas = await allowedPageIds(userId, role);
  return abas === null || abas.includes(PAGINA_LUIZA);
}

/** É o dono do CRM ARTHUR (a aba onde o CRM IA LUIZA aparece)? Mesma regra de nome do resto do app. */
async function ehODonoDaTela(userId: string): Promise<{ dono: boolean; nome: string }> {
  const [aba, sdrs, perfil] = await Promise.all([
    queryOne<{ name: string }>('SELECT name FROM lead_pages WHERE id = $1', [abaDeFora(PAGINA_LUIZA) ?? PAGINA_LUIZA]),
    query<{ name: string }>(`SELECT DISTINCT name FROM lead_labels WHERE field = 'sdr'`),
    queryOne<{ name: string | null; email: string }>('SELECT name, email FROM profiles WHERE id = $1', [userId]),
  ]);
  const nome = perfil?.name || perfil?.email || '';
  return { dono: ehAPessoa(donoDaAba(aba?.name ?? '', sdrs.map((s) => s.name)), perfil?.name || ''), nome };
}

export async function leadAvisosRoutes(app: FastifyInstance) {
  // GET /api/lead-avisos — os avisos abertos pra quem está logado (mais novo primeiro). fecha_pra_todos: o X dele
  // conclui o aviso pra todo mundo (é o dono do CRM ARTHUR).
  app.get('/api/lead-avisos', { onRequest: [app.authenticate] }, async (req) => {
    const { sub, role } = req.user as { sub: string; role: string };
    if (!(await podeVerLuiza(sub, role))) return [];
    const { dono } = await ehODonoDaTela(sub);
    return query(
      `SELECT a.id, a.tipo, a.coluna, a.created_at, r.id AS card_id, COALESCE(r.nome, '') AS nome,
              COALESCE(r.empresa, '') AS empresa, COALESCE(r.origem, '') AS origem, COALESCE(r.agendamento, '') AS agendamento,
              $2::boolean AS fecha_pra_todos
       FROM lead_avisos a
       JOIN lead_rows r ON r.id = a.lead_row_id AND r.deleted_at IS NULL
       WHERE a.created_at > NOW() - ${JANELA} AND a.resolvido_em IS NULL
         AND NOT EXISTS (SELECT 1 FROM lead_avisos_lidos l WHERE l.aviso_id = a.id AND l.user_id = $1)
       ORDER BY a.created_at DESC
       LIMIT 50`,
      [sub, dono]
    );
  });

  // POST /api/lead-avisos/lidos — { ids: [...] } esses; sem ids, todos os abertos. Do Arthur: conclui pra todos.
  // De qualquer outra pessoa: esconde só pra ela.
  app.post<{ Body: { ids?: unknown } }>('/api/lead-avisos/lidos', { onRequest: [app.authenticate] }, async (req, reply) => {
    const { sub } = req.user as { sub: string };
    const ids = req.body?.ids;
    if (ids !== undefined && (!Array.isArray(ids) || ids.some((i) => typeof i !== 'string' || !/^[0-9a-f-]{36}$/i.test(i)))) {
      return reply.status(400).send({ message: '"ids" deve ser uma lista de ids.' });
    }
    const filtro = Array.isArray(ids) ? 'a.id = ANY($2::uuid[])' : `a.created_at > NOW() - ${JANELA}`;
    const { dono, nome } = await ehODonoDaTela(sub);
    if (dono) {
      await query(
        `UPDATE lead_avisos a SET resolvido_em = NOW(), resolvido_por = $1 WHERE ${filtro} AND a.resolvido_em IS NULL`,
        Array.isArray(ids) ? [nome, ids] : [nome]
      );
      return { ok: true, pra_todos: true };
    }
    await query(
      `INSERT INTO lead_avisos_lidos (aviso_id, user_id)
       SELECT a.id, $1 FROM lead_avisos a WHERE ${filtro}
       ON CONFLICT DO NOTHING`,
      Array.isArray(ids) ? [sub, ids] : [sub]
    );
    return { ok: true, pra_todos: false };
  });
}
