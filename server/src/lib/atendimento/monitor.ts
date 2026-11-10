import { query, queryOne } from '../../db.js';
import { sendToSupportGroupId } from '../supportGroup.js';
import {
  CONFIG_PADRAO, ROTULO_SITUACAO, agoraBrasilia, classificar, dentroDoHorario, estaIgnorado, formatarDuracao, lerMensagem,
  normalizarConfig, resumirConversa, type ClasseIa, type ConfigMonitor, type ResumoConversa, type Situacao,
} from './regras.js';
import { criarNota, enviarNoTicket, listarTickets, mensagensDoTicket, resolverCredencial, type TicketNx } from './nxApi.js';
import { classificarComIa, iaDisponivel } from './ia.js';

/**
 * Monitor de Atendimento — o ciclo completo (chamado pelo job a cada 3 min e pelo botão "Atualizar agora"):
 *   1. sincronizar: lê os tickets abertos/pendentes na NX, as mensagens dos que mudaram e recalcula a situação;
 *   2. alertar: manda no grupo do suporte o que estourou o prazo (e o que escalou), em UMA mensagem por ciclo;
 *   3. autoEncerrar: (opcional) finaliza quem ficou calado depois do alerta de "cliente parou";
 *   4. resumoDiario: no horário marcado, o resumo do dia no grupo.
 */

// ─── Config ─────────────────────────────────────────────────────────────────────────────────────────────────

export async function carregarConfig(): Promise<ConfigMonitor> {
  const row = await queryOne<{ atendimento_monitor: unknown }>('SELECT atendimento_monitor FROM settings WHERE id = true');
  return normalizarConfig(row?.atendimento_monitor ?? CONFIG_PADRAO);
}

export async function salvarConfig(bruto: unknown): Promise<ConfigMonitor> {
  const atual = await carregarConfig();
  const b = (bruto && typeof bruto === 'object' ? bruto : {}) as Record<string, any>;
  // Token em branco vindo da tela = manter o salvo (a tela nunca recebe o token de volta).
  const cred = { ...atual.credencial, ...(b.credencial ?? {}) };
  if (!b.credencial?.token) cred.token = atual.credencial.token;
  if (b.credencial && b.credencial.apiId === '') cred.token = '';
  const cfg = normalizarConfig({ ...atual, ...b, credencial: cred });
  await query('UPDATE settings SET atendimento_monitor = $1 WHERE id = true', [JSON.stringify(cfg)]);
  return cfg;
}

async function grupoDestino(cfg: ConfigMonitor): Promise<string> {
  if (cfg.grupoId) return cfg.grupoId;
  const row = await queryOne<{ support_group: Record<string, unknown> | null }>('SELECT support_group FROM settings WHERE id = true');
  return String(row?.support_group?.groupId ?? '').trim();
}

export async function mandarNoGrupo(cfg: ConfigMonitor, texto: string) {
  const grupo = await grupoDestino(cfg);
  return sendToSupportGroupId(grupo, texto);
}

export const linkDoTicket = (cfg: ConfigMonitor, id: number | string) => cfg.linkTicket.replace('{id}', String(id));

// ─── Estado do último ciclo (para a tela) ───────────────────────────────────────────────────────────────────

export interface EstadoCiclo {
  em: string | null;
  ok: boolean;
  erro: string | null;
  tickets: number;
  lidos: number;
  alertas: number;
  duracaoMs: number;
}
export const ultimoCiclo: EstadoCiclo = { em: null, ok: false, erro: null, tickets: 0, lidos: 0, alertas: 0, duracaoMs: 0 };
let rodando = false;

// ─── Linhas no banco ────────────────────────────────────────────────────────────────────────────────────────

export interface LinhaTicket {
  ticket_id: string;
  status: string;
  user_id: string | null;
  user_name: string | null;
  queue_id: string | null;
  queue_name: string | null;
  is_group: boolean;
  contato_nome: string | null;
  contato_numero: string | null;
  client_id: string | null;
  last_message_at: Date | null;
  nx_created_at: Date | null;
  pendente_desde: Date | null;
  ultima_de: string | null;
  espera_desde: Date | null;
  ultima_atendente_at: Date | null;
  ultima_atendente_msg_id: string | null;
  ultimo_texto_atendente: string | null;
  ultima_cliente_at: Date | null;
  ultimo_texto_cliente: string | null;
  ultima_at: Date | null;
  cliente_encerrou: boolean;
  primeira_resposta_min: number | null;
  classe_ia: string | null;
  classe_ia_msg_id: string | null;
  situacao: Situacao;
  situacao_desde: Date | null;
  decorrido_min: number;
  prazo_min: number;
  nivel: number;
  aberto_longo: boolean;
  alerta_chave: string | null;
  alerta_nivel: number;
  alerta_em: Date | null;
  aberto_longo_avisado: boolean;
  followup_em: Date | null;
  ignorado: boolean;
  erro: string | null;
  synced_at: Date | null;
  closed_at: Date | null;
  closed_by: string | null;
}

const ms = (d: Date | null | undefined) => (d ? new Date(d).getTime() : null);
const dt = (n: number | null | undefined) => (n ? new Date(n) : null);
const digitos = (s: string | null | undefined) => (s ?? '').replace(/\D/g, '');

function resumoDaLinha(r: LinhaTicket): ResumoConversa {
  return {
    ultimaDe: (r.ultima_de as ResumoConversa['ultimaDe']) ?? null,
    esperaDesde: ms(r.espera_desde),
    ultimaAtendenteAt: ms(r.ultima_atendente_at),
    ultimaAtendenteId: r.ultima_atendente_msg_id,
    ultimoTextoAtendente: r.ultimo_texto_atendente ?? '',
    ultimaClienteAt: ms(r.ultima_cliente_at),
    ultimoTextoCliente: r.ultimo_texto_cliente ?? '',
    ultimaAt: ms(r.ultima_at),
    clienteEncerrou: r.cliente_encerrou,
    primeiraRespostaMin: r.primeira_resposta_min,
    ultimoAtendenteUserId: null,
  };
}

async function registrarEvento(e: {
  ticketId: number | string;
  tipo: string;
  situacao?: string | null;
  nivel?: number | null;
  userId?: number | string | null;
  userName?: string | null;
  detalhe?: string | null;
  autor?: string | null;
}) {
  await query(
    `INSERT INTO atd_eventos (ticket_id, tipo, situacao, nivel, user_id, user_name, detalhe, autor) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [e.ticketId, e.tipo, e.situacao ?? null, e.nivel ?? null, e.userId ?? null, e.userName ?? null, e.detalhe?.slice(0, 1000) ?? null, e.autor ?? null],
  );
}
export { registrarEvento };

// ─── 1. Sincronizar ─────────────────────────────────────────────────────────────────────────────────────────

/** Máximo de conversas lidas por ciclo (as que ficarem de fora entram no próximo, 3 min depois). */
const LEITURAS_POR_CICLO = 80;
const IA_POR_CICLO = 30;

async function mapaDeClientes(): Promise<Map<string, string>> {
  const rows = await query<{ id: string; phone: string | null; channel_notify_number: string | null }>(
    `SELECT id, phone, channel_notify_number FROM clients WHERE archived_at IS NULL`,
  );
  const m = new Map<string, string>();
  for (const c of rows) {
    for (const n of [c.phone, c.channel_notify_number]) {
      const d = digitos(n);
      if (d.length >= 10) m.set(d.slice(-10), c.id);
    }
  }
  return m;
}

export async function sincronizar(cfg: ConfigMonitor, agora = Date.now()): Promise<{ tickets: number; lidos: number }> {
  const cred = await resolverCredencial(cfg);
  if (!cred) throw new Error('Sem credencial da NX: configure o grupo de suporte em Configurações ou a credencial do monitor.');

  const [abertos, pendentes] = await Promise.all([listarTickets(cred, 'open'), listarTickets(cred, 'pending')]);
  const porId = new Map<number, TicketNx>();
  for (const t of [...abertos, ...pendentes]) porId.set(t.id, t);
  let tickets = [...porId.values()];
  if (cfg.filas.length) tickets = tickets.filter((t) => t.queueId !== null && cfg.filas.includes(t.queueId));

  const existentes = await query<LinhaTicket>(`SELECT * FROM atd_tickets WHERE ticket_id = ANY($1::bigint[]) OR closed_at IS NULL`, [
    tickets.map((t) => t.id),
  ]);
  const linhaPorId = new Map(existentes.map((r) => [Number(r.ticket_id), r]));
  const clientes = await mapaDeClientes();
  const grupo = await grupoDestino(cfg);
  const usarIa = cfg.ia && iaDisponivel();

  // Lê primeiro as conversas que mexeram há mais tempo sem leitura.
  const precisaLer = (t: TicketNx, r: LinhaTicket | undefined) =>
    !r || !r.synced_at || !!r.erro || !!r.closed_at || ms(r.last_message_at) !== t.lastMessageAt;
  tickets.sort((a, b) => (a.lastMessageAt ?? 0) - (b.lastMessageAt ?? 0));

  let lidos = 0;
  let chamadasIa = 0;
  for (const t of tickets) {
    const r = linhaPorId.get(t.id);
    let resumo: ResumoConversa | null = r ? resumoDaLinha(r) : null;
    let numero = r?.contato_numero ?? t.numero;
    let erro: string | null = null;
    let leu = false;

    const ler = precisaLer(t, r);
    if (ler && lidos < LEITURAS_POR_CICLO) {
      lidos++;
      try {
        const { mensagens, numero: n } = await mensagensDoTicket(cred, t.id);
        const msgs = mensagens.map(lerMensagem).filter((m): m is NonNullable<typeof m> => !!m);
        resumo = resumirConversa(msgs, cfg.horario);
        numero = n ?? numero;
        leu = true;
      } catch (err) {
        erro = String((err as Error).message ?? err).slice(0, 300);
      }
    }
    if (!resumo) {
      // Ainda sem leitura (passou do limite do ciclo ou deu erro): registra o básico e lê no próximo.
      resumo = resumirConversa([], cfg.horario);
    }

    // Follow-up mandado pelo painel conta como o último movimento do atendente: o relógio de "cliente parou"
    // recomeça dali (a mensagem sai pela API, sem usuário, então a leitura da conversa não a vê como humana).
    const followup = ms(r?.followup_em);
    if (followup && (resumo.ultimaDe !== 'cliente' || resumo.clienteEncerrou) && (resumo.ultimaAt ?? 0) < followup) {
      resumo = { ...resumo, ultimaAt: followup, ultimaDe: resumo.ultimaDe ?? 'atendente' };
    }

    const pendente = t.status === 'pending' && !t.userId;
    const eraPendente = r && r.status === 'pending' && !r.user_id && !r.closed_at;
    const pendenteDesde = pendente ? (eraPendente && r?.pendente_desde ? ms(r.pendente_desde) : resumo.esperaDesde ?? t.createdAt ?? agora) : null;

    // IA: só para a última mensagem do atendente, e só uma vez por mensagem.
    let classeIa: ClasseIa | null = null;
    let classeIaMsgId: string | null = null;
    if (resumo.ultimaAtendenteId && (resumo.ultimaDe === 'atendente' || resumo.clienteEncerrou)) {
      if (r?.classe_ia_msg_id === resumo.ultimaAtendenteId && r.classe_ia) {
        classeIa = r.classe_ia as ClasseIa;
        classeIaMsgId = r.classe_ia_msg_id;
      } else if (usarIa && chamadasIa < IA_POR_CICLO && resumo.ultimoTextoAtendente) {
        chamadasIa++;
        classeIa = await classificarComIa(resumo.ultimoTextoAtendente, resumo.ultimoTextoCliente);
        if (classeIa) classeIaMsgId = resumo.ultimaAtendenteId;
      }
    }

    const c = classificar(
      { status: t.status, userId: t.userId, criadoEm: t.createdAt, pendenteDesde },
      resumo,
      cfg,
      agora,
      classeIa,
    );
    const ignorado =
      estaIgnorado(cfg.ignorar, { numero, nome: t.name }) || (!!grupo && digitos(numero).length > 5 && digitos(numero) === digitos(grupo));
    const clientId = !t.isGroup && digitos(numero).length >= 10 ? clientes.get(digitos(numero).slice(-10)) ?? null : r?.client_id ?? null;
    const reaberto = !!r?.closed_at;
    // Só avança o "última mensagem vista" quando a conversa foi lida — senão o próximo ciclo acharia que já leu.
    const ultimaVista = leu || !ler ? t.lastMessageAt : ms(r?.last_message_at);

    await query(
      `INSERT INTO atd_tickets (
         ticket_id, status, user_id, user_name, queue_id, queue_name, is_group, contato_nome, contato_numero, client_id,
         last_message_at, nx_created_at, pendente_desde, ultima_de, espera_desde, ultima_atendente_at, ultima_atendente_msg_id,
         ultimo_texto_atendente, ultima_cliente_at, ultimo_texto_cliente, ultima_at, cliente_encerrou, primeira_resposta_min,
         classe_ia, classe_ia_msg_id, situacao, situacao_desde, decorrido_min, prazo_min, nivel, aberto_longo, ignorado, erro,
         synced_at, closed_at, closed_by, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32,$33,
               $34, NULL, NULL, NOW())
       ON CONFLICT (ticket_id) DO UPDATE SET
         status=EXCLUDED.status, user_id=EXCLUDED.user_id, user_name=EXCLUDED.user_name, queue_id=EXCLUDED.queue_id,
         queue_name=EXCLUDED.queue_name, is_group=EXCLUDED.is_group, contato_nome=EXCLUDED.contato_nome,
         contato_numero=EXCLUDED.contato_numero, client_id=EXCLUDED.client_id, last_message_at=EXCLUDED.last_message_at,
         nx_created_at=EXCLUDED.nx_created_at, pendente_desde=EXCLUDED.pendente_desde, ultima_de=EXCLUDED.ultima_de,
         espera_desde=EXCLUDED.espera_desde, ultima_atendente_at=EXCLUDED.ultima_atendente_at,
         ultima_atendente_msg_id=EXCLUDED.ultima_atendente_msg_id, ultimo_texto_atendente=EXCLUDED.ultimo_texto_atendente,
         ultima_cliente_at=EXCLUDED.ultima_cliente_at, ultimo_texto_cliente=EXCLUDED.ultimo_texto_cliente,
         ultima_at=EXCLUDED.ultima_at, cliente_encerrou=EXCLUDED.cliente_encerrou,
         primeira_resposta_min=COALESCE(EXCLUDED.primeira_resposta_min, atd_tickets.primeira_resposta_min),
         classe_ia=EXCLUDED.classe_ia, classe_ia_msg_id=EXCLUDED.classe_ia_msg_id, situacao=EXCLUDED.situacao,
         situacao_desde=EXCLUDED.situacao_desde, decorrido_min=EXCLUDED.decorrido_min, prazo_min=EXCLUDED.prazo_min,
         nivel=EXCLUDED.nivel, aberto_longo=EXCLUDED.aberto_longo, ignorado=EXCLUDED.ignorado, erro=EXCLUDED.erro,
         synced_at=COALESCE(EXCLUDED.synced_at, atd_tickets.synced_at),
         closed_at=NULL, closed_by=NULL,
         alerta_chave=CASE WHEN atd_tickets.closed_at IS NOT NULL THEN NULL ELSE atd_tickets.alerta_chave END,
         alerta_nivel=CASE WHEN atd_tickets.closed_at IS NOT NULL THEN 0 ELSE atd_tickets.alerta_nivel END,
         aberto_longo_avisado=CASE WHEN atd_tickets.closed_at IS NOT NULL THEN false ELSE atd_tickets.aberto_longo_avisado END,
         updated_at=NOW()`,
      [
        t.id, t.status, t.userId, t.username, t.queueId, t.queue, t.isGroup, t.name, numero, clientId,
        dt(ultimaVista), dt(t.createdAt), dt(pendenteDesde), resumo.ultimaDe, dt(resumo.esperaDesde), dt(resumo.ultimaAtendenteAt),
        resumo.ultimaAtendenteId, resumo.ultimoTextoAtendente, dt(resumo.ultimaClienteAt), resumo.ultimoTextoCliente, dt(resumo.ultimaAt),
        resumo.clienteEncerrou, resumo.primeiraRespostaMin, classeIa, classeIaMsgId, c.situacao, dt(c.desde), c.decorridoMin,
        c.prazoMin, c.nivel, c.abertoLongo, ignorado, erro, leu ? new Date(agora) : null,
      ],
    );
    if (reaberto) await registrarEvento({ ticketId: t.id, tipo: 'reaberto', userId: t.userId, userName: t.username });
  }

  // Tickets que saíram da lista de abertos/pendentes foram finalizados na NX. Proteção: se a NX devolveu
  // zero tickets e havia vários abertos, provavelmente é falha da API, não "finalizaram todos".
  const vistos = new Set(tickets.map((t) => t.id));
  const sumiram = existentes.filter((r) => !r.closed_at && !vistos.has(Number(r.ticket_id)));
  if (!(tickets.length === 0 && sumiram.length > 5)) {
    for (const r of sumiram) {
      await query(`UPDATE atd_tickets SET closed_at = NOW(), closed_by = COALESCE(closed_by, 'nx'), nivel = 0, updated_at = NOW() WHERE ticket_id = $1`, [
        r.ticket_id,
      ]);
      await registrarEvento({ ticketId: r.ticket_id, tipo: 'finalizado', situacao: r.situacao, userId: r.user_id, userName: r.user_name, autor: 'nx' });
    }
  } else {
    console.warn(`[monitorAtendimento] a NX devolveu 0 tickets com ${sumiram.length} abertos aqui — não marquei nenhum como finalizado`);
  }

  return { tickets: tickets.length, lidos };
}

// ─── 2. Alertar ─────────────────────────────────────────────────────────────────────────────────────────────

const ICONE: Record<Situacao, string> = { sem_resposta: '⏱️', promessa: '🤝', cliente_parou: '💤', fila: '📥', ok: '✅' };
const chaveDoAlerta = (r: Pick<LinhaTicket, 'situacao' | 'situacao_desde'>) => `${r.situacao}:${ms(r.situacao_desde) ?? 0}`;
const nomeDoContato = (r: LinhaTicket) => `${r.contato_nome || `Ticket #${r.ticket_id}`}${r.is_group ? ' (grupo)' : ''}`;
const cortar = (s: string | null, n: number) => {
  const t = (s ?? '').replace(/\s+/g, ' ').trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
};

function linhaDoAlerta(cfg: ConfigMonitor, r: LinhaTicket): string {
  const quem = r.user_name ? r.user_name : 'sem atendente';
  const tempo = formatarDuracao(r.decorrido_min);
  let trecho = '';
  if (r.situacao === 'sem_resposta' || r.situacao === 'fila') trecho = cortar(r.ultimo_texto_cliente, 90);
  else trecho = cortar(r.ultimo_texto_atendente, 90);
  return (
    `• *${nomeDoContato(r)}* · ${quem} · há ${tempo}` +
    (r.queue_name ? ` · ${r.queue_name}` : '') +
    ` · #${r.ticket_id}` +
    (trecho ? `\n   _"${trecho}"_` : '') +
    (linkPorTicket(cfg) ? `\n   ${linkDoTicket(cfg, r.ticket_id)}` : '')
  );
}

/** O link configurado abre cada ticket ({id})? Se não, vai um link só, no fim da mensagem. */
const linkPorTicket = (cfg: ConfigMonitor) => cfg.linkTicket.includes('{id}');

/** Texto da mensagem de alertas do ciclo (exportado para os testes de formato). */
export function montarMensagemDeAlertas(cfg: ConfigMonitor, novos: LinhaTicket[], longos: LinhaTicket[]): string {
  const partes: string[] = [];
  const total = novos.length + longos.length;
  partes.push(`⚠️ *Monitor de Atendimento* — ${total} ${total === 1 ? 'alerta' : 'alertas'}`);
  const MAX = 15;
  let usados = 0;
  const escalados = novos.filter((r) => r.nivel >= 2);
  const normais = novos.filter((r) => r.nivel < 2);
  if (escalados.length) {
    partes.push(`🚨 *ESCALADO — passou de ${cfg.escalarEm}× o prazo*`);
    for (const r of escalados) if (usados++ < MAX) partes.push(`${ICONE[r.situacao]} ${linhaDoAlerta(cfg, r)}`);
  }
  for (const s of ['sem_resposta', 'promessa', 'fila', 'cliente_parou'] as Situacao[]) {
    const doTipo = normais.filter((r) => r.situacao === s);
    if (!doTipo.length) continue;
    const prazo =
      s === 'cliente_parou' ? `${cfg.prazos.clienteParouHoras}h` : formatarDuracao(s === 'sem_resposta' ? cfg.prazos.semRespostaMin : s === 'promessa' ? cfg.prazos.promessaMin : cfg.prazos.filaMin);
    const dica = s === 'cliente_parou' ? ' — mande um "conseguiu resolver?" ou finalize' : '';
    partes.push(`${ICONE[s]} *${ROTULO_SITUACAO[s]}* (prazo ${prazo})${dica}`);
    for (const r of doTipo) if (usados++ < MAX) partes.push(linhaDoAlerta(cfg, r));
  }
  if (longos.length) {
    partes.push(`📅 *Abertos há mais de ${cfg.prazos.abertoDias} dias*`);
    for (const r of longos)
      if (usados++ < MAX)
        partes.push(`• *${nomeDoContato(r)}* · ${r.user_name || 'sem atendente'} · #${r.ticket_id}${linkPorTicket(cfg) ? `\n   ${linkDoTicket(cfg, r.ticket_id)}` : ''}`);
  }
  if (usados > MAX) partes.push(`… e mais ${usados - MAX} no painel do superadmin (Suporte › Monitor de Atendimento).`);
  if (!linkPorTicket(cfg)) partes.push(`🔗 ${cfg.linkTicket}`);
  return partes.join('\n\n');
}

function textoDaNota(r: LinhaTicket): string {
  const prazo = r.situacao === 'cliente_parou' ? formatarDuracao(r.prazo_min) : formatarDuracao(r.prazo_min);
  const base: Record<string, string> = {
    sem_resposta: `cliente aguardando resposta há ${formatarDuracao(r.decorrido_min)} (prazo ${prazo})`,
    promessa: `retorno prometido há ${formatarDuracao(r.decorrido_min)} e ainda não dado (prazo ${prazo})`,
    cliente_parou: `cliente sem falar há ${formatarDuracao(r.decorrido_min)}: mande um follow-up ou finalize`,
    fila: `na fila sem atendente há ${formatarDuracao(r.decorrido_min)} (prazo ${prazo})`,
  };
  return `${r.nivel >= 2 ? '🚨' : '⚠️'} Monitor de Atendimento: ${base[r.situacao] ?? r.situacao}.`;
}

/**
 * Vale avisar no grupo? Só fora do prazo e só quando alguém precisa agir. Em GRUPO, "cliente parou de
 * falar" não avisa: a conversa de grupo não se encerra e o silêncio ali é normal (fica só no painel).
 */
export function precisaDeAviso(r: Pick<LinhaTicket, 'situacao' | 'nivel' | 'is_group'>): boolean {
  if (r.situacao === 'ok' || r.nivel < 1) return false;
  if (r.is_group && r.situacao === 'cliente_parou') return false;
  return true;
}

/** Dos alertas novos do ciclo, quais vão para o grupo (conforme cfg.avisos). */
export function filtrarAvisosDoGrupo<T extends Pick<LinhaTicket, 'situacao'>>(cfg: ConfigMonitor, novos: T[], longos: T[]) {
  return {
    paraOGrupo: novos.filter((r) => cfg.avisos.situacoes.includes(r.situacao)),
    longosNoGrupo: cfg.avisos.abertoLongo ? longos : [],
  };
}

export async function alertar(cfg: ConfigMonitor, agora = Date.now()): Promise<number> {
  if (!dentroDoHorario(agora, cfg.horario)) return 0;
  const abertos = await query<LinhaTicket>(`SELECT * FROM atd_tickets WHERE closed_at IS NULL AND ignorado = false`);
  const novos = abertos.filter((r) => {
    if (!precisaDeAviso(r)) return false;
    const jaAvisado = r.alerta_chave === chaveDoAlerta(r) ? r.alerta_nivel : 0;
    return r.nivel > jaAvisado;
  });
  // Grupo fica aberto para sempre por natureza: "aberto há dias" só vale para conversa privada.
  const longos = abertos.filter((r) => r.aberto_longo && !r.aberto_longo_avisado && !r.is_group);
  if (!novos.length && !longos.length) return 0;

  novos.sort((a, b) => b.nivel - a.nivel || b.decorrido_min / Math.max(1, b.prazo_min) - a.decorrido_min / Math.max(1, a.prazo_min));
  // Só o que está ligado em cfg.avisos vai para o grupo; o resto é marcado como visto em silêncio
  // (continua no painel e no ranking, só não notifica).
  const { paraOGrupo, longosNoGrupo } = filtrarAvisosDoGrupo(cfg, novos, longos);
  if (paraOGrupo.length || longosNoGrupo.length) {
    const texto = montarMensagemDeAlertas(cfg, paraOGrupo, longosNoGrupo);
    const envio = await mandarNoGrupo(cfg, texto);
    if (!envio.ok) {
      console.warn('[monitorAtendimento] alerta no grupo falhou', envio.reason ?? envio.status, envio.detail ?? '');
      // Sem grupo configurado não adianta tentar de novo a cada ciclo: marca como avisado mesmo assim.
      if (envio.reason !== 'not_configured') return 0;
    }
  }

  const cred = cfg.notaNoTicket ? await resolverCredencial(cfg) : null;
  for (const r of novos) {
    await query(`UPDATE atd_tickets SET alerta_chave = $2, alerta_nivel = $3, alerta_em = NOW() WHERE ticket_id = $1`, [
      r.ticket_id,
      chaveDoAlerta(r),
      r.nivel,
    ]);
    await registrarEvento({
      ticketId: r.ticket_id,
      tipo: r.nivel >= 2 ? 'escalado' : 'alerta',
      situacao: r.situacao,
      nivel: r.nivel,
      userId: r.user_id,
      userName: r.user_name,
      detalhe: `${formatarDuracao(r.decorrido_min)} (prazo ${formatarDuracao(r.prazo_min)})`,
      autor: 'monitor',
    });
    if (cred) {
      await criarNota(cred, Number(r.ticket_id), textoDaNota(r), `monitor-${r.ticket_id}-${chaveDoAlerta(r)}-${r.nivel}`).catch((err) =>
        console.warn('[monitorAtendimento] nota no ticket falhou', r.ticket_id, String(err).slice(0, 200)),
      );
    }
  }
  for (const r of longos) {
    await query(`UPDATE atd_tickets SET aberto_longo_avisado = true WHERE ticket_id = $1`, [r.ticket_id]);
    await registrarEvento({ ticketId: r.ticket_id, tipo: 'aberto_longo', userId: r.user_id, userName: r.user_name, autor: 'monitor' });
  }
  return paraOGrupo.length + longosNoGrupo.length;
}

// ─── 3. Encerramento automático ─────────────────────────────────────────────────────────────────────────────

export async function autoEncerrar(cfg: ConfigMonitor, agora = Date.now()): Promise<number> {
  if (!cfg.autoEncerrar.ativo || !dentroDoHorario(agora, cfg.horario)) return 0;
  const limite = new Date(agora - cfg.autoEncerrar.horasDepoisDoAlerta * 3600_000);
  const candidatos = await query<LinhaTicket>(
    `SELECT * FROM atd_tickets
     WHERE closed_at IS NULL AND ignorado = false AND is_group = false AND situacao = 'cliente_parou'
       AND alerta_nivel >= 1 AND alerta_em IS NOT NULL AND alerta_em <= $1`,
    [limite],
  );
  const validos = candidatos.filter((r) => r.alerta_chave === chaveDoAlerta(r)).slice(0, 20);
  if (!validos.length) return 0;
  const cred = await resolverCredencial(cfg);
  if (!cred) return 0;
  const feitos: LinhaTicket[] = [];
  for (const r of validos) {
    try {
      await enviarNoTicket(cred, Number(r.ticket_id), cfg.autoEncerrar.mensagem, { fechar: true, externalKey: `monitor-auto-${r.ticket_id}-${chaveDoAlerta(r)}` });
      await query(`UPDATE atd_tickets SET closed_at = NOW(), closed_by = 'auto', nivel = 0, updated_at = NOW() WHERE ticket_id = $1`, [r.ticket_id]);
      await registrarEvento({ ticketId: r.ticket_id, tipo: 'auto_encerrado', situacao: r.situacao, userId: r.user_id, userName: r.user_name, autor: 'monitor' });
      feitos.push(r);
    } catch (err) {
      console.warn('[monitorAtendimento] auto-encerrar falhou', r.ticket_id, String(err).slice(0, 200));
    }
  }
  if (feitos.length) {
    await mandarNoGrupo(
      cfg,
      `🔒 *Monitor de Atendimento* — ${feitos.length} ${feitos.length === 1 ? 'atendimento finalizado' : 'atendimentos finalizados'} automaticamente ` +
        `(cliente sem responder ${cfg.autoEncerrar.horasDepoisDoAlerta}h depois do aviso)\n\n` +
        feitos.map((r) => `• ${nomeDoContato(r)} · ${r.user_name || 'sem atendente'}`).join('\n'),
    );
  }
  return feitos.length;
}

// ─── Números (painel e resumo) ──────────────────────────────────────────────────────────────────────────────

export interface LinhaRanking {
  user_id: string | null;
  user_name: string;
  abertos: number;
  em_alerta: number;
  alertas: number;
  escalados: number;
  finalizados: number;
  primeira_resposta_media: number | null;
}

/** Por atendente: abertos agora + alertas/finalizações desde `desde`. */
export async function ranking(desde: Date): Promise<LinhaRanking[]> {
  const rows = await query<{
    user_id: string | null;
    user_name: string | null;
    abertos: string;
    em_alerta: string;
    alertas: string;
    escalados: string;
    finalizados: string;
    primeira_resposta_media: string | null;
  }>(
    // "Sem atendente" (user_id nulo) vira a chave -1 para o FULL JOIN funcionar.
    `WITH abertos AS (
       SELECT COALESCE(user_id, -1) AS k, MAX(user_name) AS user_name, COUNT(*) AS abertos,
              COUNT(*) FILTER (WHERE nivel >= 1 AND situacao <> 'ok') AS em_alerta
       FROM atd_tickets WHERE closed_at IS NULL AND ignorado = false GROUP BY 1
     ), ev AS (
       SELECT COALESCE(user_id, -1) AS k, MAX(user_name) AS user_name,
              COUNT(*) FILTER (WHERE tipo IN ('alerta','escalado')) AS alertas,
              COUNT(*) FILTER (WHERE tipo = 'escalado') AS escalados,
              COUNT(*) FILTER (WHERE tipo IN ('finalizado','finalizado_painel','auto_encerrado')) AS finalizados
       FROM atd_eventos WHERE created_at >= $1 GROUP BY 1
     ), resp AS (
       SELECT COALESCE(user_id, -1) AS k, ROUND(AVG(primeira_resposta_min))::int AS media
       FROM atd_tickets WHERE first_seen_at >= $1 AND primeira_resposta_min IS NOT NULL AND ignorado = false GROUP BY 1
     )
     SELECT NULLIF(COALESCE(a.k, e.k), -1) AS user_id,
            COALESCE(a.user_name, e.user_name) AS user_name,
            COALESCE(a.abertos, 0) AS abertos, COALESCE(a.em_alerta, 0) AS em_alerta,
            COALESCE(e.alertas, 0) AS alertas, COALESCE(e.escalados, 0) AS escalados, COALESCE(e.finalizados, 0) AS finalizados,
            r.media AS primeira_resposta_media
     FROM abertos a
     FULL OUTER JOIN ev e ON e.k = a.k
     LEFT JOIN resp r ON r.k = COALESCE(a.k, e.k)`,
    [desde],
  );
  return rows
    .map((r) => ({
      user_id: r.user_id,
      user_name: r.user_name || (r.user_id ? `Atendente #${r.user_id}` : 'Sem atendente'),
      abertos: Number(r.abertos),
      em_alerta: Number(r.em_alerta),
      alertas: Number(r.alertas),
      escalados: Number(r.escalados),
      finalizados: Number(r.finalizados),
      primeira_resposta_media: r.primeira_resposta_media === null ? null : Number(r.primeira_resposta_media),
    }))
    .sort((a, b) => b.abertos - a.abertos || b.alertas - a.alertas);
}

/** Início do dia de hoje em Brasília. */
export function inicioDeHoje(agora = Date.now()): Date {
  const { data } = agoraBrasilia(agora);
  return new Date(`${data}T00:00:00-03:00`);
}

// ─── 4. Resumo diário ───────────────────────────────────────────────────────────────────────────────────────

export async function montarResumo(cfg: ConfigMonitor, agora = Date.now()): Promise<string> {
  const hoje = inicioDeHoje(agora);
  const abertos = await query<LinhaTicket>(`SELECT * FROM atd_tickets WHERE closed_at IS NULL AND ignorado = false`);
  const conta = (s: Situacao) => abertos.filter((r) => r.situacao === s && precisaDeAviso(r)).length;
  const tot = await queryOne<{ alertas: string; finalizados: string; auto: string }>(
    `SELECT COUNT(*) FILTER (WHERE tipo IN ('alerta','escalado')) AS alertas,
            COUNT(*) FILTER (WHERE tipo IN ('finalizado','finalizado_painel','auto_encerrado')) AS finalizados,
            COUNT(*) FILTER (WHERE tipo = 'auto_encerrado') AS auto
     FROM atd_eventos WHERE created_at >= $1`,
    [hoje],
  );
  const media = await queryOne<{ media: string | null }>(
    `SELECT ROUND(AVG(primeira_resposta_min))::int AS media FROM atd_tickets WHERE first_seen_at >= $1 AND primeira_resposta_min IS NOT NULL AND ignorado = false`,
    [hoje],
  );
  const rank = await ranking(hoje);
  const { data } = agoraBrasilia(agora);
  const dia = `${data.slice(8, 10)}/${data.slice(5, 7)}`;

  const linhas: string[] = [];
  linhas.push(`📊 *Resumo do atendimento — ${dia}*`);
  linhas.push(
    `Abertos agora: *${abertos.length}* (${((n) => `${n} ${n === 1 ? 'grupo' : 'grupos'}`)(abertos.filter((r) => r.is_group).length)})\n` +
      `⏱️ Sem resposta: ${conta('sem_resposta')} · 🤝 Promessas: ${conta('promessa')} · 📥 Fila: ${conta('fila')}\n` +
      `💤 Cliente parou: ${conta('cliente_parou')} · 📅 Há +${cfg.prazos.abertoDias} dias: ${abertos.filter((r) => r.aberto_longo && !r.is_group).length}`,
  );
  linhas.push(
    `Hoje: ${Number(tot?.finalizados ?? 0)} finalizados` +
      (Number(tot?.auto ?? 0) ? ` (${tot?.auto} automáticos)` : '') +
      ` · ${Number(tot?.alertas ?? 0)} alertas` +
      (media?.media !== null && media?.media !== undefined ? ` · 1ª resposta média ${formatarDuracao(Number(media.media))}` : ''),
  );
  const comGente = rank.filter((r) => r.abertos || r.alertas || r.finalizados);
  if (comGente.length) {
    linhas.push(
      `*Por atendente* (abertos · alertas hoje · finalizados hoje)\n` +
        comGente.map((r) => `• ${r.user_name}: ${r.abertos} · ${r.alertas} · ${r.finalizados}`).join('\n'),
    );
  }
  const pendentes = abertos
    .filter(precisaDeAviso)
    .sort((a, b) => b.nivel - a.nivel || b.decorrido_min - a.decorrido_min)
    .slice(0, 10);
  if (pendentes.length) {
    linhas.push(
      `*Ficam pendentes para amanhã*\n` +
        pendentes
          .map((r) => `• ${nomeDoContato(r)} (${r.user_name || 'sem atendente'}) — ${ROTULO_SITUACAO[r.situacao]} há ${formatarDuracao(r.decorrido_min)}`)
          .join('\n'),
    );
  } else {
    linhas.push('✅ Nada fora do prazo agora. Bom trabalho, time!');
  }
  return linhas.join('\n\n');
}

export async function resumoDiario(cfg: ConfigMonitor, agora = Date.now()): Promise<boolean> {
  if (!cfg.resumoHora || !cfg.avisos.resumo) return false;
  const { data, hora } = agoraBrasilia(agora);
  const diaSemana = new Date(`${data}T12:00:00-03:00`).getUTCDay();
  if (!cfg.horario.dias.includes(diaSemana) || hora < cfg.resumoHora) return false;
  const ja = await queryOne('SELECT 1 FROM atd_resumos WHERE dia = $1', [data]);
  if (ja) return false;
  const texto = await montarResumo(cfg, agora);
  const envio = await mandarNoGrupo(cfg, texto);
  if (!envio.ok && envio.reason !== 'not_configured') return false;
  await query('INSERT INTO atd_resumos (dia, texto) VALUES ($1, $2) ON CONFLICT (dia) DO NOTHING', [data, texto]);
  return true;
}

// ─── Ciclo ──────────────────────────────────────────────────────────────────────────────────────────────────

export async function rodarCiclo(opcoes: { forcar?: boolean } = {}): Promise<EstadoCiclo> {
  if (rodando) return ultimoCiclo;
  rodando = true;
  const inicio = Date.now();
  try {
    const cfg = await carregarConfig();
    if (!cfg.ativo && !opcoes.forcar) {
      Object.assign(ultimoCiclo, { em: new Date().toISOString(), ok: true, erro: 'Monitor desligado', duracaoMs: 0 });
      return ultimoCiclo;
    }
    const { tickets, lidos } = await sincronizar(cfg);
    let alertas = 0;
    if (cfg.ativo) {
      alertas = await alertar(cfg);
      await autoEncerrar(cfg);
      await resumoDiario(cfg);
    }
    Object.assign(ultimoCiclo, { em: new Date().toISOString(), ok: true, erro: null, tickets, lidos, alertas, duracaoMs: Date.now() - inicio });
  } catch (err) {
    console.error('[monitorAtendimento] erro no ciclo:', err);
    Object.assign(ultimoCiclo, { em: new Date().toISOString(), ok: false, erro: String((err as Error).message ?? err).slice(0, 300), duracaoMs: Date.now() - inicio });
  } finally {
    rodando = false;
  }
  return ultimoCiclo;
}
