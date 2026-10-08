import * as React from 'react'
import { CalendarCheck, UserCheck, TrendingUp, UserRound } from 'lucide-react'
import { useMonthFilter, addMonthsToId, currentMonthId } from '@/hooks/useMonthFilter'
import { MonthFilterBar } from '@/components/ui/MonthFilterBar'
import { api } from '@/services/api'
import { cn } from '@/lib/utils'
import type { LeadBoard, LeadRow } from '@/types/leadBoard'

const pct = (n: number) => `${Math.round(n * 100)}%`

function Anel({ icone, rotulo, cor, valor, detalhe }: {
  icone: React.ReactNode
  rotulo: string
  cor: string
  /** 0..1 */
  valor: number
  detalhe: string
}) {
  const deg = Math.max(0, Math.min(1, valor)) * 360
  return (
    <div className="flex flex-col items-center gap-2 rounded-xl bg-elevate/[0.05] px-2 py-3">
      <div className="relative grid h-16 w-16 shrink-0 place-items-center rounded-full" style={{ background: `conic-gradient(${cor} ${deg}deg, #E5E7EB 0deg)` }}>
        <div className="grid h-[52px] w-[52px] place-items-center rounded-full bg-card text-sm font-bold" style={{ color: cor }}>
          {pct(valor)}
        </div>
      </div>
      <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-foreground/80">
        <span style={{ color: cor }}>{icone}</span>
        {rotulo}
      </span>
      <span className="text-[10px] text-foreground/40">{detalhe}</span>
    </div>
  )
}

/**
 * Métricas do CLOSER (CRM Luis Closer). Todas as leads daqui chegaram por uma reunião agendada pelo SDR, então:
 *  - Reuniões agendadas = leads que entraram no CRM do closer no período;
 *  - Comparecimento = realizadas ÷ (realizadas + no-show). Realizada = chegou em Proposta, Follow-up ou Vendido;
 *    quem ainda está em "Reunião agendada" fica fora da conta (a reunião pode ser pra frente);
 *  - No-show = o complemento: no-show ÷ (realizadas + no-show);
 *  - Conversão = vendas ÷ reuniões realizadas.
 */
export function CloserMetricsGrid({ closer = 'Luis' }: {
  rows?: LeadRow[]
  boards?: LeadBoard[]
  onOpenLead?: (id: string) => void
  closer?: string
}) {
  const monthFilter = useMonthFilter(React.useMemo(() => [addMonthsToId(currentMonthId(), -1)], []))
  const { from, to } = monthFilter.bounds
  const [dados, setDados] = React.useState<{ agendadas: number; compareceu: number; no_show: number; vendas: number } | null>(null)

  // Vem do servidor: é a mesma conta (e as mesmas leads) das Métricas por SDR do Arthur, então os dois batem.
  React.useEffect(() => {
    let vivo = true
    setDados(null)
    api
      .get<{ agendadas: number; compareceu: number; no_show: number; vendas: number }>(
        `/api/closer-metrics?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
      )
      .then((r) => vivo && setDados(r))
      .catch(() => vivo && setDados({ agendadas: 0, compareceu: 0, no_show: 0, vendas: 0 }))
    return () => {
      vivo = false
    }
  }, [from, to])

  const agendadas = dados?.agendadas ?? 0
  const compareceu = dados?.compareceu ?? 0
  const noShow = dados?.no_show ?? 0
  const vendas = dados?.vendas ?? 0
  const comDesfecho = compareceu + noShow
  const m = {
    comparecimento: comDesfecho > 0 ? compareceu / comDesfecho : 0,
    conversao: compareceu > 0 ? vendas / compareceu : 0,
  }

  return (
    <div className="space-y-4">
      <MonthFilterBar filter={monthFilter} />
      <div className="rounded-2xl bg-card p-4 shadow-sm">
        <div className="mb-3 flex items-center gap-3">
          <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-accent/15 text-accent">
            <UserRound className="h-5 w-5" />
          </span>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-foreground">Closer {closer}</p>
            <p className="text-[11px] text-foreground/40">métricas do período</p>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
          <div className="flex flex-col items-center justify-center gap-1 rounded-xl bg-elevate/[0.05] px-2 py-3">
            <span className="text-3xl font-bold text-accent">{dados ? agendadas : '…'}</span>
            <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-foreground/80">
              <CalendarCheck className="h-3 w-3 text-accent" /> Reuniões agendadas
            </span>
            <span className="text-[10px] text-foreground/40">total no período</span>
          </div>
          <Anel
            icone={<UserCheck className="h-3 w-3" />}
            rotulo="% de comparecimento"
            cor="#06B6D4"
            valor={m.comparecimento}
            detalhe={`${compareceu} de ${comDesfecho}`}
          />
          <Anel
            icone={<TrendingUp className="h-3 w-3" />}
            rotulo="% de conversão"
            cor="#22C55E"
            valor={m.conversao}
            detalhe={`${vendas} venda(s) de ${compareceu} realizadas`}
          />
        </div>
        <ul className="mt-3 space-y-0.5 text-[11px] leading-snug text-foreground/45">
          <li><strong className="font-semibold text-foreground/60">Reuniões agendadas:</strong> o total no período.</li>
          <li><strong className="font-semibold text-foreground/60">% de comparecimento:</strong> realizadas ÷ (realizadas + no-show).</li>
          <li><strong className="font-semibold text-foreground/60">% de conversão:</strong> vendas ÷ reuniões realizadas.</li>
          <li className="pt-1">Reunião realizada = a lead chegou em Proposta enviada, Follow-up ou Vendido. Quem ainda está em “Reunião agendada” não entra nas porcentagens.</li>
        </ul>
      </div>
    </div>
  )
}
