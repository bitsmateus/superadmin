/**
 * Texto do resumo diário de agendamentos (grupo LEADS, 19h). Função pura: recebe os agendamentos do dia já
 * filtrados (ver jobs/leadsDailyReport.ts) e monta a mensagem. Só aparece quem agendou e os canais usados, e as
 * duas listas somam o total.
 */

export interface AgendamentoDoDia {
  /** Quem marcou: o autor da 1ª mudança pra "Reunião agendada" na linha do tempo do lead. */
  autor: string;
  /** SDR da lead — "IA Luiza" quando o SDR marcou que foi a IA que agendou. */
  sdr: string;
  /** Campo "Agendado por" (WhatsApp Comercial, Ligação, "Outro: …"); vazio nos antigos. */
  canal: string;
}

const DIAS_SEMANA = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];

/** Mesmo critério do quadro "Por quem agendou" das métricas do SDR. */
export function quemAgendou(a: AgendamentoDoDia): string {
  if (/luiza/i.test(a.sdr) || /luiza/i.test(a.autor)) return 'IA Luiza';
  if (/arthur/i.test(a.autor)) return 'SDR Arthur';
  if (/lu[ií]s/i.test(a.autor)) return 'SDR Luis';
  return a.autor.trim().split(/\s+/)[0] || 'Não informado';
}

/** "Outro: indicação" vira "Outro (indicação)"; vazio vira "Não informado". */
export function canalDoAgendamento(canal: string): string {
  const v = canal.trim();
  if (!v) return 'Não informado';
  const outro = v.match(/^outro:?\s*(.*)$/i);
  if (outro) return outro[1].trim() ? `Outro (${outro[1].trim()})` : 'Outro';
  return v;
}

/** Contagem decrescente; "Não informado" sempre por último. */
function contar(valores: string[]): Array<[string, number]> {
  const mapa = new Map<string, number>();
  for (const v of valores) mapa.set(v, (mapa.get(v) ?? 0) + 1);
  return [...mapa.entries()].sort((a, b) =>
    (a[0] === 'Não informado' ? 1 : 0) - (b[0] === 'Não informado' ? 1 : 0) || b[1] - a[1] || a[0].localeCompare(b[0]));
}

/** `dia` no formato AAAA-MM-DD (dia de São Paulo). */
export function montarResumoAgendamentos(dia: string, agendamentos: AgendamentoDoDia[]): string {
  const [ano, mes, d] = dia.split('-').map(Number);
  const semana = DIAS_SEMANA[new Date(Date.UTC(ano, mes - 1, d)).getUTCDay()];
  const titulo = `📊 *Resumo do dia — ${String(d).padStart(2, '0')}/${String(mes).padStart(2, '0')} (${semana})*`;
  const total = agendamentos.length;
  if (!total) return `${titulo}\n\n📅 *Total de A.G:* 0\nNenhum agendamento hoje.`;

  const lista = (pares: Array<[string, number]>) => pares.map(([nome, n]) => `• ${nome}: ${n}`).join('\n');
  return [
    titulo,
    '',
    `📅 *Total de A.G:* ${total}`,
    '',
    '👤 *Quem agendou*',
    lista(contar(agendamentos.map(quemAgendou))),
    '',
    '📞 *Agendamentos por canal*',
    lista(contar(agendamentos.map((a) => canalDoAgendamento(a.canal)))),
  ].join('\n');
}
