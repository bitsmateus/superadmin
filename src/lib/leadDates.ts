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

/** "Atrasados" só considera a partir daqui — leads importados de antes do sistema entrar em uso
 * (CRM Luis/Arthur) tinham "Retornar" com data antiga, inflando o contador com gente que nunca
 * ia ser cobrada de verdade (170 "atrasados" que na prática eram quase todos histórico morto).
 * Retornar de antes dessa data nunca conta como atrasado, não importa quão no passado esteja. */
export const ATRASADO_CUTOFF = '2026-08-01'

/** "Atrasados" só considera lead que está atualmente em Proposta Enviada — se já virou Vendido,
 * Follow-up ou qualquer outro status, o retorno antigo que ficou marcado não conta mais como
 * atrasado (o lead seguiu o funil, não está "esquecido"). */
export const ATRASADO_STATUS = 'Proposta Enviada'

/** Classifica um lead nos 4 "status do dia" (não atualizado, atrasado, reunião hoje, proposta
 * hoje) — mesma lógica usada no painel do dia e no dashboard comercial, geral ou por SDR. */
export function classifyLeadToday<T extends { id: string; retornar: string; retornado: boolean; agendamento: string; status: string }>(
  row: T,
  diaContatoUpdatedAt: string | undefined,
  today: string,
): { naoAtualizado: boolean; atrasado: boolean; reuniaoHoje: boolean; propostaHoje: boolean } {
  const naoAtualizado = !!diaContatoUpdatedAt && Date.now() - new Date(diaContatoUpdatedAt).getTime() > STALE_MS
  const retornarKey = dateKey(row.retornar)
  const atrasado = row.status === ATRASADO_STATUS && !!retornarKey && retornarKey >= ATRASADO_CUTOFF && retornarKey < today && !row.retornado
  const reuniaoHoje = dateKey(row.agendamento) === today
  const propostaHoje = retornarKey === today && !row.retornado
  return { naoAtualizado, atrasado, reuniaoHoje, propostaHoje }
}
