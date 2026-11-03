import { query, queryOne } from '../db.js';

/**
 * Instagram (conta profissional) dos clientes NX Digital — SOMENTE LEITURA.
 *
 * Usa a Graph API do Instagram via Facebook (graph.facebook.com/{ig-user-id}/media), com o token do
 * BM da agência (META_ADS_TOKEN) ou um token próprio do cliente. Traz os últimos posts e, de cada
 * um, as métricas de insight (alcance, salvos, compartilhamentos, visualizações). A Meta muda os
 * nomes das métricas de tempos em tempos; quando uma combinação é recusada, tenta a próxima.
 */

const VERSION = (process.env.META_GRAPH_VERSION || 'v21.0').trim();
const MAX_POSTS = 60;

async function graphGet<T>(path: string, params: Record<string, string>, token: string): Promise<T> {
  const url = new URL(`https://graph.facebook.com/${VERSION}${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  url.searchParams.set('access_token', token);
  const res = await fetch(url.toString());
  const json = (await res.json().catch(() => ({}))) as T & { error?: { message?: string; code?: number } };
  if (!res.ok || json.error) {
    throw new Error(`Meta ${res.status}${json.error?.code ? ` (#${json.error.code})` : ''}: ${json.error?.message ?? 'erro desconhecido'}`);
  }
  return json;
}

export function tokenInstagram(conta: { token: string | null }): string | null {
  return (conta.token ?? '').trim() || (process.env.META_ADS_TOKEN ?? '').trim() || null;
}

/** Páginas que o token administra e que têm Instagram profissional ligado (pra escolher na tela). */
export async function perfisDisponiveis(token: string): Promise<{ igUserId: string; username: string; pagina: string }[]> {
  const r = await graphGet<{ data?: { name?: string; instagram_business_account?: { id: string; username?: string } }[] }>(
    '/me/accounts',
    { fields: 'name,instagram_business_account{id,username}', limit: '200' },
    token,
  );
  return (r.data ?? [])
    .filter((p) => p.instagram_business_account?.id)
    .map((p) => ({ igUserId: p.instagram_business_account!.id, username: p.instagram_business_account!.username ?? '', pagina: p.name ?? '' }));
}

export async function lerPerfil(igUserId: string, token: string): Promise<{ username: string; seguidores: number | null }> {
  const r = await graphGet<{ username?: string; followers_count?: number }>(`/${igUserId}`, { fields: 'username,followers_count' }, token);
  return { username: r.username ?? '', seguidores: r.followers_count ?? null };
}

interface MidiaMeta {
  id: string; caption?: string; media_type?: string; media_product_type?: string; permalink?: string;
  thumbnail_url?: string; media_url?: string; timestamp?: string; like_count?: number; comments_count?: number;
}

// Da mais completa pra mais simples. Reels/vídeo e foto aceitam conjuntos diferentes.
const COMBINACOES_METRICAS = [
  'reach,saved,shares,total_interactions,views',
  'reach,saved,shares,total_interactions',
  'reach,saved,total_interactions',
  'reach',
];

async function insightsDaMidia(id: string, token: string): Promise<Record<string, number>> {
  for (const metric of COMBINACOES_METRICAS) {
    try {
      const r = await graphGet<{ data?: { name: string; values?: { value?: number }[]; total_value?: { value?: number } }[] }>(
        `/${id}/insights`, { metric }, token,
      );
      const out: Record<string, number> = {};
      for (const m of r.data ?? []) out[m.name] = Number(m.total_value?.value ?? m.values?.[0]?.value ?? 0);
      return out;
    } catch {
      // tenta a próxima combinação
    }
  }
  return {};
}

/** Sincroniza o perfil do cliente. Grava sucesso/erro na conta e nunca lança. */
export async function sincronizarInstagram(clienteId: string): Promise<{ ok: boolean; posts: number; erro?: string }> {
  const conta = await queryOne<{ ig_user_id: string; token: string | null }>(
    'SELECT ig_user_id, token FROM gc_instagram_contas WHERE gc_cliente_id = $1',
    [clienteId],
  );
  if (!conta) return { ok: false, posts: 0, erro: 'Instagram não vinculado' };
  const token = tokenInstagram(conta);
  if (!token) {
    const erro = 'Sem token da Meta: cadastre um ou configure META_ADS_TOKEN no servidor.';
    await query('UPDATE gc_instagram_contas SET ultimo_erro = $2 WHERE gc_cliente_id = $1', [clienteId, erro]);
    return { ok: false, posts: 0, erro };
  }
  try {
    const perfil = await lerPerfil(conta.ig_user_id, token);
    const midias = await graphGet<{ data?: MidiaMeta[] }>(`/${conta.ig_user_id}/media`, {
      fields: 'id,caption,media_type,media_product_type,permalink,thumbnail_url,media_url,timestamp,like_count,comments_count',
      limit: String(MAX_POSTS),
    }, token);
    let n = 0;
    for (const m of midias.data ?? []) {
      const ins = await insightsDaMidia(m.id, token);
      const val = (k: string) => (k in ins ? ins[k] : null);
      await query(
        `INSERT INTO gc_instagram_posts (media_id, gc_cliente_id, tipo, produto, legenda, permalink, thumbnail_url, publicado_em,
           curtidas, comentarios, alcance, salvos, compartilhamentos, visualizacoes, interacoes, synced_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,now())
         ON CONFLICT (media_id) DO UPDATE SET gc_cliente_id=EXCLUDED.gc_cliente_id, tipo=EXCLUDED.tipo, produto=EXCLUDED.produto,
           legenda=EXCLUDED.legenda, permalink=EXCLUDED.permalink, thumbnail_url=EXCLUDED.thumbnail_url,
           publicado_em=EXCLUDED.publicado_em, curtidas=EXCLUDED.curtidas, comentarios=EXCLUDED.comentarios,
           alcance=EXCLUDED.alcance, salvos=EXCLUDED.salvos, compartilhamentos=EXCLUDED.compartilhamentos,
           visualizacoes=EXCLUDED.visualizacoes, interacoes=EXCLUDED.interacoes, synced_at=now()`,
        [
          m.id, clienteId, (m.media_type ?? '').toLowerCase(), (m.media_product_type ?? '').toLowerCase(), m.caption ?? '',
          m.permalink ?? '', m.thumbnail_url ?? (m.media_type === 'VIDEO' ? '' : m.media_url ?? ''), m.timestamp ?? null,
          m.like_count ?? 0, m.comments_count ?? 0, val('reach'), val('saved'), val('shares'), val('views'), val('total_interactions'),
        ],
      );
      n++;
    }
    await query(
      `UPDATE gc_instagram_contas SET username = $2, seguidores = $3, ultimo_sync_em = now(), ultimo_erro = NULL WHERE gc_cliente_id = $1`,
      [clienteId, perfil.username, perfil.seguidores],
    );
    return { ok: true, posts: n };
  } catch (err) {
    const erro = (err instanceof Error ? err.message : String(err)).slice(0, 500);
    await query('UPDATE gc_instagram_contas SET ultimo_erro = $2 WHERE gc_cliente_id = $1', [clienteId, erro]);
    return { ok: false, posts: 0, erro };
  }
}

export async function sincronizarTodosInstagrams(): Promise<{ contas: number; erros: number }> {
  const contas = await query<{ gc_cliente_id: string }>(
    `SELECT i.gc_cliente_id FROM gc_instagram_contas i JOIN gc_clientes c ON c.id = i.gc_cliente_id WHERE c.status = 'ativo'`,
  );
  let erros = 0;
  for (const c of contas) if (!(await sincronizarInstagram(c.gc_cliente_id)).ok) erros++;
  return { contas: contas.length, erros };
}

export interface PostInstagram {
  id: string; tipo: string; produto: string; legenda: string; permalink: string; thumbnail: string; publicadoEm: string | null;
  curtidas: number; comentarios: number; alcance: number | null; salvos: number | null; compartilhamentos: number | null;
  visualizacoes: number | null; interacoes: number; engajamento: number | null;
}

/** Posts dos últimos `dias`, com engajamento = interações ÷ alcance (o que mais diz se o conteúdo "pegou"). */
export async function postsDoCliente(clienteId: string, dias = 90): Promise<PostInstagram[]> {
  const rows = await query<Record<string, string | number | null>>(
    `SELECT * FROM gc_instagram_posts WHERE gc_cliente_id = $1 AND publicado_em > now() - ($2 || ' days')::interval
     ORDER BY publicado_em DESC`,
    [clienteId, String(dias)],
  );
  const n = (v: unknown) => (v === null || v === undefined ? null : Number(v));
  return rows.map((r) => {
    const interacoes = n(r.interacoes) ?? (Number(r.curtidas) + Number(r.comentarios) + (n(r.salvos) ?? 0) + (n(r.compartilhamentos) ?? 0));
    const alcance = n(r.alcance);
    return {
      id: String(r.media_id), tipo: String(r.tipo), produto: String(r.produto), legenda: String(r.legenda),
      permalink: String(r.permalink), thumbnail: String(r.thumbnail_url),
      publicadoEm: r.publicado_em ? new Date(String(r.publicado_em)).toISOString() : null,
      curtidas: Number(r.curtidas), comentarios: Number(r.comentarios), alcance, salvos: n(r.salvos),
      compartilhamentos: n(r.compartilhamentos), visualizacoes: n(r.visualizacoes), interacoes,
      engajamento: alcance && alcance > 0 ? (interacoes / alcance) * 100 : null,
    };
  });
}

// ── Instagram a partir da conta de tráfego ────────────────────────────────────

/** O token cadastrado na conta de anúncio do cliente (aba Tráfego), se alguém cadastrou um. */
export async function tokenDoTrafego(clienteId: string): Promise<string | null> {
  const r = await queryOne<{ token: string }>(
    `SELECT token FROM gc_trafego_contas
     WHERE gc_cliente_id = $1 AND ativo AND token IS NOT NULL AND trim(token) <> ''
     ORDER BY created_at LIMIT 1`,
    [clienteId],
  );
  return r?.token.trim() || null;
}

/** Grava o Instagram do cliente (lê o perfil antes, pra falhar na hora se o token não enxerga). */
export async function vincularInstagram(
  clienteId: string,
  igUserId: string,
  tokenProprio: string | null,
  autorId: string | null,
): Promise<{ username: string }> {
  const token = tokenInstagram({ token: tokenProprio });
  if (!token) throw new Error('O servidor não tem META_ADS_TOKEN: informe um token.');
  const perfil = await lerPerfil(igUserId, token);
  await query(
    `INSERT INTO gc_instagram_contas (gc_cliente_id, ig_user_id, username, seguidores, token)
     VALUES ($1,$2,$3,$4,$5)
     ON CONFLICT (gc_cliente_id) DO UPDATE SET ig_user_id = EXCLUDED.ig_user_id, username = EXCLUDED.username,
       seguidores = EXCLUDED.seguidores, token = COALESCE(EXCLUDED.token, gc_instagram_contas.token), ultimo_erro = NULL`,
    [clienteId, igUserId, perfil.username, perfil.seguidores, tokenProprio],
  );
  await query(
    `INSERT INTO gc_historico (gc_cliente_id, tipo, titulo, descricao, autor_id)
     VALUES ($1, 'evento_sistema', 'Instagram vinculado', $2, $3)`,
    [clienteId, `@${perfil.username}`, autorId],
  );
  void sincronizarInstagram(clienteId).catch(() => undefined);
  return { username: perfil.username };
}

/**
 * Os perfis de Instagram que o token da conta de TRÁFEGO do cliente enxerga. Se o cliente ainda não
 * tem Instagram e o token enxerga exatamente um perfil, já vincula — é o caso comum de token do próprio
 * cliente. Sem token próprio no tráfego, usa o da NX e só lista (o BM da agência vê todos os clientes).
 */
export async function instagramPeloTrafego(
  clienteId: string,
  autorId: string | null,
): Promise<{ origem: 'trafego' | 'servidor'; perfis: { igUserId: string; username: string; pagina: string }[]; vinculado?: string }> {
  const doTrafego = await tokenDoTrafego(clienteId);
  const token = tokenInstagram({ token: doTrafego });
  if (!token) return { origem: 'servidor', perfis: [] };
  const perfis = await perfisDisponiveis(token);
  const origem = doTrafego ? 'trafego' : 'servidor';
  const jaTem = await queryOne('SELECT 1 FROM gc_instagram_contas WHERE gc_cliente_id = $1', [clienteId]);
  if (!jaTem && doTrafego && perfis.length === 1) {
    const r = await vincularInstagram(clienteId, perfis[0].igUserId, doTrafego, autorId);
    return { origem, perfis, vinculado: r.username };
  }
  return { origem, perfis };
}
