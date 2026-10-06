/**
 * Calendário do módulo "Clientes NX Digital", sempre em horário de Brasília.
 *
 * Em UTC, a virada do dia cai às 21h: "hoje é dia 5?" daria a resposta errada de noite, e o alerta de
 * lançamento ligaria (ou desligaria) quase um dia antes da hora.
 */

/** Dia de cada mês a partir do qual o mês que acabou de fechar passa a ser cobrado. */
export const DIA_DA_COBRANCA = 5

export interface Hoje {
  ano: number
  /** 1 a 12 */
  mes: number
  dia: number
}

export function hojeBrasilia(agora: Date = new Date()): Hoje {
  const partes = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
    .format(agora)
    .split('-')
    .map(Number)
  return { ano: partes[0], mes: partes[1], dia: partes[2] }
}

function comoPeriodo(ano: number, mes: number): string {
  return `${ano}-${String(mes).padStart(2, '0')}`
}

/** O mês que acabou de fechar ('YYYY-MM'): é o que a equipe precisa lançar e reportar. */
export function mesFechado(agora: Date = new Date()): string {
  const { ano, mes } = hojeBrasilia(agora)
  return mes === 1 ? comoPeriodo(ano - 1, 12) : comoPeriodo(ano, mes - 1)
}

/** Já passou do dia da cobrança? Antes dele, o mês fechado ainda está dentro do prazo. */
export function cobrancaAtiva(agora: Date = new Date()): boolean {
  return hojeBrasilia(agora).dia >= DIA_DA_COBRANCA
}

/** Último dia do mês 'YYYY-MM', como 'YYYY-MM-DD'. */
export function ultimoDiaDoMes(periodo: string): string {
  const [ano, mes] = periodo.split('-').map(Number)
  return `${periodo}-${String(new Date(ano, mes, 0).getDate()).padStart(2, '0')}`
}
