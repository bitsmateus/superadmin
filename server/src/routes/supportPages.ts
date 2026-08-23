import { FastifyInstance } from 'fastify';
import { query, queryOne } from '../db.js';

/**
 * Itens do menu Suporte (Tarefas, Pipeline, Clientes, Canais, Tenants, Configurações, Clientes
 * arquivados, Tickets, Templates) — arquivar, renomear e duplicar, tudo admin-only.
 *
 * Um item de ORIGEM mora na rota fixa dele (/pipeline, /tickets…) e é intocável: as etapas dele
 * são as constantes do código, que alimentam funil/Dashboard/relatórios.
 *
 * Uma CÓPIA abre em /visao/<id> e pode ser de três tipos, escolhidos ao duplicar:
 *   - 'full'      → etapas próprias + os clientes de hoje já distribuídos nelas
 *   - 'structure' → etapas próprias, sem nenhum cliente (você popula depois)
 *   - 'view'      → sem etapas próprias; é a mesma tela com um recorte de filtros (view_config)
 *
 * Em 'full'/'structure' o cliente NÃO é duplicado: support_page_clients é uma associação, então
 * o registro continua único em `clients` e editar pela cópia edita o mesmo cliente.
 */

/** O que a cópia leva junto — escolhido no modal de duplicar. */
type DuplicateMode = 'full' | 'structure' | 'view';

interface StageRow {
  key: string;
  name: string;
  color: string;
  position: number;
  is_done: boolean;
}

/**
 * Etapas semeadas numa cópia nova. São as mesmas de src/constants/stageColors.ts (PIPELINE_STAGES)
 * — repetidas aqui porque o servidor não importa código do front. Se mudarem lá e alguém criar uma
 * cópia, a cópia nasce com estas; como ela é editável depois, não trava nada.
 */
const DEFAULT_PIPELINE_STAGES: StageRow[] = [
  { key: 'lead', name: 'Lead', color: '#A0A0A0', position: 1, is_done: false },
  { key: 'welcome', name: 'Boas-vindas', color: '#4F8EF7', position: 2, is_done: false },
  { key: 'contract', name: 'Contrato', color: '#8B5CF6', position: 3, is_done: false },
  { key: 'briefing', name: 'Briefing', color: '#EC4899', position: 4, is_done: false },
  { key: 'setup_start', name: 'Iniciar Configuração', color: '#F59E0B', position: 5, is_done: false },
  { key: 'setup', name: 'Em Configuração', color: '#F97316', position: 6, is_done: false },
  { key: 'setup_done', name: 'Pronto para Entrega', color: '#10B981', position: 7, is_done: false },
  { key: 'delivery', name: 'Entrega', color: '#0E8A5B', position: 8, is_done: false },
  { key: 'delivered', name: 'Entregas Recentes', color: '#1BC47D', position: 9, is_done: true },
  { key: 'active', name: 'Ativo', color: '#047857', position: 10, is_done: true },
  { key: 'churned', name: 'Cancelado', color: '#DC2626', position: 11, is_done: true },
];

/** Vira o id do item novo — nome legível, não um UUID aleatório. */
function slugify(name: string): string {
  const noAccents = name
    .normalize('NFD')
    .split('')
    .filter((ch) => {
      const code = ch.codePointAt(0) ?? 0;
      return code < 0x0300 || code > 0x036f;
    })
    .join('');
  const base = noAccents
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return base.slice(0, 60) || 'aba';
}

/** Garante um id único — acrescenta -2, -3... se já existir um item com o mesmo slug. */
async function uniquePageId(name: string): Promise<string> {
  const base = slugify(name);
  let id = base;
  let n = 2;
  while (await queryOne('SELECT 1 FROM support_pages WHERE id = $1', [id])) {
    id = `${base}-${n}`;
    n += 1;
  }
  return id;
}

export async function supportPageRoutes(app: FastifyInstance) {
  // GET /api/support-pages — ativas (ou ?archived=1, só admin, pra listar as arquivadas)
  app.get<{ Querystring: { archived?: string } }>(
    '/api/support-pages',
    { onRequest: [app.authenticate] },
    async (req, reply) => {
      const { role } = req.user as { role: string };
      const wantsArchived = req.query.archived === '1';
      if (wantsArchived && role !== 'admin') return reply.status(403).send({ message: 'Acesso negado' });

      const cond = wantsArchived ? 'archived_at IS NOT NULL' : 'archived_at IS NULL';
      return query(`SELECT * FROM support_pages WHERE ${cond} ORDER BY position, created_at`);
    }
  );

  // POST /api/support-pages/:id/archive — admin only. Soft: só some do menu, nada é apagado.
  app.post<{ Params: { id: string } }>(
    '/api/support-pages/:id/archive',
    { onRequest: [app.authenticate] },
    async (req, reply) => {
      const { role } = req.user as { role: string };
      if (role !== 'admin') return reply.status(403).send({ message: 'Acesso negado' });
      const [page] = await query('UPDATE support_pages SET archived_at = NOW() WHERE id = $1 RETURNING *', [req.params.id]);
      if (!page) return reply.status(404).send({ message: 'Item não encontrado' });
      return page;
    }
  );

  // POST /api/support-pages/:id/restore — admin only
  app.post<{ Params: { id: string } }>(
    '/api/support-pages/:id/restore',
    { onRequest: [app.authenticate] },
    async (req, reply) => {
      const { role } = req.user as { role: string };
      if (role !== 'admin') return reply.status(403).send({ message: 'Acesso negado' });
      const [page] = await query('UPDATE support_pages SET archived_at = NULL WHERE id = $1 RETURNING *', [req.params.id]);
      if (!page) return reply.status(404).send({ message: 'Item não encontrado' });
      return page;
    }
  );

  // POST /api/support-pages/:id/duplicate — admin only. Cria uma entrada nova no menu com nome
  // próprio e a PRÓPRIA visão salva (viewConfig: filtros/modo de exibição escolhidos ao duplicar),
  // apontando pra mesma tela do original (source_key propaga — duplicar uma cópia ainda aponta
  // pro item de origem raiz, não pra cópia). A cópia abre em /visao/<id>, rota só dela.
  app.post<{
    Params: { id: string };
    Body: { name?: string; mode?: DuplicateMode; viewConfig?: Record<string, string> };
  }>(
    '/api/support-pages/:id/duplicate',
    { onRequest: [app.authenticate] },
    async (req, reply) => {
      const { role } = req.user as { role: string };
      if (role !== 'admin') return reply.status(403).send({ message: 'Acesso negado' });

      const source = await queryOne<{ name: string; source_key: string }>(
        'SELECT name, source_key FROM support_pages WHERE id = $1',
        [req.params.id]
      );
      if (!source) return reply.status(404).send({ message: 'Item não encontrado' });

      const mode: DuplicateMode = req.body.mode ?? 'view';
      // Etapas próprias só fazem sentido onde a tela é um quadro de clientes (Pipeline/Clientes).
      // Nas demais, 'full'/'structure' não teriam o que semear — cai pra 'view'.
      const stageable = source.source_key === 'pipeline' || source.source_key === 'clientes';
      const effectiveMode: DuplicateMode = stageable ? mode : 'view';

      // Só strings não-vazias entram: o resto a tela resolve com o padrão dela. Guardar "" faria
      // a cópia forçar um filtro vazio em cima de um default que talvez não seja vazio.
      const raw = req.body.viewConfig ?? {};
      const viewConfig: Record<string, string> = {};
      for (const [k, v] of Object.entries(raw)) {
        if (typeof v === 'string' && v.trim() !== '') viewConfig[k] = v.trim();
      }

      const name = req.body.name?.trim() || `${source.name} (cópia)`;
      const [row] = await query<{ max: number | null }>('SELECT MAX(position) as max FROM support_pages');
      const position = (row?.max ?? -1) + 1;
      const newId = await uniquePageId(name);
      const [page] = await query(
        'INSERT INTO support_pages (id, name, source_key, position, view_config) VALUES ($1,$2,$3,$4,$5) RETURNING *',
        [newId, name, source.source_key, position, Object.keys(viewConfig).length ? viewConfig : null]
      );

      if (effectiveMode !== 'view') {
        // Etapas: herda as da cópia de origem, se ela já tiver as suas; senão semeia as do código.
        const sourceStages = await query<StageRow>(
          'SELECT key, name, color, position, is_done FROM support_page_stages WHERE page_id = $1 ORDER BY position',
          [req.params.id]
        );
        const stages = sourceStages.length > 0 ? sourceStages : DEFAULT_PIPELINE_STAGES;
        for (const stage of stages) {
          await query(
            `INSERT INTO support_page_stages (page_id, key, name, color, position, is_done)
             VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (page_id, key) DO NOTHING`,
            [newId, stage.key, stage.name, stage.color, stage.position, stage.is_done]
          );
        }

        if (effectiveMode === 'full') {
          const validKeys = new Set(stages.map((st) => st.key));
          const fallbackKey = stages[0]?.key;
          // "Com tudo": os clientes de hoje entram já distribuídos. Vem da cópia de origem quando
          // ela tem lista própria; do Pipeline original (clients.stage), quando não tem.
          const rows =
            sourceStages.length > 0
              ? await query<{ client_id: string; stage_key: string }>(
                  'SELECT client_id, stage_key FROM support_page_clients WHERE page_id = $1 ORDER BY position',
                  [req.params.id]
                )
              : await query<{ client_id: string; stage_key: string }>(
                  'SELECT id AS client_id, stage AS stage_key FROM clients ORDER BY created_at'
                );
          let index = 0;
          for (const row of rows) {
            // Etapa que não existe na cópia (cliente arquivado num estágio antigo) cai na primeira,
            // senão ele sumiria da tela sem explicação.
            const stageKey = validKeys.has(row.stage_key) ? row.stage_key : fallbackKey;
            if (!stageKey) break;
            await query(
              `INSERT INTO support_page_clients (page_id, client_id, stage_key, position)
               VALUES ($1,$2,$3,$4) ON CONFLICT (page_id, client_id) DO NOTHING`,
              [newId, row.client_id, stageKey, index++]
            );
          }
        }
      }

      return reply.status(201).send(page);
    }
  );

  // PATCH /api/support-pages/:id/view — admin only. Ajusta a visão salva de uma cópia depois de
  // criada. Só em cópia: mexer na visão do item de origem mudaria o padrão da tela pra todo mundo.
  app.patch<{ Params: { id: string }; Body: { viewConfig?: Record<string, string> | null } }>(
    '/api/support-pages/:id/view',
    { onRequest: [app.authenticate] },
    async (req, reply) => {
      const { role } = req.user as { role: string };
      if (role !== 'admin') return reply.status(403).send({ message: 'Acesso negado' });

      const source = await queryOne<{ id: string; source_key: string }>(
        'SELECT id, source_key FROM support_pages WHERE id = $1',
        [req.params.id]
      );
      if (!source) return reply.status(404).send({ message: 'Item não encontrado' });
      if (source.id === source.source_key) {
        return reply.status(400).send({ message: 'Só dá pra salvar a visão de uma cópia.' });
      }

      const raw = req.body.viewConfig ?? {};
      const viewConfig: Record<string, string> = {};
      for (const [k, v] of Object.entries(raw)) {
        if (typeof v === 'string' && v.trim() !== '') viewConfig[k] = v.trim();
      }
      const [page] = await query(
        'UPDATE support_pages SET view_config = $2 WHERE id = $1 RETURNING *',
        [req.params.id, Object.keys(viewConfig).length ? viewConfig : null]
      );
      return page;
    }
  );

  // PATCH /api/support-pages/:id — admin only. Renomear. Só o nome muda: o id vira a URL da cópia
  // (/visao/<id>) e links já compartilhados quebrariam se ele mudasse junto.
  app.patch<{ Params: { id: string }; Body: { name?: string } }>(
    '/api/support-pages/:id',
    { onRequest: [app.authenticate] },
    async (req, reply) => {
      const { role } = req.user as { role: string };
      if (role !== 'admin') return reply.status(403).send({ message: 'Acesso negado' });

      const name = req.body.name?.trim();
      if (!name) return reply.status(400).send({ message: 'Informe um nome.' });

      const [page] = await query(
        'UPDATE support_pages SET name = $2 WHERE id = $1 RETURNING *',
        [req.params.id, name]
      );
      if (!page) return reply.status(404).send({ message: 'Item não encontrado' });
      return page;
    }
  );

  // GET /api/support-pages/:id/stages — etapas próprias de uma cópia (vazio = usa as do código).
  app.get<{ Params: { id: string } }>(
    '/api/support-pages/:id/stages',
    { onRequest: [app.authenticate] },
    async (req) =>
      query('SELECT * FROM support_page_stages WHERE page_id = $1 ORDER BY position, created_at', [
        req.params.id,
      ])
  );

  // GET /api/support-pages/:id/clients — quais clientes aparecem na cópia e em que etapa dela.
  // Devolve os campos do cliente (registro compartilhado) + o stage_key local da cópia.
  app.get<{ Params: { id: string } }>(
    '/api/support-pages/:id/clients',
    { onRequest: [app.authenticate] },
    async (req) =>
      query(
        `SELECT c.*, spc.stage_key AS page_stage_key, spc.position AS page_position
         FROM support_page_clients spc
         JOIN clients c ON c.id = spc.client_id
         WHERE spc.page_id = $1
         ORDER BY spc.position, spc.added_at`,
        [req.params.id]
      )
  );

  // PUT /api/support-pages/:id/clients/:clientId — põe o cliente na cópia (ou move de etapa nela).
  // Não toca em clients.stage: mover na cópia é local, senão bagunçaria funil e Dashboard.
  app.put<{ Params: { id: string; clientId: string }; Body: { stageKey: string; position?: number } }>(
    '/api/support-pages/:id/clients/:clientId',
    { onRequest: [app.authenticate] },
    async (req, reply) => {
      const stageKey = req.body.stageKey?.trim();
      if (!stageKey) return reply.status(400).send({ message: 'Informe a etapa.' });
      const [row] = await query(
        `INSERT INTO support_page_clients (page_id, client_id, stage_key, position)
         VALUES ($1,$2,$3,$4)
         ON CONFLICT (page_id, client_id)
         DO UPDATE SET stage_key = EXCLUDED.stage_key, position = EXCLUDED.position
         RETURNING *`,
        [req.params.id, req.params.clientId, stageKey, req.body.position ?? 0]
      );
      return row;
    }
  );

  // DELETE /api/support-pages/:id/clients/:clientId — tira da cópia. O cliente continua existindo.
  app.delete<{ Params: { id: string; clientId: string } }>(
    '/api/support-pages/:id/clients/:clientId',
    { onRequest: [app.authenticate] },
    async (req, reply) => {
      await query('DELETE FROM support_page_clients WHERE page_id = $1 AND client_id = $2', [
        req.params.id,
        req.params.clientId,
      ]);
      return reply.status(204).send();
    }
  );
}
