/**
 * Conferência de coerência dos números lançados num mês (módulo "Clientes NX Digital").
 *
 * É a MESMA regra de src/lib/gcMetricas.ts (validarMetricas), repetida aqui de propósito: o servidor
 * não importa código do front, e a regra precisa valer no servidor — a tela confere antes, mas quem
 * chama a API direto, ou uma tela desatualizada, passaria números impossíveis pro relatório que o
 * cliente lê. Se uma mudar, a outra muda junto.
 *
 * Só compara pares em que os DOIS lados existem: campo vazio é "não sei", e não dá pra dizer que
 * "leads > cliques" se ninguém lançou os cliques.
 */
export function validarMetricas(valores: Record<string, number | null | undefined>): string[] {
  const avisos: string[] = [];
  const v = (chave: string): number | null => {
    const x = valores[chave];
    return x === null || x === undefined || Number.isNaN(x) ? null : x;
  };
  const impressoes = v('impressoes');
  const cliques = v('cliques');
  const leads = v('leads');
  const vendas = v('vendas');
  const n = (x: number) => x.toLocaleString('pt-BR');

  if (impressoes !== null && cliques !== null && cliques > impressoes) {
    // CTR acima de 100% é a mesma contradição vista de outro ângulo: um aviso só, com os dois nomes.
    const ctr = impressoes > 0 ? Math.round((cliques / impressoes) * 100) : null;
    avisos.push(
      `Cliques (${n(cliques)}) maior que impressões (${n(impressoes)})` +
        (ctr !== null ? ` — o CTR ficaria em ${ctr}%` : '')
    );
  }
  if (cliques !== null && leads !== null && leads > cliques) {
    avisos.push(`Leads (${n(leads)}) maior que cliques (${n(cliques)})`);
  }
  if (leads !== null && vendas !== null && vendas > leads) {
    avisos.push(`Vendas (${n(vendas)}) maior que leads (${n(leads)})`);
  }
  return avisos;
}
