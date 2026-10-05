import { FastifyInstance } from 'fastify';
import { query, queryOne, withTransaction } from '../db.js';

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
  'segmento', 'logo_url', 'responsavel_id', 'status', 'data_inicio', 'observacoes_gerais',
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

export async function gestaoClientesRoutes(app: FastifyInstance) {
  const autenticado = { onRequest: [app.authenticate] };

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
  // GET /api/gc/clientes — lista da tela, já com etapa atual e progresso do checklist. São poucas
  // dezenas de clientes, então não vale paginar: a tela filtra no front igual ao resto do painel.
  app.get('/api/gc/clientes', autenticado, async () => {
    return query(
      `SELECT c.*, p.name AS responsavel_nome,
         (SELECT j.nome FROM gc_cliente_jornada j
           WHERE j.gc_cliente_id = c.id AND j.status <> 'concluida'
           ORDER BY j.ordem, j.created_at LIMIT 1) AS etapa_atual,
         (SELECT count(*) FROM gc_cliente_jornada j WHERE j.gc_cliente_id = c.id) AS etapas_total,
         (SELECT count(*) FROM gc_cliente_jornada j
           WHERE j.gc_cliente_id = c.id AND j.status = 'concluida') AS etapas_concluidas,
         (SELECT count(*) FROM gc_checklist_itens i WHERE i.gc_cliente_id = c.id) AS itens_total,
         (SELECT count(*) FROM gc_checklist_itens i
           WHERE i.gc_cliente_id = c.id AND i.concluido) AS itens_concluidos,
         COALESCE((SELECT json_agg(json_build_object(
             'id', s.id, 'tipo', s.tipo, 'status', s.status,
             'investimento_previsto_mensal', s.investimento_previsto_mensal
           ) ORDER BY s.created_at)
           FROM gc_servicos s WHERE s.gc_cliente_id = c.id), '[]'::json) AS servicos
       FROM gc_clientes c
       LEFT JOIN profiles p ON p.id = c.responsavel_id
       ORDER BY c.nome_empresa`
    );
  });

  // GET /api/gc/clientes/:id — tudo do cliente numa tacada: a tela de detalhe abre as abas
  // Visão geral, Jornada, Estratégias e Histórico sem ida e volta ao servidor.
  app.get<{ Params: { id: string } }>('/api/gc/clientes/:id', autenticado, async (req, reply) => {
    const cliente = await queryOne(
      `SELECT c.*, p.name AS responsavel_nome
       FROM gc_clientes c LEFT JOIN profiles p ON p.id = c.responsavel_id
       WHERE c.id = $1`,
      [req.params.id]
    );
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
    Body: { tipo?: string; titulo?: string; descricao?: string; fixado?: boolean };
  }>('/api/gc/clientes/:id/historico', autenticado, async (req, reply) => {
    const { sub } = req.user as { sub: string };
    const { tipo, titulo, descricao, fixado } = req.body ?? {};
    if (!descricao?.trim() && !titulo?.trim()) {
      return reply.status(400).send({ message: 'Escreva algo no registro' });
    }
    const criado = await queryOne(
      `INSERT INTO gc_historico (gc_cliente_id, tipo, titulo, descricao, autor_id, fixado)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [req.params.id, tipo ?? 'nota', titulo ?? '', descricao ?? '', sub, fixado ?? false]
    );
    return reply.status(201).send(criado);
  });

  app.patch<{ Params: { id: string }; Body: Record<string, unknown> }>(
    '/api/gc/historico/:id',
    autenticado,
    async (req, reply) => {
      const { sets, params } = montarUpdate(['tipo', 'titulo', 'descricao', 'fixado'], req.body ?? {});
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
}
