import * as React from 'react'
import { Wallet } from 'lucide-react'
import { api } from '@/services/api'
import { formatBRLCents } from '@/lib/currency'
import { monthLabelPt } from '@/hooks/useMonthFilter'
import { cn } from '@/lib/utils'
import type { LeadRow } from '@/types/leadBoard'

type Entrada = {
  id: string; nome: string; tipo: string; referencia: string; valorCentavos: number; mes: string; pago: boolean
  cardId: string | null
}
type Resposta = { pessoa: string; nomeDaAba?: string; entradas: Entrada[] }

/**
 * A comissão de suporte do dono do CRM (Jean ou João), dentro do Dashboard dele: cada card que entrou em ENTREGAS
 * REALIZADAS vira um lançamento (o servidor lança sozinho, ver server/src/lib/comissaoSuporte.ts), mais o que foi
 * lançado à mão pra ele na aba Comissões. Só o dono e quem vê o Financeiro recebem os dados; pros outros o servidor
 * responde 403 e a seção não aparece.
 */
export function ComissaoDoSuporte({ pageId, deMes, ateMes, rows, onOpenLead }: {
  pageId: string
  deMes: string
  ateMes: string
  rows: LeadRow[]
  onOpenLead: (id: string) => void
}) {
  const [dados, setDados] = React.useState<Resposta | null>(null)
  const [semAcesso, setSemAcesso] = React.useState(false)

  // Card que muda de quadro ou de tipo pode mudar a comissão: busca de novo (o servidor já sincroniza antes de responder).
  const assinatura = React.useMemo(() => rows.map((r) => `${r.id}:${r.boardId}:${r.tipo}`).join('|'), [rows])
  React.useEffect(() => {
    if (!pageId) return
    let vivo = true
    const t = window.setTimeout(() => {
      api.get<Resposta>(`/api/comissao-suporte/${encodeURIComponent(pageId)}?de=${deMes}&ate=${ateMes}`)
        .then((r) => { if (vivo) { setDados(r); setSemAcesso(false) } })
        .catch((err: { status?: number }) => { if (vivo && (err?.status === 403 || err?.status === 404)) setSemAcesso(true) })
    }, 800)
    return () => { vivo = false; window.clearTimeout(t) }
  }, [pageId, deMes, ateMes, assinatura])

  if (semAcesso || !dados) return null
  const total = dados.entradas.reduce((s, e) => s + e.valorCentavos, 0)
  const pago = dados.entradas.filter((e) => e.pago).reduce((s, e) => s + e.valorCentavos, 0)
  const aDefinir = dados.entradas.filter((e) => e.valorCentavos <= 0).length
  const meses = deMes === ateMes ? monthLabelPt(deMes) : `${monthLabelPt(deMes)} a ${monthLabelPt(ateMes)}`
  const temCard = new Set(rows.map((r) => r.id))

  return (
    <div className="rounded-2xl bg-card p-4 shadow-sm">
      <div className="mb-3 flex flex-wrap items-center gap-2 text-sm font-semibold text-foreground">
        <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-success/10 text-success"><Wallet className="h-4 w-4" /></span>
        <span className="flex-1">Comissão de {dados.nomeDaAba || dados.pessoa} · {meses}</span>
        <span className="text-base tabular-nums text-success">{formatBRLCents(total)}</span>
      </div>
      <div className="mb-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-foreground/55">
        <span>{dados.entradas.length} lançamento(s)</span>
        <span>Pago: <b className="tabular-nums text-foreground/75">{formatBRLCents(pago)}</b></span>
        <span>A receber: <b className="tabular-nums text-foreground/75">{formatBRLCents(total - pago)}</b></span>
        {aDefinir > 0 && <span className="text-warning">{aDefinir} com valor a definir</span>}
      </div>
      {dados.entradas.length === 0 ? (
        <p className="text-xs text-foreground/45">Nenhuma comissão no período. Card que entra em “Entregas realizadas” vira comissão sozinho.</p>
      ) : (
        <div className="max-h-80 overflow-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-line text-[11px] text-foreground/45">
                <th className="py-1.5 pr-2 font-medium">Card</th>
                <th className="px-2 py-1.5 font-medium">Comissão</th>
                <th className="px-2 py-1.5 font-medium">Mês</th>
                <th className="px-2 py-1.5 text-right font-medium">Valor</th>
                <th className="py-1.5 pl-2 text-right font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {dados.entradas.map((e) => (
                <tr key={e.id} className="border-b border-line/60 last:border-0">
                  <td className="max-w-[16rem] truncate py-1.5 pr-2 font-medium text-foreground/75">
                    {e.cardId && temCard.has(e.cardId) ? (
                      <button type="button" className="truncate hover:text-accent hover:underline" onClick={() => onOpenLead(e.cardId!)}>{e.nome || '(sem nome)'}</button>
                    ) : (e.nome || '—')}
                  </td>
                  <td className="px-2 py-1.5 text-foreground/65">{e.tipo}</td>
                  <td className="px-2 py-1.5 text-foreground/50">{monthLabelPt(e.mes)}</td>
                  <td className={cn('px-2 py-1.5 text-right tabular-nums', e.valorCentavos > 0 ? 'text-foreground/80' : 'text-warning')}>
                    {e.valorCentavos > 0 ? formatBRLCents(e.valorCentavos) : 'a definir'}
                  </td>
                  <td className="py-1.5 pl-2 text-right">
                    <span className={cn('rounded-full px-2 py-0.5 text-[11px] font-medium', e.pago ? 'bg-success/15 text-success' : 'bg-warning/15 text-warning')}>
                      {e.pago ? 'Pago' : 'A receber'}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
