import { FastifyInstance } from 'fastify';
import { query, queryOne, withTransaction } from '../db.js';
import { DS_WORKSPACE_ID } from '../db/demoStudio.js';
import { exigir, papelDaRequisicao, papelNoModulo, validar, type Usuario } from '../lib/demoStudio/acesso.js';
import { demoStudioAnalyticsRoutes } from './demoStudioAnalytics.js';
import { demoStudioLeadsRoutes } from './demoStudioLeads.js';
import { demoStudioExtRoutes } from './demoStudioExt.js';
import { storage, tipoDoArquivo } from '../lib/demoStudio/storage.js';
import { ErroImagem, bufferDoDataUrl, processarImagem } from '../lib/demoStudio/images.js';
import * as S from '../lib/demoStudio/schemas.js';
import { criarLimitador, ehRobo, gravarLote, hashDoIp, ipDoVisitante, loteDeEventos } from '../lib/demoStudio/coleta.js';
import {
  despublicar,
  duplicarDemo,
  montarSnapshot,
  problemasParaPublicar,
  publicar,
  restaurarVersao,
  slugLivre,
  versaoPublicada,
} from '../lib/demoStudio/snapshot.js';

/**
 * Rotas do Demo Studio (ver docs/demo-studio/ADAPTACAO.md): painel em /api/ds/*, público em
 * /api/public/ds/*, arquivos em /files/*. Erros no padrão do projeto: { message }.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/* ------------------------------------------------------------------ formato de saída (camelCase) */

function demoDaLinha(d: Record<string, any>) {
  return {
    id: d.id,
    name: d.name,
    slug: d.slug,
    description: d.description,
    status: d.status,
    isTemplate: d.is_template,
    segment: d.segment,
    theme: d.theme ?? {},
    settings: d.settings ?? {},
    coverFrameId: d.cover_frame_id,
    publishedVersionId: d.published_version_id,
    createdAt: d.created_at,
    updatedAt: d.updated_at,
  };
}

function frameDaLinha(f: Record<string, any>) {
  return {
    id: f.id,
    name: f.name,
    image: f.image_path,
    thumb: f.thumb_path,
    width: f.width,
    height: f.height,
    pixelRatio: f.pixel_ratio,
    displayUrl: f.display_url,
    createdAt: f.created_at,
  };
}

function etapaDaLinha(s: Record<string, any>) {
  return {
    id: s.id,
    order: s.order,
    kind: s.kind,
    frameId: s.frame_id,
    chapterId: s.chapter_id,
    hotspot: s.hotspot,
    title: s.title,
    body: s.body,
    placement: s.placement,
    buttonLabel: s.button_label,
    cta: s.cta,
    form: s.form,
  };
}

async function tocarDemo(demoId: string) {
  await query(`UPDATE ds_demos SET updated_at = NOW() WHERE id = $1`, [demoId]);
}

/** Renumera as etapas 1..N na ordem atual (depois de apagar/inserir). */
async function renumerar(demoId: string) {
  await query(
    `UPDATE ds_steps s SET "order" = n.pos FROM (
       SELECT id, ROW_NUMBER() OVER (ORDER BY "order", id) AS pos FROM ds_steps WHERE demo_id = $1
     ) n WHERE s.id = n.id`,
    [demoId]
  );
}

export async function demoStudioRoutes(app: FastifyInstance) {
  const ver = { onRequest: [app.authenticate], preHandler: exigir('ver') };
  const editar = { onRequest: [app.authenticate], preHandler: exigir('editar') };
  const soAdmin = { onRequest: [app.authenticate], preHandler: exigir('admin') };

  await demoStudioAnalyticsRoutes(app);
  await demoStudioLeadsRoutes(app);
  await demoStudioExtRoutes(app);

  /* ---------------------------------------------------------------- fundação (M0) */

  // Imagens e assets das demos. Público (o player e o preview do WhatsApp leem daqui) e com cache
  // imutável: os nomes levam hash do conteúdo, um arquivo nunca muda depois de gravado.
  app.get<{ Params: { '*': string } }>('/files/*', async (req, reply) => {
    const key = req.params['*'];
    const arquivo = await storage.get(key);
    if (!arquivo) return reply.status(404).send({ message: 'Arquivo não encontrado' });
    return reply
      .header('Content-Type', tipoDoArquivo(key))
      .header('Content-Length', arquivo.size)
      .header('Cache-Control', 'public, max-age=31536000, immutable')
      .header('X-Content-Type-Options', 'nosniff')
      .send(arquivo.stream);
  });

  // Healthcheck com o banco junto (o /health antigo só diz que o processo está de pé).
  app.get('/api/health', async (_req, reply) => {
    try {
      await queryOne('SELECT 1');
      return { ok: true, db: true };
    } catch {
      return reply.status(503).send({ ok: false, db: false });
    }
  });

  /* ---------------------------------------------------------------- quem sou eu no módulo */

  app.get('/api/ds/me', { onRequest: [app.authenticate] }, async (req, reply) => {
    const papel = await papelNoModulo(req);
    if (!papel) return reply.status(403).send({ message: 'Sem acesso ao Demo Studio.' });
    const ws = await queryOne<{ settings: Record<string, unknown> }>('SELECT settings FROM ds_workspaces WHERE id = $1', [DS_WORKSPACE_ID]);
    return { role: papel, publicBaseUrl: process.env.PUBLIC_BASE_URL || null, workspace: ws?.settings ?? {} };
  });

  /* ---------------------------------------------------------------- demos */

  app.get('/api/ds/demos', ver, async (req) => {
    // Vendedor só enxerga demo publicada (§2).
    const soPublicadas = papelDaRequisicao(req) === 'SELLER';
    const rows = await query(
      `SELECT d.*,
         (SELECT COUNT(*)::int FROM ds_steps s WHERE s.demo_id = d.id) AS steps_count,
         (SELECT f.thumb_path FROM ds_frames f WHERE f.id = COALESCE(d.cover_frame_id,
            (SELECT s.frame_id FROM ds_steps s WHERE s.demo_id = d.id ORDER BY s."order" LIMIT 1))) AS cover_thumb,
         (SELECT COUNT(*)::int FROM ds_view_sessions v
           WHERE v.demo_id = d.id AND NOT v.internal AND v.started_at > NOW() - INTERVAL '30 days') AS views_30d,
         (SELECT COUNT(DISTINCT v.lead_id)::int FROM ds_view_sessions v
           WHERE v.demo_id = d.id AND v.lead_id IS NOT NULL AND v.started_at > NOW() - INTERVAL '30 days') AS leads_30d
       FROM ds_demos d
       WHERE d.workspace_id = $1 AND d.status <> 'ARCHIVED' AND (NOT $2 OR d.status = 'PUBLISHED')
       ORDER BY d.updated_at DESC`,
      [DS_WORKSPACE_ID, soPublicadas]
    );
    return rows.map((d: Record<string, any>) => ({
      ...demoDaLinha(d),
      stepsCount: d.steps_count,
      coverThumb: d.cover_thumb,
      views30d: d.views_30d,
      leads30d: d.leads_30d,
    }));
  });

  app.post('/api/ds/demos', editar, async (req, reply) => {
    const dados = validar(S.criarDemo, req.body, reply);
    if (!dados) return;
    const { sub } = req.user as Usuario;
    if (dados.fromTemplateId) {
      const id = await duplicarDemo(dados.fromTemplateId, dados.name, sub);
      if (!id) return reply.status(404).send({ message: 'Exemplo não encontrado' });
      return reply.status(201).send({ id });
    }
    const ws = await queryOne<{ settings: { ctaDefault?: { phone?: string; message?: string } } }>(
      'SELECT settings FROM ds_workspaces WHERE id = $1',
      [DS_WORKSPACE_ID]
    );
    const slug = await slugLivre(dados.name);
    const row = await queryOne<{ id: string }>(
      `INSERT INTO ds_demos (workspace_id, name, slug, theme, settings, created_by)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [
        DS_WORKSPACE_ID, dados.name, slug,
        JSON.stringify({ accent: '#2c6bc8', brandName: 'NX Systems', logoText: 'NX' }),
        JSON.stringify({
          showProgress: true,
          showRestart: true,
          ctaPhone: ws?.settings?.ctaDefault?.phone ?? '5548936181649',
          ctaMessage: ws?.settings?.ctaDefault?.message ?? '',
        }),
        sub,
      ]
    );
    return reply.status(201).send({ id: row!.id });
  });

  app.get<{ Params: { id: string } }>('/api/ds/demos/:id', ver, async (req, reply) => {
    if (!UUID.test(req.params.id)) return reply.status(404).send({ message: 'Demo não encontrada' });
    const d = await queryOne<Record<string, any>>('SELECT * FROM ds_demos WHERE id = $1', [req.params.id]);
    if (!d) return reply.status(404).send({ message: 'Demo não encontrada' });
    const [frames, steps, chapters, versoes] = await Promise.all([
      query('SELECT * FROM ds_frames WHERE demo_id = $1 ORDER BY created_at', [d.id]),
      query('SELECT * FROM ds_steps WHERE demo_id = $1 ORDER BY "order"', [d.id]),
      query('SELECT id, name, "order" FROM ds_chapters WHERE demo_id = $1 ORDER BY "order"', [d.id]),
      queryOne<{ n: number; ultima: string | null }>(
        'SELECT COUNT(*)::int AS n, MAX(created_at) AS ultima FROM ds_demo_versions WHERE demo_id = $1',
        [d.id]
      ),
    ]);
    return {
      ...demoDaLinha(d),
      frames: frames.map(frameDaLinha),
      steps: steps.map(etapaDaLinha),
      chapters,
      versionsCount: versoes?.n ?? 0,
      lastPublishedAt: versoes?.ultima ?? null,
    };
  });

  app.patch<{ Params: { id: string } }>('/api/ds/demos/:id', editar, async (req, reply) => {
    const dados = validar(S.editarDemo, req.body, reply);
    if (!dados) return;
    const atual = await queryOne<Record<string, any>>('SELECT * FROM ds_demos WHERE id = $1', [req.params.id]);
    if (!atual) return reply.status(404).send({ message: 'Demo não encontrada' });
    if (dados.slug && dados.slug !== atual.slug) {
      const usado = await queryOne('SELECT 1 FROM ds_demos WHERE slug = $1 AND id <> $2', [dados.slug, atual.id]);
      if (usado) return reply.status(409).send({ message: 'Esse endereço já é usado por outra demo.' });
    }
    await query(
      `UPDATE ds_demos SET
         name = COALESCE($2, name),
         slug = COALESCE($3, slug),
         description = CASE WHEN $4::boolean THEN $5 ELSE description END,
         is_template = COALESCE($6, is_template),
         segment = CASE WHEN $7::boolean THEN $8 ELSE segment END,
         cover_frame_id = CASE WHEN $9::boolean THEN $10::uuid ELSE cover_frame_id END,
         theme = theme || $11::jsonb,
         settings = settings || $12::jsonb,
         updated_at = NOW()
       WHERE id = $1`,
      [
        atual.id, dados.name ?? null, dados.slug ?? null,
        'description' in dados, dados.description ?? null,
        dados.isTemplate ?? null,
        'segment' in dados, dados.segment ?? null,
        'coverFrameId' in dados, dados.coverFrameId ?? null,
        JSON.stringify(dados.theme ?? {}), JSON.stringify(dados.settings ?? {}),
      ]
    );
    return { ok: true };
  });

  app.delete<{ Params: { id: string } }>('/api/ds/demos/:id', soAdmin, async (req, reply) => {
    const r = await query('DELETE FROM ds_demos WHERE id = $1 RETURNING id', [req.params.id]);
    if (!r.length) return reply.status(404).send({ message: 'Demo não encontrada' });
    return reply.status(204).send();
  });

  app.post<{ Params: { id: string } }>('/api/ds/demos/:id/duplicate', editar, async (req, reply) => {
    const o = await queryOne<{ name: string }>('SELECT name FROM ds_demos WHERE id = $1', [req.params.id]);
    if (!o) return reply.status(404).send({ message: 'Demo não encontrada' });
    const id = await duplicarDemo(req.params.id, `${o.name} (cópia)`, (req.user as Usuario).sub);
    return reply.status(201).send({ id });
  });

  /** Rascunho no formato do player — pré-visualização no painel. */
  app.get<{ Params: { id: string } }>('/api/ds/demos/:id/draft', ver, async (req, reply) => {
    const snap = await montarSnapshot(req.params.id);
    if (!snap) return reply.status(404).send({ message: 'Demo não encontrada' });
    return snap;
  });

  /* ---------------------------------------------------------------- publicar e versões */

  app.post<{ Params: { id: string } }>('/api/ds/demos/:id/publish', editar, async (req, reply) => {
    const snap = await montarSnapshot(req.params.id);
    if (!snap) return reply.status(404).send({ message: 'Demo não encontrada' });
    const problemas = problemasParaPublicar(snap);
    if (problemas.length) return reply.status(422).send({ message: problemas[0], problems: problemas });
    const v = await publicar(req.params.id, (req.user as Usuario).sub);
    return { ok: true, version: v.number, url: `/d/${snap.slug}` };
  });

  app.post<{ Params: { id: string } }>('/api/ds/demos/:id/unpublish', editar, async (req) => {
    await despublicar(req.params.id);
    return { ok: true };
  });

  app.get<{ Params: { id: string } }>('/api/ds/demos/:id/versions', ver, async (req) => {
    return query(
      `SELECT v.id, v.number, v.created_at AS "createdAt", p.name AS "publishedBy",
              jsonb_array_length(v.snapshot->'steps') AS "stepsCount",
              (d.published_version_id = v.id) AS "isCurrent"
       FROM ds_demo_versions v
       JOIN ds_demos d ON d.id = v.demo_id
       LEFT JOIN profiles p ON p.id = v.published_by
       WHERE v.demo_id = $1 ORDER BY v.number DESC`,
      [req.params.id]
    );
  });

  app.post<{ Params: { id: string; n: string } }>('/api/ds/demos/:id/versions/:n/restore', editar, async (req, reply) => {
    const ok = await restaurarVersao(req.params.id, Number(req.params.n));
    if (!ok) return reply.status(404).send({ message: 'Versão não encontrada' });
    return { ok: true };
  });

  /* ---------------------------------------------------------------- frames */

  app.post<{ Params: { id: string } }>('/api/ds/demos/:id/frames', editar, async (req, reply) => {
    const dados = validar(S.enviarFrame.extend({ createStep: S.criarEtapa.shape.kind.optional() }), req.body, reply);
    if (!dados) return;
    const demo = await queryOne('SELECT 1 FROM ds_demos WHERE id = $1', [req.params.id]);
    if (!demo) return reply.status(404).send({ message: 'Demo não encontrada' });
    let p;
    try {
      p = await processarImagem(bufferDoDataUrl(dados.dataUrl), dados.pixelRatio);
    } catch (err) {
      if (err instanceof ErroImagem) return reply.status(400).send({ message: err.message });
      throw err;
    }
    const frame = await queryOne<Record<string, any>>(
      `INSERT INTO ds_frames (demo_id, name, image_path, thumb_path, width, height, pixel_ratio, display_url)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
      [req.params.id, dados.name ?? null, p.imagePath, p.thumbPath, p.width, p.height, p.pixelRatio, dados.displayUrl ?? null]
    );
    // "Enviar telas" já cria uma etapa por tela, na ordem do envio (o editor marca as sem destaque).
    if (dados.createStep) {
      await query(
        `INSERT INTO ds_steps (demo_id, frame_id, "order", kind)
         VALUES ($1, $2, (SELECT COALESCE(MAX("order"), 0) + 1 FROM ds_steps WHERE demo_id = $1), $3)`,
        [req.params.id, frame!.id, dados.createStep]
      );
    }
    await tocarDemo(req.params.id);
    return reply.status(201).send(frameDaLinha(frame!));
  });

  app.patch<{ Params: { id: string } }>('/api/ds/frames/:id', editar, async (req, reply) => {
    const dados = validar(S.editarFrame, req.body, reply);
    if (!dados) return;
    const f = await queryOne<Record<string, any>>(
      `UPDATE ds_frames SET
         name = CASE WHEN $2::boolean THEN $3 ELSE name END,
         display_url = CASE WHEN $4::boolean THEN $5 ELSE display_url END
       WHERE id = $1 RETURNING *`,
      [req.params.id, 'name' in dados, dados.name ?? null, 'displayUrl' in dados, dados.displayUrl ?? null]
    );
    if (!f) return reply.status(404).send({ message: 'Tela não encontrada' });
    await tocarDemo(f.demo_id);
    return frameDaLinha(f);
  });

  app.delete<{ Params: { id: string } }>('/api/ds/frames/:id', editar, async (req, reply) => {
    const f = await queryOne<{ demo_id: string }>('SELECT demo_id FROM ds_frames WHERE id = $1', [req.params.id]);
    if (!f) return reply.status(404).send({ message: 'Tela não encontrada' });
    if (await queryOne('SELECT 1 FROM ds_steps WHERE frame_id = $1 LIMIT 1', [req.params.id])) {
      return reply.status(409).send({ message: 'Essa tela está em uso por uma etapa. Troque a tela da etapa antes.' });
    }
    // Frame de versão publicada não pode sumir: o link no ar ainda mostra ele (os arquivos ficam no storage).
    const emVersao = await queryOne(
      `SELECT 1 FROM ds_demo_versions WHERE demo_id = $1 AND snapshot->'frames' @> jsonb_build_array(jsonb_build_object('id', $2::text)) LIMIT 1`,
      [f.demo_id, req.params.id]
    );
    if (emVersao) return reply.status(409).send({ message: 'Essa tela faz parte de uma versão publicada e não pode ser apagada.' });
    await query(`UPDATE ds_demos SET cover_frame_id = NULL WHERE cover_frame_id = $1`, [req.params.id]);
    await query('DELETE FROM ds_frames WHERE id = $1', [req.params.id]);
    await tocarDemo(f.demo_id);
    return reply.status(204).send();
  });

  /* ---------------------------------------------------------------- etapas */

  app.post<{ Params: { id: string } }>('/api/ds/demos/:id/steps', editar, async (req, reply) => {
    const dados = validar(S.criarEtapa, req.body, reply);
    if (!dados) return;
    const frame = await queryOne('SELECT 1 FROM ds_frames WHERE id = $1 AND demo_id = $2', [dados.frameId, req.params.id]);
    if (!frame) return reply.status(400).send({ message: 'Tela não pertence a esta demo' });
    const posicao = await withTransaction(async (c) => {
      const { rows } = await c.query(`SELECT COALESCE(MAX("order"), 0) AS m FROM ds_steps WHERE demo_id = $1`, [req.params.id]);
      const max = Number(rows[0].m);
      const pos = dados.afterOrder !== undefined ? Math.min(dados.afterOrder, max) + 1 : max + 1;
      await c.query(`UPDATE ds_steps SET "order" = "order" + 1 WHERE demo_id = $1 AND "order" >= $2`, [req.params.id, pos]);
      const padrao: Record<string, unknown> = {
        CTA: { type: 'WHATSAPP', buttonLabel: 'Falar no WhatsApp', collect: ['nome', 'empresa'] },
      };
      const { rows: nova } = await c.query(
        `INSERT INTO ds_steps (demo_id, frame_id, "order", kind, hotspot, title, cta, form)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
        [
          req.params.id, dados.frameId, pos, dados.kind,
          dados.hotspot ? JSON.stringify(dados.hotspot) : null, dados.title ?? '',
          padrao[dados.kind] ? JSON.stringify(padrao[dados.kind]) : null,
          dados.kind === 'LEAD_FORM'
            ? JSON.stringify({ fields: [{ key: 'nome', label: 'Seu nome', required: true }, { key: 'empresa', label: 'Empresa' }, { key: 'whatsapp', label: 'WhatsApp', required: true }] })
            : null,
        ]
      );
      return nova[0];
    });
    await tocarDemo(req.params.id);
    return reply.status(201).send(etapaDaLinha(posicao));
  });

  app.patch<{ Params: { id: string } }>('/api/ds/steps/:id', editar, async (req, reply) => {
    const dados = validar(S.editarEtapa, req.body, reply);
    if (!dados) return;
    const atual = await queryOne<{ demo_id: string }>('SELECT demo_id FROM ds_steps WHERE id = $1', [req.params.id]);
    if (!atual) return reply.status(404).send({ message: 'Etapa não encontrada' });
    if (dados.frameId) {
      const ok = await queryOne('SELECT 1 FROM ds_frames WHERE id = $1 AND demo_id = $2', [dados.frameId, atual.demo_id]);
      if (!ok) return reply.status(400).send({ message: 'Tela não pertence a esta demo' });
    }
    const colunas: Record<string, string> = {
      kind: 'kind', frameId: 'frame_id', hotspot: 'hotspot', title: 'title', body: 'body',
      placement: 'placement', buttonLabel: 'button_label', cta: 'cta', form: 'form',
    };
    const sets: string[] = [];
    const valores: unknown[] = [req.params.id];
    for (const [campo, coluna] of Object.entries(colunas)) {
      if (!(campo in dados)) continue;
      const v = (dados as Record<string, unknown>)[campo];
      valores.push(['hotspot', 'cta', 'form'].includes(campo) ? (v === null ? null : JSON.stringify(v)) : v);
      sets.push(`${coluna} = $${valores.length}`);
    }
    if (!sets.length) return { ok: true };
    const s = await queryOne<Record<string, any>>(`UPDATE ds_steps SET ${sets.join(', ')} WHERE id = $1 RETURNING *`, valores);
    await tocarDemo(atual.demo_id);
    return etapaDaLinha(s!);
  });

  app.delete<{ Params: { id: string } }>('/api/ds/steps/:id', editar, async (req, reply) => {
    const s = await queryOne<{ demo_id: string }>('DELETE FROM ds_steps WHERE id = $1 RETURNING demo_id', [req.params.id]);
    if (!s) return reply.status(404).send({ message: 'Etapa não encontrada' });
    await renumerar(s.demo_id);
    await tocarDemo(s.demo_id);
    return reply.status(204).send();
  });

  app.post<{ Params: { id: string } }>('/api/ds/demos/:id/steps/reorder', editar, async (req, reply) => {
    const dados = validar(S.reordenar, req.body, reply);
    if (!dados) return;
    const atuais = await query<{ id: string }>('SELECT id FROM ds_steps WHERE demo_id = $1', [req.params.id]);
    const conjunto = new Set(atuais.map((a) => a.id));
    if (atuais.length !== dados.ids.length || !dados.ids.every((id) => conjunto.has(id))) {
      return reply.status(400).send({ message: 'A lista de etapas mudou. Recarregue o editor.' });
    }
    await query(
      `UPDATE ds_steps s SET "order" = x.pos FROM unnest($2::uuid[]) WITH ORDINALITY AS x(id, pos)
       WHERE s.id = x.id AND s.demo_id = $1`,
      [req.params.id, dados.ids]
    );
    await tocarDemo(req.params.id);
    return { ok: true };
  });

  /* ---------------------------------------------------------------- público (sem login) */

  // Coleta de eventos do player (§8.2). Chega como text/plain (sendBeacon entre domínios, sem preflight).
  // Sempre 204, mesmo com lote inválido: o player não tem o que fazer com erro e não pode travar por isso.
  const limiteColeta = criarLimitador(60, 60_000);
  app.post('/api/t', { bodyLimit: 64 * 1024 }, async (req, reply) => {
    const ip = ipDoVisitante(req.headers['x-forwarded-for'], req.ip);
    if (!limiteColeta(ip)) return reply.status(429).send();
    const ua = req.headers['user-agent'];
    if (ehRobo(ua)) return reply.status(204).send();
    let corpo: unknown = req.body;
    if (typeof corpo === 'string') {
      try {
        corpo = JSON.parse(corpo);
      } catch {
        return reply.status(204).send();
      }
    }
    const lote = loteDeEventos.safeParse(corpo);
    if (!lote.success) return reply.status(204).send();
    try {
      await gravarLote(lote.data, { ua: ua!, ipHash: hashDoIp(ip) });
    } catch (err) {
      req.log.error({ err }, '[demo-studio] falha ao gravar eventos');
    }
    return reply.status(204).send();
  });

  app.get<{ Params: { slug: string } }>('/api/public/ds/demos/:slug', async (req, reply) => {
    reply.header('Access-Control-Allow-Origin', '*');
    const snap = await versaoPublicada(req.params.slug);
    if (!snap) return reply.status(404).send({ message: 'Demo não encontrada ou fora do ar.' });
    return reply.header('Cache-Control', 'public, max-age=30').send(snap);
  });
}
