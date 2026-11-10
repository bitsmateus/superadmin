import crypto from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { FastifyInstance } from 'fastify';
import sharp from 'sharp';
import { query, queryOne, withTransaction } from '../db.js';
import { chamarClaude } from '../lib/gcIa.js';
import { contaDoCliente } from '../lib/gcSocialPublicar.js';
import { baixarFoto, buscarPorEan, eanValido } from '../lib/tabloide/ean.js';
import { DADOS_VAZIOS, FORMATOS, MODELOS, fundoValido, precoNumero, type DadosTabloide, type ItemTabloide } from '../lib/tabloide/layout.js';
import { normalizar, semelhanca } from '../lib/tabloide/busca.js';
import { testarConexao } from '../lib/tabloide/conexao.js';
import { prepararFoto, removeBgDisponivel, type ModoRecorte } from '../lib/tabloide/recorte.js';
import { MAX_PAGINAS_VIDEO, renderizarImagens, renderizarPdf, renderizarVideo } from '../lib/tabloide/render.js';

/**
 * Tabloide automático do Mercado Nunes (/mercadonunes/tabloide).
 *
 * Página pública, sem login (igual ao gerador de cartazes): quem tem o link usa.
 */

const BASE = '/api/public/mercadonunes';

interface ProdutoLinha {
  id: string;
  nome: string;
  detalhe: string;
  marca: string;
  ean: string | null;
  fundo_removido: boolean;
  foto_versao: number;
  tem_foto: boolean;
  updated_at: string;
}

const COLUNAS = `id, nome, detalhe, marca, ean, fundo_removido, foto_versao, (foto IS NOT NULL) AS tem_foto, updated_at`;

// ── Cliente do painel (pra publicar) ────────────────────────────────────────

async function clienteDoMercado(): Promise<{ id: string; nome: string } | null> {
  const cfg = await queryOne<{ gc_cliente_id: string | null }>('SELECT gc_cliente_id FROM mn_tabloide_config WHERE id = true');
  const fixo = cfg?.gc_cliente_id || process.env.MERCADONUNES_GC_CLIENTE_ID;
  if (fixo) return queryOne<{ id: string; nome: string }>('SELECT id, nome_empresa AS nome FROM gc_clientes WHERE id = $1', [fixo]);
  const achados = await query<{ id: string; nome: string }>(
    `SELECT id, nome_empresa AS nome FROM gc_clientes WHERE nome_empresa ILIKE '%nunes%' ORDER BY created_at LIMIT 2`,
  ).catch(() => []);
  return achados.length === 1 ? achados[0] : null;
}

// ── Montagem pro servidor (fotos e logo embutidas) ──────────────────────────

let logoCache: string | null = null;
async function logoDataUrl(): Promise<string> {
  if (logoCache) return logoCache;
  try {
    const buf = await fs.readFile(path.resolve(process.cwd(), 'assets/mercadonunes-logo.jpg'));
    logoCache = `data:image/jpeg;base64,${buf.toString('base64')}`;
  } catch {
    logoCache = '';
  }
  return logoCache;
}

const texto = (v: unknown, max = 200) => String(v ?? '').slice(0, max);

/** Limpa o que veio do navegador e troca o id do produto pela foto embutida (data URL). */
async function prepararDados(bruto: Partial<DadosTabloide> | undefined): Promise<DadosTabloide> {
  const base = DADOS_VAZIOS();
  const d = bruto ?? {};
  const formato = d.formato && d.formato in FORMATOS ? d.formato : 'feed';
  const itensBrutos = Array.isArray(d.itens) ? d.itens.slice(0, 80) : [];
  const ids = [...new Set(itensBrutos.map((i) => i?.produtoId).filter((x): x is string => typeof x === 'string' && /^[0-9a-f-]{36}$/i.test(x)))];
  const fotos = new Map<string, string>();
  if (ids.length) {
    const linhas = await query<{ id: string; foto: Buffer }>('SELECT id, foto FROM mn_produtos WHERE id = ANY($1::uuid[]) AND foto IS NOT NULL', [ids]);
    for (const l of linhas) fotos.set(l.id, `data:image/webp;base64,${Buffer.from(l.foto).toString('base64')}`);
  }
  const itens: ItemTabloide[] = itensBrutos.map((i, n) => ({
    id: texto(i?.id, 60) || String(n),
    nome: texto(i?.nome, 80),
    detalhe: texto(i?.detalhe, 40),
    preco: texto(i?.preco, 12),
    precoDe: texto(i?.precoDe, 12),
    unidade: texto(i?.unidade, 12),
    produtoId: i?.produtoId ?? null,
    destaque: !!i?.destaque,
    fotoUrl: i?.produtoId ? fotos.get(i.produtoId) ?? null : null,
  }));
  return {
    titulo: texto(d.titulo, 60),
    subtitulo: texto(d.subtitulo, 80),
    validade: texto(d.validade, 80),
    modeloId: MODELOS.some((m) => m.id === d.modeloId) ? (d.modeloId as string) : base.modeloId,
    formato,
    porPagina: Math.max(0, Math.min(30, Number(d.porPagina) || 0)),
    itens,
    endereco: texto(d.endereco, 120),
    whatsapp: texto(d.whatsapp, 40),
    endereco2: texto(d.endereco2, 120),
    whatsapp2: texto(d.whatsapp2, 40),
    aviso: texto(d.aviso, 160),
    fundoUrl: typeof d.fundoUrl === 'string' && d.fundoUrl.length <= 4 * 1024 * 1024 ? fundoValido(d.fundoUrl) : '',
    fundoEscurecer: Math.max(0, Math.min(80, Number(d.fundoEscurecer ?? 25) || 0)),
    ocultarLogo: d.ocultarLogo === true,
    ocultarTextos: d.ocultarTextos === true,
    ocultarRodape: d.ocultarRodape === true,
  };
}

const nomeArquivo = (d: DadosTabloide) =>
  (normalizar(d.titulo || MODELOS.find((m) => m.id === d.modeloId)?.tituloPadrao || 'tabloide').replace(/\s+/g, '-') || 'tabloide').slice(0, 40);

// ── Vídeos em geração (memória; somem em 30 min) ────────────────────────────

interface JobVideo {
  status: 'gerando' | 'pronto' | 'erro';
  progresso: number;
  erro: string | null;
  arquivo: Buffer | null;
  nome: string;
  criado: number;
}
const videos = new Map<string, JobVideo>();
function limparVideos() {
  const limite = Date.now() - 30 * 60_000;
  for (const [id, j] of videos) if (j.criado < limite) videos.delete(id);
}

export async function mercadoNunesTabloideRoutes(app: FastifyInstance) {
  // ── Catálogo ──────────────────────────────────────────────────────────────

  app.get<{ Querystring: { q?: string; limite?: string } }>(`${BASE}/produtos`, async (req) => {
    const q = normalizar(req.query.q ?? '');
    const limite = Math.min(500, Number(req.query.limite) || 200);
    if (!q) {
      return { produtos: await query<ProdutoLinha>(`SELECT ${COLUNAS} FROM mn_produtos ORDER BY updated_at DESC LIMIT $1`, [limite]) };
    }
    const todos = await query<ProdutoLinha & { busca: string }>(`SELECT ${COLUNAS}, busca FROM mn_produtos`);
    const porEan = /^\d{8,14}$/.test(q) ? todos.filter((p) => p.ean === q) : [];
    const ordenados = todos
      .map((p) => ({ p, s: Math.max(semelhanca(q, p.busca), p.busca.includes(q) ? 0.9 : 0) }))
      .filter((x) => x.s >= 0.35)
      .sort((a, b) => b.s - a.s)
      .slice(0, limite)
      .map((x) => x.p);
    return { produtos: [...porEan, ...ordenados.filter((p) => !porEan.includes(p))].map(({ busca: _b, ...p }) => p) };
  });

  app.get<{ Params: { id: string } }>(`${BASE}/produtos/:id/foto`, async (req, reply) => {
    if (!/^[0-9a-f-]{36}$/i.test(req.params.id)) return reply.status(404).send();
    const r = await queryOne<{ foto: Buffer | null }>('SELECT foto FROM mn_produtos WHERE id = $1', [req.params.id]);
    if (!r?.foto) return reply.status(404).send();
    return reply.header('Content-Type', 'image/webp').header('Cache-Control', 'public, max-age=31536000, immutable').send(r.foto);
  });

  const dataUrlParaBuffer = (u: unknown): Buffer | null => {
    const m = String(u ?? '').match(/^data:image\/[\w.+-]+;base64,(.+)$/s);
    if (!m) return null;
    const b = Buffer.from(m[1], 'base64');
    return b.length > 0 && b.length < 15 * 1024 * 1024 ? b : null;
  };

  async function salvarFoto(id: string, entrada: Buffer, modo: ModoRecorte) {
    const f = await prepararFoto(entrada, modo);
    await query(
      `UPDATE mn_produtos SET foto = $2, foto_original = $3, fundo_removido = $4, foto_versao = foto_versao + 1, updated_at = NOW() WHERE id = $1`,
      [id, f.foto, f.original, f.fundoRemovido],
    );
    return f.aviso;
  }

  const buscaDe = (nome: string, detalhe: string, marca: string) => normalizar(`${nome} ${detalhe} ${marca}`);

  app.post<{ Body: { nome?: string; detalhe?: string; marca?: string; ean?: string; foto?: string; modo?: ModoRecorte } }>(
    `${BASE}/produtos`,
    async (req, reply) => {
      const b = req.body ?? {};
      const nome = texto(b.nome, 80).trim();
      if (!nome) return reply.status(400).send({ message: 'Dê um nome pro produto.' });
      const ean = /^\d{8,14}$/.test(String(b.ean ?? '')) ? String(b.ean) : null;
      const detalhe = texto(b.detalhe, 40).trim();
      const marca = texto(b.marca, 60).trim();
      const novo = await queryOne<{ id: string }>(
        `INSERT INTO mn_produtos (nome, detalhe, marca, ean, busca) VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT (ean) DO UPDATE SET nome = EXCLUDED.nome, detalhe = EXCLUDED.detalhe, busca = EXCLUDED.busca, updated_at = NOW()
         RETURNING id`,
        [nome, detalhe, marca, ean, buscaDe(nome, detalhe, marca)],
      );
      let aviso: string | null = null;
      const foto = dataUrlParaBuffer(b.foto);
      if (foto && novo) aviso = await salvarFoto(novo.id, foto, b.modo ?? 'auto');
      const produto = await queryOne<ProdutoLinha>(`SELECT ${COLUNAS} FROM mn_produtos WHERE id = $1`, [novo?.id]);
      return reply.status(201).send({ produto, aviso });
    },
  );

  app.patch<{ Params: { id: string }; Body: { nome?: string; detalhe?: string; marca?: string; ean?: string | null } }>(
    `${BASE}/produtos/:id`,
    async (req, reply) => {
      const atual = await queryOne<ProdutoLinha>(`SELECT ${COLUNAS} FROM mn_produtos WHERE id = $1`, [req.params.id]);
      if (!atual) return reply.status(404).send({ message: 'Produto não encontrado.' });
      const b = req.body ?? {};
      const nome = b.nome !== undefined ? texto(b.nome, 80).trim() || atual.nome : atual.nome;
      const detalhe = b.detalhe !== undefined ? texto(b.detalhe, 40).trim() : atual.detalhe;
      const marca = b.marca !== undefined ? texto(b.marca, 60).trim() : atual.marca;
      const ean = b.ean !== undefined ? (/^\d{8,14}$/.test(String(b.ean ?? '')) ? String(b.ean) : null) : atual.ean;
      try {
        return await queryOne<ProdutoLinha>(
          `UPDATE mn_produtos SET nome=$2, detalhe=$3, marca=$4, ean=$5, busca=$6, updated_at=NOW() WHERE id=$1 RETURNING ${COLUNAS}`,
          [req.params.id, nome, detalhe, marca, ean, buscaDe(nome, detalhe, marca)],
        );
      } catch (err) {
        if (/mn_produtos_ean_key/.test((err as Error).message)) return reply.status(409).send({ message: 'Já existe outro produto com esse código de barras.' });
        throw err;
      }
    },
  );

  app.post<{ Params: { id: string }; Body: { foto?: string; modo?: ModoRecorte } }>(
    `${BASE}/produtos/:id/foto`,
    async (req, reply) => {
      const modo: ModoRecorte = ['auto', 'sem', 'removebg'].includes(String(req.body?.modo)) ? (req.body!.modo as ModoRecorte) : 'auto';
      let entrada = dataUrlParaBuffer(req.body?.foto);
      if (!entrada) {
        // Sem foto nova = refazer o recorte da original com outro modo.
        const r = await queryOne<{ foto_original: Buffer | null }>('SELECT foto_original FROM mn_produtos WHERE id = $1', [req.params.id]);
        entrada = r?.foto_original ? Buffer.from(r.foto_original) : null;
      }
      if (!entrada) return reply.status(400).send({ message: 'Envie a foto do produto.' });
      try {
        const aviso = await salvarFoto(req.params.id, entrada, modo);
        const produto = await queryOne<ProdutoLinha>(`SELECT ${COLUNAS} FROM mn_produtos WHERE id = $1`, [req.params.id]);
        if (!produto) return reply.status(404).send({ message: 'Produto não encontrado.' });
        return { produto, aviso };
      } catch (err) {
        return reply.status(400).send({ message: /Input buffer|unsupported image/i.test((err as Error).message) ? 'Não consegui abrir essa imagem. Use JPG, PNG ou WebP.' : (err as Error).message });
      }
    },
  );

  app.delete<{ Params: { id: string } }>(`${BASE}/produtos/:id`, async (req) => {
    await query('DELETE FROM mn_produtos WHERE id = $1', [req.params.id]);
    return { ok: true };
  });

  /** Acha no catálogo o produto de cada linha colada (por código de barras ou pelo nome). */
  app.post<{ Body: { itens?: { nome?: string; detalhe?: string; ean?: string }[] } }>(
    `${BASE}/produtos/combinar`,
    async (req) => {
      const itens = (req.body?.itens ?? []).slice(0, 120);
      const todos = await query<ProdutoLinha & { busca: string }>(`SELECT ${COLUNAS}, busca FROM mn_produtos`);
      return {
        resultados: itens.map((i) => {
          if (i.ean) {
            const p = todos.find((x) => x.ean === i.ean);
            if (p) return { produto: limpar(p), nota: 1 };
          }
          const alvo = `${i.nome ?? ''} ${i.detalhe ?? ''}`;
          let melhor: { p: ProdutoLinha & { busca: string }; s: number } | null = null;
          for (const p of todos) {
            const s = semelhanca(alvo, p.busca);
            if (!melhor || s > melhor.s) melhor = { p, s };
          }
          return melhor && melhor.s >= 0.6 ? { produto: limpar(melhor.p), nota: Number(melhor.s.toFixed(2)) } : { produto: null, nota: 0 };
        }),
      };
    },
  );
  const limpar = ({ busca: _b, ...p }: ProdutoLinha & { busca: string }) => p;

  /** Código de barras → produto no catálogo (com foto). Se ainda não existe, busca nas bases e cadastra. */
  app.post<{ Body: { ean?: string; nome?: string; detalhe?: string } }>(`${BASE}/produtos/ean`, async (req, reply) => {
    const ean = String(req.body?.ean ?? '').replace(/\D/g, '');
    if (!eanValido(ean)) return reply.status(400).send({ message: 'Código de barras inválido (confira os números).' });
    const ja = await queryOne<ProdutoLinha>(`SELECT ${COLUNAS} FROM mn_produtos WHERE ean = $1`, [ean]);
    if (ja?.tem_foto) return { produto: ja, fonte: 'catalogo', aviso: null };
    const achado = await buscarPorEan(ean);
    if (!achado && !ja) return reply.status(404).send({ message: 'Não achei esse código nas bases. Cadastre o produto com uma foto.' });
    const nome = texto(req.body?.nome, 80).trim() || ja?.nome || achado?.nome || ean;
    const detalhe = texto(req.body?.detalhe, 40).trim() || ja?.detalhe || achado?.detalhe || '';
    const marca = ja?.marca || achado?.marca || '';
    const linha = await queryOne<{ id: string }>(
      `INSERT INTO mn_produtos (nome, detalhe, marca, ean, busca) VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (ean) DO UPDATE SET updated_at = NOW() RETURNING id`,
      [nome, detalhe, marca, ean, buscaDe(nome, detalhe, marca)],
    );
    let aviso: string | null = null;
    if (achado?.fotoUrl && linha) {
      const foto = await baixarFoto(achado.fotoUrl);
      if (foto) aviso = await salvarFoto(linha.id, foto, 'auto').catch(() => 'A foto da base não abriu. Envie uma foto.');
      else aviso = 'A base não tem foto desse produto. Envie uma foto.';
    } else aviso = 'A base não tem foto desse produto. Envie uma foto.';
    const produto = await queryOne<ProdutoLinha>(`SELECT ${COLUNAS} FROM mn_produtos WHERE id = $1`, [linha?.id]);
    return { produto, fonte: achado?.fonte ?? 'catalogo', aviso };
  });

  // ── Configuração (rodapé fixo + cliente do Instagram) ─────────────────────

  app.get(`${BASE}/tabloide/config`, async () => {
    const cfg = await queryOne<{ endereco: string; whatsapp: string; endereco2: string; whatsapp2: string; aviso: string }>(
      'SELECT endereco, whatsapp, endereco2, whatsapp2, aviso FROM mn_tabloide_config WHERE id = true',
    );
    return { ...cfg, removeBg: removeBgDisponivel(), cosmos: !!process.env.COSMOS_TOKEN, ia: !!process.env.ANTHROPIC_API_KEY };
  });

  app.patch<{ Body: { endereco?: string; whatsapp?: string; endereco2?: string; whatsapp2?: string; aviso?: string } }>(`${BASE}/tabloide/config`, async (req) => {
    const b = req.body ?? {};
    const campo = (v: unknown, max: number) => (v !== undefined ? texto(v, max) : null);
    return queryOne(
      `UPDATE mn_tabloide_config SET
         endereco = COALESCE($1, endereco), whatsapp = COALESCE($2, whatsapp), aviso = COALESCE($3, aviso),
         endereco2 = COALESCE($4, endereco2), whatsapp2 = COALESCE($5, whatsapp2), updated_at = NOW()
       WHERE id = true RETURNING endereco, whatsapp, endereco2, whatsapp2, aviso`,
      [campo(b.endereco, 120), campo(b.whatsapp, 40), campo(b.aviso, 160), campo(b.endereco2, 120), campo(b.whatsapp2, 40)],
    );
  });

  // ── Tabloides salvos ──────────────────────────────────────────────────────

  app.get(`${BASE}/tabloides`, async () => ({
    tabloides: await query(
      `SELECT id, titulo, dados, criado_por, created_at, updated_at FROM mn_tabloides ORDER BY updated_at DESC LIMIT 60`,
    ),
  }));

  app.post<{ Body: { titulo?: string; dados?: unknown } }>(`${BASE}/tabloides`, async (req, reply) => {
    const r = await queryOne(
      `INSERT INTO mn_tabloides (titulo, dados, criado_por) VALUES ($1, $2::jsonb, $3) RETURNING id, titulo, dados, criado_por, created_at, updated_at`,
      [texto(req.body?.titulo, 120), JSON.stringify(req.body?.dados ?? {}), null],
    );
    return reply.status(201).send(r);
  });

  app.patch<{ Params: { id: string }; Body: { titulo?: string; dados?: unknown } }>(`${BASE}/tabloides/:id`, async (req, reply) => {
    const r = await queryOne(
      `UPDATE mn_tabloides SET titulo = COALESCE($2, titulo), dados = COALESCE($3::jsonb, dados), updated_at = NOW()
       WHERE id = $1 RETURNING id, titulo, dados, criado_por, created_at, updated_at`,
      [req.params.id, req.body?.titulo !== undefined ? texto(req.body.titulo, 120) : null, req.body?.dados !== undefined ? JSON.stringify(req.body.dados) : null],
    );
    if (!r) return reply.status(404).send({ message: 'Tabloide não encontrado.' });
    return r;
  });

  app.delete<{ Params: { id: string } }>(`${BASE}/tabloides/:id`, async (req) => {
    await query('DELETE FROM mn_tabloides WHERE id = $1', [req.params.id]);
    return { ok: true };
  });

  // ── Layouts (templates) ───────────────────────────────────────────────────
  // Um tabloide salvo como modelo pra reaproveitar: visual (modelo, formato, textos, rodapé) e,
  // se quiser, os produtos.

  app.get(`${BASE}/tabloide/layouts`, async () => ({
    layouts: await query('SELECT id, nome, dados, created_at FROM mn_tabloide_layouts ORDER BY nome ASC'),
  }));

  app.post<{ Body: { nome?: string; dados?: unknown } }>(`${BASE}/tabloide/layouts`, async (req, reply) => {
    const nome = texto(req.body?.nome, 80).trim();
    if (!nome) return reply.status(400).send({ message: 'Dê um nome pro layout.' });
    const r = await queryOne(
      `INSERT INTO mn_tabloide_layouts (nome, dados) VALUES ($1, $2::jsonb)
       ON CONFLICT (nome) DO UPDATE SET dados = EXCLUDED.dados, created_at = NOW()
       RETURNING id, nome, dados, created_at`,
      [nome, JSON.stringify(req.body?.dados ?? {})],
    );
    return reply.status(201).send(r);
  });

  app.delete<{ Params: { id: string } }>(`${BASE}/tabloide/layouts/:id`, async (req) => {
    await query('DELETE FROM mn_tabloide_layouts WHERE id = $1', [req.params.id]);
    return { ok: true };
  });

  // ── Exportar ──────────────────────────────────────────────────────────────

  app.post<{ Body: { dados?: Partial<DadosTabloide>; saida?: 'png' | 'pdf' } }>(
    `${BASE}/tabloides/exportar`,
    async (req, reply) => {
      const dados = await prepararDados(req.body?.dados);
      if (!dados.itens.length) return reply.status(400).send({ message: 'Coloque pelo menos um produto.' });
      const logo = await logoDataUrl();
      const nome = nomeArquivo(dados);
      if (req.body?.saida === 'pdf') {
        const pdf = await renderizarPdf(dados, logo);
        return reply
          .header('Content-Type', 'application/pdf')
          .header('Content-Disposition', `attachment; filename="${nome}.pdf"`)
          .send(pdf);
      }
      const imagens = await renderizarImagens(dados, logo);
      return {
        arquivos: imagens.map((b, i) => ({
          nome: imagens.length > 1 ? `${nome}-${dados.formato}-${i + 1}.png` : `${nome}-${dados.formato}.png`,
          dataUrl: `data:image/png;base64,${b.toString('base64')}`,
        })),
      };
    },
  );

  app.post<{ Body: { dados?: Partial<DadosTabloide> } }>(`${BASE}/tabloides/video`, async (req, reply) => {
    limparVideos();
    if ([...videos.values()].filter((j) => j.status === 'gerando').length >= 2) {
      return reply.status(429).send({ message: 'Já tem vídeo sendo gerado. Espere terminar.' });
    }
    const dados = await prepararDados(req.body?.dados);
    if (!dados.itens.length) return reply.status(400).send({ message: 'Coloque pelo menos um produto.' });
    const id = crypto.randomBytes(12).toString('hex');
    const job: JobVideo = { status: 'gerando', progresso: 0, erro: null, arquivo: null, nome: `${nomeArquivo(dados)}-reels.mp4`, criado: Date.now() };
    videos.set(id, job);
    const logo = await logoDataUrl();
    void renderizarVideo(dados, logo, (f) => {
      job.progresso = f;
    })
      .then((buf) => {
        job.arquivo = buf;
        job.status = 'pronto';
      })
      .catch((err: Error) => {
        console.error('[tabloide] vídeo falhou', err.message);
        job.erro = 'Não consegui gerar o vídeo. Tente de novo.';
        job.status = 'erro';
      });
    return reply.status(202).send({ id, paginasNoVideo: MAX_PAGINAS_VIDEO });
  });

  app.get<{ Params: { id: string } }>(`${BASE}/tabloides/video/:id`, async (req, reply) => {
    const j = videos.get(req.params.id);
    if (!j) return reply.status(404).send({ message: 'Vídeo não encontrado (passou de 30 minutos?). Gere de novo.' });
    return { status: j.status, progresso: j.progresso, erro: j.erro, tamanho: j.arquivo?.length ?? 0 };
  });

  app.get<{ Params: { id: string } }>(`${BASE}/tabloides/video/:id/arquivo`, async (req, reply) => {
    const j = videos.get(req.params.id);
    if (!j?.arquivo) return reply.status(404).send({ message: 'Vídeo não encontrado.' });
    return reply.header('Content-Type', 'video/mp4').header('Content-Disposition', `attachment; filename="${j.nome}"`).send(j.arquivo);
  });

  // ── Legenda com IA ────────────────────────────────────────────────────────

  app.post<{ Body: { dados?: Partial<DadosTabloide> } }>(`${BASE}/tabloides/legenda`, async (req, reply) => {
    const d = await prepararDados(req.body?.dados);
    if (!d.itens.length) return reply.status(400).send({ message: 'Coloque pelo menos um produto.' });
    const lista = d.itens
      .map((i) => {
        const un = i.unidade === 'kg' ? ' o kg' : i.unidade === 'un' ? ' a unidade' : i.unidade ? ` (${i.unidade})` : '';
        const de = i.precoDe && precoNumero(i.precoDe) > precoNumero(i.preco) ? ` (de R$ ${i.precoDe})` : '';
        return `- ${i.nome}${i.detalhe ? ` ${i.detalhe}` : ''}: R$ ${i.preco}${un}${de}${i.destaque ? ' [DESTAQUE]' : ''}`;
      })
      .join('\n');
    const sistema =
      'Você escreve legendas de Instagram para o Nunes Supermercado, um mercado de bairro. Tom animado, direto e popular, ' +
      'em português do Brasil. Regras: comece com uma frase de impacto curta; destaque primeiro os produtos marcados como DESTAQUE ' +
      'e no máximo 6 ofertas com preço exato (copie os preços como vieram, nunca invente nem arredonde); diga a validade se houver; ' +
      'termine chamando para vir à loja e com o endereço/WhatsApp se houver; 3 a 6 hashtags locais e de mercado. ' +
      'Pode usar emojis com moderação. No máximo 900 caracteres. Responda só com a legenda, sem aspas e sem comentários.';
    const pedido = `Tabloide: ${d.titulo || MODELOS.find((m) => m.id === d.modeloId)?.tituloPadrao}
${d.subtitulo ? `Chamada: ${d.subtitulo}\n` : ''}${d.validade ? `Validade: ${d.validade}\n` : ''}${d.endereco ? `Endereço: ${d.endereco}\n` : ''}${d.whatsapp ? `WhatsApp: ${d.whatsapp}\n` : ''}${d.endereco2 ? `Endereço (2ª loja): ${d.endereco2}\n` : ''}${d.whatsapp2 ? `WhatsApp (2ª loja): ${d.whatsapp2}\n` : ''}
Ofertas:
${lista}`;
    try {
      const legenda = await chamarClaude(sistema, [{ role: 'user', content: pedido }], 1200);
      return { legenda: legenda.replace(/^["“]|["”]$/g, '').trim() };
    } catch (err) {
      return reply.status(502).send({ message: (err as Error).message });
    }
  });

  // ── Publicar no Instagram (via Social media do cliente no painel NX) ──────

  app.get(`${BASE}/tabloides/instagram`, async () => {
    const cliente = await clienteDoMercado();
    if (!cliente) return { ok: false, motivo: 'O Mercado Nunes ainda não está ligado a um cliente do painel NX. Peça para a NX configurar.' };
    try {
      const conta = await contaDoCliente(cliente.id);
      return { ok: true, username: conta.username, cliente: cliente.nome };
    } catch (err) {
      return { ok: false, motivo: (err as Error).message, cliente: cliente.nome };
    }
  });

  // Confere tudo que a publicação usa, sem publicar nada.
  app.post<{ Body: { base_url?: string } }>(`${BASE}/tabloides/instagram/testar`, async (req) =>
    testarConexao(await clienteDoMercado(), String(req.body?.base_url ?? '')),
  );

  app.post<{
    Body: {
      dados?: Partial<DadosTabloide>;
      formato?: 'feed' | 'story' | 'reels';
      legenda?: string;
      agendado_para?: string | null;
      redes?: string[];
      base_url?: string;
      video_id?: string;
    };
  }>(`${BASE}/tabloides/publicar`, async (req, reply) => {
    const b = req.body ?? {};
    const cliente = await clienteDoMercado();
    if (!cliente) return reply.status(400).send({ message: 'O Mercado Nunes ainda não está ligado a um cliente do painel NX.' });
    try {
      await contaDoCliente(cliente.id);
    } catch (err) {
      return reply.status(400).send({ message: (err as Error).message });
    }
    const formato = b.formato === 'story' || b.formato === 'reels' ? b.formato : 'feed';
    let redes = [...new Set((b.redes ?? ['instagram']).filter((r) => r === 'instagram' || r === 'facebook'))];
    if (!redes.length) redes = ['instagram'];
    if (formato === 'story' && redes.includes('facebook')) return reply.status(400).send({ message: 'Story pela API só no Instagram. Desmarque o Facebook.' });
    const quando = b.agendado_para ? new Date(b.agendado_para) : new Date();
    if (Number.isNaN(quando.getTime())) return reply.status(400).send({ message: 'Data e hora inválidas.' });
    const baseUrl = String(process.env.SOCIAL_MIDIA_BASE_URL || b.base_url || '').trim().replace(/\/+$/, '');
    if (!/^https:\/\//.test(baseUrl)) {
      return reply.status(400).send({ message: 'A Meta só baixa mídia de endereço https público (configure SOCIAL_MIDIA_BASE_URL no servidor).' });
    }

    const dados = await prepararDados(b.dados);
    if (!dados.itens.length) return reply.status(400).send({ message: 'Coloque pelo menos um produto.' });
    const anexos: { id: string; name: string; type: string; size: number; dataUrl: string }[] = [];
    if (formato === 'reels') {
      const job = b.video_id ? videos.get(b.video_id) : undefined;
      if (!job?.arquivo) return reply.status(400).send({ message: 'Gere o vídeo antes de publicar o Reels.' });
      anexos.push({ id: crypto.randomUUID(), name: job.nome, type: 'video/mp4', size: job.arquivo.length, dataUrl: `data:video/mp4;base64,${job.arquivo.toString('base64')}` });
    } else {
      const logo = await logoDataUrl();
      const imagens = await renderizarImagens({ ...dados, formato }, logo);
      for (const [i, png] of imagens.slice(0, 10).entries()) {
        const jpg = await sharp(png).jpeg({ quality: 92 }).toBuffer();
        anexos.push({ id: crypto.randomUUID(), name: `${nomeArquivo(dados)}-${i + 1}.jpg`, type: 'image/jpeg', size: jpg.length, dataUrl: `data:image/jpeg;base64,${jpg.toString('base64')}` });
      }
    }
    const legenda = texto(b.legenda, 2200);
    const titulo = `Tabloide: ${dados.titulo || MODELOS.find((m) => m.id === dados.modeloId)?.tituloPadrao}${dados.validade ? ` (${dados.validade})` : ''}`;
    const producaoId = await withTransaction(async (client) => {
      const { rows } = await client.query<{ id: string }>(
        `INSERT INTO gc_social_producao (gc_cliente_id, titulo, descricao, status, anexos)
         VALUES ($1, $2, $3, 'em_producao', $4::jsonb) RETURNING id`,
        [cliente.id, titulo.slice(0, 200), `Gerado no tabloide do Mercado Nunes.\n\nLegenda:\n${legenda}`, JSON.stringify(anexos)],
      );
      await client.query(
        `INSERT INTO gc_social_agendamentos
           (gc_producao_id, gc_cliente_id, redes, formato, legenda, agendado_para, midia_token, base_url, criado_por)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NULL)`,
        [rows[0].id, cliente.id, redes, formato, legenda, quando.toISOString(), crypto.randomBytes(24).toString('hex'), baseUrl],
      );
      return rows[0].id;
    });
    return reply.status(201).send({ producaoId, agendadoPara: quando.toISOString(), imagens: anexos.length });
  });
}
