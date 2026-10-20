/**
 * Regra dos CRMs do Arthur e do Luis (inclui o Closer): pra MUDAR o lead pra "Reunião agendada" é obrigatório ter
 * data e horário do agendamento, e pra "Proposta enviada" é obrigatório ter data e horário em "Retornar". O
 * servidor aplica a mesma regra (ver faltaDadoDoStatus em server/src/routes/leadBoards.ts).
 */
export type CampoExigido = 'agendamento' | 'retornar'

function normaliza(s: string): string {
  return (s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '')
}

export function abaComRegraDeStatus(nomeDaAba: string, idDaAba = ''): boolean {
  return /(arthur|lu[ií]s)/i.test(nomeDaAba) || /(arthur|luis)/i.test(idDaAba)
}

/** O campo que o status (ou o nome do quadro) exige, ou null. */
export function campoExigidoPeloStatus(statusOuQuadro: string): CampoExigido | null {
  const n = normaliza(statusOuQuadro)
  if (n.includes('reuniaoagendada')) return 'agendamento'
  if (n.includes('propostaenviada')) return 'retornar'
  return null
}

export function mesmoStatus(a: string, b: string): boolean {
  return normaliza(a) === normaliza(b)
}

/** Data E horário preenchidos (formato salvo: AAAA-MM-DDTHH:MM). */
export function temDataEHora(valor: string | null | undefined): boolean {
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(valor ?? '')
}
