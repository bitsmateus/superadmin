import sharp from 'sharp';
import { query, queryOne } from '../db.js';
import { tokenDoTrafego, tokenInstagram } from './gcInstagram.js';

/**
 * Publicação agendada do Social media no Instagram e na página do Facebook do cliente.
 *
 * A API do Instagram não agenda: só publica na hora. Então TODO agendamento (Instagram e Facebook) fica
 * em gc_social_agendamentos e o job jobs/gcSocialAgendamentos.ts publica quando chega o horário — um
 * caminho só, com o mesmo status e o mesmo erro pras duas redes.
 *
 * A Meta busca a mídia por URL pública. Os anexos moram no banco (data URL), então cada agendamento
 * ganha um token aleatório e as mídias saem em /api/public/social-midia/:token/:anexo — só enquanto o
 * agendamento está ativo (ou até 2 dias depois de publicado). Imagem que não é JPG vira JPG na saída:
 * o Instagram só aceita JPEG.
 */

const VERSION = (process.env.META_GRAPH_VERSION || 'v21.0').trim();
const GRAPH = `https://graph.facebook.com/${VERSION}`;

export type RedeSocial = 'instagram' | 'facebook';
export type FormatoPost = 'feed' | 'reels' | 'story';

interface Anexo { id: string; name: string; type: string; dataUrl: string }

interface Agendamento {
  id: string; gc_cliente_id: string; gc_producao_id: string; redes: RedeSocial[]; formato: FormatoPost;
  legenda: string; midia_token: string; base_url: string;
}

interface Midia { url: string; video: boolean }

interface ResultadoRede { ok: boolean; link?: string; id?: string; erro?: string }

// ── Graph API ─────────────────────────────────────────────────────────────────

async function graph<T>(metodo: 'GET' | 'POST', caminho: string, params: Record<string, string>, token: string): Promise<T> {
  const url = new URL(`${GRAPH}${caminho}`);
  const corpo = new URLSearchParams({ ...params, access_token: token });
  let res: Response;
  if (metodo === 'GET') {
    for (const [k, v] of corpo) url.searchParams.set(k, v);
    res = await fetch(url.toString());
  } else {
    res = await fetch(url.toString(), { method: 'POST', body: corpo });
  }
  const json = (await res.json().catch(() => ({}))) as T & { error?: { message?: string; code?: number; error_user_msg?: string } };
  if (!res.ok || json.error) {
    // A mensagem vem da Meta, que não ecoa o token.
    const e = json.error;
    throw new Error(`Meta${e?.code ? ` (#${e.code})` : ''}: ${e?.error_user_msg || e?.message || `erro ${res.status}`}`);
  }
  return json;
}

const esperar = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** O Instagram processa vídeo (e às vezes imagem) antes de deixar publicar: espera o contêiner ficar pronto. */
async function esperarContainer(id: string, token: string): Promise<void> {
  for (let i = 0; i < 40; i++) {
    const r = await graph<{ status_code?: string; status?: string }>('GET', `/${id}`, { fields: 'status_code,status' }, token);
    if (r.status_code === 'FINISHED' || r.status_code === 'PUBLISHED') return;
    if (r.status_code === 'ERROR' || r.status_code === 'EXPIRED') throw new Error(`O Instagram recusou a mídia (${r.status ?? r.status_code}).`);
    await esperar(5_000);
  }
  throw new Error('O Instagram demorou demais pra processar a mídia. Tente de novo.');
}

// ── Token e contas do cliente ─────────────────────────────────────────────────

export async function contaDoCliente(clienteId: string): Promise<{ igUserId: string; username: string; token: string }> {
  const ig = await queryOne<{ ig_user_id: string; username: string; token: string | null }>(
    'SELECT ig_user_id, username, token FROM gc_instagram_contas WHERE gc_cliente_id = $1',
    [clienteId],
  );
  if (!ig) throw new Error('Este cliente não tem Instagram vinculado. Vincule na aba Conteúdo.');
  const token = tokenInstagram({ token: ig.token || (await tokenDoTrafego(clienteId)) });
  if (!token) throw new Error('Sem token da Meta pra publicar: cadastre um no Instagram ou na conta de tráfego do cliente.');
  return { igUserId: ig.ig_user_id, username: ig.username, token };
}

/** A página do Facebook ligada ao Instagram do cliente, com o token da página (é ele que publica no feed). */
async function paginaDoInstagram(igUserId: string, token: string): Promise<{ id: string; token: string }> {
  const r = await graph<{ data?: { id: string; access_token?: string; instagram_business_account?: { id: string } }[] }>(
    'GET', '/me/accounts', { fields: 'id,access_token,instagram_business_account{id}', limit: '200' }, token,
  );
  const pagina = (r.data ?? []).find((p) => p.instagram_business_account?.id === igUserId);
  if (!pagina?.access_token) throw new Error('Não achei a página do Facebook ligada a esse Instagram com o token usado.');
  return { id: pagina.id, token: pagina.access_token };
}

// ── Publicar ──────────────────────────────────────────────────────────────────

async function publicarInstagram(igUserId: string, token: string, formato: FormatoPost, legenda: string, midias: Midia[]): Promise<ResultadoRede> {
  const criar = (params: Record<string, string>) => graph<{ id: string }>('POST', `/${igUserId}/media`, params, token);
  const publicar = async (container: string) => {
    await esperarContainer(container, token);
    return (await graph<{ id: string }>('POST', `/${igUserId}/media_publish`, { creation_id: container }, token)).id;
  };
  const midiaParams = (m: Midia) => (m.video ? { video_url: m.url } : { image_url: m.url });

  let mediaIds: string[] = [];
  if (formato === 'story') {
    // Um story por mídia, na ordem dos anexos. Story não tem legenda.
    for (const m of midias) {
      const c = await criar({ media_type: 'STORIES', ...midiaParams(m) });
      mediaIds.push(await publicar(c.id));
    }
  } else if (formato === 'reels' || (midias.length === 1 && midias[0].video)) {
    const video = midias.find((m) => m.video);
    if (!video) throw new Error('Reels precisa de um vídeo anexado.');
    const c = await criar({ media_type: 'REELS', video_url: video.url, caption: legenda });
    mediaIds = [await publicar(c.id)];
  } else if (midias.length === 1) {
    const c = await criar({ image_url: midias[0].url, caption: legenda });
    mediaIds = [await publicar(c.id)];
  } else {
    const filhos: string[] = [];
    for (const m of midias.slice(0, 10)) {
      const c = await criar(m.video ? { media_type: 'VIDEO', video_url: m.url, is_carousel_item: 'true' } : { image_url: m.url, is_carousel_item: 'true' });
      if (m.video) await esperarContainer(c.id, token);
      filhos.push(c.id);
    }
    const c = await criar({ media_type: 'CAROUSEL', children: filhos.join(','), caption: legenda });
    mediaIds = [await publicar(c.id)];
  }
  const ultimo = mediaIds[mediaIds.length - 1];
  const link = await graph<{ permalink?: string }>('GET', `/${ultimo}`, { fields: 'permalink' }, token)
    .then((r) => r.permalink)
    .catch(() => undefined);
  return { ok: true, id: ultimo, link };
}

async function publicarFacebook(igUserId: string, token: string, formato: FormatoPost, legenda: string, midias: Midia[]): Promise<ResultadoRede> {
  if (formato === 'story') throw new Error('Story pela API só no Instagram.');
  const pagina = await paginaDoInstagram(igUserId, token);
  const video = midias.find((m) => m.video);
  let postId: string;
  if (formato === 'reels' || (video && midias.length === 1)) {
    if (!video) throw new Error('Reels precisa de um vídeo anexado.');
    const r = await graph<{ id: string }>('POST', `/${pagina.id}/videos`, { file_url: video.url, description: legenda }, pagina.token);
    postId = r.id;
  } else {
    const imagens = midias.filter((m) => !m.video).slice(0, 10);
    if (imagens.length === 1) {
      const r = await graph<{ id: string; post_id?: string }>('POST', `/${pagina.id}/photos`, { url: imagens[0].url, message: legenda }, pagina.token);
      postId = r.post_id ?? r.id;
    } else {
      // Várias fotos num post: sobe cada uma sem publicar e junta no feed.
      const ids: string[] = [];
      for (const m of imagens) {
        ids.push((await graph<{ id: string }>('POST', `/${pagina.id}/photos`, { url: m.url, published: 'false' }, pagina.token)).id);
      }
      const params: Record<string, string> = { message: legenda };
      ids.forEach((id, i) => { params[`attached_media[${i}]`] = JSON.stringify({ media_fbid: id }); });
      postId = (await graph<{ id: string }>('POST', `/${pagina.id}/feed`, params, pagina.token)).id;
    }
  }
  return { ok: true, id: postId, link: `https://www.facebook.com/${postId}` };
}

/** As mídias do card que vão no post: imagens e vídeos anexados, na ordem, pelas URLs públicas do agendamento. */
async function midiasDoAgendamento(ag: Agendamento): Promise<Midia[]> {
  const p = await queryOne<{ anexos: Anexo[] }>('SELECT anexos FROM gc_social_producao WHERE id = $1', [ag.gc_producao_id]);
  const base = ag.base_url.replace(/\/+$/, '');
  return (p?.anexos ?? [])
    .filter((a) => /^(image|video)\//.test(a.type))
    .map((a) => {
      const video = a.type.startsWith('video/');
      return { video, url: `${base}/api/public/social-midia/${ag.midia_token}/${a.id}.${video ? 'mp4' : 'jpg'}` };
    });
}

/** Publica UM agendamento já marcado como 'publicando' e grava o resultado. Nunca lança. */
export async function publicarAgendamento(id: string): Promise<void> {
  const ag = await queryOne<Agendamento>(
    `SELECT id, gc_cliente_id, gc_producao_id, redes, formato, legenda, midia_token, base_url
     FROM gc_social_agendamentos WHERE id = $1`,
    [id],
  );
  if (!ag) return;
  const resultado: Partial<Record<RedeSocial, ResultadoRede>> = {};
  try {
    const conta = await contaDoCliente(ag.gc_cliente_id);
    const midias = await midiasDoAgendamento(ag);
    if (midias.length === 0) throw new Error('O card não tem imagem nem vídeo anexado.');
    for (const rede of ag.redes) {
      try {
        resultado[rede] = rede === 'instagram'
          ? await publicarInstagram(conta.igUserId, conta.token, ag.formato, ag.legenda, midias)
          : await publicarFacebook(conta.igUserId, conta.token, ag.formato, ag.legenda, midias);
      } catch (err) {
        resultado[rede] = { ok: false, erro: (err instanceof Error ? err.message : String(err)).slice(0, 500) };
      }
    }
  } catch (err) {
    for (const rede of ag.redes) resultado[rede] = { ok: false, erro: (err instanceof Error ? err.message : String(err)).slice(0, 500) };
  }
  const falhas = Object.entries(resultado).filter(([, r]) => !r?.ok);
  const algumOk = Object.values(resultado).some((r) => r?.ok);
  const erro = falhas.map(([rede, r]) => `${rede === 'instagram' ? 'Instagram' : 'Facebook'}: ${r?.erro}`).join(' · ') || null;
  await query(
    `UPDATE gc_social_agendamentos
     SET status = $2, erro = $3, resultado = $4, publicado_em = CASE WHEN $5 THEN NOW() ELSE publicado_em END, updated_at = NOW()
     WHERE id = $1`,
    [id, falhas.length === 0 ? 'publicado' : 'erro', erro, JSON.stringify(resultado), algumOk],
  );
  // Publicou: o card vai pra "Pronto" sozinho.
  if (algumOk) {
    await query(`UPDATE gc_social_producao SET status = 'pronto', updated_at = NOW() WHERE id = $1`, [ag.gc_producao_id]);
  }
}

/** A mídia pública de um agendamento (o que a Meta baixa). Imagem sai sempre em JPG. */
export async function midiaPublica(token: string, arquivo: string): Promise<{ tipo: string; corpo: Buffer } | null> {
  if (!/^[a-f0-9]{48}$/.test(token)) return null;
  const anexoId = arquivo.replace(/\.(jpg|mp4)$/i, '');
  const r = await queryOne<{ anexos: Anexo[] }>(
    `SELECT p.anexos FROM gc_social_agendamentos a JOIN gc_social_producao p ON p.id = a.gc_producao_id
     WHERE a.midia_token = $1
       AND (a.status IN ('agendado','publicando') OR (a.status IN ('publicado','erro') AND a.updated_at > NOW() - INTERVAL '2 days'))`,
    [token],
  );
  const anexo = r?.anexos?.find((a) => a.id === anexoId);
  const m = anexo?.dataUrl.match(/^data:([\w.+-]+\/[\w.+-]+);base64,(.*)$/s);
  if (!anexo || !m) return null;
  const bruto = Buffer.from(m[2], 'base64');
  if (m[1].startsWith('video/')) return { tipo: m[1], corpo: bruto };
  if (m[1] === 'image/jpeg') return { tipo: 'image/jpeg', corpo: bruto };
  return { tipo: 'image/jpeg', corpo: await sharp(bruto).flatten({ background: '#ffffff' }).jpeg({ quality: 92 }).toBuffer() };
}
