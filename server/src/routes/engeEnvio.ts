import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { randomBytes } from 'node:crypto';
import bcrypt from 'bcrypt';
import { query, queryOne, withTransaction } from '../db.js';
import { sendMail, type SmtpConfig } from '../lib/mailer.js';
import {
  MODELOS_PADRAO,
  REGUAS_PADRAO,
  listaTelefones,
  montarHtml,
  normalizarEtapa,
  preencher,
  type EtapaRegua,
} from '../lib/engeEnvio.js';
import {
  enviarAviso,
  lerConfigEnge,
  linkCiente,
  mandarWhatsApp,
  nxCompleto,
  smtpCompleto,
  textosDoAviso,
  type NxEnge,
} from '../jobs/engeEnvioDispatch.js';
import type { PoolClient } from 'pg';

/**
 * Enge Services (/engeenvio) — avisos de garantia dos empreendimentos que a Enge administra.
 *
 * LOGIN PRÓPRIO (e-mail + senha só desta ferramenta), no mesmo molde do açougue: o token é o JWT
 * do app carimbado com `scope: 'engeenvio'`, e `app.authenticate` (painel) recusa qualquer token
 * com `scope` — um login não vira o outro.
 *
 * O envio em si fica em jobs/engeEnvioDispatch.ts (a cada minuto manda o que já chegou na data),
 * por e-mail (SMTP da Enge) e/ou WhatsApp (conexão da Enge na NX / Z-PRO), conforme os canais de cada aviso.
 */

interface Usuario {
  id: string;
  email: string;
  nome: string | null;
  senha_hash?: string;
}

const EMAIL_OK = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DATA_OK = /^\d{4}-\d{2}-\d{2}$/;
const P = '/api/public/engeenvio';
const novoToken = () => randomBytes(18).toString('hex');

const SELECT_EMP = `id, nome, cidade, to_char(entrega, 'YYYY-MM-DD') AS entrega, sindico, emails, telefone,
                    construtora, observacoes, created_at AS "createdAt"`;
const SELECT_GAR = `g.id, g.empreendimento_id AS "empreendimentoId", g.item, g.prazo,
                    to_char(g.vencimento, 'YYYY-MM-DD') AS vencimento,
                    to_char(g.chamado_em, 'YYYY-MM-DD') AS "chamadoEm", g.chamado_protocolo AS "chamadoProtocolo"`;
const SELECT_ENV = `v.id, v.garantia_id AS "garantiaId", v.enviar_em AS "enviarEm", v.status, v.destinatarios,
                    v.assunto, v.enviado_em AS "enviadoEm", v.erro, v.ciente_em AS "cienteEm",
                    v.ciente_nome AS "cienteNome", v.canal_email AS "canalEmail", v.canal_whatsapp AS "canalWhatsapp",
                    v.whatsapp_para AS "whatsappPara", v.whatsapp_enviado_em AS "whatsappEnviadoEm",
                    v.whatsapp_erro AS "whatsappErro", v.modelo_id AS "modeloId"`;
// Já saiu por pelo menos um canal (o link "estou ciente" vai no e-mail e no WhatsApp).
const JA_SAIU = '(v.enviado_em IS NOT NULL OR v.whatsapp_enviado_em IS NOT NULL)';

interface Canais {
  email?: boolean;
  whatsapp?: boolean;
}
/** Canais de um aviso; sem nada informado, só e-mail (o aviso que vale juridicamente). */
const lerCanais = (c?: Canais | null) => ({ email: c?.email ?? true, whatsapp: c?.whatsapp ?? false });

/** Modelo que não existe mais (apagado em outra aba) vira NULL = modelo padrão, em vez de erro de FK. */
const MODELO_OU_NULL = (param: string) => `(SELECT id FROM ee_modelos WHERE id::text = ${param}::text)`;

/** Aviso pedido pela tela: só a data (canais/modelo do pedido) ou já com modelo e canais (régua). */
type EnvioPedido = string | { enviarEm?: string; modeloId?: string | null; email?: boolean; whatsapp?: boolean };

function normalizarEnvios(lista: EnvioPedido[] | undefined, canais: { email: boolean; whatsapp: boolean }) {
  return (lista ?? [])
    .map((e) => {
      const o = typeof e === 'string' ? { enviarEm: e } : e ?? {};
      return {
        quando: paraTimestamp(o.enviarEm),
        modeloId: typeof o.modeloId === 'string' && o.modeloId ? o.modeloId : null,
        email: o.email ?? canais.email,
        whatsapp: o.whatsapp ?? canais.whatsapp,
      };
    })
    .filter((e) => e.quando && (e.email || e.whatsapp));
}

async function inserirEnvios(c: PoolClient, garantiaId: string, envios: ReturnType<typeof normalizarEnvios>) {
  for (const e of envios) {
    await c.query(
      `INSERT INTO ee_envios (garantia_id, enviar_em, token, canal_email, canal_whatsapp, modelo_id)
       VALUES ($1,$2,$3,$4,$5,${MODELO_OU_NULL('$6')})`,
      [garantiaId, e.quando, novoToken(), e.email, e.whatsapp, e.modeloId],
    );
  }
}

/**
 * Cria os modelos e réguas de fábrica na primeira vez (uma vez só — se a Enge apagar tudo, não
 * volta). O "Aviso de vencimento" herda os textos que já estavam salvos em Configurações.
 */
let padroesOk = false;
async function garantirPadroes() {
  if (padroesOk) return;
  await withTransaction(async (c) => {
    const { rows } = await c.query<{
      padroes_criados: boolean;
      assunto: string | null;
      corpo: string | null;
      whatsapp_texto: string | null;
      nx: NxEnge | null;
    }>('SELECT padroes_criados, assunto, corpo, whatsapp_texto, nx FROM ee_config WHERE id = true FOR UPDATE');
    const cfg = rows[0];
    if (!cfg || cfg.padroes_criados) return;
    const ids: Record<string, string> = {};
    for (const [i, m] of MODELOS_PADRAO.entries()) {
      const herda = m.chave === 'aviso';
      const { rows: r } = await c.query<{ id: string }>(
        `INSERT INTO ee_modelos (nome, assunto, corpo, whatsapp_texto, whatsapp_template, whatsapp_idioma, whatsapp_parametros, padrao, ordem)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
        [
          m.nome,
          (herda && cfg.assunto?.trim()) || m.assunto,
          (herda && cfg.corpo?.trim()) || m.corpo,
          (herda && cfg.whatsapp_texto?.trim()) || m.whatsapp,
          (herda && cfg.nx?.template?.trim()) || null,
          (herda && cfg.nx?.idioma?.trim()) || null,
          JSON.stringify((herda && cfg.nx?.parametros) || []),
          herda,
          i,
        ],
      );
      ids[m.chave] = r[0].id;
    }
    for (const [i, rg] of REGUAS_PADRAO.entries()) {
      const etapas = rg.etapas.map(({ modelo, ...e }, j) => ({
        ...e,
        id: `e${j}`,
        modeloId: ids[modelo] ?? null,
        email: true,
        whatsapp: true,
      }));
      await c.query(`INSERT INTO ee_reguas (nome, etapas, padrao, ordem) VALUES ($1,$2,$3,$4)`, [
        rg.nome,
        JSON.stringify(etapas),
        Boolean(rg.padrao),
        i,
      ]);
    }
    await c.query('UPDATE ee_config SET padroes_criados = true WHERE id = true');
  });
  padroesOk = true;
}

/** "2026-11-10T09:00" (horário de Brasília, como vem do campo da tela) → timestamp com fuso. */
function paraTimestamp(valor: unknown): string | null {
  if (typeof valor !== 'string') return null;
  const m = valor.match(/^(\d{4}-\d{2}-\d{2})(?:T(\d{2}:\d{2}))?/);
  if (!m) return null;
  return `${m[1]}T${m[2] ?? '09:00'}:00-03:00`;
}

export async function engeEnvioRoutes(app: FastifyInstance) {
  async function auth(req: FastifyRequest, reply: FastifyReply) {
    try {
      await req.jwtVerify();
    } catch {
      return reply.status(401).send({ message: 'Sessão expirada — entre de novo.' });
    }
    if ((req.user as { scope?: string }).scope !== 'engeenvio') {
      return reply.status(403).send({ message: 'Este login não tem acesso ao Enge Envio.' });
    }
  }
  const comAuth = { onRequest: [auth] };

  const assinar = (u: Usuario) =>
    app.jwt.sign({ sub: u.id, email: u.email, scope: 'engeenvio' }, { expiresIn: '30d' });

  // O job não tem requisição de onde tirar o endereço do painel; guarda o de quem entra, pro link
  // "estou ciente" do e-mail apontar pro lugar certo.
  const lembrarOrigem = async (origem: unknown) => {
    if (typeof origem === 'string' && /^https?:\/\/[^\s/]+$/.test(origem)) {
      await query('UPDATE ee_config SET app_url = $1 WHERE id = true', [origem]);
    }
  };

  // ── Acesso ─────────────────────────────────────────────────────────────────────────
  app.get(`${P}/status`, async () => {
    const row = await queryOne<{ total: string }>('SELECT COUNT(*)::text AS total FROM ee_usuarios');
    return { temUsuario: Number(row?.total ?? 0) > 0 };
  });

  app.post<{ Body: { email?: string; nome?: string; senha?: string; origem?: string } }>(
    `${P}/primeiro-acesso`,
    async (req, reply) => {
      const row = await queryOne<{ total: string }>('SELECT COUNT(*)::text AS total FROM ee_usuarios');
      if (Number(row?.total ?? 0) > 0) {
        return reply.status(409).send({ message: 'Já existe acesso cadastrado — peça a senha para quem já usa.' });
      }
      const email = (req.body?.email ?? '').trim().toLowerCase();
      const senha = req.body?.senha ?? '';
      if (!EMAIL_OK.test(email)) return reply.status(400).send({ message: 'E-mail inválido.' });
      if (senha.length < 6) return reply.status(400).send({ message: 'A senha precisa de pelo menos 6 caracteres.' });
      const usuario = await queryOne<Usuario>(
        `INSERT INTO ee_usuarios (email, nome, senha_hash) VALUES ($1, $2, $3) RETURNING id, email, nome`,
        [email, (req.body?.nome ?? '').trim() || null, await bcrypt.hash(senha, 10)],
      );
      await lembrarOrigem(req.body?.origem);
      return reply.status(201).send({ token: assinar(usuario!), usuario });
    },
  );

  app.post<{ Body: { email?: string; senha?: string; origem?: string } }>(`${P}/login`, async (req, reply) => {
    const email = (req.body?.email ?? '').trim().toLowerCase();
    const usuario = await queryOne<Required<Usuario>>(
      'SELECT id, email, nome, senha_hash FROM ee_usuarios WHERE lower(email) = $1',
      [email],
    );
    if (!usuario || !(await bcrypt.compare(req.body?.senha ?? '', usuario.senha_hash))) {
      return reply.status(401).send({ message: 'E-mail ou senha incorretos.' });
    }
    await lembrarOrigem(req.body?.origem);
    const { senha_hash: _, ...dados } = usuario;
    return { token: assinar(dados), usuario: dados };
  });

  app.get(`${P}/me`, comAuth, async (req, reply) => {
    const { sub } = req.user as { sub: string };
    const usuario = await queryOne<Usuario>('SELECT id, email, nome FROM ee_usuarios WHERE id = $1', [sub]);
    if (!usuario) return reply.status(401).send({ message: 'Acesso removido.' });
    return usuario;
  });

  app.get(`${P}/usuarios`, comAuth, async () =>
    query<Usuario>('SELECT id, email, nome, created_at FROM ee_usuarios ORDER BY created_at'),
  );

  app.post<{ Body: { email?: string; nome?: string; senha?: string } }>(`${P}/usuarios`, comAuth, async (req, reply) => {
    const email = (req.body?.email ?? '').trim().toLowerCase();
    const senha = req.body?.senha ?? '';
    if (!EMAIL_OK.test(email)) return reply.status(400).send({ message: 'E-mail inválido.' });
    if (senha.length < 6) return reply.status(400).send({ message: 'A senha precisa de pelo menos 6 caracteres.' });
    try {
      const usuario = await queryOne<Usuario>(
        `INSERT INTO ee_usuarios (email, nome, senha_hash) VALUES ($1, $2, $3) RETURNING id, email, nome`,
        [email, (req.body?.nome ?? '').trim() || null, await bcrypt.hash(senha, 10)],
      );
      return reply.status(201).send(usuario);
    } catch (err) {
      if ((err as { code?: string }).code === '23505') return reply.status(409).send({ message: 'Esse e-mail já tem acesso.' });
      throw err;
    }
  });

  app.delete<{ Params: { id: string } }>(`${P}/usuarios/:id`, comAuth, async (req, reply) => {
    const { sub } = req.user as { sub: string };
    if (sub === req.params.id) return reply.status(400).send({ message: 'Você não pode remover o próprio acesso.' });
    const row = await queryOne<{ total: string }>('SELECT COUNT(*)::text AS total FROM ee_usuarios');
    if (Number(row?.total ?? 0) <= 1) return reply.status(400).send({ message: 'Precisa sobrar pelo menos um acesso.' });
    await query('DELETE FROM ee_usuarios WHERE id = $1', [req.params.id]);
    return { ok: true };
  });

  // ── Configurações (SMTP e conexão da NX — os textos ficam nos modelos) ──────────────
  app.get(`${P}/config`, comAuth, async () => {
    const cfg = await lerConfigEnge();
    // A senha do SMTP nunca volta pra tela — só se existe.
    const { password, ...smtp } = cfg.smtp ?? {};
    const { token, ...nx } = cfg.nx ?? {};
    return {
      smtp: { ...smtp, temSenha: Boolean(password) },
      copiaOculta: cfg.copia_oculta ?? '',
      smtpOk: smtpCompleto(cfg.smtp),
      nx: { modo: 'texto', baseUrl: 'https://appapi.nxsystems.com.br', idioma: 'pt_BR', parametros: [], ...nx, temToken: Boolean(token) },
      nxOk: nxCompleto(cfg.nx),
    };
  });

  app.put<{
    Body: { smtp?: SmtpConfig; copiaOculta?: string; assunto?: string; corpo?: string; nx?: NxEnge; whatsappTexto?: string };
  }>(
    `${P}/config`,
    comAuth,
    async (req) => {
      const b = req.body ?? {};
      const atual = await lerConfigEnge();
      let smtp = atual.smtp;
      if (b.smtp) {
        smtp = {
          host: b.smtp.host?.trim() || undefined,
          port: Number(b.smtp.port) || 587,
          secure: Boolean(b.smtp.secure),
          user: b.smtp.user?.trim() || undefined,
          // Campo de senha vazio = manter a que já está salva.
          password: b.smtp.password || atual.smtp?.password,
          fromEmail: b.smtp.fromEmail?.trim() || undefined,
          fromName: b.smtp.fromName?.trim() || undefined,
        };
      }
      let nx = atual.nx;
      if (b.nx) {
        nx = {
          apiId: b.nx.apiId?.trim() || undefined,
          // Campo de token vazio = manter o que já está salvo.
          token: b.nx.token?.trim() || atual.nx?.token,
          baseUrl: b.nx.baseUrl?.trim().replace(/\/$/, '') || undefined,
          modo: b.nx.modo === 'template' ? 'template' : 'texto',
          // Template agora vem de cada modelo; o da conexão (versão antiga) só fica se a tela não mandar outro.
          template: b.nx.template !== undefined ? b.nx.template.trim() || undefined : atual.nx?.template,
          idioma: b.nx.idioma !== undefined ? b.nx.idioma.trim() || undefined : atual.nx?.idioma,
          parametros:
            b.nx.parametros !== undefined
              ? b.nx.parametros.map((p) => String(p).trim()).filter(Boolean)
              : atual.nx?.parametros,
        };
      }
      await query(
        `UPDATE ee_config SET smtp = $1, copia_oculta = COALESCE($2, copia_oculta), assunto = COALESCE($3, assunto),
                corpo = COALESCE($4, corpo), nx = $5, whatsapp_texto = COALESCE($6, whatsapp_texto), updated_at = NOW()
         WHERE id = true`,
        [
          smtp ? JSON.stringify(smtp) : null,
          b.copiaOculta ?? null,
          b.assunto ?? null,
          b.corpo ?? null,
          nx ? JSON.stringify(nx) : null,
          b.whatsappTexto ?? null,
        ],
      );
      return { ok: true, smtpOk: smtpCompleto(smtp), nxOk: nxCompleto(nx) };
    },
  );

  app.post<{ Body: { para?: string } }>(`${P}/config/teste`, comAuth, async (req, reply) => {
    const para = (req.body?.para ?? '').trim();
    if (!EMAIL_OK.test(para)) return reply.status(400).send({ message: 'Informe um e-mail válido para o teste.' });
    const cfg = await lerConfigEnge();
    if (!smtpCompleto(cfg.smtp)) return reply.status(400).send({ message: 'Preencha e salve o e-mail de envio primeiro.' });
    try {
      await sendMail({
        to: para,
        subject: 'Teste de envio — Enge Envio',
        html: montarHtml('Este é um e-mail de teste. Se chegou, os avisos de garantia vão sair por esta conta.', null),
        smtp: cfg.smtp,
      });
    } catch (err) {
      return reply.status(400).send({ message: `Não enviou: ${err instanceof Error ? err.message : 'erro no SMTP'}` });
    }
    return { ok: true };
  });

  app.post<{ Body: { numero?: string } }>(`${P}/config/teste-whatsapp`, comAuth, async (req, reply) => {
    const numeros = listaTelefones(req.body?.numero);
    if (!numeros.length) return reply.status(400).send({ message: 'Informe um número com DDD para o teste.' });
    const cfg = await lerConfigEnge();
    if (!nxCompleto(cfg.nx)) return reply.status(400).send({ message: 'Preencha e salve a conexão da NX primeiro.' });
    const dados = {
      sindico: 'Teste',
      empreendimento: 'Residencial Exemplo',
      item: 'Teste de envio',
      prazo: null,
      construtora: 'Construtora Exemplo',
      vencimento: new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10),
      enviadoEm: new Date().toISOString().slice(0, 10),
      link: linkCiente(cfg, 'exemplo'),
    };
    const texto = `Teste do Enge Envio: se esta mensagem chegou, os avisos de garantia vão sair por este WhatsApp.`;
    // No número oficial o teste manda o template do modelo padrão (texto livre não chega fora da janela de 24h).
    const r = await mandarWhatsApp(cfg.nx!, numeros.slice(0, 1), texto, dados, await textosDoAviso(cfg, null));
    if (!r.ok.length) return reply.status(400).send({ message: `Não enviou: ${r.falhas.join(' | ')}` });
    return { ok: true };
  });

  // Pré-visualização do e-mail com o modelo digitado (ainda não salvo) e um item de verdade.
  app.post<{ Body: { assunto?: string; corpo?: string; whatsappTexto?: string; modeloId?: string; garantiaId?: string; data?: string } }>(
    `${P}/previa`,
    comAuth,
    async (req) => {
      const cfg = await lerConfigEnge();
      const g = req.body?.garantiaId
        ? await queryOne<{ item: string; prazo: string | null; vencimento: string; empreendimento: string; sindico: string | null; construtora: string | null }>(
            `SELECT g.item, g.prazo, to_char(g.vencimento, 'YYYY-MM-DD') AS vencimento, m.nome AS empreendimento,
                    m.sindico, m.construtora
             FROM ee_garantias g JOIN ee_empreendimentos m ON m.id = g.empreendimento_id WHERE g.id = $1`,
            [req.body.garantiaId],
          )
        : null;
      const hoje = new Date().toISOString().slice(0, 10);
      const dados = g ?? {
        item: 'Impermeabilização',
        prazo: '3 anos',
        vencimento: new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10),
        empreendimento: 'Residencial Exemplo',
        sindico: 'Nome do Síndico',
        construtora: 'Construtora Exemplo',
      };
      const enviadoEm = req.body?.data && DATA_OK.test(req.body.data.slice(0, 10)) ? req.body.data.slice(0, 10) : hoje;
      const link = linkCiente(cfg, 'exemplo');
      const comData = { ...dados, enviadoEm, link };
      // O que vier digitado (modelo ainda não salvo) vale por cima do modelo salvo.
      const base = await textosDoAviso(cfg, req.body?.modeloId || null);
      const assunto = preencher(req.body?.assunto?.trim() || base.assunto, comData);
      const corpo = preencher(req.body?.corpo?.trim() || base.corpo, comData);
      const whatsapp = preencher(req.body?.whatsappTexto?.trim() || base.whatsapp, comData);
      return { assunto, html: montarHtml(corpo, link), whatsapp };
    },
  );

  // ── Modelos de mensagem ────────────────────────────────────────────────────────────
  const SELECT_MOD = `id, nome, assunto, corpo, whatsapp_texto AS "whatsappTexto", whatsapp_template AS "whatsappTemplate",
                      whatsapp_idioma AS "whatsappIdioma", whatsapp_parametros AS "whatsappParametros", padrao, ordem`;
  interface ModeloBody {
    nome?: string;
    assunto?: string;
    corpo?: string;
    whatsappTexto?: string;
    whatsappTemplate?: string | null;
    whatsappIdioma?: string | null;
    whatsappParametros?: string[];
  }
  const modParams = (b: ModeloBody) => [
    b.nome?.trim(),
    b.assunto ?? '',
    b.corpo ?? '',
    b.whatsappTexto ?? '',
    b.whatsappTemplate?.trim() || null,
    b.whatsappIdioma?.trim() || null,
    JSON.stringify((b.whatsappParametros ?? []).map((p) => String(p).trim()).filter(Boolean)),
  ];

  app.get(`${P}/modelos`, comAuth, async () => {
    await garantirPadroes();
    return query(`SELECT ${SELECT_MOD} FROM ee_modelos ORDER BY padrao DESC, ordem, created_at`);
  });

  app.post<{ Body: ModeloBody }>(`${P}/modelos`, comAuth, async (req, reply) => {
    if (!req.body?.nome?.trim()) return reply.status(400).send({ message: 'Dê um nome ao modelo.' });
    const temPadrao = await queryOne('SELECT 1 FROM ee_modelos WHERE padrao LIMIT 1');
    const m = await queryOne(
      `INSERT INTO ee_modelos (nome, assunto, corpo, whatsapp_texto, whatsapp_template, whatsapp_idioma, whatsapp_parametros, padrao, ordem)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,(SELECT COALESCE(MAX(ordem),0)+1 FROM ee_modelos)) RETURNING ${SELECT_MOD}`,
      [...modParams(req.body), !temPadrao],
    );
    return reply.status(201).send(m);
  });

  app.put<{ Params: { id: string }; Body: ModeloBody }>(`${P}/modelos/:id`, comAuth, async (req, reply) => {
    if (!req.body?.nome?.trim()) return reply.status(400).send({ message: 'Dê um nome ao modelo.' });
    const m = await queryOne(
      `UPDATE ee_modelos SET nome=$2, assunto=$3, corpo=$4, whatsapp_texto=$5, whatsapp_template=$6, whatsapp_idioma=$7,
              whatsapp_parametros=$8, updated_at=NOW()
       WHERE id=$1 RETURNING ${SELECT_MOD}`,
      [req.params.id, ...modParams(req.body)],
    );
    if (!m) return reply.status(404).send({ message: 'Modelo não encontrado.' });
    return m;
  });

  app.post<{ Params: { id: string } }>(`${P}/modelos/:id/padrao`, comAuth, async (req) => {
    await query('UPDATE ee_modelos SET padrao = (id = $1)', [req.params.id]);
    return { ok: true };
  });

  // Avisos que usavam o modelo apagado passam a usar o padrão (FK com ON DELETE SET NULL).
  app.delete<{ Params: { id: string } }>(`${P}/modelos/:id`, comAuth, async (req, reply) => {
    const m = await queryOne<{ padrao: boolean }>('SELECT padrao FROM ee_modelos WHERE id = $1', [req.params.id]);
    if (!m) return { ok: true };
    if (m.padrao) return reply.status(400).send({ message: 'Este é o modelo padrão. Escolha outro como padrão antes de apagar.' });
    await withTransaction(async (c) => {
      // Etapas de régua que usavam o modelo passam a usar o padrão.
      await c.query(
        `UPDATE ee_reguas SET etapas = (
           SELECT jsonb_agg(CASE WHEN e->>'modeloId' = $1 THEN jsonb_set(e, '{modeloId}', 'null') ELSE e END)
           FROM jsonb_array_elements(etapas) e)
         WHERE etapas @> jsonb_build_array(jsonb_build_object('modeloId', $1::text))`,
        [req.params.id],
      );
      await c.query('DELETE FROM ee_modelos WHERE id = $1', [req.params.id]);
    });
    return { ok: true };
  });

  // ── Réguas de envio ────────────────────────────────────────────────────────────────
  const SELECT_REG = `id, nome, etapas, padrao, ordem`;
  const lerEtapas = (etapas: unknown): EtapaRegua[] =>
    (Array.isArray(etapas) ? etapas : []).slice(0, 30).map((e, i) => normalizarEtapa(e as Partial<EtapaRegua>, i));

  app.get(`${P}/reguas`, comAuth, async () => {
    await garantirPadroes();
    return query(`SELECT ${SELECT_REG} FROM ee_reguas ORDER BY padrao DESC, ordem, created_at`);
  });

  app.post<{ Body: { nome?: string; etapas?: unknown[] } }>(`${P}/reguas`, comAuth, async (req, reply) => {
    if (!req.body?.nome?.trim()) return reply.status(400).send({ message: 'Dê um nome à régua.' });
    const temPadrao = await queryOne('SELECT 1 FROM ee_reguas WHERE padrao LIMIT 1');
    const r = await queryOne(
      `INSERT INTO ee_reguas (nome, etapas, padrao, ordem) VALUES ($1,$2,$3,(SELECT COALESCE(MAX(ordem),0)+1 FROM ee_reguas))
       RETURNING ${SELECT_REG}`,
      [req.body.nome.trim(), JSON.stringify(lerEtapas(req.body.etapas)), !temPadrao],
    );
    return reply.status(201).send(r);
  });

  app.put<{ Params: { id: string }; Body: { nome?: string; etapas?: unknown[] } }>(`${P}/reguas/:id`, comAuth, async (req, reply) => {
    if (!req.body?.nome?.trim()) return reply.status(400).send({ message: 'Dê um nome à régua.' });
    const r = await queryOne(
      `UPDATE ee_reguas SET nome=$2, etapas=$3, updated_at=NOW() WHERE id=$1 RETURNING ${SELECT_REG}`,
      [req.params.id, req.body.nome.trim(), JSON.stringify(lerEtapas(req.body.etapas))],
    );
    if (!r) return reply.status(404).send({ message: 'Régua não encontrada.' });
    return r;
  });

  app.post<{ Params: { id: string } }>(`${P}/reguas/:id/padrao`, comAuth, async (req) => {
    await query('UPDATE ee_reguas SET padrao = (id = $1)', [req.params.id]);
    return { ok: true };
  });

  app.delete<{ Params: { id: string } }>(`${P}/reguas/:id`, comAuth, async (req) => {
    await query('DELETE FROM ee_reguas WHERE id = $1', [req.params.id]);
    return { ok: true };
  });

  // ── Empreendimentos ────────────────────────────────────────────────────────────────
  app.get(`${P}/empreendimentos`, comAuth, async () =>
    query(`SELECT ${SELECT_EMP} FROM ee_empreendimentos ORDER BY nome`),
  );

  interface EmpBody {
    nome?: string;
    cidade?: string;
    entrega?: string | null;
    sindico?: string;
    emails?: string;
    telefone?: string;
    construtora?: string;
    observacoes?: string;
  }
  const empParams = (b: EmpBody) => [
    b.nome?.trim(),
    b.cidade?.trim() || null,
    b.entrega && DATA_OK.test(b.entrega) ? b.entrega : null,
    b.sindico?.trim() || null,
    b.emails?.trim() || null,
    b.telefone?.trim() || null,
    b.construtora?.trim() || null,
    b.observacoes?.trim() || null,
  ];

  /**
   * Cria o empreendimento já com as garantias e os avisos de cada uma (a tela monta a lista a
   * partir do modelo padrão e da data de entrega; cada aviso tem o dia/hora escolhido).
   */
  app.post<{
    Body: EmpBody & { canais?: Canais; garantias?: Array<{ item?: string; prazo?: string; vencimento?: string; envios?: EnvioPedido[] }> };
  }>(`${P}/empreendimentos`, comAuth, async (req, reply) => {
    const b = req.body ?? {};
    if (!b.nome?.trim()) return reply.status(400).send({ message: 'Dê um nome ao empreendimento.' });
    const canais = lerCanais(b.canais);
    if (!canais.email && !canais.whatsapp) return reply.status(400).send({ message: 'Escolha pelo menos um canal (e-mail ou WhatsApp).' });
    const garantias = (b.garantias ?? []).filter((g) => g.item?.trim() && g.vencimento && DATA_OK.test(g.vencimento));
    const emp = await withTransaction(async (c) => {
      const { rows } = await c.query(
        `INSERT INTO ee_empreendimentos (nome, cidade, entrega, sindico, emails, telefone, construtora, observacoes)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING ${SELECT_EMP}`,
        empParams(b),
      );
      for (const g of garantias) {
        const { rows: gr } = await c.query<{ id: string }>(
          `INSERT INTO ee_garantias (empreendimento_id, item, prazo, vencimento) VALUES ($1,$2,$3,$4) RETURNING id`,
          [rows[0].id, g.item!.trim(), g.prazo?.trim() || null, g.vencimento],
        );
        await inserirEnvios(c, gr[0].id, normalizarEnvios(g.envios, canais));
      }
      return rows[0];
    });
    return reply.status(201).send(emp);
  });

  app.put<{ Params: { id: string }; Body: EmpBody }>(`${P}/empreendimentos/:id`, comAuth, async (req, reply) => {
    if (!req.body?.nome?.trim()) return reply.status(400).send({ message: 'Dê um nome ao empreendimento.' });
    const emp = await queryOne(
      `UPDATE ee_empreendimentos SET nome=$2, cidade=$3, entrega=$4, sindico=$5, emails=$6, telefone=$7,
              construtora=$8, observacoes=$9, updated_at=NOW()
       WHERE id=$1 RETURNING ${SELECT_EMP}`,
      [req.params.id, ...empParams(req.body)],
    );
    if (!emp) return reply.status(404).send({ message: 'Empreendimento não encontrado.' });
    return emp;
  });

  app.delete<{ Params: { id: string } }>(`${P}/empreendimentos/:id`, comAuth, async (req) => {
    await query('DELETE FROM ee_empreendimentos WHERE id = $1', [req.params.id]);
    return { ok: true };
  });

  // Tudo de uma vez (empreendimentos, garantias, avisos) — é pouco dado e o painel cruza os três.
  app.get(`${P}/tudo`, comAuth, async () => {
    const [empreendimentos, garantias, envios] = await Promise.all([
      query(`SELECT ${SELECT_EMP} FROM ee_empreendimentos ORDER BY nome`),
      query(`SELECT ${SELECT_GAR} FROM ee_garantias g ORDER BY g.vencimento`),
      query(`SELECT ${SELECT_ENV} FROM ee_envios v ORDER BY v.enviar_em`),
    ]);
    return { empreendimentos, garantias, envios };
  });

  // ── Garantias ──────────────────────────────────────────────────────────────────────
  app.post<{ Params: { id: string }; Body: { item?: string; prazo?: string; vencimento?: string; envios?: EnvioPedido[]; canais?: Canais } }>(
    `${P}/empreendimentos/:id/garantias`,
    comAuth,
    async (req, reply) => {
      const b = req.body ?? {};
      if (!b.item?.trim()) return reply.status(400).send({ message: 'Informe o item da garantia.' });
      if (!b.vencimento || !DATA_OK.test(b.vencimento)) return reply.status(400).send({ message: 'Informe a data de vencimento.' });
      const canais = lerCanais(b.canais);
      if (!canais.email && !canais.whatsapp) return reply.status(400).send({ message: 'Escolha pelo menos um canal (e-mail ou WhatsApp).' });
      const g = await withTransaction(async (c) => {
        const { rows } = await c.query<{ id: string }>(
          `INSERT INTO ee_garantias (empreendimento_id, item, prazo, vencimento) VALUES ($1,$2,$3,$4) RETURNING id`,
          [req.params.id, b.item!.trim(), b.prazo?.trim() || null, b.vencimento],
        );
        await inserirEnvios(c, rows[0].id, normalizarEnvios(b.envios, canais));
        return rows[0];
      });
      return reply.status(201).send(g);
    },
  );

  app.put<{
    Params: { id: string };
    Body: { item?: string; prazo?: string; vencimento?: string; chamadoEm?: string | null; chamadoProtocolo?: string | null; cancelarPendentes?: boolean };
  }>(`${P}/garantias/:id`, comAuth, async (req, reply) => {
    const b = req.body ?? {};
    const atual = await queryOne<{ id: string }>('SELECT id FROM ee_garantias WHERE id = $1', [req.params.id]);
    if (!atual) return reply.status(404).send({ message: 'Garantia não encontrada.' });
    await query(
      `UPDATE ee_garantias SET
         item = COALESCE($2, item),
         prazo = CASE WHEN $3::text IS NULL THEN prazo ELSE NULLIF($3, '') END,
         vencimento = COALESCE($4::date, vencimento),
         chamado_em = CASE WHEN $5 THEN $6::date ELSE chamado_em END,
         chamado_protocolo = CASE WHEN $5 THEN $7 ELSE chamado_protocolo END
       WHERE id = $1`,
      [
        req.params.id,
        b.item?.trim() || null,
        b.prazo ?? null,
        b.vencimento && DATA_OK.test(b.vencimento) ? b.vencimento : null,
        'chamadoEm' in b,
        b.chamadoEm && DATA_OK.test(b.chamadoEm) ? b.chamadoEm : null,
        b.chamadoProtocolo?.trim() || null,
      ],
    );
    if (b.cancelarPendentes) {
      await query(`UPDATE ee_envios SET status = 'cancelado' WHERE garantia_id = $1 AND status IN ('agendado','erro')`, [req.params.id]);
    }
    return { ok: true };
  });

  app.delete<{ Params: { id: string } }>(`${P}/garantias/:id`, comAuth, async (req) => {
    await query('DELETE FROM ee_garantias WHERE id = $1', [req.params.id]);
    return { ok: true };
  });

  // ── Avisos (envios) ────────────────────────────────────────────────────────────────
  app.post<{ Params: { id: string }; Body: { enviarEm?: string; modeloId?: string | null } & Canais }>(`${P}/garantias/:id/envios`, comAuth, async (req, reply) => {
    const quando = paraTimestamp(req.body?.enviarEm);
    if (!quando) return reply.status(400).send({ message: 'Escolha o dia do envio.' });
    const canais = lerCanais(req.body);
    if (!canais.email && !canais.whatsapp) return reply.status(400).send({ message: 'Escolha pelo menos um canal (e-mail ou WhatsApp).' });
    const env = await queryOne(
      `INSERT INTO ee_envios (garantia_id, enviar_em, token, canal_email, canal_whatsapp, modelo_id)
       VALUES ($1,$2,$3,$4,$5,${MODELO_OU_NULL('$6')}) RETURNING id`,
      [req.params.id, quando, novoToken(), canais.email, canais.whatsapp, req.body?.modeloId || null],
    );
    return reply.status(201).send(env);
  });

  // Vários avisos de uma vez numa garantia que já existe (aplicar uma régua).
  app.post<{ Params: { id: string }; Body: { envios?: EnvioPedido[] } }>(`${P}/garantias/:id/envios/lote`, comAuth, async (req, reply) => {
    const envios = normalizarEnvios(req.body?.envios, { email: true, whatsapp: false });
    if (!envios.length) return reply.status(400).send({ message: 'Nenhum aviso para agendar (as datas da régua já passaram?).' });
    await withTransaction((c) => inserirEnvios(c, req.params.id, envios));
    return reply.status(201).send({ criados: envios.length });
  });

  // Remarcar: muda o dia/hora (e os canais). Um aviso com erro volta pra fila — e no próximo envio
  // só sai o canal que ainda não tinha saído.
  app.put<{ Params: { id: string }; Body: { enviarEm?: string; modeloId?: string | null } & Canais }>(`${P}/envios/:id`, comAuth, async (req, reply) => {
    const quando = paraTimestamp(req.body?.enviarEm);
    if (!quando) return reply.status(400).send({ message: 'Escolha o dia do envio.' });
    if (req.body?.email === false && req.body?.whatsapp === false) {
      return reply.status(400).send({ message: 'Escolha pelo menos um canal (e-mail ou WhatsApp).' });
    }
    const env = await queryOne(
      `UPDATE ee_envios SET enviar_em = $2, status = 'agendado', erro = NULL, whatsapp_erro = NULL,
              canal_email = COALESCE($3, canal_email), canal_whatsapp = COALESCE($4, canal_whatsapp),
              modelo_id = CASE WHEN $5 THEN ${MODELO_OU_NULL('$6')} ELSE modelo_id END
       WHERE id = $1 AND status IN ('agendado','erro','cancelado') RETURNING id`,
      [req.params.id, quando, req.body?.email ?? null, req.body?.whatsapp ?? null, 'modeloId' in (req.body ?? {}), req.body?.modeloId || null],
    );
    if (!env) return reply.status(400).send({ message: 'Este aviso já foi enviado — agende um novo.' });
    return env;
  });

  app.post<{ Params: { id: string } }>(`${P}/envios/:id/cancelar`, comAuth, async (req, reply) => {
    const env = await queryOne(
      `UPDATE ee_envios SET status = 'cancelado' WHERE id = $1 AND status IN ('agendado','erro') RETURNING id`,
      [req.params.id],
    );
    if (!env) return reply.status(400).send({ message: 'Só dá pra cancelar aviso que ainda não saiu.' });
    return { ok: true };
  });

  app.post<{ Params: { id: string } }>(`${P}/envios/:id/enviar-agora`, comAuth, async (req, reply) => {
    const erro = await enviarAviso(req.params.id);
    if (erro) return reply.status(400).send({ message: erro });
    return { ok: true };
  });

  // O e-mail exatamente como saiu (comprovante).
  app.get<{ Params: { id: string } }>(`${P}/envios/:id`, comAuth, async (req, reply) => {
    const env = await queryOne<{ corpo: string | null; token: string; ciente_ip: string | null; whatsapp_texto: string | null }>(
      `SELECT ${SELECT_ENV}, v.corpo, v.token, v.ciente_ip, v.whatsapp_texto FROM ee_envios v WHERE v.id = $1`,
      [req.params.id],
    );
    if (!env) return reply.status(404).send({ message: 'Aviso não encontrado.' });
    const cfg = await lerConfigEnge();
    const { token, ciente_ip, whatsapp_texto, ...resto } = env;
    return {
      ...resto,
      cienteIp: ciente_ip,
      whatsappTexto: whatsapp_texto,
      html: env.corpo ? montarHtml(env.corpo, linkCiente(cfg, token)) : null,
    };
  });

  // ── "Estou ciente" (público, sem login — é o síndico clicando no e-mail) ─────────────
  // Abrir o link NÃO marca nada (leitores de e-mail costumam abrir links sozinhos pra checar
  // segurança); só o botão da página, que faz o POST abaixo.
  app.get<{ Params: { token: string } }>(`${P}/ciente/:token`, async (req, reply) => {
    const e = await queryOne(
      `SELECT g.item, to_char(g.vencimento, 'YYYY-MM-DD') AS vencimento, m.nome AS empreendimento,
              COALESCE(v.enviado_em, v.whatsapp_enviado_em) AS "enviadoEm",
              v.ciente_em AS "cienteEm", v.ciente_nome AS "cienteNome"
       FROM ee_envios v JOIN ee_garantias g ON g.id = v.garantia_id JOIN ee_empreendimentos m ON m.id = g.empreendimento_id
       WHERE v.token = $1 AND ${JA_SAIU}`,
      [req.params.token],
    );
    if (!e) return reply.status(404).send({ message: 'Aviso não encontrado.' });
    return e;
  });

  app.post<{ Params: { token: string }; Body: { nome?: string } }>(`${P}/ciente/:token`, async (req, reply) => {
    const nome = (req.body?.nome ?? '').trim().slice(0, 120);
    if (!nome) return reply.status(400).send({ message: 'Informe seu nome para confirmar.' });
    const e = await queryOne(
      `UPDATE ee_envios v SET ciente_em = COALESCE(ciente_em, NOW()), ciente_nome = COALESCE(ciente_nome, $2),
              ciente_ip = COALESCE(ciente_ip, $3)
       WHERE token = $1 AND ${JA_SAIU}
       RETURNING ciente_em AS "cienteEm", ciente_nome AS "cienteNome"`,
      [req.params.token, nome, req.ip],
    );
    if (!e) return reply.status(404).send({ message: 'Aviso não encontrado.' });
    return e;
  });
}
