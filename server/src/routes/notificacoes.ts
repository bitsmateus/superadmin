import { FastifyInstance } from 'fastify';
import { query, queryOne } from '../db.js';
import { restrictedBoardFilter } from './leadBoards.js';
import { abaDeFora } from '../lib/abasJuntas.js';
import { donoDaAba, ehAPessoa } from '../lib/reuniaoResultado.js';
import { PAGINA_DO_CLOSER, PAGINA_DO_SDR, linkDoCard } from '../lib/notificacoes.js';

/**
 * Sininho e popup das notificações do comercial (ver lib/notificacoes.ts). Cada um vê e marca só as suas. Admin, dentro
 * do CRM do Arthur ou do Luis, vê o sininho daquele usuário só pra olhar (?pagina=): a lista e o lida/não lida dele, sem
 * poder marcar nada e sem popup.
 */
const JANELA = "INTERVAL '30 days'";

/** O dono (perfil) de uma aba do comercial, pelo nome da aba (o CRM IA LUIZA é do dono do CRM ARTHUR). */
async function donoDaPagina(pagina: string): Promise<{ id: string; nome: string } | null> {
  const alvo = abaDeFora(pagina) ?? pagina;
  if (![PAGINA_DO_SDR, PAGINA_DO_CLOSER].includes(alvo)) return null;
  const [aba, sdrs, perfis] = await Promise.all([
    queryOne<{ name: string }>('SELECT name FROM lead_pages WHERE id = $1', [alvo]),
    query<{ name: string }>(`SELECT DISTINCT name FROM lead_labels WHERE field = 'sdr'`),
    query<{ id: string; name: string | null; role: string }>('SELECT id, name, role FROM profiles'),
  ]);
  const dono = donoDaAba(aba?.name ?? '', sdrs.map((s) => s.name));
  const p = perfis.find((x) => x.role !== 'admin' && ehAPessoa(dono, x.name ?? '')) ?? perfis.find((x) => ehAPessoa(dono, x.name ?? ''));
  return p ? { id: p.id, nome: p.name ?? dono } : null;
}

/** Quem recebe notificação: o dono do CRM ARTHUR ou do CRM LUIS CLOSER (ou quem já tem alguma). */
async function recebeNotificacao(userId: string): Promise<boolean> {
  const [sdr, closer] = await Promise.all([donoDaPagina(PAGINA_DO_SDR), donoDaPagina(PAGINA_DO_CLOSER)]);
  if (sdr?.id === userId || closer?.id === userId) return true;
  return !!(await queryOne('SELECT 1 FROM notificacao_destinatarios WHERE user_id = $1 LIMIT 1', [userId]));
}

/** "Abrir card" pra quem está olhando: a lead original, se ele enxerga; senão a cópia que ele enxerga (ex.: o closer). */
async function linksDosCards(cardIds: string[], quemAbre: string, role: string): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (!cardIds.length) return out;
  const allowed = await restrictedBoardFilter(quemAbre, role);
  const linhas = await query<{ id: string; familia: string; page: string; board_id: string; original: boolean }>(
    `SELECT r.id, COALESCE(r.espelho_origem_id, r.copia_ia_origem_id, r.id) AS familia, lb.page, r.board_id,
            (r.espelho_origem_id IS NULL AND r.copia_ia_origem_id IS NULL) AS original
     FROM lead_rows r JOIN lead_boards lb ON lb.id = r.board_id
     WHERE r.deleted_at IS NULL AND NOT lb.is_vendas
       AND (r.id = ANY($1::uuid[]) OR r.espelho_origem_id = ANY($1::uuid[]) OR r.copia_ia_origem_id = ANY($1::uuid[]))`,
    [cardIds]
  );
  for (const id of cardIds) {
    const visiveis = linhas.filter((l) => l.familia === id && (allowed === null || allowed.includes(l.board_id)));
    const escolhida = visiveis.find((l) => l.original) ?? visiveis[0];
    if (escolhida) out.set(id, linkDoCard(escolhida.page, escolhida.id));
  }
  return out;
}

export async function notificacoesRoutes(app: FastifyInstance) {
  // GET /api/notificacoes — as minhas. ?pagina=crm-arthur|crm-ia-luiza|crm-luis-closer (só admin): as do dono daquela
  // aba, só pra olhar.
  app.get<{ Querystring: { pagina?: string } }>('/api/notificacoes', { onRequest: [app.authenticate] }, async (req, reply) => {
    const { sub, role } = req.user as { sub: string; role: string };
    let de = { id: sub, nome: '' };
    let somenteLeitura = false;
    if (req.query.pagina) {
      if (role !== 'admin') return reply.status(403).send({ message: 'Só admin vê o sininho de outra pessoa.' });
      const dono = await donoDaPagina(req.query.pagina);
      if (!dono) return { recebe: false, somente_leitura: true, de: null, nao_lidas: 0, itens: [] };
      de = dono;
      somenteLeitura = dono.id !== sub;
    }
    const recebe = somenteLeitura || (await recebeNotificacao(de.id));
    if (!recebe) return { recebe: false, somente_leitura: somenteLeitura, de, nao_lidas: 0, itens: [] };
    const itens = await query<{
      id: string; tipo: string; titulo: string; mensagem: string; nome: string; telefone: string; ticket_nx: string;
      card_id: string | null; ultima_mensagem_lead: string; resposta_luiza: string; reuniao_em: string | null;
      link_reuniao: string; created_at: string; lida: boolean; popup_fechado: boolean;
    }>(
      `SELECT n.id, n.tipo, n.titulo, n.mensagem, n.nome, n.telefone, n.ticket_nx, n.card_id, n.ultima_mensagem_lead,
              n.resposta_luiza, n.reuniao_em, n.link_reuniao, n.created_at,
              (d.lida_em IS NOT NULL) AS lida, (d.popup_fechado_em IS NOT NULL) AS popup_fechado
       FROM notificacao_destinatarios d JOIN notificacoes n ON n.id = d.notificacao_id
       WHERE d.user_id = $1 AND n.created_at > NOW() - ${JANELA}
       ORDER BY n.created_at DESC LIMIT 100`,
      [de.id]
    );
    const links = await linksDosCards([...new Set(itens.map((i) => i.card_id).filter(Boolean) as string[])], sub, role);
    return {
      recebe: true,
      somente_leitura: somenteLeitura,
      de,
      nao_lidas: itens.filter((i) => !i.lida).length,
      itens: itens.map((i) => ({ ...i, link: i.card_id ? links.get(i.card_id) ?? null : null })),
    };
  });

  // POST /api/notificacoes/:id/lida — { lida: true|false }. Só as minhas: quem só está olhando não marca nada.
  app.post<{ Params: { id: string }; Body: { lida?: unknown } }>(
    '/api/notificacoes/:id/lida', { onRequest: [app.authenticate] },
    async (req, reply) => {
      const { sub } = req.user as { sub: string };
      if (!/^[0-9a-f-]{36}$/i.test(req.params.id)) return reply.status(400).send({ message: 'id inválido.' });
      const lida = req.body?.lida !== false;
      const r = await query(
        `UPDATE notificacao_destinatarios SET lida_em = ${lida ? 'COALESCE(lida_em, NOW())' : 'NULL'}
         WHERE notificacao_id = $1 AND user_id = $2 RETURNING notificacao_id`,
        [req.params.id, sub]
      );
      if (!r.length) return reply.status(404).send({ message: 'Notificação não encontrada pra você.' });
      return { ok: true };
    }
  );

  // POST /api/notificacoes/lidas — marca todas as minhas como lidas.
  app.post('/api/notificacoes/lidas', { onRequest: [app.authenticate] }, async (req) => {
    const { sub } = req.user as { sub: string };
    await query('UPDATE notificacao_destinatarios SET lida_em = NOW() WHERE user_id = $1 AND lida_em IS NULL', [sub]);
    return { ok: true };
  });

  // POST /api/notificacoes/:id/popup-fechado — fechei o popup (NÃO marca como lida: continua no sininho).
  app.post<{ Params: { id: string } }>('/api/notificacoes/:id/popup-fechado', { onRequest: [app.authenticate] }, async (req, reply) => {
    const { sub } = req.user as { sub: string };
    if (!/^[0-9a-f-]{36}$/i.test(req.params.id)) return reply.status(400).send({ message: 'id inválido.' });
    await query(
      `UPDATE notificacao_destinatarios SET popup_fechado_em = COALESCE(popup_fechado_em, NOW())
       WHERE notificacao_id = $1 AND user_id = $2`,
      [req.params.id, sub]
    );
    return { ok: true };
  });
}
