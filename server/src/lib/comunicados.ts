import { query, queryOne } from '../db.js';
import { sendOfficialTemplate } from './officialApi.js';
import { chaveTelefone, telefoneComDdi } from './integracaoCards.js';

/**
 * Comunicados aos clientes: a base de contatos (juntada na hora a partir de clients) e o disparo por
 * template da API Oficial — o MESMO número/credencial dos avisos de canal desconectado e do pulso
 * (ver officialApi.ts). Como é API oficial, só sai mensagem de template aprovado na Meta: os textos
 * abaixo são os que precisam ser submetidos lá com exatamente esse nome (ou o nome da env).
 */

export type VariavelTemplate = 'nome' | 'link' | 'texto';

export interface TemplateComunicado {
  id: string;
  /** Nome do template aprovado na Meta (é o que vai no envio). */
  nome: string;
  titulo: string;
  categoria: 'UTILITY' | 'MARKETING';
  corpo: string;
  /** O que vai em {{1}}, {{2}}... na ordem. */
  variaveis: VariavelTemplate[];
}

// A Meta recusa variável no comecinho ou no finalzinho do corpo — por isso os dois textos abrem e
// fecham com frase fixa.
export const TEMPLATES_COMUNICADO: TemplateComunicado[] = [
  {
    id: 'atualizacoes_semana',
    nome: (process.env.COMUNICADO_TEMPLATE_SEMANA || 'atualizacoes_semana').trim(),
    titulo: 'Atualizações da semana',
    categoria: 'UTILITY',
    corpo:
      'Olá, {{1}}! Saíram novidades na plataforma NX nesta semana. Veja o que mudou: {{2}}\n\n' +
      'Qualquer dúvida, é só responder por aqui.',
    variaveis: ['nome', 'link'],
  },
  {
    id: 'aviso_geral',
    nome: (process.env.COMUNICADO_TEMPLATE_AVISO || 'aviso_geral').trim(),
    titulo: 'Aviso geral',
    categoria: 'UTILITY',
    corpo: 'Olá, {{1}}. Temos um aviso importante sobre a plataforma NX:\n\n{{2}}\n\nEquipe NX.',
    variaveis: ['nome', 'texto'],
  },
];

export type OrigemContato = 'canais' | 'visao_geral' | 'manual';

export interface ContatoComunicado {
  numero: string;
  nome: string;
  clientes: { id: string; nome: string }[];
  origens: OrigemContato[];
  incluido: boolean;
  manual: boolean;
  /** Número que não dá pra montar como celular brasileiro completo — aparece na lista, mas não recebe. */
  invalido: boolean;
}

/** Chave de duplicidade: DDD + últimos 8 dígitos (tolera com/sem 55 e com/sem o 9). */
function chaveDe(raw: string): string {
  const k = chaveTelefone(raw);
  return k ? `${k.ddd ?? ''}${k.ultimos8}` : raw.replace(/\D/g, '');
}

function primeiroNome(nome: string): string {
  return (nome ?? '').trim().split(/\s+/)[0] ?? '';
}

/**
 * Base de contatos num lugar só: o número do notificador de Canais (channel_notify_number) e o telefone
 * da Visão Geral (phone) de cada cliente ativo, mais os contatos avulsos. Mesmo número em dois lugares
 * (ou em dois clientes) vira UM contato, com todas as origens marcadas.
 */
export async function montarContatos(): Promise<ContatoComunicado[]> {
  const clientes = await query<{
    id: string;
    name: string;
    company: string | null;
    phone: string | null;
    channel_notify_number: string | null;
  }>(
    `SELECT id, name, company, phone, channel_notify_number
     FROM clients
     WHERE archived_at IS NULL AND stage <> 'churned'
     ORDER BY company NULLS LAST, name`,
  );
  const ajustes = await query<{ numero: string; nome: string; manual: boolean; incluido: boolean }>(
    'SELECT numero, nome, manual, incluido FROM comunicado_contatos',
  );
  const ajustePorChave = new Map(ajustes.map((a) => [chaveDe(a.numero), a]));

  const porChave = new Map<string, ContatoComunicado>();
  const juntar = (raw: string | null, origem: OrigemContato, cliente?: { id: string; nome: string }, nome = '') => {
    const bruto = (raw ?? '').trim();
    if (!bruto) return;
    const chave = chaveDe(bruto);
    if (!chave) return;
    let c = porChave.get(chave);
    if (!c) {
      const numero = telefoneComDdi(bruto);
      c = {
        numero: numero ?? bruto.replace(/\D/g, ''),
        nome,
        clientes: [],
        origens: [],
        incluido: true,
        manual: false,
        invalido: !numero,
      };
      porChave.set(chave, c);
    }
    if (!c.nome && nome) c.nome = nome;
    if (!c.origens.includes(origem)) c.origens.push(origem);
    if (cliente && !c.clientes.some((x) => x.id === cliente.id)) c.clientes.push(cliente);
  };

  for (const cl of clientes) {
    const cliente = { id: cl.id, nome: (cl.company || '').trim() || cl.name };
    const nome = primeiroNome(cl.name) || cliente.nome;
    juntar(cl.channel_notify_number, 'canais', cliente, nome);
    juntar(cl.phone, 'visao_geral', cliente, nome);
  }
  for (const a of ajustes) if (a.manual) juntar(a.numero, 'manual', undefined, a.nome);

  for (const [chave, c] of porChave) {
    const a = ajustePorChave.get(chave);
    if (a) {
      c.incluido = a.incluido;
      c.manual = a.manual;
      if (a.nome) c.nome = a.nome;
    }
    if (c.invalido) c.incluido = false;
  }
  return [...porChave.values()].sort((a, b) =>
    (a.clientes[0]?.nome ?? a.nome).localeCompare(b.clientes[0]?.nome ?? b.nome, 'pt-BR'),
  );
}

/** A Meta não aceita quebra de linha nem tab em variável de template (erro 132018) — vira espaço. */
export function limparVariavel(v: string): string {
  return (v ?? '').replace(/[\r\n\t]+/g, ' ').replace(/ {4,}/g, '   ').trim();
}

export function parametrosDoTemplate(
  t: TemplateComunicado,
  nome: string,
  extras: { link?: string; texto?: string },
): string[] {
  return t.variaveis.map((v) =>
    limparVariavel(v === 'nome' ? nome || 'cliente' : v === 'link' ? extras.link ?? '' : extras.texto ?? ''),
  );
}

// ── Envio ─────────────────────────────────────────────────────────────────────

// Pausa entre um envio e outro: disparar tudo em segundos parece spam pra Meta (mesma ideia do pulso).
const DELAY_MS = Number(process.env.COMUNICADO_DELAY_MS) || 8_000;
let processando = false;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Envia os itens pendentes dos disparos em andamento, um por vez. Chamado logo depois de criar um
 * disparo e de minuto em minuto (ver startComunicadosDisparo) — se o servidor reiniciar no meio, o
 * que ficou pendente continua de onde parou.
 */
export async function processarDisparos(): Promise<void> {
  if (processando) return;
  processando = true;
  try {
    let primeiro = true;
    for (;;) {
      const item = await queryOne<{ id: string; disparo_id: string; numero: string; nome: string; template: string; parametros: { link?: string; texto?: string } }>(
        `SELECT i.id, i.disparo_id, i.numero, i.nome, d.template, d.parametros
         FROM comunicado_disparo_itens i JOIN comunicado_disparos d ON d.id = i.disparo_id
         WHERE i.status = 'pendente' AND d.status = 'enviando'
         ORDER BY d.created_at, i.nome, i.numero
         LIMIT 1`,
      );
      if (!item) break;
      if (!primeiro) await sleep(DELAY_MS);
      primeiro = false;
      const t = TEMPLATES_COMUNICADO.find((x) => x.id === item.template);
      const res = t
        ? await sendOfficialTemplate(item.numero, t.nome, parametrosDoTemplate(t, item.nome, item.parametros ?? {}))
        : { ok: false, detail: `template desconhecido: ${item.template}` };
      const detalhe = res.ok
        ? null
        : res.reason === 'not_configured'
          ? 'API Oficial não configurada (OFFICIAL_API_URL / OFFICIAL_API_TOKEN)'
          : [res.status, res.detail].filter(Boolean).join(' — ') || 'falha no envio';
      await query(
        `UPDATE comunicado_disparo_itens SET status = $2, detalhe = $3, enviado_em = NOW() WHERE id = $1`,
        [item.id, res.ok ? 'enviado' : 'falhou', detalhe],
      );
      await fecharSeTerminou(item.disparo_id);
    }
  } finally {
    processando = false;
  }
}

async function fecharSeTerminou(disparoId: string): Promise<void> {
  await query(
    `UPDATE comunicado_disparos SET status = 'concluido', finished_at = NOW()
     WHERE id = $1 AND status = 'enviando'
       AND NOT EXISTS (SELECT 1 FROM comunicado_disparo_itens WHERE disparo_id = $1 AND status = 'pendente')`,
    [disparoId],
  );
}

export function startComunicadosDisparo(): void {
  setInterval(() => {
    processarDisparos().catch((err) => console.error('[comunicados] erro no disparo', err instanceof Error ? err.message : err));
  }, 60_000);
}
