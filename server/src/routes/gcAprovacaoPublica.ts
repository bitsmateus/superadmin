import { FastifyInstance, FastifyReply } from 'fastify';
import sharp from 'sharp';
import { query, queryOne } from '../db.js';
import { avisarMudanca, registrarEventoArte } from '../lib/gcSocialFluxo.js';
import { aoAprovar, checklistDoAjuste } from '../lib/gcSocialIa.js';

/**
 * Aprovação das artes pelo cliente, no portal (SEM login, só o token do link do portal).
 *
 * O cliente vê só: o título da arte, o mês e as imagens marcadas como ARTE FINAL. O pedido interno
 * (descrição, referências, editor, revisão da IA, copy) nunca sai daqui. Ele pode aprovar ou pedir
 * ajuste enquanto a arte está "Com o cliente".
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function clienteDoToken(token: string): Promise<string | null> {
  const l = await queryOne<{ gc_cliente_id: string }>(
    `SELECT gc_cliente_id FROM gc_links_publicos WHERE token = $1 AND ativo AND (expira_em IS NULL OR expira_em > NOW())`,
    [token],
  );
  return l?.gc_cliente_id ?? null;
}

const tituloPublico = (t: string) => t.replace(/^(arte|reels|criativo|carrossel)\s*:\s*/i, '').trim() || t;
const nomeDoCliente = (v: unknown) => String(v ?? '').trim().slice(0, 80) || 'Cliente';

// Visíveis no portal: as que esperam o cliente, as que ele pediu ajuste (em correção) e as aprovadas nos últimos 60 dias.
const VISIVEL = `(d.status = 'com_cliente' OR d.ajuste_pedido OR (d.status IN ('aprovado','trafego') AND d.aprovado_em > NOW() - INTERVAL '60 days'))`;

export async function gcAprovacaoPublicaRoutes(app: FastifyInstance) {
  app.get<{ Params: { token: string } }>('/api/public/cliente/:token/artes', async (req, reply) => {
    const clienteId = await clienteDoToken(req.params.token);
    if (!clienteId) return reply.status(404).send({ message: 'Link inválido ou revogado' });
    const linhas = await query<{
      id: string; titulo: string; mes: string; status: string; ajuste_pedido: boolean; aprovado_em: string | null; aprovado_por: string;
      imagens: { id: string; name: string }[]; comentarios: { tipo: string; texto: string; autor_nome: string; created_at: string }[];
    }>(
      `SELECT d.id, d.titulo, d.mes, d.status, d.ajuste_pedido, d.aprovado_em, d.aprovado_por,
              COALESCE((SELECT jsonb_agg(jsonb_build_object('id', a->>'id', 'name', a->>'name') ORDER BY ord)
                        FROM jsonb_array_elements(d.anexos) WITH ORDINALITY AS t(a, ord)
                        WHERE COALESCE(a->>'papel', 'final') = 'final' AND a->>'type' LIKE 'image/%'), '[]'::jsonb) AS imagens,
              COALESCE((SELECT jsonb_agg(jsonb_build_object('tipo', ev.tipo, 'texto', ev.texto, 'autor_nome', ev.autor_nome,
                                                            'created_at', ev.created_at) ORDER BY ev.created_at)
                        FROM gc_social_eventos ev
                        WHERE ev.gc_producao_id = d.id AND ev.tipo IN ('ajuste_cliente','aprovado_cliente')), '[]'::jsonb) AS comentarios
       FROM gc_social_producao d
       WHERE d.gc_cliente_id = $1 AND ${VISIVEL}
       ORDER BY d.mes DESC, d.enviado_cliente_em DESC NULLS LAST, d.created_at DESC`,
      [clienteId],
    );
    return {
      artes: linhas
        .filter((l) => l.imagens.length > 0)
        .map((l) => ({
          id: l.id,
          titulo: tituloPublico(l.titulo),
          mes: l.mes,
          situacao: l.status === 'com_cliente' ? 'aguardando' : l.ajuste_pedido ? 'ajuste' : 'aprovado',
          aprovado_em: l.aprovado_em,
          aprovado_por: l.aprovado_por,
          imagens: l.imagens,
          comentarios: l.comentarios,
        })),
    };
  });

  // A imagem de uma arte final visível no portal. JPEG reduzido (leve no celular do cliente).
  app.get<{ Params: { token: string; id: string; anexo: string }; Querystring: { original?: string } }>(
    '/api/public/cliente/:token/artes/:id/imagem/:anexo',
    async (req, reply) => {
      const naoAchei = () => reply.status(404).send({ message: 'Imagem não encontrada' });
      if (!UUID.test(req.params.id)) return naoAchei();
      const clienteId = await clienteDoToken(req.params.token);
      if (!clienteId) return naoAchei();
      const r = await queryOne<{ anexo: { dataUrl?: string; papel?: string; type?: string; name?: string } | null }>(
        `SELECT (SELECT a FROM jsonb_array_elements(d.anexos) a WHERE a->>'id' = $3 LIMIT 1) AS anexo
         FROM gc_social_producao d WHERE d.id = $1 AND d.gc_cliente_id = $2 AND ${VISIVEL}`,
        [req.params.id, clienteId, req.params.anexo],
      );
      const a = r?.anexo;
      if (!a || a.papel === 'referencia' || !String(a.type ?? '').startsWith('image/')) return naoAchei();
      const dataUrl = String(a.dataUrl ?? '');
      const virgula = dataUrl.indexOf(',');
      if (!dataUrl.startsWith('data:image/') || virgula < 0) return naoAchei();
      const bruto = Buffer.from(dataUrl.slice(virgula + 1), 'base64');
      // Sempre re-codifica (nada de SVG/HTML rodando no navegador): JPEG, até 1600px, ou o original em JPEG cheio.
      const jpg = await sharp(bruto).rotate()
        .resize(req.query.original ? 4000 : 1600, req.query.original ? 4000 : 1600, { fit: 'inside', withoutEnlargement: true })
        .jpeg({ quality: req.query.original ? 95 : 85 }).toBuffer();
      const nome = String(a.name || 'arte').replace(/\.\w+$/, '').replace(/[^\w.\- ]+/g, '_').slice(0, 100) || 'arte';
      return reply
        .header('Content-Type', 'image/jpeg')
        .header('Cache-Control', 'private, max-age=300')
        .header('Content-Disposition', `${req.query.original ? 'attachment' : 'inline'}; filename="${nome}.jpg"`)
        .send(jpg);
    },
  );

  async function cardAguardando(token: string, id: string, reply: FastifyReply) {
    if (!UUID.test(id)) {
      reply.status(404).send({ message: 'Arte não encontrada' });
      return null;
    }
    const clienteId = await clienteDoToken(token);
    if (!clienteId) {
      reply.status(404).send({ message: 'Link inválido ou revogado' });
      return null;
    }
    const c = await queryOne<{ id: string; status: string }>(
      'SELECT id, status FROM gc_social_producao WHERE id = $1 AND gc_cliente_id = $2',
      [id, clienteId],
    );
    if (!c) {
      reply.status(404).send({ message: 'Arte não encontrada' });
      return null;
    }
    if (c.status !== 'com_cliente') {
      reply.status(409).send({ message: 'Essa arte já foi respondida. Atualize a página.' });
      return null;
    }
    return c;
  }

  app.post<{ Params: { token: string; id: string }; Body: { nome?: string } }>(
    '/api/public/cliente/:token/artes/:id/aprovar',
    { bodyLimit: 8 * 1024 },
    async (req, reply) => {
      const c = await cardAguardando(req.params.token, req.params.id, reply);
      if (!c) return;
      const nome = nomeDoCliente(req.body?.nome);
      await query(
        // Aprovado agora, por este cliente (sobrescreve uma aprovação antiga de quando a arte voltou pra ajuste).
        `UPDATE gc_social_producao SET status = 'aprovado', aprovado_em = NOW(), ajuste_pedido = false,
                aprovado_por = $2, updated_at = NOW()
         WHERE id = $1`,
        [c.id, nome],
      );
      await registrarEventoArte(c.id, 'aprovado_cliente', 'Aprovou a arte', { nome });
      void avisarMudanca(c.id, 'aprovado');
      void aoAprovar(c.id);
      return { ok: true };
    },
  );

  app.post<{ Params: { token: string; id: string }; Body: { nome?: string; comentario?: string } }>(
    '/api/public/cliente/:token/artes/:id/ajuste',
    { bodyLimit: 16 * 1024 },
    async (req, reply) => {
      const comentario = String(req.body?.comentario ?? '').trim().slice(0, 3000);
      if (!comentario) return reply.status(400).send({ message: 'Conte o que precisa mudar na arte' });
      const c = await cardAguardando(req.params.token, req.params.id, reply);
      if (!c) return;
      const nome = nomeDoCliente(req.body?.nome);
      // Volta pra criação, com o selo de "ajuste pedido" e o comentário no histórico.
      await query(
        `UPDATE gc_social_producao SET status = 'em_producao', ajuste_pedido = true, updated_at = NOW() WHERE id = $1`,
        [c.id],
      );
      await registrarEventoArte(c.id, 'ajuste_cliente', comentario, { nome });
      void avisarMudanca(c.id, 'ajuste', null, comentario);
      if (process.env.ANTHROPIC_API_KEY) {
        void checklistDoAjuste(c.id, comentario).catch((err) => console.error('[social] checklist do ajuste falhou', err));
      }
      return { ok: true };
    },
  );
}
