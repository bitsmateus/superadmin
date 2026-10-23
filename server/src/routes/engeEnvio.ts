import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { randomBytes } from 'node:crypto';
import bcrypt from 'bcrypt';
import { query, queryOne, withTransaction } from '../db.js';
import { sendMail, type SmtpConfig } from '../lib/mailer.js';
import { ASSUNTO_PADRAO, CORPO_PADRAO, montarHtml, preencher } from '../lib/engeEnvio.js';
import { enviarAviso, lerConfigEnge, linkCiente, smtpCompleto } from '../jobs/engeEnvioDispatch.js';

/**
 * Enge Services (/engeenvio) — avisos de garantia dos empreendimentos que a Enge administra.
 *
 * LOGIN PRÓPRIO (e-mail + senha só desta ferramenta), no mesmo molde do açougue: o token é o JWT
 * do app carimbado com `scope: 'engeenvio'`, e `app.authenticate` (painel) recusa qualquer token
 * com `scope` — um login não vira o outro.
 *
 * O envio em si fica em jobs/engeEnvioDispatch.ts (a cada minuto manda o que já chegou na data).
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
                    v.ciente_nome AS "cienteNome"`;

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

  // ── Configurações (SMTP e modelo do e-mail) ───────────────────────────────────────
  app.get(`${P}/config`, comAuth, async () => {
    const cfg = await lerConfigEnge();
    // A senha do SMTP nunca volta pra tela — só se existe.
    const { password, ...smtp } = cfg.smtp ?? {};
    return {
      smtp: { ...smtp, temSenha: Boolean(password) },
      copiaOculta: cfg.copia_oculta ?? '',
      assunto: cfg.assunto?.trim() || ASSUNTO_PADRAO,
      corpo: cfg.corpo?.trim() || CORPO_PADRAO,
      smtpOk: smtpCompleto(cfg.smtp),
    };
  });

  app.put<{ Body: { smtp?: SmtpConfig; copiaOculta?: string; assunto?: string; corpo?: string } }>(
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
      await query(
        `UPDATE ee_config SET smtp = $1, copia_oculta = COALESCE($2, copia_oculta), assunto = COALESCE($3, assunto),
                corpo = COALESCE($4, corpo), updated_at = NOW() WHERE id = true`,
        [smtp ? JSON.stringify(smtp) : null, b.copiaOculta ?? null, b.assunto ?? null, b.corpo ?? null],
      );
      return { ok: true, smtpOk: smtpCompleto(smtp) };
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

  // Pré-visualização do e-mail com o modelo digitado (ainda não salvo) e um item de verdade.
  app.post<{ Body: { assunto?: string; corpo?: string; garantiaId?: string; data?: string } }>(
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
      const assunto = preencher(req.body?.assunto?.trim() || cfg.assunto?.trim() || ASSUNTO_PADRAO, { ...dados, enviadoEm });
      const corpo = preencher(req.body?.corpo?.trim() || cfg.corpo?.trim() || CORPO_PADRAO, { ...dados, enviadoEm });
      return { assunto, html: montarHtml(corpo, linkCiente(cfg, 'exemplo')) };
    },
  );

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
    Body: EmpBody & { garantias?: Array<{ item?: string; prazo?: string; vencimento?: string; envios?: string[] }> };
  }>(`${P}/empreendimentos`, comAuth, async (req, reply) => {
    const b = req.body ?? {};
    if (!b.nome?.trim()) return reply.status(400).send({ message: 'Dê um nome ao empreendimento.' });
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
        for (const quando of (g.envios ?? []).map(paraTimestamp).filter(Boolean)) {
          await c.query(`INSERT INTO ee_envios (garantia_id, enviar_em, token) VALUES ($1,$2,$3)`, [gr[0].id, quando, novoToken()]);
        }
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
  app.post<{ Params: { id: string }; Body: { item?: string; prazo?: string; vencimento?: string; envios?: string[] } }>(
    `${P}/empreendimentos/:id/garantias`,
    comAuth,
    async (req, reply) => {
      const b = req.body ?? {};
      if (!b.item?.trim()) return reply.status(400).send({ message: 'Informe o item da garantia.' });
      if (!b.vencimento || !DATA_OK.test(b.vencimento)) return reply.status(400).send({ message: 'Informe a data de vencimento.' });
      const g = await withTransaction(async (c) => {
        const { rows } = await c.query<{ id: string }>(
          `INSERT INTO ee_garantias (empreendimento_id, item, prazo, vencimento) VALUES ($1,$2,$3,$4) RETURNING id`,
          [req.params.id, b.item!.trim(), b.prazo?.trim() || null, b.vencimento],
        );
        for (const quando of (b.envios ?? []).map(paraTimestamp).filter(Boolean)) {
          await c.query(`INSERT INTO ee_envios (garantia_id, enviar_em, token) VALUES ($1,$2,$3)`, [rows[0].id, quando, novoToken()]);
        }
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
  app.post<{ Params: { id: string }; Body: { enviarEm?: string } }>(`${P}/garantias/:id/envios`, comAuth, async (req, reply) => {
    const quando = paraTimestamp(req.body?.enviarEm);
    if (!quando) return reply.status(400).send({ message: 'Escolha o dia do envio.' });
    const env = await queryOne(
      `INSERT INTO ee_envios (garantia_id, enviar_em, token) VALUES ($1,$2,$3) RETURNING id`,
      [req.params.id, quando, novoToken()],
    );
    return reply.status(201).send(env);
  });

  // Remarcar: muda o dia/hora. Um aviso com erro volta pra fila.
  app.put<{ Params: { id: string }; Body: { enviarEm?: string } }>(`${P}/envios/:id`, comAuth, async (req, reply) => {
    const quando = paraTimestamp(req.body?.enviarEm);
    if (!quando) return reply.status(400).send({ message: 'Escolha o dia do envio.' });
    const env = await queryOne(
      `UPDATE ee_envios SET enviar_em = $2, status = 'agendado', erro = NULL
       WHERE id = $1 AND status IN ('agendado','erro','cancelado') RETURNING id`,
      [req.params.id, quando],
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
    const env = await queryOne<{ corpo: string | null; token: string; ciente_ip: string | null }>(
      `SELECT ${SELECT_ENV}, v.corpo, v.token, v.ciente_ip FROM ee_envios v WHERE v.id = $1`,
      [req.params.id],
    );
    if (!env) return reply.status(404).send({ message: 'Aviso não encontrado.' });
    const cfg = await lerConfigEnge();
    const { token, ...resto } = env;
    return { ...resto, cienteIp: env.ciente_ip, html: env.corpo ? montarHtml(env.corpo, linkCiente(cfg, token)) : null };
  });

  // ── "Estou ciente" (público, sem login — é o síndico clicando no e-mail) ─────────────
  // Abrir o link NÃO marca nada (leitores de e-mail costumam abrir links sozinhos pra checar
  // segurança); só o botão da página, que faz o POST abaixo.
  app.get<{ Params: { token: string } }>(`${P}/ciente/:token`, async (req, reply) => {
    const e = await queryOne(
      `SELECT g.item, to_char(g.vencimento, 'YYYY-MM-DD') AS vencimento, m.nome AS empreendimento,
              v.enviado_em AS "enviadoEm", v.ciente_em AS "cienteEm", v.ciente_nome AS "cienteNome"
       FROM ee_envios v JOIN ee_garantias g ON g.id = v.garantia_id JOIN ee_empreendimentos m ON m.id = g.empreendimento_id
       WHERE v.token = $1 AND v.status = 'enviado'`,
      [req.params.token],
    );
    if (!e) return reply.status(404).send({ message: 'Aviso não encontrado.' });
    return e;
  });

  app.post<{ Params: { token: string }; Body: { nome?: string } }>(`${P}/ciente/:token`, async (req, reply) => {
    const nome = (req.body?.nome ?? '').trim().slice(0, 120);
    if (!nome) return reply.status(400).send({ message: 'Informe seu nome para confirmar.' });
    const e = await queryOne(
      `UPDATE ee_envios SET ciente_em = COALESCE(ciente_em, NOW()), ciente_nome = COALESCE(ciente_nome, $2),
              ciente_ip = COALESCE(ciente_ip, $3)
       WHERE token = $1 AND status = 'enviado'
       RETURNING ciente_em AS "cienteEm", ciente_nome AS "cienteNome"`,
      [req.params.token, nome, req.ip],
    );
    if (!e) return reply.status(404).send({ message: 'Aviso não encontrado.' });
    return e;
  });
}
