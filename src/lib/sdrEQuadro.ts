/** Regras puras de "marcar o SDR" em Novos Leads (ver marcarSdrNosLeads em LeadBoardsView.tsx). */

const semAcento = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '')

/** Nome de quadro comparável: sem maiúscula/minúscula, acento nem espaço sobrando ("LEADS NOVOS" = "Leads Novos"). */
export function chaveDoNomeDoQuadro(nome: string): string {
  return semAcento(nome).toLowerCase().replace(/\s+/g, ' ').trim()
}

const primeiroNome = (nome: string | null | undefined): string =>
  semAcento(nome ?? '').toLowerCase().trim().split(/\s+/)[0] ?? ''

/**
 * A etiqueta de SDR (pelo primeiro nome, ex.: "Arthur") é de alguém suspenso ou removido da Equipe — e não há ninguém
 * ATIVO com o mesmo primeiro nome? Então ela não aparece pra escolher (pedido de 27/11); quem já tem o nome gravado
 * continua mostrando. Mesma regra do servidor (nomeSuspenso em server/src/lib/regrasDaConsolidacao.ts).
 */
export function sdrSuspensoEntre(perfis: { name: string | null; inativo?: boolean }[], sdr: string): boolean {
  const p = primeiroNome(sdr)
  if (!p) return false
  const doNome = perfis.filter((x) => primeiroNome(x.name) === p)
  return doNome.some((x) => x.inativo) && !doNome.some((x) => !x.inativo)
}
