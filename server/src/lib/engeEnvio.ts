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
