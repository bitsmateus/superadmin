import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import crypto from 'node:crypto';
import { query, queryOne, withTransaction } from '../db.js';
import { renderFullHtmlToPdf } from '../lib/htmlPdf.js';
import { montarHtmlRelatorio, type GcSnapshot } from '../lib/gcRelatorioHtml.js';

/**
 * Módulo "Clientes NX Digital" — gestão dos clientes de tráfego.
 *
 * Ilhado de propósito: só mexe nas tabelas `gc_*` (ver src/db/gestaoClientes.ts). Não lê nem
 * escreve em `clients`, `contracts`, ficha de cadastro ou vendas — quem usa esta tela tem um
 * cadastro próprio, e a ligação com o cadastro antigo fica pra depois (coluna
 * `gc_clientes.cliente_externo_id`, hoje sempre NULL).
 *
 * Rotas sob /api/gc/*.
 */

/** Só deixa passar as colunas que a tela realmente edita — o resto do body é ignorado. */
const CAMPOS_CLIENTE = [
  'nome_empresa', 'nome_contato', 'whatsapp_contato', 'email_contato', 'cnpj', 'cidade',
  'segmento', 'logo_url', 'responsavel_id', 'status', 'prioridade', 'fora_dos_totais',
  'data_inicio', 'observacoes_gerais',
] as const;

const CAMPOS_SERVICO = [
  'tipo', 'descricao_plano', 'investimento_previsto_mensal', 'data_inicio', 'data_renovacao', 'status',
] as const;

/** Monta `SET a = $1, b = $2` só com os campos presentes no body. */
function montarUpdate(
  permitidos: readonly string[],
  body: Record<string, unknown>,
  inicioEm = 1
): { sets: string[]; params: unknown[] } {
  const sets: string[] = [];
  const params: unknown[] = [];
  let i = inicioEm;
  for (const campo of permitidos) {
    if (body[campo] === undefined) continue;
    // Campo de data/UUID vazio na tela significa "sem valor", não string vazia: o Postgres
    // recusaria '' num DATE/UUID.
    sets.push(`${campo} = $${i++}`);
    params.push(body[campo] === '' ? null : body[campo]);
  }
  return { sets, params };
}

/** O que `withTransaction` entrega e o que a criação da jornada precisa dele. */
type ClienteSql = { query: (sql: string, params?: unknown[]) => Promise<{ rows: any[] }> };

/**
 * Copia a jornada modelo pro cliente novo. O nome da etapa é COPIADO (não referenciado): renomear
 * a etapa padrão amanhã não reescreve o histórico de quem já passou por ela.
 */
async function criarJornadaDoCliente(client: ClienteSql, clienteId: string) {
  const { rows: etapas } = await client.query(
    'SELECT id, nome, ordem FROM gc_jornada_etapas_modelo WHERE ativo ORDER BY ordem, created_at'
  );
  for (const [indice, etapa] of etapas.entries()) {
    const { rows: criada } = await client.query(
      `INSERT INTO gc_cliente_jornada (gc_cliente_id, etapa_id, nome, ordem, status)
       VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      // A primeira etapa já nasce em andamento: cliente novo está, por definição, nela.
      [clienteId, etapa.id, etapa.nome, etapa.ordem, indice === 0 ? 'em_andamento' : 'pendente']
    );
    const { rows: itens } = await client.query(
      `SELECT titulo, ordem FROM gc_checklist_modelo_itens
       WHERE etapa_modelo_id = $1 AND ativo ORDER BY ordem, created_at`,
      [etapa.id]
    );
    for (const item of itens) {
      await client.query(
        `INSERT INTO gc_checklist_itens (gc_cliente_id, gc_cliente_jornada_id, titulo, ordem)
         VALUES ($1, $2, $3, $4)`,
        [clienteId, criada[0].id, item.titulo, item.ordem]
      );
    }
  }
  return etapas.length;
}

/** Registra um evento automático no histórico do cliente (aparece junto das notas do time). */
async function registrarEvento(clienteId: string, titulo: string, descricao = '', autorId?: string) {
  await query(
    `INSERT INTO gc_historico (gc_cliente_id, tipo, titulo, descricao, autor_id)
     VALUES ($1, 'evento_sistema', $2, $3, $4)`,
    [clienteId, titulo, descricao, autorId ?? null]
  );
}

/** Põe a próxima etapa pendente do cliente em andamento — a jornada anda sozinha. */
async function abrirProximaEtapa(clienteId: string) {
  await query(
    `UPDATE gc_cliente_jornada SET status = 'em_andamento', updated_at = NOW()
     WHERE id = (
       SELECT id FROM gc_cliente_jornada
       WHERE gc_cliente_id = $1 AND status = 'pendente'
       ORDER BY ordem, created_at LIMIT 1
     )`,
    [clienteId]
  );
}

/**
 * Mantém o status da etapa coerente com o checklist dela: todos os itens feitos = concluída,
 * algum feito = em andamento, nenhum = pendente. Só roda quando o gatilho foi um item do
 * checklist — quem mexeu no status da etapa à mão não é atropelado.
 */
async function recalcularEtapa(etapaId: string, autorId?: string) {
  const etapa = await queryOne<{ gc_cliente_id: string; nome: string; status: string }>(
    'SELECT gc_cliente_id, nome, status FROM gc_cliente_jornada WHERE id = $1',
    [etapaId]
  );
  if (!etapa) return;
  const contagem = await queryOne<{ total: string; feitos: string }>(
    `SELECT count(*) AS total, count(*) FILTER (WHERE concluido) AS feitos
     FROM gc_checklist_itens WHERE gc_cliente_jornada_id = $1`,
    [etapaId]
  );
  const total = Number(contagem?.total ?? 0);
  const feitos = Number(contagem?.feitos ?? 0);
  // Etapa sem checklist nenhum fica como a pessoa deixou: não há o que inferir.
  if (total === 0) return;

  const novo = feitos === total ? 'concluida' : feitos > 0 ? 'em_andamento' : 'pendente';
  if (novo === etapa.status) return;

  await query(
    `UPDATE gc_cliente_jornada
     SET status = $1,
         concluida_em = CASE WHEN $1 = 'concluida' THEN NOW() ELSE NULL END,
         updated_at = NOW()
     WHERE id = $2`,
    [novo, etapaId]
  );
  if (novo === 'concluida') {
    await registrarEvento(etapa.gc_cliente_id, `Etapa concluída: ${etapa.nome}`, '', autorId);
    await abrirProximaEtapa(etapa.gc_cliente_id);
  }
}

/**
 * Hoje e o começo do mês em horário de Brasília, não em UTC. Comparar prazo com `CURRENT_DATE`
 * (UTC) joga a virada do dia pras 21h e faz item vencer antes da hora — o mesmo erro que já tinha
 * dado nas métricas do comercial.
 */
const HOJE = `(NOW() AT TIME ZONE 'America/Sao_Paulo')::date`;

/** Pacote de métricas de um mês, pivotado ({ leads: 42 }). `$n` é o primeiro dia do mês. */
function pivotMetricas(parametro: string): string {
  return `COALESCE((
    SELECT json_object_agg(m.chave, m.valor) FROM gc_metricas m
    WHERE m.gc_cliente_id = c.id
      AND m.periodo_inicio = ${parametro}::date
      AND m.periodo_fim = (date_trunc('month', ${parametro}::date) + INTERVAL '1 month - 1 day')::date
  ), '{}'::json)`;
}

/**
 * A consulta das telas de lista e de Tráfego. Além do cadastro, traz TUDO o que o semáforo de
 * saúde precisa (atrasos, último contato, último relatório, números do mês e do mês anterior,
 * metas) — numa consulta só, porque o semáforo tem que estar na lista, e um pedido por cliente
 * ali seriam dezenas de chamadas.
 *
 * `$1` é o primeiro dia do mês de referência; `$2`, o do mês anterior.
 */
const SQL_CLIENTES = `
  SELECT c.*, p.name AS responsavel_nome,
    (SELECT j.nome FROM gc_cliente_jornada j
      WHERE j.gc_cliente_id = c.id AND j.status <> 'concluida'
      ORDER BY j.ordem, j.created_at LIMIT 1) AS etapa_atual,
    (SELECT count(*) FROM gc_cliente_jornada j WHERE j.gc_cliente_id = c.id) AS etapas_total,
    (SELECT count(*) FROM gc_cliente_jornada j
      WHERE j.gc_cliente_id = c.id AND j.status = 'concluida') AS etapas_concluidas,
    (SELECT count(*) FROM gc_cliente_jornada j
      WHERE j.gc_cliente_id = c.id AND j.status <> 'concluida' AND j.prazo IS NOT NULL
        AND j.prazo < ${HOJE}) AS etapas_atrasadas,
    (SELECT count(*) FROM gc_checklist_itens i WHERE i.gc_cliente_id = c.id) AS itens_total,
    (SELECT count(*) FROM gc_checklist_itens i
      WHERE i.gc_cliente_id = c.id AND i.concluido) AS itens_concluidos,
    (SELECT count(*) FROM gc_checklist_itens i
      WHERE i.gc_cliente_id = c.id AND NOT i.concluido
        AND i.prazo IS NOT NULL AND i.prazo < ${HOJE}) AS itens_atrasados,
    -- Último contato = o que uma PESSOA registrou. Evento do sistema não conta: "etapa concluída"
    -- não é conversa com o cliente, e contar isso faria um cliente abandonado parecer ativo.
    (SELECT max(h.created_at) FROM gc_historico h
      WHERE h.gc_cliente_id = c.id AND h.tipo <> 'evento_sistema') AS ultimo_contato,
    (SELECT max(r.periodo_inicio) FROM gc_relatorios r
      WHERE r.gc_cliente_id = c.id AND r.status = 'publicado') AS ultimo_relatorio,
    COALESCE((SELECT json_agg(json_build_object(
        'id', s.id, 'tipo', s.tipo, 'status', s.status,
        'investimento_previsto_mensal', s.investimento_previsto_mensal,
        'data_renovacao', s.data_renovacao
      ) ORDER BY s.created_at)
      FROM gc_servicos s WHERE s.gc_cliente_id = c.id), '[]'::json) AS servicos,
    COALESCE((SELECT json_agg(json_build_object(
        'id', g.id, 'chave_metrica', g.chave_metrica, 'horizonte', g.horizonte,
        'valor_base', g.valor_base, 'valor_meta', g.valor_meta, 'prazo', g.prazo,
        'data_base', g.data_base, 'status', g.status
      ) ORDER BY g.created_at)
      FROM gc_metas g WHERE g.gc_cliente_id = c.id), '[]'::json) AS metas,
    ${pivotMetricas('$1')} AS metricas_mes,
    ${pivotMetricas('$2')} AS metricas_mes_anterior,
    (SELECT json_build_object(
        'nivel', a.nivel, 'comentario', a.comentario, 'atualizado_em', a.updated_at,
        'autor_nome', pa.name, 'periodo_inicio', a.periodo_inicio)
      FROM gc_avaliacoes a
      LEFT JOIN profiles pa ON pa.id = a.autor_id
      WHERE a.gc_cliente_id = c.id AND a.periodo_inicio = $1::date) AS avaliacao
  FROM gc_clientes c
  LEFT JOIN profiles p ON p.id = c.responsavel_id`;

/** O mês de hoje em Brasília, 'YYYY-MM'. Em UTC, de madrugada o mês podia ser o seguinte. */
function mesDeHoje(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
  }).format(new Date());
}

/** 'YYYY-MM' → primeiro dia daquele mês e do mês anterior. Sem mês, usa o de hoje em Brasília. */
function mesesDeReferencia(periodo?: string): [string, string] {
  const mes = /^\d{4}-\d{2}$/.test(periodo ?? '') ? periodo! : mesDeHoje();
  const [ano, m] = mes.split('-').map(Number);
  const anterior = m === 1 ? `${ano - 1}-12` : `${ano}-${String(m - 1).padStart(2, '0')}`;
  return [`${mes}-01`, `${anterior}-01`];
}

/**
 * Usuário com acesso restrito só entra no módulo se a chave "nxdigital" estiver liberada pra ele
 * (Equipe → Permissões). Esconder o menu não basta: sem esta checagem, quem conhece a URL da API
 * leria os clientes de tráfego mesmo sem ver o item no menu.
 */
async function podeUsarModulo(userId: string, role: string): Promise<boolean> {
  if (role === 'admin') return true;
  const perfil = await queryOne<{ restrict_access: boolean }>(
    'SELECT restrict_access FROM profiles WHERE id = $1',
    [userId]
  );
  if (!perfil?.restrict_access) return true;
  const chave = await queryOne(
    `SELECT 1 FROM user_menu_access WHERE user_id = $1 AND menu_key = 'nxdigital'`,
    [userId]
  );
  return !!chave;
}

export async function gestaoClientesRoutes(app: FastifyInstance) {
  const autenticado = {
    onRequest: [
      app.authenticate,
      async (req: FastifyRequest, reply: FastifyReply) => {
        const { sub, role } = req.user as { sub: string; role: string };
        if (!(await podeUsarModulo(sub, role))) {
          return reply.status(403).send({ message: 'Sem acesso ao módulo NX DIGITAL' });
        }
      },
    ],
  };

  // ------------------------------------------------------------------ modelos
  // GET /api/gc/modelos — jornada padrão e estratégias prontas, pra montar os seletores da tela.
  app.get('/api/gc/modelos', autenticado, async () => {
    const etapas = await query(
      `SELECT e.*, COALESCE(
         (SELECT json_agg(json_build_object('id', i.id, 'titulo', i.titulo, 'ordem', i.ordem) ORDER BY i.ordem)
          FROM gc_checklist_modelo_itens i WHERE i.etapa_modelo_id = e.id AND i.ativo),
         '[]'::json) AS itens
       FROM gc_jornada_etapas_modelo e WHERE e.ativo ORDER BY e.ordem, e.created_at`
    );
    const estrategias = await query(
      `SELECT e.*, COALESCE(
         (SELECT json_agg(json_build_object('id', i.id, 'titulo', i.titulo, 'ordem', i.ordem) ORDER BY i.ordem)
          FROM gc_estrategias_modelo_itens i WHERE i.estrategia_modelo_id = e.id),
         '[]'::json) AS passos
       FROM gc_estrategias_modelo e WHERE e.ativo ORDER BY e.nome`
    );
    return { etapas, estrategias };
  });

  // ------------------------------------------------------------------ clientes
  // GET /api/gc/clientes?periodo=YYYY-MM — lista da tela, com o que o semáforo precisa. São poucas
  // dezenas de clientes, então não vale paginar: a tela filtra no front igual ao resto do painel.
  app.get<{ Querystring: { periodo?: string } }>('/api/gc/clientes', autenticado, async (req) => {
    const [mes, anterior] = mesesDeReferencia(req.query.periodo);
    return query(`${SQL_CLIENTES} ORDER BY c.nome_empresa`, [mes, anterior]);
  });

  // GET /api/gc/clientes/:id — tudo do cliente numa tacada: a tela de detalhe abre as abas
  // Visão geral, Jornada, Estratégias e Histórico sem ida e volta ao servidor.
  app.get<{ Params: { id: string } }>('/api/gc/clientes/:id', autenticado, async (req, reply) => {
    // A MESMA consulta da lista, filtrada num cliente: o detalhe mostra o semáforo, e ele tem que
    // sair igualzinho ao da lista — dois caminhos pro mesmo cálculo é como eles se separam.
    const [mes, anterior] = mesesDeReferencia();
    const cliente = await queryOne(`${SQL_CLIENTES} WHERE c.id = $3`, [mes, anterior, req.params.id]);
    if (!cliente) return reply.status(404).send({ message: 'Cliente não encontrado' });

    const [servicos, jornada, estrategias, historico] = await Promise.all([
      query('SELECT * FROM gc_servicos WHERE gc_cliente_id = $1 ORDER BY created_at', [req.params.id]),
      query(
        `SELECT j.*, p.name AS responsavel_nome, COALESCE(
           (SELECT json_agg(json_build_object(
               'id', i.id, 'titulo', i.titulo, 'ordem', i.ordem, 'concluido', i.concluido,
               'concluido_em', i.concluido_em, 'prazo', i.prazo, 'responsavel_id', i.responsavel_id
             ) ORDER BY i.ordem, i.created_at)
            FROM gc_checklist_itens i WHERE i.gc_cliente_jornada_id = j.id),
           '[]'::json) AS itens
         FROM gc_cliente_jornada j
         LEFT JOIN profiles p ON p.id = j.responsavel_id
         WHERE j.gc_cliente_id = $1 ORDER BY j.ordem, j.created_at`,
        [req.params.id]
      ),
      query(
        `SELECT e.*, p.name AS responsavel_nome, COALESCE(
           (SELECT json_agg(json_build_object(
               'id', i.id, 'titulo', i.titulo, 'ordem', i.ordem, 'concluido', i.concluido,
               'concluido_em', i.concluido_em, 'prazo', i.prazo
             ) ORDER BY i.ordem, i.created_at)
            FROM gc_checklist_itens i WHERE i.gc_cliente_estrategia_id = e.id),
           '[]'::json) AS itens
         FROM gc_cliente_estrategias e
         LEFT JOIN profiles p ON p.id = e.responsavel_id
         WHERE e.gc_cliente_id = $1 ORDER BY e.created_at DESC`,
        [req.params.id]
      ),
      query(
        `SELECT h.*, p.name AS autor_nome
         FROM gc_historico h LEFT JOIN profiles p ON p.id = h.autor_id
         WHERE h.gc_cliente_id = $1
         ORDER BY h.fixado DESC, h.created_at DESC`,
        [req.params.id]
      ),
    ]);

    return { cliente, servicos, jornada, estrategias, historico };
  });

  // POST /api/gc/clientes — cria o cliente E a jornada dele na mesma transação. Cliente sem
  // jornada não serve pra nada nesta tela, então os dois nascem juntos ou nenhum nasce.
  app.post<{ Body: Record<string, unknown> }>('/api/gc/clientes', autenticado, async (req, reply) => {
    const { sub } = req.user as { sub: string };
    const body = req.body ?? {};
    const nome = String(body.nome_empresa ?? '').trim();
    if (!nome) return reply.status(400).send({ message: 'nome_empresa é obrigatório' });

    const criado = await withTransaction(async (client) => {
      const campos = CAMPOS_CLIENTE.filter((c) => body[c] !== undefined);
      const valores = campos.map((c) => (body[c] === '' ? null : body[c]));
      const { rows } = await client.query(
        `INSERT INTO gc_clientes (${campos.join(', ')})
         VALUES (${campos.map((_, i) => `$${i + 1}`).join(', ')})
         RETURNING *`,
        valores
      );
      await criarJornadaDoCliente(client, rows[0].id);
      return rows[0];
    });

    await registrarEvento(criado.id, 'Cliente cadastrado', '', sub);
    return reply.status(201).send(criado);
  });

  // PATCH /api/gc/clientes/:id
  app.patch<{ Params: { id: string }; Body: Record<string, unknown> }>(
    '/api/gc/clientes/:id',
    autenticado,
    async (req, reply) => {
      const { sub } = req.user as { sub: string };
      const anterior = await queryOne<{ status: string }>(
        'SELECT status FROM gc_clientes WHERE id = $1',
        [req.params.id]
      );
      if (!anterior) return reply.status(404).send({ message: 'Cliente não encontrado' });

      const { sets, params } = montarUpdate(CAMPOS_CLIENTE, req.body ?? {});
      if (!sets.length) return reply.status(400).send({ message: 'Nada para atualizar' });
      params.push(req.params.id);
      const atualizado = await queryOne(
        `UPDATE gc_clientes SET ${sets.join(', ')}, updated_at = NOW()
         WHERE id = $${params.length} RETURNING *`,
        params
      );

      const novoStatus = (req.body ?? {}).status;
      if (typeof novoStatus === 'string' && novoStatus !== anterior.status) {
        await registrarEvento(req.params.id, `Status do cliente: ${anterior.status} → ${novoStatus}`, '', sub);
      }
      return atualizado;
    }
  );

  // DELETE /api/gc/clientes/:id — leva jornada, checklist, métricas e histórico com ele (cascade).
  // Cliente que saiu da base mas precisa continuar aparecendo vira status 'encerrado', não DELETE.
  app.delete<{ Params: { id: string } }>('/api/gc/clientes/:id', autenticado, async (req, reply) => {
    const apagado = await queryOne('DELETE FROM gc_clientes WHERE id = $1 RETURNING id', [req.params.id]);
    if (!apagado) return reply.status(404).send({ message: 'Cliente não encontrado' });
    return reply.status(204).send();
  });

  // ------------------------------------------------------------------ serviços
  app.post<{ Params: { id: string }; Body: Record<string, unknown> }>(
    '/api/gc/clientes/:id/servicos',
    autenticado,
    async (req, reply) => {
      const { sub } = req.user as { sub: string };
      const body = req.body ?? {};
      if (!body.tipo) return reply.status(400).send({ message: 'tipo é obrigatório' });
      const informados = CAMPOS_SERVICO.filter((c) => body[c] !== undefined);
      const campos = ['gc_cliente_id', ...informados];
      const valores = [req.params.id, ...informados.map((c) => (body[c] === '' ? null : body[c]))];
      const criado = await queryOne<{ id: string }>(
        `INSERT INTO gc_servicos (${campos.join(', ')})
         VALUES (${campos.map((_, i) => `$${i + 1}`).join(', ')}) RETURNING *`,
        valores
      );
      await registrarEvento(req.params.id, `Serviço adicionado: ${String(body.tipo)}`, '', sub);
      return reply.status(201).send(criado);
    }
  );

  app.patch<{ Params: { id: string }; Body: Record<string, unknown> }>(
    '/api/gc/servicos/:id',
    autenticado,
    async (req, reply) => {
      const { sets, params } = montarUpdate(CAMPOS_SERVICO, req.body ?? {});
      if (!sets.length) return reply.status(400).send({ message: 'Nada para atualizar' });
      params.push(req.params.id);
      const atualizado = await queryOne(
        `UPDATE gc_servicos SET ${sets.join(', ')}, updated_at = NOW()
         WHERE id = $${params.length} RETURNING *`,
        params
      );
      if (!atualizado) return reply.status(404).send({ message: 'Serviço não encontrado' });
      return atualizado;
    }
  );

  app.delete<{ Params: { id: string } }>('/api/gc/servicos/:id', autenticado, async (req, reply) => {
    const apagado = await queryOne('DELETE FROM gc_servicos WHERE id = $1 RETURNING id', [req.params.id]);
    if (!apagado) return reply.status(404).send({ message: 'Serviço não encontrado' });
    return reply.status(204).send();
  });

  // ------------------------------------------------------------------ jornada
  // PATCH /api/gc/jornada/:id — status, responsável e prazo da etapa. Marcar a etapa como
  // concluída à mão fecha o checklist dela: a tela mostra 100%, e é isso que a pessoa quis dizer.
  app.patch<{
    Params: { id: string };
    Body: { status?: string; responsavel_id?: string | null; prazo?: string | null };
  }>('/api/gc/jornada/:id', autenticado, async (req, reply) => {
    const { sub } = req.user as { sub: string };
    const etapa = await queryOne<{ gc_cliente_id: string; nome: string; status: string }>(
      'SELECT gc_cliente_id, nome, status FROM gc_cliente_jornada WHERE id = $1',
      [req.params.id]
    );
    if (!etapa) return reply.status(404).send({ message: 'Etapa não encontrada' });

    const { sets, params } = montarUpdate(['status', 'responsavel_id', 'prazo'], req.body ?? {});
    if (!sets.length) return reply.status(400).send({ message: 'Nada para atualizar' });
    const status = req.body?.status;
    if (status !== undefined) {
      sets.push(`concluida_em = ${status === 'concluida' ? 'NOW()' : 'NULL'}`);
    }
    params.push(req.params.id);
    const atualizada = await queryOne(
      `UPDATE gc_cliente_jornada SET ${sets.join(', ')}, updated_at = NOW()
       WHERE id = $${params.length} RETURNING *`,
      params
    );

    if (status === 'concluida' && etapa.status !== 'concluida') {
      await query(
        `UPDATE gc_checklist_itens
         SET concluido = true,
             concluido_por = COALESCE(concluido_por, $2),
             concluido_em = COALESCE(concluido_em, NOW()),
             updated_at = NOW()
         WHERE gc_cliente_jornada_id = $1 AND NOT concluido`,
        [req.params.id, sub]
      );
      await registrarEvento(etapa.gc_cliente_id, `Etapa concluída: ${etapa.nome}`, '', sub);
      await abrirProximaEtapa(etapa.gc_cliente_id);
    }
    return atualizada;
  });

  // ------------------------------------------------------------------ checklist
  // POST /api/gc/checklist — item novo, numa etapa da jornada OU numa estratégia (nunca nos dois:
  // o banco tem CHECK pra isso).
  app.post<{
    Body: {
      gc_cliente_jornada_id?: string; gc_cliente_estrategia_id?: string;
      titulo?: string; prazo?: string | null; responsavel_id?: string | null;
    };
  }>('/api/gc/checklist', autenticado, async (req, reply) => {
    const { gc_cliente_jornada_id, gc_cliente_estrategia_id, titulo, prazo, responsavel_id } = req.body ?? {};
    if (!titulo?.trim()) return reply.status(400).send({ message: 'titulo é obrigatório' });
    if (!gc_cliente_jornada_id === !gc_cliente_estrategia_id) {
      return reply.status(400).send({ message: 'Informe a etapa da jornada OU a estratégia do item' });
    }
    const dono = gc_cliente_jornada_id
      ? await queryOne<{ gc_cliente_id: string }>(
          'SELECT gc_cliente_id FROM gc_cliente_jornada WHERE id = $1', [gc_cliente_jornada_id])
      : await queryOne<{ gc_cliente_id: string }>(
          'SELECT gc_cliente_id FROM gc_cliente_estrategias WHERE id = $1', [gc_cliente_estrategia_id]);
    if (!dono) return reply.status(404).send({ message: 'Etapa ou estratégia não encontrada' });

    const ordem = await queryOne<{ proxima: number }>(
      `SELECT COALESCE(MAX(ordem), -1) + 1 AS proxima FROM gc_checklist_itens
       WHERE gc_cliente_jornada_id IS NOT DISTINCT FROM $1
         AND gc_cliente_estrategia_id IS NOT DISTINCT FROM $2`,
      [gc_cliente_jornada_id ?? null, gc_cliente_estrategia_id ?? null]
    );
    const criado = await queryOne(
      `INSERT INTO gc_checklist_itens
         (gc_cliente_id, gc_cliente_jornada_id, gc_cliente_estrategia_id, titulo, ordem, prazo, responsavel_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [
        dono.gc_cliente_id, gc_cliente_jornada_id ?? null, gc_cliente_estrategia_id ?? null,
        titulo.trim(), ordem?.proxima ?? 0, prazo || null, responsavel_id || null,
      ]
    );
    // A etapa volta pra "em andamento" se estava concluída e ganhou item novo em aberto.
    if (gc_cliente_jornada_id) await recalcularEtapa(gc_cliente_jornada_id);
    return reply.status(201).send(criado);
  });

  // PATCH /api/gc/checklist/:id — marcar/desmarcar, renomear, prazo, responsável.
  app.patch<{
    Params: { id: string };
    Body: { concluido?: boolean; titulo?: string; prazo?: string | null; responsavel_id?: string | null };
  }>('/api/gc/checklist/:id', autenticado, async (req, reply) => {
    const { sub } = req.user as { sub: string };
    const item = await queryOne<{ gc_cliente_jornada_id: string | null }>(
      'SELECT gc_cliente_jornada_id FROM gc_checklist_itens WHERE id = $1',
      [req.params.id]
    );
    if (!item) return reply.status(404).send({ message: 'Item não encontrado' });

    const { concluido, titulo, prazo, responsavel_id } = req.body ?? {};
    const sets: string[] = [];
    const params: unknown[] = [];
    let i = 1;
    if (concluido !== undefined) {
      sets.push(`concluido = $${i++}`); params.push(concluido);
      // Quem marcou e quando só fazem sentido no item marcado — desmarcar limpa os dois.
      sets.push(`concluido_por = $${i++}`); params.push(concluido ? sub : null);
      sets.push(`concluido_em = ${concluido ? 'NOW()' : 'NULL'}`);
    }
    if (titulo !== undefined) { sets.push(`titulo = $${i++}`); params.push(titulo); }
    if (prazo !== undefined) { sets.push(`prazo = $${i++}`); params.push(prazo || null); }
    if (responsavel_id !== undefined) { sets.push(`responsavel_id = $${i++}`); params.push(responsavel_id || null); }
    if (!sets.length) return reply.status(400).send({ message: 'Nada para atualizar' });

    params.push(req.params.id);
    const atualizado = await queryOne(
      `UPDATE gc_checklist_itens SET ${sets.join(', ')}, updated_at = NOW() WHERE id = $${i} RETURNING *`,
      params
    );
    if (concluido !== undefined && item.gc_cliente_jornada_id) {
      await recalcularEtapa(item.gc_cliente_jornada_id, sub);
    }
    return atualizado;
  });

  app.delete<{ Params: { id: string } }>('/api/gc/checklist/:id', autenticado, async (req, reply) => {
    const apagado = await queryOne<{ gc_cliente_jornada_id: string | null }>(
      'DELETE FROM gc_checklist_itens WHERE id = $1 RETURNING gc_cliente_jornada_id',
      [req.params.id]
    );
    if (!apagado) return reply.status(404).send({ message: 'Item não encontrado' });
    if (apagado.gc_cliente_jornada_id) await recalcularEtapa(apagado.gc_cliente_jornada_id);
    return reply.status(204).send();
  });

  // ------------------------------------------------------------------ histórico
  app.post<{
    Params: { id: string };
    Body: {
      tipo?: string; titulo?: string; descricao?: string; fixado?: boolean;
      anexos?: { id: string; name: string; type: string; size: number; dataUrl: string }[];
    };
  }>('/api/gc/clientes/:id/historico', autenticado, async (req, reply) => {
    const { sub } = req.user as { sub: string };
    const { tipo, titulo, descricao, fixado, anexos } = req.body ?? {};
    const comAnexo = Array.isArray(anexos) && anexos.length > 0;
    // Print colado sem texto é um registro válido ("olha o que apareceu no painel") — por isso o
    // anexo também conta como conteúdo.
    if (!descricao?.trim() && !titulo?.trim() && !comAnexo) {
      return reply.status(400).send({ message: 'Escreva algo ou anexe um print' });
    }
    const criado = await queryOne(
      `INSERT INTO gc_historico (gc_cliente_id, tipo, titulo, descricao, autor_id, fixado, anexos)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [
        req.params.id, tipo ?? 'nota', titulo ?? '', descricao ?? '', sub, fixado ?? false,
        JSON.stringify(anexos ?? []),
      ]
    );
    return reply.status(201).send(criado);
  });

  app.patch<{ Params: { id: string }; Body: Record<string, unknown> }>(
    '/api/gc/historico/:id',
    autenticado,
    async (req, reply) => {
      const corpo = { ...(req.body ?? {}) };
      // JSONB precisa chegar como texto JSON; mandar o array cru viraria "{...}" do Postgres.
      if (corpo.anexos !== undefined) corpo.anexos = JSON.stringify(corpo.anexos);
      const { sets, params } = montarUpdate(
        ['tipo', 'titulo', 'descricao', 'fixado', 'anexos'],
        corpo
      );
      if (!sets.length) return reply.status(400).send({ message: 'Nada para atualizar' });
      params.push(req.params.id);
      const atualizado = await queryOne(
        `UPDATE gc_historico SET ${sets.join(', ')}, updated_at = NOW()
         WHERE id = $${params.length} RETURNING *`,
        params
      );
      if (!atualizado) return reply.status(404).send({ message: 'Registro não encontrado' });
      return atualizado;
    }
  );

  app.delete<{ Params: { id: string } }>('/api/gc/historico/:id', autenticado, async (req, reply) => {
    const apagado = await queryOne('DELETE FROM gc_historico WHERE id = $1 RETURNING id', [req.params.id]);
    if (!apagado) return reply.status(404).send({ message: 'Registro não encontrado' });
    return reply.status(204).send();
  });

  // ------------------------------------------------------------------ métricas
  // GET /api/gc/clientes/:id/metricas — tudo o que já foi lançado, do mês mais novo pro mais
  // velho. O recorte por período fica no front, que já sabe qual mês está aberto na tela.
  app.get<{ Params: { id: string } }>(
    '/api/gc/clientes/:id/metricas',
    autenticado,
    async (req) => {
      return query(
        `SELECT * FROM gc_metricas WHERE gc_cliente_id = $1
         ORDER BY periodo_inicio DESC, chave`,
        [req.params.id]
      );
    }
  );

  // PUT /api/gc/metricas — grava o mês inteiro de uma vez (é como a tela edita: uma coluna por
  // métrica, um botão de salvar). Chave vazia ou valor em branco APAGA o lançamento, em vez de
  // gravar zero: zero é um número que a pessoa digitou, branco é "não sei".
  app.put<{
    Body: {
      gc_cliente_id?: string; gc_servico_id?: string | null;
      periodo_inicio?: string; periodo_fim?: string; fonte?: string;
      valores?: Record<string, number | string | null>;
    };
  }>('/api/gc/metricas', autenticado, async (req, reply) => {
    const { sub } = req.user as { sub: string };
    const { gc_cliente_id, gc_servico_id, periodo_inicio, periodo_fim, fonte, valores } = req.body ?? {};
    if (!gc_cliente_id || !periodo_inicio || !periodo_fim) {
      return reply.status(400).send({ message: 'Informe o cliente e o período' });
    }
    const origem = fonte ?? 'manual';
    for (const [chave, valor] of Object.entries(valores ?? {})) {
      if (valor === null || valor === undefined || valor === '') {
        await query(
          `DELETE FROM gc_metricas
           WHERE gc_cliente_id = $1 AND periodo_inicio = $2 AND periodo_fim = $3 AND fonte = $4 AND chave = $5`,
          [gc_cliente_id, periodo_inicio, periodo_fim, origem, chave]
        );
        continue;
      }
      await query(
        `INSERT INTO gc_metricas
           (gc_cliente_id, gc_servico_id, periodo_inicio, periodo_fim, fonte, chave, valor, criado_por)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         ON CONFLICT (gc_cliente_id, periodo_inicio, periodo_fim, fonte, chave)
         DO UPDATE SET valor = EXCLUDED.valor, gc_servico_id = EXCLUDED.gc_servico_id,
                       criado_por = EXCLUDED.criado_por, updated_at = NOW()`,
        [gc_cliente_id, gc_servico_id || null, periodo_inicio, periodo_fim, origem, chave, Number(valor), sub]
      );
    }
    return query(
      `SELECT * FROM gc_metricas
       WHERE gc_cliente_id = $1 AND periodo_inicio = $2 AND periodo_fim = $3
       ORDER BY chave`,
      [gc_cliente_id, periodo_inicio, periodo_fim]
    );
  });

  // GET /api/gc/trafego?periodo=YYYY-MM — a visão de todos os clientes num mês, uma linha por
  // cliente. Os números vêm pivotados ({ leads: 42, investimento: 1500 }) porque cada cliente
  // preenche um conjunto diferente de métricas, e a tela monta as colunas a partir disso.
  app.get<{ Querystring: { periodo?: string } }>('/api/gc/trafego', autenticado, async (req, reply) => {
    const periodo = req.query.periodo ?? '';
    if (!/^\d{4}-\d{2}$/.test(periodo)) {
      return reply.status(400).send({ message: 'periodo deve ser YYYY-MM' });
    }
    // Mesma consulta da lista: a tela de Tráfego mostra o semáforo do mesmo jeito, e dois
    // caminhos diferentes pros mesmos números é como eles começam a discordar.
    const [mes, anterior] = mesesDeReferencia(periodo);
    return query(
      `${SQL_CLIENTES} WHERE c.status <> 'encerrado' ORDER BY c.nome_empresa`,
      [mes, anterior]
    );
  });

  // ------------------------------------------------------------------ metas
  app.get<{ Params: { id: string } }>('/api/gc/clientes/:id/metas', autenticado, async (req) => {
    return query(
      `SELECT * FROM gc_metas WHERE gc_cliente_id = $1
       ORDER BY CASE horizonte WHEN 'mes' THEN 0 WHEN '6_meses' THEN 1 ELSE 2 END, created_at`,
      [req.params.id]
    );
  });

  app.post<{ Params: { id: string }; Body: Record<string, unknown> }>(
    '/api/gc/clientes/:id/metas',
    autenticado,
    async (req, reply) => {
      const b = req.body ?? {};
      if (!b.chave_metrica) return reply.status(400).send({ message: 'chave_metrica é obrigatória' });
      const criada = await queryOne(
        `INSERT INTO gc_metas
           (gc_cliente_id, chave_metrica, valor_base, data_base, valor_meta, prazo, horizonte)
         VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
        [
          req.params.id, b.chave_metrica, Number(b.valor_base ?? 0) || 0, b.data_base || null,
          Number(b.valor_meta ?? 0) || 0, b.prazo || null, b.horizonte || 'mes',
        ]
      );
      return reply.status(201).send(criada);
    }
  );

  app.patch<{ Params: { id: string }; Body: Record<string, unknown> }>(
    '/api/gc/metas/:id',
    autenticado,
    async (req, reply) => {
      const { sets, params } = montarUpdate(
        ['chave_metrica', 'valor_base', 'data_base', 'valor_meta', 'prazo', 'status', 'horizonte'],
        req.body ?? {}
      );
      if (!sets.length) return reply.status(400).send({ message: 'Nada para atualizar' });
      params.push(req.params.id);
      const atualizada = await queryOne(
        `UPDATE gc_metas SET ${sets.join(', ')}, updated_at = NOW()
         WHERE id = $${params.length} RETURNING *`,
        params
      );
      if (!atualizada) return reply.status(404).send({ message: 'Meta não encontrada' });
      return atualizada;
    }
  );

  app.delete<{ Params: { id: string } }>('/api/gc/metas/:id', autenticado, async (req, reply) => {
    const apagada = await queryOne('DELETE FROM gc_metas WHERE id = $1 RETURNING id', [req.params.id]);
    if (!apagada) return reply.status(404).send({ message: 'Meta não encontrada' });
    return reply.status(204).send();
  });

  // ------------------------------------------------------------------ estratégias
  // POST /api/gc/clientes/:id/estrategias — aplica uma estratégia modelo (com os passos dela
  // viram checklist) ou cria uma em branco. Igual à jornada, nome e passos são COPIADOS: mexer no
  // modelo depois não reescreve o que já foi aplicado num cliente.
  app.post<{
    Params: { id: string };
    Body: { estrategia_modelo_id?: string; nome?: string; objetivo?: string; responsavel_id?: string | null; data_inicio?: string | null };
  }>('/api/gc/clientes/:id/estrategias', autenticado, async (req, reply) => {
    const { sub } = req.user as { sub: string };
    const b = req.body ?? {};

    let nome = (b.nome ?? '').trim();
    let objetivo = b.objetivo ?? '';
    let passos: { titulo: string; ordem: number }[] = [];
    if (b.estrategia_modelo_id) {
      const modelo = await queryOne<{ nome: string; descricao: string }>(
        'SELECT nome, descricao FROM gc_estrategias_modelo WHERE id = $1',
        [b.estrategia_modelo_id]
      );
      if (!modelo) return reply.status(404).send({ message: 'Estratégia modelo não encontrada' });
      nome = nome || modelo.nome;
      objetivo = objetivo || modelo.descricao;
      passos = await query<{ titulo: string; ordem: number }>(
        'SELECT titulo, ordem FROM gc_estrategias_modelo_itens WHERE estrategia_modelo_id = $1 ORDER BY ordem',
        [b.estrategia_modelo_id]
      );
    }
    if (!nome) return reply.status(400).send({ message: 'Informe o nome da estratégia' });

    const criada = await withTransaction(async (client) => {
      const { rows: nova } = await client.query(
        `INSERT INTO gc_cliente_estrategias
           (gc_cliente_id, estrategia_modelo_id, nome, objetivo, responsavel_id, data_inicio)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
        [
          req.params.id, b.estrategia_modelo_id || null, nome, objetivo,
          b.responsavel_id || null, b.data_inicio || null,
        ]
      );
      for (const passo of passos) {
        await client.query(
          `INSERT INTO gc_checklist_itens (gc_cliente_id, gc_cliente_estrategia_id, titulo, ordem)
           VALUES ($1, $2, $3, $4)`,
          [req.params.id, nova[0].id, passo.titulo, passo.ordem]
        );
      }
      return nova[0];
    });

    await registrarEvento(req.params.id, `Estratégia aplicada: ${criada.nome}`, '', sub);
    return reply.status(201).send(criada);
  });

  app.patch<{ Params: { id: string }; Body: Record<string, unknown> }>(
    '/api/gc/estrategias/:id',
    autenticado,
    async (req, reply) => {
      const { sets, params } = montarUpdate(
        ['nome', 'objetivo', 'status', 'data_inicio', 'responsavel_id'],
        req.body ?? {}
      );
      if (!sets.length) return reply.status(400).send({ message: 'Nada para atualizar' });
      params.push(req.params.id);
      const atualizada = await queryOne(
        `UPDATE gc_cliente_estrategias SET ${sets.join(', ')}, updated_at = NOW()
         WHERE id = $${params.length} RETURNING *`,
        params
      );
      if (!atualizada) return reply.status(404).send({ message: 'Estratégia não encontrada' });
      return atualizada;
    }
  );

  app.delete<{ Params: { id: string } }>('/api/gc/estrategias/:id', autenticado, async (req, reply) => {
    const apagada = await queryOne('DELETE FROM gc_cliente_estrategias WHERE id = $1 RETURNING id', [
      req.params.id,
    ]);
    if (!apagada) return reply.status(404).send({ message: 'Estratégia não encontrada' });
    return reply.status(204).send();
  });

  // ------------------------------------------------------------------ avaliação do gestor
  // GET /api/gc/clientes/:id/avaliacoes — a régua do cliente mês a mês, pra ver se melhorou.
  app.get<{ Params: { id: string } }>('/api/gc/clientes/:id/avaliacoes', autenticado, async (req) => {
    return query(
      `SELECT a.*, p.name AS autor_nome
       FROM gc_avaliacoes a LEFT JOIN profiles p ON p.id = a.autor_id
       WHERE a.gc_cliente_id = $1 ORDER BY a.periodo_inicio DESC`,
      [req.params.id]
    );
  });

  // PUT /api/gc/clientes/:id/avaliacao — como ESTÁ o resultado, na opinião de quem acompanha.
  // Sem período no corpo, vale o mês de hoje em Brasília: é o caso de sempre, e obrigar a tela a
  // mandar a data só criaria chance de ela mandar o mês errado na virada.
  app.put<{
    Params: { id: string };
    Body: { nivel?: string; comentario?: string; periodo?: string };
  }>('/api/gc/clientes/:id/avaliacao', autenticado, async (req, reply) => {
    const { sub } = req.user as { sub: string };
    const { nivel, comentario, periodo } = req.body ?? {};
    if (!nivel || !['otimo', 'bom', 'regular', 'ruim'].includes(nivel)) {
      return reply.status(400).send({ message: 'nivel deve ser otimo, bom, regular ou ruim' });
    }
    const [inicio] = mesesDeReferencia(periodo);

    const anterior = await queryOne<{ nivel: string }>(
      'SELECT nivel FROM gc_avaliacoes WHERE gc_cliente_id = $1 AND periodo_inicio = $2',
      [req.params.id, inicio]
    );
    const salva = await queryOne<{ nivel: string }>(
      `INSERT INTO gc_avaliacoes (gc_cliente_id, periodo_inicio, periodo_fim, nivel, comentario, autor_id)
       VALUES ($1, $2, (date_trunc('month', $2::date) + INTERVAL '1 month - 1 day')::date, $3, $4, $5)
       ON CONFLICT (gc_cliente_id, periodo_inicio, periodo_fim)
       DO UPDATE SET nivel = EXCLUDED.nivel, comentario = EXCLUDED.comentario,
                     autor_id = EXCLUDED.autor_id, updated_at = NOW()
       RETURNING *`,
      [req.params.id, inicio, nivel, comentario ?? '', sub]
    );

    // Só registra quando a nota MUDA: salvar o comentário de novo não é um acontecimento, e o
    // histórico viraria uma lista de "avaliou como bom" repetida.
    if (anterior?.nivel !== nivel) {
      await registrarEvento(
        req.params.id,
        `Resultado de ${String(inicio).slice(0, 7).split('-').reverse().join('/')}: ${nivel}`,
        comentario ?? '',
        sub
      );
    }
    return salva;
  });

  app.delete<{ Params: { id: string }; Querystring: { periodo?: string } }>(
    '/api/gc/clientes/:id/avaliacao',
    autenticado,
    async (req, reply) => {
      const [inicio] = mesesDeReferencia(req.query.periodo);
      const apagada = await queryOne(
        'DELETE FROM gc_avaliacoes WHERE gc_cliente_id = $1 AND periodo_inicio = $2 RETURNING id',
        [req.params.id, inicio]
      );
      if (!apagada) return reply.status(404).send({ message: 'Esse mês não tem avaliação' });
      return reply.status(204).send();
    }
  );

  // ------------------------------------------------------------------ relatórios
  // GET /api/gc/clientes/:id/relatorios — lista sem o snapshot (que é grande e só interessa quando
  // o relatório é aberto).
  app.get<{ Params: { id: string } }>('/api/gc/clientes/:id/relatorios', autenticado, async (req) => {
    return query(
      `SELECT r.id, r.gc_cliente_id, r.periodo_inicio, r.periodo_fim, r.status,
              r.comentario_gestor, r.proximos_passos, r.publicado_em, p.name AS publicado_por_nome
       FROM gc_relatorios r
       LEFT JOIN profiles p ON p.id = r.publicado_por
       WHERE r.gc_cliente_id = $1
       ORDER BY r.periodo_inicio DESC`,
      [req.params.id]
    );
  });

  app.get<{ Params: { id: string } }>('/api/gc/relatorios/:id', autenticado, async (req, reply) => {
    const r = await queryOne('SELECT * FROM gc_relatorios WHERE id = $1', [req.params.id]);
    if (!r) return reply.status(404).send({ message: 'Relatório não encontrado' });
    return r;
  });

  // POST /api/gc/clientes/:id/relatorios — abre (ou atualiza) o rascunho do período. É um por
  // período: pedir de novo o mesmo mês não cria um segundo relatório, atualiza o texto do que já
  // existe. Relatório já publicado não é sobrescrito por aqui — tem que despublicar antes, pra não
  // trocar por baixo do cliente o texto do que ele já leu.
  app.post<{
    Params: { id: string };
    Body: { periodo_inicio?: string; periodo_fim?: string; comentario_gestor?: string; proximos_passos?: string };
  }>('/api/gc/clientes/:id/relatorios', autenticado, async (req, reply) => {
    const { periodo_inicio, periodo_fim, comentario_gestor, proximos_passos } = req.body ?? {};
    if (!periodo_inicio || !periodo_fim) {
      return reply.status(400).send({ message: 'Informe o período do relatório' });
    }
    const existente = await queryOne<{ id: string; status: string }>(
      `SELECT id, status FROM gc_relatorios
       WHERE gc_cliente_id = $1 AND periodo_inicio = $2 AND periodo_fim = $3`,
      [req.params.id, periodo_inicio, periodo_fim]
    );
    if (existente?.status === 'publicado') {
      return reply.status(409).send({
        message: 'Esse período já tem relatório publicado. Despublique antes de editar.',
        id: existente.id,
      });
    }
    const salvo = await queryOne(
      `INSERT INTO gc_relatorios (gc_cliente_id, periodo_inicio, periodo_fim, comentario_gestor, proximos_passos)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (gc_cliente_id, periodo_inicio, periodo_fim)
       DO UPDATE SET comentario_gestor = EXCLUDED.comentario_gestor,
                     proximos_passos = EXCLUDED.proximos_passos,
                     updated_at = NOW()
       RETURNING *`,
      [req.params.id, periodo_inicio, periodo_fim, comentario_gestor ?? '', proximos_passos ?? '']
    );
    return reply.status(201).send(salvo);
  });

  // POST /api/gc/relatorios/:id/publicar — congela o snapshot e deixa o relatório visível no
  // portal. O snapshot vem montado da tela: ele é a foto do que o gestor viu e aprovou, e é
  // auto-descritivo (cada número traz label e unidade) pra o portal e o PDF não precisarem
  // recalcular nada depois.
  app.post<{ Params: { id: string }; Body: { snapshot?: GcSnapshot } }>(
    '/api/gc/relatorios/:id/publicar',
    autenticado,
    async (req, reply) => {
      const { sub } = req.user as { sub: string };
      const snapshot = req.body?.snapshot;
      if (!snapshot || !Array.isArray(snapshot.numeros)) {
        return reply.status(400).send({ message: 'snapshot inválido' });
      }
      const publicado = await queryOne<{ gc_cliente_id: string; periodo_inicio: string }>(
        `UPDATE gc_relatorios
         SET status = 'publicado', publicado_em = NOW(), publicado_por = $2,
             snapshot = $3, updated_at = NOW()
         WHERE id = $1 RETURNING *`,
        [req.params.id, sub, JSON.stringify({ ...snapshot, publicado_em: new Date().toISOString() })]
      );
      if (!publicado) return reply.status(404).send({ message: 'Relatório não encontrado' });
      await registrarEvento(
        publicado.gc_cliente_id,
        `Relatório publicado: ${snapshot.periodo?.rotulo ?? String(publicado.periodo_inicio).slice(0, 7)}`,
        '',
        sub
      );
      return publicado;
    }
  );

  // POST /api/gc/relatorios/:id/despublicar — volta pra rascunho. O snapshot FICA guardado: se o
  // relatório for publicado de novo sem mexer em nada, é a mesma foto.
  app.post<{ Params: { id: string } }>(
    '/api/gc/relatorios/:id/despublicar',
    autenticado,
    async (req, reply) => {
      const r = await queryOne(
        `UPDATE gc_relatorios SET status = 'rascunho', publicado_em = NULL, updated_at = NOW()
         WHERE id = $1 RETURNING *`,
        [req.params.id]
      );
      if (!r) return reply.status(404).send({ message: 'Relatório não encontrado' });
      return r;
    }
  );

  app.delete<{ Params: { id: string } }>('/api/gc/relatorios/:id', autenticado, async (req, reply) => {
    const apagado = await queryOne('DELETE FROM gc_relatorios WHERE id = $1 RETURNING id', [
      req.params.id,
    ]);
    if (!apagado) return reply.status(404).send({ message: 'Relatório não encontrado' });
    return reply.status(204).send();
  });

  // POST /api/gc/relatorios/:id/pdf — PDF do relatório, desenhado a partir do snapshot. Rascunho
  // ainda não tem snapshot gravado, então a tela manda o dela no corpo da chamada pra dar pra
  // conferir o PDF antes de publicar.
  app.post<{ Params: { id: string }; Body: { snapshot?: GcSnapshot } }>(
    '/api/gc/relatorios/:id/pdf',
    autenticado,
    async (req, reply) => {
      const r = await queryOne<{ snapshot: GcSnapshot | null; periodo_inicio: string }>(
        'SELECT snapshot, periodo_inicio FROM gc_relatorios WHERE id = $1',
        [req.params.id]
      );
      if (!r) return reply.status(404).send({ message: 'Relatório não encontrado' });
      const snapshot = r.snapshot ?? req.body?.snapshot;
      if (!snapshot) {
        return reply.status(400).send({ message: 'Relatório sem conteúdo pra gerar o PDF' });
      }
      try {
        const pdf = await renderFullHtmlToPdf(montarHtmlRelatorio(snapshot));
        const nome = `relatorio-${String(r.periodo_inicio).slice(0, 7)}.pdf`;
        return reply
          .header('Content-Type', 'application/pdf')
          .header('Content-Disposition', `attachment; filename="${nome}"`)
          .send(pdf);
      } catch (err) {
        app.log.error({ err }, 'falha ao gerar PDF do relatório do cliente');
        return reply.status(500).send({ message: 'Não foi possível gerar o PDF' });
      }
    }
  );

  // ------------------------------------------------------------------ link do portal
  app.get<{ Params: { id: string } }>('/api/gc/clientes/:id/link', autenticado, async (req) => {
    return (
      (await queryOne(
        `SELECT l.*, (SELECT count(*) FROM gc_acessos_link a WHERE a.link_id = l.id) AS acessos,
                (SELECT max(acessado_em) FROM gc_acessos_link a WHERE a.link_id = l.id) AS ultimo_acesso
         FROM gc_links_publicos l WHERE l.gc_cliente_id = $1 AND l.ativo`,
        [req.params.id]
      )) ?? null
    );
  });

  // POST /api/gc/clientes/:id/link — gera o link do portal, revogando o anterior na mesma
  // transação: o banco tem um índice de um link ativo por cliente, e é ele que garante que não
  // sobrem dois endereços válidos circulando com o cliente.
  app.post<{ Params: { id: string } }>('/api/gc/clientes/:id/link', autenticado, async (req, reply) => {
    const { sub } = req.user as { sub: string };
    const token = crypto.randomBytes(24).toString('base64url');
    const link = await withTransaction(async (client) => {
      await client.query(
        `UPDATE gc_links_publicos SET ativo = false, revogado_em = NOW(), updated_at = NOW()
         WHERE gc_cliente_id = $1 AND ativo`,
        [req.params.id]
      );
      const { rows } = await client.query(
        'INSERT INTO gc_links_publicos (gc_cliente_id, token) VALUES ($1, $2) RETURNING *',
        [req.params.id, token]
      );
      return rows[0];
    });
    await registrarEvento(req.params.id, 'Link do portal gerado', '', sub);
    return reply.status(201).send(link);
  });

  app.delete<{ Params: { id: string } }>('/api/gc/clientes/:id/link', autenticado, async (req, reply) => {
    const { sub } = req.user as { sub: string };
    const revogado = await queryOne(
      `UPDATE gc_links_publicos SET ativo = false, revogado_em = NOW(), updated_at = NOW()
       WHERE gc_cliente_id = $1 AND ativo RETURNING id`,
      [req.params.id]
    );
    if (!revogado) return reply.status(404).send({ message: 'Esse cliente não tem link ativo' });
    await registrarEvento(req.params.id, 'Link do portal revogado', '', sub);
    return reply.status(204).send();
  });
}

/**
 * Portal do cliente — SEM login, só com o token do link.
 *
 * Mostra apenas relatórios PUBLICADOS, e lê os números do snapshot de cada um: o que o cliente viu
 * continua sendo o que ele vê, mesmo que a métrica tenha sido corrigida depois. Nada de jornada
 * interna, custo, margem ou histórico do time passa por aqui.
 */
export async function gestaoClientesPublicRoutes(app: FastifyInstance) {
  app.get<{ Params: { token: string } }>('/api/public/cliente/:token', async (req, reply) => {
    const link = await queryOne<{ id: string; gc_cliente_id: string; expira_em: string | null }>(
      'SELECT id, gc_cliente_id, expira_em FROM gc_links_publicos WHERE token = $1 AND ativo',
      [req.params.token]
    );
    if (!link) return reply.status(404).send({ message: 'Link inválido ou revogado' });
    if (link.expira_em && new Date(link.expira_em) < new Date()) {
      return reply.status(410).send({ message: 'Esse link expirou' });
    }

    // Hash do IP, não o IP: serve pra separar visitantes, não pra identificar quem abriu.
    const ipHash = crypto
      .createHash('sha256')
      .update(String(req.ip ?? ''))
      .digest('hex')
      .slice(0, 32);
    await query(
      'INSERT INTO gc_acessos_link (link_id, ip_hash, user_agent) VALUES ($1, $2, $3)',
      [link.id, ipHash, String(req.headers['user-agent'] ?? '').slice(0, 300)]
    );

    const cliente = await queryOne<{ nome_empresa: string; logo_url: string | null; segmento: string }>(
      'SELECT nome_empresa, logo_url, segmento FROM gc_clientes WHERE id = $1',
      [link.gc_cliente_id]
    );
    if (!cliente) return reply.status(404).send({ message: 'Cliente não encontrado' });

    const relatorios = await query(
      `SELECT id, periodo_inicio, periodo_fim, publicado_em, snapshot
       FROM gc_relatorios
       WHERE gc_cliente_id = $1 AND status = 'publicado'
       ORDER BY periodo_inicio DESC`,
      [link.gc_cliente_id]
    );

    return { cliente, relatorios };
  });

  // GET /api/public/cliente/:token/relatorio/:id/pdf — o mesmo PDF do painel, pro cliente baixar.
  app.get<{ Params: { token: string; id: string } }>(
    '/api/public/cliente/:token/relatorio/:id/pdf',
    async (req, reply) => {
      const r = await queryOne<{ snapshot: GcSnapshot | null; periodo_inicio: string }>(
        `SELECT r.snapshot, r.periodo_inicio
         FROM gc_relatorios r
         JOIN gc_links_publicos l ON l.gc_cliente_id = r.gc_cliente_id AND l.ativo
         WHERE r.id = $1 AND l.token = $2 AND r.status = 'publicado'`,
        [req.params.id, req.params.token]
      );
      if (!r?.snapshot) return reply.status(404).send({ message: 'Relatório não encontrado' });
      try {
        const pdf = await renderFullHtmlToPdf(montarHtmlRelatorio(r.snapshot));
        return reply
          .header('Content-Type', 'application/pdf')
          .header(
            'Content-Disposition',
            `attachment; filename="relatorio-${String(r.periodo_inicio).slice(0, 7)}.pdf"`
          )
          .send(pdf);
      } catch (err) {
        app.log.error({ err }, 'falha ao gerar PDF do portal do cliente');
        return reply.status(500).send({ message: 'Não foi possível gerar o PDF' });
      }
    }
  );
}
