/**
 * EXECUÇÃO da consolidação dos CRMs. Tudo numa transação só (tudo ou nada):
 *  1. trava e confere: não foi executada antes (idempotente), o plano de agora é o mesmo que foi aprovado (assinatura) e
 *     não há nada em "O que impede a execução";
 *  2. backup das tabelas envolvidas (tabelas bkp_consolidacao_<data>_<tabela>, no mesmo banco);
 *  3. renomeia a aba, cria as etiquetas que faltam, junta (só vínculos + campos vazios), move e devolve a data de entrada
 *     no quadro, Responsável = Luis no CRM novo;
 *  4. confere (contagens, nenhum lead perdido, nenhuma cópia duplicada, abas protegidas iguais, régua intacta). Qualquer
 *     conferência que falhe desfaz TUDO (ROLLBACK), inclusive o backup.
 * Não mexe em comissão, nem em card do CRM IA LUIZA / CRM TUBARAO, nem na lixeira.
 */
import crypto from 'crypto';
import type { PoolClient } from 'pg';
import { CAMPOS_DA_REGUA, NOVO_NOME, PAGINA_DESTINO, PAGINAS_PROTEGIDAS, chaveDoQuadro, montarPlano, type Entrada, type Plano } from './consolidacaoCrm.js';

export const ATOR = 'Consolidação dos CRMs';
export const MOTIVO = 'Consolidação dos CRMs: juntado no card';

/** Tabelas copiadas antes de qualquer alteração. */
export const TABELAS_DO_BACKUP = [
  'lead_rows', 'lead_notes', 'lead_events', 'lead_board_history', 'lead_avisos', 'notificacoes', 'reminders', 'contracts',
  'clients', 'reuniao_resultados', 'reuniao_adiamentos', 'lead_labels', 'lead_pages', 'lead_boards',
];

/** Onde o card que sai pode estar ligado: tudo passa pro card que fica. */
const RELIGAR: { tabela: string; coluna: string; unico?: string }[] = [
  { tabela: 'lead_notes', coluna: 'lead_row_id' },
  { tabela: 'lead_events', coluna: 'lead_row_id' },
  { tabela: 'lead_board_history', coluna: 'lead_row_id' },
  { tabela: 'lead_avisos', coluna: 'lead_row_id' },
  { tabela: 'notificacoes', coluna: 'card_id' },
  { tabela: 'reminders', coluna: 'crm_card_id' },
  { tabela: 'contracts', coluna: 'venda_lead_id' },
  { tabela: 'clients', coluna: 'crm_lead_id' },
  { tabela: 'clients', coluna: 'crm_card_id' },
  { tabela: 'reuniao_resultados', coluna: 'card_id' },
  // Uma por (lead, horário): se o que fica já tem a mesma, a do que sai continua nele (fica no backup e no arquivado).
  { tabela: 'reuniao_resultados', coluna: 'lead_row_id', unico: 'agendamento' },
  { tabela: 'reuniao_adiamentos', coluna: 'familia', unico: 'agendamento' },
];

/** Assinatura do que vai ser feito: muda se qualquer decisão do plano mudar entre a simulação e a execução. */
export function assinaturaDoPlano(p: Plano): string {
  const a = p.acoes;
  const base = {
    mover: [...a.mover].sort((x, y) => x.id.localeCompare(y.id)),
    juntar: [...a.juntar].sort((x, y) => x.sai.localeCompare(y.sai))
      .map((j) => ({ ...j, campos: Object.keys(j.campos).sort().map((k) => [k, j.campos[k]]) })),
    etiquetas: [...a.etiquetas].sort((x, y) => `${x.field}${x.name}`.localeCompare(`${y.field}${y.name}`)),
  };
  return crypto.createHash('sha256').update(JSON.stringify(base)).digest('hex').slice(0, 16);
}

const iso = (v: unknown) => (v instanceof Date ? v.toISOString() : v === null || v === undefined ? null : String(v));
const reguaDe = (l: Record<string, unknown>) => JSON.stringify(CAMPOS_DA_REGUA.map((c) => iso(l[c])));
const previewTextoNota = (html: string) => {
  const t = html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
  return t.length > 140 ? `${t.slice(0, 140)}…` : t;
};
const COLUNA_VALIDA = /^[a-z_][a-z0-9_]*$/;

export interface ResultadoDaExecucao {
  executadaEm: string;
  por: string;
  backup: string[];
  contagens: Record<string, number>;
  regua: { disparo: number; followup: number; naoCompareceu: number; outros: number };
  conferencias: { item: string; ok: boolean; detalhe: string }[];
}

export class ErroDaConsolidacao extends Error {}

/**
 * Executa (dentro da transação `db`, que quem chama abre e fecha). `ler` lê os dados do jeito da simulação.
 * Lança ErroDaConsolidacao com o motivo se não pode executar ou se alguma conferência falhou (quem chama faz ROLLBACK).
 */
export async function executarConsolidacao(
  db: PoolClient, ler: (db: PoolClient) => Promise<Entrada>, opcoes: { assinatura: string; por: string; agora?: Date },
): Promise<ResultadoDaExecucao> {
  const q = async <T = Record<string, unknown>>(sql: string, params: unknown[] = []) => (await db.query(sql, params)).rows as T[];
  const agora = opcoes.agora ?? new Date();

  // 1) trava e confere
  await q("SELECT pg_advisory_xact_lock(hashtext('consolidacao-crm'))");
  await q("SET LOCAL statement_timeout = '120s'");
  if ((await q('SELECT 1 FROM crm_consolidacao')).length) throw new ErroDaConsolidacao('A consolidação já foi executada.');
  // Ninguém grava card enquanto a consolidação roda (as leituras continuam).
  await q('LOCK TABLE lead_rows IN SHARE ROW EXCLUSIVE MODE');
  await q(`SELECT set_config('app.actor', $1, true)`, [ATOR]);

  const dados = await ler(db);
  const plano = montarPlano(dados);
  if (plano.problemas.length) throw new ErroDaConsolidacao(`Ainda há o que impede a execução: ${plano.problemas.join(' | ')}`);
  const assinatura = assinaturaDoPlano(plano);
  if (assinatura !== opcoes.assinatura) {
    throw new ErroDaConsolidacao('Os dados mudaram desde a simulação aprovada (a assinatura não bate). Rode a simulação de novo e confira.');
  }

  const quadroPorId = new Map(dados.quadros.map((x) => [x.id, x]));
  const paginaDo = (boardId: string) => quadroPorId.get(boardId)?.page ?? '';
  const ativosDoEscopo = dados.leads.filter((l) => !l.deleted_at && (paginaDo(l.board_id) === PAGINA_DESTINO
    || plano.origens.some((o) => o.id === paginaDo(l.board_id))));
  const antes = new Map(ativosDoEscopo.map((l) => [l.id, l]));
  const protegidasAntes = await q<{ n: number; h: string | null }>(
    `SELECT count(*)::int AS n, md5(string_agg(r::text, '|' ORDER BY r.id)) AS h
     FROM lead_rows r JOIN lead_boards lb ON lb.id = r.board_id WHERE lb.page = ANY($1)`, [PAGINAS_PROTEGIDAS]);

  // 2) backup
  const sufixo = agora.toISOString().replace(/[-:T]/g, '').slice(0, 12);
  const backup: string[] = [];
  for (const t of TABELAS_DO_BACKUP) {
    const nome = `bkp_consolidacao_${sufixo}_${t}`;
    await q(`CREATE TABLE ${nome} AS SELECT * FROM ${t}`);
    backup.push(nome);
  }

  // 3a) nome da aba
  await q('UPDATE lead_pages SET name = $2 WHERE id = $1 AND name <> $2', [PAGINA_DESTINO, NOVO_NOME]);

  // 3b) etiquetas que faltam no destino
  for (const e of plano.acoes.etiquetas) {
    await q(
      `INSERT INTO lead_labels (field, name, color, position, page_id)
       SELECT $1, $2, $3, COALESCE((SELECT MAX(position) + 1 FROM lead_labels WHERE field = $1 AND page_id = $4), 0), $4
       WHERE NOT EXISTS (SELECT 1 FROM lead_labels WHERE field = $1 AND page_id = $4 AND lower(name) = lower($2))`,
      [e.field, e.name, e.color, PAGINA_DESTINO]);
  }

  // 3c) juntar: campos vazios do que fica + vínculos; o que sai é arquivado
  const colunas = new Set((await q<{ column_name: string; data_type: string }>(
    `SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'lead_rows'`)).map((c) => c.column_name));
  const ficas = new Set<string>();
  for (const j of plano.acoes.juntar) {
    for (const [campo, valor] of Object.entries(j.campos)) {
      if (!COLUNA_VALIDA.test(campo) || !colunas.has(campo)) continue;
      const v = valor !== null && typeof valor === 'object' && !(valor instanceof Date) ? JSON.stringify(valor) : valor;
      await q(
        `UPDATE lead_rows SET ${campo} = $2 WHERE id = $1
           AND (${campo} IS NULL OR ${campo}::text IN ('', '{}', '[]', 'null'))`, [j.fica, v]);
    }
    for (const r of RELIGAR) {
      const sql = r.unico
        ? `UPDATE ${r.tabela} t SET ${r.coluna} = $2 WHERE t.${r.coluna} = $1
             AND NOT EXISTS (SELECT 1 FROM ${r.tabela} x WHERE x.${r.coluna} = $2 AND x.${r.unico} = t.${r.unico})`
        : `UPDATE ${r.tabela} SET ${r.coluna} = $2 WHERE ${r.coluna} = $1`;
      await q(sql, [j.sai, j.fica]);
    }
    // Venda: só uma por card — a do que sai só passa se o que fica não tem.
    await q(`UPDATE lead_rows SET venda_origem_id = $2 WHERE venda_origem_id = $1
             AND NOT EXISTS (SELECT 1 FROM lead_rows x WHERE x.venda_origem_id = $2)`, [j.sai, j.fica]);
    await q(`UPDATE lead_rows SET deleted_at = $2, delete_reason = $3 WHERE id = $1 AND deleted_at IS NULL`,
      [j.sai, agora, `${MOTIVO} ${j.fica}`]);
    ficas.add(j.fica);
  }
  // Contagem e prévia das Atualizações de quem recebeu histórico.
  for (const id of ficas) {
    const [ultima] = await q<{ content: string; created_at: Date }>(
      'SELECT content, created_at FROM lead_notes WHERE lead_row_id = $1 ORDER BY created_at DESC LIMIT 1', [id]);
    await q(
      `UPDATE lead_rows SET notes_count = (SELECT count(*) FROM lead_notes WHERE lead_row_id = $1), last_note_preview = $2, last_note_at = $3
       WHERE id = $1`, [id, ultima ? previewTextoNota(ultima.content) : '', ultima?.created_at ?? null]);
  }

  // 3d) mover e devolver a data de entrada no quadro (o gatilho do banco põe "agora" ao trocar de quadro)
  for (const m of plano.acoes.mover) {
    await q('UPDATE lead_rows SET board_id = $2 WHERE id = $1 AND board_id <> $2 AND deleted_at IS NULL', [m.id, m.board]);
    await q('UPDATE lead_rows SET entrou_coluna_em = $2 WHERE id = $1', [m.id, antes.get(m.id)?.entrou_coluna_em ?? null]);
  }

  // 3e) Responsável = Luis em todos os leads do CRM novo (única mudança de campo)
  const [{ n: responsaveis }] = await q<{ n: number }>(
    `WITH u AS (UPDATE lead_rows r SET responsavel = 'Luis' FROM lead_boards lb
       WHERE lb.id = r.board_id AND lb.page = $1 AND r.deleted_at IS NULL AND r.responsavel IS DISTINCT FROM 'Luis' RETURNING 1)
     SELECT count(*)::int AS n FROM u`, [PAGINA_DESTINO]);

  // 4) conferência
  const conferencias: ResultadoDaExecucao['conferencias'] = [];
  const confere = (item: string, ok: boolean, detalhe: string) => conferencias.push({ item, ok, detalhe });

  const depois = await q<Record<string, unknown> & { id: string; page: string; quadro: string }>(
    `SELECT r.*, lb.page, lb.name AS quadro FROM lead_rows r JOIN lead_boards lb ON lb.id = r.board_id WHERE r.id = ANY($1::uuid[])`,
    [[...antes.keys()]]);
  const noDestino = depois.filter((r) => !r.deleted_at && r.page === PAGINA_DESTINO);
  const [{ n: totalNoDestino }] = await q<{ n: number }>(
    `SELECT count(*)::int AS n FROM lead_rows r JOIN lead_boards lb ON lb.id = r.board_id WHERE lb.page = $1 AND r.deleted_at IS NULL
       AND NOT lb.is_vendas AND NOT lb.is_contrato`, [PAGINA_DESTINO]);
  confere('Total no CRM novo', totalNoDestino === plano.total.esperadoNoFinal,
    `${totalNoDestino} (esperado ${plano.total.esperadoNoFinal})`);
  const arquivadosAgora = depois.filter((r) => r.deleted_at && String(r.delete_reason ?? '').startsWith(MOTIVO));
  confere('Arquivados (juntados)', arquivadosAgora.length === plano.total.arquivados,
    `${arquivadosAgora.length} (esperado ${plano.total.arquivados})`);
  const perdidos = depois.filter((r) => !(r.page === PAGINA_DESTINO && !r.deleted_at) && !arquivadosAgora.includes(r)).length
    + (antes.size - depois.length);
  confere('Nenhum lead perdido', perdidos === 0, `${perdidos} lead(s) fora do CRM novo sem ter sido juntado`);
  const [{ n: sobraram }] = await q<{ n: number }>(
    `SELECT count(*)::int AS n FROM lead_rows r JOIN lead_boards lb ON lb.id = r.board_id
     WHERE lb.page = ANY($1) AND r.deleted_at IS NULL AND NOT lb.is_vendas AND NOT lb.is_contrato`, [plano.origens.map((o) => o.id)]);
  confere('CRM LUIS e CRM LUIS CLOSER vazios', sobraram === 0, `${sobraram} card(s) ativos ainda lá`);
  const [{ n: copiasDuplicadas }] = await q<{ n: number }>(
    `SELECT count(*)::int AS n FROM lead_rows c JOIN lead_boards cb ON cb.id = c.board_id
     JOIN lead_rows o ON o.id = c.espelho_origem_id JOIN lead_boards ob ON ob.id = o.board_id
     WHERE c.deleted_at IS NULL AND o.deleted_at IS NULL AND cb.page = $1 AND ob.page = $1`, [PAGINA_DESTINO]);
  confere('Nenhuma cópia do closer junto da origem no CRM novo', copiasDuplicadas === 0, `${copiasDuplicadas}`);
  const protegidasDepois = await q<{ n: number; h: string | null }>(
    `SELECT count(*)::int AS n, md5(string_agg(r::text, '|' ORDER BY r.id)) AS h
     FROM lead_rows r JOIN lead_boards lb ON lb.id = r.board_id WHERE lb.page = ANY($1)`, [PAGINAS_PROTEGIDAS]);
  confere('CRM IA LUIZA e CRM TUBARAO intactos',
    protegidasDepois[0].n === protegidasAntes[0].n && protegidasDepois[0].h === protegidasAntes[0].h,
    `${protegidasDepois[0].n} cards (antes ${protegidasAntes[0].n}), conteúdo ${protegidasDepois[0].h === protegidasAntes[0].h ? 'igual' : 'DIFERENTE'}`);

  const regua = { disparo: 0, followup: 0, naoCompareceu: 0, outros: 0 };
  for (const r of noDestino) {
    const a = antes.get(r.id);
    if (!a || reguaDe(a) === reguaDe(r)) continue;
    const k = chaveDoQuadro(r.quadro);
    if (k.startsWith('disparoemmassa')) regua.disparo++;
    else if (k.startsWith('follow')) regua.followup++;
    else if (k === 'reuniaonaocomparecida') regua.naoCompareceu++;
    else regua.outros++;
  }
  const reguaMudou = regua.disparo + regua.followup + regua.naoCompareceu + regua.outros;
  confere('Régua intacta (entrou_coluna_em e regua_*)', reguaMudou === 0,
    `Disparo em massa ${regua.disparo} · Follow up ${regua.followup} · Reunião não comparecida ${regua.naoCompareceu} · outros ${regua.outros}`);

  const resultado: ResultadoDaExecucao = {
    executadaEm: agora.toISOString(), por: opcoes.por, backup,
    contagens: {
      movidos: plano.acoes.mover.length, juntados: plano.acoes.juntar.length, etiquetasCriadas: plano.acoes.etiquetas.length,
      responsavelLuis: responsaveis, totalNoDestino,
    },
    regua, conferencias,
  };
  const falhas = conferencias.filter((c) => !c.ok);
  if (falhas.length) {
    throw new ErroDaConsolidacao(`Conferência falhou, nada foi gravado: ${falhas.map((f) => `${f.item}: ${f.detalhe}`).join(' | ')}`);
  }
  // Marca de executada (é ela que liga as regras novas do closer — ver lib/crmConsolidado.ts).
  await q('INSERT INTO crm_consolidacao (por, resultado) VALUES ($1, $2)', [opcoes.por, JSON.stringify(resultado)]);
  return resultado;
}

/** O resultado em texto, pra tela. */
export function textoDoResultado(r: ResultadoDaExecucao): string {
  const L = [
    `# Consolidação executada — ${new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', dateStyle: 'short', timeStyle: 'short' }).format(new Date(r.executadaEm))} por ${r.por}`,
    '',
    `Movidos: ${r.contagens.movidos} · Juntados (arquivados): ${r.contagens.juntados} · Etiquetas criadas: ${r.contagens.etiquetasCriadas}`,
    `Responsável = Luis em ${r.contagens.responsavelLuis} lead(s) · Total no CRM novo: ${r.contagens.totalNoDestino}`,
    '', '## Conferência',
    ...r.conferencias.map((c) => `- ${c.ok ? 'OK' : 'FALHOU'} — ${c.item}: ${c.detalhe}`),
    '', '## Régua: cards com entrou_coluna_em/regua_* alterados',
    `Disparo em massa ${r.regua.disparo} · Follow up ${r.regua.followup} · Reunião não comparecida ${r.regua.naoCompareceu}`,
    '', '## Backup (no mesmo banco)',
    ...r.backup.map((b) => `- ${b}`),
  ];
  return L.join('\n');
}
