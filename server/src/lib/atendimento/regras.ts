/**
 * Monitor de Atendimento — as REGRAS (puras, sem banco nem rede, cobertas por regras.test.ts).
 *
 * Para cada ticket aberto/pendente do atendimento da NX (app.nxsystems.com.br/atendimento) o job olha a
 * conversa e responde: quem falou por último, há quanto tempo, e em qual situação isso coloca o ticket.
 * Cada situação tem um prazo; passou do prazo = alerta (nível 1), passou do dobro = escalado (nível 2).
 *
 *  - fila          ticket pendente, sem atendente           → relógio em horário comercial desde que caiu na fila
 *  - sem_resposta  o cliente falou por último               → relógio em horário comercial desde a 1ª msg dele sem resposta
 *  - promessa      o atendente prometeu retorno e parou     → relógio em horário comercial desde a promessa
 *  - cliente_parou o atendente respondeu e o cliente calou  → relógio CORRIDO (horas) desde a última mensagem
 *
 * Além disso, "aberto há dias" (tempo corrido desde a abertura) é uma marca à parte, que vale junto com as outras.
 * O relógio zera sozinho quando a conversa anda, porque o início é sempre recalculado a partir das mensagens.
 */

export type Situacao = 'fila' | 'sem_resposta' | 'promessa' | 'cliente_parou' | 'ok';

export const SITUACOES: Situacao[] = ['sem_resposta', 'promessa', 'fila', 'cliente_parou', 'ok'];

export const ROTULO_SITUACAO: Record<Situacao, string> = {
  sem_resposta: 'Cliente sem resposta',
  promessa: '"Vou verificar" e sumiu',
  cliente_parou: 'Cliente parou de falar',
  fila: 'Na fila sem dono',
  ok: 'Em dia',
};

/** Classificação da última mensagem do atendente feita pela IA (quando ligada). */
export type ClasseIa = 'promessa' | 'resolvido' | 'pergunta' | 'outro';

export interface ConfigMonitor {
  ativo: boolean;
  prazos: {
    semRespostaMin: number;
    promessaMin: number;
    clienteParouHoras: number;
    filaMin: number;
    abertoDias: number;
  };
  /** Multiplicador do prazo para escalar (2 = no dobro do prazo). */
  escalarEm: number;
  horario: { inicio: string; fim: string; dias: number[] };
  /** Grupo de WhatsApp que recebe tudo. Vazio = grupo do suporte (settings.support_group.groupId). */
  grupoId: string;
  /** Escreve também uma nota interna no ticket quando o prazo estoura (o cliente não vê). */
  notaNoTicket: boolean;
  /** Hora do resumo diário no grupo ("" = sem resumo). */
  resumoHora: string;
  /** Classificar a última mensagem do atendente com IA (promessa x resolvido). Sem chave da Anthropic, cai nas palavras-chave. */
  ia: boolean;
  followupMensagem: string;
  autoEncerrar: { ativo: boolean; horasDepoisDoAlerta: number; mensagem: string };
  /** Contatos/grupos ignorados (número, id do grupo ou nome exato). */
  ignorar: string[];
  /** Só estas filas (ids). Vazio = todas. */
  filas: number[];
  /** Link do ticket na ferramenta; {id} vira o id do ticket. */
  linkTicket: string;
  /** Credencial da API da NX. Vazia = a mesma do grupo de suporte. */
  credencial: { apiId: string; token: string; baseUrl: string };
}

export const CONFIG_PADRAO: ConfigMonitor = {
  ativo: true,
  prazos: { semRespostaMin: 15, promessaMin: 120, clienteParouHoras: 24, filaMin: 10, abertoDias: 3 },
  escalarEm: 2,
  horario: { inicio: '08:00', fim: '18:00', dias: [1, 2, 3, 4, 5] },
  grupoId: '',
  notaNoTicket: false,
  resumoHora: '18:00',
  ia: true,
  followupMensagem: 'Oi! Passando para saber: conseguiu resolver? Se ainda precisar de algo, é só me chamar por aqui. 😊',
  autoEncerrar: {
    ativo: false,
    horasDepoisDoAlerta: 24,
    mensagem:
      'Como não tivemos retorno, estou finalizando este atendimento. Se precisar de algo, é só chamar aqui que a gente abre de novo. 👋',
  },
  ignorar: [],
  filas: [],
  linkTicket: 'https://app.nxsystems.com.br/atendimento/{id}',
  credencial: { apiId: '', token: '', baseUrl: '' },
};

const num = (v: unknown, padrao: number, min = 0, max = 100_000) => {
  const n = Number(v);
  return Number.isFinite(n) && n >= min && n <= max ? n : padrao;
};
const hhmm = (v: unknown, padrao: string) => (typeof v === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(v) ? v : padrao);
const texto = (v: unknown, padrao: string, max = 2000) => (typeof v === 'string' ? v.slice(0, max) : padrao);

/** Junta o que veio do banco/da tela com o padrão, validando cada campo (campo inválido = padrão). */
export function normalizarConfig(bruto: unknown): ConfigMonitor {
  const b = (bruto && typeof bruto === 'object' ? bruto : {}) as Record<string, any>;
  const p = (b.prazos ?? {}) as Record<string, unknown>;
  const h = (b.horario ?? {}) as Record<string, unknown>;
  const a = (b.autoEncerrar ?? {}) as Record<string, unknown>;
  const c = (b.credencial ?? {}) as Record<string, unknown>;
  const P = CONFIG_PADRAO;
  const dias = Array.isArray(h.dias)
    ? [...new Set((h.dias as unknown[]).map(Number).filter((d) => Number.isInteger(d) && d >= 0 && d <= 6))].sort()
    : P.horario.dias;
  const inicio = hhmm(h.inicio, P.horario.inicio);
  let fim = hhmm(h.fim, P.horario.fim);
  if (fim <= inicio) fim = P.horario.fim > inicio ? P.horario.fim : '23:59';
  return {
    ativo: typeof b.ativo === 'boolean' ? b.ativo : P.ativo,
    prazos: {
      semRespostaMin: num(p.semRespostaMin, P.prazos.semRespostaMin, 1),
      promessaMin: num(p.promessaMin, P.prazos.promessaMin, 1),
      clienteParouHoras: num(p.clienteParouHoras, P.prazos.clienteParouHoras, 1),
      filaMin: num(p.filaMin, P.prazos.filaMin, 1),
      abertoDias: num(p.abertoDias, P.prazos.abertoDias, 1, 365),
    },
    escalarEm: num(b.escalarEm, P.escalarEm, 1.1, 10),
    horario: { inicio, fim, dias: dias.length ? dias : P.horario.dias },
    grupoId: texto(b.grupoId, P.grupoId, 120).trim(),
    notaNoTicket: typeof b.notaNoTicket === 'boolean' ? b.notaNoTicket : P.notaNoTicket,
    resumoHora: b.resumoHora === '' ? '' : hhmm(b.resumoHora, P.resumoHora),
    ia: typeof b.ia === 'boolean' ? b.ia : P.ia,
    followupMensagem: texto(b.followupMensagem, P.followupMensagem).trim() || P.followupMensagem,
    autoEncerrar: {
      ativo: typeof a.ativo === 'boolean' ? a.ativo : P.autoEncerrar.ativo,
      horasDepoisDoAlerta: num(a.horasDepoisDoAlerta, P.autoEncerrar.horasDepoisDoAlerta, 1, 720),
      mensagem: texto(a.mensagem, P.autoEncerrar.mensagem).trim() || P.autoEncerrar.mensagem,
    },
    ignorar: Array.isArray(b.ignorar)
      ? [...new Set((b.ignorar as unknown[]).map((x) => String(x ?? '').trim()).filter(Boolean))].slice(0, 500)
      : [],
    filas: Array.isArray(b.filas) ? [...new Set((b.filas as unknown[]).map(Number).filter((n) => Number.isInteger(n) && n > 0))] : [],
    linkTicket: texto(b.linkTicket, P.linkTicket, 300).trim() || P.linkTicket,
    credencial: {
      apiId: texto(c.apiId, '', 200).trim(),
      token: texto(c.token, '', 2000).trim(),
      baseUrl: texto(c.baseUrl, '', 300).trim(),
    },
  };
}

// ─── Horário comercial (Brasília, UTC-3 fixo — o Brasil não tem horário de verão desde 2019) ──────────────

const OFFSET_MS = -3 * 3600_000;
const DIA_MS = 86400_000;
const minutosDe = (hora: string) => Number(hora.slice(0, 2)) * 60 + Number(hora.slice(3, 5));

/** Início (em ms UTC) do dia local de Brasília que contém `ms`. */
function inicioDoDiaLocal(ms: number): number {
  const local = ms + OFFSET_MS;
  return local - (((local % DIA_MS) + DIA_MS) % DIA_MS) - OFFSET_MS;
}
const diaDaSemanaLocal = (ms: number) => new Date(ms + OFFSET_MS).getUTCDay();

/** Está dentro do expediente agora? */
export function dentroDoHorario(agora: number, horario: ConfigMonitor['horario']): boolean {
  if (!horario.dias.includes(diaDaSemanaLocal(agora))) return false;
  const min = Math.floor((agora - inicioDoDiaLocal(agora)) / 60_000);
  return min >= minutosDe(horario.inicio) && min < minutosDe(horario.fim);
}

/** Minutos de EXPEDIENTE entre `de` e `ate` (fora do horário e fora dos dias marcados não contam). */
export function minutosUteis(de: number, ate: number, horario: ConfigMonitor['horario']): number {
  if (!(ate > de)) return 0;
  const ini = minutosDe(horario.inicio) * 60_000;
  const fim = minutosDe(horario.fim) * 60_000;
  let total = 0;
  // Limite de segurança: 400 dias de varredura (um ticket nunca deveria passar disso).
  let dia = inicioDoDiaLocal(de);
  for (let i = 0; i < 400 && dia < ate; i++, dia += DIA_MS) {
    if (!horario.dias.includes(diaDaSemanaLocal(dia + 12 * 3600_000))) continue;
    const a = Math.max(de, dia + ini);
    const b = Math.min(ate, dia + fim);
    if (b > a) total += b - a;
  }
  return Math.floor(total / 60_000);
}

/** Próximo instante (ms) em que o expediente está aberto, a partir de `agora` (o próprio agora, se já estiver). */
export function proximaAbertura(agora: number, horario: ConfigMonitor['horario']): number {
  if (dentroDoHorario(agora, horario)) return agora;
  let dia = inicioDoDiaLocal(agora);
  for (let i = 0; i < 15; i++, dia += DIA_MS) {
    if (!horario.dias.includes(diaDaSemanaLocal(dia + 12 * 3600_000))) continue;
    const abre = dia + minutosDe(horario.inicio) * 60_000;
    if (abre >= agora) return abre;
  }
  return agora;
}

/** "Agora" em Brasília: data (AAAA-MM-DD) e hora (HH:MM). */
export function agoraBrasilia(agora: number): { data: string; hora: string } {
  const iso = new Date(agora + OFFSET_MS).toISOString();
  return { data: iso.slice(0, 10), hora: iso.slice(11, 16) };
}

// ─── Leitura das mensagens ──────────────────────────────────────────────────────────────────────────────────

export interface Mensagem {
  id: string;
  fromMe: boolean;
  /** ms UTC */
  ts: number;
  userId: number | null;
  body: string;
  tipo: string;
}

/** Tipos que são do sistema (notas internas, transferências, ligação...) e não contam como conversa. */
const TIPOS_DE_SISTEMA = new Set(['transfer', 'notes', 'note', 'system', 'call_log', 'reaction', 'e2e_notification', 'notification_template', 'protocol']);

/** Converte uma mensagem crua da API da NX (formato do Z-PRO) — campos que faltarem viram vazio. */
export function lerMensagem(m: Record<string, any>): Mensagem | null {
  if (!m || typeof m !== 'object') return null;
  if (m.isDeleted === true) return null;
  const tipo = String(m.mediaType ?? 'chat');
  if (TIPOS_DE_SISTEMA.has(tipo)) return null;
  if (m.dataJson && typeof m.dataJson === 'string' && m.dataJson.includes('"kind"')) return null;
  let ts = Number(m.timestamp);
  if (!Number.isFinite(ts) || ts <= 0) ts = Date.parse(m.createdAt ?? '');
  if (!Number.isFinite(ts)) return null;
  if (ts < 1e12) ts *= 1000; // timestamp em segundos
  const userId = m.userId === null || m.userId === undefined || m.userId === '' ? null : Number(m.userId);
  return {
    id: String(m.id ?? m.messageId ?? ts),
    fromMe: m.fromMe === true || m.fromMe === 'true' || m.fromMe === 1,
    ts,
    userId: Number.isFinite(userId as number) ? (userId as number) : null,
    body: typeof m.body === 'string' ? m.body : '',
    tipo,
  };
}

/** Tira a assinatura "*Jean*:\n" que a ferramenta coloca na frente da mensagem do atendente. */
export function semAssinatura(body: string): string {
  return body.replace(/^\s*\*[^*\n]{1,60}\*\s*:\s*\n?/, '').trim();
}

const normalizar = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();

/** Mensagem do atendente que é humana (com usuário ou assinatura). As automáticas (bot/fluxo) não contam como resposta. */
export function ehDoAtendente(m: Mensagem): boolean {
  return m.fromMe && (m.userId !== null || /^\s*\*[^*\n]{1,60}\*\s*:/.test(m.body));
}

const PROMESSAS = [
  /\bvou (verificar|ver|checar|analisar|conferir|olhar|testar|acionar|encaminhar|falar com|consultar|validar|investigar|levantar|confirmar|resolver|ajustar|providenciar|pedir|solicitar)\b/,
  /\b(vamos|irei|iremos) (verificar|ver|checar|analisar|conferir|olhar|testar|acionar|encaminhar|consultar|validar|investigar|ajustar)\b/,
  /\b(estou|to|tô|estamos|seguimos) (verificando|vendo|checando|analisando|conferindo|olhando|testando|ajustando|resolvendo|investigando)\b/,
  /\b(ja|logo|em breve) (te |lhe |)(retorno|retornamos|volto|voltamos|aviso|falo)\b/,
  /\b(te|lhe) (retorno|aviso|chamo|dou um retorno|dou retorno)\b/,
  /\bretorno (em|ja|logo|assim)\b/,
  /\b(aguarde|aguardem|aguarda)\b/,
  /\b(um|1|so um|so 1) (momento|minuto|minutinho|instante|segundo)\b/,
  /\bdeixa eu (ver|verificar|olhar|checar)\b/,
  /\bassim que (eu |)(tiver|souber|resolver|conseguir|verificar|tivermos)\b/,
  /\b(ja|vou) (passo|passar|repasso|repassar) (para|pra|pro|ao|a)( a| o)? (equipe|time|setor|tecnico|dev|desenvolvimento|responsavel|suporte)\b/,
];

/** A mensagem do atendente promete um retorno? ("vou verificar", "já te retorno", "aguarde"...) */
export function ehPromessa(body: string): boolean {
  const t = normalizar(semAssinatura(body));
  if (!t) return false;
  return PROMESSAS.some((r) => r.test(t));
}

const AGRADECIMENTOS = new Set([
  'ok', 'okay', 'okk', 'okok', 'blz', 'beleza', 'obrigado', 'obrigada', 'obrigadu', 'obg', 'brigado', 'brigada', 'vlw', 'valeu',
  'show', 'perfeito', 'top', 'certo', 'entendi', 'tmj', 'grato', 'grata', 'otimo', 'massa', 'joia', 'bom', 'muito', 'mto', 'mt',
  'sim', 'fechou', 'fechado', 'combinado', 'tranquilo', 'demais', 'legal', 'agradeco', 'agradecido', 'agradecida', 'deu', 'certinho',
  'funcionou', 'resolvido', 'resolveu', 'tudo', 'ja', 'aqui', 'e', 'de', 'nada', 'disponha', 'boa', 'noite', 'tarde', 'dia', 'ate',
  'mais', 'amanha', 'abraco', 'abs', 'excelente', 'maravilha', 'bola', 'opa', 'isso', 'exato', 's', 'kk', 'kkk', 'kkkk', 'rs',
]);

/** "ok", "obrigado!", "👍", "valeu, resolveu" — o cliente só encerrou, não precisa de resposta. */
export function ehAgradecimento(body: string, tipo = 'chat'): boolean {
  if (tipo === 'sticker' || tipo === 'reaction') return true;
  if (!['chat', 'conversation', 'extendedTextMessage', 'text'].includes(tipo)) return false;
  const t = normalizar(body)
    .replace(/[\p{Extended_Pictographic}\u{FE0F}\u{200D}\u{1F3FB}-\u{1F3FF}]/gu, ' ')
    .replace(/[^a-z0-9\s]/g, ' ')
    .trim();
  if (!t) return body.trim().length > 0; // só emoji
  if (t.length > 60) return false;
  return t.split(/\s+/).every((p) => AGRADECIMENTOS.has(p));
}

export interface ResumoConversa {
  ultimaDe: 'cliente' | 'atendente' | null;
  /** Quando o cliente começou a esperar (1ª msg dele depois da última do atendente). */
  esperaDesde: number | null;
  ultimaAtendenteAt: number | null;
  ultimaAtendenteId: string | null;
  ultimoTextoAtendente: string;
  ultimaClienteAt: number | null;
  ultimoTextoCliente: string;
  /** Último movimento de verdade (de qualquer lado). */
  ultimaAt: number | null;
  /** O cliente só agradeceu/deu ok depois da última resposta. */
  clienteEncerrou: boolean;
  /** Minutos úteis entre a 1ª msg do cliente e a 1ª resposta do atendente (null = ainda sem resposta). */
  primeiraRespostaMin: number | null;
  /** id do atendente que respondeu por último. */
  ultimoAtendenteUserId: number | null;
}

/** Lê a conversa inteira (em qualquer ordem) e diz quem está esperando quem. */
export function resumirConversa(cruas: Mensagem[], horario: ConfigMonitor['horario']): ResumoConversa {
  const msgs = [...cruas].sort((a, b) => a.ts - b.ts);
  let ultimaAt: number | null = null;
  let ultimaAtendente: Mensagem | null = null;
  let ultimaCliente: Mensagem | null = null;
  let primeiraCliente: number | null = null;
  let primeiraRespostaMin: number | null = null;
  let esperaDesde: number | null = null;
  let soAgradeceu = true; // desde a última msg do atendente, o cliente só agradeceu?

  for (const m of msgs) {
    if (m.fromMe) {
      if (!ehDoAtendente(m)) continue; // bot/fluxo automático: não é resposta nem pergunta
      if (primeiraCliente !== null && primeiraRespostaMin === null) primeiraRespostaMin = minutosUteis(primeiraCliente, m.ts, horario);
      ultimaAtendente = m;
      esperaDesde = null;
      soAgradeceu = true;
      ultimaAt = m.ts;
    } else {
      if (primeiraCliente === null) primeiraCliente = m.ts;
      ultimaCliente = m;
      ultimaAt = m.ts;
      const agradeceu = ehAgradecimento(m.body, m.tipo);
      if (!agradeceu) soAgradeceu = false;
      // Só começa a esperar com uma mensagem que pede algo (um "ok" sozinho não abre espera).
      if (esperaDesde === null && !agradeceu) esperaDesde = m.ts;
    }
  }

  let ultimaDe: ResumoConversa['ultimaDe'] = null;
  if (ultimaAtendente || ultimaCliente) {
    const tsAt = ultimaAtendente?.ts ?? -1;
    const tsCl = ultimaCliente?.ts ?? -1;
    ultimaDe = tsCl > tsAt ? 'cliente' : 'atendente';
  }
  const clienteEncerrou = ultimaDe === 'cliente' && esperaDesde === null && soAgradeceu && !!ultimaAtendente;

  return {
    ultimaDe,
    esperaDesde: ultimaDe === 'cliente' ? esperaDesde : null,
    ultimaAtendenteAt: ultimaAtendente?.ts ?? null,
    ultimaAtendenteId: ultimaAtendente?.id ?? null,
    ultimoTextoAtendente: ultimaAtendente ? semAssinatura(ultimaAtendente.body).slice(0, 500) : '',
    ultimaClienteAt: ultimaCliente?.ts ?? null,
    ultimoTextoCliente: ultimaCliente ? (ultimaCliente.body || `[${ultimaCliente.tipo}]`).slice(0, 500) : '',
    ultimaAt,
    clienteEncerrou,
    primeiraRespostaMin,
    ultimoAtendenteUserId: ultimaAtendente?.userId ?? null,
  };
}

// ─── Classificação ──────────────────────────────────────────────────────────────────────────────────────────

export interface EstadoTicket {
  status: string; // open | pending
  userId: number | null;
  criadoEm: number | null;
  /** Quando o monitor viu o ticket pendente pela 1ª vez (ou a abertura). */
  pendenteDesde: number | null;
}

export interface Classificacao {
  situacao: Situacao;
  /** Início do relógio da situação (ms). */
  desde: number | null;
  /** Tempo contado no relógio da situação, em minutos (úteis ou corridos, conforme a situação). */
  decorridoMin: number;
  prazoMin: number;
  /** 0 = no prazo, 1 = estourou, 2 = escalado (passou de prazo × escalarEm). */
  nivel: 0 | 1 | 2;
  /** Aberto há mais dias do que o limite (tempo corrido desde a abertura). */
  abertoLongo: boolean;
  idadeDias: number;
  contaHorarioComercial: boolean;
}

export function classificar(
  t: EstadoTicket,
  r: ResumoConversa,
  cfg: ConfigMonitor,
  agora: number,
  classeIa: ClasseIa | null = null,
): Classificacao {
  const idadeDias = t.criadoEm ? Math.max(0, (agora - t.criadoEm) / DIA_MS) : 0;
  const abertoLongo = idadeDias >= cfg.prazos.abertoDias;
  let situacao: Situacao = 'ok';
  let desde: number | null = null;
  let uteis = true;
  let prazoMin = 0;

  if (t.status === 'pending' && !t.userId) {
    situacao = 'fila';
    desde = t.pendenteDesde ?? t.criadoEm ?? r.ultimaAt;
    prazoMin = cfg.prazos.filaMin;
  } else if (r.ultimaDe === 'cliente' && r.esperaDesde !== null) {
    situacao = 'sem_resposta';
    desde = r.esperaDesde;
    prazoMin = cfg.prazos.semRespostaMin;
  } else if (r.ultimaDe === 'atendente' || r.clienteEncerrou) {
    const promessa = classeIa ? classeIa === 'promessa' : ehPromessa(r.ultimoTextoAtendente);
    if (promessa && !r.clienteEncerrou) {
      situacao = 'promessa';
      desde = r.ultimaAtendenteAt;
      prazoMin = cfg.prazos.promessaMin;
    } else {
      situacao = 'cliente_parou';
      desde = r.ultimaAt;
      prazoMin = cfg.prazos.clienteParouHoras * 60;
      uteis = false;
    }
  }

  if (situacao === 'ok' || desde === null) {
    return { situacao: 'ok', desde: null, decorridoMin: 0, prazoMin: 0, nivel: 0, abertoLongo, idadeDias, contaHorarioComercial: true };
  }
  const decorridoMin = uteis ? minutosUteis(desde, agora, cfg.horario) : Math.max(0, Math.floor((agora - desde) / 60_000));
  const nivel: 0 | 1 | 2 = decorridoMin >= prazoMin * cfg.escalarEm ? 2 : decorridoMin >= prazoMin ? 1 : 0;
  return { situacao, desde, decorridoMin, prazoMin, nivel, abertoLongo, idadeDias, contaHorarioComercial: uteis };
}

/** "8 min", "1h20", "3h", "2 dias" */
export function formatarDuracao(min: number): string {
  const m = Math.max(0, Math.round(min));
  if (m < 60) return `${m} min`;
  if (m < 24 * 60) {
    const h = Math.floor(m / 60);
    const r = m % 60;
    return r ? `${h}h${String(r).padStart(2, '0')}` : `${h}h`;
  }
  const d = Math.floor(m / (24 * 60));
  const h = Math.floor((m % (24 * 60)) / 60);
  return h ? `${d}d ${h}h` : `${d} ${d === 1 ? 'dia' : 'dias'}`;
}

/** Nome para comparar: sem acento, minúsculo, só letras/números e um espaço entre as palavras. */
const nomeComparavel = (s: string) =>
  normalizar(s)
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

/**
 * O contato deve ser ignorado? Cada item da lista é um número / id de grupo (8+ dígitos, compara só os
 * dígitos) ou um TRECHO do nome, sem diferenciar acento e maiúscula: "mercado nunes" pega
 * "Mercado Nunes - Suporte" e "SUPORTE GERAL" pega "Suporte Geral NX".
 */
export function estaIgnorado(ignorar: string[], contato: { numero?: string | null; nome?: string | null }): boolean {
  if (!ignorar.length) return false;
  const dig = (s: string) => s.replace(/\D/g, '');
  const numero = dig(contato.numero ?? '');
  const nome = ` ${nomeComparavel(contato.nome ?? '')} `;
  return ignorar.some((i) => {
    const d = dig(i);
    const ehNumero = d.length >= 8 && !/[a-z]/i.test(i.replace(/@(g\.us|c\.us|s\.whatsapp\.net)/gi, ''));
    if (ehNumero) return !!numero && (numero === d || numero.endsWith(d) || d.endsWith(numero));
    const trecho = nomeComparavel(i);
    // O trecho tem de começar no início de uma palavra ("isabel" pega "Isabela", mas "bel" não pega
    // "Isabel"); mínimo de 3 letras para não ignorar demais.
    return trecho.length >= 3 && nome.trim().length > 0 && nome.includes(` ${trecho}`);
  });
}
