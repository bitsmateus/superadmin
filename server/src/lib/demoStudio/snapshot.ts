import { randomInt } from 'node:crypto';
import type { PoolClient } from 'pg';
import { pool, query, queryOne, withTransaction } from '../../db.js';

/**
 * Montagem do que o player recebe (rascunho ou versão publicada) e as operações que mexem na demo
 * inteira: publicar, despublicar, restaurar versão e duplicar.
 * O formato espelha `src/lib/demoStudio/types.ts` (PlayerDemo) — mudou aqui, muda lá.
 */

type Exec = Pick<PoolClient, 'query'>;

export interface SnapshotFrame {
  id: string;
  image: string;
  width: number;
  height: number;
  displayUrl: string | null;
}
export interface SnapshotStep {
  id: string;
  order: number;
  kind: string;
  frameId: string;
  hotspot: unknown;
  title: string;
  body: string;
  placement: string;
  buttonLabel: string | null;
  chapter: string | null;
  cta: unknown;
  form: unknown;
}
export interface Snapshot {
  id: string;
  versionId: string | null;
  versionNumber: number | null;
  name: string;
  slug: string;
  description: string | null;
  theme: Record<string, unknown>;
  settings: Record<string, unknown>;
  chapters: string[];
  frames: SnapshotFrame[];
  steps: SnapshotStep[];
}

/** Snapshot do rascunho atual. Só os frames usados por etapas entram (o player pré-carrega todos). */
export async function montarSnapshot(demoId: string, db: Exec = pool): Promise<Snapshot | null> {
  const { rows: demos } = await db.query(
    `SELECT id, name, slug, description, theme, settings FROM ds_demos WHERE id = $1`,
    [demoId]
  );
  const demo = demos[0];
  if (!demo) return null;
  const { rows: chapters } = await db.query(`SELECT id, name FROM ds_chapters WHERE demo_id = $1 ORDER BY "order"`, [demoId]);
  const { rows: steps } = await db.query(
    `SELECT s.*, c.name AS chapter_name FROM ds_steps s LEFT JOIN ds_chapters c ON c.id = s.chapter_id
     WHERE s.demo_id = $1 ORDER BY s."order"`,
    [demoId]
  );
  const usados = [...new Set(steps.map((s) => s.frame_id as string))];
  const { rows: frames } = usados.length
    ? await db.query(`SELECT id, image_path, width, height, display_url FROM ds_frames WHERE id = ANY($1)`, [usados])
    : { rows: [] as Record<string, unknown>[] };
  return {
    id: demo.id,
    versionId: null,
    versionNumber: null,
    name: demo.name,
    slug: demo.slug,
    description: demo.description,
    theme: demo.theme ?? {},
    settings: demo.settings ?? {},
    chapters: chapters.map((c) => c.name as string),
    frames: frames.map((f) => ({
      id: f.id as string,
      image: f.image_path as string,
      width: f.width as number,
      height: f.height as number,
      displayUrl: (f.display_url as string | null) ?? null,
    })),
    steps: steps.map((s, i) => ({
      id: s.id,
      order: i + 1,
      kind: s.kind,
      frameId: s.frame_id,
      hotspot: s.hotspot,
      title: s.title,
      body: s.body,
      placement: s.placement,
      buttonLabel: s.button_label,
      chapter: s.chapter_name ?? null,
      cta: s.cta,
      form: s.form,
    })),
  };
}

/** Problemas que impedem publicar (mensagens pro editor). */
export function problemasParaPublicar(s: Snapshot): string[] {
  const erros: string[] = [];
  if (!s.steps.length) erros.push('A demo não tem nenhuma etapa.');
  s.steps.forEach((st) => {
    if (st.kind === 'HOTSPOT' && !st.hotspot) erros.push(`Etapa ${st.order}: desenhe o destaque (hotspot).`);
  });
  return erros;
}

export async function publicar(demoId: string, userId: string | null): Promise<{ number: number; versionId: string }> {
  return withTransaction(async (c) => {
    // Trava a linha da demo: dois "Publicar" ao mesmo tempo não podem gerar o mesmo número.
    await c.query(`SELECT 1 FROM ds_demos WHERE id = $1 FOR UPDATE`, [demoId]);
    const snap = await montarSnapshot(demoId, c);
    if (!snap) throw new Error('Demo não encontrada');
    const { rows } = await c.query(`SELECT COALESCE(MAX(number), 0) + 1 AS n FROM ds_demo_versions WHERE demo_id = $1`, [demoId]);
    const number = Number(rows[0].n);
    const { rows: v } = await c.query(
      `INSERT INTO ds_demo_versions (demo_id, number, snapshot, published_by) VALUES ($1, $2, $3, $4) RETURNING id`,
      [demoId, number, JSON.stringify({ ...snap, versionNumber: number }), userId]
    );
    await c.query(
      `UPDATE ds_demos SET status = 'PUBLISHED', published_version_id = $2, updated_at = NOW() WHERE id = $1`,
      [demoId, v[0].id]
    );
    return { number, versionId: v[0].id as string };
  });
}

export async function despublicar(demoId: string): Promise<void> {
  await query(`UPDATE ds_demos SET status = 'DRAFT', published_version_id = NULL, updated_at = NOW() WHERE id = $1`, [demoId]);
}

/** Versão publicada de uma demo pelo slug (o que o link público mostra). */
export async function versaoPublicada(slug: string): Promise<Snapshot | null> {
  const row = await queryOne<{ id: string; snapshot: Snapshot }>(
    `SELECT v.id, v.snapshot FROM ds_demos d JOIN ds_demo_versions v ON v.id = d.published_version_id
     WHERE d.slug = $1 AND d.status = 'PUBLISHED'`,
    [slug]
  );
  return row ? { ...row.snapshot, versionId: row.id } : null;
}

/**
 * Volta o rascunho para o conteúdo da versão N (etapas, capítulos, textos e tema). Não publica: o editor
 * mostra o resultado e a pessoa publica de novo se quiser. Os frames continuam existindo (frame usado
 * em versão não pode ser apagado).
 */
export async function restaurarVersao(demoId: string, number: number): Promise<boolean> {
  return withTransaction(async (c) => {
    const { rows } = await c.query(`SELECT snapshot FROM ds_demo_versions WHERE demo_id = $1 AND number = $2`, [demoId, number]);
    if (!rows[0]) return false;
    const snap = rows[0].snapshot as Snapshot;
    await c.query(`DELETE FROM ds_steps WHERE demo_id = $1`, [demoId]);
    await c.query(`DELETE FROM ds_chapters WHERE demo_id = $1`, [demoId]);
    const capitulos = new Map<string, string>();
    for (const [i, nome] of snap.chapters.entries()) {
      const { rows: ch } = await c.query(`INSERT INTO ds_chapters (demo_id, name, "order") VALUES ($1, $2, $3) RETURNING id`, [demoId, nome, i + 1]);
      capitulos.set(nome, ch[0].id);
    }
    for (const st of snap.steps) {
      await c.query(
        `INSERT INTO ds_steps (id, demo_id, frame_id, chapter_id, "order", kind, hotspot, title, body, placement, button_label, cta, form)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
        [st.id, demoId, st.frameId, st.chapter ? capitulos.get(st.chapter) ?? null : null, st.order, st.kind,
          json(st.hotspot), st.title, st.body, st.placement, st.buttonLabel, json(st.cta), json(st.form)]
      );
    }
    await c.query(
      `UPDATE ds_demos SET name = $2, description = $3, theme = $4, settings = $5, updated_at = NOW() WHERE id = $1`,
      [demoId, snap.name, snap.description, JSON.stringify(snap.theme ?? {}), JSON.stringify(snap.settings ?? {})]
    );
    return true;
  });
}

/**
 * Duplica uma demo (também é o "Usar este exemplo"). Frames são reaproveitados por referência: as linhas
 * novas apontam para os MESMOS arquivos no storage. Etapas e capítulos são copiados. Nasce rascunho.
 */
export async function duplicarDemo(origemId: string, nome: string, userId: string): Promise<string | null> {
  return withTransaction(async (c) => {
    const { rows } = await c.query(`SELECT * FROM ds_demos WHERE id = $1`, [origemId]);
    const o = rows[0];
    if (!o) return null;
    const slug = await slugLivre(nome, c);
    const { rows: nova } = await c.query(
      `INSERT INTO ds_demos (workspace_id, name, slug, description, segment, theme, settings, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
      [o.workspace_id, nome, slug, o.description, o.segment, JSON.stringify(o.theme ?? {}), JSON.stringify(o.settings ?? {}), userId]
    );
    const novaId = nova[0].id as string;
    const frames = new Map<string, string>();
    const { rows: fs } = await c.query(`SELECT * FROM ds_frames WHERE demo_id = $1`, [origemId]);
    for (const f of fs) {
      const { rows: nf } = await c.query(
        `INSERT INTO ds_frames (demo_id, kind, name, image_path, thumb_path, width, height, pixel_ratio, display_url, source_url, html_path, css_asset_id, masks)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13) RETURNING id`,
        [novaId, f.kind, f.name, f.image_path, f.thumb_path, f.width, f.height, f.pixel_ratio, f.display_url, f.source_url, f.html_path, f.css_asset_id, JSON.stringify(f.masks ?? [])]
      );
      frames.set(f.id, nf[0].id);
    }
    const capitulos = new Map<string, string>();
    const { rows: chs } = await c.query(`SELECT * FROM ds_chapters WHERE demo_id = $1`, [origemId]);
    for (const ch of chs) {
      const { rows: nc } = await c.query(`INSERT INTO ds_chapters (demo_id, name, "order") VALUES ($1, $2, $3) RETURNING id`, [novaId, ch.name, ch.order]);
      capitulos.set(ch.id, nc[0].id);
    }
    if (o.cover_frame_id && frames.has(o.cover_frame_id)) {
      await c.query(`UPDATE ds_demos SET cover_frame_id = $2 WHERE id = $1`, [novaId, frames.get(o.cover_frame_id)]);
    }
    await c.query(
      `INSERT INTO ds_steps (demo_id, frame_id, chapter_id, "order", kind, hotspot, title, body, placement, button_label, action, form, cta)
       SELECT $1, (m.value)::uuid, (cm.value)::uuid, s."order", s.kind, s.hotspot, s.title, s.body, s.placement, s.button_label, s.action, s.form, s.cta
       FROM ds_steps s
       JOIN jsonb_each_text($3::jsonb) m ON m.key = s.frame_id::text
       LEFT JOIN jsonb_each_text($4::jsonb) cm ON cm.key = s.chapter_id::text
       WHERE s.demo_id = $2`,
      [novaId, origemId, JSON.stringify(Object.fromEntries(frames)), JSON.stringify(Object.fromEntries(capitulos))]
    );
    return novaId;
  });
}

function json(v: unknown): string | null {
  return v === null || v === undefined ? null : JSON.stringify(v);
}

/** "NX Systems — Tour completo!" → "nx-systems-tour-completo" */
export function slugify(texto: string): string {
  const s = texto
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/g, '');
  return s || 'demo';
}

/** Slug ainda não usado: base, base-2, base-3… (ignora a própria demo ao renomear). */
export async function slugLivre(texto: string, db: Exec = pool, ignorarId?: string): Promise<string> {
  const base = slugify(texto);
  for (let i = 1; i < 200; i++) {
    const candidato = i === 1 ? base : `${base}-${i}`;
    const { rows } = await db.query(`SELECT 1 FROM ds_demos WHERE slug = $1 AND ($2::uuid IS NULL OR id <> $2)`, [candidato, ignorarId ?? null]);
    if (!rows.length) return candidato;
  }
  return `${base}-${Date.now().toString(36)}`;
}

const BASE62 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
/** Código curto de link (/l/{codigo}): 7 caracteres base62. */
export function codigoDeLink(): string {
  let s = '';
  for (let i = 0; i < 7; i++) s += BASE62[randomInt(62)];
  return s;
}
