import { promises as fs } from 'node:fs';
import path from 'node:path';
import { pool, queryOne, withTransaction } from '../../db.js';
import { DS_WORKSPACE_ID } from '../../db/demoStudio.js';
import { processarImagem } from './images.js';
import { codigoDeLink, publicar } from './snapshot.js';

/**
 * Seed do template "NX Systems — Tour completo" (§15): a demo da Fase 1, já anonimizada (loja fictícia
 * "Pedal Bikes"), vinda de server/seed/demo-studio/. Cria a demo como exemplo e publicada, com um link
 * CHANNEL "Site". Roda uma vez por banco — a marca fica em ds_workspaces.settings.seedTourNx, então
 * apagar a demo depois não faz ela voltar no próximo boot.
 */
const PASTA = path.resolve(__dirname, '../../../seed/demo-studio');

interface SeedDemo {
  name: string;
  slug: string;
  isTemplate: boolean;
  segment: string;
  theme: Record<string, unknown>;
  chapters: string[];
  frames: { key: string; name: string; image: string; pixelRatio: number; displayUrl: string }[];
  steps: {
    order: number;
    kind: string;
    frame: string;
    title: string;
    body: string;
    chapter?: string;
    buttonLabel?: string;
    placement?: string;
    hotspot?: { x: number; y: number; w: number; h: number };
    cta?: Record<string, unknown>;
  }[];
}

export async function semearTourNx(): Promise<void> {
  const ws = await queryOne<{ feito: boolean }>(
    `SELECT COALESCE((settings->>'seedTourNx')::boolean, false) AS feito FROM ds_workspaces WHERE id = $1`,
    [DS_WORKSPACE_ID]
  );
  if (!ws || ws.feito) return;

  const seed = JSON.parse(await fs.readFile(path.join(PASTA, 'demo.json'), 'utf8')) as SeedDemo;
  const existe = await queryOne('SELECT 1 FROM ds_demos WHERE slug = $1', [seed.slug]);
  if (!existe) {
    // Imagens primeiro (fora da transação: só grava arquivo no storage, não mexe no banco).
    const processados = new Map<string, Awaited<ReturnType<typeof processarImagem>>>();
    for (const f of seed.frames) {
      processados.set(f.key, await processarImagem(await fs.readFile(path.join(PASTA, f.image)), f.pixelRatio));
    }
    const admin = await queryOne<{ id: string }>(`SELECT id FROM profiles WHERE role = 'admin' ORDER BY created_at LIMIT 1`);

    const demoId = await withTransaction(async (c) => {
      const { rows } = await c.query(
        `INSERT INTO ds_demos (workspace_id, name, slug, description, is_template, segment, theme, settings, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
        [
          DS_WORKSPACE_ID, seed.name, seed.slug,
          'Tour pela plataforma: atendimento no WhatsApp, agentes de IA, chatbots, kanban, campanhas e indicadores.',
          seed.isTemplate, seed.segment, JSON.stringify(seed.theme),
          JSON.stringify({ showProgress: true, showRestart: true }), admin?.id ?? null,
        ]
      );
      const id = rows[0].id as string;
      const frameIds = new Map<string, string>();
      for (const f of seed.frames) {
        const p = processados.get(f.key)!;
        const { rows: fr } = await c.query(
          `INSERT INTO ds_frames (demo_id, name, image_path, thumb_path, width, height, pixel_ratio, display_url)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
          [id, f.name, p.imagePath, p.thumbPath, p.width, p.height, p.pixelRatio, f.displayUrl]
        );
        frameIds.set(f.key, fr[0].id);
      }
      const capitulos = new Map<string, string>();
      for (const [i, nome] of seed.chapters.entries()) {
        const { rows: ch } = await c.query(`INSERT INTO ds_chapters (demo_id, name, "order") VALUES ($1, $2, $3) RETURNING id`, [id, nome, i + 1]);
        capitulos.set(nome, ch[0].id);
      }
      for (const s of seed.steps) {
        await c.query(
          `INSERT INTO ds_steps (demo_id, frame_id, chapter_id, "order", kind, hotspot, title, body, placement, button_label, cta)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
          [
            id, frameIds.get(s.frame), s.chapter ? capitulos.get(s.chapter) ?? null : null, s.order, s.kind,
            s.hotspot ? JSON.stringify(s.hotspot) : null, s.title, s.body, s.placement ?? 'auto',
            s.buttonLabel ?? null, s.cta ? JSON.stringify(s.cta) : null,
          ]
        );
      }
      await c.query(`UPDATE ds_demos SET cover_frame_id = $2 WHERE id = $1`, [id, frameIds.get(seed.frames[0].key)]);
      await c.query(
        `INSERT INTO ds_share_links (demo_id, code, kind, label, created_by) VALUES ($1, $2, 'CHANNEL', 'Site', $3)`,
        [id, codigoDeLink(), admin?.id ?? null]
      );
      return id;
    });
    await publicar(demoId, admin?.id ?? null);
    console.log(`[demo-studio] template "${seed.name}" criado e publicado em /d/${seed.slug}`);
  }
  await pool.query(
    `UPDATE ds_workspaces SET settings = settings || '{"seedTourNx": true}'::jsonb WHERE id = $1`,
    [DS_WORKSPACE_ID]
  );
}
