import sharp from 'sharp';
import { FastifyInstance, FastifyRequest } from 'fastify';
import { queryOne } from '../db.js';
import { versaoPublicada, type Snapshot } from '../lib/demoStudio/snapshot.js';
import { storage } from '../lib/demoStudio/storage.js';

/**
 * Preview do link (Open Graph, §7.1): título, descrição e imagem que aparecem quando o link da demo é colado
 * no WhatsApp, Instagram, LinkedIn… Esses robôs não rodam JavaScript, então o nginx do front desvia SÓ eles
 * (pelo user-agent) de /d, /l e /e para cá (ver nginx.conf). Pessoas continuam recebendo o app normal.
 */

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));

function base(): string {
  return (process.env.PUBLIC_BASE_URL || '').replace(/\/+$/, '');
}

/** Endereço público desta API (a imagem do preview é servida daqui). */
function urlDaApi(req: FastifyRequest): string {
  const proto = String(req.headers['x-forwarded-proto'] ?? 'https').split(',')[0].trim() || 'https';
  return `${proto}://${req.headers['x-forwarded-host'] ?? req.headers.host}`;
}

/** Tela de capa da versão publicada (a escolhida, senão a da 1ª etapa) — já com as máscaras assadas. */
function capa(snap: Snapshot, coverFrameId: string | null) {
  return snap.frames.find((f) => f.id === coverFrameId) ?? snap.frames.find((f) => f.id === snap.steps[0]?.frameId) ?? snap.frames[0] ?? null;
}

export function paginaOg(dados: { titulo: string; descricao: string; url: string; imagem: string | null; marca: string }): string {
  // Se uma pessoa cair aqui (user-agent parecido com robô), o refresh leva ao app; o ?nxv=1 faz o nginx
  // não desviar de novo.
  const destino = dados.url + (dados.url.includes('?') ? '&' : '?') + 'nxv=1';
  return `<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8">
<title>${esc(dados.titulo)}</title>
<meta name="description" content="${esc(dados.descricao)}">
<meta property="og:type" content="website">
<meta property="og:locale" content="pt_BR">
<meta property="og:site_name" content="${esc(dados.marca)}">
<meta property="og:title" content="${esc(dados.titulo)}">
<meta property="og:description" content="${esc(dados.descricao)}">
<meta property="og:url" content="${esc(dados.url)}">
${dados.imagem ? `<meta property="og:image" content="${esc(dados.imagem)}">
<meta property="og:image:type" content="image/jpeg">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta name="twitter:image" content="${esc(dados.imagem)}">` : ''}
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${esc(dados.titulo)}">
<meta name="twitter:description" content="${esc(dados.descricao)}">
<meta http-equiv="refresh" content="0;url=${esc(destino)}">
</head><body><a href="${esc(destino)}">${esc(dados.titulo)}</a></body></html>`;
}

export async function demoStudioOgRoutes(app: FastifyInstance) {
  const responder = async (req: FastifyRequest, slug: string, opcoes: { url: string; empresa?: string }) => {
    const snap = await versaoPublicada(slug);
    if (!snap) return null;
    const demo = await queryOne<{ cover_frame_id: string | null }>(`SELECT cover_frame_id FROM ds_demos WHERE id = $1`, [snap.id]);
    const marca = String(snap.theme.brandName || 'NX Digital');
    const temCapa = !!capa(snap, demo?.cover_frame_id ?? null);
    return paginaOg({
      titulo: opcoes.empresa ? `${snap.name} · preparado para ${opcoes.empresa}` : snap.name,
      descricao: snap.description || `Tour interativo pela plataforma ${marca}: veja por dentro, no seu ritmo.`,
      url: opcoes.url,
      imagem: temCapa ? `${urlDaApi(req)}/api/public/ds/og-image/${snap.versionId}.jpg` : null,
      marca,
    });
  };

  app.get<{ Params: { slug: string } }>('/api/public/ds/og/d/:slug', async (req, reply) => {
    const html = await responder(req, req.params.slug, { url: `${base()}/d/${req.params.slug}` });
    if (!html) return reply.status(404).type('text/html; charset=utf-8').send('<!doctype html><title>Demo indisponível</title>');
    return reply.header('Cache-Control', 'public, max-age=300').type('text/html; charset=utf-8').send(html);
  });

  app.get<{ Params: { slug: string } }>('/api/public/ds/og/e/:slug', async (req, reply) => {
    const html = await responder(req, req.params.slug, { url: `${base()}/d/${req.params.slug}` });
    if (!html) return reply.status(404).type('text/html; charset=utf-8').send('<!doctype html><title>Demo indisponível</title>');
    return reply.header('Cache-Control', 'public, max-age=300').type('text/html; charset=utf-8').send(html);
  });

  app.get<{ Params: { code: string } }>('/api/public/ds/og/l/:code', async (req, reply) => {
    const l = await queryOne<{ slug: string; variables: Record<string, string> }>(
      `SELECT d.slug, l.variables FROM ds_share_links l JOIN ds_demos d ON d.id = l.demo_id
       WHERE l.code = $1 AND l.active AND (l.expires_at IS NULL OR l.expires_at > NOW())`,
      [req.params.code]
    );
    const html = l ? await responder(req, l.slug, { url: `${base()}/l/${req.params.code}`, empresa: l.variables?.empresa || undefined }) : null;
    if (!html) return reply.status(404).type('text/html; charset=utf-8').send('<!doctype html><title>Link indisponível</title>');
    return reply.header('Cache-Control', 'public, max-age=300').type('text/html; charset=utf-8').send(html);
  });

  /**
   * Imagem do preview: 1200×630 JPEG (o formato que todo app aceita) a partir da capa da versão publicada.
   * Gerada uma vez por versão e guardada no storage.
   */
  app.get<{ Params: { versao: string } }>('/api/public/ds/og-image/:versao', async (req, reply) => {
    const id = req.params.versao.replace(/\.jpg$/, '');
    if (!/^[0-9a-f-]{36}$/i.test(id)) return reply.status(404).send();
    const chave = `og/${id}.jpg`;
    let jpg = await storage.ler(chave);
    if (!jpg) {
      const v = await queryOne<{ snapshot: Snapshot; cover_frame_id: string | null }>(
        `SELECT v.snapshot, d.cover_frame_id FROM ds_demo_versions v JOIN ds_demos d ON d.id = v.demo_id WHERE v.id = $1`,
        [id]
      );
      const tela = v ? capa(v.snapshot, v.cover_frame_id) : null;
      const original = tela ? await storage.ler(tela.image) : null;
      if (!original) return reply.status(404).send();
      // Recorte ancorado no canto superior esquerdo (menu e cabeçalho do sistema), na proporção 1200×630.
      jpg = await sharp(original).resize(1200, 630, { fit: 'cover', position: 'left top' }).jpeg({ quality: 82, mozjpeg: true }).toBuffer();
      await storage.put(chave, jpg);
    }
    return reply
      .header('Content-Type', 'image/jpeg')
      .header('Cache-Control', 'public, max-age=31536000, immutable')
      .send(jpg);
  });
}
