import sharp from 'sharp';
import { query, queryOne } from '../db.js';
import { chamarClaude, chamarClaudeComImagens, contextoDoCliente, extrairJson, type BlocoIa } from './gcIa.js';
import { desempenhoDasArtes } from './gcSocialDesempenho.js';
import { imagensFinais, registrarEventoArte, type AnexoCard } from './gcSocialFluxo.js';
import { driveConfigurado, enviarProDrive } from './gcDrive.js';

/**
 * IA no fluxo das artes de social media (Claude):
 *  1. pedido      — transforma a ideia curta da social media num pedido completo pra designer;
 *  2. revisão     — olha a arte final antes de ir pro cliente (português, preço/data, logo, formato);
 *  3. copy        — 3 opções de texto de anúncio pro gestor de tráfego, no tom do cliente;
 *  4. ajuste      — transforma o comentário do cliente num checklist claro pra designer;
 *  5. legenda     — legenda do post orgânico (usada no "Postar todas");
 *  6. aprendizados — cruza o desempenho das artes nos anúncios e diz o que repetir.
 * O contexto do cliente é o mesmo do assistente (contextoDoCliente: sem senhas).
 */

const iaLigada = () => !!process.env.ANTHROPIC_API_KEY;
export function exigirIa(): void {
  if (!iaLigada()) throw Object.assign(new Error('ANTHROPIC_API_KEY não configurada no servidor.'), { statusCode: 400 });
}

const json = (v: unknown) => JSON.stringify(v);

interface Card {
  id: string; gc_cliente_id: string; titulo: string; descricao: string; mes: string; status: string; anexos: AnexoCard[];
  copy_anuncio: unknown; drive_link: string;
}

async function card(id: string): Promise<Card> {
  const c = await queryOne<Card>(
    'SELECT id, gc_cliente_id, titulo, descricao, mes, status, anexos, copy_anuncio, drive_link FROM gc_social_producao WHERE id = $1',
    [id],
  );
  if (!c) throw Object.assign(new Error('Demanda não encontrada'), { statusCode: 404 });
  return c;
}

/** Artes anteriores do cliente (títulos e pedidos) + o que funcionou nos anúncios: o "retorno" pra IA. */
async function historicoDeArtes(clienteId: string) {
  const [anteriores, desempenho] = await Promise.all([
    query<{ titulo: string; descricao: string; status: string; mes: string }>(
      `SELECT titulo, left(descricao, 400) AS descricao, status, mes FROM gc_social_producao
       WHERE gc_cliente_id = $1 AND status IN ('aprovado','trafego') ORDER BY created_at DESC LIMIT 15`,
      [clienteId],
    ),
    desempenhoDasArtes(clienteId, 30),
  ]);
  const comNumeros = desempenho.filter((d) => d.impressoes > 0);
  const melhores = [...comNumeros].sort((a, b) => (a.custoResultado ?? 1e9) - (b.custoResultado ?? 1e9)).slice(0, 5);
  return { artes_aprovadas_recentes: anteriores, desempenho_das_artes_nos_anuncios: comNumeros, melhores_artes: melhores };
}

/** Imagem da arte em JPEG de até 1568px (o tamanho que a IA aproveita), em base64. */
async function paraIa(dataUrl: string): Promise<BlocoIa | null> {
  const virgula = dataUrl.indexOf(',');
  if (!dataUrl.startsWith('data:image/') || virgula < 0) return null;
  try {
    const buf = Buffer.from(dataUrl.slice(virgula + 1), 'base64');
    const jpg = await sharp(buf).rotate().resize(1568, 1568, { fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 85 }).toBuffer();
    return { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: jpg.toString('base64') } };
  } catch {
    return null;
  }
}

async function tamanho(dataUrl: string): Promise<string> {
  try {
    const m = await sharp(Buffer.from(dataUrl.slice(dataUrl.indexOf(',') + 1), 'base64')).metadata();
    return m.width && m.height ? `${m.width}x${m.height}` : 'desconhecido';
  } catch {
    return 'desconhecido';
  }
}

// ---------------------------------------------------------------- 1. pedido pra designer

export async function gerarPedido(clienteId: string, ideia: string): Promise<{ titulo: string; descricao: string }> {
  exigirIa();
  const [ctx, hist] = await Promise.all([contextoDoCliente(clienteId), historicoDeArtes(clienteId)]);
  const sistema = `Você é a social media sênior da agência NX Digital. Transforma uma ideia curta num pedido de arte completo pra designer,
em português do Brasil, prático e sem enrolação. Use o briefing, o segmento e o que funcionou nos anúncios do cliente.
Responda SÓ com JSON: {"titulo": "Arte: ...", "descricao": "texto do pedido"}.
A descricao segue este modelo (linhas curtas, sem markdown pesado):
Formato: (feed 1080x1350, story 1080x1920, carrossel N cards, reels...)
Objetivo: ...
Texto da arte:
(o texto exato que vai na arte, curto e escaneável)
Visual / referências: ...
Elementos obrigatórios: logo, contato, preço/condições se houver...
O que funcionou antes: (1 linha baseada nas melhores artes, se houver dados)
Legenda:
(sugestão de legenda com CTA e até 5 hashtags)`;
  const texto = await chamarClaude(sistema, [{
    role: 'user',
    content: `Cliente:\n${json(ctx)}\n\nHistórico de artes e desempenho:\n${json(hist)}\n\nIdeia da social media: ${ideia}`,
  }], 2500);
  const r = extrairJson<{ titulo?: string; descricao?: string }>(texto);
  return { titulo: String(r.titulo ?? ideia).slice(0, 200), descricao: String(r.descricao ?? '').slice(0, 8000) };
}

// ---------------------------------------------------------------- 2. revisão antes do cliente

export interface RevisaoIa {
  ok: boolean; resumo: string; problemas: { gravidade: 'alta' | 'media' | 'baixa'; texto: string }[]; feito_em: string;
}

export async function revisarArte(producaoId: string): Promise<RevisaoIa> {
  exigirIa();
  const c = await card(producaoId);
  const finais = imagensFinais(c.anexos).slice(0, 6);
  if (finais.length === 0) throw Object.assign(new Error('Anexe a arte final antes de pedir a revisão'), { statusCode: 400 });
  const ctx = await contextoDoCliente(c.gc_cliente_id);
  const blocos: BlocoIa[] = [];
  for (const [i, a] of finais.entries()) {
    const img = await paraIa(a.dataUrl);
    if (!img) continue;
    blocos.push({ type: 'text', text: `Imagem ${i + 1} (${a.name}, ${await tamanho(a.dataUrl)} px):` }, img);
  }
  blocos.push({
    type: 'text',
    text: `Pedido da arte:\nTítulo: ${c.titulo}\n${c.descricao}\n\nDados do cliente (pra conferir nome, contato, site, segmento):\n${json({
      cliente: (ctx as { cliente?: unknown }).cliente, briefing: (ctx as { briefing?: unknown }).briefing,
    })}`,
  });
  const sistema = `Você revisa artes de social media ANTES de irem pro cliente aprovar. Olhe as imagens com atenção e confira:
1) erros de português, digitação e acentuação no texto da arte;
2) se preço, datas, condições, telefone, endereço e @ batem com o pedido;
3) se a logo/nome do cliente aparece;
4) se o tamanho serve pro formato pedido (feed 1080x1350 ou 1080x1080, story/reels 1080x1920);
5) legibilidade (texto pequeno demais, contraste ruim, texto cortado).
Só aponte problema real, citando o trecho exato. Não invente. Responda SÓ com JSON:
{"ok": true|false, "resumo": "1 frase", "problemas": [{"gravidade": "alta|media|baixa", "texto": "..."}]}
"ok" é false se houver qualquer problema de gravidade alta (erro de português, dado errado, logo faltando).`;
  const r = extrairJson<Partial<RevisaoIa>>(await chamarClaudeComImagens(sistema, blocos, 2000));
  const revisao: RevisaoIa = {
    ok: r.ok === true,
    resumo: String(r.resumo ?? '').slice(0, 400),
    problemas: (Array.isArray(r.problemas) ? r.problemas : []).slice(0, 15).map((p) => ({
      gravidade: (['alta', 'media', 'baixa'].includes(String(p?.gravidade)) ? p.gravidade : 'media') as RevisaoIa['problemas'][number]['gravidade'],
      texto: String(p?.texto ?? '').slice(0, 500),
    })).filter((p) => p.texto),
    feito_em: new Date().toISOString(),
  };
  await query('UPDATE gc_social_producao SET revisao_ia = $2 WHERE id = $1', [producaoId, json(revisao)]);
  return revisao;
}

// ---------------------------------------------------------------- 3. copy do anúncio

export interface CopyAnuncio { opcoes: { texto: string; titulo: string; descricao: string }[]; feito_em: string }

export async function gerarCopy(producaoId: string): Promise<CopyAnuncio> {
  exigirIa();
  const c = await card(producaoId);
  const [ctx, hist] = await Promise.all([contextoDoCliente(c.gc_cliente_id), historicoDeArtes(c.gc_cliente_id)]);
  const img = imagensFinais(c.anexos)[0];
  const blocos: BlocoIa[] = [];
  const bloco = img ? await paraIa(img.dataUrl) : null;
  if (bloco) blocos.push({ type: 'text', text: 'A arte aprovada:' }, bloco);
  blocos.push({
    type: 'text',
    text: `Pedido da arte: ${c.titulo}\n${c.descricao}\n\nCliente:\n${json(ctx)}\n\nO que funcionou antes:\n${json(hist.melhores_artes)}`,
  });
  const sistema = `Você é gestor de tráfego da NX Digital e escreve anúncios da Meta (Facebook/Instagram) em português do Brasil,
no tom do cliente, com foco em gerar contato/venda. Para a arte aprovada, escreva 3 opções diferentes (ângulos: dor, benefício, oferta/urgência).
Texto principal até 300 caracteres, com CTA. Título até 40 caracteres. Descrição até 30 caracteres. Sem promessas que a arte não faz.
Responda SÓ com JSON: {"opcoes": [{"texto": "...", "titulo": "...", "descricao": "..."}]}`;
  const r = extrairJson<{ opcoes?: { texto?: string; titulo?: string; descricao?: string }[] }>(await chamarClaudeComImagens(sistema, blocos, 2000));
  const copy: CopyAnuncio = {
    opcoes: (r.opcoes ?? []).slice(0, 3).map((o) => ({
      texto: String(o?.texto ?? '').slice(0, 1000), titulo: String(o?.titulo ?? '').slice(0, 120), descricao: String(o?.descricao ?? '').slice(0, 120),
    })).filter((o) => o.texto),
    feito_em: new Date().toISOString(),
  };
  await query('UPDATE gc_social_producao SET copy_anuncio = $2 WHERE id = $1', [producaoId, json(copy)]);
  return copy;
}

// ---------------------------------------------------------------- 4. ajuste do cliente → checklist

export async function checklistDoAjuste(producaoId: string, comentario: string): Promise<string> {
  exigirIa();
  const c = await card(producaoId);
  const img = imagensFinais(c.anexos)[0];
  const blocos: BlocoIa[] = [];
  const bloco = img ? await paraIa(img.dataUrl) : null;
  if (bloco) blocos.push({ type: 'text', text: 'A arte que o cliente viu:' }, bloco);
  blocos.push({ type: 'text', text: `Pedido original: ${c.titulo}\n${c.descricao}\n\nComentário do cliente: "${comentario}"` });
  const sistema = `O cliente da agência comentou numa arte pedindo ajuste. Transforme o comentário (às vezes confuso) num checklist claro pra designer:
uma linha por mudança, começando com "- [ ] ", verbo no imperativo, citando o elemento exato da arte. Se algo estiver ambíguo, termine com
uma linha "Confirmar com o cliente: ...". Sem introdução, só o checklist.`;
  const texto = (await chamarClaudeComImagens(sistema, blocos, 800)).trim().slice(0, 3000);
  await registrarEventoArte(producaoId, 'checklist_ia', texto, { nome: 'IA' });
  return texto;
}

// ---------------------------------------------------------------- 5. legenda do post

export async function gerarLegenda(producaoId: string, instrucao = ''): Promise<string> {
  exigirIa();
  const c = await card(producaoId);
  const ctx = await contextoDoCliente(c.gc_cliente_id);
  const blocos: BlocoIa[] = [];
  for (const a of imagensFinais(c.anexos).slice(0, 3)) {
    const b = await paraIa(a.dataUrl);
    if (b) blocos.push(b);
  }
  blocos.push({ type: 'text', text: `Arte: ${c.titulo}\n${c.descricao}\n\nCliente:\n${json({
    cliente: (ctx as { cliente?: unknown }).cliente, briefing: (ctx as { briefing?: unknown }).briefing,
    posts_recentes: (ctx as { instagram_ultimos_90_dias?: unknown }).instagram_ultimos_90_dias,
  })}${instrucao ? `\n\nPedido extra: ${instrucao}` : ''}` });
  const sistema = `Você escreve legendas de Instagram em português do Brasil pro perfil do cliente da agência NX Digital.
Legenda envolvente, no tom do cliente: gancho na primeira linha, 2 a 4 linhas de corpo, CTA claro e até 6 hashtags relevantes no fim.
Use emojis com moderação. Responda SÓ com a legenda, sem aspas e sem explicação.`;
  return (await chamarClaudeComImagens(sistema, blocos, 900)).trim().slice(0, 2200);
}

// ---------------------------------------------------------------- 6. o que funcionou

export async function aprendizados(clienteId: string): Promise<string> {
  exigirIa();
  const desempenho = (await desempenhoDasArtes(clienteId, 40)).filter((d) => d.impressoes > 0);
  if (desempenho.length === 0) {
    throw Object.assign(new Error('Ainda não tem arte ligada a anúncio com números. Ligue as artes aos anúncios na aba Tráfego.'), { statusCode: 400 });
  }
  const cards = await query<{ id: string; titulo: string; descricao: string }>(
    'SELECT id, titulo, left(descricao, 500) AS descricao FROM gc_social_producao WHERE id = ANY($1::uuid[])',
    [desempenho.map((d) => d.id)],
  );
  const porId = new Map(cards.map((c) => [c.id, c]));
  const dados = desempenho.map((d) => ({ ...d, pedido: porId.get(d.id)?.descricao ?? '' }));
  const sistema = `Você é o estrategista da NX Digital. Analise o desempenho das artes nos anúncios (CTR, custo por resultado, gasto)
e diga em português, direto ao ponto: quais artes foram melhor e por quê (formato, mensagem, oferta), o que evitar, e 3 ideias de próximas
artes no estilo das vencedoras. Até 12 linhas, com marcadores "- ". Não invente números.`;
  return (await chamarClaude(sistema, [{ role: 'user', content: json(dados) }], 1500)).trim();
}

// ---------------------------------------------------------------- automático ao aprovar

/** Drive: sobe as artes finais pra pasta do cliente (subpasta do mês). */
export async function enviarArteProDrive(producaoId: string): Promise<{ link: string; enviados: number }> {
  const c = await card(producaoId);
  const cfg = await queryOne<{ drive_pasta_artes: string }>('SELECT drive_pasta_artes FROM gc_clientes WHERE id = $1', [c.gc_cliente_id]);
  if (!cfg?.drive_pasta_artes) throw Object.assign(new Error('Cole o link da pasta do Drive do cliente na aba Tráfego (Artes aprovadas).'), { statusCode: 400 });
  const arquivos = (c.anexos ?? []).filter((a) => a.papel !== 'referencia' && /^(image|video)\//.test(a.type))
    .map((a, i) => ({ nome: `${c.titulo.replace(/[\\/:*?"<>|]+/g, '-').slice(0, 80)}${i ? `-${i + 1}` : ''}${a.name.match(/\.\w+$/)?.[0] ?? ''}`, dataUrl: a.dataUrl }));
  if (arquivos.length === 0) throw Object.assign(new Error('Sem arte final anexada'), { statusCode: 400 });
  const r = await enviarProDrive(cfg.drive_pasta_artes, c.mes, arquivos);
  await query('UPDATE gc_social_producao SET drive_link = $2, drive_enviado_em = NOW() WHERE id = $1', [producaoId, r.link]);
  return r;
}

/**
 * Quando a arte é aprovada (pelo cliente ou pela equipe): gera a copy do anúncio se ainda não tem e manda
 * a arte pro Drive se o cliente tem pasta configurada. Em segundo plano: nunca lança.
 */
export async function aoAprovar(producaoId: string): Promise<void> {
  try {
    const c = await card(producaoId);
    if (iaLigada() && !c.copy_anuncio && imagensFinais(c.anexos).length > 0) {
      await gerarCopy(producaoId).catch((err) => console.error('[social] copy automática falhou', err));
    }
    if (driveConfigurado() && !c.drive_link) {
      const cfg = await queryOne<{ drive_pasta_artes: string }>('SELECT drive_pasta_artes FROM gc_clientes WHERE id = $1', [c.gc_cliente_id]);
      if (cfg?.drive_pasta_artes) await enviarArteProDrive(producaoId).catch((err) => console.error('[social] envio pro Drive falhou', err));
    }
  } catch (err) {
    console.error('[social] aoAprovar falhou', err);
  }
}
