/** "Hoje" no fuso local, no formato "YYYY-MM-DD" — pra comparar com datas salvas nos leads. */
export function todayKey(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** Pega só a parte "YYYY-MM-DD" de um valor salvo (data ou data+hora). */
export function dateKey(iso: string): string {
  return iso ? iso.slice(0, 10) : ''
}

/** Acima disso, um "Dia de contato" parado conta como não atualizado. */
export const STALE_MS = 24 * 60 * 60 * 1000

/** Classifica um lead nos 4 "status do dia" (não atualizado, atrasado, reunião hoje, proposta
 * hoje) — mesma lógica usada no painel do dia e no dashboard comercial, geral ou por SDR. */
export function classifyLeadToday<T extends { id: string; retornar: string; retornado: boolean; agendamento: string }>(
  row: T,
  diaContatoUpdatedAt: string | undefined,
  today: string,
): { naoAtualizado: boolean; atrasado: boolean; reuniaoHoje: boolean; propostaHoje: boolean } {
  const naoAtualizado = !!diaContatoUpdatedAt && Date.now() - new Date(diaContatoUpdatedAt).getTime() > STALE_MS
  const retornarKey = dateKey(row.retornar)
  const atrasado = !!retornarKey && retornarKey < today && !row.retornado
  const reuniaoHoje = dateKey(row.agendamento) === today
  const propostaHoje = retornarKey === today && !row.retornado
  return { naoAtualizado, atrasado, reuniaoHoje, propostaHoje }
}
