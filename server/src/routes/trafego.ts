import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { query, queryOne } from '../db.js';
import {
  dataSp, rankingTrafego, totaisTrafego, type LinhaTrafego, type NivelTrafego,
} from '../lib/trafegoMetricas.js';
import { metaAdsConfig, sincronizarCatalogoMeta, sincronizarInsightsMeta } from '../lib/metaInsights.js';
import { avaliarAlertasTrafego } from '../lib/trafficAlerts.js';
import { marcarSugestao, rodarVarreduraIa } from '../lib/trafficAiReview.js';

/**
 * Aba Tráfego (Inteligência de Tráfego, fase 3). Só leitura sobre o cruzamento gasto do Meta x
 * funil do CRM (ver lib/trafegoMetricas.ts), mais: resolver alerta, marcar nicho/papel da campanha
 * e "sincronizar agora". Mostra gasto da empresa, então só admin e supervisor entram (SDR não vê).
 */

const TZ = 'America/Sao_Paulo';
const DATA_RE = /^\d{4}-\d{2}-\d{2}$/;
const NIVEIS = ['campanha', 'conjunto', 'anuncio'] as const;
const PAPEIS = ['', 'escala', 'teste'];

async function soGestao(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  const role = (req.user as { role?: string }).role;
  if (role !== 'admin' && role !== 'supervisor') reply.status(403).send({ message: 'Acesso negado' });
}

/** Período da requisição: padrão = últimos 30 dias até hoje (inclusive), em datas de São Paulo. */
function periodo(q: { de?: string; ate?: string }): { de: string; ate: string } {
  const ate = q.ate && DATA_RE.test(q.ate) ? q.ate : dataSp(0);
  const de = q.de && DATA_RE.test(q.de) ? q.de : dataSp(29);
  return de <= ate ? { de, ate } : { de: ate, ate: de };
}

function diasEntre(de: string, ate: string): number {
  return Math.round((Date.parse(ate) - Date.parse(de)) / 86_400_000) + 1;
}

function somaDias(dia: string, n: number): string {
  return new Date(Date.parse(dia) + n * 86_400_000).toISOString().slice(0, 10);
}

interface Meta {
  campaignId: string | null; adsetId: string | null; status: string; nicho: string; papel: string;
  orcamentoDia: number | null; thumbnail: string; formato: string; titulo: string; previewUrl: string;
  campanhaNome: string | null; conjuntoNome: string | null;
}

/** Metadados de cada entidade do nível, pra enriquecer o ranking (status, papel, miniatura...). */
async function metadados(nivel: NivelTrafego): Promise<Map<string, Meta>> {
  const vazio = { thumbnail: '', formato: '', titulo: '', previewUrl: '', campanhaNome: null, conjuntoNome: null };
  const mapa = new Map<string, Meta>();
  if (nivel === 'campanha') {
    for (const r of await query<Record<string, string | null>>(
      `SELECT campaign_id, status, nicho, papel, daily_budget FROM meta_campaigns`,
    )) {
      mapa.set(String(r.campaign_id), {
        ...vazio, campaignId: String(r.campaign_id), adsetId: null, status: r.status ?? '', nicho: r.nicho ?? '',
        papel: r.papel ?? '', orcamentoDia: r.daily_budget == null ? null : Number(r.daily_budget),
      });
    }
  } else if (nivel === 'conjunto') {
    for (const r of await query<Record<string, string | null>>(
      `SELECT s.adset_id, s.campaign_id, s.status, s.daily_budget, c.nicho, c.papel, c.name AS campanha
       FROM meta_adsets s LEFT JOIN meta_campaigns c ON c.campaign_id = s.campaign_id`,
    )) {
      mapa.set(String(r.adset_id), {
        ...vazio, campaignId: r.campaign_id, adsetId: String(r.adset_id), status: r.status ?? '',
        nicho: r.nicho ?? '', papel: r.papel ?? '', orcamentoDia: r.daily_budget == null ? null : Number(r.daily_budget),
        campanhaNome: r.campanha,
      });
    }
  } else {
    for (const r of await query<Record<string, string | null>>(
      `SELECT a.ad_id, a.adset_id, a.campaign_id, a.status, a.formato, a.thumbnail_url, a.titulo, a.preview_url,
         c.nicho, c.papel, c.name AS campanha, s.name AS conjunto
       FROM meta_ads a LEFT JOIN meta_campaigns c ON c.campaign_id = a.campaign_id
       LEFT JOIN meta_adsets s ON s.adset_id = a.adset_id`,
    )) {
      mapa.set(String(r.ad_id), {
        campaignId: r.campaign_id, adsetId: r.adset_id, status: r.status ?? '', nicho: r.nicho ?? '',
        papel: r.papel ?? '', orcamentoDia: null, thumbnail: r.thumbnail_url ?? '', formato: r.formato ?? '',
        titulo: r.titulo ?? '', previewUrl: r.preview_url ?? '', campanhaNome: r.campanha, conjuntoNome: r.conjunto,
      });
    }
  }
  return mapa;
}

type LinhaRica = LinhaTrafego & Partial<Meta>;

function razao(gasto: number, n: number): number | null { return n > 0 ? gasto / n : null; }

/** Soma linhas (usada pra agrupar campanhas por nicho). */
function agrupar(linhas: LinhaRica[], chave: (l: LinhaRica) => string): LinhaTrafego[] {
  const grupos = new Map<string, LinhaTrafego>();
  for (const l of linhas) {
    const k = chave(l);
    const g = grupos.get(k) ?? {
      id: k, nome: k, gasto: 0, impressoes: 0, cliquesLink: 0, frequencia: 0, leads: 0, agendadas: 0,
      reunioes: 0, vendas: 0, cpl: null, custoAgendamento: null, custoReuniao: null, cac: null,
    };
    // frequência agregada ponderada pelas impressões
    g.frequencia = g.impressoes + l.impressoes > 0
      ? (g.frequencia * g.impressoes + l.frequencia * l.impressoes) / (g.impressoes + l.impressoes) : 0;
    g.gasto += l.gasto; g.impressoes += l.impressoes; g.cliquesLink += l.cliquesLink;
    g.leads += l.leads; g.agendadas += l.agendadas; g.reunioes += l.reunioes; g.vendas += l.vendas;
    grupos.set(k, g);
  }
  return [...grupos.values()].map((g) => ({
    ...g, cpl: razao(g.gasto, g.leads), custoAgendamento: razao(g.gasto, g.agendadas),
    custoReuniao: razao(g.gasto, g.reunioes), cac: razao(g.gasto, g.vendas),
  }));
}

/** Série diária (gasto, leads do Meta, leads no CRM) preenchendo os dias sem dado com zero. */
async function serieDiaria(de: string, ate: string, filtro?: { col: 'campaign_id' | 'adset_id' | 'ad_id'; id: string }) {
  const lcol = filtro ? { campaign_id: 'meta_campaign_id', adset_id: 'meta_adset_id', ad_id: 'meta_ad_id' }[filtro.col] : null;
  const params: unknown[] = [de, ate];
  if (filtro) params.push(filtro.id);
  const gastos = await query<{ dia: string; gasto: string; meta_leads: string; imp: string }>(
    `SELECT to_char(dia,'YYYY-MM-DD') AS dia, SUM(spend) AS gasto, SUM(meta_leads) AS meta_leads, SUM(impressions) AS imp
     FROM meta_ad_insights_daily WHERE dia BETWEEN $1::date AND $2::date
     ${filtro ? `AND ${filtro.col} = $3` : ''} GROUP BY dia`, params,
  );
  const leads = await query<{ dia: string; n: string; reunioes: string }>(
    `SELECT to_char((lr.created_at AT TIME ZONE '${TZ}')::date,'YYYY-MM-DD') AS dia, count(*) AS n,
       count(*) FILTER (WHERE lr.status IN ('Reunião agendada','Reunião não comparecida','Proposta Enviada','Follow-up Propostas','Vendido')) AS reunioes
     FROM lead_rows lr JOIN lead_boards lb ON lb.id = lr.board_id
     WHERE lb.is_vendas = false AND lr.espelho_origem_id IS NULL AND lr.deleted_at IS NULL
       AND ${lcol ? `lr.${lcol} = $3` : 'lr.meta_lead_id IS NOT NULL'}
       AND (lr.created_at AT TIME ZONE '${TZ}')::date BETWEEN $1::date AND $2::date
     GROUP BY 1`, params,
  );
  const g = new Map(gastos.map((r) => [r.dia, r]));
  const l = new Map(leads.map((r) => [r.dia, r]));
  const saida: { dia: string; gasto: number; leadsMeta: number; leadsCrm: number; reunioes: number }[] = [];
  for (let d = de, n = 0; d <= ate && n < 400; d = somaDias(d, 1), n++) {
    saida.push({
      dia: d, gasto: Number(g.get(d)?.gasto ?? 0), leadsMeta: Number(g.get(d)?.meta_leads ?? 0),
      leadsCrm: Number(l.get(d)?.n ?? 0), reunioes: Number(l.get(d)?.reunioes ?? 0),
    });
  }
  return saida;
}

export async function trafegoRoutes(app: FastifyInstance) {
  const opts = { onRequest: [app.authenticate, soGestao] };

  app.get<{ Querystring: { de?: string; ate?: string } }>('/api/trafego/resumo', opts, async (req) => {
    const { de, ate } = periodo(req.query);
    const dias = diasEntre(de, ate);
    const antes = { de: somaDias(de, -dias), ate: somaDias(de, -1) };
    const [atual, anterior, serie, ultima] = await Promise.all([
      totaisTrafego(de, ate), totaisTrafego(antes.de, antes.ate), serieDiaria(de, ate),
      queryOne<{ synced_at: string | null }>(`SELECT MAX(synced_at) AS synced_at FROM meta_ad_insights_daily`),
    ]);
    return {
      de, ate, atual, anterior, serie, ultimaSincronizacao: ultima?.synced_at ?? null,
      configurado: metaAdsConfig() !== null,
    };
  });

  app.get<{ Querystring: { nivel?: string; de?: string; ate?: string; papel?: string } }>(
    '/api/trafego/ranking', opts, async (req, reply) => {
      const { de, ate } = periodo(req.query);
      const nivelPedido = req.query.nivel ?? 'campanha';
      const ehNicho = nivelPedido === 'nicho';
      const nivel = (ehNicho ? 'campanha' : nivelPedido) as NivelTrafego;
      if (!ehNicho && !NIVEIS.includes(nivel)) return reply.status(400).send({ message: 'nivel inválido' });

      const [linhas, meta] = await Promise.all([rankingTrafego(nivel, de, ate), metadados(nivel)]);
      let ricas: LinhaRica[] = linhas.map((l) => ({ ...l, ...(meta.get(l.id) ?? {}) }));
      const papel = req.query.papel;
      if (papel === 'escala' || papel === 'teste') ricas = ricas.filter((l) => l.papel === papel);

      const resultado = ehNicho ? agrupar(ricas, (l) => (l.nicho && l.nicho.trim() ? l.nicho.trim() : '(sem nicho)')) : ricas;
      // Melhor custo por reunião primeiro; sem reunião vai pro fim, do que mais gastou pro que menos.
      resultado.sort((a, b) => {
        if (a.custoReuniao == null && b.custoReuniao == null) return b.gasto - a.gasto;
        if (a.custoReuniao == null) return 1;
        if (b.custoReuniao == null) return -1;
        return a.custoReuniao - b.custoReuniao;
      });
      return { de, ate, nivel: nivelPedido, linhas: resultado };
    },
  );

  app.get<{ Querystring: { entidade?: string; id?: string; de?: string; ate?: string } }>(
    '/api/trafego/serie', opts, async (req, reply) => {
      const { de, ate } = periodo(req.query);
      const col = ({ campanha: 'campaign_id', conjunto: 'adset_id', anuncio: 'ad_id' } as const)[req.query.entidade as 'campanha'];
      if (!col || !req.query.id) return reply.status(400).send({ message: 'entidade e id são obrigatórios' });
      return { de, ate, serie: await serieDiaria(de, ate, { col, id: req.query.id }) };
    },
  );

  app.get<{ Querystring: { ad_id?: string; campaign_id?: string; adset_id?: string } }>(
    '/api/trafego/leads', opts, async (req, reply) => {
      const col = req.query.ad_id ? 'meta_ad_id' : req.query.adset_id ? 'meta_adset_id' : req.query.campaign_id ? 'meta_campaign_id' : null;
      const valor = req.query.ad_id ?? req.query.adset_id ?? req.query.campaign_id;
      if (!col || !valor) return reply.status(400).send({ message: 'ad_id, adset_id ou campaign_id é obrigatório' });
      const leads = await query(
        `SELECT lr.id, lr.nome, lr.empresa, lr.status, lr.created_at, lb.name AS quadro, lb.page AS pagina
         FROM lead_rows lr JOIN lead_boards lb ON lb.id = lr.board_id
         WHERE lr.${col} = $1 AND lr.deleted_at IS NULL AND lb.is_vendas = false AND lr.espelho_origem_id IS NULL
         ORDER BY lr.created_at DESC LIMIT 200`,
        [valor],
      );
      return { leads };
    },
  );

  app.get('/api/trafego/alertas', opts, async () => {
    const abertos = await query(
      `SELECT id, rule, level, entity_type, entity_id, message, created_at FROM traffic_alerts
       WHERE resolved_at IS NULL ORDER BY CASE level WHEN 'critico' THEN 0 WHEN 'atencao' THEN 1 ELSE 2 END, created_at DESC`,
    );
    const resolvidos = await query(
      `SELECT id, rule, level, entity_type, entity_id, message, created_at, resolved_at FROM traffic_alerts
       WHERE resolved_at IS NOT NULL ORDER BY resolved_at DESC LIMIT 20`,
    );
    return { abertos, resolvidos };
  });

  app.post<{ Params: { id: string } }>('/api/trafego/alertas/:id/resolver', opts, async (req, reply) => {
    const r = await queryOne(`UPDATE traffic_alerts SET resolved_at = now() WHERE id = $1 AND resolved_at IS NULL RETURNING id`, [req.params.id]);
    if (!r) return reply.status(404).send({ message: 'Alerta não encontrado ou já resolvido' });
    return { ok: true };
  });

  app.get('/api/trafego/ia', opts, async () => ({
    revisoes: await query(`SELECT to_char(dia,'YYYY-MM-DD') AS dia, texto, sugestoes, created_at FROM traffic_ai_reviews ORDER BY dia DESC LIMIT 30`),
  }));

  /** Roda a varredura da IA agora (a de hoje é substituída). */
  app.post('/api/trafego/ia/rodar', opts, async (_req, reply) => {
    if (!process.env.ANTHROPIC_API_KEY) return reply.status(400).send({ message: 'ANTHROPIC_API_KEY não configurada no servidor' });
    try {
      return await rodarVarreduraIa();
    } catch (err) {
      return reply.status(502).send({ message: err instanceof Error ? err.message : 'Falha na varredura da IA' });
    }
  });

  /** Aceitar ou ignorar uma sugestão da IA (vira histórico). */
  app.post<{ Params: { dia: string; id: string }; Body: { status?: string } }>(
    '/api/trafego/ia/:dia/sugestoes/:id', opts, async (req, reply) => {
      const status = req.body?.status;
      if (status !== 'aceita' && status !== 'ignorada' && status !== 'pendente') return reply.status(400).send({ message: 'status inválido' });
      if (!DATA_RE.test(req.params.dia)) return reply.status(400).send({ message: 'dia inválido' });
      const ok = await marcarSugestao(req.params.dia, req.params.id, status);
      if (!ok) return reply.status(404).send({ message: 'Sugestão não encontrada' });
      return { ok: true };
    },
  );

  /** Marca nicho e/ou papel (escala/teste) da campanha — o sync do catálogo não sobrescreve. */
  app.put<{ Params: { id: string }; Body: { nicho?: string; papel?: string } }>(
    '/api/trafego/campanhas/:id', opts, async (req, reply) => {
      const { nicho, papel } = req.body ?? {};
      if (papel !== undefined && !PAPEIS.includes(papel)) return reply.status(400).send({ message: 'papel inválido' });
      if (nicho === undefined && papel === undefined) return reply.status(400).send({ message: 'Nada para atualizar' });
      const r = await queryOne(
        `UPDATE meta_campaigns SET nicho = COALESCE($2, nicho), papel = COALESCE($3, papel) WHERE campaign_id = $1 RETURNING campaign_id`,
        [req.params.id, nicho === undefined ? null : nicho.trim().slice(0, 80), papel ?? null],
      );
      if (!r) return reply.status(404).send({ message: 'Campanha não encontrada' });
      return { ok: true };
    },
  );

  app.post('/api/trafego/sync', opts, async (_req, reply) => {
    if (!metaAdsConfig()) return reply.status(400).send({ message: 'META_ADS_TOKEN / META_AD_ACCOUNT_ID não configurados no servidor' });
    const catalogo = await sincronizarCatalogoMeta();
    const insights = await sincronizarInsightsMeta(7);
    const alertas = await avaliarAlertasTrafego();
    return { catalogo, insights, alertas };
  });
}
