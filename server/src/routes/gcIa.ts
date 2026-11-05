import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { query, queryOne } from '../db.js';
import { conversar, gerarAnalise, ultimaAnalise, type MensagemIa } from '../lib/gcIa.js';
import {
  instagramPeloTrafego, perfisDisponiveis, postsDoCliente, sincronizarInstagram, tokenDoTrafego, tokenInstagram, vincularInstagram,
} from '../lib/gcInstagram.js';
import { podeUsarModulo } from './gestaoClientes.js';
import {
  aprendizados, checklistDoAjuste, enviarArteProDrive, gerarCopy, gerarLegenda, gerarPedido, revisarArte,
} from '../lib/gcSocialIa.js';

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

  app.post<{ Params: { id: string; tipo: string }; Body: { pedido?: string; videos?: number; artes?: number } }>(
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
        const qtd = (v: unknown, padrao: number) => {
          const n = Math.round(Number(v));
          return Number.isFinite(n) ? Math.max(0, Math.min(10, n)) : padrao;
        };
        const quantidade = tipo === 'conteudo' && (req.body?.videos !== undefined || req.body?.artes !== undefined)
          ? { videos: qtd(req.body?.videos, 3), artes: qtd(req.body?.artes, 3) }
          : undefined;
        const r = await gerarAnalise(req.params.id, tipo, 'manual', sub, req.body?.pedido ?? '', quantidade);
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
      // Sem token digitado, usa o da conta de tráfego do cliente (e, sem ele, o da NX no servidor).
      const tokenProprio = (req.body?.token ?? '').trim() || (await tokenDoTrafego(req.params.id));
      if (!tokenInstagram({ token: tokenProprio })) {
        return reply.status(400).send({ message: 'O servidor não tem META_ADS_TOKEN: informe um token.' });
      }
      const { sub } = req.user as { sub: string };
      try {
        const r = await vincularInstagram(req.params.id, igUserId, tokenProprio, sub);
        return { ok: true, username: r.username };
      } catch (err) {
        return reply.status(400).send({ message: `A Meta não liberou esse perfil com o token usado. ${(err as Error).message}` });
      }
    },
  );

  // POST /api/gc/clientes/:id/instagram/pelo-trafego — perfis que o token da conta de tráfego enxerga;
  // com um perfil só e o cliente ainda sem Instagram, já vincula.
  app.post<{ Params: { id: string } }>('/api/gc/clientes/:id/instagram/pelo-trafego', autenticado, async (req, reply) => {
    const { sub } = req.user as { sub: string };
    try {
      return await instagramPeloTrafego(req.params.id, sub);
    } catch (err) {
      return reply.status(400).send({ message: (err as Error).message });
    }
  });

  app.delete<{ Params: { id: string } }>('/api/gc/clientes/:id/instagram', autenticado, async (req, reply) => {
    await query('DELETE FROM gc_instagram_contas WHERE gc_cliente_id = $1', [req.params.id]);
    return reply.status(204).send();
  });

  app.post<{ Params: { id: string } }>('/api/gc/clientes/:id/instagram/sincronizar', autenticado, async (req) => {
    return sincronizarInstagram(req.params.id);
  });

  // ------------------------------------------------------------------ IA no fluxo das artes (social media)
  /** Erro com statusCode (400/404) volta como está; o resto vira 500 com a mensagem. */
  const responder = async <T>(reply: FastifyReply, fn: () => Promise<T>) => {
    try {
      return await fn();
    } catch (err) {
      const e = err as Error & { statusCode?: number };
      return reply.status(e.statusCode ?? 500).send({ message: e.message });
    }
  };

  // POST /api/gc/clientes/:id/social/ia/pedido — { ideia } → { titulo, descricao } pronto pra designer.
  app.post<{ Params: { id: string }; Body: { ideia?: string } }>('/api/gc/clientes/:id/social/ia/pedido', autenticado, async (req, reply) => {
    const ideia = String(req.body?.ideia ?? '').trim().slice(0, 1500);
    if (!ideia) return reply.status(400).send({ message: 'Escreva a ideia da arte' });
    return responder(reply, () => gerarPedido(req.params.id, ideia));
  });

  app.post<{ Params: { id: string } }>('/api/gc/social/producao/:id/ia/revisao', autenticado, async (req, reply) =>
    responder(reply, () => revisarArte(req.params.id)));

  app.post<{ Params: { id: string } }>('/api/gc/social/producao/:id/ia/copy', autenticado, async (req, reply) =>
    responder(reply, () => gerarCopy(req.params.id)));

  app.post<{ Params: { id: string }; Body: { instrucao?: string } }>('/api/gc/social/producao/:id/ia/legenda', autenticado, async (req, reply) =>
    responder(reply, async () => ({ legenda: await gerarLegenda(req.params.id, String(req.body?.instrucao ?? '').slice(0, 500)) })));

  // POST /api/gc/social/producao/:id/ia/checklist — refaz o checklist do último ajuste pedido pelo cliente.
  app.post<{ Params: { id: string } }>('/api/gc/social/producao/:id/ia/checklist', autenticado, async (req, reply) =>
    responder(reply, async () => {
      const ultimo = await queryOne<{ texto: string }>(
        `SELECT texto FROM gc_social_eventos WHERE gc_producao_id = $1 AND tipo = 'ajuste_cliente' ORDER BY created_at DESC LIMIT 1`,
        [req.params.id]
      );
      if (!ultimo) throw Object.assign(new Error('O cliente ainda não pediu ajuste nesta arte'), { statusCode: 400 });
      return { checklist: await checklistDoAjuste(req.params.id, ultimo.texto) };
    }));

  app.post<{ Params: { id: string } }>('/api/gc/clientes/:id/social/ia/aprendizados', autenticado, async (req, reply) =>
    responder(reply, async () => ({ texto: await aprendizados(req.params.id) })));

  // POST /api/gc/social/producao/:id/drive — manda a arte final pra pasta do Drive do cliente (subpasta do mês).
  app.post<{ Params: { id: string } }>('/api/gc/social/producao/:id/drive', autenticado, async (req, reply) =>
    responder(reply, () => enviarArteProDrive(req.params.id)));
}
