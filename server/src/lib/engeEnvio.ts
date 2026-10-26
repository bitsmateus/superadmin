/**
 * Enge Services (/engeenvio) — monta o e-mail de aviso de garantia a partir do modelo salvo em
 * Configurações. Função pura (sem banco) pra dar pra testar e pra pré-visualizar na tela.
 */

export const ASSUNTO_PADRAO = 'Aviso de garantia: {item} vence em {vencimento}';

export const CORPO_PADRAO = `Prezado(a) {sindico},

Informamos que a garantia do item {item} do {empreendimento} vence em {vencimento} ({dias}).

Caso exista qualquer problema neste item, é necessário abrir chamado junto à {construtora} antes dessa data, para não perder a cobertura.

Por favor, confirme o recebimento deste aviso no botão abaixo.

Atenciosamente,
Enge Services`;

export interface DadosAviso {
  sindico: string | null;
  empreendimento: string;
  item: string;
  prazo: string | null;
  construtora: string | null;
  /** YYYY-MM-DD */
  vencimento: string;
  /** Dia em que o aviso sai (YYYY-MM-DD), pra calcular o "faltam N dias". */
  enviadoEm: string;
  /** Link "estou ciente" — vira a variável {link} (usada na mensagem de WhatsApp). */
  link?: string | null;
}

export const WHATSAPP_PADRAO = `Olá, {sindico}! Aqui é da Enge Services.

A garantia do item *{item}* do {empreendimento} vence em *{vencimento}* ({dias}).

Se houver algum problema nesse item, é preciso abrir chamado com a {construtora} antes dessa data, para não perder a cobertura. O aviso oficial também foi enviado por e-mail.

Confirme o recebimento por aqui: {link}`;

const dataBr = (iso: string) => iso.slice(0, 10).split('-').reverse().join('/');

/** Dias corridos entre duas datas YYYY-MM-DD (b - a). */
export function diasEntre(a: string, b: string): number {
  const ms = Date.parse(`${b.slice(0, 10)}T00:00:00Z`) - Date.parse(`${a.slice(0, 10)}T00:00:00Z`);
  return Math.round(ms / 86_400_000);
}

export function textoDias(n: number): string {
  if (n > 1) return `faltam ${n} dias`;
  if (n === 1) return 'falta 1 dia';
  if (n === 0) return 'vence hoje';
  return n === -1 ? 'venceu há 1 dia' : `venceu há ${-n} dias`;
}

export function preencher(modelo: string, d: DadosAviso): string {
  const vars: Record<string, string> = {
    sindico: d.sindico?.trim() || 'Síndico(a)',
    empreendimento: d.empreendimento,
    item: d.item,
    prazo: d.prazo?.trim() || '',
    construtora: d.construtora?.trim() || 'construtora',
    vencimento: dataBr(d.vencimento),
    dias: textoDias(diasEntre(d.enviadoEm, d.vencimento)),
    link: d.link || '',
  };
  return modelo.replace(/\{(\w+)\}/g, (todo, nome: string) => (nome in vars ? vars[nome] : todo));
}

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Corpo em texto (como digitado no modelo) → HTML simples, com o botão "estou ciente" no fim. */
export function montarHtml(corpoTexto: string, linkCiente: string | null): string {
  const paragrafos = corpoTexto
    .trim()
    .split(/\n\s*\n/)
    .map((p) => `<p style="margin:0 0 14px">${esc(p).replace(/\n/g, '<br>')}</p>`)
    .join('');
  const botao = linkCiente
    ? `<p style="margin:22px 0"><a href="${esc(linkCiente)}" style="background:#4F8EF7;color:#fff;text-decoration:none;padding:11px 20px;border-radius:8px;font-weight:600;display:inline-block">Estou ciente deste aviso</a></p>
       <p style="margin:0;font-size:12px;color:#777">Se o botão não abrir, copie este endereço no navegador: ${esc(linkCiente)}</p>`
    : '';
  return `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.55;color:#222;max-width:620px">${paragrafos}${botao}</div>`;
}

/** Separa a lista de e-mails digitada (vírgula, ponto e vírgula ou quebra de linha). */
export function listaEmails(texto: string | null | undefined): string[] {
  return (texto ?? '')
    .split(/[,;\n]/)
    .map((e) => e.trim())
    .filter((e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e));
}

/** Telefones digitados (vírgula, ponto e vírgula, barra ou quebra de linha) → só dígitos com 55. */
export function listaTelefones(texto: string | null | undefined): string[] {
  const nums = (texto ?? '')
    .split(/[,;/\n]/)
    .map((t) => t.replace(/\D/g, ''))
    .filter((t) => t.length >= 10)
    .map((t) => (t.startsWith('55') && t.length >= 12 ? t : `55${t}`));
  return [...new Set(nums)];
}

/**
 * Etapa de uma régua de envio. `momento` + `dias` dizem quando sai em relação ao vencimento
 * (30 dias antes, no dia, 5 dias depois); `repetir` manda de novo a cada `aCada` dias, `vezes`
 * vezes, seguindo pra frente no tempo (ex.: 60 dias antes, repetindo a cada 15 dias 3 vezes →
 * D-60, D-45, D-30, D-15). A régua é expandida na tela (src/lib/engeEnvio.ts › expandirRegua).
 */
export interface EtapaRegua {
  id: string;
  momento: 'antes' | 'dia' | 'depois';
  dias: number;
  hora: string;
  modeloId: string | null;
  email: boolean;
  whatsapp: boolean;
  repetir: boolean;
  aCada: number;
  vezes: number;
}

/** Modelos que a Enge já recebe prontos (editáveis/apagáveis). `chave` só serve pra semente das réguas. */
export const MODELOS_PADRAO = [
  {
    chave: 'aviso',
    nome: 'Aviso de vencimento',
    assunto: ASSUNTO_PADRAO,
    corpo: CORPO_PADRAO,
    whatsapp: WHATSAPP_PADRAO,
  },
  {
    chave: 'ultima',
    nome: 'Última chamada',
    assunto: 'Última chamada: garantia de {item} vence em {vencimento}',
    corpo: `Prezado(a) {sindico},

Este é o último aviso: a garantia do item {item} do {empreendimento} vence em {vencimento} ({dias}).

Se houver qualquer problema neste item, o chamado precisa ser aberto junto à {construtora} antes do vencimento. Depois dessa data, a construtora não tem mais obrigação de atender.

Por favor, confirme o recebimento deste aviso no botão abaixo.

Atenciosamente,
Enge Services`,
    whatsapp: `{sindico}, último aviso da Enge Services: a garantia de *{item}* do {empreendimento} vence em *{vencimento}* ({dias}).

Se houver algum problema, o chamado com a {construtora} precisa ser aberto antes dessa data.

Confirme o recebimento: {link}`,
  },
  {
    chave: 'cvcb',
    nome: 'Renovação do CVCB',
    assunto: 'Renovação do CVCB do {empreendimento}: vence em {vencimento}',
    corpo: `Prezado(a) {sindico},

O CVCB (Certificado de Vistoria do Corpo de Bombeiros) do {empreendimento} vence em {vencimento} ({dias}).

É preciso agendar a nova vistoria com antecedência para o condomínio não ficar com o certificado vencido.

Por favor, confirme o recebimento deste aviso no botão abaixo.

Atenciosamente,
Enge Services`,
    whatsapp: `Olá, {sindico}! Aqui é da Enge Services.

O *CVCB* do {empreendimento} vence em *{vencimento}* ({dias}). É preciso agendar a nova vistoria do Corpo de Bombeiros com antecedência.

Confirme o recebimento: {link}`,
  },
] as const;

type EtapaSemente = Omit<EtapaRegua, 'id' | 'modeloId' | 'email' | 'whatsapp'> & { modelo: (typeof MODELOS_PADRAO)[number]['chave'] };

const etapa = (momento: EtapaRegua['momento'], dias: number, modelo: EtapaSemente['modelo'], repetir?: { aCada: number; vezes: number }): EtapaSemente => ({
  momento,
  dias,
  hora: '09:00',
  modelo,
  repetir: Boolean(repetir),
  aCada: repetir?.aCada ?? 7,
  vezes: repetir?.vezes ?? 1,
});

export const REGUAS_PADRAO: { nome: string; padrao?: boolean; etapas: EtapaSemente[] }[] = [
  {
    nome: 'Padrão: 30, 15 e 7 dias antes',
    padrao: true,
    etapas: [etapa('antes', 30, 'aviso'), etapa('antes', 15, 'aviso'), etapa('antes', 7, 'ultima')],
  },
  {
    nome: 'Intensiva: a cada 15 dias desde 60 dias antes',
    etapas: [etapa('antes', 60, 'aviso', { aCada: 15, vezes: 3 }), etapa('antes', 7, 'ultima'), etapa('antes', 1, 'ultima')],
  },
  {
    nome: 'CVCB: 60, 30 e 7 dias antes',
    etapas: [etapa('antes', 60, 'cvcb'), etapa('antes', 30, 'cvcb'), etapa('antes', 7, 'ultima')],
  },
];

/** Limpa uma etapa vinda da tela (números dentro de faixas razoáveis, hora válida). */
export function normalizarEtapa(e: Partial<EtapaRegua>, i: number): EtapaRegua {
  const int = (v: unknown, min: number, max: number, padrao: number) => {
    const n = Math.round(Number(v));
    return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : padrao;
  };
  const momento = e.momento === 'depois' || e.momento === 'dia' ? e.momento : 'antes';
  return {
    id: typeof e.id === 'string' && e.id ? e.id.slice(0, 40) : `e${i}`,
    momento,
    dias: momento === 'dia' ? 0 : int(e.dias, 0, 3650, 30),
    hora: typeof e.hora === 'string' && /^\d{2}:\d{2}$/.test(e.hora) ? e.hora : '09:00',
    modeloId: typeof e.modeloId === 'string' && e.modeloId ? e.modeloId : null,
    email: e.email !== false,
    whatsapp: Boolean(e.whatsapp),
    repetir: Boolean(e.repetir),
    aCada: int(e.aCada, 1, 365, 7),
    vezes: int(e.vezes, 1, 52, 1),
  };
}
