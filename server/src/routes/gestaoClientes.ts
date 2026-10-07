import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import crypto from 'node:crypto';
import { pool, query, queryOne, withTransaction } from '../db.js';
import { renderFullHtmlToPdf } from '../lib/htmlPdf.js';
import { montarHtmlRelatorio, type GcSnapshot } from '../lib/gcRelatorioHtml.js';
import { validarMetricas } from '../lib/gcValidacao.js';
import { garantirRecorrentes, sincronizarRotinaAutomatica } from '../lib/gcRecorrentes.js';
import { CHAVES_REALIZADO_PUBLICO, montarJornadaPublica } from '../lib/gcPortalJornada.js';
import {
  CAMPOS_COM_ORIGEM, CHAVES_DIGITADAS, HORIZONTES_PLANEJAMENTO, baseDoPontoA, derivadosDoPontoA, diffDeCampos,
  sanearOrigens, somarMesesNaData,
  type Mudanca, type PontoA,
} from '../lib/gcPlanejamento.js';

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
  'data_inicio', 'observacoes_gerais', 'estrategia_usada',
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

/**
 * "Cliente já em andamento": fecha as etapas até o Go-live (inclusive) como concluídas ANTES DO MÓDULO,
 * sem data de conclusão, com os itens delas concluídos também sem data nem autor, e abre a etapa
 * seguinte. Aceita o cliente de uma transação (cadastro) ou usa o pool.
 */
async function aplicarJaEmAndamento(
  clienteId: string,
  conexao?: { query: (sql: string, params?: unknown[]) => Promise<{ rows: Record<string, unknown>[]; rowCount: number | null }> }
): Promise<{ etapas: number }> {
  const exec = conexao ?? { query: (sql: string, params?: unknown[]) => pool.query(sql, params) };
  const go = await exec.query(
    `SELECT ordem FROM gc_cliente_jornada WHERE gc_cliente_id = $1 AND lower(nome) LIKE 'go-live%' ORDER BY ordem LIMIT 1`,
    [clienteId]
  );
  if (!go.rows[0]) return { etapas: 0 };
  const ordemGo = go.rows[0].ordem;
  const etapas = await exec.query(
    `UPDATE gc_cliente_jornada
     SET status = 'concluida', concluida_em = NULL, concluida_antes = true, updated_at = NOW()
     WHERE gc_cliente_id = $1 AND ordem <= $2 RETURNING id`,
    [clienteId, ordemGo]
  );
  await exec.query(
    `UPDATE gc_checklist_itens
     SET concluido = true, concluido_em = NULL, concluido_por = NULL, updated_at = NOW()
     WHERE gc_cliente_jornada_id = ANY($1::uuid[]) AND NOT concluido`,
    [etapas.rows.map((e) => e.id)]
  );
  await exec.query(
    `UPDATE gc_cliente_jornada SET status = 'em_andamento', updated_at = NOW()
     WHERE id = (
       SELECT id FROM gc_cliente_jornada
       WHERE gc_cliente_id = $1 AND ordem > $2 AND status = 'pendente'
       ORDER BY ordem, created_at LIMIT 1
     ) AND NOT EXISTS (SELECT 1 FROM gc_cliente_jornada WHERE gc_cliente_id = $1 AND status = 'em_andamento')`,
    [clienteId, ordemGo]
  );
  return { etapas: etapas.rows.length };
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
     FROM gc_checklist_itens WHERE gc_cliente_jornada_id = $1
       AND titulo NOT IN ${TITULOS_AUTOMATICOS_SQL}`,
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

/**
 * Itens da etapa "Acompanhamento mensal" da jornada que NÃO se marcam à mão: o estado vem dos fatos do
 * mês que fechou (relatório publicado; nota de reunião/alinhamento). São derivados na leitura, nunca
 * gravados como concluídos — senão o do mês passado continuaria "feito" no mês seguinte.
 */
const TITULOS_AUTOMATICOS_SQL = `('Relatório do mês publicado', 'Alinhamento mensal com o cliente')`;
/** O mês que fechou, como a data do primeiro dia. */
const MES_QUE_FECHOU_SQL = `(date_trunc('month', ${HOJE}) - INTERVAL '1 month')::date`;

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
    -- Progresso da IMPLANTAÇÃO: os itens da rotina mensal ficam de fora, senão todo mês um item novo
    -- em aberto puxaria o percentual de um cliente já implantado pra baixo.
    (SELECT count(*) FROM gc_checklist_itens i
      WHERE i.gc_cliente_id = c.id AND i.recorrente_chave IS NULL
        AND i.titulo NOT IN ${TITULOS_AUTOMATICOS_SQL}) AS itens_total,
    (SELECT count(*) FROM gc_checklist_itens i
      WHERE i.gc_cliente_id = c.id AND i.concluido AND i.recorrente_chave IS NULL
        AND i.titulo NOT IN ${TITULOS_AUTOMATICOS_SQL}) AS itens_concluidos,
    (SELECT count(*) FROM gc_checklist_itens i
      WHERE i.gc_cliente_id = c.id AND NOT i.concluido
        AND i.prazo IS NOT NULL AND i.prazo < ${HOJE}) AS itens_atrasados,
    -- Último contato = o que uma PESSOA registrou. Evento do sistema não conta: "etapa concluída"
    -- não é conversa com o cliente, e contar isso faria um cliente abandonado parecer ativo.
    (SELECT max(h.created_at) FROM gc_historico h
      WHERE h.gc_cliente_id = c.id AND h.tipo <> 'evento_sistema') AS ultimo_contato,
    (SELECT max(r.periodo_inicio) FROM gc_relatorios r
      WHERE r.gc_cliente_id = c.id AND r.status = 'publicado') AS ultimo_relatorio,
    -- Quando o cliente abriu o portal pela última vez: responde "ele está lendo o que mandamos?".
    (SELECT max(a.acessado_em) FROM gc_acessos_link a
      JOIN gc_links_publicos l ON l.id = a.link_id
      WHERE l.gc_cliente_id = c.id) AS ultimo_acesso_portal,
    -- Próxima renovação entre os serviços ATIVOS (a mais cedo, vencida ou não).
    (SELECT min(s.data_renovacao) FROM gc_servicos s
      WHERE s.gc_cliente_id = c.id AND s.status = 'ativo' AND s.data_renovacao IS NOT NULL) AS proxima_renovacao,
    -- Id do MODELO da etapa atual: é com ele que o Kanban sabe em que coluna o cliente está.
    (SELECT j.etapa_id FROM gc_cliente_jornada j
      WHERE j.gc_cliente_id = c.id AND j.status <> 'concluida'
      ORDER BY j.ordem, j.created_at LIMIT 1) AS etapa_atual_modelo_id,
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
    (SELECT r.status FROM gc_relatorios r
      WHERE r.gc_cliente_id = c.id AND r.periodo_inicio = $1::date LIMIT 1) AS relatorio_mes,
    to_char($1::date, 'YYYY-MM') AS periodo_referencia,
    (SELECT to_char(MIN(m.periodo_inicio), 'YYYY-MM') FROM gc_metricas m
      WHERE m.gc_cliente_id = c.id) AS primeiro_mes_metricas,
    -- Ponto A e curva do planejamento: o semáforo ("Metas combinadas") compara o realizado do mês
    -- com a projeção, e pra isso precisa disso na lista, sem um pedido por cliente.
    (SELECT json_build_object(
        'curva', pl.curva,
        'data_diagnostico', to_char(pl.data_diagnostico, 'YYYY-MM-DD'),
        'leads', pl.leads_mes, 'investimento', pl.investimento_mes, 'vendas', pl.vendas_mes,
        'ticket', pl.ticket_medio, 'conversao', pl.taxa_conversao, 'receita', pl.faturamento_mensal,
        'aguardando_cliente', pl.aguardando_cliente,
        'lembrar_em', to_char(pl.lembrar_em, 'YYYY-MM-DD'))
      FROM gc_planejamento pl WHERE pl.gc_cliente_id = c.id) AS planejamento,
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
    `SELECT 1 FROM user_menu_access WHERE user_id = $1 AND menu_key LIKE 'nxdigital%'`,
    [userId]
  );
  return !!chave;
}

/**
 * Os números que o cliente teria no período DEPOIS de aplicar `alteracoes` (valor vazio apaga).
 * A conferência de coerência olha o conjunto final, não só o que veio na chamada: "vendas > leads"
 * só aparece vendo os dois lados, e um deles pode já estar gravado de antes.
 */
async function valoresFinais(
  clienteId: string,
  periodoInicio: string,
  fonte: string,
  alteracoes: Record<string, number | string | null | undefined>
): Promise<Record<string, number>> {
  const atuais = await query<{ chave: string; valor: string }>(
    `SELECT chave, valor FROM gc_metricas
     WHERE gc_cliente_id = $1 AND periodo_inicio = $2::date AND fonte = $3`,
    [clienteId, periodoInicio, fonte]
  );
  const finais: Record<string, number> = {};
  for (const r of atuais) finais[r.chave] = Number(r.valor);
  for (const [chave, valor] of Object.entries(alteracoes)) {
    if (valor === null || valor === undefined || valor === '') delete finais[chave];
    else finais[chave] = Number(valor);
  }
  return finais;
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
  app.get<{ Querystring: { todos?: string } }>('/api/gc/modelos', autenticado, async (req) => {
    // Os seletores só oferecem modelo ATIVO; a tela de gestão pede "todos" pra poder reativar.
    const filtroEstrategia = req.query.todos === '1' ? '' : 'WHERE e.ativo';
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
       FROM gc_estrategias_modelo e ${filtroEstrategia} ORDER BY e.ativo DESC, e.nome`
    );
    return { etapas, estrategias };
  });

  // ------------------------------------------------------------------ clientes
  // GET /api/gc/clientes?periodo=YYYY-MM — lista da tela, com o que o semáforo precisa. São poucas
  // dezenas de clientes, então não vale paginar: a tela filtra no front igual ao resto do painel.
  app.get<{ Querystring: { periodo?: string } }>('/api/gc/clientes', autenticado, async (req) => {
    await garantirRecorrentes();
    const [mes, anterior] = mesesDeReferencia(req.query.periodo);
    return query(`${SQL_CLIENTES} ORDER BY c.nome_empresa`, [mes, anterior]);
  });

  // GET /api/gc/clientes/:id — tudo do cliente numa tacada: a tela de detalhe abre as abas
  // Visão geral, Jornada, Estratégias e Histórico sem ida e volta ao servidor.
  app.get<{ Params: { id: string } }>('/api/gc/clientes/:id', autenticado, async (req, reply) => {
    // A MESMA consulta da lista, filtrada num cliente: o detalhe mostra o semáforo, e ele tem que
    // sair igualzinho ao da lista — dois caminhos pro mesmo cálculo é como eles se separam.
    await garantirRecorrentes();
    await sincronizarRotinaAutomatica(req.params.id);
    const [mes, anterior] = mesesDeReferencia();
    const cliente = await queryOne(`${SQL_CLIENTES} WHERE c.id = $3`, [mes, anterior, req.params.id]);
    if (!cliente) return reply.status(404).send({ message: 'Cliente não encontrado' });

    const [servicos, jornada, estrategias, historico, rotina] = await Promise.all([
      query('SELECT * FROM gc_servicos WHERE gc_cliente_id = $1 ORDER BY created_at', [req.params.id]),
      query(
        `SELECT j.*, p.name AS responsavel_nome, COALESCE(
           (SELECT json_agg(json_build_object(
               'id', i.id, 'titulo', i.titulo, 'ordem', i.ordem,
               'automatico', CASE i.titulo
                  WHEN 'Relatório do mês publicado' THEN 'relatorio'
                  WHEN 'Alinhamento mensal com o cliente' THEN 'alinhamento' END,
               'concluido', CASE i.titulo
                  WHEN 'Relatório do mês publicado' THEN EXISTS (
                    SELECT 1 FROM gc_relatorios r WHERE r.gc_cliente_id = j.gc_cliente_id
                      AND r.status = 'publicado' AND r.periodo_inicio = ${MES_QUE_FECHOU_SQL})
                  WHEN 'Alinhamento mensal com o cliente' THEN EXISTS (
                    SELECT 1 FROM gc_historico h WHERE h.gc_cliente_id = j.gc_cliente_id AND h.tipo = 'reuniao'
                      AND (h.created_at AT TIME ZONE 'America/Sao_Paulo')::date >= ${MES_QUE_FECHOU_SQL}
                      AND (h.created_at AT TIME ZONE 'America/Sao_Paulo')::date < (${MES_QUE_FECHOU_SQL} + INTERVAL '2 months')::date)
                  ELSE i.concluido END,
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
      // Itens da rotina mensal: dos 6 últimos meses, que é o que dá pra agir. Mais antigo que isso
      // é histórico, e o histórico do cliente já guarda.
      query(
        `SELECT i.id, i.titulo, i.prazo, i.concluido, i.concluido_em, i.recorrente_chave, i.mes_referencia,
                (NOT i.concluido AND i.prazo IS NOT NULL AND i.prazo < ${HOJE}) AS atrasado
         FROM gc_checklist_itens i
         WHERE i.gc_cliente_id = $1 AND i.recorrente_chave IS NOT NULL
           AND i.mes_referencia >= (date_trunc('month', ${HOJE}) - INTERVAL '6 months')::date
         ORDER BY i.mes_referencia DESC, i.ordem`,
        [req.params.id]
      ),
    ]);

    return { cliente, servicos, jornada, estrategias, historico, rotina };
  });

  // POST /api/gc/clientes — cria o cliente E a jornada dele na mesma transação. Cliente sem
  // jornada não serve pra nada nesta tela, então os dois nascem juntos ou nenhum nasce.
  app.post<{ Body: Record<string, unknown> }>('/api/gc/clientes', autenticado, async (req, reply) => {
    const { sub } = req.user as { sub: string };
    const body = req.body ?? {};
    const nome = String(body.nome_empresa ?? '').trim();
    if (!nome) return reply.status(400).send({ message: 'nome_empresa é obrigatório' });
    // Cliente sem dono é cliente que ninguém acompanha — e é o responsável que aparece na lista de
    // pendências e no filtro. Por isso é obrigatório já no cadastro.
    if (!body.responsavel_id) {
      return reply.status(400).send({ message: 'Escolha o responsável pelo cliente' });
    }

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
      if (body.ja_em_andamento === true) await aplicarJaEmAndamento(rows[0].id, client);
      return rows[0];
    });

    await registrarEvento(criado.id, 'Cliente cadastrado', '', sub);
    if (body.ja_em_andamento === true) {
      await registrarEvento(criado.id, 'Cliente já em andamento', 'Etapas até o Go-live: concluídas antes do módulo', sub);
    }
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

      // Tirar o responsável (mandar vazio) não pode: troca-se por outra pessoa, não se deixa sem dono.
      const corpo = req.body ?? {};
      if ('responsavel_id' in corpo && !corpo.responsavel_id) {
        return reply.status(400).send({ message: 'O responsável é obrigatório — escolha outra pessoa em vez de remover' });
      }
      const { sets, params } = montarUpdate(CAMPOS_CLIENTE, corpo);
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

  // ------------------------------------------------------------------ mover de etapa (Kanban)
  // POST /api/gc/clientes/:id/mover-etapa — leva o cliente pra outra etapa da jornada.
  //
  // Mover NÃO é só trocar uma etiqueta: pra frente, as etapas que ficam pra trás são concluídas
  // (com os itens delas); pra trás, as etapas reabertas voltam a ter os itens desmarcados. Por isso
  // a rota tem DOIS passos: sem `confirmar` ela só descreve o que aconteceria, e a tela mostra isso
  // numa janela de confirmação; com `confirmar: true` ela executa. Arrastar um card sem saber que
  // isso fecha 17 itens de checklist seria um efeito escondido demais.
  //
  // `etapa_modelo_id` = 'fim' leva pra "jornada concluída".
  app.post<{ Params: { id: string }; Body: { etapa_modelo_id?: string; confirmar?: boolean } }>(
    '/api/gc/clientes/:id/mover-etapa',
    autenticado,
    async (req, reply) => {
      const { sub } = req.user as { sub: string };
      const { etapa_modelo_id, confirmar } = req.body ?? {};
      if (!etapa_modelo_id) return reply.status(400).send({ message: 'Informe a etapa de destino' });

      const jornada = await query<{
        id: string; nome: string; status: string; etapa_id: string | null; abertos: string; marcados: string;
      }>(
        `SELECT j.id, j.nome, j.status, j.etapa_id,
           count(i.id) FILTER (WHERE NOT i.concluido) AS abertos,
           count(i.id) FILTER (WHERE i.concluido) AS marcados
         FROM gc_cliente_jornada j
         LEFT JOIN gc_checklist_itens i ON i.gc_cliente_jornada_id = j.id
         WHERE j.gc_cliente_id = $1
         GROUP BY j.id ORDER BY j.ordem, j.created_at`,
        [req.params.id]
      );
      if (jornada.length === 0) return reply.status(404).send({ message: 'Cliente sem jornada' });

      const alvo = etapa_modelo_id === 'fim' ? jornada.length : jornada.findIndex((j) => j.etapa_id === etapa_modelo_id);
      if (alvo < 0) return reply.status(404).send({ message: 'Etapa de destino não encontrada' });
      const atual = jornada.findIndex((j) => j.status !== 'concluida');
      const atualIdx = atual < 0 ? jornada.length : atual;
      const destinoNome = alvo >= jornada.length ? 'Jornada concluída' : jornada[alvo].nome;
      const origemNome = atualIdx >= jornada.length ? 'Jornada concluída' : jornada[atualIdx].nome;

      if (alvo === atualIdx) return { sem_mudanca: true, origem: origemNome, destino: destinoNome };

      const fechar = jornada
        .slice(0, alvo)
        .filter((j) => j.status !== 'concluida' || Number(j.abertos) > 0)
        .map((j) => ({ nome: j.nome, itens_abertos: Number(j.abertos) }));
      const reabrir = jornada
        .slice(alvo)
        .filter((j) => j.status === 'concluida')
        .map((j) => ({ nome: j.nome, itens_marcados: Number(j.marcados) }));

      if (!confirmar) return { origem: origemNome, destino: destinoNome, fechar, reabrir };

      await withTransaction(async (client) => {
        for (const [i, j] of jornada.entries()) {
          if (i < alvo) {
            // Ficou pra trás: concluída, com os itens que faltavam.
            await client.query(
              `UPDATE gc_cliente_jornada SET status = 'concluida', concluida_em = COALESCE(concluida_em, NOW()),
                 updated_at = NOW() WHERE id = $1`,
              [j.id]
            );
            await client.query(
              `UPDATE gc_checklist_itens
               SET concluido = true, concluido_por = COALESCE(concluido_por, $2),
                   concluido_em = COALESCE(concluido_em, NOW()), updated_at = NOW()
               WHERE gc_cliente_jornada_id = $1 AND NOT concluido`,
              [j.id, sub]
            );
            continue;
          }
          const reabre = j.status === 'concluida';
          if (reabre) {
            // Reaberta: sem desmarcar os itens ela ficaria "em andamento" com checklist 100%.
            await client.query(
              `UPDATE gc_checklist_itens
               SET concluido = false, concluido_por = NULL, concluido_em = NULL, updated_at = NOW()
               WHERE gc_cliente_jornada_id = $1`,
              [j.id]
            );
          }
          const novoStatus = i === alvo ? 'em_andamento' : reabre || j.status === 'em_andamento' ? 'pendente' : j.status;
          await client.query(
            `UPDATE gc_cliente_jornada SET status = $2,
               concluida_em = CASE WHEN $2 = 'concluida' THEN concluida_em ELSE NULL END, updated_at = NOW()
             WHERE id = $1`,
            [j.id, novoStatus]
          );
        }
      });

      const efeitos = [
        fechar.length ? `Concluídas: ${fechar.map((f) => f.nome).join(', ')}` : '',
        reabrir.length ? `Reabertas: ${reabrir.map((r) => r.nome).join(', ')}` : '',
      ].filter(Boolean).join(' · ');
      await registrarEvento(req.params.id, `Etapa movida: ${origemNome} → ${destinoNome}`, efeitos, sub);
      return { ok: true, origem: origemNome, destino: destinoNome };
    }
  );

  // ------------------------------------------------------------------ serviços
  app.post<{ Params: { id: string }; Body: Record<string, unknown> }>(
    '/api/gc/clientes/:id/servicos',
    autenticado,
    async (req, reply) => {
      const { sub } = req.user as { sub: string };
      const body = req.body ?? {};
      if (!body.tipo) return reply.status(400).send({ message: 'tipo é obrigatório' });
      // Sem a data de renovação ninguém é avisado de que o contrato está acabando — e renovação é a
      // hora em que o cliente decide sozinho se fica. Por isso é obrigatória já no cadastro.
      if (!body.data_renovacao) {
        return reply.status(400).send({ message: 'Informe a data de renovação do serviço' });
      }
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
      // Dá pra trocar a data, não dá pra apagá-la: serviço sem renovação deixa de ser acompanhado.
      if ('data_renovacao' in (req.body ?? {}) && !(req.body ?? {}).data_renovacao) {
        return reply.status(400).send({ message: 'A data de renovação é obrigatória — troque por outra em vez de apagar' });
      }
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

  // POST /api/gc/clientes/:id/jornada/ja-em-andamento — "este cliente já estava rodando antes do módulo":
  // todas as etapas até o Go-live ficam "concluídas antes do módulo", SEM data (não há data verdadeira
  // pra colocar) e a etapa seguinte abre. Etapas depois do Go-live seguem normais.
  app.post<{ Params: { id: string } }>(
    '/api/gc/clientes/:id/jornada/ja-em-andamento',
    autenticado,
    async (req, reply) => {
      const { sub } = req.user as { sub: string };
      const existe = await queryOne('SELECT 1 FROM gc_clientes WHERE id = $1', [req.params.id]);
      if (!existe) return reply.status(404).send({ message: 'Cliente não encontrado' });
      const resultado = await aplicarJaEmAndamento(req.params.id);
      if (resultado.etapas === 0) {
        return reply.status(409).send({ message: 'Não achei a etapa "Go-live" na jornada deste cliente.' });
      }
      await registrarEvento(
        req.params.id, 'Cliente já em andamento',
        `${resultado.etapas} etapa(s) até o Go-live marcadas como concluídas antes do módulo`, sub
      );
      return resultado;
    }
  );

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
    const item = await queryOne<{ gc_cliente_jornada_id: string | null; titulo: string; recorrente_chave: string | null }>(
      'SELECT gc_cliente_jornada_id, titulo, recorrente_chave FROM gc_checklist_itens WHERE id = $1',
      [req.params.id]
    );
    if (!item) return reply.status(404).send({ message: 'Item não encontrado' });

    const { concluido, titulo, prazo, responsavel_id } = req.body ?? {};
    // Relatório publicado e alinhamento do mês se marcam sozinhos, a partir dos fatos (o relatório
    // publicado; a nota de reunião/alinhamento). Marcar à mão deixaria o item mentir.
    const automatico =
      (item.gc_cliente_jornada_id !== null &&
        ['Relatório do mês publicado', 'Alinhamento mensal com o cliente'].includes(item.titulo)) ||
      item.recorrente_chave === 'relatorio' ||
      item.recorrente_chave === 'alinhamento';
    if (automatico && concluido !== undefined) {
      return reply.status(409).send({
        message: 'Esse item se marca sozinho: o relatório precisa ser publicado, ou uma nota de "Reunião/alinhamento" registrada.',
      });
    }
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
    await sincronizarRotinaAutomatica(req.params.id);
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
      await sincronizarRotinaAutomatica((atualizado as { gc_cliente_id: string }).gc_cliente_id);
      return atualizado;
    }
  );

  app.delete<{ Params: { id: string } }>('/api/gc/historico/:id', autenticado, async (req, reply) => {
    const apagado = await queryOne<{ gc_cliente_id: string }>(
      'DELETE FROM gc_historico WHERE id = $1 RETURNING gc_cliente_id',
      [req.params.id]
    );
    if (!apagado) return reply.status(404).send({ message: 'Registro não encontrado' });
    await sincronizarRotinaAutomatica(apagado.gc_cliente_id);
    return reply.status(204).send();
  });

  // ------------------------------------------------------------------ infos do mês ("Adicionar info")
  // GET /api/gc/clientes/:id/infos?periodo=YYYY-MM-DD — as informações livres do mês (ou de todos, sem período).
  app.get<{ Params: { id: string }; Querystring: { periodo?: string } }>(
    '/api/gc/clientes/:id/infos',
    autenticado,
    async (req) => {
      return query(
        `SELECT i.id, i.gc_cliente_id, to_char(i.periodo_inicio, 'YYYY-MM-DD') AS periodo_inicio, i.titulo, i.valor,
                i.observacao, i.no_relatorio, i.created_at, p.name AS autor_nome
         FROM gc_infos_mes i LEFT JOIN profiles p ON p.id = i.autor_id
         WHERE i.gc_cliente_id = $1 AND ($2::date IS NULL OR i.periodo_inicio = $2::date)
         ORDER BY i.periodo_inicio DESC, i.created_at`,
        [req.params.id, req.query.periodo ? req.query.periodo.slice(0, 10) : null]
      );
    }
  );

  app.post<{
    Params: { id: string };
    Body: { periodo_inicio?: string; titulo?: string; valor?: string; observacao?: string; no_relatorio?: boolean };
  }>('/api/gc/clientes/:id/infos', autenticado, async (req, reply) => {
    const { sub } = req.user as { sub: string };
    const b = req.body ?? {};
    if (!b.titulo?.trim()) return reply.status(400).send({ message: 'Dê um título à informação' });
    if (!b.periodo_inicio || !/^\d{4}-\d{2}-\d{2}/.test(b.periodo_inicio)) {
      return reply.status(400).send({ message: 'periodo_inicio é obrigatório' });
    }
    const criada = await queryOne(
      `INSERT INTO gc_infos_mes (gc_cliente_id, periodo_inicio, titulo, valor, observacao, no_relatorio, autor_id)
       VALUES ($1, $2::date, $3, $4, $5, $6, $7)
       RETURNING id, gc_cliente_id, to_char(periodo_inicio, 'YYYY-MM-DD') AS periodo_inicio, titulo, valor,
                 observacao, no_relatorio, created_at`,
      [req.params.id, b.periodo_inicio.slice(0, 10), b.titulo.trim(), (b.valor ?? '').trim(), (b.observacao ?? '').trim(), Boolean(b.no_relatorio), sub]
    );
    return reply.status(201).send(criada);
  });

  app.patch<{ Params: { id: string }; Body: Record<string, unknown> }>(
    '/api/gc/infos/:id',
    autenticado,
    async (req, reply) => {
      const corpo = { ...(req.body ?? {}) };
      if (typeof corpo.titulo === 'string' && !corpo.titulo.trim()) {
        return reply.status(400).send({ message: 'O título não pode ficar vazio' });
      }
      const { sets, params } = montarUpdate(['titulo', 'valor', 'observacao', 'no_relatorio'], corpo);
      if (!sets.length) return reply.status(400).send({ message: 'Nada para atualizar' });
      params.push(req.params.id);
      const atualizada = await queryOne(
        `UPDATE gc_infos_mes SET ${sets.join(', ')}, updated_at = NOW() WHERE id = $${params.length}
         RETURNING id, gc_cliente_id, to_char(periodo_inicio, 'YYYY-MM-DD') AS periodo_inicio, titulo, valor,
                   observacao, no_relatorio, created_at`,
        params
      );
      if (!atualizada) return reply.status(404).send({ message: 'Informação não encontrada' });
      return atualizada;
    }
  );

  app.delete<{ Params: { id: string } }>('/api/gc/infos/:id', autenticado, async (req, reply) => {
    const apagada = await queryOne('DELETE FROM gc_infos_mes WHERE id = $1 RETURNING id', [req.params.id]);
    if (!apagada) return reply.status(404).send({ message: 'Informação não encontrada' });
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
      /** A pessoa viu os avisos de números incoerentes e quer salvar mesmo assim. */
      confirmar_avisos?: boolean;
    };
  }>('/api/gc/metricas', autenticado, async (req, reply) => {
    const { sub } = req.user as { sub: string };
    const {
      gc_cliente_id, gc_servico_id, periodo_inicio, periodo_fim, fonte, valores, confirmar_avisos,
    } = req.body ?? {};
    if (!gc_cliente_id || !periodo_inicio || !periodo_fim) {
      return reply.status(400).send({ message: 'Informe o cliente e o período' });
    }
    const origem = fonte ?? 'manual';

    // Número impossível (cliques acima de impressões...) só entra com confirmação explícita. A tela
    // já avisa, mas a regra vale AQUI: é o que impede a API direta de gravar sem ninguém ter visto.
    if (!confirmar_avisos) {
      const avisos = validarMetricas(await valoresFinais(gc_cliente_id, periodo_inicio, origem, valores ?? {}));
      if (avisos.length > 0) {
        return reply.status(409).send({
          message: 'Esses números não batem: ' + avisos.join('; '),
          avisos,
          exige_confirmacao: true,
        });
      }
    }
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

  // PUT /api/gc/metricas/lote — grava o mês de VÁRIOS clientes de uma vez (a grade "Lançar mês" da
  // tela de Tráfego). Tudo numa transação: ou entra o mês inteiro, ou nada — meio mês gravado
  // deixaria a carteira com uns clientes atualizados e outros não, sem ninguém saber quais.
  // Mesma regra do lançamento individual: valor vazio APAGA o lançamento, zero é um número.
  app.put<{
    Body: {
      periodo?: string;
      linhas?: { gc_cliente_id: string; valores: Record<string, number | string | null> }[];
      confirmar_avisos?: boolean;
    };
  }>('/api/gc/metricas/lote', autenticado, async (req, reply) => {
    const { sub } = req.user as { sub: string };
    const { periodo, linhas, confirmar_avisos } = req.body ?? {};
    if (!periodo || !/^\d{4}-\d{2}$/.test(periodo)) {
      return reply.status(400).send({ message: 'periodo deve ser YYYY-MM' });
    }
    if (!Array.isArray(linhas) || linhas.length === 0) {
      return reply.status(400).send({ message: 'Nenhuma linha pra salvar' });
    }
    const [inicio] = mesesDeReferencia(periodo);

    // Mesma regra do lançamento individual, por cliente, com o nome na frente de cada aviso.
    if (!confirmar_avisos) {
      const avisos: string[] = [];
      for (const linha of linhas) {
        const achados = validarMetricas(
          await valoresFinais(linha.gc_cliente_id, inicio, 'manual', linha.valores ?? {})
        );
        if (achados.length === 0) continue;
        const cli = await queryOne<{ nome_empresa: string }>(
          'SELECT nome_empresa FROM gc_clientes WHERE id = $1',
          [linha.gc_cliente_id]
        );
        for (const a of achados) avisos.push(`${cli?.nome_empresa ?? 'Cliente'}: ${a}`);
      }
      if (avisos.length > 0) {
        return reply.status(409).send({
          message: 'Esses números não batem: ' + avisos.join('; '),
          avisos,
          exige_confirmacao: true,
        });
      }
    }

    let gravados = 0;
    let apagados = 0;
    await withTransaction(async (client) => {
      for (const linha of linhas) {
        for (const [chave, valor] of Object.entries(linha.valores ?? {})) {
          if (valor === null || valor === undefined || valor === '') {
            const r = await client.query(
              `DELETE FROM gc_metricas
               WHERE gc_cliente_id = $1 AND periodo_inicio = $2::date AND fonte = 'manual' AND chave = $3`,
              [linha.gc_cliente_id, inicio, chave]
            );
            apagados += r.rowCount ?? 0;
            continue;
          }
          await client.query(
            `INSERT INTO gc_metricas
               (gc_cliente_id, periodo_inicio, periodo_fim, fonte, chave, valor, criado_por)
             VALUES ($1, $2::date, (date_trunc('month', $2::date) + INTERVAL '1 month - 1 day')::date,
                     'manual', $3, $4, $5)
             ON CONFLICT (gc_cliente_id, periodo_inicio, periodo_fim, fonte, chave)
             DO UPDATE SET valor = EXCLUDED.valor, criado_por = EXCLUDED.criado_por, updated_at = NOW()`,
            [linha.gc_cliente_id, inicio, chave, Number(valor), sub]
          );
          gravados++;
        }
      }
    });
    return { clientes: linhas.length, gravados, apagados };
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

  // ------------------------------------------------------------------ gestão dos modelos de estratégia
  // Criar, editar e desativar os MODELOS. Aplicar um modelo num cliente COPIA nome e passos, então
  // mexer aqui não reescreve o que já está rodando em ninguém — por isso editar é seguro e não
  // existe "excluir": o que não serve mais é desativado e some dos seletores, sem apagar a origem
  // das estratégias que já foram aplicadas.
  const TIPOS_SERVICO_VALIDOS = ['trafego_meta', 'trafego_google', 'central_ia', 'site', 'automacao', 'outro'];

  app.post<{
    Body: { nome?: string; descricao?: string; servico_tipo?: string | null; passos?: string[] };
  }>('/api/gc/modelos/estrategias', autenticado, async (req, reply) => {
    const { nome, descricao, servico_tipo, passos } = req.body ?? {};
    if (!nome?.trim()) return reply.status(400).send({ message: 'Dê um nome pra estratégia' });
    if (servico_tipo && !TIPOS_SERVICO_VALIDOS.includes(servico_tipo)) {
      return reply.status(400).send({ message: 'Tipo de serviço inválido' });
    }
    const criado = await withTransaction(async (client) => {
      const { rows } = await client.query(
        `INSERT INTO gc_estrategias_modelo (nome, descricao, servico_tipo)
         VALUES ($1, $2, $3) RETURNING *`,
        [nome.trim(), descricao ?? '', servico_tipo || null]
      );
      for (const [i, titulo] of (passos ?? []).filter((t) => t?.trim()).entries()) {
        await client.query(
          'INSERT INTO gc_estrategias_modelo_itens (estrategia_modelo_id, titulo, ordem) VALUES ($1, $2, $3)',
          [rows[0].id, titulo.trim(), i]
        );
      }
      return rows[0];
    });
    return reply.status(201).send(criado);
  });

  app.patch<{ Params: { id: string }; Body: Record<string, unknown> }>(
    '/api/gc/modelos/estrategias/:id',
    autenticado,
    async (req, reply) => {
      const corpo = { ...(req.body ?? {}) };
      if (corpo.servico_tipo && !TIPOS_SERVICO_VALIDOS.includes(String(corpo.servico_tipo))) {
        return reply.status(400).send({ message: 'Tipo de serviço inválido' });
      }
      if (typeof corpo.nome === 'string' && !corpo.nome.trim()) {
        return reply.status(400).send({ message: 'O nome não pode ficar vazio' });
      }
      const { sets, params } = montarUpdate(['nome', 'descricao', 'servico_tipo', 'ativo'], corpo);
      if (!sets.length) return reply.status(400).send({ message: 'Nada para atualizar' });
      params.push(req.params.id);
      const atualizado = await queryOne(
        `UPDATE gc_estrategias_modelo SET ${sets.join(', ')}, updated_at = NOW()
         WHERE id = $${params.length} RETURNING *`,
        params
      );
      if (!atualizado) return reply.status(404).send({ message: 'Modelo não encontrado' });
      return atualizado;
    }
  );

  app.post<{ Params: { id: string }; Body: { titulo?: string } }>(
    '/api/gc/modelos/estrategias/:id/passos',
    autenticado,
    async (req, reply) => {
      const titulo = req.body?.titulo?.trim();
      if (!titulo) return reply.status(400).send({ message: 'Escreva o passo' });
      const criado = await queryOne(
        `INSERT INTO gc_estrategias_modelo_itens (estrategia_modelo_id, titulo, ordem)
         VALUES ($1, $2, (SELECT COALESCE(MAX(ordem), -1) + 1 FROM gc_estrategias_modelo_itens
                          WHERE estrategia_modelo_id = $1))
         RETURNING *`,
        [req.params.id, titulo]
      );
      return reply.status(201).send(criado);
    }
  );

  // PUT .../passos/ordem — define a ordem dos passos de uma vez, pela lista de ids na ordem nova.
  app.put<{ Params: { id: string }; Body: { ids?: string[] } }>(
    '/api/gc/modelos/estrategias/:id/passos/ordem',
    autenticado,
    async (req, reply) => {
      const ids = req.body?.ids;
      if (!Array.isArray(ids)) return reply.status(400).send({ message: 'ids é obrigatório' });
      await withTransaction(async (client) => {
        for (const [i, id] of ids.entries()) {
          await client.query(
            `UPDATE gc_estrategias_modelo_itens SET ordem = $1, updated_at = NOW()
             WHERE id = $2 AND estrategia_modelo_id = $3`,
            [i, id, req.params.id]
          );
        }
      });
      return { ok: true };
    }
  );

  app.patch<{ Params: { id: string }; Body: { titulo?: string } }>(
    '/api/gc/modelos/passos/:id',
    autenticado,
    async (req, reply) => {
      const titulo = req.body?.titulo?.trim();
      if (!titulo) return reply.status(400).send({ message: 'O passo não pode ficar vazio' });
      const atualizado = await queryOne(
        'UPDATE gc_estrategias_modelo_itens SET titulo = $1, updated_at = NOW() WHERE id = $2 RETURNING *',
        [titulo, req.params.id]
      );
      if (!atualizado) return reply.status(404).send({ message: 'Passo não encontrado' });
      return atualizado;
    }
  );

  app.delete<{ Params: { id: string } }>('/api/gc/modelos/passos/:id', autenticado, async (req, reply) => {
    const apagado = await queryOne('DELETE FROM gc_estrategias_modelo_itens WHERE id = $1 RETURNING id', [
      req.params.id,
    ]);
    if (!apagado) return reply.status(404).send({ message: 'Passo não encontrado' });
    return reply.status(204).send();
  });

  // ------------------------------------------------------------------ pendências (todos os clientes)
  // GET /api/gc/pendencias — os itens de checklist ABERTOS de todos os clientes que contam (ativos e
  // não-teste), numa lista só: é o "o que está pendente na carteira?" sem abrir cliente por cliente.
  //
  // O responsável efetivo cai em cascata — item, depois etapa/estratégia, depois o cliente —,
  // porque quase ninguém atribui item por item, e filtrar só pelo campo do item deixaria quase
  // tudo "sem responsável". Atraso é comparado em horário de Brasília.
  app.get('/api/gc/pendencias', autenticado, async () => {
    await garantirRecorrentes();
    await sincronizarRotinaAutomatica();
    const itens = await query<{ prazo: string | null; atrasado: boolean; cliente_nome: string }>(
      `SELECT i.id, i.titulo, i.prazo, i.ordem,
         c.id AS cliente_id, c.nome_empresa AS cliente_nome,
         CASE WHEN i.recorrente_chave IS NOT NULL THEN 'rotina'
              WHEN i.gc_cliente_jornada_id IS NOT NULL THEN 'jornada'
              ELSE 'estrategia' END AS origem,
         COALESCE(j.nome, e.nome, 'Rotina mensal') AS origem_nome,
         COALESCE(i.responsavel_id, j.responsavel_id, e.responsavel_id, c.responsavel_id) AS responsavel_id,
         pr.name AS responsavel_nome,
         (i.prazo IS NOT NULL AND i.prazo < ${HOJE}) AS atrasado
       FROM gc_checklist_itens i
       JOIN gc_clientes c ON c.id = i.gc_cliente_id
       LEFT JOIN gc_cliente_jornada j ON j.id = i.gc_cliente_jornada_id
       LEFT JOIN gc_cliente_estrategias e ON e.id = i.gc_cliente_estrategia_id
       LEFT JOIN profiles pr
         ON pr.id = COALESCE(i.responsavel_id, j.responsavel_id, e.responsavel_id, c.responsavel_id)
       WHERE NOT i.concluido
         AND c.status = 'ativo' AND NOT c.fora_dos_totais
         -- Etapa que ainda nem começou não é pendência de ninguém agora: o checklist dela só vira
         -- trabalho quando a etapa abre. Estratégia aplicada entra sempre.
         AND (j.id IS NULL OR j.status <> 'pendente')
         -- Itens automáticos da jornada têm a rotina mensal como pendência de verdade.
         AND NOT (i.gc_cliente_jornada_id IS NOT NULL AND i.titulo IN ${TITULOS_AUTOMATICOS_SQL})
       ORDER BY (i.prazo IS NOT NULL AND i.prazo < ${HOJE}) DESC, i.prazo ASC NULLS LAST,
                c.nome_empresa, i.ordem
       LIMIT 1000`
    );
    // O lembrete do planejamento "aguardando o cliente" aparece aqui sem ser um item gravado: ele existe
    // enquanto o planejamento estiver nesse estado e com data. Preencher o ponto A (ou desmarcar o
    // "aguardando") o faz sumir sozinho, sem item órfão pra alguém ter de concluir à mão.
    const lembretes = await query<Record<string, unknown>>(
      `SELECT 'plan-' || c.id AS id, 'Completar planejamento — ' || c.nome_empresa AS titulo,
         to_char(pl.lembrar_em, 'YYYY-MM-DD') AS prazo, 0 AS ordem,
         c.id AS cliente_id, c.nome_empresa AS cliente_nome,
         'planejamento' AS origem, 'Planejamento' AS origem_nome,
         c.responsavel_id, pr.name AS responsavel_nome,
         (pl.lembrar_em < ${HOJE}) AS atrasado
       FROM gc_planejamento pl
       JOIN gc_clientes c ON c.id = pl.gc_cliente_id
       LEFT JOIN profiles pr ON pr.id = c.responsavel_id
       WHERE pl.aguardando_cliente AND pl.lembrar_em IS NOT NULL
         AND c.status = 'ativo' AND NOT c.fora_dos_totais`
    );
    return [...itens, ...lembretes].sort((a, b) => {
      if (a.atrasado !== b.atrasado) return a.atrasado ? -1 : 1;
      if (a.prazo !== b.prazo) return a.prazo === null ? 1 : b.prazo === null ? -1 : String(a.prazo).localeCompare(String(b.prazo));
      return String(a.cliente_nome).localeCompare(String(b.cliente_nome));
    });
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

  // ------------------------------------------------------------------ planejamento do cliente
  type Num = number | null;
  const numero = (v: unknown): Num => {
    if (v === null || v === undefined || v === '') return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  };
  const texto = (v: unknown): string => (typeof v === 'string' ? v : '');

  /** O planejamento do cliente no formato que a tela edita: ponto A, textos e metas por horizonte. */
  async function lerPlanejamento(clienteId: string) {
    const p = await queryOne<Record<string, unknown>>(
      `SELECT situacao_atual, leads_mes, investimento_mes, vendas_mes, faturamento_mensal,
              to_char(data_diagnostico, 'YYYY-MM-DD') AS data_diagnostico,
              aguardando_cliente, to_char(lembrar_em, 'YYYY-MM-DD') AS lembrar_em,
              portal_ativo, portal_mostrar_situacao, portal_mostrar_objetivo, origens
       FROM gc_planejamento WHERE gc_cliente_id = $1`,
      [clienteId]
    );
    // A estratégia e as premissas são UM texto só ("Estratégia e premissas"), guardado na coluna da estratégia.
    const cenarios = await query<{ horizonte: string; onde_quer_chegar: string; estrategia: string }>(
      'SELECT horizonte, onde_quer_chegar, estrategia FROM gc_planejamento_cenarios WHERE gc_cliente_id = $1',
      [clienteId]
    );
    // Se existirem duas metas ativas da mesma métrica e horizonte (dá pra criar na aba antiga), vale
    // a mais recente — é a que o editor atualiza. CPL e ROAS não entram: são calculados na tela.
    const metas = await query<{ horizonte: string; chave_metrica: string; valor_meta: string }>(
      `SELECT DISTINCT ON (horizonte, chave_metrica) horizonte, chave_metrica, valor_meta
       FROM gc_metas
       WHERE gc_cliente_id = $1 AND status = 'ativa' AND horizonte = ANY($2) AND chave_metrica = ANY($3)
       ORDER BY horizonte, chave_metrica, created_at DESC`,
      [clienteId, [...HORIZONTES_PLANEJAMENTO], [...CHAVES_DIGITADAS]]
    );
    const porHorizonte: Record<string, {
      onde_quer_chegar: string; estrategia: string; metas: Record<string, number>;
    }> = {};
    for (const h of HORIZONTES_PLANEJAMENTO) {
      const t = cenarios.find((c) => c.horizonte === h);
      porHorizonte[h] = {
        onde_quer_chegar: t?.onde_quer_chegar ?? '',
        estrategia: t?.estrategia ?? '',
        metas: Object.fromEntries(
          metas.filter((m) => m.horizonte === h).map((m) => [m.chave_metrica, Number(m.valor_meta)])
        ),
      };
    }
    const pontoA: PontoA = {
      leads_mes: numero(p?.leads_mes), investimento_mes: numero(p?.investimento_mes),
      vendas_mes: numero(p?.vendas_mes), faturamento_mensal: numero(p?.faturamento_mensal),
    };
    return {
      existe: !!p,
      atual: {
        situacao_atual: texto(p?.situacao_atual),
        ...pontoA,
        // Calculados: ticket = faturamento ÷ vendas; conversão = vendas ÷ leads (em %).
        ...derivadosDoPontoA(pontoA),
        data_diagnostico: (p?.data_diagnostico as string | null) ?? null,
        aguardando_cliente: Boolean(p?.aguardando_cliente),
        lembrar_em: (p?.lembrar_em as string | null) ?? null,
      },
      // A curva é sempre linear: o seletor linear/composta saiu da tela.
      curva: 'linear' as const,
      origens: sanearOrigens(p?.origens),
      portal: {
        ativo: Boolean(p?.portal_ativo),
        mostrar_situacao: Boolean(p?.portal_mostrar_situacao),
        mostrar_objetivo: Boolean(p?.portal_mostrar_objetivo),
      },
      cenarios: porHorizonte,
    };
  }

  app.get<{ Params: { id: string } }>('/api/gc/clientes/:id/planejamento', autenticado, async (req) => {
    return lerPlanejamento(req.params.id);
  });

  app.get<{ Params: { id: string } }>(
    '/api/gc/clientes/:id/planejamento/historico',
    autenticado,
    async (req) => {
      return query(
        `SELECT h.id, h.alterado_em, h.mudancas, p.name AS autor_nome
         FROM gc_planejamento_historico h LEFT JOIN profiles p ON p.id = h.alterado_por
         WHERE h.gc_cliente_id = $1 ORDER BY h.alterado_em DESC LIMIT 100`,
        [req.params.id]
      );
    }
  );

  // ---- modelos de texto do planejamento (situação de hoje, onde quer chegar, estratégia e premissas)
  const CAMPOS_DE_MODELO = ['situacao', 'objetivo', 'estrategia'];

  app.get<{ Querystring: { todos?: string } }>('/api/gc/planejamento/modelos', autenticado, async (req) => {
    // O seletor só oferece modelo ATIVO; a janela de gestão pede "todos" pra poder reativar.
    return query(
      `SELECT id, campo, nome, texto, ordem, ativo FROM gc_planejamento_modelos
       ${req.query.todos === '1' ? '' : 'WHERE ativo'} ORDER BY campo, ordem, created_at`
    );
  });

  app.post<{ Body: { campo?: string; nome?: string; texto?: string } }>(
    '/api/gc/planejamento/modelos',
    autenticado,
    async (req, reply) => {
      const { campo, nome, texto: conteudo } = req.body ?? {};
      if (!campo || !CAMPOS_DE_MODELO.includes(campo)) return reply.status(400).send({ message: 'campo inválido' });
      if (!nome?.trim()) return reply.status(400).send({ message: 'Dê um nome ao modelo' });
      const criado = await queryOne(
        `INSERT INTO gc_planejamento_modelos (campo, nome, texto, ordem)
         VALUES ($1, $2, $3, (SELECT COALESCE(MAX(ordem), -1) + 1 FROM gc_planejamento_modelos WHERE campo = $1))
         RETURNING id, campo, nome, texto, ordem, ativo`,
        [campo, nome.trim(), conteudo ?? '']
      );
      return reply.status(201).send(criado);
    }
  );

  app.patch<{ Params: { id: string }; Body: Record<string, unknown> }>(
    '/api/gc/planejamento/modelos/:id',
    autenticado,
    async (req, reply) => {
      const corpo = { ...(req.body ?? {}) };
      if (typeof corpo.nome === 'string' && !corpo.nome.trim()) {
        return reply.status(400).send({ message: 'O nome não pode ficar vazio' });
      }
      const { sets, params } = montarUpdate(['nome', 'texto', 'ordem', 'ativo'], corpo);
      if (!sets.length) return reply.status(400).send({ message: 'Nada para atualizar' });
      params.push(req.params.id);
      const atualizado = await queryOne(
        `UPDATE gc_planejamento_modelos SET ${sets.join(', ')}, updated_at = NOW()
         WHERE id = $${params.length} RETURNING id, campo, nome, texto, ordem, ativo`,
        params
      );
      if (!atualizado) return reply.status(404).send({ message: 'Modelo não encontrado' });
      return atualizado;
    }
  );

  // Modelo é só texto de apoio, sem referência de ninguém: pode apagar de verdade (o texto que já foi
  // aplicado num planejamento é cópia e continua lá).
  app.delete<{ Params: { id: string } }>('/api/gc/planejamento/modelos/:id', autenticado, async (req, reply) => {
    const apagado = await queryOne('DELETE FROM gc_planejamento_modelos WHERE id = $1 RETURNING id', [req.params.id]);
    if (!apagado) return reply.status(404).send({ message: 'Modelo não encontrado' });
    return reply.status(204).send();
  });

  app.put<{ Body: { campo?: string; ids?: string[] } }>(
    '/api/gc/planejamento/modelos/ordem',
    autenticado,
    async (req, reply) => {
      const { campo, ids } = req.body ?? {};
      if (!campo || !CAMPOS_DE_MODELO.includes(campo) || !Array.isArray(ids)) {
        return reply.status(400).send({ message: 'campo e ids são obrigatórios' });
      }
      await withTransaction(async (client) => {
        for (const [i, id] of ids.entries()) {
          await client.query(
            'UPDATE gc_planejamento_modelos SET ordem = $1, updated_at = NOW() WHERE id = $2 AND campo = $3',
            [i, id, campo]
          );
        }
      });
      return { ok: true };
    }
  );

  // GET /api/gc/clientes/:id/planejamento/previa-portal — "ver como o cliente vê". Devolve o bloco
  // "Nossa jornada" EXATAMENTE como o portal entregaria, montado pelo mesmo caminho, só que mesmo
  // com o toggle desligado — é pra conferir antes de ligar. Reflete o que está SALVO.
  app.get<{ Params: { id: string } }>(
    '/api/gc/clientes/:id/planejamento/previa-portal',
    autenticado,
    async (req) => {
      const ligado = Boolean(
        (await queryOne<{ portal_ativo: boolean }>(
          'SELECT portal_ativo FROM gc_planejamento WHERE gc_cliente_id = $1',
          [req.params.id]
        ))?.portal_ativo
      );
      return { ligado, jornada: await jornadaDoPortal(req.params.id, { ignorarToggle: true }) };
    }
  );

  // PUT /api/gc/clientes/:id/planejamento — grava o planejamento INTEIRO de uma vez: ponto A, lembrete
  // e, por horizonte, os dois textos e as quatro metas digitadas. Tudo numa transação, com o diff
  // contra o que estava gravado indo pro histórico.
  //
  // TUDO é opcional: salvar vazio, só com texto ou com parte dos números sempre funciona. Número
  // ausente vira NULL (não informado), que é diferente de zero.
  //
  // Os números das metas vão pra gc_metas (horizontes 6_meses e 12_meses), não pra tabela própria:
  //  - meta que já existe só tem o VALOR atualizado — base, data e prazo ficam como estavam, pra
  //    não mexer no progresso do que já foi combinado;
  //  - meta nova nasce com a base calculada do ponto A e o prazo a 6 ou 12 meses do diagnóstico;
  //  - campo deixado em branco no editor APAGA aquela meta (foi a pessoa que limpou), sem confirmação;
  //  - CPL e ROAS não se gravam: são calculados. Metas antigas dessas duas chaves nos horizontes de 6 e
  //    12 meses são removidas ao salvar, pra não sobrar um número que diverge do calculado.
  //
  // As opções do portal só mudam se vierem no corpo: a tela de Relatórios tem endpoint próprio pra elas.
  type CorpoPlanejamento = {
    atual?: Record<string, unknown>;
    portal?: { ativo?: boolean; mostrar_situacao?: boolean; mostrar_objetivo?: boolean };
    origens?: unknown;
    cenarios?: Record<string, { onde_quer_chegar?: string; estrategia?: string; metas?: Record<string, unknown> }>;
  };
  const dataValida = (v: unknown): string | null =>
    typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : null;

  app.put<{ Params: { id: string }; Body: CorpoPlanejamento }>(
    '/api/gc/clientes/:id/planejamento',
    autenticado,
    async (req, reply) => {
      const { sub } = req.user as { sub: string };
      const corpo = req.body ?? {};
      const a = corpo.atual ?? {};

      const pontoA: PontoA = {
        leads_mes: numero(a.leads_mes), investimento_mes: numero(a.investimento_mes),
        vendas_mes: numero(a.vendas_mes), faturamento_mensal: numero(a.faturamento_mensal),
      };
      const NOMES: Record<string, string> = {
        leads_mes: 'Leads', investimento_mes: 'Investimento', vendas_mes: 'Vendas', faturamento_mensal: 'Faturamento',
      };
      for (const [k, v] of Object.entries(pontoA)) {
        if (v !== null && v < 0) return reply.status(400).send({ message: `${NOMES[k]} não pode ser negativo` });
      }
      for (const h of HORIZONTES_PLANEJAMENTO) {
        for (const [k, v] of Object.entries(corpo.cenarios?.[h]?.metas ?? {})) {
          const n = numero(v);
          if (n !== null && n < 0) return reply.status(400).send({ message: `A meta de ${k} não pode ser negativa` });
        }
      }
      const dataDiag = dataValida(a.data_diagnostico);
      const aguardando = Boolean(a.aguardando_cliente);
      // O lembrete só faz sentido enquanto se está aguardando o cliente.
      const lembrarEm = aguardando ? dataValida(a.lembrar_em) : null;
      const { ticket_medio: ticket, taxa_conversao: conversao } = derivadosDoPontoA(pontoA);
      const portalNoCorpo = corpo.portal !== undefined;

      const antes = await lerPlanejamento(req.params.id);

      await withTransaction(async (client) => {
        await client.query(
          `INSERT INTO gc_planejamento
             (gc_cliente_id, situacao_atual, leads_mes, investimento_mes, vendas_mes, ticket_medio,
              taxa_conversao, faturamento_mensal, data_diagnostico, curva, aguardando_cliente, lembrar_em,
              portal_ativo, portal_mostrar_situacao, portal_mostrar_objetivo, atualizado_por, origens)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'linear',$10,$11,$12,$13,$14,$15,$16)
           ON CONFLICT (gc_cliente_id) DO UPDATE SET
             situacao_atual = EXCLUDED.situacao_atual, leads_mes = EXCLUDED.leads_mes,
             investimento_mes = EXCLUDED.investimento_mes, vendas_mes = EXCLUDED.vendas_mes,
             ticket_medio = EXCLUDED.ticket_medio, taxa_conversao = EXCLUDED.taxa_conversao,
             faturamento_mensal = EXCLUDED.faturamento_mensal, data_diagnostico = EXCLUDED.data_diagnostico,
             curva = 'linear', aguardando_cliente = EXCLUDED.aguardando_cliente, lembrar_em = EXCLUDED.lembrar_em,
             ${portalNoCorpo
               ? `portal_ativo = EXCLUDED.portal_ativo, portal_mostrar_situacao = EXCLUDED.portal_mostrar_situacao,
             portal_mostrar_objetivo = EXCLUDED.portal_mostrar_objetivo,`
               : ''}
             atualizado_por = EXCLUDED.atualizado_por, origens = EXCLUDED.origens, updated_at = NOW()`,
          [
            req.params.id, texto(a.situacao_atual), pontoA.leads_mes, pontoA.investimento_mes,
            pontoA.vendas_mes, ticket, conversao, pontoA.faturamento_mensal, dataDiag, aguardando, lembrarEm,
            Boolean(corpo.portal?.ativo), Boolean(corpo.portal?.mostrar_situacao),
            Boolean(corpo.portal?.mostrar_objetivo), sub,
            // Campo sem número não tem origem: sobraria um "calculado" apontando pra nada.
            JSON.stringify(
              Object.fromEntries(
                Object.entries(sanearOrigens(corpo.origens)).filter(
                  ([campo]) => (pontoA as unknown as Record<string, unknown>)[campo] !== null
                )
              )
            ),
          ]
        );

        const base = baseDoPontoA(pontoA);
        // Sem data do diagnóstico, o prazo conta a partir de hoje (Brasília).
        const dataRef = dataDiag ?? `${mesDeHoje()}-01`;
        for (const h of HORIZONTES_PLANEJAMENTO) {
          const c = corpo.cenarios?.[h];
          if (!c) continue;
          await client.query(
            `INSERT INTO gc_planejamento_cenarios (gc_cliente_id, horizonte, onde_quer_chegar, estrategia, premissas)
             VALUES ($1,$2,$3,$4,'')
             ON CONFLICT (gc_cliente_id, horizonte) DO UPDATE SET
               onde_quer_chegar = EXCLUDED.onde_quer_chegar, estrategia = EXCLUDED.estrategia,
               premissas = '', updated_at = NOW()`,
            [req.params.id, h, texto(c.onde_quer_chegar), texto(c.estrategia)]
          );

          const meses = h === '6_meses' ? 6 : 12;
          for (const chave of CHAVES_DIGITADAS) {
            if (!(chave in (c.metas ?? {}))) continue;
            const valor = numero((c.metas ?? {})[chave]);
            const existente = await client.query(
              `SELECT id FROM gc_metas WHERE gc_cliente_id = $1 AND horizonte = $2 AND chave_metrica = $3
                 AND status = 'ativa' ORDER BY created_at DESC LIMIT 1`,
              [req.params.id, h, chave]
            );
            if (valor === null) {
              if (existente.rows[0]) await client.query('DELETE FROM gc_metas WHERE id = $1', [existente.rows[0].id]);
              continue;
            }
            if (existente.rows[0]) {
              await client.query(
                `UPDATE gc_metas SET valor_meta = $2, prazo = COALESCE(prazo, $3::date), updated_at = NOW() WHERE id = $1`,
                [existente.rows[0].id, valor, somarMesesNaData(dataRef, meses)]
              );
            } else {
              await client.query(
                `INSERT INTO gc_metas (gc_cliente_id, chave_metrica, horizonte, valor_base, data_base, valor_meta, prazo)
                 VALUES ($1,$2,$3,$4,$5,$6,$7)`,
                [req.params.id, chave, h, base[chave] ?? 0, dataRef, valor, somarMesesNaData(dataRef, meses)]
              );
            }
          }
        }
        await client.query(
          `DELETE FROM gc_metas WHERE gc_cliente_id = $1 AND horizonte = ANY($2) AND chave_metrica IN ('cpl','roas')`,
          [req.params.id, [...HORIZONTES_PLANEJAMENTO]]
        );
      });

      const depois = await lerPlanejamento(req.params.id);

      // O que mudou, por escopo — vira UMA linha de histórico.
      const origensComoCampos = (o: Record<string, { origem: string }>) =>
        Object.fromEntries(CAMPOS_COM_ORIGEM.map((c) => [`origem_${c}`, o[c]?.origem ?? null]));
      const escopoAtual = (x: typeof antes) => ({
        situacao_atual: x.atual.situacao_atual, leads_mes: x.atual.leads_mes, investimento_mes: x.atual.investimento_mes,
        vendas_mes: x.atual.vendas_mes, faturamento_mensal: x.atual.faturamento_mensal,
        data_diagnostico: x.atual.data_diagnostico, aguardando_cliente: x.atual.aguardando_cliente,
        lembrar_em: x.atual.lembrar_em, portal_ativo: x.portal.ativo,
        portal_mostrar_situacao: x.portal.mostrar_situacao, portal_mostrar_objetivo: x.portal.mostrar_objetivo,
        ...origensComoCampos(x.origens),
      });
      const mudancas: Mudanca[] = [...diffDeCampos('atual', escopoAtual(antes), escopoAtual(depois))];
      for (const h of HORIZONTES_PLANEJAMENTO) {
        const a0 = antes.cenarios[h];
        const d0 = depois.cenarios[h];
        const planos = (x: typeof a0) => ({
          onde_quer_chegar: x.onde_quer_chegar, estrategia: x.estrategia,
          ...Object.fromEntries(CHAVES_DIGITADAS.map((k) => [k, x.metas[k] ?? null])),
        });
        mudancas.push(...diffDeCampos(h, planos(a0), planos(d0)));
      }
      if (mudancas.length > 0) {
        await query(
          'INSERT INTO gc_planejamento_historico (gc_cliente_id, alterado_por, mudancas) VALUES ($1,$2,$3)',
          [req.params.id, sub, JSON.stringify(mudancas)]
        );
        const autor = await queryOne<{ name: string | null }>('SELECT name FROM profiles WHERE id = $1', [sub]);
        const mostra = (v: unknown) => (v === null || v === '' || v === undefined ? '—' : String(v).length > 60 ? `${String(v).slice(0, 60)}…` : String(v));
        const linhas = mudancas
          .slice(0, 15)
          .map((m) => `${m.escopo === 'atual' ? '' : `${m.escopo === '6_meses' ? '6 meses' : '12 meses'} · `}${m.rotulo}: ${mostra(m.antes)} → ${mostra(m.depois)}`);
        if (mudancas.length > 15) linhas.push(`… e mais ${mudancas.length - 15} alteração(ões)`);
        await registrarEvento(
          req.params.id,
          `Planejamento atualizado${autor?.name ? ` por ${autor.name}` : ''}`,
          linhas.join('\n'),
          sub
        );
      }
      return depois;
    }
  );

  // PUT /api/gc/clientes/:id/portal-jornada — as opções do bloco "Nossa jornada" do portal (ligar e os
  // dois textos opcionais). Mora na aba Relatórios, junto do link do portal, e muda só isso: o
  // planejamento em si não é tocado. Cria a linha do planejamento se ainda não existir (tudo em branco).
  app.put<{ Params: { id: string }; Body: { ativo?: boolean; mostrar_situacao?: boolean; mostrar_objetivo?: boolean } }>(
    '/api/gc/clientes/:id/portal-jornada',
    autenticado,
    async (req) => {
      const { sub } = req.user as { sub: string };
      const antes = await lerPlanejamento(req.params.id);
      const corpo = req.body ?? {};
      const ativo = Boolean(corpo.ativo);
      // Os textos só fazem sentido com o bloco ligado.
      const situacao = ativo && Boolean(corpo.mostrar_situacao);
      const objetivo = ativo && Boolean(corpo.mostrar_objetivo);
      await query(
        `INSERT INTO gc_planejamento (gc_cliente_id, portal_ativo, portal_mostrar_situacao, portal_mostrar_objetivo, atualizado_por)
         VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT (gc_cliente_id) DO UPDATE SET
           portal_ativo = EXCLUDED.portal_ativo, portal_mostrar_situacao = EXCLUDED.portal_mostrar_situacao,
           portal_mostrar_objetivo = EXCLUDED.portal_mostrar_objetivo, atualizado_por = EXCLUDED.atualizado_por,
           updated_at = NOW()`,
        [req.params.id, ativo, situacao, objetivo, sub]
      );
      const depois = await lerPlanejamento(req.params.id);
      const mudancas = diffDeCampos(
        'atual',
        { portal_ativo: antes.portal.ativo, portal_mostrar_situacao: antes.portal.mostrar_situacao, portal_mostrar_objetivo: antes.portal.mostrar_objetivo },
        { portal_ativo: depois.portal.ativo, portal_mostrar_situacao: depois.portal.mostrar_situacao, portal_mostrar_objetivo: depois.portal.mostrar_objetivo }
      );
      if (mudancas.length > 0) {
        await query(
          'INSERT INTO gc_planejamento_historico (gc_cliente_id, alterado_por, mudancas) VALUES ($1,$2,$3)',
          [req.params.id, sub, JSON.stringify(mudancas)]
        );
        await registrarEvento(req.params.id, 'Portal: "Nossa jornada" atualizado', `${mudancas.length} alteração(ões)`, sub);
      }
      return depois.portal;
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
  app.post<{ Params: { id: string }; Body: { snapshot?: GcSnapshot; confirmar_avisos?: boolean } }>(
    '/api/gc/relatorios/:id/publicar',
    autenticado,
    async (req, reply) => {
      const { sub } = req.user as { sub: string };
      const snapshot = req.body?.snapshot;
      if (!snapshot || !Array.isArray(snapshot.numeros)) {
        return reply.status(400).send({ message: 'snapshot inválido' });
      }
      // Relatório pro cliente sem número ou sem a leitura do gestor é relatório vazio. A tela já
      // desabilita o botão, mas a regra precisa valer AQUI: quem chama a API direto, ou uma tela
      // desatualizada, publicaria uma página em branco pro cliente.
      const alvo = await queryOne<{
        gc_cliente_id: string; periodo_inicio: string; periodo_fim: string; comentario_gestor: string;
      }>(
        'SELECT gc_cliente_id, periodo_inicio, periodo_fim, comentario_gestor FROM gc_relatorios WHERE id = $1',
        [req.params.id]
      );
      if (!alvo) return reply.status(404).send({ message: 'Relatório não encontrado' });
      const lancadas = await queryOne<{ total: string }>(
        `SELECT count(*) AS total FROM gc_metricas
         WHERE gc_cliente_id = $1 AND periodo_inicio >= $2 AND periodo_fim <= $3`,
        [alvo.gc_cliente_id, alvo.periodo_inicio, alvo.periodo_fim]
      );
      const faltando: string[] = [];
      if (Number(lancadas?.total ?? 0) === 0) faltando.push('métricas lançadas no período');
      if (!alvo.comentario_gestor?.trim()) faltando.push('comentário do gestor');
      if (faltando.length > 0) {
        return reply.status(400).send({
          message: `Pra publicar falta: ${faltando.join(' e ')}.`,
          faltando,
        });
      }

      // O relatório é o que o CLIENTE lê: número impossível aqui (cliques acima de impressões) é o
      // pior lugar pra ele aparecer. Só publica com confirmação explícita de quem viu os avisos.
      if (!req.body?.confirmar_avisos) {
        const doPeriodo = await query<{ chave: string; valor: string }>(
          `SELECT chave, valor FROM gc_metricas
           WHERE gc_cliente_id = $1 AND periodo_inicio >= $2 AND periodo_fim <= $3`,
          [alvo.gc_cliente_id, alvo.periodo_inicio, alvo.periodo_fim]
        );
        const numeros: Record<string, number> = {};
        for (const r of doPeriodo) numeros[r.chave] = Number(r.valor);
        const avisos = validarMetricas(numeros);
        if (avisos.length > 0) {
          return reply.status(409).send({
            message: 'Os números deste relatório não batem: ' + avisos.join('; '),
            avisos,
            exige_confirmacao: true,
          });
        }
      }

      const publicado = await queryOne<{ gc_cliente_id: string; periodo_inicio: string }>(
        `UPDATE gc_relatorios
         SET status = 'publicado', publicado_em = NOW(), publicado_por = $2,
             snapshot = $3, updated_at = NOW()
         WHERE id = $1 RETURNING *`,
        [req.params.id, sub, JSON.stringify({ ...snapshot, publicado_em: new Date().toISOString() })]
      );
      if (!publicado) return reply.status(404).send({ message: 'Relatório não encontrado' });
      // O item "Publicar o relatório de <mês>" da rotina mensal se conclui sozinho: fazer a mesma
      // coisa duas vezes (publicar e depois marcar o item) é como o item fica aberto e atrasado
      // por esquecimento mesmo com o relatório já entregue.
      await query(
        `UPDATE gc_checklist_itens
         SET concluido = true, concluido_por = $3, concluido_em = NOW(), updated_at = NOW()
         WHERE gc_cliente_id = $1 AND recorrente_chave = 'relatorio' AND NOT concluido
           AND mes_referencia = (SELECT periodo_inicio FROM gc_relatorios WHERE id = $2)`,
        [publicado.gc_cliente_id, req.params.id, sub]
      );
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
      await sincronizarRotinaAutomatica((r as { gc_cliente_id: string }).gc_cliente_id);
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
/**
 * Carrega o que o bloco "Nossa jornada" precisa e entrega à montagem pura (lib/gcPortalJornada.ts),
 * que decide campo por campo o que o cliente pode ler.
 *
 * Aqui só se BUSCA, e só o necessário: a estratégia e as premissas nem entram nestas consultas, e
 * quem decide o que sai é a lista permitida da montagem — não um espalhamento de colunas. O realizado
 * vem só dos meses com relatório PUBLICADO: número lançado e ainda não revisado não pode vazar por
 * aqui antes do relatório.
 *
 * `ignorarToggle` é da prévia "ver como o cliente vê": monta o bloco mesmo com o portal desligado,
 * pelo MESMO caminho — é o que garante que a prévia nunca mostre mais (nem menos) que o portal.
 */
async function jornadaDoPortal(clienteId: string, opcoes: { ignorarToggle?: boolean } = {}) {
  const planejamento = await queryOne<Record<string, unknown>>(
    `SELECT situacao_atual, leads_mes, investimento_mes, vendas_mes, faturamento_mensal,
            to_char(data_diagnostico, 'YYYY-MM-DD') AS data_diagnostico, curva,
            portal_ativo, portal_mostrar_situacao, portal_mostrar_objetivo
     FROM gc_planejamento WHERE gc_cliente_id = $1`,
    [clienteId]
  );
  if (!planejamento) return null;
  if (!planejamento.portal_ativo && !opcoes.ignorarToggle) return null;

  const metas = await query<{ horizonte: string; chave_metrica: string; valor_meta: string }>(
    `SELECT DISTINCT ON (horizonte, chave_metrica) horizonte, chave_metrica, valor_meta
     FROM gc_metas
     WHERE gc_cliente_id = $1 AND status = 'ativa' AND horizonte = ANY($2) AND chave_metrica = ANY($3)
     ORDER BY horizonte, chave_metrica, created_at DESC`,
    [clienteId, [...HORIZONTES_PLANEJAMENTO], [...CHAVES_DIGITADAS]]
  );
  const cenarios = planejamento.portal_mostrar_objetivo
    ? await query<Record<string, unknown>>(
        'SELECT horizonte, onde_quer_chegar FROM gc_planejamento_cenarios WHERE gc_cliente_id = $1',
        [clienteId]
      )
    : [];

  const publicados = (
    await query<{ dia: string }>(
      `SELECT to_char(periodo_inicio, 'YYYY-MM-DD') AS dia FROM gc_relatorios
       WHERE gc_cliente_id = $1 AND status = 'publicado'`,
      [clienteId]
    )
  ).map((r) => r.dia);
  const realizado = publicados.length
    ? await query<{ chave: string; mes: string; valor: string }>(
        `SELECT chave, to_char(periodo_inicio, 'YYYY-MM') AS mes, valor
         FROM gc_metricas
         WHERE gc_cliente_id = $1 AND periodo_inicio = ANY($2::date[]) AND chave = ANY($3)`,
        [clienteId, publicados, [...CHAVES_REALIZADO_PUBLICO]]
      )
    : [];

  return montarJornadaPublica({ planejamento, metas, cenarios, realizado }, opcoes);
}

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

    return { cliente, relatorios, jornada: await jornadaDoPortal(link.gc_cliente_id) };
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
