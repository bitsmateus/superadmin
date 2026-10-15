/** Sem acento, sem pontuação/espaço, minúsculo — pra comparar nomes de quadro/coluna/status escritos
 * de jeitos diferentes ("Follow-up Propostas" e "FOLLOW UP PROPOSTAS" viram a mesma coisa). */
export function normalizaNome(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
}
