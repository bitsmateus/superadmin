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

export type SituacaoDoMes = 'sem_lancamento' | 'lancado' | 'rascunho' | 'publicado'

/**
 * Em que pé está o mês do cliente. Vale o estágio MAIS AVANÇADO: relatório publicado manda sobre
 * rascunho, que manda sobre "só lançou números", que manda sobre nada.
 *
 * Rascunho sem métrica nenhuma ainda é "rascunho": alguém começou a escrever, e esconder isso
 * atrás de "sem lançamento" mentiria sobre o andamento.
 */
export function situacaoDoMes(c: Pick<GcClienteLista, 'metricas_mes' | 'relatorio_mes'>): SituacaoDoMes {
  if (c.relatorio_mes === 'publicado') return 'publicado'
  if (c.relatorio_mes === 'rascunho') return 'rascunho'
  return Object.keys(c.metricas_mes ?? {}).length > 0 ? 'lancado' : 'sem_lancamento'
}

