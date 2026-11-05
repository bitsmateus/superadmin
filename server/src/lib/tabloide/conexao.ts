import { contaDoCliente } from '../gcSocialPublicar.js';

/**
 * "Testar conexão" do Publicar do tabloide: confere, antes de postar, cada peça que a publicação usa
 * — Instagram vinculado, token aceito pela Meta, permissão de publicar, página do Facebook e o
 * endereço público de onde a Meta baixa a arte. Nada é publicado.
 */

const GRAPH = `https://graph.facebook.com/${(process.env.META_GRAPH_VERSION || 'v21.0').trim()}`;

export interface ItemTeste {
  nome: string;
  status: 'ok' | 'aviso' | 'erro';
  detalhe: string;
}

async function graphGet<T>(caminho: string, params: Record<string, string>, token: string): Promise<T> {
  const url = new URL(`${GRAPH}${caminho}`);
  for (const [k, v] of Object.entries({ ...params, access_token: token })) url.searchParams.set(k, v);
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 12_000);
  try {
    const res = await fetch(url, { signal: ctl.signal });
    const json = (await res.json().catch(() => ({}))) as T & { error?: { message?: string; code?: number } };
    if (!res.ok || json.error) throw new Error(`Meta${json.error?.code ? ` (#${json.error.code})` : ''}: ${json.error?.message ?? `erro ${res.status}`}`);
    return json;
  } finally {
    clearTimeout(t);
  }
}

const PERMISSOES: { nome: string; para: string; obrigatoria: boolean }[] = [
  { nome: 'instagram_content_publish', para: 'publicar no Instagram', obrigatoria: true },
  { nome: 'instagram_basic', para: 'ler o perfil do Instagram', obrigatoria: true },
  { nome: 'pages_show_list', para: 'achar a página ligada ao Instagram', obrigatoria: true },
  { nome: 'pages_read_engagement', para: 'ler a página do Facebook', obrigatoria: false },
  { nome: 'pages_manage_posts', para: 'publicar na página do Facebook', obrigatoria: false },
];

export async function testarConexao(cliente: { id: string; nome: string } | null, baseUrl: string): Promise<{ itens: ItemTeste[]; podePublicar: boolean }> {
  const itens: ItemTeste[] = [];
  const add = (nome: string, status: ItemTeste['status'], detalhe: string) => itens.push({ nome, status, detalhe });

  if (!cliente) {
    add('Cliente no painel NX', 'erro', 'Não achei o cliente do Mercado Nunes no painel (ou há mais de um com "Nunes" no nome).');
    return { itens, podePublicar: false };
  }
  add('Cliente no painel NX', 'ok', cliente.nome);

  let conta: { igUserId: string; username: string; token: string };
  try {
    conta = await contaDoCliente(cliente.id);
  } catch (err) {
    add('Instagram vinculado', 'erro', (err as Error).message);
    return { itens, podePublicar: false };
  }

  try {
    const p = await graphGet<{ username?: string; followers_count?: number }>(`/${conta.igUserId}`, { fields: 'username,followers_count' }, conta.token);
    add('Instagram vinculado', 'ok', `@${p.username ?? conta.username}${p.followers_count != null ? ` · ${p.followers_count.toLocaleString('pt-BR')} seguidores` : ''}`);
  } catch (err) {
    add('Instagram vinculado', 'erro', `A Meta não aceitou o token: ${(err as Error).message}`);
    return { itens, podePublicar: false };
  }

  let publicarOk = true;
  try {
    const r = await graphGet<{ data?: { permission: string; status: string }[] }>('/me/permissions', {}, conta.token);
    const concedidas = new Set((r.data ?? []).filter((x) => x.status === 'granted').map((x) => x.permission));
    for (const p of PERMISSOES) {
      if (concedidas.has(p.nome)) add(`Permissão ${p.nome}`, 'ok', p.para);
      else {
        add(`Permissão ${p.nome}`, p.obrigatoria ? 'erro' : 'aviso', `Falta: sem ela não dá pra ${p.para}.`);
        if (p.obrigatoria) publicarOk = false;
      }
    }
  } catch {
    add('Permissões do token', 'aviso', 'Não deu pra listar as permissões desse tipo de token. O teste abaixo confere a publicação.');
  }

  try {
    const q = await graphGet<{ data?: { quota_usage?: number; config?: { quota_total?: number } }[] }>(
      `/${conta.igUserId}/content_publishing_limit`,
      { fields: 'quota_usage,config' },
      conta.token,
    );
    const uso = q.data?.[0];
    add('Limite de posts (24h)', 'ok', `${uso?.quota_usage ?? 0} de ${uso?.config?.quota_total ?? 100} usados`);
  } catch (err) {
    add('Limite de posts (24h)', 'erro', `Sem acesso à publicação: ${(err as Error).message}`);
    publicarOk = false;
  }

  try {
    const r = await graphGet<{ data?: { id: string; name?: string; instagram_business_account?: { id: string } }[] }>(
      '/me/accounts',
      { fields: 'id,name,instagram_business_account{id}', limit: '200' },
      conta.token,
    );
    const pagina = (r.data ?? []).find((p) => p.instagram_business_account?.id === conta.igUserId);
    if (pagina) add('Página do Facebook', 'ok', `${pagina.name ?? pagina.id} (dá pra marcar "publicar também no Facebook")`);
    else add('Página do Facebook', 'aviso', 'Não achei a página ligada a esse Instagram: publique só no Instagram.');
  } catch {
    add('Página do Facebook', 'aviso', 'Não deu pra ler as páginas: publique só no Instagram.');
  }

  const base = String(process.env.SOCIAL_MIDIA_BASE_URL || baseUrl || '').trim().replace(/\/+$/, '');
  if (!/^https:\/\//.test(base)) {
    add('Endereço das artes', 'erro', 'A Meta só baixa arte de endereço https público. Configure SOCIAL_MIDIA_BASE_URL no servidor.');
    publicarOk = false;
  } else {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 8_000);
    try {
      const res = await fetch(`${base}/api/public/mercadonunes/tabloide/layouts`, { signal: ctl.signal });
      if (res.ok) add('Endereço das artes', 'ok', `${base} responde de fora`);
      else {
        add('Endereço das artes', 'erro', `${base} respondeu ${res.status}. Confira SOCIAL_MIDIA_BASE_URL.`);
        publicarOk = false;
      }
    } catch {
      add('Endereço das artes', 'erro', `${base} não respondeu. Confira SOCIAL_MIDIA_BASE_URL.`);
      publicarOk = false;
    } finally {
      clearTimeout(t);
    }
  }

  return { itens, podePublicar: publicarOk };
}
