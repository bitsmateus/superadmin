import { query, queryOne } from '../db.js';
import { sendPushToUsers } from './webPush.js';
import { abaDeFora } from './abasJuntas.js';
import { chaveTelefone, mesmoTelefone, resolverQuadro } from './integracaoCards.js';
import { donoDaAba, ehAPessoa, primeiroNome } from './reuniaoResultado.js';

/**
 * Notificações do comercial (sininho + popup), por pessoa: cada destinatário tem o seu lida/não lida e o seu "fechou o
 * popup". Chegam do n8n (POST /api/integracao/notificacoes) e do próprio app (card novo / qualificado / reunião
 * agendada no CRM IA LUIZA, via lead_avisos — ver jobs/leadAvisosPush.ts).
 */

/** Tipos que o n8n pode mandar. */
export const TIPOS_DA_INTEGRACAO = ['transferencia_ia', 'reuniao_agendada_ia', 'resposta_proposta', 'lead_novo_ia'] as const;
/** Além desses, o app gera "lead qualificado" (só pro Arthur). */
export const TIPOS = [...TIPOS_DA_INTEGRACAO, 'lead_qualificado_ia'] as const;
export type TipoNotificacao = (typeof TIPOS)[number];

/** Quem recebe quando não vem "para": o SDR (dono do CRM ARTHUR) e o closer (dono do CRM LUIS CLOSER). */
export const PAGINA_DO_SDR = 'crm-arthur';
export const PAGINA_DO_CLOSER = 'crm-luis-closer';
const DOS_DOIS: TipoNotificacao[] = ['transferencia_ia', 'reuniao_agendada_ia', 'resposta_proposta'];
export function quemRecebePorPadrao(tipo: TipoNotificacao): ('sdr' | 'closer')[] {
  return DOS_DOIS.includes(tipo) ? ['sdr', 'closer'] : ['sdr'];
}

/** A mesma notificação (tipo + card) dentro dessa janela não duplica (o app e o n8n podem avisar a mesma reunião). */
export const JANELA_DE_DUPLICADA = "INTERVAL '2 hours'";

export interface DadosDaNotificacao {
  tipo: TipoNotificacao;
  titulo: string;
  mensagem: string;
  nome: string;
  telefone: string;
  ticket_nx: string;
  card_id: string | null;
  quadro: string;
  ultima_mensagem_lead: string;
  resposta_luiza: string;
  reuniao_em: string | null; // ISO
  link_reuniao: string;
}

const curto = (v: unknown, max: number) =>
  typeof v === 'string' ? v.trim().slice(0, max) : typeof v === 'number' ? String(v).slice(0, max) : '';

/**
 * Lê o corpo do n8n. Nunca recusa por campo opcional: o que vier torto vira vazio. Tipo desconhecido = ignorar (a rota
 * responde 200 sem criar nada). "destino" é ignorado; "para" (nomes, ex.: ["arthur","luis"]) troca a regra padrão.
 */
export function lerNotificacaoDaIntegracao(body: unknown):
  | { ignorar: true }
  | { ignorar: false; dados: DadosDaNotificacao; para: string[] | null } {
  const b = (body && typeof body === 'object' && !Array.isArray(body) ? body : {}) as Record<string, unknown>;
  const tipo = curto(b.tipo, 40).toLowerCase() as TipoNotificacao;
  if (!(TIPOS_DA_INTEGRACAO as readonly string[]).includes(tipo)) return { ignorar: true };
  const cardId = curto(b.card_id, 40);
  const reuniao = curto(b.reuniao_em, 40);
  const quando = reuniao ? new Date(reuniao) : null;
  const para = Array.isArray(b.para)
    ? [...new Set(b.para.map((p) => primeiroNome(curto(p, 60))).filter(Boolean))]
    : null;
  return {
    ignorar: false,
    para: para && para.length ? para : null,
    dados: {
      tipo,
      titulo: curto(b.titulo, 120),
      mensagem: curto(b.mensagem, 1000),
      nome: curto(b.nome, 120),
      telefone: curto(b.telefone, 30),
      ticket_nx: curto(b.ticket_nx, 40),
      card_id: /^[0-9a-f-]{36}$/i.test(cardId) ? cardId : null,
      quadro: curto(b.quadro, 80),
      ultima_mensagem_lead: curto(b.ultima_mensagem_lead, 2000),
      resposta_luiza: curto(b.resposta_luiza, 2000),
      reuniao_em: quando && !Number.isNaN(quando.getTime()) ? quando.toISOString() : null,
      link_reuniao: curto(b.link_reuniao, 500),
    },
  };
}

/** Título padrão quando o n8n não manda. */
export const TITULO_PADRAO: Record<TipoNotificacao, string> = {
  transferencia_ia: 'Luiza transferiu um atendimento',
  reuniao_agendada_ia: 'Luiza agendou uma reunião',
  resposta_proposta: 'Lead respondeu a proposta',
  lead_novo_ia: 'Novo atendimento da Luiza',
  lead_qualificado_ia: 'Luiza qualificou um lead',
};

/** Os nomes de quem recebe ("para" ou a regra padrão) -> ids de perfil (casa pelo primeiro nome, como no resto). */
async function destinatarios(tipo: TipoNotificacao, para: string[] | null): Promise<string[]> {
  const [paginas, sdrs, perfis] = await Promise.all([
    query<{ id: string; name: string }>('SELECT id, name FROM lead_pages WHERE id = ANY($1)', [[PAGINA_DO_SDR, PAGINA_DO_CLOSER]]),
    query<{ name: string }>(`SELECT DISTINCT name FROM lead_labels WHERE field = 'sdr'`),
    query<{ id: string; name: string | null }>('SELECT id, name FROM profiles'),
  ]);
  const nomesSdr = sdrs.map((s) => s.name);
  const dono = (pagina: string, reserva: string) =>
    donoDaAba(paginas.find((p) => p.id === pagina)?.name ?? '', nomesSdr) || reserva;
  const nomes = para ?? quemRecebePorPadrao(tipo).map((q) => (q === 'sdr' ? dono(PAGINA_DO_SDR, 'Arthur') : dono(PAGINA_DO_CLOSER, 'Luis')));
  return perfis.filter((p) => nomes.some((n) => ehAPessoa(n, p.name ?? ''))).map((p) => p.id);
}

/** O card da lead: o card_id, se existir; senão pelo telefone (a original, de preferência no quadro pedido). */
async function acharCard(cardId: string | null, telefone: string, quadro: string): Promise<{ id: string; nome: string } | null> {
  if (cardId) {
    const r = await queryOne<{ id: string; nome: string }>(
      `SELECT COALESCE(espelho_origem_id, copia_ia_origem_id, id) AS id, COALESCE(nome, '') AS nome
       FROM lead_rows WHERE id = $1 AND deleted_at IS NULL`, [cardId]);
    if (r) return r;
  }
  const chave = chaveTelefone(telefone);
  if (!chave) return null;
  let quadroId: string | null = null;
  if (quadro) {
    const paginas = await query<{ id: string; name: string }>('SELECT id, name FROM lead_pages WHERE archived_at IS NULL');
    quadroId = resolverQuadro(paginas, quadro).id ?? null;
  }
  const candidatos = await query<{ id: string; nome: string; telefone: string; page: string; copia: boolean; updated_at: string }>(
    `SELECT r.id, COALESCE(r.nome, '') AS nome, r.telefone, lb.page,
            (r.espelho_origem_id IS NOT NULL OR r.copia_ia_origem_id IS NOT NULL OR r.venda_origem_id IS NOT NULL) AS copia,
            r.updated_at
     FROM lead_rows r JOIN lead_boards lb ON lb.id = r.board_id
     WHERE r.deleted_at IS NULL AND NOT lb.is_vendas AND right(regexp_replace(r.telefone, '\\D', '', 'g'), 8) = $1`,
    [chave.ultimos8]
  );
  const achados = candidatos
    .filter((c) => mesmoTelefone(c.telefone, telefone))
    .sort((a, b) =>
      Number(!!quadroId && b.page === quadroId) - Number(!!quadroId && a.page === quadroId) ||
      Number(a.copia) - Number(b.copia) ||
      String(b.updated_at).localeCompare(String(a.updated_at)));
  return achados[0] ? { id: achados[0].id, nome: achados[0].nome } : null;
}

/** Link "Abrir card" pra uma página: o CRM IA LUIZA abre como aba dentro do CRM ARTHUR. */
export function linkDoCard(pagina: string, cardId: string): string {
  const fora = abaDeFora(pagina);
  return fora ? `/comercial/${fora}?quadro=${pagina}&lead=${cardId}` : `/comercial/${pagina}?lead=${cardId}`;
}

/**
 * Cria a notificação e entrega pros destinatários (+ push no celular deles). A mesma (tipo + card) nas últimas 2h não
 * duplica: devolve a que já existe. Devolve o id e se era duplicada.
 */
export async function criarNotificacao(
  d: DadosDaNotificacao, para: string[] | null = null, opcoes: { semPush?: boolean } = {},
): Promise<{ id: string; duplicada: boolean }> {
  const card = await acharCard(d.card_id, d.telefone, d.quadro);
  if (card) {
    const igual = await queryOne<{ id: string }>(
      `SELECT id FROM notificacoes WHERE tipo = $1 AND card_id = $2 AND created_at > NOW() - ${JANELA_DE_DUPLICADA}
       ORDER BY created_at DESC LIMIT 1`,
      [d.tipo, card.id]
    );
    if (igual) return { id: igual.id, duplicada: true };
  }
  const titulo = d.titulo || TITULO_PADRAO[d.tipo];
  const nome = d.nome || card?.nome || '';
  const [n] = await query<{ id: string }>(
    `INSERT INTO notificacoes (tipo, titulo, mensagem, nome, telefone, ticket_nx, card_id, quadro, ultima_mensagem_lead,
       resposta_luiza, reuniao_em, link_reuniao)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING id`,
    [d.tipo, titulo, d.mensagem, nome, d.telefone, d.ticket_nx, card?.id ?? null, d.quadro, d.ultima_mensagem_lead,
      d.resposta_luiza, d.reuniao_em, d.link_reuniao]
  );
  const para_ = await destinatarios(d.tipo, para);
  if (para_.length) {
    await query(
      `INSERT INTO notificacao_destinatarios (notificacao_id, user_id) SELECT $1, unnest($2::uuid[]) ON CONFLICT DO NOTHING`,
      [n.id, para_]
    );
  }
  if (!opcoes.semPush && para_.length) {
    const pagina = card
      ? (await queryOne<{ page: string }>('SELECT lb.page FROM lead_rows r JOIN lead_boards lb ON lb.id = r.board_id WHERE r.id = $1', [card.id]))?.page
      : null;
    void sendPushToUsers(para_, {
      title: titulo,
      body: [nome, d.mensagem].filter(Boolean).join(' · ').slice(0, 180) || 'Notificação do comercial',
      url: card && pagina ? linkDoCard(pagina, card.id) : '/',
      tag: `notificacao-${n.id}`,
    }).catch((err) => console.error('[notificacoes] push falhou', n.id, err));
  }
  return { id: n.id, duplicada: false };
}
