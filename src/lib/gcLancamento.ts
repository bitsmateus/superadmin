import type { GcClienteLista } from '@/services/gestaoClientes'
import { ultimoDiaDoMes } from '@/lib/gcCalendario'
import { contaNoTotal } from '@/lib/gcSaude'

/**
 * Quem deveria ter lançado `periodo` e não lançou. `lista` precisa ser a lista carregada PARA esse
 * período (é o `metricas_mes` dela que diz se há lançamento).
 *
 * Três regras, todas pra não gerar alarme falso:
 *  - só quem conta nos totais (ativo e não-teste);
 *  - só quem JÁ ERA cliente naquele mês: cobrar métrica de setembro de quem entrou na base em
 *    outubro seria cobrar um número que nunca existiu;
 *  - lançamento é qualquer métrica gravada no mês — vazio total é que é pendência.
 */
export function pendentesDoMes(
  lista: GcClienteLista[],
  periodo: string,
): { id: string; nome: string }[] {
  const fim = ultimoDiaDoMes(periodo)
  return lista
    .filter((c) => contaNoTotal(c))
    .filter((c) => String(c.created_at).slice(0, 10) <= fim)
    .filter((c) => Object.keys(c.metricas_mes ?? {}).length === 0)
    .map((c) => ({ id: c.id, nome: c.nome_empresa }))
    .sort((a, b) => a.nome.localeCompare(b.nome))
}
