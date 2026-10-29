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

/** Toda reunião que a IA Luiza agenda é pelo WhatsApp Comercial: sem o "Agendado por" preenchido, conta lá. */
export const CANAL_DA_LUIZA = 'WhatsApp Comercial';

/** O canal que vale pra contagem: o "Agendado por", ou o da Luiza quando foi ela e o campo está vazio. */
export function canalEfetivo(a: AgendamentoDoDia): string {
  return a.canal.trim() || (quemAgendou(a) === 'IA Luiza' ? CANAL_DA_LUIZA : '');
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
    lista(contar(agendamentos.map((a) => canalDoAgendamento(canalEfetivo(a))))),
  ].join('\n');
}

// ── Retornos de proposta e no-show do dia ────────────────────────────────────

/** Como o dia terminou nos retornos de proposta do CRM do closer. */
export interface RetornosDoDia {
  /** Registrou "Retornou" — o cliente deu resposta. */
  retornou: number
  /** Registrou "Sem resposta" — tentou e não achou. */
  semResposta: number
  /** Registrou "Adiado" — empurrou pra outra data. */
  adiado: number
  /** Venceu e ninguém registrou nada: a lista que precisa de cobrança. */
  faltou: string[]
}

function linhaNomes(nomes: string[], limite = 12): string[] {
  const mostra = nomes.slice(0, limite)
  const linhas = mostra.map((n) => `• ${n}`)
  if (nomes.length > mostra.length) linhas.push(`• _+${nomes.length - mostra.length} outros_`)
  return linhas
}

/**
 * Bloco de retornos de proposta. "Faltou" é o que venceu sem ninguém registrar — é o único
 * número acionável aqui, por isso vem com os nomes e os outros só com a contagem.
 */
export function blocoRetornos(r: RetornosDoDia): string[] {
  const total = r.retornou + r.semResposta + r.adiado
  if (!total && !r.faltou.length) return []
  const out = ['', '📝 *Retornos de proposta*']
  out.push(`• Retornou: ${r.retornou}`)
  out.push(`• Sem resposta: ${r.semResposta}`)
  if (r.adiado) out.push(`• Adiado: ${r.adiado}`)
  if (r.faltou.length) {
    out.push('', `⚠️ *Faltou retornar (${r.faltou.length})*`, ...linhaNomes(r.faltou))
  }
  return out
}

/** O que aconteceu com as reuniões marcadas pro dia. */
export interface ReunioesDoDia {
  /** A reunião aconteceu e o lead andou de etapa. */
  compareceu: string[]
  /** Marcado como "Reunião não comparecida". */
  noShow: string[]
  /** Ainda em "Reunião agendada": ninguém registrou o resultado. */
  pendentes: number
}

/**
 * Bloco das reuniões do dia. Mostra quem compareceu e, quando houver, quem deu no-show com nome.
 * Sem reunião nenhuma marcada, o bloco inteiro some.
 */
export function blocoReunioes(r: ReunioesDoDia): string[] {
  const total = r.compareceu.length + r.noShow.length + r.pendentes
  if (!total) return []
  const out = ['', `🤝 *Reuniões de hoje (${total})*`]
  out.push(`• Compareceram: ${r.compareceu.length}`)
  out.push(`• Não compareceram: ${r.noShow.length}`)
  // Sem resultado registrado é pendência de alguém, então só aparece quando existe.
  if (r.pendentes) out.push(`• Sem resultado ainda: ${r.pendentes}`)
  // Só o no-show vem com nome: é o que precisa de ação (reagendar, cobrar). Quem compareceu já
  // andou de etapa sozinho, então listar os nomes só alongaria a mensagem sem ninguém usar.
  if (r.noShow.length) out.push('', `🚫 *Não compareceram (${r.noShow.length})*`, ...linhaNomes(r.noShow))
  return out
}
