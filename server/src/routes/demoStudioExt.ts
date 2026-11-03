import { createHash, randomBytes } from 'node:crypto';
import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { query, queryOne } from '../db.js';
import { DS_WORKSPACE_ID } from '../db/demoStudio.js';
import { exigir, validar, type Papel, type Usuario } from '../lib/demoStudio/acesso.js';
import { ErroImagem, bufferDoDataUrl, processarImagem } from '../lib/demoStudio/images.js';
import { slugLivre } from '../lib/demoStudio/snapshot.js';
import { chaveComHash, storage } from '../lib/demoStudio/storage.js';

/**
 * Extensão de captura (§6, M4) e o que o painel configura para ela: token pessoal (só o hash fica salvo,
 * o token aparece uma vez) e regras de anonimização do workspace.
 * As rotas /api/ext/* autenticam por `Authorization: Bearer nxd_…`, não pela sessão do painel.
 */

const LIMITE_TELAS = 40;
const MAX_IMAGEM = 6 * 1024 * 1024;

export function hashDoToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/**
 * Limpeza do snapshot HTML (§13): sem script/iframe/object/embed, sem on*, sem javascript:. O snapshot ainda
 * não é exibido em lugar nenhum (frames HTML editáveis são do M6, sempre em iframe sandbox) — isto é a
 * primeira barreira; o render do M6 passa por DOMPurify de novo.
 */
export function limparHtml(html: string): string {
  return html
    .replace(/<(script|iframe|object|embed|noscript)\b[\s\S]*?<\/\1\s*>/gi, '')
    .replace(/<(script|iframe|object|embed|link|meta|base)\b[^>]*\/?>/gi, '')
    .replace(/\s+on[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/(href|src|xlink:href|action|formaction)\s*=\s*("|')\s*javascript:[^"']*\2/gi, '$1=$2#$2');
}

type ReqExt = FastifyRequest & { ext?: { userId: string; nome: string | null; email: string; papel: Papel } };

/** Autenticação da extensão: token válido, não revogado, de alguém que ainda pode editar no módulo. */
async function autenticarExtensao(req: FastifyRequest, reply: FastifyReply) {
  const h = req.headers.authorization ?? '';
  const token = h.startsWith('Bearer ') ? h.slice(7).trim() : '';
  if (!token.startsWith('nxd_')) return reply.status(401).send({ message: 'Token da extensão ausente ou inválido.' });
  const t = await queryOne<{ id: string; user_id: string; role: string; ds_role: string | null; name: string | null; email: string }>(
    `SELECT t.id, t.user_id, p.role, p.ds_role, p.name, p.email FROM ds_api_tokens t JOIN profiles p ON p.id = t.user_id
     WHERE t.token_hash = $1 AND t.revoked_at IS NULL`,
    [hashDoToken(token)]
  );
  if (!t) return reply.status(401).send({ message: 'Token revogado ou inexistente. Gere outro em Demo Studio → Configurações → Extensão.' });
  let papel: Papel;
  if (t.role === 'admin') papel = 'ADMIN';
  else {
    const marca = await queryOne(`SELECT 1 FROM user_menu_access WHERE user_id = $1 AND menu_key = 'demo_studio'`, [t.user_id]);
    if (!marca) return reply.status(403).send({ message: 'Seu acesso ao Demo Studio foi retirado.' });
    papel = t.ds_role === 'SELLER' ? 'SELLER' : 'EDITOR';
  }
  if (papel === 'SELLER') return reply.status(403).send({ message: 'Vendedor não captura telas. Peça o papel de editor.' });
  await query(`UPDATE ds_api_tokens SET last_used_at = NOW() WHERE id = $1`, [t.id]);
  (req as ReqExt).ext = { userId: t.user_id, nome: t.name, email: t.email, papel };
}

const usuarioExt = (req: FastifyRequest) => (req as ReqExt).ext!;

const caixa = z.object({ x: z.number().finite(), y: z.number().finite(), w: z.number().finite(), h: z.number().finite() });
const tela = z.object({
  image: z.string().min(30),
  viewport: z.object({ width: z.number().int().min(200).max(8000), height: z.number().int().min(150).max(8000), dpr: z.number().min(0.5).max(4) }),
  url: z.string().max(2000),
  title: z.string().max(300).optional(),
  click: caixa.extend({ selector: z.string().max(500).optional(), text: z.string().max(300).optional() }).nullable(),
  html: z.string().max(8 * 1024 * 1024).optional(),
  cssAssetId: z.string().uuid().optional(),
});

/** Endereço que aparece na barra falsa do player: domínio + caminho, sem query nem hash (podem ter dados). */
export function enderecoExibido(url: string): string | null {
  try {
    const u = new URL(url);
    return (u.host + u.pathname).replace(/\/$/, '/') || null;
  } catch {
    return null;
  }
}

/** Retângulo do clique preso à tela capturada (px CSS). Pequeno demais = sem destaque. */
export function hotspotDoClique(c: { x: number; y: number; w: number; h: number } | null, largura: number, altura: number) {
  if (!c) return null;
  const x = Math.max(0, Math.min(Math.round(c.x), largura - 1));
  const y = Math.max(0, Math.min(Math.round(c.y), altura - 1));
  const w = Math.min(Math.round(c.w + Math.min(c.x, 0)), largura - x);
  const h = Math.min(Math.round(c.h + Math.min(c.y, 0)), altura - y);
  return w >= 4 && h >= 4 ? { x, y, w, h } : null;
}

export async function demoStudioExtRoutes(app: FastifyInstance) {
  const ext = { onRequest: [autenticarExtensao] };
  const editar = { onRequest: [app.authenticate], preHandler: exigir('editar') };
  const ver = { onRequest: [app.authenticate], preHandler: exigir('ver') };
  const soAdmin = { onRequest: [app.authenticate], preHandler: exigir('admin') };

  /* ---------------------------------------------------------------- tokens (painel) */

  app.get('/api/ds/tokens', editar, async (req) => {
    return query(
      `SELECT id, name, created_at AS "createdAt", last_used_at AS "lastUsedAt", revoked_at AS "revokedAt"
       FROM ds_api_tokens WHERE user_id = $1 ORDER BY created_at DESC`,
      [(req.user as Usuario).sub]
    );
  });

  app.post('/api/ds/tokens', editar, async (req, reply) => {
    const dados = validar(z.object({ name: z.string().trim().min(1).max(60).default('Extensão') }), req.body, reply);
    if (!dados) return;
    const token = 'nxd_' + randomBytes(24).toString('hex');
    const r = await queryOne<{ id: string }>(
      `INSERT INTO ds_api_tokens (user_id, name, token_hash) VALUES ($1, $2, $3) RETURNING id`,
      [(req.user as Usuario).sub, dados.name, hashDoToken(token)]
    );
    // O token em claro só existe nesta resposta.
    return reply.status(201).send({ id: r!.id, token });
  });

  app.delete<{ Params: { id: string } }>('/api/ds/tokens/:id', editar, async (req, reply) => {
    await query(`UPDATE ds_api_tokens SET revoked_at = NOW() WHERE id = $1 AND user_id = $2 AND revoked_at IS NULL`, [req.params.id, (req.user as Usuario).sub]);
    return reply.status(204).send();
  });

  /* ---------------------------------------------------------------- regras de anonimização (painel) */

  const regra = z.object({ find: z.string().min(1).max(300), replace: z.string().max(300), isRegex: z.boolean().default(false) });

  app.get('/api/ds/anonymize-rules', ver, async () => {
    return query(
      `SELECT id, find, replace, is_regex AS "isRegex", "order" FROM ds_anonymize_rules WHERE workspace_id = $1 ORDER BY "order", find`,
      [DS_WORKSPACE_ID]
    );
  });

  app.post('/api/ds/anonymize-rules', soAdmin, async (req, reply) => {
    const dados = validar(regra, req.body, reply);
    if (!dados) return;
    if (dados.isRegex) {
      try { new RegExp(dados.find); } catch { return reply.status(400).send({ message: 'Expressão regular inválida.' }); }
    }
    const r = await queryOne(
      `INSERT INTO ds_anonymize_rules (workspace_id, find, replace, is_regex, "order")
       VALUES ($1, $2, $3, $4, (SELECT COALESCE(MAX("order"), 0) + 1 FROM ds_anonymize_rules WHERE workspace_id = $1)) RETURNING id`,
      [DS_WORKSPACE_ID, dados.find, dados.replace, dados.isRegex]
    );
    return reply.status(201).send(r);
  });

  app.patch<{ Params: { id: string } }>('/api/ds/anonymize-rules/:id', soAdmin, async (req, reply) => {
    const dados = validar(regra.partial(), req.body, reply);
    if (!dados) return;
    if (dados.isRegex && dados.find) {
      try { new RegExp(dados.find); } catch { return reply.status(400).send({ message: 'Expressão regular inválida.' }); }
    }
    await query(
      `UPDATE ds_anonymize_rules SET find = COALESCE($2, find), replace = COALESCE($3, replace), is_regex = COALESCE($4, is_regex) WHERE id = $1`,
      [req.params.id, dados.find ?? null, dados.replace ?? null, dados.isRegex ?? null]
    );
    return { ok: true };
  });

  app.delete<{ Params: { id: string } }>('/api/ds/anonymize-rules/:id', soAdmin, async (req, reply) => {
    await query(`DELETE FROM ds_anonymize_rules WHERE id = $1`, [req.params.id]);
    return reply.status(204).send();
  });

  /* ---------------------------------------------------------------- extensão */

  app.get('/api/ext/me', ext, async (req) => {
    const u = usuarioExt(req);
    return { user: { name: u.nome, email: u.email }, role: u.papel, panelUrl: (process.env.PUBLIC_BASE_URL || '').replace(/\/+$/, '') || null };
  });

  app.get('/api/ext/demos', ext, async () => {
    return query(
      `SELECT id, name, status, (SELECT COUNT(*)::int FROM ds_steps s WHERE s.demo_id = d.id) AS "stepsCount"
       FROM ds_demos d WHERE workspace_id = $1 AND status <> 'ARCHIVED' ORDER BY updated_at DESC`,
      [DS_WORKSPACE_ID]
    );
  });

  app.post('/api/ext/demos', ext, async (req, reply) => {
    const dados = validar(z.object({ name: z.string().trim().min(1, 'Dê um nome para a demo').max(120) }), req.body, reply);
    if (!dados) return;
    const ws = await queryOne<{ settings: { ctaDefault?: { phone?: string; message?: string } } }>('SELECT settings FROM ds_workspaces WHERE id = $1', [DS_WORKSPACE_ID]);
    const r = await queryOne<{ id: string }>(
      `INSERT INTO ds_demos (workspace_id, name, slug, theme, settings, created_by) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [
        DS_WORKSPACE_ID, dados.name, await slugLivre(dados.name),
        JSON.stringify({ accent: '#2c6bc8', brandName: 'NX Systems', logoText: 'NX' }),
        JSON.stringify({ showProgress: true, showRestart: true, ctaPhone: ws?.settings?.ctaDefault?.phone ?? '5548936181649', ctaMessage: ws?.settings?.ctaDefault?.message ?? '' }),
        usuarioExt(req).userId,
      ]
    );
    return reply.status(201).send({ id: r!.id, name: dados.name });
  });

  app.get('/api/ext/anonymize-rules', ext, async (req) => {
    const [regras, ws] = await Promise.all([
      query(`SELECT find, replace, is_regex AS "isRegex" FROM ds_anonymize_rules WHERE workspace_id = $1 ORDER BY "order", find`, [DS_WORKSPACE_ID]),
      queryOne<{ settings: Record<string, any> }>('SELECT settings FROM ds_workspaces WHERE id = $1', [DS_WORKSPACE_ID]),
    ]);
    return {
      rules: regras,
      auto: { phone: true, email: true, cpf: true, cnpj: true, avatars: true, ...(ws?.settings?.anonymizeAuto ?? {}) },
      // Anonimização é obrigatória por padrão (§13): só administrador pode desligar na extensão.
      canDisable: usuarioExt(req).papel === 'ADMIN',
    };
  });

  /** CSS da página (modo Imagem + HTML): uma vez por captura, deduplicado por SHA-256 (§6.3). */
  app.post('/api/ext/css', { ...ext, bodyLimit: 12 * 1024 * 1024 }, async (req, reply) => {
    const dados = validar(z.object({ css: z.string().min(1).max(10 * 1024 * 1024) }), req.body, reply);
    if (!dados) return;
    const buf = Buffer.from(dados.css, 'utf8');
    const sha = createHash('sha256').update(buf).digest('hex');
    const existente = await queryOne<{ id: string }>(`SELECT id FROM ds_css_assets WHERE sha256 = $1`, [sha]);
    if (existente) return { cssAssetId: existente.id };
    const caminho = `css/${sha.slice(0, 32)}.css`;
    await storage.put(caminho, buf);
    const r = await queryOne<{ id: string }>(
      `INSERT INTO ds_css_assets (sha256, path, bytes) VALUES ($1, $2, $3) ON CONFLICT (sha256) DO UPDATE SET sha256 = EXCLUDED.sha256 RETURNING id`,
      [sha, caminho, buf.length]
    );
    return { cssAssetId: r!.id };
  });

  /**
   * Uma tela capturada → um frame + uma etapa HOTSPOT no fim da demo, com o retângulo do clique como destaque
   * (§6.2 passo 7). A extensão envia uma tela por vez, na ordem; título fica vazio (o editor sinaliza).
   */
  app.post<{ Params: { id: string } }>('/api/ext/demos/:id/screens', { ...ext, bodyLimit: 20 * 1024 * 1024 }, async (req, reply) => {
    const dados = validar(tela, req.body, reply);
    if (!dados) return;
    const demo = await queryOne<{ id: string }>(`SELECT id FROM ds_demos WHERE id = $1`, [req.params.id]);
    if (!demo) return reply.status(404).send({ message: 'Demo não encontrada' });
    const qtd = await queryOne<{ n: number }>(`SELECT COUNT(*)::int AS n FROM ds_steps WHERE demo_id = $1`, [demo.id]);
    if ((qtd?.n ?? 0) >= 500) return reply.status(400).send({ message: 'A demo já tem etapas demais.' });

    let buf: Buffer;
    try {
      buf = bufferDoDataUrl(dados.image);
    } catch (err) {
      return reply.status(400).send({ message: (err as Error).message });
    }
    if (buf.length > MAX_IMAGEM) return reply.status(400).send({ message: 'Imagem maior que 6 MB.' });
    let p;
    try {
      p = await processarImagem(buf, dados.viewport.dpr);
    } catch (err) {
      if (err instanceof ErroImagem) return reply.status(400).send({ message: err.message });
      throw err;
    }

    let htmlPath: string | null = null;
    if (dados.html) {
      const limpo = Buffer.from(limparHtml(dados.html), 'utf8');
      htmlPath = chaveComHash('html', limpo, 'json');
      await storage.put(htmlPath, limpo);
    }
    const css = dados.cssAssetId ? await queryOne<{ id: string }>(`SELECT id FROM ds_css_assets WHERE id = $1`, [dados.cssAssetId]) : null;

    const frame = await queryOne<{ id: string }>(
      `INSERT INTO ds_frames (demo_id, name, image_path, thumb_path, width, height, pixel_ratio, display_url, source_url, html_path, css_asset_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING id`,
      [demo.id, (dados.title || '').slice(0, 120) || null, p.imagePath, p.thumbPath, p.width, p.height, p.pixelRatio,
        enderecoExibido(dados.url), dados.url.slice(0, 2000), htmlPath, css?.id ?? null]
    );
    // (o servidor compila sem strict, então o zod não estreita os campos; o schema já garante os quatro números)
    const hotspot = hotspotDoClique(dados.click as { x: number; y: number; w: number; h: number } | null, p.width, p.height);
    const step = await queryOne<{ id: string; order: number }>(
      `INSERT INTO ds_steps (demo_id, frame_id, "order", kind, hotspot)
       VALUES ($1, $2, (SELECT COALESCE(MAX("order"), 0) + 1 FROM ds_steps WHERE demo_id = $1), 'HOTSPOT', $3) RETURNING id, "order"`,
      [demo.id, frame!.id, hotspot ? JSON.stringify(hotspot) : null]
    );
    await query(`UPDATE ds_demos SET updated_at = NOW(), cover_frame_id = COALESCE(cover_frame_id, $2) WHERE id = $1`, [demo.id, frame!.id]);
    const base = (process.env.PUBLIC_BASE_URL || '').replace(/\/+$/, '');
    return reply.status(201).send({
      frameId: frame!.id,
      stepId: step!.id,
      order: step!.order,
      hotspot,
      editorUrl: `${base}/demo-studio/demos/${demo.id}`,
    });
  });

  app.get('/api/ext/limits', ext, async () => ({ maxScreens: LIMITE_TELAS, maxImageBytes: MAX_IMAGEM }));
}
