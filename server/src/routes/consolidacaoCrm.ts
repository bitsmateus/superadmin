/**
 * Consolidação dos CRMs (CRM LUIS e CRM LUIS CLOSER -> CRM ARTHUR), só administrador.
 *  - SIMULAÇÃO: só lê (transação READ ONLY, o banco recusa qualquer escrita) e devolve o plano e a assinatura dele.
 *  - EXECUÇÃO: só com a assinatura da simulação aprovada e a confirmação digitada; ver lib/consolidacaoExecucao.ts.
 */
import { FastifyInstance } from 'fastify';
import type { PoolClient } from 'pg';
import { queryOne, withTransaction } from '../db.js';
import {
  assinaturaDoPlano, conflitosDeVinculo, ErroDaConsolidacao, executarConsolidacao, textoDoResultado, textoDosConflitos, type ResultadoDaExecucao,
} from '../lib/consolidacaoExecucao.js';
import { montarPlano, PAGINA_CLOSER, PAGINA_DESTINO, PAGINAS_PROTEGIDAS, type Aba, type Etiqueta, type Lead, type Quadro } from '../lib/consolidacaoCrm.js';
import { textoDoRelatorio, type ReferenciasDoBanco } from '../lib/consolidacaoCrmTexto.js';
import { restrictedBoardFilter } from './leadBoards.js';
import { crmConsolidado } from '../lib/crmConsolidado.js';
import { ABAS_SUBSTITUIDAS, MOTIVO_DA_CONSOLIDACAO } from '../lib/regrasDaConsolidacao.js';
import { agentesPorAba } from './ligacoes3c.js';

const iso = (v: unknown): string => (v instanceof Date ? v.toISOString() : typeof v === 'string' ? v : '');

export async function lerTudo(db: PoolClient) {
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
  const item = async (nome: string, sql: string, params: unknown[] = [doArthur]) =>
    itens.push({ item: nome, quantos: await quantos(sql, params) });
  const doUsuario = (tabela: string, coluna = 'user_id') => `SELECT count(*)::int AS n FROM ${tabela} WHERE ${coluna} = ANY($1::uuid[])`;
  await item('lembretes e tarefas dele', doUsuario('reminders'));
  await item('notificações recebidas', doUsuario('notificacao_destinatarios'));
  await item('acessos a abas', doUsuario('user_page_access'));
  await item('resultados de reunião registrados por ele', doUsuario('reuniao_resultados'));
  await item('leads com SDR Arthur', `SELECT count(*)::int AS n FROM lead_rows WHERE sdr ~* '^arthur' AND deleted_at IS NULL`, []);
  await item('atualizações assinadas por ele', `SELECT count(*)::int AS n FROM lead_notes WHERE author_name ~* '^arthur'`, []);
  const ambiente = [
    ...[...agentesPorAba()].map(([aba, nome]) => ({ variavel: 'THREEC_AGENTES', valor: `${aba}=${nome}` })),
    ...(process.env.LEAD_WELCOME_SENDER ? [{ variavel: 'LEAD_WELCOME_SENDER', valor: process.env.LEAD_WELCOME_SENDER }] : []),
  ];
  return { perfis, doArthur: itens, ambiente };
}

interface AbaAntiga {
  id: string; nome: string; existe: boolean; arquivada: boolean;
  ativos: number; arquivadosNaConsolidacao: number; naLixeira: number; quadros: number;
}

/** Situação das abas que foram pro CRM unificado e o que impede arquivá-las. Só lê. */
async function situacaoDasAbasAntigas(db: PoolClient): Promise<{ abas: AbaAntiga[]; bloqueios: string[] }> {
  const linhas = async <T>(sql: string, params: unknown[] = []) => (await db.query(sql, params)).rows as T[];
  const abas = await linhas<AbaAntiga>(
    `SELECT a.id, COALESCE(p.name, a.id) AS nome, (p.id IS NOT NULL) AS existe, (p.archived_at IS NOT NULL) AS arquivada,
       (SELECT count(*)::int FROM lead_rows r JOIN lead_boards b ON b.id = r.board_id WHERE b.page = a.id AND r.deleted_at IS NULL) AS ativos,
       (SELECT count(*)::int FROM lead_rows r JOIN lead_boards b ON b.id = r.board_id WHERE b.page = a.id AND r.deleted_at IS NOT NULL
          AND r.delete_reason LIKE $2 || '%') AS "arquivadosNaConsolidacao",
       (SELECT count(*)::int FROM lead_rows r JOIN lead_boards b ON b.id = r.board_id WHERE b.page = a.id AND r.deleted_at IS NOT NULL
          AND COALESCE(r.delete_reason, '') NOT LIKE $2 || '%') AS "naLixeira",
       (SELECT count(*)::int FROM lead_boards b WHERE b.page = a.id) AS quadros
     FROM unnest($1::text[]) AS a(id) LEFT JOIN lead_pages p ON p.id = a.id`, [ABAS_SUBSTITUIDAS, MOTIVO_DA_CONSOLIDACAO]);
  const bloqueios: string[] = [];
  if (!(await linhas('SELECT 1 FROM crm_consolidacao')).length) bloqueios.push('A consolidação ainda não foi executada.');
  for (const a of abas) {
    if (!a.existe) bloqueios.push(`A aba ${a.id} não existe.`);
    if (a.ativos) bloqueios.push(`${a.nome}: ainda tem ${a.ativos} card(s) ativo(s).`);
  }
  const financeiros = await linhas<{ page: string; name: string }>(
    'SELECT page, name FROM lead_boards WHERE page = ANY($1) AND (is_vendas OR is_contrato)', [ABAS_SUBSTITUIDAS]);
  for (const f of financeiros) bloqueios.push(`${f.page}: tem o quadro de Vendas/Contrato "${f.name}" (sumiria do Financeiro).`);
  // O webhook do Meta Ads pode estar fixado num quadro (META_LEADS_BOARD_ID): numa aba arquivada, ele para de criar leads.
  const quadroDoMeta = process.env.META_LEADS_BOARD_ID;
  if (quadroDoMeta && (await linhas('SELECT 1 FROM lead_boards WHERE id::text = $1 AND page = ANY($2)', [quadroDoMeta, ABAS_SUBSTITUIDAS])).length) {
    bloqueios.push('META_LEADS_BOARD_ID aponta pra um quadro dessas abas: os leads do Meta Ads parariam de entrar.');
  }
  return { abas, bloqueios };
}

export async function consolidacaoCrmRoutes(app: FastifyInstance) {
  // Abas antigas (CRM LUIS e CRM LUIS CLOSER): ver a situação, arquivar (esconde da barra lateral, mantém tudo no banco)
  // e desarquivar. Só administrador.
  const soAdmin = (req: { user: unknown }) => (req.user as { role?: string }).role === 'admin';
  app.get('/api/admin/consolidacao-crm/abas-antigas', { onRequest: [app.authenticate] }, async (req, reply) => {
    if (!soAdmin(req)) return reply.status(403).send({ message: 'Só administrador.' });
    return withTransaction(async (db) => {
      await db.query('SET TRANSACTION READ ONLY');
      return situacaoDasAbasAntigas(db);
    });
  });
  app.post('/api/admin/consolidacao-crm/abas-antigas/arquivar', { onRequest: [app.authenticate] }, async (req, reply) => {
    if (!soAdmin(req)) return reply.status(403).send({ message: 'Só administrador.' });
    const r = await withTransaction(async (db) => {
      // Ninguém cria card nessas abas no meio da conferência.
      await db.query('LOCK TABLE lead_rows IN SHARE ROW EXCLUSIVE MODE');
      const s = await situacaoDasAbasAntigas(db);
      if (s.bloqueios.length) return { erro: s.bloqueios.join(' | ') };
      await db.query('UPDATE lead_pages SET archived_at = NOW() WHERE id = ANY($1) AND archived_at IS NULL', [ABAS_SUBSTITUIDAS]);
      return situacaoDasAbasAntigas(db);
    });
    if ('erro' in r) return reply.status(409).send({ message: `Não arquivei nada: ${r.erro}` });
    return r;
  });
  app.post('/api/admin/consolidacao-crm/abas-antigas/desarquivar', { onRequest: [app.authenticate] }, async (req, reply) => {
    if (!soAdmin(req)) return reply.status(403).send({ message: 'Só administrador.' });
    return withTransaction(async (db) => {
      await db.query('UPDATE lead_pages SET archived_at = NULL WHERE id = ANY($1) AND archived_at IS NOT NULL', [ABAS_SUBSTITUIDAS]);
      return situacaoDasAbasAntigas(db);
    });
  });

  // A tela precisa saber qual aba é a do closer (muda quando a consolidação é executada).
  app.get('/api/crm/consolidacao', { onRequest: [app.authenticate] }, async () => ({ consolidado: await crmConsolidado() }));

  app.get('/api/admin/consolidacao-crm/simulacao', { onRequest: [app.authenticate] }, async (req, reply) => {
    const { role } = req.user as { role?: string };
    if (role !== 'admin') return reply.status(403).send({ message: 'Só administrador.' });

    const { dados, refs, plano, conflitos } = await withTransaction(async (db) => {
      await db.query('SET TRANSACTION READ ONLY');
      const lidos = await lerTudo(db);
      const p = montarPlano(lidos);
      return {
        dados: lidos, refs: await referencias(db), plano: p,
        conflitos: await conflitosDeVinculo(db, p.acoes.juntar, 'antes'),
      };
    });
    const quadrosDoDestino = new Set(dados.quadros.filter((q) => q.page === PAGINA_DESTINO).map((q) => q.id));
    const pessoas: ReferenciasDoBanco['pessoas'] = [];
    for (const p of refs.perfis) {
      const permitidos = await restrictedBoardFilter(p.id, p.role);
      pessoas.push({ nome: p.name, papel: p.role, veODestino: permitidos === null || permitidos.some((id) => quadrosDoDestino.has(id)) });
    }
    const geradoEm = new Date().toISOString();
    const referenciasDoBanco: ReferenciasDoBanco = { pessoas, doArthur: refs.doArthur, ambiente: refs.ambiente };
    const assinatura = assinaturaDoPlano(plano);
    const textoConflitos = [
      `## Conflito de reunião/venda (${conflitos.length}) — o card que fica já tem um, então este continua ligado ao card arquivado`,
      ...textoDosConflitos(conflitos),
    ].join('\n');
    return {
      geradoEm, plano, assinatura, conflitos, referencias: referenciasDoBanco,
      texto: `${textoDoRelatorio(plano, referenciasDoBanco, geradoEm)}\n\n${textoConflitos}\n\nAssinatura deste plano: ${assinatura}`,
    };
  });

  // GET — já foi executada? (e o resultado, se sim)
  app.get('/api/admin/consolidacao-crm/estado', { onRequest: [app.authenticate] }, async (req, reply) => {
    const { role } = req.user as { role?: string };
    if (role !== 'admin') return reply.status(403).send({ message: 'Só administrador.' });
    const r = await queryOne<{ resultado: ResultadoDaExecucao | null }>('SELECT resultado FROM crm_consolidacao');
    return r ? { executada: true, texto: r.resultado ? textoDoResultado(r.resultado) : 'Executada.' } : { executada: false };
  });

  // POST { assinatura, confirmacao: 'CONSOLIDAR' } — executa numa transação só. Qualquer falha desfaz tudo.
  app.post<{ Body: { assinatura?: string; confirmacao?: string } }>(
    '/api/admin/consolidacao-crm/executar', { onRequest: [app.authenticate] }, async (req, reply) => {
      const { role, sub } = req.user as { role?: string; sub: string };
      if (role !== 'admin') return reply.status(403).send({ message: 'Só administrador.' });
      if (req.body?.confirmacao !== 'CONSOLIDAR') return reply.status(400).send({ message: 'Digite CONSOLIDAR pra confirmar.' });
      if (!req.body?.assinatura) return reply.status(400).send({ message: 'Rode a simulação antes (falta a assinatura).' });
      const perfil = await queryOne<{ name: string | null; email: string }>('SELECT name, email FROM profiles WHERE id = $1', [sub]);
      try {
        const resultado = await withTransaction((db) => executarConsolidacao(db, lerTudo, {
          assinatura: req.body.assinatura!, por: perfil?.name || perfil?.email || 'admin',
        }));
        return { resultado, texto: textoDoResultado(resultado) };
      } catch (err) {
        if (err instanceof ErroDaConsolidacao) return reply.status(409).send({ message: err.message });
        req.log.error({ err }, '[consolidacao] falha ao executar — nada foi gravado');
        return reply.status(500).send({ message: `Falhou e nada foi gravado: ${err instanceof Error ? err.message : 'erro'}` });
      }
    },
  );
}
