/** "Hoje" no fuso local, no formato "YYYY-MM-DD" — pra comparar com datas salvas nos leads. */
export function todayKey(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** Pega só a parte "YYYY-MM-DD" de um valor salvo (data ou data+hora). */
export function dateKey(iso: string): string {
  return iso ? iso.slice(0, 10) : ''
}

/** "Atrasados" só considera a partir daqui — leads importados de antes do sistema entrar em uso
 * (CRM Luis/Arthur) tinham "Retornar" com data antiga, inflando o contador com gente que nunca
 * ia ser cobrada de verdade (170 "atrasados" que na prática eram quase todos histórico morto).
 * Retornar de antes dessa data nunca conta como atrasado, não importa quão no passado esteja. */
export const ATRASADO_CUTOFF = '2026-08-01'

/** "Atrasados" só considera lead que está atualmente em Proposta Enviada — se já virou Vendido,
 * Follow-up ou qualquer outro status, o retorno antigo que ficou marcado não conta mais como
 * atrasado (o lead seguiu o funil, não está "esquecido"). */
export const ATRASADO_STATUS = 'Proposta Enviada'

/** Status sem maiúscula, acento, espaço nem traço: "Proposta enviada" = "Proposta Enviada", "Follow-up" = "Follow up". */
function normalizaStatus(s: string): string {
  return (s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '')
}

/** Status do closer que contam em "Propostas paradas": a proposta saiu e está esperando o retorno do cliente. */
export function ehStatusDeProposta(status: string): boolean {
  const n = normalizaStatus(status)
  return n === 'propostaenviada' || n.startsWith('followuppropostas')
}

/** Dias sem nenhum movimento (Linha do tempo ou Atualização) pra uma proposta do closer contar como parada. */
export const DIAS_PROPOSTA_PARADA = 3

/** Proposta do closer parada: sem movimento há DIAS_PROPOSTA_PARADA dias ou mais, e sem um retorno marcado de hoje
 * em diante (retorno agendado não é esquecimento — e o de hoje já está em "Propostas p/ retornar hoje"). */
export function propostaParada<T extends { status: string; retornar: string; retornado: boolean }>(
  row: T,
  ultimaAtividade: string | undefined,
  today: string,
): boolean {
  if (!ehStatusDeProposta(row.status)) return false
  const retornarKey = dateKey(row.retornar)
  if (retornarKey && retornarKey >= today && !row.retornado) return false
  const d = new Date(`${today}T12:00:00`)
  d.setDate(d.getDate() - DIAS_PROPOSTA_PARADA)
  const limite = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  return !!ultimaAtividade && localDateKey(ultimaAtividade) <= limite
}

/** "YYYY-MM-DD" no fuso local de um timestamp do banco (ISO com fuso). */
function localDateKey(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return dateKey(iso)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** Classifica um lead nos 4 "status do dia" (não atualizado, atrasado, reunião hoje, proposta
 * hoje) — mesma lógica usada no painel do dia e no dashboard comercial, geral ou por SDR. */
export function classifyLeadToday<T extends { id: string; retornar: string; retornado: boolean; agendamento: string; status: string }>(
  row: T,
  diaContatoUpdatedAt: string | undefined,
  today: string,
): { naoAtualizado: boolean; atrasado: boolean; reuniaoHoje: boolean; propostaHoje: boolean } {
  // Por CALENDÁRIO, não por janela de 24h corrida: se "Dia de contato" não foi tocado HOJE (nem
  // nunca, se diaContatoUpdatedAt vier vazio), conta como não atualizado assim que o dia vira —
  // uma janela rolante de 24h a partir do último toque só ia disparar horas depois da meia-noite,
  // dependendo de que horas foi a última atualização do dia anterior.
  const naoAtualizado = dateKey(diaContatoUpdatedAt ?? '') !== today
  const retornarKey = dateKey(row.retornar)
  const atrasado = normalizaStatus(row.status) === normalizaStatus(ATRASADO_STATUS) && !!retornarKey && retornarKey >= ATRASADO_CUTOFF && retornarKey < today && !row.retornado
  const reuniaoHoje = dateKey(row.agendamento) === today
  const propostaHoje = retornarKey === today && !row.retornado
  return { naoAtualizado, atrasado, reuniaoHoje, propostaHoje }
}
