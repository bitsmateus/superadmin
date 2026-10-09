import * as React from 'react'
import { CalendarCheck, UserCheck, TrendingUp, UserRound } from 'lucide-react'
import { useMonthFilter, addMonthsToId, currentMonthId } from '@/hooks/useMonthFilter'
import { MonthFilterBar } from '@/components/ui/MonthFilterBar'
import { api } from '@/services/api'
import { cn } from '@/lib/utils'
import type { LeadBoard, LeadRow } from '@/types/leadBoard'

interface ItemDaLista { id: string; abrir_id: string; nome: string; status: string }
interface GrupoDaLista { titulo: string; itens: ItemDaLista[] }

/**
 * Passando o mouse (ou tocando, no celular) mostra QUAIS leads formam o número: o nome de cada uma e a etapa em que está hoje.
 */
function ComLista({ grupos, children, className, onOpenLead, popClassName }: {
  grupos: GrupoDaLista[]; children: React.ReactNode; className?: string; onOpenLead?: (id: string) => void
  /** Alinhamento do balão no celular (grade de 2 colunas): centralizado ele sai pela borda. */
  popClassName?: string
}) {
  const [aberto, setAberto] = React.useState(false)
  return (
    <div
      className={cn('relative', className)}
      onMouseEnter={() => setAberto(true)}
      onMouseLeave={() => setAberto(false)}
      onFocus={() => setAberto(true)}
      onBlur={() => setAberto(false)}
      onClick={() => setAberto((a) => !a)}
      tabIndex={0}
    >
      {children}
      {aberto && (
        <div className={cn('absolute left-1/2 top-full z-30 mt-1 max-h-72 w-72 max-w-[85vw] -translate-x-1/2 overflow-y-auto rounded-xl border border-line bg-card p-2 text-left shadow-xl', popClassName)}>
          {grupos.map((g) => (
            <div key={g.titulo} className="mb-2 last:mb-0">
              <p className="px-1 pb-1 text-[11px] font-semibold text-foreground/70">
                {g.titulo} <span className="font-normal text-foreground/40">({g.itens.length})</span>
              </p>
              {g.itens.length === 0 ? (
                <p className="px-1 pb-1 text-[11px] text-foreground/40">Nenhuma.</p>
              ) : (
                <ul className="space-y-0.5">
                  {g.itens.map((i) => (
                    <li key={i.id}>
                      <button
                        type="button"
                        onClick={(e) => {
                          // Abre os dados da lead; não deixa o clique fechar o balão antes.
                          e.stopPropagation()
                          onOpenLead?.(i.abrir_id)
                          setAberto(false)
                        }}
                        className="flex w-full items-baseline justify-between gap-2 rounded-md px-1 py-0.5 text-left text-[11px] hover:bg-accent/10"
                        title="Abrir os dados da lead"
                      >
                        <span className="min-w-0 truncate text-foreground/85 underline-offset-2 hover:text-accent hover:underline">{i.nome}</span>
                        <span className="shrink-0 text-foreground/40">{i.status}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

const pct = (n: number) => `${Math.round(n * 100)}%`

// Celular (2 colunas): o balão encosta na borda do bloco em vez de centralizar — senão sai da tela.
const POP_ESQUERDA = 'max-sm:left-0 max-sm:translate-x-0'
const POP_DIREITA = 'max-sm:left-auto max-sm:right-0 max-sm:translate-x-0'

function Anel({ icone, rotulo, cor, valor, detalhe, grupos, onOpenLead, popClassName }: {
  onOpenLead?: (id: string) => void
  popClassName?: string
  grupos: GrupoDaLista[]
  icone: React.ReactNode
  rotulo: string
  cor: string
  /** 0..1 */
  valor: number
  detalhe: string
}) {
  const deg = Math.max(0, Math.min(1, valor)) * 360
  return (
    <ComLista grupos={grupos} onOpenLead={onOpenLead} popClassName={popClassName} className="flex cursor-default flex-col items-center gap-2 rounded-xl bg-elevate/[0.05] px-2 py-3">
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
    </ComLista>
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
export function CloserMetricsGrid({ closer = 'Luis', onOpenLead }: {
  rows?: LeadRow[]
  boards?: LeadBoard[]
  onOpenLead?: (id: string) => void
  closer?: string
}) {
  const monthFilter = useMonthFilter(React.useMemo(() => [addMonthsToId(currentMonthId(), -1)], []))
  const { from, to } = monthFilter.bounds
  const [dados, setDados] = React.useState<{
    agendadas: number; compareceu: number; no_show: number; vendas: number
    lista: { agendadas: ItemDaLista[]; compareceu: ItemDaLista[]; no_show: ItemDaLista[]; vendas: ItemDaLista[] }
  } | null>(null)

  // Vem do servidor: é a mesma conta (e as mesmas leads) das Métricas por SDR do Arthur, então os dois batem.
  React.useEffect(() => {
    let vivo = true
    setDados(null)
    api
      .get<NonNullable<typeof dados>>(
        `/api/closer-metrics?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
      )
      .then((r) => vivo && setDados(r))
      .catch(() => vivo && setDados({ agendadas: 0, compareceu: 0, no_show: 0, vendas: 0, lista: { agendadas: [], compareceu: [], no_show: [], vendas: [] } }))
    return () => {
      vivo = false
    }
  }, [from, to])

  const lista = dados?.lista ?? { agendadas: [], compareceu: [], no_show: [], vendas: [] }
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
          <ComLista grupos={[{ titulo: 'Reuniões agendadas', itens: lista.agendadas }]} onOpenLead={onOpenLead} popClassName={POP_ESQUERDA} className="flex cursor-default flex-col items-center justify-center gap-1 rounded-xl bg-elevate/[0.05] px-2 py-3">
            <span className="text-3xl font-bold text-accent">{dados ? agendadas : '…'}</span>
            <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-foreground/80">
              <CalendarCheck className="h-3 w-3 text-accent" /> Reuniões agendadas
            </span>
            <span className="text-[10px] text-foreground/40">total no período</span>
          </ComLista>
          <Anel
            icone={<UserCheck className="h-3 w-3" />}
            rotulo="% de comparecimento"
            popClassName={POP_DIREITA}
            cor="#06B6D4"
            valor={m.comparecimento}
            detalhe={`${compareceu} de ${comDesfecho}`}
            onOpenLead={onOpenLead}
            grupos={[{ titulo: 'Compareceram (reunião realizada)', itens: lista.compareceu }, { titulo: 'Não compareceram', itens: lista.no_show }]}
          />
          <Anel
            icone={<TrendingUp className="h-3 w-3" />}
            rotulo="% de conversão"
            popClassName={POP_ESQUERDA}
            cor="#22C55E"
            valor={m.conversao}
            detalhe={`${vendas} venda(s) de ${compareceu} realizadas`}
            onOpenLead={onOpenLead}
            grupos={[{ titulo: 'Vendas', itens: lista.vendas }, { titulo: 'Reuniões realizadas', itens: lista.compareceu }]}
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
