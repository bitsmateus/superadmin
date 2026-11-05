/**
 * Produto pelo código de barras (EAN/GTIN): nome, marca, medida e foto.
 *
 * 1º Cosmos (Bluesoft) — base brasileira, a mais completa pra mercado daqui. Precisa de token
 *    (COSMOS_TOKEN; tem plano gratuito com limite diário).
 * 2º Open Food Facts — aberta e grátis, sem token, mas com menos produtos nacionais.
 *
 * A foto só é baixada desses dois domínios (nada de URL arbitrária vinda de fora).
 */

export interface ProdutoEan {
  ean: string;
  nome: string;
  marca: string;
  detalhe: string;
  fotoUrl: string | null;
  fonte: 'cosmos' | 'openfoodfacts';
}

const UA = 'NXDigital-Tabloide/1.0 (+https://nxdigital.com.br)';
const HOSTS_FOTO = [/\.bluesoft\.com\.br$/i, /(^|\.)openfoodfacts\.org$/i, /\.amazonaws\.com$/i];

export const eanValido = (ean: string): boolean => {
  if (!/^\d{8}$|^\d{12,14}$/.test(ean)) return false;
  const d = ean.split('').map(Number);
  const dv = d.pop() as number;
  const soma = d.reverse().reduce((s, n, i) => s + n * (i % 2 === 0 ? 3 : 1), 0);
  return (10 - (soma % 10)) % 10 === dv;
};

async function json<T>(url: string, headers: Record<string, string>): Promise<T | null> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 10_000);
  try {
    const res = await fetch(url, { headers: { 'User-Agent': UA, ...headers }, signal: ctl.signal });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

const medida = (texto: string): string => {
  const m = String(texto || '').match(/(\d+(?:[.,]\d+)?)\s?(kg|g|l|ml|un)\b/i);
  return m ? `${m[1]}${m[2]}`.toUpperCase() : '';
};

async function cosmos(ean: string): Promise<ProdutoEan | null> {
  const token = process.env.COSMOS_TOKEN;
  if (!token) return null;
  const r = await json<{ description?: string; brand?: { name?: string }; thumbnail?: string; net_weight?: number }>(
    `https://api.cosmos.bluesoft.com.br/gtins/${ean}.json`,
    { 'X-Cosmos-Token': token, 'Content-Type': 'application/json' },
  );
  if (!r?.description) return null;
  return {
    ean,
    nome: r.description,
    marca: r.brand?.name ?? '',
    detalhe: medida(r.description),
    fotoUrl: r.thumbnail || null,
    fonte: 'cosmos',
  };
}

async function openFoodFacts(ean: string): Promise<ProdutoEan | null> {
  const r = await json<{ status?: number; product?: Record<string, string> }>(
    `https://world.openfoodfacts.org/api/v2/product/${ean}.json?fields=product_name,product_name_pt,brands,quantity,image_front_url,image_url`,
    {},
  );
  const p = r?.product;
  if (!p || r?.status === 0) return null;
  const nome = p.product_name_pt || p.product_name || '';
  if (!nome && !p.image_front_url) return null;
  return {
    ean,
    nome,
    marca: (p.brands || '').split(',')[0].trim(),
    detalhe: medida(p.quantity || '') || medida(nome),
    fotoUrl: p.image_front_url || p.image_url || null,
    fonte: 'openfoodfacts',
  };
}

export async function buscarPorEan(ean: string): Promise<ProdutoEan | null> {
  return (await cosmos(ean)) ?? (await openFoodFacts(ean));
}

/** Baixa a foto do produto (só dos domínios das bases, no máximo 8 MB). */
export async function baixarFoto(url: string): Promise<Buffer | null> {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  if (u.protocol !== 'https:' || !HOSTS_FOTO.some((re) => re.test(u.hostname))) return null;
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 15_000);
  try {
    const res = await fetch(u, { headers: { 'User-Agent': UA }, signal: ctl.signal, redirect: 'follow' });
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    return buf.length > 0 && buf.length < 8 * 1024 * 1024 ? buf : null;
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}
