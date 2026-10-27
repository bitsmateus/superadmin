import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { query, queryOne } from '../db.js';
import { conversar, gerarAnalise, ultimaAnalise, type MensagemIa } from '../lib/gcIa.js';
import { lerPerfil, perfisDisponiveis, postsDoCliente, sincronizarInstagram, tokenInstagram } from '../lib/gcInstagram.js';
import { podeUsarModulo } from './gestaoClientes.js';

/**
 * IA e Instagram dos clientes NX Digital: análise de tráfego, ideias de conteúdo (roteiros e
 * artes), chat do assistente dentro da ficha e o perfil do Instagram (posts + métricas).
 * Mesma regra de acesso do resto do módulo NX DIGITAL.
 */

const TIPOS = ['trafego', 'conteudo'] as const;
type Tipo = (typeof TIPOS)[number];

// Uma geração por cliente+tipo por vez: dois cliques seguidos não pagam duas chamadas da IA.
const gerando = new Set<string>();

export async function gcIaRoutes(app: FastifyInstance) {
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

  // ------------------------------------------------------------------ análises
  app.get<{ Params: { id: string; tipo: string } }>('/api/gc/clientes/:id/ia/:tipo', autenticado, async (req, reply) => {
    if (!TIPOS.includes(req.params.tipo as Tipo)) return reply.status(400).send({ message: 'Tipo inválido' });
    const ultima = await ultimaAnalise(req.params.id, req.params.tipo as Tipo);
    return { analise: ultima, gerando: gerando.has(`${req.params.id}|${req.params.tipo}`), iaConfigurada: !!process.env.ANTHROPIC_API_KEY };
  });

  app.post<{ Params: { id: string; tipo: string }; Body: { pedido?: string } }>(
    '/api/gc/clientes/:id/ia/:tipo/gerar',
    autenticado,
    async (req, reply) => {
      const tipo = req.params.tipo as Tipo;
      if (!TIPOS.includes(tipo)) return reply.status(400).send({ message: 'Tipo inválido' });
      if (!process.env.ANTHROPIC_API_KEY) return reply.status(400).send({ message: 'ANTHROPIC_API_KEY não configurada no servidor.' });
      const chave = `${req.params.id}|${tipo}`;
      if (gerando.has(chave)) return reply.status(409).send({ message: 'Já tem uma geração em andamento pra este cliente.' });
      gerando.add(chave);
      try {
        const { sub } = req.user as { sub: string };
        const r = await gerarAnalise(req.params.id, tipo, 'manual', sub, req.body?.pedido ?? '');
        return { analise: await ultimaAnalise(req.params.id, tipo), id: r.id };
      } catch (err) {
        return reply.status(502).send({ message: (err as Error).message });
      } finally {
        gerando.delete(chave);
      }
    },
  );

  // POST /api/gc/clientes/:id/ia/chat — conversa com o assistente. O histórico vem da tela (não
  // fica guardado no servidor); o contexto do cliente é remontado a cada pergunta, sempre atual.
  app.post<{ Params: { id: string }; Body: { mensagem?: string; historico?: MensagemIa[] } }>(
    '/api/gc/clientes/:id/ia/chat',
    autenticado,
    async (req, reply) => {
      const mensagem = String(req.body?.mensagem ?? '').trim();
      if (!mensagem) return reply.status(400).send({ message: 'Escreva a pergunta' });
      try {
        const resposta = await conversar(req.params.id, Array.isArray(req.body?.historico) ? req.body!.historico! : [], mensagem);
        return { resposta };
      } catch (err) {
        return reply.status(502).send({ message: (err as Error).message });
      }
    },
  );

  // ------------------------------------------------------------------ instagram
  app.get<{ Params: { id: string }; Querystring: { dias?: string } }>('/api/gc/clientes/:id/instagram', autenticado, async (req) => {
    const conta = await queryOne(
      `SELECT ig_user_id, username, seguidores, ultimo_sync_em, ultimo_erro, (token IS NOT NULL AND token <> '') AS tem_token
       FROM gc_instagram_contas WHERE gc_cliente_id = $1`,
      [req.params.id],
    );
    const dias = Math.min(365, Math.max(7, Number(req.query.dias) || 90));
    return { conta, posts: conta ? await postsDoCliente(req.params.id, dias) : [] };
  });

  // POST /api/gc/instagram/disponiveis — perfis que o token enxerga. Token no corpo, nunca na URL.
  app.post<{ Body: { token?: string } }>('/api/gc/instagram/disponiveis', autenticado, async (req, reply) => {
    const token = tokenInstagram({ token: req.body?.token ?? null });
    if (!token) return reply.status(400).send({ message: 'O servidor não tem META_ADS_TOKEN: informe um token.' });
    try {
      return { perfis: await perfisDisponiveis(token) };
    } catch (err) {
      return reply.status(400).send({ message: (err as Error).message });
    }
  });

  app.post<{ Params: { id: string }; Body: { ig_user_id?: string; token?: string } }>(
    '/api/gc/clientes/:id/instagram',
    autenticado,
    async (req, reply) => {
      const igUserId = String(req.body?.ig_user_id ?? '').trim();
      if (!/^\d{5,30}$/.test(igUserId)) return reply.status(400).send({ message: 'Informe o ID do Instagram profissional (só números).' });
      const tokenProprio = (req.body?.token ?? '').trim() || null;
      const token = tokenInstagram({ token: tokenProprio });
      if (!token) return reply.status(400).send({ message: 'O servidor não tem META_ADS_TOKEN: informe um token.' });
      let perfil: { username: string; seguidores: number | null };
      try {
        perfil = await lerPerfil(igUserId, token);
      } catch (err) {
        return reply.status(400).send({ message: `A Meta não liberou esse perfil com o token usado. ${(err as Error).message}` });
      }
      await query(
        `INSERT INTO gc_instagram_contas (gc_cliente_id, ig_user_id, username, seguidores, token)
         VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT (gc_cliente_id) DO UPDATE SET ig_user_id = EXCLUDED.ig_user_id, username = EXCLUDED.username,
           seguidores = EXCLUDED.seguidores, token = COALESCE(EXCLUDED.token, gc_instagram_contas.token), ultimo_erro = NULL`,
        [req.params.id, igUserId, perfil.username, perfil.seguidores, tokenProprio],
      );
      const { sub } = req.user as { sub: string };
      await query(
        `INSERT INTO gc_historico (gc_cliente_id, tipo, titulo, descricao, autor_id)
         VALUES ($1, 'evento_sistema', 'Instagram vinculado', $2, $3)`,
        [req.params.id, `@${perfil.username}`, sub],
      );
      void sincronizarInstagram(req.params.id).catch(() => undefined);
      return { ok: true, username: perfil.username };
    },
  );

  app.delete<{ Params: { id: string } }>('/api/gc/clientes/:id/instagram', autenticado, async (req, reply) => {
    await query('DELETE FROM gc_instagram_contas WHERE gc_cliente_id = $1', [req.params.id]);
    return reply.status(204).send();
  });

  app.post<{ Params: { id: string } }>('/api/gc/clientes/:id/instagram/sincronizar', autenticado, async (req) => {
    return sincronizarInstagram(req.params.id);
  });
}
