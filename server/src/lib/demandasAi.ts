import { query } from '../db.js';
import { isGoogleCalendarConfigured, listCalendarEvents } from './googleCalendar.js';

/**
 * "Organizar com IA" das abas de Demandas: manda pra Claude as demandas ainda abertas da aba
 * (título, status, etiqueta de urgência, retorno marcado) + os compromissos da pessoa vinculada na
 * agenda, e recebe um plano agrupado por horário/urgência. Só SUGERE — nenhuma demanda é alterada.
 */

const API_URL = 'https://api.anthropic.com/v1/messages';
const MODEL = process.env.ANTHROPIC_MODEL || 'claude-sonnet-5';
/** Status que contam como "não precisa mais de atenção" no quadro. */
const STATUS_FECHADOS = new Set(['feito', 'arquivado', 'concluido', 'concluído']);

export interface ItemPlano { id: string; titulo: string; motivo: string; horario: string | null }
export interface GrupoPlano { titulo: string; itens: ItemPlano[] }
export interface PlanoDemandas {
  resumo: string;
  grupos: GrupoPlano[];
  geradoEm: string;
  responsavel: string;
  totalDemandas: number;
  compromissos: number;
}

const SISTEMA = `Você organiza o dia de trabalho de uma pessoa de uma agência de marketing/automação (Grupo NX Digital).
Você recebe: (1) as demandas ABERTAS dela (cada uma com id, título, empresa, status/coluna, etiqueta de urgência, dia de retorno marcado e há quantos dias existe), e (2) os compromissos dela na agenda (hoje e próximos dias).

Monte um plano de execução:
- Separe as demandas em grupos por urgência e/ou horário, na ordem em que devem ser feitas. Exemplos de grupo: "Fazer agora (urgente)", "Hoje de manhã", "Hoje à tarde", "Esta semana", "Pode esperar". Use só os grupos que fizerem sentido, de 2 a 6 grupos.
- Encaixe as demandas nas janelas livres entre os compromissos de hoje; nunca sugira trabalhar por cima de um compromisso. Se hoje já está lotado, empurre o que não é urgente pra frente.
- Use a etiqueta (ex.: urgente/médio/baixo), o status (ex.: "Fazendo" e "Aguardando cliente" mandam no que está em andamento) e o tempo parado pra decidir a prioridade. Demanda "Aguardando cliente" normalmente só precisa de uma cobrança rápida.
- "horario" é uma sugestão curta (ex.: "09:00–10:30") só quando fizer sentido; senão null.
- "motivo" é UMA frase curta explicando por que está ali.
- Cada demanda aparece em no máximo UM grupo. Use exatamente o "id" recebido; nunca invente ids nem demandas. Demandas que você não citar serão listadas à parte.
- Se a pessoa não tem compromissos, diga isso no resumo e organize só por urgência.
- Português do Brasil, direto, sem enrolação.

Responda SOMENTE com JSON válido, sem markdown, neste formato:
{"resumo":"2 a 3 frases sobre o dia","grupos":[{"titulo":"...","itens":[{"id":"...","titulo":"...","motivo":"...","horario":"09:00–10:30"}]}]}`;

interface BlocoAnthropic { type: string; text?: string }

const fmtSp = (iso: string, opts: Intl.DateTimeFormatOptions) =>
  new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', ...opts }).format(new Date(iso));

async function chamarClaude(entrada: Record<string, unknown>): Promise<string> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error('ANTHROPIC_API_KEY não configurada no servidor.');
  const res = await fetch(API_URL, {
    method: 'POST',
    headers: {
      'x-api-key': key,
      'anthropic-version': '2023-06-01',
      ...(process.env.ANTHROPIC_WORKSPACE_ID ? { 'anthropic-workspace-id': process.env.ANTHROPIC_WORKSPACE_ID } : {}),
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 8000,
      system: SISTEMA,
      messages: [{ role: 'user', content: `Dados (JSON):\n${JSON.stringify(entrada)}` }],
    }),
  });
  if (!res.ok) {
    const detalhe = await res.text().catch(() => '');
    throw new Error(`Claude API ${res.status}: ${detalhe.slice(0, 300)}`);
  }
  const data = (await res.json()) as { content?: BlocoAnthropic[]; stop_reason?: string };
  if (data.stop_reason === 'refusal') throw new Error('A IA recusou o pedido.');
  const texto = (data.content ?? []).filter((b) => b.type === 'text').map((b) => b.text ?? '').join('\n').trim();
  if (!texto) throw new Error('A IA não retornou texto.');
  return texto;
}

const str = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

export async function organizarDemandas(page: { id: string; name: string; responsavel: string }): Promise<PlanoDemandas> {
  const rows = await query<{
    id: string; nome: string; empresa: string; status: string; etiqueta: string; retornar: string; quadro: string; dias: string;
  }>(
    `SELECT r.id, r.nome, r.empresa, r.status, r.etiqueta, r.retornar, b.name AS quadro,
            GREATEST(0, FLOOR(EXTRACT(EPOCH FROM (NOW() - r.created_at)) / 86400))::int AS dias
     FROM lead_rows r JOIN lead_boards b ON b.id = r.board_id
     WHERE b.page = $1 AND r.deleted_at IS NULL
     ORDER BY r.position LIMIT 150`,
    [page.id]
  );
  const abertas = rows.filter((r) => !STATUS_FECHADOS.has((r.status ?? '').trim().toLowerCase()) && r.nome.trim());
  if (!abertas.length) {
    return {
      resumo: 'Não há demandas abertas nesta aba.', grupos: [], geradoEm: new Date().toISOString(),
      responsavel: page.responsavel, totalDemandas: 0, compromissos: 0,
    };
  }

  // Agenda da pessoa vinculada: de agora até 7 dias. Agenda fora do ar não impede o plano.
  const agenda: { dia: string; inicio: string; fim: string; titulo: string }[] = [];
  if (page.responsavel && isGoogleCalendarConfigured()) {
    try {
      const agora = Date.now();
      const eventos = await listCalendarEvents(new Date(agora - 3 * 3600_000).toISOString(), new Date(agora + 7 * 86400_000).toISOString());
      const dono = page.responsavel.trim().toLowerCase();
      for (const e of eventos) {
        if ((e.responsavel ?? '').trim().toLowerCase() !== dono) continue;
        agenda.push({
          dia: fmtSp(e.start, { weekday: 'long', day: '2-digit', month: '2-digit' }),
          inicio: fmtSp(e.start, { hour: '2-digit', minute: '2-digit' }),
          fim: fmtSp(e.end, { hour: '2-digit', minute: '2-digit' }),
          titulo: e.title,
        });
      }
    } catch (err) {
      console.error('[demandasAi] agenda indisponível:', (err as Error).message);
    }
  }

  const agoraSp = fmtSp(new Date().toISOString(), { weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  const texto = await chamarClaude({
    agora: agoraSp,
    pessoa: page.responsavel || '(sem responsável vinculado)',
    aba: page.name,
    compromissos: agenda,
    demandas: abertas.map((r) => ({
      id: r.id, titulo: r.nome, empresa: r.empresa || undefined, status: r.status || 'Sem status',
      etiqueta: r.etiqueta || undefined, retornar: r.retornar || undefined, quadro: r.quadro, parada_ha_dias: Number(r.dias),
    })),
  });

  const ini = texto.indexOf('{');
  const fim = texto.lastIndexOf('}');
  if (ini < 0 || fim <= ini) throw new Error('Resposta da IA sem JSON.');
  const obj = JSON.parse(texto.slice(ini, fim + 1)) as { resumo?: unknown; grupos?: unknown };

  const porId = new Map(abertas.map((r) => [r.id, r]));
  const usados = new Set<string>();
  const grupos: GrupoPlano[] = [];
  for (const g of Array.isArray(obj.grupos) ? (obj.grupos as Record<string, unknown>[]) : []) {
    const itens: ItemPlano[] = [];
    for (const it of Array.isArray(g.itens) ? (g.itens as Record<string, unknown>[]) : []) {
      const id = str(it.id, 60);
      const row = porId.get(id);
      if (!row || usados.has(id)) continue;
      usados.add(id);
      itens.push({ id, titulo: row.nome, motivo: str(it.motivo, 240), horario: str(it.horario, 40) || null });
    }
    if (itens.length) grupos.push({ titulo: str(g.titulo, 80) || 'Demandas', itens });
  }
  // O que a IA não citou não some: vai num grupo final.
  const sobras = abertas.filter((r) => !usados.has(r.id));
  if (sobras.length) {
    grupos.push({ titulo: 'Sem prioridade definida', itens: sobras.map((r) => ({ id: r.id, titulo: r.nome, motivo: r.status ? `Status: ${r.status}` : '', horario: null })) });
  }

  return {
    resumo: str(obj.resumo, 600), grupos, geradoEm: new Date().toISOString(),
    responsavel: page.responsavel, totalDemandas: abertas.length, compromissos: agenda.length,
  };
}
