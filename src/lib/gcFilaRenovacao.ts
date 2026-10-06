import type { GcClienteLista } from '@/services/gestaoClientes'
import { contaNoTotal } from '@/lib/gcSaude'

/**
 * Fila "Completar agora" das datas de renovação: um cliente conta se entra nos totais e tem serviço
 * ATIVO sem data de renovação — a mesma regra do sinal "Data de renovação" do semáforo.
 */
export function semDataDeRenovacao(c: GcClienteLista): boolean {
  return contaNoTotal(c) && (c.servicos ?? []).some((s) => s.status === 'ativo' && !s.data_renovacao)
}

const CHAVE_VISITADOS = 'gc:fila-renovacao:visitados'

/** Os clientes já abertos nesta rodada: quem foi pulado sem data não volta a ser o "próximo" em loop. */
export function lerVisitados(): string[] {
  try {
    const v = JSON.parse(window.sessionStorage.getItem(CHAVE_VISITADOS) ?? '[]')
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []
  } catch {
    return []
  }
}

export function gravarVisitados(ids: string[]): void {
  try {
    window.sessionStorage.setItem(CHAVE_VISITADOS, JSON.stringify(ids))
  } catch {
    /* sem armazenamento: a fila pode repetir um cliente, o que não quebra nada */
  }
}

/** O próximo da fila: o primeiro sem data que ainda não foi aberto nesta rodada (e não é o atual). */
export function proximoSemData(clientes: GcClienteLista[], visitados: string[], atual?: string): GcClienteLista | null {
  return (
    [...clientes]
      .filter((c) => semDataDeRenovacao(c) && c.id !== atual && !visitados.includes(c.id))
      .sort((a, b) => a.nome_empresa.localeCompare(b.nome_empresa))[0] ?? null
  )
}
