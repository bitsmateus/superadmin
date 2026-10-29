import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { query, queryOne } from '../db.js';
import { restrictedBoardFilter } from './leadBoards.js';
import { donoDaAba, primeiroNome } from '../lib/reuniaoResultado.js';
import {
  Erro3C, amostraDeCampos, clickToCall, config3C, ramalDaPessoa, telefonePara3C, get3C, gravacao3C, listarLigacoes, montarRelatorio, normalizarAgentes,
  normalizarLigacao, type AgenteAgora, type Ligacao,
} from '../lib/tresC.js';

/**
 * Ligações da 3C Plus dentro do CRM de cada pessoa (botão "Ligações" no CRM ARTHUR e no CRM LUIS CLOSER).
 * Só LEITURA: o painel nunca cria, altera nem apaga nada na 3C.
 *
 * Cada aba mostra só as ligações do dono dela: o SDR cujo nome está no nome da aba ("CRM ARTHUR" -> Arthur),
 * a mesma regra do sdrDaAba/donoDaAba. Na 3C, a ligação é do dono quando o primeiro nome do agente bate
 * ("Arthur Rosa" -> arthur). Se o nome do agente na 3C for diferente, THREEC_AGENTES liga os dois
 * ("crm-arthur=Arthur Rosa;crm-luis-closer=Luis Otavio").
 *
 * Quem vê: quem já enxerga aquela aba no CRM (o próprio dono, Ian/Mateus e quem tiver a aba liberada).
 */

const DIA = /^\d{4}-\d{2}-\d{2}$/;
/** Período máximo por consulta — mais que isso fica pesado na 3C (paginação de 100 em 100). */
const MAX_DIAS = 62;

/** Cache curto: a 3C pagina de 100 em 100 e a mesma consulta serve as duas abas. */
const cache = new Map<string, { ate: number; valor: unknown }>();
function doCache<T>(chave: string): T | undefined {
  const c = cache.get(chave);
  if (c && c.ate > Date.now()) return c.valor as T;
  cache.delete(chave);
  return undefined;
}
function guardar(chave: string, valor: unknown, ms: number) {
  if (cache.size > 200) cache.clear();
  cache.set(chave, { ate: Date.now() + ms, valor });
}

function hojeBrasilia(): string {
  return new Date(Date.now() - 3 * 3600 * 1000).toISOString().slice(0, 10);
}

function diasEntre(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000) + 1;
}

function erro(reply: FastifyReply, e: unknown) {
  if (e instanceof Erro3C) return reply.status(e.status).send({ message: e.message });
  throw e;
}

const NAO_CONFIGURADO = {
  message: 'Integração com a 3C Plus não configurada. Preencha THREEC_API_URL e THREEC_API_TOKEN no servidor.',
  configurado: false,
};

/** "crm-arthur=Arthur Rosa;crm-luis-closer=Luis" -> mapa aba -> nome do agente na 3C. */
function agentesPorAba(): Map<string, string> {
  const m = new Map<string, string>();
  for (const par of (process.env.THREEC_AGENTES ?? '').split(/[;\n]/)) {
    const [aba, nome] = par.split('=').map((s) => s?.trim());
    if (aba && nome) m.set(aba, nome);
  }
  return m;
}

/**
 * Confere o acesso à aba e devolve quem é o dono dela (o nome a procurar na 3C).
 * null = já respondeu o erro.
 */
async function donoDaPagina(req: FastifyRequest, reply: FastifyReply, pagina: string | undefined): Promise<{ dono: string; agente: string } | null> {
  if (!pagina) {
    reply.status(400).send({ message: 'Faltou a aba do CRM.' });
    return null;
  }
  const aba = await queryOne<{ id: string; name: string }>('SELECT id, name FROM lead_pages WHERE id = $1', [pagina]);
  if (!aba) {
    reply.status(404).send({ message: 'Aba não encontrada.' });
    return null;
  }
  const eu = req.user as { sub: string; role?: string };
  const permitidos = await restrictedBoardFilter(eu.sub, eu.role ?? '');
  if (permitidos !== null) {
    const temQuadro = permitidos.length
      ? await query('SELECT 1 FROM lead_boards WHERE id = ANY($1) AND page = $2 LIMIT 1', [permitidos, pagina])
      : [];
    if (!temQuadro.length) {
      reply.status(403).send({ message: 'Sem acesso a essa aba.' });
      return null;
    }
  }
  const sdrs = await query<{ name: string }>(`SELECT DISTINCT name FROM lead_labels WHERE field = 'sdr'`);
  const dono = donoDaAba(aba.name, sdrs.map((s) => s.name));
  const agente = agentesPorAba().get(pagina) ?? dono;
  if (!agente) {
    reply.status(400).send({ message: 'Essa aba não é de nenhuma pessoa do time, então não tem ligações pra mostrar.' });
    return null;
  }
  return { dono: dono || agente, agente };
}

/** Nome sem acento, minúsculo e com espaços simples, pra comparar. */
function semAcento(s: string): string {
  return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
}

/**
 * A ligação/agente da 3C é dessa pessoa? Nome completo configurado em THREEC_AGENTES casa inteiro;
 * só o primeiro nome (o padrão, vindo do nome da aba) casa pelo primeiro nome do agente.
 */
export function ehDaPessoa(nomeNa3C: string, agente: string): boolean {
  if (!nomeNa3C || !agente) return false;
  if (agente.trim().includes(' ')) return semAcento(nomeNa3C) === semAcento(agente);
  return primeiroNome(nomeNa3C) === primeiroNome(agente);
}

export async function ligacoes3cRoutes(app: FastifyInstance) {
  /** Ligações do dono da aba no período: totais, por hora, por dia, por qualificação e últimas ligações. */
  app.get<{ Querystring: { pagina?: string; inicio?: string; fim?: string; atualizar?: string } }>(
    '/api/ligacoes-3c/relatorio',
    { onRequest: [app.authenticate] },
    async (req, reply) => {
      const quem = await donoDaPagina(req, reply, req.query.pagina);
      if (!quem) return;
      const cfg = config3C();
      if (!cfg) return reply.status(503).send(NAO_CONFIGURADO);

      const hoje = hojeBrasilia();
      const inicio = DIA.test(req.query.inicio ?? '') ? req.query.inicio! : hoje;
      const fim = DIA.test(req.query.fim ?? '') ? req.query.fim! : inicio;
      if (fim < inicio) return reply.status(400).send({ message: 'A data final é antes da inicial.' });
      if (diasEntre(inicio, fim) > MAX_DIAS) {
        return reply.status(400).send({ message: `Escolha no máximo ${MAX_DIAS} dias por vez.` });
      }

      try {
        // O cache guarda a lista inteira do período (serve pras duas abas); o filtro por pessoa vem depois.
        const chave = `calls:${inicio}:${fim}`;
        let lista = req.query.atualizar === '1' ? undefined : doCache<{ ligacoes: Ligacao[]; cortado: boolean }>(chave);
        if (!lista) {
          const { itens, cortado } = await listarLigacoes(cfg, inicio, fim);
          lista = { ligacoes: itens.map(normalizarLigacao).filter((l): l is Ligacao => !!l), cortado };
          guardar(chave, lista, fim >= hoje ? 60_000 : 10 * 60_000);
        }
        const daPessoa = lista.ligacoes.filter((l) => ehDaPessoa(l.agente, quem.agente));
        return {
          configurado: true,
          pessoa: quem.dono,
          periodo: { inicio, fim },
          atualizadoEm: new Date().toISOString(),
          cortado: lista.cortado,
          ...montarRelatorio(daPessoa),
        };
      } catch (e) {
        return erro(reply, e);
      }
    },
  );

  /** O que o dono da aba está fazendo no discador agora (null = não está logado). */
  app.get<{ Querystring: { pagina?: string } }>('/api/ligacoes-3c/agora', { onRequest: [app.authenticate] }, async (req, reply) => {
    const quem = await donoDaPagina(req, reply, req.query.pagina);
    if (!quem) return;
    const cfg = config3C();
    if (!cfg) return reply.status(503).send(NAO_CONFIGURADO);
    try {
      let agentes = doCache<AgenteAgora[]>('agora');
      if (!agentes) {
        agentes = normalizarAgentes(await get3C(cfg, '/agents/status'));
        guardar('agora', agentes, 15_000);
      }
      return { atualizadoEm: new Date().toISOString(), agente: agentes.find((a) => ehDaPessoa(a.nome, quem.agente)) ?? null };
    } catch (e) {
      return erro(reply, e);
    }
  });

  /** Gravação de uma ligação, servida pelo painel (o token da 3C não sai do servidor). */
  app.get<{ Params: { id: string }; Querystring: { pagina?: string } }>(
    '/api/ligacoes-3c/gravacao/:id',
    { onRequest: [app.authenticate] },
    async (req, reply) => {
      const quem = await donoDaPagina(req, reply, req.query.pagina);
      if (!quem) return;
      const cfg = config3C();
      if (!cfg) return reply.status(503).send(NAO_CONFIGURADO);
      if (!/^[\w.-]{1,80}$/.test(req.params.id)) return reply.status(400).send({ message: 'Ligação inválida.' });
      try {
        // Só toca gravação de ligação da própria pessoa da aba. Se a 3C não devolver a ficha da ligação, segue
        // (quem chega aqui já tem acesso à aba).
        const ficha = await get3C<{ data?: unknown }>(cfg, `/calls/${encodeURIComponent(req.params.id)}`).catch(() => null);
        const ligacao = ficha ? normalizarLigacao(ficha.data) : null;
        if (ligacao?.agente && !ehDaPessoa(ligacao.agente, quem.agente)) {
          return reply.status(403).send({ message: 'Essa ligação não é desta aba.' });
        }
        const { tipo, dados } = await gravacao3C(cfg, req.params.id);
        return reply.header('Content-Type', tipo).header('Cache-Control', 'private, max-age=600').send(dados);
      } catch (e) {
        return erro(reply, e);
      }
    },
  );

  /** Quem está logado tem ramal na 3C? (o menu do telefone mostra "Ligar pela 3C" só pra quem tem). */
  app.get('/api/ligacoes-3c/meu-ramal', { onRequest: [app.authenticate] }, async (req) => {
    const eu = req.user as { sub: string };
    const perfil = await queryOne<{ name: string | null }>('SELECT name FROM profiles WHERE id = $1', [eu.sub]);
    return { configurado: !!config3C(), ramal: ramalDaPessoa(perfil?.name ?? '') };
  });

  /** "Ligar pela 3C": a 3C disca pro número pelo ramal de quem clicou (a pessoa atende no webphone/softphone). */
  app.post<{ Body: { telefone?: string } }>('/api/ligacoes-3c/ligar', { onRequest: [app.authenticate] }, async (req, reply) => {
    const cfg = config3C();
    if (!cfg) return reply.status(503).send(NAO_CONFIGURADO);
    const eu = req.user as { sub: string };
    const perfil = await queryOne<{ name: string | null }>('SELECT name FROM profiles WHERE id = $1', [eu.sub]);
    const ramal = ramalDaPessoa(perfil?.name ?? '');
    if (!ramal) {
      return reply.status(400).send({ message: 'Seu usuário não tem ramal na 3C configurado no painel (THREEC_RAMAIS).' });
    }
    const telefone = telefonePara3C(req.body?.telefone ?? '');
    if (!telefone) return reply.status(400).send({ message: 'Número inválido: precisa ter DDD + número.' });
    try {
      await clickToCall(cfg, ramal, telefone);
      req.log.info({ ramal }, 'click2call 3C');
      return { ok: true, ramal, telefone };
    } catch (e) {
      return erro(reply, e);
    }
  });

  /**
   * Diagnóstico (só admin): mostra as CHAVES que a 3C manda em /calls e /agents/status, pra conferir
   * os nomes de campo na primeira configuração. Telefones e nomes vêm mascarados.
   */
  app.get<{ Querystring: { dia?: string } }>('/api/ligacoes-3c/bruto', { onRequest: [app.authenticate] }, async (req, reply) => {
    const eu = req.user as { role?: string };
    if (eu.role !== 'admin') return reply.status(403).send({ message: 'Só administrador.' });
    const cfg = config3C();
    if (!cfg) return reply.status(503).send(NAO_CONFIGURADO);
    const dia = DIA.test(req.query.dia ?? '') ? req.query.dia! : hojeBrasilia();
    try {
      const chamadas = await get3C<{ data?: unknown[]; meta?: unknown }>(cfg, '/calls', {
        start_date: `${dia} 00:00:00`,
        end_date: `${dia} 23:59:59`,
        per_page: 20,
        with_mailing: false,
      });
      const status = await get3C<unknown>(cfg, '/agents/status');
      const listaStatus = Array.isArray((status as { data?: unknown })?.data) ? (status as { data: unknown[] }).data : [];
      const agentes = [...new Set((chamadas.data ?? []).map((c) => normalizarLigacao(c)?.agente).filter(Boolean))];
      return {
        dia,
        agentesNasLigacoes: agentes,
        agentesNoStatus: normalizarAgentes(status).map((a) => a.nome),
        calls: { ...amostraDeCampos(chamadas.data ?? []), meta: chamadas.meta ?? null },
        agentsStatus: amostraDeCampos(listaStatus),
      };
    } catch (e) {
      return erro(reply, e);
    }
  });
}
