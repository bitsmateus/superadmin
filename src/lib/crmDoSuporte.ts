/** Quadros na ordem da aba, com "Vendas do mês" sempre por último (CRM do Jean/João, aba de Demandas dentro do
 * Pipeline): quadro criado depois entra antes dele. */
export function vendasDoMesPorUltimo<T extends { name: string }>(quadros: T[]): T[] {
  const ehVendas = (q: T) => q.name.normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase() === 'vendas do mes'
  return [...quadros.filter((q) => !ehVendas(q)), ...quadros.filter(ehVendas)]
}
