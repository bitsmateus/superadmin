import { ArrowRight, CalendarClock } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { mesPorExtenso } from '@/lib/gcMetricas'
import type { LancamentoPendente } from '@/hooks/useLancamentoPendente'

/**
 * Faixa "faltam X clientes lançarem o mês", com atalho pra grade "Lançar mês".
 *
 * Só aparece a partir do dia 5 e só quando há alguém pendente (ver useLancamentoPendente). Cobra o
 * mês que acabou de fechar: o relatório do mês é devido no dia 5 do seguinte, e sem os números
 * lançados não há relatório.
 */
export function FaixaLancamento({
  pendencia,
  onLancar,
}: {
  pendencia: LancamentoPendente
  /** Abre a grade de lançamento daquele mês. */
  onLancar: (periodo: string) => void
}) {
  if (!pendencia.ativo || pendencia.pendentes.length === 0) return null
  const { pendentes, periodo } = pendencia
  const nomes = pendentes.slice(0, 4).map((p) => p.nome)
  const resto = pendentes.length - nomes.length

  return (
    <div className="flex flex-wrap items-center gap-3 rounded-xl border border-warning/30 bg-warning/[0.06] px-4 py-3">
      <CalendarClock className="h-5 w-5 shrink-0 text-warning" />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-foreground">
          {pendentes.length === 1
            ? `Falta 1 cliente lançar ${mesPorExtenso(periodo)}`
            : `Faltam ${pendentes.length} clientes lançarem ${mesPorExtenso(periodo)}`}
        </p>
        <p className="truncate text-xs text-foreground/60">
          {nomes.join(', ')}
          {resto > 0 ? ` e mais ${resto}` : ''} — sem os números não dá pra publicar o relatório.
        </p>
      </div>
      <Button size="sm" rightIcon={<ArrowRight className="h-4 w-4" />} onClick={() => onLancar(periodo)}>
        Lançar mês
      </Button>
    </div>
  )
}
