import { query, queryOne } from '../db.js';
import { sendPushToUsers } from './webPush.js';

/**
 * Fluxo de criação das artes de social media de um cliente:
 *   pedido (para_producao) → em criação (em_producao) → revisão interna (revisao)
 *   → com o cliente (com_cliente) → aprovado → no tráfego (trafego).
 *
 * Aqui ficam as regras que valem pra qualquer caminho que mude a etapa (tela da equipe, portal do
 * cliente, job de publicação): os carimbos de data, o histórico da arte e os avisos pra quem precisa agir.
 */

export const ETAPAS = ['para_producao', 'em_producao', 'revisao', 'com_cliente', 'aprovado', 'trafego'] as const;
export type Etapa = (typeof ETAPAS)[number];

export const NOME_ETAPA: Record<Etapa, string> = {
  para_producao: 'Pedido',
  em_producao: 'Em criação',
  revisao: 'Revisão interna',
  com_cliente: 'Com o cliente',
  aprovado: 'Aprovado',
  trafego: 'No tráfego',
};

export const ehEtapa = (v: unknown): v is Etapa => ETAPAS.includes(v as Etapa);

/** Papel de um anexo do card: a arte final (vai pro cliente, PDF, tráfego e postagem) ou referência. Sem papel = final. */
export type PapelAnexo = 'final' | 'referencia';
export interface AnexoCard { id: string; name: string; type: string; size: number; dataUrl: string; papel?: PapelAnexo }
export const ehFinal = (a: { papel?: string | null }) => a.papel !== 'referencia';
export const imagensFinais = <T extends { type?: string; papel?: string | null }>(anexos: T[] | null | undefined): T[] =>
  (anexos ?? []).filter((a) => ehFinal(a) && String(a.type ?? '').startsWith('image/'));

/** Mês (YYYY-MM) de hoje em São Paulo. */
export function mesAtual(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit' }).format(new Date()).slice(0, 7);
}
export const ehMes = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(v);

/** Carimbos que acompanham a etapa nova (SQL pronto pra entrar no SET). */
export function carimbosDaEtapa(para: Etapa): string[] {
  switch (para) {
    case 'com_cliente': return ['enviado_cliente_em = NOW()', 'ajuste_pedido = false'];
    case 'aprovado': return ['aprovado_em = COALESCE(aprovado_em, NOW())', 'ajuste_pedido = false'];
    case 'trafego': return ['trafego_em = COALESCE(trafego_em, NOW())', 'aprovado_em = COALESCE(aprovado_em, NOW())', 'ajuste_pedido = false'];
    default: return [];
  }
}

export async function registrarEventoArte(
  producaoId: string, tipo: 'ajuste_cliente' | 'aprovado_cliente' | 'checklist_ia' | 'comentario' | 'etapa', texto: string,
  autor: { id?: string | null; nome?: string } = {},
): Promise<void> {
  await query(
    `INSERT INTO gc_social_eventos (gc_producao_id, tipo, texto, autor_id, autor_nome) VALUES ($1,$2,$3,$4,$5)`,
    [producaoId, tipo, texto.slice(0, 4000), autor.id ?? null, (autor.nome ?? '').slice(0, 120)],
  );
}

interface CardAviso {
  id: string; titulo: string; gc_cliente_id: string; nome_empresa: string;
  editor_id: string | null; criado_por: string | null; gestor_trafego_id: string | null; responsavel_id: string | null;
}

async function cardParaAviso(id: string): Promise<CardAviso | null> {
  return queryOne<CardAviso>(
    `SELECT d.id, d.titulo, d.gc_cliente_id, c.nome_empresa, d.editor_id, d.criado_por, c.gestor_trafego_id, c.responsavel_id
     FROM gc_social_producao d JOIN gc_clientes c ON c.id = d.gc_cliente_id WHERE d.id = $1`,
    [id],
  );
}

const linkSocial = (clienteId: string, aba: 'social' | 'trafego') => `/clientesnxdigital/clientes/${clienteId}?aba=${aba}`;
const unicos = (ids: (string | null | undefined)[], menos?: string | null) =>
  [...new Set(ids.filter((x): x is string => !!x && x !== menos))];

/**
 * Depois que a etapa mudou (já gravada): avisa quem precisa agir agora. Nunca lança — um aviso que
 * falha não pode desfazer a mudança de etapa.
 *  - revisão interna → a social media que pediu (criado_por)
 *  - aprovado        → o gestor de tráfego do cliente (+ a social media)
 *  - ajuste pedido   → a designer (editor) e a social media
 */
export async function avisarMudanca(
  producaoId: string, evento: Etapa | 'ajuste', quem: string | null = null, extra = '',
): Promise<void> {
  try {
    const c = await cardParaAviso(producaoId);
    if (!c) return;
    let para: string[] = [];
    let title = '';
    let body = '';
    let url = linkSocial(c.gc_cliente_id, 'social');
    if (evento === 'revisao') {
      para = unicos([c.criado_por, c.responsavel_id], quem);
      title = `Arte pronta pra revisar · ${c.nome_empresa}`;
      body = c.titulo;
    } else if (evento === 'aprovado') {
      para = unicos([c.gestor_trafego_id, c.criado_por], quem);
      title = `Arte aprovada pelo cliente · ${c.nome_empresa}`;
      body = `${c.titulo} — já está em Artes aprovadas, na aba Tráfego.`;
      url = linkSocial(c.gc_cliente_id, 'trafego');
    } else if (evento === 'ajuste') {
      para = unicos([c.editor_id, c.criado_por], quem);
      title = `Cliente pediu ajuste · ${c.nome_empresa}`;
      body = `${c.titulo}${extra ? `: ${extra.slice(0, 140)}` : ''}`;
    } else {
      return;
    }
    if (para.length) await sendPushToUsers(para, { title, body, url, tag: `social-${producaoId}` });
  } catch (err) {
    console.error('[social] falha ao avisar mudança de etapa', err);
  }
}
