import { createHash, timingSafeEqual } from 'node:crypto';
import { normalizaNome } from './normalizaNome.js';

/** Funções puras da API de integração (n8n) — ficam fora da rota pra poderem ser testadas sem banco. */

// ── Chave de API ────────────────────────────────────────────────────────────

/** Compara a chave enviada com a esperada em tempo constante (hash dos dois lados pra igualar tamanho). */
export function chaveValida(enviada: unknown, esperada: string): boolean {
  if (typeof enviada !== 'string' || !enviada || !esperada) return false;
  const a = createHash('sha256').update(enviada).digest();
  const b = createHash('sha256').update(esperada).digest();
  return timingSafeEqual(a, b);
}

// ── Telefone ────────────────────────────────────────────────────────────────

function soDigitos(raw: string | null | undefined): string {
  return (raw ?? '').replace(/\D/g, '').replace(/^0+/, '');
}

/** Telefone só com dígitos e com 55 na frente (DDD + 8/9 dígitos). null se não der pra montar um
 * número brasileiro completo (vazio, sem DDD, tamanho estranho) — o telefone no banco é texto livre. */
export function telefoneComDdi(raw: string | null | undefined): string | null {
  const d = soDigitos(raw);
  if (d.length === 10 || d.length === 11) return `55${d}`;
  if ((d.length === 12 || d.length === 13) && d.startsWith('55')) return d;
  return null;
}

export interface ChaveTelefone {
  ddd: string | null;
  ultimos8: string;
}

/** Chave de comparação que ignora o 55 e o 9 extra: DDD (se vier) + últimos 8 dígitos. */
export function chaveTelefone(raw: string | null | undefined): ChaveTelefone | null {
  let d = soDigitos(raw);
  if (d.startsWith('55') && d.length >= 12) d = d.slice(2);
  if (d.length === 10 || d.length === 11) return { ddd: d.slice(0, 2), ultimos8: d.slice(-8) };
  if (d.length === 8 || d.length === 9) return { ddd: null, ultimos8: d.slice(-8) };
  return null;
}

/** Dois telefones são o mesmo número? Tolera com/sem 55 e com/sem o 9. Se um deles não tem DDD, só
 * os 8 dígitos finais decidem. */
export function mesmoTelefone(a: string | null | undefined, b: string | null | undefined): boolean {
  const ka = chaveTelefone(a);
  const kb = chaveTelefone(b);
  if (!ka || !kb || ka.ultimos8 !== kb.ultimos8) return false;
  return !ka.ddd || !kb.ddd || ka.ddd === kb.ddd;
}

// ── Coluna ──────────────────────────────────────────────────────────────────

export interface ColunaRef {
  id: string;
  name: string;
  page: string;
}

/**
 * Ids das colunas que casam com o nome pedido, ignorando maiúscula, acento, pontuação e espaços.
 * Em cada quadro (page), nome IGUAL ganha; se não houver igual, vale "começa com" — assim
 * "DISPARO EM MASSA" acha "Disparo em massa após 7 dias" e "FOLLOW UP PROPOSTAS" acha "Followup Propostas".
 */
export function colunasQueCasam(colunas: ColunaRef[], pedido: string): string[] {
  const alvo = normalizaNome(pedido);
  if (!alvo) return [];
  const porQuadro = new Map<string, ColunaRef[]>();
  for (const c of colunas) porQuadro.set(c.page, [...(porQuadro.get(c.page) ?? []), c]);
  const ids: string[] = [];
  for (const lista of porQuadro.values()) {
    const iguais = lista.filter((c) => normalizaNome(c.name) === alvo);
    const achadas = iguais.length ? iguais : lista.filter((c) => normalizaNome(c.name).startsWith(alvo));
    ids.push(...achadas.map((c) => c.id));
  }
  return ids;
}

// ── Datas ───────────────────────────────────────────────────────────────────

/** ISO completo passa direto; só a data (AAAA-MM-DD) vale 00:00 no horário de Brasília (-03:00).
 * null = inválida. */
export function parseDataIntegracao(raw: unknown): Date | null {
  if (typeof raw !== 'string' || !raw.trim()) return null;
  const v = raw.trim();
  const d = new Date(/^\d{4}-\d{2}-\d{2}$/.test(v) ? `${v}T00:00:00-03:00` : v);
  return Number.isNaN(d.getTime()) ? null : d;
}

// ── Validação do PATCH ──────────────────────────────────────────────────────

export const REGUAS = ['', 'disparo', 'proposta'] as const;
export const REGUA_STATUS = ['', 'ativa', 'respondeu', 'encerrada', 'optout'] as const;

/** Campos de texto aceitos: nome na API -> coluna em lead_rows (com apelidos curtos). */
const CAMPOS_TEXTO: Record<string, string> = {
  status: 'status',
  agendamento: 'agendamento',
  retornar: 'retornar',
  sdr: 'sdr',
  dor_cliente: 'dor_cliente',
  dor: 'dor_cliente',
  numero_atendentes: 'numero_atendentes',
  atendentes: 'numero_atendentes',
  valor_mrr: 'valor_mrr',
  mrr: 'valor_mrr',
  valor_implementacao: 'valor_implementacao',
  implementacao: 'valor_implementacao',
  regua_etapa: 'regua_etapa',
};

export interface PatchValidado {
  campos: Record<string, unknown>; // coluna em lead_rows -> valor
  coluna?: string; // nome da coluna de destino
  boardId?: string; // id da coluna de destino
  etiquetas?: unknown; // pedido bruto {"Disparo":"D7"}; resolvido na rota contra as etiquetas da aba
  erro?: string;
}

function parseBool(v: unknown): boolean | null {
  if (typeof v === 'boolean') return v;
  if (v === 1 || v === 0) return v === 1;
  if (typeof v === 'string') {
    const n = normalizaNome(v);
    if (['sim', 'true', '1', 's'].includes(n)) return true;
    if (['nao', 'false', '0', 'n'].includes(n)) return false;
  }
  return null;
}

/** Valida o corpo do PATCH. Campo desconhecido é erro (typo não pode passar calado). */
export function validarPatchIntegracao(body: unknown): PatchValidado {
  const out: PatchValidado = { campos: {} };
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { ...out, erro: 'Corpo inválido: envie um objeto JSON.' };
  const b = body as Record<string, unknown>;

  for (const [chave, valor] of Object.entries(b)) {
    if (chave === 'coluna') {
      if (typeof valor !== 'string' || !valor.trim()) return { ...out, erro: '"coluna" deve ser um texto não vazio.' };
      out.coluna = valor;
    } else if (chave === 'board_id' || chave === 'coluna_id') {
      if (typeof valor !== 'string' || !/^[0-9a-f-]{36}$/i.test(valor)) return { ...out, erro: `"${chave}" deve ser um UUID.` };
      out.boardId = valor;
    } else if (chave in CAMPOS_TEXTO) {
      if (valor !== null && typeof valor !== 'string' && typeof valor !== 'number') return { ...out, erro: `"${chave}" deve ser texto ou número.` };
      out.campos[CAMPOS_TEXTO[chave]] = valor === null ? '' : String(valor).trim();
    } else if (chave === 'regua' || chave === 'regua_status') {
      const lista: readonly string[] = chave === 'regua' ? REGUAS : REGUA_STATUS;
      const v = valor === null ? '' : typeof valor === 'string' ? valor.trim().toLowerCase() : null;
      if (v === null || !lista.includes(v)) {
        return { ...out, erro: `"${chave}" inválido. Valores aceitos: ${lista.map((x) => (x ? x : '""')).join(', ')}.` };
      }
      out.campos[chave] = v;
    } else if (chave === 'regua_ultimo_envio_em') {
      if (valor === null || valor === '') out.campos[chave] = null;
      else {
        const d = parseDataIntegracao(valor);
        if (!d) return { ...out, erro: '"regua_ultimo_envio_em" deve ser uma data ISO válida.' };
        out.campos[chave] = d.toISOString();
      }
    } else if (chave === 'etiquetas') {
      if (!valor || typeof valor !== 'object' || Array.isArray(valor)) {
        return { ...out, erro: '"etiquetas" deve ser um objeto, ex.: {"Disparo":"D7"}.' };
      }
      out.etiquetas = valor;
    } else if (chave === 'optout') {
      const v = parseBool(valor);
      if (v === null) return { ...out, erro: '"optout" deve ser true/false (ou "sim"/"não").' };
      out.campos[chave] = v;
    } else {
      return { ...out, erro: `Campo não permitido: "${chave}".` };
    }
  }

  if (out.coluna && out.boardId) return { ...out, erro: 'Envie "coluna" OU "board_id", não os dois.' };
  // Marcar opt-out sem dizer o status da régua encerra a régua: ninguém pode continuar recebendo.
  if (out.campos.optout === true && !('regua_status' in out.campos)) out.campos.regua_status = 'optout';
  if (!Object.keys(out.campos).length && !out.coluna && !out.boardId && !out.etiquetas) return { ...out, erro: 'Nada para atualizar.' };
  return out;
}

/** Texto puro vira HTML seguro pro bloco de Atualizações (que renderiza HTML sanitizado). */
export function textoParaHtml(texto: string): string {
  const esc = texto.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return `<p>${esc.replace(/\r?\n/g, '<br>')}</p>`;
}

// ── Colunas de etiqueta ─────────────────────────────────────────────────────

/** As colunas "de etiqueta" do quadro (as de bolinha colorida), com o nome como aparece na tela, o
 * `field` em lead_labels e a coluna em lead_rows. Cada aba tem seu próprio conjunto de etiquetas por
 * field (SDR é global). */
export const COLUNAS_ETIQUETA = [
  { nome: 'Tipo', field: 'tipo', coluna: 'tipo' },
  { nome: 'Dia de contato', field: 'dia_contato', coluna: 'dia_contato' },
  { nome: 'Lig.', field: 'ligacao', coluna: 'ligacao' },
  { nome: 'Status', field: 'status', coluna: 'status' },
  { nome: 'Follow-up', field: 'followup', coluna: 'followup' },
  { nome: 'Disparo', field: 'disparo', coluna: 'disparo' },
  { nome: 'SDR', field: 'sdr', coluna: 'sdr' },
] as const;

/** Etiquetas cadastradas na aba, por field. Campo sem nenhuma etiqueta na aba = coluna não existe lá. */
export type OpcoesEtiqueta = Record<string, string[]>;

/** { "<coluna>": "<etiqueta atual ou ''>" } com as colunas de etiqueta que a aba do card tem. */
export function montarEtiquetas(valores: Record<string, string | null | undefined>, opcoes: OpcoesEtiqueta): Record<string, string> {
  const out: Record<string, string> = {};
  for (const c of COLUNAS_ETIQUETA) {
    if (opcoes[c.field]?.length) out[c.nome] = valores[c.coluna] ?? '';
  }
  return out;
}

export interface EtiquetasResolvidas {
  campos: Record<string, string>; // coluna em lead_rows -> nome EXATO da etiqueta ('' = limpar)
  erro?: string;
  validas?: Record<string, string[]>; // coluna -> etiquetas válidas (vai junto do 400)
}

/**
 * Valida {"Disparo":"D7"} contra as etiquetas que já existem na aba. Coluna e etiqueta são comparadas
 * sem diferenciar maiúscula/acento/pontuação; a coluna vale pelo nome da tela ("Follow-up") ou pelo
 * field ("followup"). Nunca cria etiqueta: inexistente é erro e devolve a lista das válidas. '' ou
 * null limpa a coluna.
 */
export function resolverEtiquetas(pedido: unknown, opcoes: OpcoesEtiqueta): EtiquetasResolvidas {
  const disponiveis = COLUNAS_ETIQUETA.filter((c) => opcoes[c.field]?.length);
  const validas: Record<string, string[]> = {};
  for (const c of disponiveis) validas[c.nome] = opcoes[c.field];
  const campos: Record<string, string> = {};
  if (!pedido || typeof pedido !== 'object' || Array.isArray(pedido)) {
    return { campos, validas, erro: '"etiquetas" deve ser um objeto, ex.: {"Disparo":"D7"}.' };
  }
  for (const [chave, valor] of Object.entries(pedido as Record<string, unknown>)) {
    const alvo = normalizaNome(chave);
    const col = disponiveis.find((c) => normalizaNome(c.nome) === alvo || normalizaNome(c.field) === alvo);
    if (!alvo || !col) {
      return { campos, validas, erro: `Coluna de etiqueta "${chave}" não existe neste quadro. Válidas: ${disponiveis.map((c) => c.nome).join(', ') || '(nenhuma)'}.` };
    }
    if (col.coluna in campos) return { campos, validas, erro: `Coluna "${col.nome}" aparece mais de uma vez em "etiquetas".` };
    if (valor === null || valor === '') {
      campos[col.coluna] = '';
      continue;
    }
    if (typeof valor !== 'string') return { campos, validas, erro: `Etiqueta de "${col.nome}" deve ser texto.` };
    const achada = opcoes[col.field].find((n) => normalizaNome(n) === normalizaNome(valor));
    if (!achada) {
      return { campos, validas, erro: `Etiqueta "${valor}" não existe na coluna "${col.nome}". Válidas: ${opcoes[col.field].join(', ')}.` };
    }
    campos[col.coluna] = achada;
  }
  return { campos, validas };
}
