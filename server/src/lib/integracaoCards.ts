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
  nome: 'nome',
  empresa: 'empresa',
  ramo: 'nicho',
  nicho: 'nicho',
  ticket_nx: 'ticket_nx',
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

/** descricao e email não são campos do card: viram uma Atualização (ver textoDaNota). */
export interface NotaDaAutomacao {
  descricao?: string;
  email?: string;
}

/** "Descrição: …" e "E-mail: …", uma por linha. Vazio = nada a anotar. */
export function textoDaNota(nota: NotaDaAutomacao | undefined): string {
  const linhas: string[] = [];
  if (nota?.descricao) linhas.push(`Descrição: ${nota.descricao}`);
  if (nota?.email) linhas.push(`E-mail: ${nota.email}`);
  return linhas.join('\n');
}

/** Lê descricao/email do corpo. Devolve o erro (texto) se o tipo estiver errado. */
function lerNota(chave: 'descricao' | 'email', valor: unknown, nota: NotaDaAutomacao): string | null {
  if (valor !== null && typeof valor !== 'string' && typeof valor !== 'number') return `"${chave}" deve ser texto.`;
  const v = valor === null ? '' : String(valor).trim();
  if (v) nota[chave] = v;
  return null;
}

export interface PatchValidado {
  campos: Record<string, unknown>; // coluna em lead_rows -> valor
  nota?: NotaDaAutomacao; // descricao/email -> Atualização do card
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
      const texto = valor === null ? '' : String(valor).trim();
      if (chave === 'nome' && !texto) return { ...out, erro: '"nome" não pode ficar vazio.' };
      out.campos[CAMPOS_TEXTO[chave]] = texto;
    } else if (chave === 'origem') {
      const o = normalizarOrigem(valor);
      if (o === null) return { ...out, erro: erroDeOrigem() };
      out.campos.origem = o;
    } else if (chave === 'descricao' || chave === 'email') {
      out.nota ??= {};
      const e = lerNota(chave, valor, out.nota);
      if (e) return { ...out, erro: e };
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
  if (!Object.keys(out.campos).length && !out.coluna && !out.boardId && !out.etiquetas && !textoDaNota(out.nota)) return { ...out, erro: 'Nada para atualizar.' };
  return out;
}

// ── Origem ──────────────────────────────────────────────────────────────────

/** Origens que a automação (n8n) manda. As antigas da tela (meta, bio, site, indicacao, "outros: …") continuam
 * aceitas. Rótulos amigáveis em src/lib/regraDoStatus.ts (ROTULOS_ORIGEM). */
export const ORIGENS_INTEGRACAO = [
  'bio_instagram', 'lp_teste', 'formulario_organizar', 'formulario_falar', 'formulario_profissionalizar',
  'formulario_suporte', 'indique_ganhe', 'disparo_em_massa', 'anuncio_meta', 'whatsapp_direto',
] as const;
const ORIGENS_DA_TELA = ['meta', 'bio', 'site', 'indicacao'];

/** Origem válida em minúsculas; '' limpa; null = inválida. "outros: texto" passa como está. */
export function normalizarOrigem(valor: unknown): string | null {
  if (valor === null || valor === '') return '';
  if (typeof valor !== 'string') return null;
  const v = valor.trim();
  if (/^outros:\s*\S/i.test(v)) return `outros: ${v.replace(/^outros:\s*/i, '')}`;
  const n = v.toLowerCase();
  return (ORIGENS_INTEGRACAO as readonly string[]).includes(n) || ORIGENS_DA_TELA.includes(n) ? n : null;
}

/** Rótulo amigável (mesmo da tela, src/lib/regraDoStatus.ts). */
const ROTULOS_ORIGEM: Record<string, string> = {
  meta: 'Anúncio Meta', anuncio_meta: 'Anúncio Meta', bio: 'Link da bio', bio_instagram: 'Link da bio', site: 'Site',
  lp_teste: 'Teste da LP', formulario_organizar: 'Formulário do site (organizar)', formulario_falar: 'Formulário do site (falar)',
  formulario_profissionalizar: 'Formulário do site (profissionalizar)', formulario_suporte: 'Formulário do site (suporte)',
  indicacao: 'Indicação', indique_ganhe: 'Indique e ganhe', disparo_em_massa: 'Disparo em massa', whatsapp_direto: 'WhatsApp direto',
};
export function rotuloDaOrigem(origem: string): string {
  if (!origem) return 'não informada';
  if (/^outros:/i.test(origem)) return `Outros (${origem.replace(/^outros:\s*/i, '')})`;
  return ROTULOS_ORIGEM[origem] ?? origem;
}

export function erroDeOrigem(): string {
  return `"origem" inválida. Valores aceitos: ${ORIGENS_INTEGRACAO.join(', ')} (ou "outros: <texto>").`;
}

// ── Quadro (aba do CRM) ─────────────────────────────────────────────────────

export interface QuadroRef {
  id: string;
  name: string;
}

/**
 * O quadro pedido pelo id/slug ou pelo nome, ignorando maiúscula, acento e pontuação. Ordem: id igual; id ou nome
 * igual (normalizado); e por último todas as palavras pedidas dentro do nome/id ("crm-luiza" acha "CRM IA LUIZA").
 * Mais de um no último passo = ambíguo.
 */
export function resolverQuadro(quadros: QuadroRef[], pedido: unknown): { id?: string; erro?: string } {
  if (typeof pedido !== 'string' || !pedido.trim()) return { erro: '"quadro" é obrigatório (id ou nome do quadro).' };
  const p = pedido.trim();
  const exato = quadros.find((q) => q.id === p);
  if (exato) return { id: exato.id };
  const alvo = normalizaNome(p);
  const igual = quadros.find((q) => normalizaNome(q.id) === alvo || normalizaNome(q.name) === alvo);
  if (igual) return { id: igual.id };
  const palavras = (x: string) => x.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  const pedidas = palavras(p);
  const contem = quadros.filter((q) => {
    const tem = new Set([...palavras(q.name), ...palavras(q.id)]);
    return pedidas.length > 0 && pedidas.every((w) => tem.has(w));
  });
  if (contem.length === 1) return { id: contem[0].id };
  if (contem.length > 1) return { erro: `Quadro "${p}" é ambíguo: ${contem.map((q) => `${q.name} (${q.id})`).join(', ')}.` };
  return { erro: `Quadro "${p}" não existe.` };
}

// ── Criação de card (POST) ──────────────────────────────────────────────────

export interface CriacaoValidada {
  quadro: string;
  coluna?: string;
  /** coluna em lead_rows -> valor (já com o telefone normalizado) */
  campos: Record<string, string>;
  /** sdr pedido pelo corpo (só vale se a aba não tiver SDR dono) */
  sdr?: string;
  /** descricao/email: vão na Atualização de criação do card */
  nota: NotaDaAutomacao;
  erros: string[];
}

/** Valida o corpo do POST /cards. Junta todos os problemas numa lista (400 único). */
export function validarCriacaoIntegracao(body: unknown): CriacaoValidada {
  const out: CriacaoValidada = { quadro: '', campos: {}, nota: {}, erros: [] };
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { ...out, erros: ['Corpo inválido: envie um objeto JSON.'] };
  const b = body as Record<string, unknown>;
  for (const [chave, valor] of Object.entries(b)) {
    if (chave === 'quadro') {
      if (typeof valor !== 'string' || !valor.trim()) out.erros.push('"quadro" deve ser um texto não vazio.');
      else out.quadro = valor.trim();
    } else if (chave === 'coluna') {
      if (valor === null || valor === '') continue;
      if (typeof valor !== 'string') out.erros.push('"coluna" deve ser texto.');
      else out.coluna = valor.trim();
    } else if (chave === 'telefone') {
      const tel = typeof valor === 'string' || typeof valor === 'number' ? telefoneComDdi(String(valor)) : null;
      if (!tel) out.erros.push('"telefone" inválido: informe DDD + número (com ou sem 55).');
      else out.campos.telefone = tel;
    } else if (chave === 'origem') {
      const o = normalizarOrigem(valor);
      if (o === null) out.erros.push(erroDeOrigem());
      else out.campos.origem = o;
    } else if (chave === 'descricao' || chave === 'email') {
      const e = lerNota(chave, valor, out.nota);
      if (e) out.erros.push(e);
    } else if (chave === 'sdr') {
      if (valor !== null && typeof valor !== 'string') out.erros.push('"sdr" deve ser texto.');
      else if (typeof valor === 'string' && valor.trim()) out.sdr = valor.trim();
    } else if (chave in CAMPOS_TEXTO && !['status', 'agendamento', 'retornar', 'regua_etapa', 'valor_mrr', 'mrr', 'valor_implementacao', 'implementacao'].includes(chave)) {
      if (valor !== null && typeof valor !== 'string' && typeof valor !== 'number') out.erros.push(`"${chave}" deve ser texto ou número.`);
      else out.campos[CAMPOS_TEXTO[chave]] = valor === null ? '' : String(valor).trim();
    } else {
      out.erros.push(`Campo não permitido: "${chave}".`);
    }
  }
  if (!out.quadro && !('quadro' in b)) out.erros.push('"quadro" é obrigatório.');
  if (!out.campos.nome) out.erros.push('"nome" é obrigatório.');
  if (!('telefone' in b)) out.erros.push('"telefone" é obrigatório.');
  return out;
}

// ── Busca por telefone ──────────────────────────────────────────────────────

/** Ordem dos cards achados pelo telefone: original antes de cópia (espelho, IA, venda); depois quem entrou na
 * coluna mais recentemente; sem data por último. entrou_coluna_em chega do banco como Date (ou null). */
export function compararAchadosPorTelefone(
  a: { copia: boolean; entrou_coluna_em: Date | string | null },
  b: { copia: boolean; entrou_coluna_em: Date | string | null },
): number {
  const ts = (x: Date | string | null) => {
    if (x === null || x === undefined) return null;
    const n = new Date(x).getTime();
    return Number.isNaN(n) ? null : n;
  };
  if (a.copia !== b.copia) return a.copia ? 1 : -1;
  const ta = ts(a.entrou_coluna_em);
  const tb = ts(b.entrou_coluna_em);
  if (ta === tb) return 0;
  if (ta === null) return 1;
  if (tb === null) return -1;
  return tb - ta;
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
