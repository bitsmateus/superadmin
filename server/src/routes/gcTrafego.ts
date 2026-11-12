import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { query, queryOne } from '../db.js';
import { guardaDoCliente, sqlSoDoGestor, type UsuarioGc } from '../lib/gcAcesso.js';
import { diasAtras } from '../lib/metaInsights.js';
import {
  anunciosDoCliente, avaliarAlertasClientes, benchmarkDoSegmento, campanhasDoCliente, lerContaNaMeta, metricasDoMesPeloTrafego, normalizarConta,
  gastoMedioDiarioDaConta, serieDoCliente, sincronizarConta, tokenDa, totaisDoCliente, totaisPorCliente, type ContaTrafego,
} from '../lib/gcTrafego.js';
import { instagramPeloTrafego } from '../lib/gcInstagram.js';
import { gerarMensagemParaCliente } from '../lib/gcMensagemTrafego.js';
import { diasQueDa, interpretarFinanceiro, type FinanceiroMeta } from '../lib/gcSaldo.js';
import {
  campanhasGoogleDoCliente, formatarCustomerId, googleAdsConfigurado, lerContaNoGoogle, normalizarCustomerId, serieGoogleDoCliente,
  sincronizarContaGoogle, totaisGoogleDoCliente, type ContaGoogle,
} from '../lib/gcGoogleAds.js';
import { podeUsarModulo } from './gestaoClientes.js';

/**
 * Tráfego (Meta) dos clientes NX Digital: o painel da carteira (/clientesnxdigital/trafego) e a
 * aba Tráfego dentro de cada cliente. Mesma regra de acesso do resto do módulo NX DIGITAL.
 * Os números vêm de gc_meta_* (ver lib/gcTrafego.ts); a Meta só é chamada pra ler.
 */

const DATA_RE = /^\d{4}-\d{2}-\d{2}$/;

function periodo(q: { de?: string; ate?: string }): { de: string; ate: string } {
  const ate = q.ate && DATA_RE.test(q.ate) ? q.ate : diasAtras(0);
  const de = q.de && DATA_RE.test(q.de) ? q.de : diasAtras(29);
  return de <= ate ? { de, ate } : { de: ate, ate: de };
}

/** O período de mesmo tamanho imediatamente antes (pra comparação "vs período anterior"). */
function anteriorA(de: string, ate: string): { de: string; ate: string } {
  const dias = Math.round((Date.parse(ate) - Date.parse(de)) / 86_400_000) + 1;
  const fim = new Date(Date.parse(de) - 86_400_000);
  const ini = new Date(fim.getTime() - (dias - 1) * 86_400_000);
  return { de: ini.toISOString().slice(0, 10), ate: fim.toISOString().slice(0, 10) };
}

const CAMPOS_CONTA = `id, gc_cliente_id, ad_account_id, nome, moeda, ativo, ultimo_sync_em, ultimo_erro,
  (token IS NOT NULL AND token <> '') AS tem_token, created_at`;

export async function gcTrafegoRoutes(app: FastifyInstance) {
  // Gestor que não é admin só mexe nos clientes em que é o gestor de tráfego (lib/gcAcesso.ts).
  app.addHook('preHandler', guardaDoCliente);
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

  // ------------------------------------------------------------------ painel da carteira
  // GET /api/gc/trafego/painel — todos os clientes ativos com o resumo da semana, os alertas
  // abertos e as últimas atualizações registradas nas fichas.
  app.get('/api/gc/trafego/painel', autenticado, async (req) => {
    const soDoGestor = sqlSoDoGestor(req.user as UsuarioGc);
    const semana = { de: diasAtras(7), ate: diasAtras(1) };
    const semanaAnterior = { de: diasAtras(14), ate: diasAtras(8) };
    const inicioMes = `${diasAtras(0).slice(0, 8)}01`;

    const [clientes, contas, t7, tAnt, tMes, previstos, alertas, atualizacoes, notas] = await Promise.all([
      query<{ id: string; nome_empresa: string; logo_url: string | null; prioridade: string; segmento: string; responsavel_nome: string | null }>(
        `SELECT c.id, c.nome_empresa, c.logo_url, c.prioridade, c.segmento, p.name AS responsavel_nome
         FROM gc_clientes c LEFT JOIN profiles p ON p.id = c.responsavel_id
         WHERE c.status = 'ativo' AND ${soDoGestor} ORDER BY c.nome_empresa`,
      ),
      query<{ gc_cliente_id: string; ultimo_sync_em: string | null; ultimo_erro: string | null; ativo: boolean }>(
        `SELECT gc_cliente_id, ultimo_sync_em, ultimo_erro, ativo FROM gc_trafego_contas`,
      ),
      totaisPorCliente(semana.de, semana.ate),
      totaisPorCliente(semanaAnterior.de, semanaAnterior.ate),
      totaisPorCliente(inicioMes, diasAtras(0)),
      query<{ gc_cliente_id: string; total: string }>(
        `SELECT gc_cliente_id, SUM(investimento_previsto_mensal) AS total FROM gc_servicos
         WHERE tipo = 'trafego_meta' AND status = 'ativo' GROUP BY gc_cliente_id`,
      ),
      query<{ id: string; gc_cliente_id: string; regra: string; nivel: string; mensagem: string; created_at: string; nome_empresa: string }>(
        `SELECT a.id, a.gc_cliente_id, a.regra, a.nivel, a.mensagem, a.created_at, c.nome_empresa
         FROM gc_trafego_alertas a JOIN gc_clientes c ON c.id = a.gc_cliente_id
         WHERE a.resolved_at IS NULL AND c.status = 'ativo' AND ${soDoGestor}
         ORDER BY CASE a.nivel WHEN 'critico' THEN 0 WHEN 'atencao' THEN 1 ELSE 2 END, a.created_at DESC`,
      ),
      query(
        `SELECT h.id, h.gc_cliente_id, h.tipo, h.titulo, h.descricao, h.created_at, c.nome_empresa, p.name AS autor_nome
         FROM gc_historico h JOIN gc_clientes c ON c.id = h.gc_cliente_id
         LEFT JOIN profiles p ON p.id = h.autor_id
         WHERE c.status = 'ativo' AND ${soDoGestor}
         ORDER BY h.created_at DESC LIMIT 30`,
      ),
      // Última nota que a IA deu pro tráfego de cada cliente.
      query<{ gc_cliente_id: string; nota: string | null; created_at: string }>(
        `SELECT DISTINCT ON (gc_cliente_id) gc_cliente_id, conteudo->>'nota' AS nota, created_at
         FROM gc_ia_analises WHERE tipo = 'trafego' ORDER BY gc_cliente_id, created_at DESC`,
      ),
    ]);

    const previstoPor = new Map(previstos.map((p) => [p.gc_cliente_id, Number(p.total)]));
    const notaPor = new Map(notas.map((n) => [n.gc_cliente_id, n.nota == null ? null : Number(n.nota)]));
    const linhas = clientes.map((c) => {
      const minhas = contas.filter((x) => x.gc_cliente_id === c.id && x.ativo);
      const meusAlertas = alertas.filter((a) => a.gc_cliente_id === c.id);
      const status = minhas.length === 0
        ? 'sem_conta'
        : meusAlertas.some((a) => a.nivel === 'critico') ? 'critico'
          : meusAlertas.some((a) => a.nivel === 'atencao') ? 'atencao' : 'ok';
      const ultimoSync = minhas.map((x) => x.ultimo_sync_em).filter(Boolean).sort().pop() ?? null;
      return {
        id: c.id, nome: c.nome_empresa, logoUrl: c.logo_url, prioridade: c.prioridade, segmento: c.segmento,
        responsavel: c.responsavel_nome, contas: minhas.length, ultimoSync, status,
        semana: t7.get(c.id) ?? null, semanaAnterior: tAnt.get(c.id) ?? null, mes: tMes.get(c.id) ?? null,
        previstoMes: previstoPor.get(c.id) ?? null,
        alertas: meusAlertas.length,
        notaIa: notaPor.get(c.id) ?? null,
      };
    });

    return { semana, semanaAnterior, inicioMes, clientes: linhas, alertas, atualizacoes };
  });

  // POST /api/gc/trafego/alertas/:id/visto — some do painel; a regra não reabre por 7 dias.
  app.post<{ Params: { id: string } }>('/api/gc/trafego/alertas/:id/visto', autenticado, async (req, reply) => {
    const { sub } = req.user as { sub: string };
    const r = await queryOne(
      `UPDATE gc_trafego_alertas SET resolved_at = now(), resolvido_por = $2 WHERE id = $1 AND resolved_at IS NULL RETURNING id`,
      [req.params.id, sub],
    );
    if (!r) return reply.status(404).send({ message: 'Alerta não encontrado' });
    return { ok: true };
  });

  // ------------------------------------------------------------------ por cliente
  // GET /api/gc/clientes/:id/trafego?de=&ate= — tudo o que a aba Tráfego do cliente mostra.
  app.get<{ Params: { id: string }; Querystring: { de?: string; ate?: string } }>(
    '/api/gc/clientes/:id/trafego',
    autenticado,
    async (req) => {
      const id = req.params.id;
      const { de, ate } = periodo(req.query);
      const ant = anteriorA(de, ate);
      const hoje = diasAtras(0);
      const [contas, atual, anterior, serie, campanhas, anuncios, alertas, benchmark, mes, previsto] = await Promise.all([
        query<{ ad_account_id: string; financeiro: FinanceiroMeta | null; financeiro_em: string | null }>(
          `SELECT ${CAMPOS_CONTA}, financeiro, financeiro_em FROM gc_trafego_contas WHERE gc_cliente_id = $1 ORDER BY created_at`, [id],
        ),
        totaisDoCliente(id, de, ate),
        totaisDoCliente(id, ant.de, ant.ate),
        serieDoCliente(id, de, ate),
        campanhasDoCliente(id, de, ate),
        anunciosDoCliente(id, de, ate, 30),
        query(
          `SELECT id, regra, nivel, mensagem, created_at FROM gc_trafego_alertas
           WHERE gc_cliente_id = $1 AND resolved_at IS NULL
           ORDER BY CASE nivel WHEN 'critico' THEN 0 WHEN 'atencao' THEN 1 ELSE 2 END, created_at DESC`,
          [id],
        ),
        benchmarkDoSegmento(id, de, ate),
        totaisDoCliente(id, hoje.slice(0, 8) + '01', hoje),
        queryOne<{ total: string | null }>(
          `SELECT SUM(investimento_previsto_mensal) AS total FROM gc_servicos
           WHERE gc_cliente_id = $1 AND tipo = 'trafego_meta' AND status = 'ativo'`,
          [id],
        ),
      ]);
      const ritmo = { gastoMes: mes.gasto, previstoMes: previsto?.total == null ? null : Number(previsto.total) };
      // Saldo e pagamento de cada conta, já interpretados, com o gasto médio por dia (pra "dá para N dias").
      const contasComSaldo = await Promise.all(contas.map(async ({ financeiro, financeiro_em, ...c }) => {
        if (!financeiro) return { ...c, saldo: null };
        const gastoDia = await gastoMedioDiarioDaConta(c.ad_account_id);
        const fin = interpretarFinanceiro(financeiro);
        const base = fin.prePaga ? fin.saldoDisponivel : fin.restanteLimite;
        return { ...c, saldo: { ...fin, gastoDia, diasRestantes: diasQueDa(base, gastoDia), lidoEm: financeiro_em } };
      }));
      return { de, ate, anterior: ant, contas: contasComSaldo, totais: { atual, anterior }, serie, campanhas, anuncios, alertas, benchmark, ritmo };
    },
  );

  // ------------------------------------------------------------------ última edição do tráfego
  // GET/POST /api/gc/clientes/:id/trafego/edicoes — o que foi mudado nas campanhas (registro manual),
  // da mais recente para a mais antiga. DELETE só para quem escreveu ou admin.
  const CAMPOS_EDICAO = `e.id, e.texto, e.mensagem_cliente, e.created_at, e.autor_id, p.name AS autor_nome`;
  const edicaoPorId = (id: string | undefined) =>
    queryOne(`SELECT ${CAMPOS_EDICAO} FROM gc_trafego_edicoes e LEFT JOIN profiles p ON p.id = e.autor_id WHERE e.id = $1`, [id]);
  /** Escreve a mensagem para o cliente com a IA. Falhou (sem chave, fora do ar)? Devolve o motivo e a edição fica salva assim mesmo. */
  const gerarMensagem = async (edicaoId: string, clienteId: string, texto: string): Promise<string | null> => {
    try {
      const msg = await gerarMensagemParaCliente(clienteId, texto);
      await query('UPDATE gc_trafego_edicoes SET mensagem_cliente = $2 WHERE id = $1', [edicaoId, msg]);
      return null;
    } catch (err) {
      console.warn('[gcTrafego] mensagem para o cliente falhou', String(err).slice(0, 200));
      return (err as Error).message || 'Não consegui gerar a mensagem agora.';
    }
  };
  app.get<{ Params: { id: string } }>('/api/gc/clientes/:id/trafego/edicoes', autenticado, async (req) =>
    query(
      `SELECT ${CAMPOS_EDICAO} FROM gc_trafego_edicoes e LEFT JOIN profiles p ON p.id = e.autor_id
       WHERE e.gc_cliente_id = $1 ORDER BY e.created_at DESC LIMIT 500`,
      [req.params.id],
    ),
  );

  app.post<{ Params: { id: string }; Body: { texto?: string } }>('/api/gc/clientes/:id/trafego/edicoes', autenticado, async (req, reply) => {
    const texto = String(req.body?.texto ?? '').trim();
    if (!texto) return reply.status(400).send({ message: 'Escreva o que foi alterado no tráfego.' });
    if (texto.length > 5000) return reply.status(400).send({ message: 'Texto muito longo (máx. 5.000 caracteres).' });
    const cliente = await queryOne('SELECT 1 FROM gc_clientes WHERE id = $1', [req.params.id]);
    if (!cliente) return reply.status(404).send({ message: 'Cliente não encontrado' });
    const { sub } = req.user as { sub: string };
    const nova = await queryOne<{ id: string }>(
      `INSERT INTO gc_trafego_edicoes (gc_cliente_id, texto, autor_id) VALUES ($1, $2, $3) RETURNING id`,
      [req.params.id, texto, sub],
    );
    const erroIa = nova ? await gerarMensagem(nova.id, req.params.id, texto) : null;
    return { ...(await edicaoPorId(nova?.id)), erroIa };
  });

  // POST /api/gc/trafego/edicoes/:edicaoId/mensagem — gera de novo a mensagem para o cliente.
  app.post<{ Params: { edicaoId: string } }>('/api/gc/trafego/edicoes/:edicaoId/mensagem', autenticado, async (req, reply) => {
    const e = await queryOne<{ gc_cliente_id: string; texto: string }>(
      'SELECT gc_cliente_id, texto FROM gc_trafego_edicoes WHERE id = $1', [req.params.edicaoId],
    );
    if (!e) return reply.status(404).send({ message: 'Registro não encontrado' });
    const erroIa = await gerarMensagem(req.params.edicaoId, e.gc_cliente_id, e.texto);
    if (erroIa) return reply.status(502).send({ message: `Não consegui gerar a mensagem: ${erroIa}` });
    return edicaoPorId(req.params.edicaoId);
  });

  // PUT /api/gc/trafego/edicoes/:edicaoId/mensagem — guarda a mensagem como o gestor deixou.
  app.put<{ Params: { edicaoId: string }; Body: { mensagem?: string } }>('/api/gc/trafego/edicoes/:edicaoId/mensagem', autenticado, async (req, reply) => {
    const mensagem = String(req.body?.mensagem ?? '').trim().slice(0, 4000);
    const r = await queryOne('UPDATE gc_trafego_edicoes SET mensagem_cliente = $2 WHERE id = $1 RETURNING id', [req.params.edicaoId, mensagem]);
    if (!r) return reply.status(404).send({ message: 'Registro não encontrado' });
    return edicaoPorId(req.params.edicaoId);
  });

  app.delete<{ Params: { edicaoId: string } }>('/api/gc/trafego/edicoes/:edicaoId', autenticado, async (req, reply) => {
    const { sub, role } = req.user as { sub: string; role: string };
    const edicao = await queryOne<{ autor_id: string | null }>('SELECT autor_id FROM gc_trafego_edicoes WHERE id = $1', [req.params.edicaoId]);
    if (!edicao) return reply.status(404).send({ message: 'Registro não encontrado' });
    if (edicao.autor_id !== sub && role !== 'admin') return reply.status(403).send({ message: 'Só quem escreveu (ou um admin) pode excluir.' });
    await query('DELETE FROM gc_trafego_edicoes WHERE id = $1', [req.params.edicaoId]);
    return { ok: true };
  });

  // PUT /api/gc/clientes/:id/trafego/previsto — a verba prevista do mês (serviço Tráfego Meta). É
  // com ela que os alertas de ritmo medem o mês. A lista de serviços saiu da Visão geral, então o
  // valor é editado aqui: grava no serviço Meta ativo mais antigo (zerando os outros, pra a soma
  // bater com o que foi digitado) e, se o cliente não tem um, cria.
  app.put<{ Params: { id: string }; Body: { valor?: number | string | null } }>(
    '/api/gc/clientes/:id/trafego/previsto',
    autenticado,
    async (req, reply) => {
      const bruto = req.body?.valor;
      const valor = bruto === null || bruto === undefined || bruto === '' ? null : Number(bruto);
      if (valor !== null && (!Number.isFinite(valor) || valor < 0 || valor > 9_999_999_999)) {
        return reply.status(400).send({ message: 'Informe um valor válido em reais.' });
      }
      const cliente = await queryOne('SELECT 1 FROM gc_clientes WHERE id = $1', [req.params.id]);
      if (!cliente) return reply.status(404).send({ message: 'Cliente não encontrado' });

      const servicos = await query<{ id: string }>(
        `SELECT id FROM gc_servicos WHERE gc_cliente_id = $1 AND tipo = 'trafego_meta' AND status = 'ativo'
         ORDER BY created_at`,
        [req.params.id],
      );
      if (servicos.length) {
        await query(
          `UPDATE gc_servicos SET investimento_previsto_mensal = CASE WHEN id = $2 THEN $3::numeric ELSE NULL END,
             updated_at = NOW()
           WHERE gc_cliente_id = $1 AND tipo = 'trafego_meta' AND status = 'ativo'`,
          [req.params.id, servicos[0].id, valor],
        );
      } else if (valor !== null) {
        await query(
          `INSERT INTO gc_servicos (gc_cliente_id, tipo, investimento_previsto_mensal) VALUES ($1, 'trafego_meta', $2)`,
          [req.params.id, valor],
        );
      }
      return { previstoMes: valor };
    },
  );

  // POST /api/gc/clientes/:id/trafego/contas — vincula uma conta de anúncio. Antes de gravar, lê a
  // conta na Meta: se o token não enxerga, a pessoa sabe na hora (e não três dias depois).
  app.post<{ Params: { id: string }; Body: { ad_account_id?: string; token?: string } }>(
    '/api/gc/clientes/:id/trafego/contas',
    autenticado,
    async (req, reply) => {
      const bruto = (req.body?.ad_account_id ?? '').trim();
      if (!/^(act_)?\d{5,20}$/.test(bruto.replace(/\s+/g, ''))) {
        return reply.status(400).send({ message: 'Informe o ID da conta de anúncio (só números, ex.: 1234567890).' });
      }
      const cliente = await queryOne('SELECT 1 FROM gc_clientes WHERE id = $1', [req.params.id]);
      if (!cliente) return reply.status(404).send({ message: 'Cliente não encontrado' });

      const adAccountId = normalizarConta(bruto);
      const tokenProprio = (req.body?.token ?? '').trim() || null;
      const token = tokenDa({ token: tokenProprio });
      if (!token) {
        return reply.status(400).send({ message: 'O servidor não tem META_ADS_TOKEN: informe um token com acesso a essa conta.' });
      }
      let info: { nome: string; moeda: string };
      try {
        info = await lerContaNaMeta(adAccountId, token);
      } catch (err) {
        return reply.status(400).send({ message: `A Meta não liberou essa conta com o token usado. ${(err as Error).message}` });
      }
      const conta = await queryOne<ContaTrafego>(
        `INSERT INTO gc_trafego_contas (gc_cliente_id, ad_account_id, nome, moeda, token)
         VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT (gc_cliente_id, ad_account_id) DO UPDATE SET nome = EXCLUDED.nome, moeda = EXCLUDED.moeda,
           token = COALESCE(EXCLUDED.token, gc_trafego_contas.token), ativo = true
         RETURNING id, gc_cliente_id, ad_account_id, token`,
        [req.params.id, adAccountId, info.nome, info.moeda, tokenProprio],
      );
      const { sub } = req.user as { sub: string };
      await query(
        `INSERT INTO gc_historico (gc_cliente_id, tipo, titulo, descricao, autor_id)
         VALUES ($1, 'evento_sistema', 'Conta de anúncio vinculada', $2, $3)`,
        [req.params.id, `${info.nome || adAccountId} (${adAccountId})`, sub],
      );
      // O primeiro sync (90 dias) pode levar um tempo: roda em segundo plano e a tela vai atualizando.
      if (conta) void sincronizarConta(conta).then(() => avaliarAlertasClientes()).catch(() => undefined);
      // Token do próprio cliente costuma enxergar só o Instagram dele: já vincula na aba Conteúdo.
      if (tokenProprio) void instagramPeloTrafego(req.params.id, sub).catch(() => undefined);
      return queryOne(`SELECT ${CAMPOS_CONTA} FROM gc_trafego_contas WHERE id = $1`, [conta?.id]);
    },
  );

  // DELETE /api/gc/trafego/contas/:id — desvincula. Os números já coletados ficam (histórico).
  app.delete<{ Params: { id: string } }>('/api/gc/trafego/contas/:id', autenticado, async (req, reply) => {
    const r = await queryOne<{ gc_cliente_id: string }>(
      'DELETE FROM gc_trafego_contas WHERE id = $1 RETURNING gc_cliente_id',
      [req.params.id],
    );
    if (!r) return reply.status(404).send({ message: 'Conta não encontrada' });
    return reply.status(204).send();
  });

  // ------------------------------------------------------------------ Google Ads (lib/gcGoogleAds.ts)
  const CAMPOS_CONTA_GOOGLE = `id, gc_cliente_id, customer_id, nome, moeda, ativo, ultimo_sync_em, ultimo_erro, created_at`;

  // GET /api/gc/clientes/:id/trafego/google?de=&ate= — o que a aba Tráfego mostra do Google Ads.
  app.get<{ Params: { id: string }; Querystring: { de?: string; ate?: string } }>(
    '/api/gc/clientes/:id/trafego/google',
    autenticado,
    async (req) => {
      const id = req.params.id;
      const { de, ate } = periodo(req.query);
      const ant = anteriorA(de, ate);
      const [contas, atual, anterior, serie, campanhas] = await Promise.all([
        query<{ customer_id: string }>(`SELECT ${CAMPOS_CONTA_GOOGLE} FROM gc_google_contas WHERE gc_cliente_id = $1 ORDER BY created_at`, [id]),
        totaisGoogleDoCliente(id, de, ate),
        totaisGoogleDoCliente(id, ant.de, ant.ate),
        serieGoogleDoCliente(id, de, ate),
        campanhasGoogleDoCliente(id, de, ate),
      ]);
      return {
        configurado: googleAdsConfigurado(),
        de, ate, anterior: ant,
        contas: contas.map((c) => ({ ...c, customer_id_formatado: formatarCustomerId(c.customer_id) })),
        totais: { atual, anterior }, serie, campanhas,
      };
    },
  );

  // POST /api/gc/clientes/:id/trafego/google/contas — vincula pelo ID de cliente do Google Ads.
  app.post<{ Params: { id: string }; Body: { customer_id?: string } }>(
    '/api/gc/clientes/:id/trafego/google/contas',
    autenticado,
    async (req, reply) => {
      const customerId = normalizarCustomerId(req.body?.customer_id ?? '');
      if (!customerId) return reply.status(400).send({ message: 'Informe o ID de cliente do Google Ads (10 dígitos, ex.: 123-456-7890).' });
      if (!googleAdsConfigurado()) {
        return reply.status(400).send({ message: 'O Google Ads ainda não está configurado no servidor (token de desenvolvedor e acesso da MCC).' });
      }
      const cliente = await queryOne('SELECT 1 FROM gc_clientes WHERE id = $1', [req.params.id]);
      if (!cliente) return reply.status(404).send({ message: 'Cliente não encontrado' });
      let info: { nome: string; moeda: string };
      try {
        info = await lerContaNoGoogle(customerId);
      } catch (err) {
        return reply.status(400).send({ message: `O Google não liberou essa conta. ${(err as Error).message}` });
      }
      const conta = await queryOne<ContaGoogle>(
        `INSERT INTO gc_google_contas (gc_cliente_id, customer_id, nome, moeda) VALUES ($1,$2,$3,$4)
         ON CONFLICT (gc_cliente_id, customer_id) DO UPDATE SET nome = EXCLUDED.nome, moeda = EXCLUDED.moeda, ativo = true
         RETURNING id, gc_cliente_id, customer_id`,
        [req.params.id, customerId, info.nome, info.moeda],
      );
      const { sub } = req.user as { sub: string };
      await query(
        `INSERT INTO gc_historico (gc_cliente_id, tipo, titulo, descricao, autor_id)
         VALUES ($1, 'evento_sistema', 'Conta do Google Ads vinculada', $2, $3)`,
        [req.params.id, `${info.nome || formatarCustomerId(customerId)} (${formatarCustomerId(customerId)})`, sub],
      );
      // Primeira coleta (90 dias) em segundo plano.
      if (conta) void sincronizarContaGoogle(conta).then(() => avaliarAlertasClientes()).catch(() => undefined);
      return queryOne(`SELECT ${CAMPOS_CONTA_GOOGLE} FROM gc_google_contas WHERE id = $1`, [conta?.id]);
    },
  );

  // DELETE /api/gc/trafego/google/contas/:id — desvincula. Os números já coletados ficam.
  app.delete<{ Params: { id: string } }>('/api/gc/trafego/google/contas/:id', autenticado, async (req, reply) => {
    const r = await queryOne('DELETE FROM gc_google_contas WHERE id = $1 RETURNING id', [req.params.id]);
    if (!r) return reply.status(404).send({ message: 'Conta não encontrada' });
    return reply.status(204).send();
  });

  // POST /api/gc/clientes/:id/trafego/sincronizar — "atualizar agora" (espera terminar).
  app.post<{ Params: { id: string } }>('/api/gc/clientes/:id/trafego/sincronizar', autenticado, async (req) => {
    const contas = await query<ContaTrafego>(
      `SELECT id, gc_cliente_id, ad_account_id, token FROM gc_trafego_contas WHERE gc_cliente_id = $1 AND ativo`,
      [req.params.id],
    );
    const resultados = [];
    for (const c of contas) resultados.push({ conta: c.ad_account_id, ...(await sincronizarConta(c)) });
    const google = await query<ContaGoogle>(
      'SELECT id, gc_cliente_id, customer_id FROM gc_google_contas WHERE gc_cliente_id = $1 AND ativo', [req.params.id],
    );
    for (const c of google) resultados.push({ conta: `Google ${formatarCustomerId(c.customer_id)}`, ...(await sincronizarContaGoogle(c)) });
    await avaliarAlertasClientes();
    return { resultados };
  });

  // POST /api/gc/clientes/:id/metricas/do-trafego — "Puxar do Tráfego": grava no lançamento do mês
  // o que o Meta tem (investimento, impressões, cliques, leads, conversas). Vendas e receita ficam.
  app.post<{ Params: { id: string }; Body: { periodo?: string } }>(
    '/api/gc/clientes/:id/metricas/do-trafego',
    autenticado,
    async (req, reply) => {
      const periodo = req.body?.periodo ?? '';
      if (!/^\d{4}-\d{2}$/.test(periodo)) return reply.status(400).send({ message: 'periodo deve ser YYYY-MM' });
      return metricasDoMesPeloTrafego(req.params.id, periodo);
    },
  );
}
