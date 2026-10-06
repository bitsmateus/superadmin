import * as React from 'react'
import { gestaoClientes } from '@/services/gestaoClientes'
import { cobrancaAtiva, mesFechado } from '@/lib/gcCalendario'
import { pendentesDoMes } from '@/lib/gcLancamento'

export interface LancamentoPendente {
  /** Só liga a partir do dia 5. Antes disso o mês fechado ainda está no prazo. */
  ativo: boolean
  /** O mês cobrado, 'YYYY-MM'. */
  periodo: string
  pendentes: { id: string; nome: string }[]
}

const VAZIO: LancamentoPendente = { ativo: false, periodo: '', pendentes: [] }

/**
 * Quem ainda não lançou as métricas do mês que acabou de fechar — só a partir do dia 5 (antes
 * disso o mês fechado ainda está dentro do prazo). As regras de quem entra na conta estão em
 * lib/gcLancamento.ts.
 *
 * Busca por conta própria (e não reaproveita a lista da tela) porque as telas mostram meses
 * diferentes — Tráfego navega entre meses —, mas a cobrança é sempre do mês fechado.
 */
export function useLancamentoPendente(recarregarQuando?: unknown): LancamentoPendente {
  const [estado, setEstado] = React.useState<LancamentoPendente>(VAZIO)

  React.useEffect(() => {
    if (!cobrancaAtiva()) {
      setEstado(VAZIO)
      return
    }
    const periodo = mesFechado()
    let cancelado = false
    gestaoClientes
      .listar(periodo)
      .then((lista) => {
        if (cancelado) return
        setEstado({ ativo: true, periodo, pendentes: pendentesDoMes(lista, periodo) })
      })
      .catch(() => {
        // Sem a faixa a tela continua útil; um erro aqui não vale um aviso a mais.
        if (!cancelado) setEstado(VAZIO)
      })
    return () => {
      cancelado = true
    }
  }, [recarregarQuando])

  return estado
}
