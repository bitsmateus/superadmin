/**
 * Integração de LEITURA com a 3C Plus (discador do SDR/closer) — só relatório, nada de criar campanha,
 * mexer em lista ou derrubar agente. Docs: https://api-docs.3c.plus (swagger em app.3c.plus/api/v1/swagger.json).
 *
 * Autenticação: header `Authorization: Bearer <token>`. Serve o api_token de um usuário GESTOR (manager)
 * da 3C ou um token de serviço `3cs_...` (Configurações › Integração › Tokens de serviço) com papel de
 * gestor. Token de papel `agent` NÃO serve: os endpoints de relatório (/calls, /agents/status) são só
 * de gestor. O token fica SÓ no servidor (THREEC_API_TOKEN), nunca vai pro navegador.
 *
 * Os campos de cada ligação variam entre versões da 3C, então a leitura é tolerante (pega o primeiro
 * nome de campo que existir). Se algum número sair zerado, a rota /api/ligacoes-3c/bruto mostra as
 * chaves que a 3C está mandando de verdade — é só ajustar a lista de nomes aqui.
 */

const TIMEOUT = 25000;
const POR_PAGINA = 100;
/** Teto de páginas por consulta (6.000 ligações). Passou disso, o relatório avisa que cortou. */
const MAX_PAGINAS = 60;

export interface Config3C {
  baseUrl: string; // ex.: https://nxnetscale.3c.plus/api/v1
  token: string;
}

export function config3C(): Config3C | null {
  const token = (process.env.THREEC_API_TOKEN ?? '').trim();
  let url = (process.env.THREEC_API_URL ?? '').trim().replace(/\/+$/, '');
  if (!token || !url) return null;
  if (!/^https?:\/\//i.test(url)) url = `https://${url}`;
  // Aceita só o domínio (nxnetscale.3c.plus) ou já com /api/v1.
  if (!/\/api\/v\d+$/i.test(url)) url = `${url}/api/v1`;
  return { baseUrl: url, token };
}

export class Erro3C extends Error {
  constructor(message: string, public status: number) {
    super(message);
  }
}

type Params = Record<string, string | number | boolean | undefined>;

function montarUrl(cfg: Config3C, caminho: string, params: Params = {}): string {
  const u = new URL(`${cfg.baseUrl}${caminho.startsWith('/') ? '' : '/'}${caminho}`);
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== '') u.searchParams.set(k, String(v));
  return u.toString();
}

async function chamar(cfg: Config3C, caminho: string, params: Params = {}): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT);
  try {
    const res = await fetch(montarUrl(cfg, caminho, params), {
      headers: { Authorization: `Bearer ${cfg.token}`, Accept: 'application/json' },
      signal: ctrl.signal,
    });
    if (res.status === 401) throw new Erro3C('A 3C recusou o token (inválido, expirado ou revogado). Gere outro e atualize THREEC_API_TOKEN.', 502);
    if (res.status === 403) throw new Erro3C('O token da 3C não tem permissão de gestor pra ler relatórios.', 502);
    if (!res.ok) {
      const corpo = await res.text().catch(() => '');
      throw new Erro3C(`A 3C respondeu ${res.status} em ${caminho}: ${corpo.slice(0, 200)}`, 502);
    }
    return res;
  } catch (e) {
    if (e instanceof Erro3C) throw e;
    if ((e as Error).name === 'AbortError') throw new Erro3C('A 3C demorou demais pra responder. Tente de novo.', 504);
    throw new Erro3C(`Não consegui falar com a 3C: ${(e as Error).message}`, 502);
  } finally {
    clearTimeout(timer);
  }
}

export async function get3C<T = unknown>(cfg: Config3C, caminho: string, params: Params = {}): Promise<T> {
  const res = await chamar(cfg, caminho, params);
  return (await res.json()) as T;
}

/** Áudio da gravação (mp3/wav), pra tocar dentro do painel sem expor o token. */
export async function gravacao3C(cfg: Config3C, callId: string): Promise<{ tipo: string; dados: Buffer }> {
  const res = await chamar(cfg, `/calls/${encodeURIComponent(callId)}/recording`);
  return { tipo: res.headers.get('content-type') ?? 'audio/mpeg', dados: Buffer.from(await res.arrayBuffer()) };
}

interface Paginado {
  data?: unknown;
  meta?: { pagination?: { total_pages?: number; current_page?: number } };
}

/** Todas as ligações do período (paginando /calls). Datas no formato YYYY-MM-DD, horário da conta 3C. */
export async function listarLigacoes(cfg: Config3C, inicio: string, fim: string): Promise<{ itens: unknown[]; cortado: boolean }> {
  const itens: unknown[] = [];
  for (let pagina = 1; pagina <= MAX_PAGINAS; pagina++) {
    const resp = await get3C<Paginado>(cfg, '/calls', {
      start_date: `${inicio} 00:00:00`,
      end_date: `${fim} 23:59:59`,
      per_page: POR_PAGINA,
      page: pagina,
      with_mailing: false,
    });
    const lote = Array.isArray(resp.data) ? resp.data : [];
    itens.push(...lote);
    const total = resp.meta?.pagination?.total_pages;
    if (lote.length < POR_PAGINA || (total && pagina >= total)) return { itens, cortado: false };
  }
  return { itens, cortado: true };
}

// ---------------------------------------------------------------------------------------------
// Leitura tolerante dos campos
// ---------------------------------------------------------------------------------------------

type Obj = Record<string, unknown>;

function ehObj(v: unknown): v is Obj {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

/** Primeiro valor não vazio entre os caminhos ("agent.name" entra em objeto). */
function pegar(o: Obj, ...caminhos: string[]): unknown {
  for (const c of caminhos) {
    let v: unknown = o;
    for (const parte of c.split('.')) v = ehObj(v) ? v[parte] : undefined;
    if (v !== undefined && v !== null && v !== '') return v;
  }
  return undefined;
}

function texto(v: unknown): string {
  if (v === undefined || v === null) return '';
  if (ehObj(v)) return texto(v.name ?? v.nome ?? v.title ?? v.id);
  return String(v).trim();
}

/** Duração em segundos: aceita número (s), "HH:MM:SS", "MM:SS" ou texto numérico. */
export function segundos(v: unknown): number {
  if (typeof v === 'number' && Number.isFinite(v)) return Math.max(0, Math.round(v));
  if (typeof v !== 'string') return 0;
  const s = v.trim();
  if (/^\d+(\.\d+)?$/.test(s)) return Math.round(Number(s));
  const partes = s.split(':').map(Number);
  if (partes.length >= 2 && partes.length <= 3 && partes.every((n) => Number.isFinite(n))) {
    return partes.reduce((acc, n) => acc * 60 + n, 0);
  }
  return 0;
}

/** "2026-10-29 14:05:10" / ISO → { dia: "2026-10-29", hora: 14, hhmm: "14:05" } no horário da conta. */
export function quando(v: unknown): { dia: string; hora: number; hhmm: string; iso: string } | null {
  const s = texto(v);
  if (!s) return null;
  // Formato da 3C sem fuso (já é o horário local da conta): usa como está.
  const m = s.match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}):(\d{2})/);
  if (m && !/[zZ]|[+-]\d{2}:?\d{2}$/.test(s)) {
    return { dia: m[1], hora: Number(m[2]), hhmm: `${m[2]}:${m[3]}`, iso: `${m[1]}T${m[2]}:${m[3]}` };
  }
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return null;
  // Com fuso: converte pra Brasília (-03:00, sem horário de verão).
  const local = new Date(d.getTime() - 3 * 3600 * 1000);
  const iso = local.toISOString();
  return { dia: iso.slice(0, 10), hora: Number(iso.slice(11, 13)), hhmm: iso.slice(11, 16), iso: iso.slice(0, 16) };
}

export interface Ligacao {
  id: string;
  dia: string;
  hora: number;
  hhmm: string;
  quando: string;
  agenteId: string;
  agente: string;
  campanha: string;
  numero: string;
  status: string;
  qualificacao: string;
  modo: string; // discador | manual | receptivo | ''
  tempoFalado: number; // segundos falando com o agente
  tempoEspera: number;
  atendida: boolean; // alguém atendeu e falou com o agente
  temGravacao: boolean;
}

export function normalizarLigacao(raw: unknown): Ligacao | null {
  if (!ehObj(raw)) return null;
  const q = quando(pegar(raw, 'call_date', 'call_date_rfc3339', 'calling_at', 'started_at', 'created_at', 'date'));
  if (!q) return null;

  const tempoFalado = segundos(
    pegar(raw, 'speaking_with_agent_time', 'speaking_time', 'talking_time', 'conversation_time', 'billed_time', 'duration'),
  );
  const agente = texto(pegar(raw, 'agent.name', 'agent_name', 'agent'));
  const agenteId = texto(pegar(raw, 'agent_id', 'agent.id'));
  const status = texto(pegar(raw, 'readable_status_text', 'status_text', 'readable_status', 'status.name', 'status'));
  const qualificacao = texto(pegar(raw, 'qualification.name', 'qualification_name', 'qualification'));

  const modoBruto = texto(pegar(raw, 'call_mode', 'mode', 'type')).toLowerCase();
  const modo = /manual/.test(modoBruto) ? 'manual' : /recept|inbound/.test(modoBruto) ? 'receptivo' : /dial|discad|predict/.test(modoBruto) ? 'discador' : '';

  return {
    id: texto(pegar(raw, 'id', 'call_id', 'sid')),
    dia: q.dia,
    hora: q.hora,
    hhmm: q.hhmm,
    quando: q.iso,
    agenteId,
    agente: agente || (agenteId ? `Agente ${agenteId}` : ''),
    campanha: texto(pegar(raw, 'campaign.name', 'campaign_name', 'campaign')),
    numero: texto(pegar(raw, 'number', 'phone', 'phone_number', 'destination')),
    status,
    qualificacao,
    modo,
    tempoFalado,
    tempoEspera: segundos(pegar(raw, 'waiting_time', 'ringing_time', 'wait_time')),
    // Atendida = teve conversa com o agente. Status textual entra como reforço quando o tempo não vem.
    atendida:
      tempoFalado > 0 ||
      (/atendid|answered|conectad|connected/i.test(status) && !/n[aã]o|not|sem |abandon|fail|falh/i.test(status)),
    temGravacao: !!pegar(raw, 'recorded', 'record_file', 'recording', 'recording_url'),
  };
}

// ---------------------------------------------------------------------------------------------
// Agregação do relatório (puro, testável)
// ---------------------------------------------------------------------------------------------

export interface LinhaAgente {
  agente: string;
  chamadas: number;
  atendidas: number;
  taxaAtendimento: number; // 0..1
  tempoFalado: number;
  tempoMedio: number; // média de fala só das atendidas
  manuais: number;
  discador: number;
  primeira: string | null; // "2026-10-29T09:31"
  ultima: string | null;
  diasComLigacao: number;
  qualificacoes: { nome: string; qtd: number }[];
}

export interface Relatorio3C {
  totais: {
    chamadas: number;
    atendidas: number;
    taxaAtendimento: number;
    tempoFalado: number;
    tempoMedio: number;
    agentes: number;
  };
  porAgente: LinhaAgente[];
  porHora: { hora: number; chamadas: number; atendidas: number }[];
  porDia: { dia: string; chamadas: number; atendidas: number; tempoFalado: number }[];
  porQualificacao: { nome: string; qtd: number }[];
  ultimas: Ligacao[];
}

const razao = (a: number, b: number) => (b > 0 ? a / b : 0);

function contar(lista: string[]): { nome: string; qtd: number }[] {
  const m = new Map<string, number>();
  for (const n of lista) if (n) m.set(n, (m.get(n) ?? 0) + 1);
  return [...m.entries()].map(([nome, qtd]) => ({ nome, qtd })).sort((a, b) => b.qtd - a.qtd);
}

export function montarRelatorio(ligacoes: Ligacao[], limiteUltimas = 300): Relatorio3C {
  const atendidas = ligacoes.filter((l) => l.atendida);
  const tempoFalado = ligacoes.reduce((s, l) => s + l.tempoFalado, 0);

  const grupos = new Map<string, Ligacao[]>();
  for (const l of ligacoes) {
    const chave = l.agente || 'Sem agente (discador não conectou)';
    const g = grupos.get(chave);
    if (g) g.push(l);
    else grupos.set(chave, [l]);
  }

  const porAgente: LinhaAgente[] = [...grupos.entries()].map(([agente, ls]) => {
    const at = ls.filter((l) => l.atendida);
    const falado = ls.reduce((s, l) => s + l.tempoFalado, 0);
    const ordenadas = ls.map((l) => l.quando).sort();
    return {
      agente,
      chamadas: ls.length,
      atendidas: at.length,
      taxaAtendimento: razao(at.length, ls.length),
      tempoFalado: falado,
      tempoMedio: Math.round(razao(falado, at.length)),
      manuais: ls.filter((l) => l.modo === 'manual').length,
      discador: ls.filter((l) => l.modo === 'discador').length,
      primeira: ordenadas[0] ?? null,
      ultima: ordenadas[ordenadas.length - 1] ?? null,
      diasComLigacao: new Set(ls.map((l) => l.dia)).size,
      qualificacoes: contar(ls.map((l) => l.qualificacao)),
    };
  });
  porAgente.sort((a, b) => b.chamadas - a.chamadas);

  const horas = new Map<number, { chamadas: number; atendidas: number }>();
  for (const l of ligacoes) {
    const h = horas.get(l.hora) ?? { chamadas: 0, atendidas: 0 };
    h.chamadas++;
    if (l.atendida) h.atendidas++;
    horas.set(l.hora, h);
  }
  const horasUsadas = [...horas.keys()];
  const de = Math.min(8, ...horasUsadas);
  const ate = Math.max(18, ...horasUsadas);
  const porHora = [];
  for (let h = de; h <= ate; h++) porHora.push({ hora: h, ...(horas.get(h) ?? { chamadas: 0, atendidas: 0 }) });

  const dias = new Map<string, { chamadas: number; atendidas: number; tempoFalado: number }>();
  for (const l of ligacoes) {
    const d = dias.get(l.dia) ?? { chamadas: 0, atendidas: 0, tempoFalado: 0 };
    d.chamadas++;
    if (l.atendida) d.atendidas++;
    d.tempoFalado += l.tempoFalado;
    dias.set(l.dia, d);
  }

  return {
    totais: {
      chamadas: ligacoes.length,
      atendidas: atendidas.length,
      taxaAtendimento: razao(atendidas.length, ligacoes.length),
      tempoFalado,
      tempoMedio: Math.round(razao(tempoFalado, atendidas.length)),
      agentes: [...grupos.keys()].filter((k) => !k.startsWith('Sem agente')).length,
    },
    porAgente,
    porHora,
    porDia: [...dias.entries()].map(([dia, v]) => ({ dia, ...v })).sort((a, b) => a.dia.localeCompare(b.dia)),
    porQualificacao: contar(ligacoes.map((l) => l.qualificacao)),
    ultimas: [...ligacoes].sort((a, b) => b.quando.localeCompare(a.quando)).slice(0, limiteUltimas),
  };
}

// ---------------------------------------------------------------------------------------------
// Status ao vivo dos agentes
// ---------------------------------------------------------------------------------------------

export interface AgenteAgora {
  id: string;
  nome: string;
  status: string; // texto pronto pra tela
  situacao: 'ligando' | 'livre' | 'pausa' | 'pos' | 'offline' | 'outro';
  campanha: string;
  desde: string | null;
}

/**
 * Status numérico de agente na 3C (mesma ordem dos eventos de tempo real: idle, on call, ACW, manual,
 * manual ACW, work break). Se a 3C mandar o texto pronto, ele tem prioridade sobre este mapa.
 */
const STATUS_AGENTE: Record<string, { texto: string; situacao: AgenteAgora['situacao'] }> = {
  '0': { texto: 'Offline', situacao: 'offline' },
  '1': { texto: 'Livre (aguardando ligação)', situacao: 'livre' },
  '2': { texto: 'Em ligação', situacao: 'ligando' },
  '3': { texto: 'Pós-atendimento (TPA)', situacao: 'pos' },
  '4': { texto: 'Modo manual', situacao: 'ligando' },
  '5': { texto: 'Pós-atendimento manual', situacao: 'pos' },
  '6': { texto: 'Em intervalo', situacao: 'pausa' },
};

function situacaoPorTexto(t: string): AgenteAgora['situacao'] {
  const s = t.toLowerCase();
  if (/offline|deslog|logged.?out/.test(s)) return 'offline';
  if (/interval|pausa|break/.test(s)) return 'pausa';
  if (/tpa|acw|p[oó]s/.test(s)) return 'pos';
  if (/liga|call|falando|manual/.test(s)) return 'ligando';
  if (/livre|idle|ocios|aguard/.test(s)) return 'livre';
  return 'outro';
}

export function normalizarAgentes(resp: unknown): AgenteAgora[] {
  const dados = ehObj(resp) ? resp.data ?? resp : resp;
  const lista: unknown[] = Array.isArray(dados) ? dados : ehObj(dados) ? Object.values(dados) : [];
  const saida: AgenteAgora[] = [];
  for (const raw of lista) {
    if (!ehObj(raw)) continue;
    const bruto = pegar(raw, 'status', 'agent_status', 'state');
    const textoPronto = texto(pegar(raw, 'readable_status', 'status_text', 'status.name', 'work_break.name'));
    const mapa = typeof bruto === 'number' || /^\d+$/.test(String(bruto ?? '')) ? STATUS_AGENTE[String(bruto)] : undefined;
    const status = textoPronto || mapa?.texto || texto(bruto) || 'Desconhecido';
    saida.push({
      id: texto(pegar(raw, 'id', 'agent_id', 'user_id')),
      nome: texto(pegar(raw, 'name', 'agent.name', 'user.name', 'agent_name')) || 'Agente',
      status,
      situacao: mapa?.situacao ?? situacaoPorTexto(status),
      campanha: texto(pegar(raw, 'campaign.name', 'logged_campaign.name', 'campaign_name', 'campaign')),
      desde: texto(pegar(raw, 'status_start_time', 'since', 'updated_at')) || null,
    });
  }
  return saida.sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
}

/** Resumo das chaves que a 3C manda (pra ajustar nomes de campo sem adivinhar). Sem telefone. */
export function amostraDeCampos(itens: unknown[]): { chaves: string[]; exemplo: Obj | null } {
  const chaves = new Set<string>();
  for (const it of itens.slice(0, 20)) {
    if (!ehObj(it)) continue;
    for (const [k, v] of Object.entries(it)) {
      chaves.add(k);
      if (ehObj(v)) for (const k2 of Object.keys(v)) chaves.add(`${k}.${k2}`);
    }
  }
  const primeiro = itens.find(ehObj) ?? null;
  const exemplo = primeiro
    ? Object.fromEntries(
        Object.entries(primeiro).map(([k, v]) => [k, /phone|number|mailing|identifier|cpf|nome|name/i.test(k) && !ehObj(v) ? '[oculto]' : v]),
      )
    : null;
  return { chaves: [...chaves].sort(), exemplo };
}
