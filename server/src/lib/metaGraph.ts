/**
 * Cliente do Graph da Meta para criar template de mensagem (HSM) do WhatsApp.
 *
 * Um template NÃO é um registro nosso: ele vive na Meta, passa por revisão (minutos a 24h) e só
 * pode ser enviado depois de aprovado. A lógica de montagem do payload (variáveis, botões,
 * validação de nome, tradução de erro) é a mesma já validada em produção no Recorrai
 * (github.com/bitsmateus/recorra, src/modules/channels/meta-graph.ts) — portada aqui pra não
 * reinventar as regras da Meta (ex.: URL dinâmica só aceita o sufixo, COPY_CODE só código curto).
 * Docs: developers.facebook.com/docs/whatsapp/business-management-api/message-templates
 */

export interface MetaAccess {
  wabaId: string;
  token: string;
  version: string; // ex.: "21.0"
}

/** Botão a criar num template novo (o que vem do formulário público). */
export interface ButtonInput {
  type: 'QUICK_REPLY' | 'URL' | 'PHONE_NUMBER' | 'COPY_CODE';
  text?: string; // rótulo (QUICK_REPLY / URL); a Meta limita a 25 caracteres
  urlBase?: string; // URL: base fixa (ex.: https://app.exemplo.com.br/)
  dynamic?: boolean; // URL: acrescenta {{1}} — o valor muda por envio
  example?: string; // valor de exemplo do sufixo/código (a Meta exige na revisão)
  phoneNumber?: string; // PHONE_NUMBER: número completo com DDI
}

const TIMEOUT = 20000;
const GRAPH_HOST = 'https://graph.facebook.com';

function graphUrl(a: MetaAccess, path: string): string {
  return `${GRAPH_HOST}/v${a.version.replace(/^v/i, '')}/${path}`;
}

/** Posições das variáveis do corpo, na ordem: "{{1}} {{2}}" → [1, 2]. */
export function bodyVariables(body: string): number[] {
  const out = new Set<number>();
  const re = /\{\{\s*(\d+)\s*\}\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body || ''))) out.add(Number(m[1]));
  return [...out].sort((a, b) => a - b);
}

/** A Meta recusa (erro #132001-like) um corpo que COMEÇA ou TERMINA em variável — o revisor
 *  precisa de texto fixo ao redor pra entender o contexto. Usado tanto no front (aviso na hora)
 *  quanto aqui no backend (defesa mesmo se o front deixar passar). null = corpo válido. */
export function bodyEdgeVariableIssue(body: string): 'start' | 'end' | null {
  const trimmed = (body || '').trim();
  if (/^\{\{\s*\d+\s*\}\}/.test(trimmed)) return 'start';
  if (/\{\{\s*\d+\s*\}\}$/.test(trimmed)) return 'end';
  return null;
}

/** Nome exigido pela Meta: minúsculas, números e underscore. */
export function validTemplateName(name: string): boolean {
  return /^[a-z0-9_]{1,512}$/.test(name);
}

/** Sugere um nome válido a partir de um texto livre (ex.: "Confirmação de pedido" → "confirmacao_de_pedido"). */
export function suggestTemplateName(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 60);
}

const MARKETING_WORDS = ['promo', 'promoção', 'promocao', 'desconto', 'oferta', 'aproveite', 'novidade', 'imperdível', 'imperdivel', 'black friday', 'cupom', 'condição especial', 'condicao especial'];
const AUTH_WORDS = ['código', 'codigo', 'otp', 'verificação', 'verificacao', 'autenticação', 'autenticacao', 'senha temporária', 'senha temporaria'];

/** Sugere a categoria (utility/marketing/authentication) a partir do corpo — heurística simples,
 *  o cliente/staff pode revisar depois se a Meta contestar. */
export function suggestCategory(body: string): 'UTILITY' | 'MARKETING' | 'AUTHENTICATION' {
  const t = (body ?? '').toLowerCase();
  if (AUTH_WORDS.some((k) => t.includes(k))) return 'AUTHENTICATION';
  if (MARKETING_WORDS.some((k) => t.includes(k))) return 'MARKETING';
  return 'UTILITY';
}

/**
 * Monta o componente BUTTONS pra criar o template na Meta. A Meta exige `example` na URL
 * dinâmica e no COPY_CODE (o revisor precisa ver preenchido). null = sem botões.
 */
export function buildButtonsComponent(buttons?: ButtonInput[]): Record<string, unknown> | null {
  const bs = (buttons ?? []).filter((b) => b && b.type);
  if (!bs.length) return null;
  const built = bs.map((b) => {
    const text = (b.text || '').trim().slice(0, 25);
    if (b.type === 'QUICK_REPLY') return { type: 'QUICK_REPLY', text: text || 'Responder' };
    if (b.type === 'PHONE_NUMBER') {
      return { type: 'PHONE_NUMBER', text: text || 'Ligar', phone_number: (b.phoneNumber || '').trim() };
    }
    if (b.type === 'COPY_CODE') {
      // A Meta exige o example como STRING (não array) e o botão de código só aceita um código
      // curto alfanumérico (até 15 caracteres) — não cabe um Pix copia-e-cola ou link longo.
      const ex = (b.example || '').replace(/[^A-Za-z0-9]/g, '').slice(0, 15) || 'CODIGO123';
      return { type: 'COPY_CODE', example: ex };
    }
    const base = (b.urlBase || '').trim();
    if (b.dynamic) {
      return { type: 'URL', text: text || 'Abrir', url: `${base}{{1}}`, example: [`${base}${(b.example || 'exemplo').trim()}`] };
    }
    return { type: 'URL', text: text || 'Abrir', url: base };
  });
  return { type: 'BUTTONS', buttons: built };
}

/** Traduz o erro da Meta pra algo que o usuário entenda, sem esconder o original. */
export function translateMetaError(status: number, body: unknown): string {
  const err = (body as { error?: { message?: string; error_user_msg?: string; code?: number } })?.error;
  if (!err) return `Erro HTTP ${status} na Meta.`;
  const msg = err.error_user_msg || err.message || 'erro na Meta';
  if (err.code === 190) return `Token sem acesso ao Business Manager (${msg}). Peça pra equipe sincronizar os canais.`;
  if (err.code === 200 || err.code === 10) return `Sem permissão pra gerenciar templates nesta conta (${msg}).`;
  return msg;
}

async function graphFetch(
  method: 'GET' | 'POST',
  urlStr: string,
  token: string,
  body?: Record<string, unknown>,
): Promise<{ ok: boolean; status: number; body: unknown }> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT);
  try {
    const withToken = new URL(urlStr);
    withToken.searchParams.set('access_token', token);
    const res = await fetch(withToken.toString(), {
      method,
      signal: ctrl.signal,
      ...(body ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}),
    });
    const text = await res.text();
    let parsed: unknown;
    try {
      parsed = text ? JSON.parse(text) : undefined;
    } catch {
      parsed = text;
    }
    return { ok: res.ok, status: res.status, body: parsed };
  } finally {
    clearTimeout(t);
  }
}

/**
 * Cria o template na Meta. Ele nasce em revisão (PENDING) — só dá pra enviar depois de
 * aprovado (minutos a 24h). `examples` é obrigatório quando o corpo tem variáveis: a Meta
 * recusa a criação sem eles, porque o revisor precisa ver o texto preenchido.
 */
export async function createTemplate(
  access: MetaAccess,
  dto: {
    name: string;
    language: string;
    category: string;
    header?: string;
    body: string;
    footer?: string;
    examples?: string[];
    buttons?: ButtonInput[];
  },
): Promise<{ id: string; status?: string; category?: string }> {
  const vars = bodyVariables(dto.body);
  const buttonsComponent = buildButtonsComponent(dto.buttons);
  const header = (dto.header || '').trim();
  const footer = (dto.footer || '').trim();
  const components: Record<string, unknown>[] = [];
  if (header) components.push({ type: 'HEADER', format: 'TEXT', text: header.slice(0, 60) });
  components.push({
    type: 'BODY',
    text: dto.body,
    ...(vars.length ? { example: { body_text: [vars.map((n) => dto.examples?.[n - 1] || `exemplo ${n}`)] } } : {}),
  });
  if (footer) components.push({ type: 'FOOTER', text: footer.slice(0, 60) });
  if (buttonsComponent) components.push(buttonsComponent);

  const payload: Record<string, unknown> = {
    name: dto.name,
    language: dto.language,
    category: dto.category,
    components,
  };
  const res = await graphFetch('POST', graphUrl(access, `${access.wabaId}/message_templates`), access.token, payload);
  if (!res.ok) throw new Error(translateMetaError(res.status, res.body));
  return res.body as { id: string; status?: string; category?: string };
}

/** Consulta o status atual de um template já criado (pra "verificar status" depois da revisão). */
export async function fetchTemplateStatus(
  access: MetaAccess,
  externalId: string,
): Promise<{ status?: string; category?: string }> {
  const res = await graphFetch('GET', `${graphUrl(access, externalId)}?fields=status,category`, access.token);
  if (!res.ok) throw new Error(translateMetaError(res.status, res.body));
  return res.body as { status?: string; category?: string };
}
