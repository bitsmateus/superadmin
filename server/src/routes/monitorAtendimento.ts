import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { query, queryOne } from '../db.js';
import { temMarcaDeMenu } from '../lib/acessoMenu.js';
import {
  carregarConfig, inicioDeHoje, linkDoTicket, mandarNoGrupo, montarResumo, ranking, registrarEvento, rodarCiclo, salvarConfig,
  ultimoCiclo, type LinhaTicket,
} from '../lib/atendimento/monitor.js';
import { atualizarTicket, enviarNoTicket, listarFilas, listarUsuarios, resolverCredencial } from '../lib/atendimento/nxApi.js';
import { iaDisponivel } from '../lib/atendimento/ia.js';
import { CONFIG_PADRAO, ROTULO_SITUACAO, type ConfigMonitor } from '../lib/atendimento/regras.js';

/**
 * Monitor de Atendimento (Suporte › Monitor de Atendimento). Ver lib/atendimento/monitor.ts.
 * Ver e agir nos tickets segue a marca de menu "monitor_atendimento"; mudar a configuração é de
 * administrador/supervisor.
 */

type Usuario = { sub: string; role?: string; email?: string; name?: string };
const MARCA = 'monitor_atendimento';

async function podeVer(req: FastifyRequest, reply: FastifyReply): Promise<boolean> {
  const u = req.user as Usuario;
  if (await temMarcaDeMenu(u.sub, u.role, MARCA)) return true;
  reply.status(403).send({ message: 'Acesso negado' });
  return false;
}

function podeConfigurar(req: FastifyRequest, reply: FastifyReply): boolean {
  const role = (req.user as Usuario).role;
  if (role === 'admin' || role === 'supervisor') return true;
  reply.status(403).send({ message: 'Só administrador ou supervisor muda a configuração do monitor' });
  return false;
}

async function autor(req: FastifyRequest): Promise<string> {
  const u = req.user as Usuario;
  const p = await queryOne<{ full_name: string | null; email: string | null }>('SELECT name AS full_name, email FROM profiles WHERE id = $1', [u.sub]).catch(
    () => null,
  );
  return p?.full_name || p?.email || u.email || 'painel';
}

/** A config que vai para a tela: sem o token (só diz se tem um salvo). */
function configPublica(cfg: ConfigMonitor) {
  return { ...cfg, credencial: { apiId: cfg.credencial.apiId, baseUrl: cfg.credencial.baseUrl, token: '', tokenSalvo: !!cfg.credencial.token } };
}

const iso = (d: Date | null) => (d ? new Date(d).toISOString() : null);

function ticketParaTela(cfg: ConfigMonitor, r: LinhaTicket & { cliente_nome?: string | null }) {
  return {
    id: Number(r.ticket_id),
    link: linkDoTicket(cfg, r.ticket_id),
    status: r.status,
    atendenteId: r.user_id ? Number(r.user_id) : null,
    atendente: r.user_name,
    filaId: r.queue_id ? Number(r.queue_id) : null,
    fila: r.queue_name,
    grupo: r.is_group,
    contato: r.contato_nome,
    numero: r.contato_numero,
    clienteId: r.client_id,
    cliente: r.cliente_nome ?? null,
    situacao: r.situacao,
    situacaoRotulo: ROTULO_SITUACAO[r.situacao] ?? r.situacao,
    desde: iso(r.situacao_desde),
    decorridoMin: r.decorrido_min,
    prazoMin: r.prazo_min,
    nivel: r.nivel,
    abertoLongo: r.aberto_longo && !r.is_group,
    abertoEm: iso(r.nx_created_at),
    ultimaDe: r.ultima_de,
    ultimaAt: iso(r.ultima_at),
    textoAtendente: r.ultimo_texto_atendente,
    textoCliente: r.ultimo_texto_cliente,
    classeIa: r.classe_ia,
    primeiraRespostaMin: r.primeira_resposta_min,
    alertaNivel: r.alerta_nivel,
    alertaEm: iso(r.alerta_em),
    followupEm: iso(r.followup_em),
    ignorado: r.ignorado,
    erro: r.erro,
  };
}

async function linhaDoTicket(id: string): Promise<LinhaTicket | null> {
  return queryOne<LinhaTicket>('SELECT * FROM atd_tickets WHERE ticket_id = $1', [id]);
}

export async function monitorAtendimentoRoutes(app: FastifyInstance) {
  app.get('/api/atendimento-monitor', { onRequest: [app.authenticate] }, async (req, reply) => {
    if (!(await podeVer(req, reply))) return;
    const cfg = await carregarConfig();
    const rows = await query<LinhaTicket & { cliente_nome: string | null }>(
      `SELECT t.*, COALESCE(c.company, c.name) AS cliente_nome
       FROM atd_tickets t LEFT JOIN clients c ON c.id = t.client_id
       WHERE t.closed_at IS NULL
       ORDER BY t.nivel DESC, (t.decorrido_min::float / GREATEST(t.prazo_min, 1)) DESC`,
    );
    const ativos = rows.filter((r) => !r.ignorado);
    const contagens: Record<string, { total: number; foraDoPrazo: number; escalados: number }> = {};
    for (const s of ['sem_resposta', 'promessa', 'fila', 'cliente_parou', 'ok']) contagens[s] = { total: 0, foraDoPrazo: 0, escalados: 0 };
    for (const r of ativos) {
      const c = contagens[r.situacao] ?? (contagens[r.situacao] = { total: 0, foraDoPrazo: 0, escalados: 0 });
      c.total++;
      if (r.nivel >= 1) c.foraDoPrazo++;
      if (r.nivel >= 2) c.escalados++;
    }
    const hoje = inicioDeHoje();
    const semana = new Date(hoje.getTime() - 6 * 86400_000);
    const [rankHoje, rankSemana, credencial] = await Promise.all([ranking(hoje), ranking(semana), resolverCredencial(cfg)]);
    const grupo = cfg.grupoId || String((await queryOne<{ g: string | null }>(`SELECT support_group->>'groupId' AS g FROM settings WHERE id = true`))?.g ?? '');
    return {
      config: configPublica(cfg),
      padrao: CONFIG_PADRAO,
      ciclo: ultimoCiclo,
      iaDisponivel: iaDisponivel(),
      credencialOk: !!credencial,
      grupoDestino: grupo,
      tickets: rows.map((r) => ticketParaTela(cfg, r)),
      contagens,
      abertoLongo: ativos.filter((r) => r.aberto_longo && !r.is_group).length,
      ranking: { hoje: rankHoje, semana: rankSemana },
    };
  });

  app.get<{ Querystring: { dias?: string; ticket?: string } }>('/api/atendimento-monitor/historico', { onRequest: [app.authenticate] }, async (req, reply) => {
    if (!(await podeVer(req, reply))) return;
    const dias = Math.min(60, Math.max(1, Number(req.query.dias) || 7));
    const desde = new Date(Date.now() - dias * 86400_000);
    const ticket = req.query.ticket && /^\d+$/.test(req.query.ticket) ? req.query.ticket : null;
    const rows = await query<Record<string, unknown>>(
      `SELECT e.id, e.ticket_id, e.tipo, e.situacao, e.nivel, e.user_name, e.detalhe, e.autor, e.created_at,
              t.contato_nome, t.is_group
       FROM atd_eventos e LEFT JOIN atd_tickets t ON t.ticket_id = e.ticket_id
       WHERE e.created_at >= $1 ${ticket ? 'AND e.ticket_id = $2' : ''}
       ORDER BY e.created_at DESC LIMIT 300`,
      ticket ? [desde, ticket] : [desde],
    );
    return rows.map((r) => ({ ...r, id: Number(r.id), ticket_id: Number(r.ticket_id) }));
  });

  app.put('/api/atendimento-monitor/config', { onRequest: [app.authenticate] }, async (req, reply) => {
    if (!(await podeVer(req, reply)) || !podeConfigurar(req, reply)) return;
    const cfg = await salvarConfig(req.body);
    return configPublica(cfg);
  });

  app.post('/api/atendimento-monitor/rodar', { onRequest: [app.authenticate] }, async (req, reply) => {
    if (!(await podeVer(req, reply))) return;
    return rodarCiclo({ forcar: true });
  });

  const textoDoTeste = (cfg: ConfigMonitor) => {
    const itens = [
      ...cfg.avisos.situacoes.map((x) => ROTULO_SITUACAO[x]),
      ...(cfg.avisos.abertoLongo ? [`abertos há mais de ${cfg.prazos.abertoDias} dias`] : []),
      ...(cfg.avisos.resumo && cfg.resumoHora ? [`o resumo das ${cfg.resumoHora}`] : []),
      ...(cfg.avisos.carga.ativo ? [`abertos/pendentes por atendente quando passar de ${cfg.avisos.carga.limite}`] : []),
    ];
    return `✅ *Monitor de Atendimento* — teste\n${
      itens.length ? `Vão chegar neste grupo: ${itens.join(', ')}. O resto fica só no painel.` : 'Nenhum aviso ligado: tudo fica só no painel.'
    }`;
  };

  app.post('/api/atendimento-monitor/teste-grupo', { onRequest: [app.authenticate] }, async (req, reply) => {
    if (!(await podeVer(req, reply)) || !podeConfigurar(req, reply)) return;
    const cfg = await carregarConfig();
    const r = await mandarNoGrupo(
      cfg,
      textoDoTeste(cfg),
    );
    if (!r.ok) return reply.status(400).send({ message: r.reason === 'not_configured' ? 'Grupo do suporte não configurado (Configurações › Grupo de suporte).' : `Falhou: ${r.status ?? ''} ${r.detail ?? ''}`.trim() });
    return { ok: true };
  });

  app.post<{ Body: { enviar?: boolean } }>('/api/atendimento-monitor/resumo', { onRequest: [app.authenticate] }, async (req, reply) => {
    if (!(await podeVer(req, reply))) return;
    const cfg = await carregarConfig();
    const texto = await montarResumo(cfg);
    if (req.body?.enviar) {
      if (!podeConfigurar(req, reply)) return;
      const r = await mandarNoGrupo(cfg, texto);
      if (!r.ok) return reply.status(400).send({ message: `Não consegui mandar no grupo (${r.reason ?? r.status ?? 'erro'})` });
    }
    return { texto };
  });

  app.get('/api/atendimento-monitor/nx/usuarios', { onRequest: [app.authenticate] }, async (req, reply) => {
    if (!(await podeVer(req, reply))) return;
    const cred = await resolverCredencial(await carregarConfig());
    if (!cred) return reply.status(400).send({ message: 'Sem credencial da NX' });
    try {
      return await listarUsuarios(cred);
    } catch (err) {
      return reply.status(502).send({ message: String((err as Error).message) });
    }
  });

  app.get('/api/atendimento-monitor/nx/filas', { onRequest: [app.authenticate] }, async (req, reply) => {
    if (!(await podeVer(req, reply))) return;
    const cred = await resolverCredencial(await carregarConfig());
    if (!cred) return reply.status(400).send({ message: 'Sem credencial da NX' });
    try {
      return await listarFilas(cred);
    } catch (err) {
      return reply.status(502).send({ message: String((err as Error).message) });
    }
  });

  // ── Ações no ticket ────────────────────────────────────────────────────────────────────────────────────

  app.post<{ Params: { id: string }; Body: { mensagem?: string } }>(
    '/api/atendimento-monitor/tickets/:id/finalizar',
    { onRequest: [app.authenticate] },
    async (req, reply) => {
      if (!(await podeVer(req, reply))) return;
      const r = /^\d+$/.test(req.params.id) ? await linhaDoTicket(req.params.id) : null;
      if (!r) return reply.status(404).send({ message: 'Ticket não encontrado no monitor' });
      const cfg = await carregarConfig();
      const cred = await resolverCredencial(cfg);
      if (!cred) return reply.status(400).send({ message: 'Sem credencial da NX' });
      const mensagem = (req.body?.mensagem ?? '').trim().slice(0, 2000);
      try {
        if (mensagem) await enviarNoTicket(cred, Number(r.ticket_id), mensagem, { fechar: true, externalKey: `monitor-fim-${r.ticket_id}-${Date.now()}` });
        else await atualizarTicket(cred, Number(r.ticket_id), { status: 'closed', ...(r.user_id ? { userId: Number(r.user_id) } : {}) });
      } catch (err) {
        return reply.status(502).send({ message: String((err as Error).message) });
      }
      const quem = await autor(req);
      await query(`UPDATE atd_tickets SET closed_at = NOW(), closed_by = $2, nivel = 0, updated_at = NOW() WHERE ticket_id = $1`, [r.ticket_id, `painel:${quem}`]);
      await registrarEvento({ ticketId: r.ticket_id, tipo: 'finalizado_painel', situacao: r.situacao, userId: r.user_id, userName: r.user_name, detalhe: mensagem || null, autor: quem });
      return { ok: true };
    },
  );

  app.post<{ Params: { id: string }; Body: { mensagem?: string } }>(
    '/api/atendimento-monitor/tickets/:id/followup',
    { onRequest: [app.authenticate] },
    async (req, reply) => {
      if (!(await podeVer(req, reply))) return;
      const r = /^\d+$/.test(req.params.id) ? await linhaDoTicket(req.params.id) : null;
      if (!r || r.closed_at) return reply.status(404).send({ message: 'Ticket não está aberto no monitor' });
      const cfg = await carregarConfig();
      const cred = await resolverCredencial(cfg);
      if (!cred) return reply.status(400).send({ message: 'Sem credencial da NX' });
      const mensagem = ((req.body?.mensagem ?? '').trim() || cfg.followupMensagem).slice(0, 2000);
      try {
        await enviarNoTicket(cred, Number(r.ticket_id), mensagem, { externalKey: `monitor-followup-${r.ticket_id}-${Date.now()}` });
      } catch (err) {
        return reply.status(502).send({ message: String((err as Error).message) });
      }
      const quem = await autor(req);
      await query(`UPDATE atd_tickets SET followup_em = NOW(), updated_at = NOW() WHERE ticket_id = $1`, [r.ticket_id]);
      await registrarEvento({ ticketId: r.ticket_id, tipo: 'followup', situacao: r.situacao, userId: r.user_id, userName: r.user_name, detalhe: mensagem, autor: quem });
      return { ok: true };
    },
  );

  app.post<{ Params: { id: string }; Body: { userId?: number | null; queueId?: number | null } }>(
    '/api/atendimento-monitor/tickets/:id/transferir',
    { onRequest: [app.authenticate] },
    async (req, reply) => {
      if (!(await podeVer(req, reply))) return;
      const r = /^\d+$/.test(req.params.id) ? await linhaDoTicket(req.params.id) : null;
      if (!r || r.closed_at) return reply.status(404).send({ message: 'Ticket não está aberto no monitor' });
      const userId = req.body?.userId ? Number(req.body.userId) : null;
      const queueId = req.body?.queueId ? Number(req.body.queueId) : null;
      if (!userId && !queueId) return reply.status(400).send({ message: 'Escolha o atendente ou a fila' });
      const cred = await resolverCredencial(await carregarConfig());
      if (!cred) return reply.status(400).send({ message: 'Sem credencial da NX' });
      try {
        await atualizarTicket(cred, Number(r.ticket_id), {
          status: 'open',
          ...(userId ? { userId } : {}),
          ...(queueId ? { queueId } : {}),
        });
      } catch (err) {
        return reply.status(502).send({ message: String((err as Error).message) });
      }
      const quem = await autor(req);
      await registrarEvento({
        ticketId: r.ticket_id,
        tipo: 'transferido',
        situacao: r.situacao,
        userId: r.user_id,
        userName: r.user_name,
        detalhe: [userId ? `atendente #${userId}` : '', queueId ? `fila #${queueId}` : ''].filter(Boolean).join(' · '),
        autor: quem,
      });
      // O próximo ciclo traz o novo atendente; roda já para a tela refletir.
      rodarCiclo().catch(() => undefined);
      return { ok: true };
    },
  );

  app.post<{ Params: { id: string }; Body: { ignorar?: boolean } }>(
    '/api/atendimento-monitor/tickets/:id/ignorar',
    { onRequest: [app.authenticate] },
    async (req, reply) => {
      if (!(await podeVer(req, reply)) || !podeConfigurar(req, reply)) return;
      const r = /^\d+$/.test(req.params.id) ? await linhaDoTicket(req.params.id) : null;
      if (!r) return reply.status(404).send({ message: 'Ticket não encontrado no monitor' });
      const cfg = await carregarConfig();
      const chave = (r.contato_numero ?? '').replace(/\D/g, '').length >= 8 ? String(r.contato_numero) : String(r.contato_nome ?? '').trim();
      if (!chave) return reply.status(400).send({ message: 'Este contato não tem número nem nome para ignorar' });
      const ignorar = req.body?.ignorar !== false;
      const digitos = (s: string) => s.replace(/\D/g, '');
      const lista = ignorar
        ? [...cfg.ignorar, chave]
        : cfg.ignorar.filter((i) => i !== chave && !(digitos(i).length >= 8 && digitos(i) === digitos(chave)) && i.trim().toLowerCase() !== String(r.contato_nome ?? '').trim().toLowerCase());
      await salvarConfig({ ignorar: lista });
      await query(`UPDATE atd_tickets SET ignorado = $2 WHERE ticket_id = $1`, [r.ticket_id, ignorar]);
      await registrarEvento({ ticketId: r.ticket_id, tipo: ignorar ? 'ignorado' : 'monitorado', userId: r.user_id, userName: r.user_name, autor: await autor(req) });
      return { ok: true };
    },
  );
}
