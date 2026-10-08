import * as React from 'react'
import { CalendarCheck, UserCheck, UserX, TrendingUp, UserRound } from 'lucide-react'
import { useMonthFilter, withinBounds, addMonthsToId, currentMonthId } from '@/hooks/useMonthFilter'
import { MonthFilterBar } from '@/components/ui/MonthFilterBar'
import { ClickableStat } from '@/components/comercial/ClickableStat'
import { cn } from '@/lib/utils'
import type { LeadBoard, LeadRow } from '@/types/leadBoard'

/** Sem acento, sem pontuação, minúsculo — compara o status mesmo escrito diferente em cada quadro. */
const norm = (s: string) =>
  s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '')

type Grupo = 'agendada' | 'noshow' | 'compareceu' | 'venda' | 'outro'

/** Onde a lead está no funil do closer. Reunião realizada = chegou à proposta, ao follow-up ou à venda. */
function grupoDoStatus(status: string): Grupo {
  const s = norm(status)
  if (s === 'reuniaoagendada') return 'agendada'
  if (s === 'reuniaonaocomparecida') return 'noshow'
  if (s === 'vendido') return 'venda'
  if (s.startsWith('propostaenviada') || s.startsWith('followup')) return 'compareceu'
  return 'outro'
}

const pct = (n: number) => `${Math.round(n * 100)}%`

function Anel({ icone, rotulo, cor, valor, detalhe, matches, boards, onOpenLead }: {
  icone: React.ReactNode
  rotulo: string
  cor: string
  /** 0..1 */
  valor: number
  detalhe: string
  matches: LeadRow[]
  boards: LeadBoard[]
  onOpenLead: (id: string) => void
}) {
  const deg = Math.max(0, Math.min(1, valor)) * 360
  return (
    <ClickableStat matches={matches} boards={boards} onOpenLead={onOpenLead}>
      {(onClick, ref) => (
        <button
          ref={ref}
          type="button"
          onClick={onClick}
          disabled={matches.length === 0}
          className={cn(
            'flex flex-col items-center gap-2 rounded-xl bg-elevate/[0.05] px-2 py-3 transition-opacity',
            matches.length > 0 ? 'cursor-pointer hover:opacity-70' : 'cursor-default',
          )}
        >
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
        </button>
      )}
    </ClickableStat>
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
export function CloserMetricsGrid({ rows, boards, onOpenLead, closer = 'Luis' }: {
  rows: LeadRow[]
  boards: LeadBoard[]
  onOpenLead: (id: string) => void
  closer?: string
}) {
  const monthFilter = useMonthFilter(React.useMemo(() => [addMonthsToId(currentMonthId(), -1)], []))

  const m = React.useMemo(() => {
    const doPeriodo = rows.filter((r) => withinBounds(r.createdAt, monthFilter.bounds))
    const por = (g: Grupo) => doPeriodo.filter((r) => grupoDoStatus(r.status) === g)
    const agendada = por('agendada')
    const noShow = por('noshow')
    const venda = por('venda')
    const compareceu = [...por('compareceu'), ...venda]
    const comDesfecho = compareceu.length + noShow.length
    return {
      doPeriodo, agendada, noShow, venda, compareceu, comDesfecho,
      comparecimento: comDesfecho > 0 ? compareceu.length / comDesfecho : 0,
      noShowPct: comDesfecho > 0 ? noShow.length / comDesfecho : 0,
      conversao: compareceu.length > 0 ? venda.length / compareceu.length : 0,
    }
  }, [rows, monthFilter.bounds])

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

        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <ClickableStat matches={m.doPeriodo} boards={boards} onOpenLead={onOpenLead}>
            {(onClick, ref) => (
              <button
                ref={ref}
                type="button"
                onClick={onClick}
                disabled={m.doPeriodo.length === 0}
                className={cn(
                  'flex flex-col items-center justify-center gap-1 rounded-xl bg-elevate/[0.05] px-2 py-3 transition-opacity',
                  m.doPeriodo.length > 0 ? 'cursor-pointer hover:opacity-70' : 'cursor-default',
                )}
              >
                <span className="text-3xl font-bold text-accent">{m.doPeriodo.length}</span>
                <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-foreground/80">
                  <CalendarCheck className="h-3 w-3 text-accent" /> Reuniões agendadas
                </span>
                <span className="text-[10px] text-foreground/40">total no período</span>
              </button>
            )}
          </ClickableStat>
          <Anel
            icone={<UserCheck className="h-3 w-3" />}
            rotulo="% de comparecimento"
            cor="#06B6D4"
            valor={m.comparecimento}
            detalhe={`${m.compareceu.length} de ${m.comDesfecho}`}
            matches={m.compareceu}
            boards={boards}
            onOpenLead={onOpenLead}
          />
          <Anel
            icone={<TrendingUp className="h-3 w-3" />}
            rotulo="% de conversão"
            cor="#22C55E"
            valor={m.conversao}
            detalhe={`${m.venda.length} venda(s) de ${m.compareceu.length} realizadas`}
            matches={m.venda}
            boards={boards}
            onOpenLead={onOpenLead}
          />
          <Anel
            icone={<UserX className="h-3 w-3" />}
            rotulo="% de no-show"
            cor="#EF4444"
            valor={m.noShowPct}
            detalhe={`${m.noShow.length} de ${m.comDesfecho}`}
            matches={m.noShow}
            boards={boards}
            onOpenLead={onOpenLead}
          />
        </div>
        <p className="mt-3 text-[11px] leading-snug text-foreground/40">
          Reunião realizada = a lead chegou em Proposta enviada, Follow-up ou Vendido. Quem ainda está em “Reunião agendada” não entra nas porcentagens.
        </p>
      </div>
    </div>
  )
}
