/**
 * SIMULAÇÃO da consolidação dos CRMs (CRM LUIS e CRM LUIS CLOSER -> CRM ARTHUR). Só lê: tudo roda numa transação
 * READ ONLY, então o banco recusa qualquer escrita daqui. Só administrador. A execução não existe nesta rota.
 */
import { FastifyInstance } from 'fastify';
import type { PoolClient } from 'pg';
import { withTransaction } from '../db.js';
import { montarPlano, PAGINA_CLOSER, PAGINA_DESTINO, PAGINAS_PROTEGIDAS, type Aba, type Etiqueta, type Lead, type Quadro } from '../lib/consolidacaoCrm.js';
import { textoDoRelatorio, type ReferenciasDoBanco } from '../lib/consolidacaoCrmTexto.js';
import { restrictedBoardFilter } from './leadBoards.js';
import { agentesPorAba } from './ligacoes3c.js';

const iso = (v: unknown): string => (v instanceof Date ? v.toISOString() : typeof v === 'string' ? v : '');

async function lerTudo(db: PoolClient) {
  const linhas = async <T>(sql: string, params: unknown[] = []) => (await db.query(sql, params)).rows as T[];
  const abas = await linhas<Aba>('SELECT id, name, (archived_at IS NOT NULL) AS arquivada FROM lead_pages');
  const quadros = await linhas<Quadro>('SELECT id, name, page, position FROM lead_boards WHERE NOT is_vendas AND NOT is_contrato');
  const etiquetas = await linhas<Etiqueta>('SELECT field, name, color, page_id FROM lead_labels ORDER BY position');
  // Só as abas envolvidas: destino, closer, CRM LUIS (pelo nome) e as protegidas.
  const envolvidas = abas.filter((a) => [PAGINA_DESTINO, PAGINA_CLOSER, ...PAGINAS_PROTEGIDAS].includes(a.id) || /lu[ií]s/i.test(a.name)).map((a) => a.id);
  const idsQuadros = quadros.filter((q) => envolvidas.includes(q.page)).map((q) => q.id);
  const leads = await linhas<Record<string, unknown> & { id: string }>('SELECT * FROM lead_rows WHERE board_id = ANY($1::uuid[])', [idsQuadros]);
  const ids = leads.map((l) => l.id);

  const movimentos = new Map((await linhas<{ id: string; em: Date }>(
    `SELECT id, max(em) AS em FROM (
       SELECT lead_row_id AS id, moved_at AS em FROM lead_board_history WHERE lead_row_id = ANY($1::uuid[])
       UNION ALL SELECT lead_row_id, created_at FROM lead_events WHERE lead_row_id = ANY($1::uuid[]) AND type IN ('status', 'board')
     ) m GROUP BY id`, [ids])).map((m) => [m.id, m.em]));

  const vinculos = new Map<string, Record<string, number>>();
  const contar = async (rotulo: string, sql: string) => {
    for (const r of await linhas<{ id: string; n: number }>(sql, [ids])) {
      vinculos.set(r.id, { ...(vinculos.get(r.id) ?? {}), [rotulo]: r.n });
    }
  };
  const por = (tabela: string, coluna: string, soma = 'count(*)') =>
    `SELECT ${coluna} AS id, ${soma}::int AS n FROM ${tabela} WHERE ${coluna} = ANY($1::uuid[]) GROUP BY 1`;
  await contar('atualizações', por('lead_notes', 'lead_row_id'));
  await contar('anexos', por('lead_notes', 'lead_row_id', 'sum(jsonb_array_length(attachments))'));
  await contar('eventos', por('lead_events', 'lead_row_id'));
  await contar('reuniões', por('reuniao_resultados', 'lead_row_id'));
  await contar('tarefas', por('reminders', 'crm_card_id'));
  await contar('contratos', por('contracts', 'venda_lead_id'));
  await contar('fichas de cliente', por('clients', 'crm_lead_id'));
  await contar('notificações', por('notificacoes', 'card_id'));
  await contar('vendas', por('lead_rows', 'venda_origem_id'));
  await contar('comissões', por('commission_entries', 'lead_row_id'));

  const completos: Lead[] = leads.map((l) => {
    const momentos = [movimentos.get(l.id), l.entrou_coluna_em, l.created_at].map((v) => Date.parse(iso(v))).filter((n) => !Number.isNaN(n));
    return {
      ...l,
      id: l.id, board_id: String(l.board_id), deleted_at: l.deleted_at,
      movido_em: momentos.length ? new Date(Math.max(...momentos)).toISOString() : null,
      vinculos: vinculos.get(l.id) ?? {},
    };
  });
  return { abas, quadros, etiquetas, leads: completos };
}

/** O que existe no banco ligado ao Arthur (e o acesso do Luis). */
async function referencias(db: PoolClient): Promise<Omit<ReferenciasDoBanco, 'pessoas'> & { perfis: { id: string; name: string; role: string }[] }> {
  const linhas = async <T>(sql: string, params: unknown[] = []) => (await db.query(sql, params)).rows as T[];
  const perfis = await linhas<{ id: string; name: string; role: string }>(
    `SELECT id, COALESCE(name, email) AS name, role FROM profiles WHERE lower(COALESCE(name, '')) ~ '^(arthur|lu[ií]s)' ORDER BY name`);
  const doArthur = perfis.filter((p) => /^arthur/i.test(p.name)).map((p) => p.id);
  const quantos = async (sql: string, params: unknown[]) => (await linhas<{ n: number }>(sql, params))[0]?.n ?? 0;
  const itens: ReferenciasDoBanco['doArthur'] = [];
  const item = async (nome: string, sql: string, aoExcluirOUsuario: 'apaga' | 'mantém', params: unknown[] = [doArthur]) =>
    itens.push({ item: nome, quantos: await quantos(sql, params), aoExcluirOUsuario });
  const doUsuario = (tabela: string, coluna = 'user_id') => `SELECT count(*)::int AS n FROM ${tabela} WHERE ${coluna} = ANY($1::uuid[])`;
  await item('lembretes e tarefas dele', doUsuario('reminders'), 'apaga');
  await item('notificações recebidas', doUsuario('notificacao_destinatarios'), 'apaga');
  await item('acessos a abas', doUsuario('user_page_access'), 'apaga');
  await item('aparelhos com notificação', doUsuario('push_subscriptions'), 'apaga');
  await item('resultados de reunião registrados por ele (o nome fica)', doUsuario('reuniao_resultados'), 'mantém');
  await item('leads com SDR Arthur', `SELECT count(*)::int AS n FROM lead_rows WHERE sdr ~* '^arthur' AND deleted_at IS NULL`, 'mantém', []);
  await item('atualizações assinadas por ele', `SELECT count(*)::int AS n FROM lead_notes WHERE author_name ~* '^arthur'`, 'mantém', []);
  const rotina = await linhas<{ pagina: string; blocos: number }>(
    'SELECT pagina, count(*)::int AS blocos FROM rotina_blocos WHERE removido_em IS NULL GROUP BY pagina ORDER BY pagina');
  const ambiente = [
    ...[...agentesPorAba()].map(([aba, nome]) => ({ variavel: 'THREEC_AGENTES', valor: `${aba}=${nome}` })),
    ...(process.env.LEAD_WELCOME_SENDER ? [{ variavel: 'LEAD_WELCOME_SENDER', valor: process.env.LEAD_WELCOME_SENDER }] : []),
  ];
  return { perfis, doArthur: itens, rotina, ambiente };
}

export async function consolidacaoCrmRoutes(app: FastifyInstance) {
  app.get('/api/admin/consolidacao-crm/simulacao', { onRequest: [app.authenticate] }, async (req, reply) => {
    const { role } = req.user as { role?: string };
    if (role !== 'admin') return reply.status(403).send({ message: 'Só administrador.' });

    const { dados, refs } = await withTransaction(async (db) => {
      await db.query('SET TRANSACTION READ ONLY');
      return { dados: await lerTudo(db), refs: await referencias(db) };
    });
    const plano = montarPlano(dados);
    const quadrosDoDestino = new Set(dados.quadros.filter((q) => q.page === PAGINA_DESTINO).map((q) => q.id));
    const pessoas: ReferenciasDoBanco['pessoas'] = [];
    for (const p of refs.perfis) {
      const permitidos = await restrictedBoardFilter(p.id, p.role);
      pessoas.push({ nome: p.name, papel: p.role, veODestino: permitidos === null || permitidos.some((id) => quadrosDoDestino.has(id)) });
    }
    const geradoEm = new Date().toISOString();
    const referenciasDoBanco: ReferenciasDoBanco = { pessoas, doArthur: refs.doArthur, rotina: refs.rotina, ambiente: refs.ambiente };
    return { geradoEm, plano, referencias: referenciasDoBanco, texto: textoDoRelatorio(plano, referenciasDoBanco, geradoEm) };
  });
}
