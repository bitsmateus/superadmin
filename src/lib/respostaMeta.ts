/**
 * Respostas do formulário do Meta chegam com "_" no lugar do espaço ("4_a_10_atendentes"). Aqui é só a EXIBIÇÃO (o banco não
 * muda): vale pra "Dor do cliente", "Número de atendentes" e "Prioridade", dos leads novos e antigos.
 */
export function formatarResposta(valor: string | null | undefined): string {
  const t = String(valor ?? '').replace(/_+/g, ' ').replace(/\s{2,}/g, ' ').trim()
  return t ? t.charAt(0).toLocaleUpperCase('pt-BR') + t.slice(1) : ''
}

/** Lead sem a resposta de prazo. */
export const SEM_PRIORIDADE = 'Sem ID'

/** Prioridade = a resposta do cliente a "Quando você quer colocar isso pra rodar?", sem converter em nível. */
export const prioridadeExibida = (valor: string | null | undefined): string => formatarResposta(valor) || SEM_PRIORIDADE

/** As respostas do formulário, na ordem em que ele oferece (usada no filtro e na ordenação). */
export const OPCOES_DE_PRIORIDADE = ['O quanto antes', 'Nos próximos 30 dias', 'Em 2 a 3 meses', 'Só estou pesquisando']

/** Filtro por prioridade: compara o texto que aparece na coluna (inclusive "Sem ID"). Filtro vazio = todos. */
export const passaNaPrioridade = (valor: string | null | undefined, filtro: string | null): boolean =>
  !filtro || prioridadeExibida(valor).toLocaleLowerCase('pt-BR') === filtro.toLocaleLowerCase('pt-BR')

/**
 * Texto livre do formulário indo pro CSV: o Excel lê como fórmula a célula que começa com = + - @ (e o Instagram costuma
 * começar com "@"). A tabulação na frente faz a célula ser lida como texto.
 */
export const textoSeguroNoCsv = (valor: string): string => (/^[=+\-@]/.test(valor) ? `\t${valor}` : valor)

/** Posição pra ordenar: a ordem do formulário; resposta diferente depois; "Sem ID" por último. */
export function ordemDaPrioridade(valor: string | null | undefined): number {
  const t = formatarResposta(valor)
  if (!t) return OPCOES_DE_PRIORIDADE.length + 1
  const i = OPCOES_DE_PRIORIDADE.findIndex((o) => o.toLocaleLowerCase('pt-BR') === t.toLocaleLowerCase('pt-BR'))
  return i >= 0 ? i : OPCOES_DE_PRIORIDADE.length
}
