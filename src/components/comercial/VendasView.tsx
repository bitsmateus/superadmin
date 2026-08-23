import * as React from 'react'
import { Plus, ShoppingBag, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { TopBar } from '@/components/layout/TopBar'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Modal } from '@/components/ui/Modal'
import { useLeadBoards, useLeadRows } from '@/hooks/useLeadBoards'
import { leadBoardsService } from '@/services/leadBoards'
import { formatBRLCents, parseBRLCents } from '@/lib/currency'
import { cn } from '@/lib/utils'
import type { LeadRow } from '@/types/leadBoard'

/**
 * Aba Vendas — o fechado do período, e só isso.
 *
 * Deliberadamente NÃO é a tabela do CRM: aqui não há status, dia de contato, ligação nem arrastar
 * entre quadros. Uma venda fechada tem três informações que importam (nome, MRR, implementação) e
 * uma pergunta ("quanto no período"), então a tela é uma lista simples com totais no rodapé.
 *
 * As linhas vêm do quadro marcado como de vendas: entram sozinhas quando um lead vira "Vendido"
 * num CRM, ou pelo botão "Registrar venda" (negócio que não passou pelo funil). O período filtra
 * pela DATA DE FECHAMENTO, não pela data em que a linha foi criada.
 */

type Periodo = 'mes_atual' | 'mes_passado' | 'personalizado'

function isoDay(d: Date): string {
  return d.toISOString().slice(0, 10)
}

/** Primeiro e último dia do mês, deslocado por `offset` (0 = atual, -1 = passado). */
function monthRange(offset: number): { from: string; to: string } {
  const now = new Date()
  const first = new Date(now.getFullYear(), now.getMonth() + offset, 1)
  const last = new Date(now.getFullYear(), now.getMonth() + offset + 1, 0)
  return { from: isoDay(first), to: isoDay(last) }
}

export function VendasView({ pageId }: { pageId: string }) {
  const boards = useLeadBoards()
  const board = React.useMemo(
    () => boards.find((b) => b.page === pageId && b.isVendas) ?? boards.find((b) => b.page === pageId),
    [boards, pageId],
  )
  const rows = useLeadRows(board?.id ?? '')

  const [periodo, setPeriodo] = React.useState<Periodo>('mes_atual')
  const [from, setFrom] = React.useState(() => monthRange(0).from)
  const [to, setTo] = React.useState(() => monthRange(0).to)
  const [registrarOpen, setRegistrarOpen] = React.useState(false)

  React.useEffect(() => {
    if (periodo === 'personalizado') return
    const r = monthRange(periodo === 'mes_atual' ? 0 : -1)
    setFrom(r.from)
    setTo(r.to)
  }, [periodo])

  const noPeriodo = React.useMemo(() => {
    return rows
      .filter((r) => {
        // Sem data de fechamento a venda não pertence a período nenhum — em vez de sumir, cai no
        // dia em que a linha foi criada, que é o melhor palpite disponível.
        const dia = (r.fechamento || r.createdAt).slice(0, 10)
        return dia >= from && dia <= to
      })
      .sort((a, b) => (b.fechamento || b.createdAt).localeCompare(a.fechamento || a.createdAt))
  }, [rows, from, to])

  // Revertida continua visível (o histórico importa) mas fora da conta.
  const validas = React.useMemo(() => noPeriodo.filter((r) => !r.vendaRevertida), [noPeriodo])
  const totalMrr = React.useMemo(
    () => validas.reduce((sum, r) => sum + parseBRLCents(r.valorMrr), 0),
    [validas],
  )
  const totalImpl = React.useMemo(
    () => validas.reduce((sum, r) => sum + parseBRLCents(r.valorImplementacao), 0),
    [validas],
  )

  if (!board) {
    return (
      <>
        <TopBar title="Vendas" subtitle="Comercial" />
        <div className="mx-auto mt-10 max-w-md rounded-2xl bg-white p-6 text-center shadow-sm">
          <ShoppingBag className="mx-auto h-8 w-8 text-gray-300" />
          <p className="mt-3 text-sm font-medium text-[#323338]">Nenhum quadro de vendas nesta aba</p>
          <p className="mt-1 text-xs text-gray-500">
            Crie um quadro aqui e marque-o como quadro de vendas (ícone de sacola) para as vendas
            começarem a cair nesta tela.
          </p>
        </div>
      </>
    )
  }

  return (
    <>
      <TopBar
        title="Vendas"
        subtitle={`${validas.length} venda(s) no período`}
        rightSlot={
          <Button onClick={() => setRegistrarOpen(true)} leftIcon={<Plus className="h-4 w-4" />}>
            Registrar venda
          </Button>
        }
      />

      <div className="px-1 pb-8">
        {/* Período */}
        <div className="mb-4 flex flex-wrap items-center gap-2 rounded-2xl bg-white p-3 shadow-sm">
          <PeriodoTab active={periodo === 'mes_atual'} onClick={() => setPeriodo('mes_atual')}>
            Mês atual
          </PeriodoTab>
          <PeriodoTab active={periodo === 'mes_passado'} onClick={() => setPeriodo('mes_passado')}>
            Mês passado
          </PeriodoTab>
          <PeriodoTab active={periodo === 'personalizado'} onClick={() => setPeriodo('personalizado')}>
            Personalizado
          </PeriodoTab>

          {periodo === 'personalizado' && (
            <div className="ml-1 flex items-center gap-2">
              <input
                type="date"
                value={from}
                onChange={(e) => setFrom(e.target.value)}
                className="h-8 rounded-lg border border-gray-200 px-2 text-xs text-gray-700 outline-none focus:border-accent"
              />
              <span className="text-xs text-gray-400">até</span>
              <input
                type="date"
                value={to}
                onChange={(e) => setTo(e.target.value)}
                className="h-8 rounded-lg border border-gray-200 px-2 text-xs text-gray-700 outline-none focus:border-accent"
              />
            </div>
          )}
        </div>

        {/* Lista */}
        <div className="overflow-hidden rounded-2xl bg-white shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[520px]">
              <thead>
                <tr className="border-b border-gray-200 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
                  <th className="px-4 py-3">Nome</th>
                  <th className="w-48 px-4 py-3 text-right">Valor MRR</th>
                  <th className="w-56 px-4 py-3 text-right">Valor de implementação</th>
                  <th className="w-10 px-2 py-3" />
                </tr>
              </thead>
              <tbody>
                {noPeriodo.length === 0 && (
                  <tr>
                    <td colSpan={4} className="px-4 py-10 text-center text-sm text-gray-400">
                      Nenhuma venda neste período.
                    </td>
                  </tr>
                )}
                {noPeriodo.map((r) => (
                  <VendaRow key={r.id} row={r} />
                ))}
              </tbody>
              {noPeriodo.length > 0 && (
                <tfoot>
                  <tr className="border-t-2 border-gray-200 bg-gray-50 text-sm font-semibold text-[#323338]">
                    <td className="px-4 py-3">Total</td>
                    <td className="px-4 py-3 text-right tabular-nums text-emerald-700">
                      {formatBRLCents(totalMrr)}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums text-emerald-700">
                      {formatBRLCents(totalImpl)}
                    </td>
                    <td />
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        </div>
      </div>

      <RegistrarVendaModal
        open={registrarOpen}
        onClose={() => setRegistrarOpen(false)}
        boardId={board.id}
      />
    </>
  )
}

function PeriodoTab({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'rounded-lg px-3 py-1.5 text-sm font-medium transition-colors',
        active ? 'bg-accent/10 text-accent ring-1 ring-accent/20' : 'text-gray-500 hover:bg-gray-50',
      )}
    >
      {children}
    </button>
  )
}

function VendaRow({ row }: { row: LeadRow }) {
  const remover = () => {
    if (!window.confirm(`Remover a venda de "${row.nome || 'sem nome'}" desta lista?`)) return
    void leadBoardsService.deleteRow(row.id)
  }

  return (
    <tr
      className={cn(
        'group border-b border-gray-100 last:border-0 hover:bg-gray-50/70',
        row.vendaRevertida && 'text-gray-400',
      )}
    >
      <td className="px-4 py-3">
        <span className={cn('text-sm', row.vendaRevertida && 'line-through decoration-gray-300')}>
          {row.nome || 'Sem nome'}
        </span>
        {row.vendaRevertida && (
          <span className="ml-2 rounded-full bg-gray-100 px-1.5 py-0.5 text-[10px] font-medium text-gray-500">
            revertida
          </span>
        )}
      </td>
      <td className={cn('px-4 py-3 text-right text-sm tabular-nums', row.vendaRevertida && 'line-through')}>
        {row.valorMrr || '—'}
      </td>
      <td className={cn('px-4 py-3 text-right text-sm tabular-nums', row.vendaRevertida && 'line-through')}>
        {row.valorImplementacao || '—'}
      </td>
      <td className="px-2 py-3">
        <button
          type="button"
          onClick={remover}
          title="Remover desta lista"
          className="grid h-6 w-6 place-items-center rounded text-gray-300 opacity-0 transition-opacity hover:bg-danger/10 hover:text-danger group-hover:opacity-100"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </td>
    </tr>
  )
}

/** Venda que não veio de lead (indicação, cliente antigo voltando, negócio fora do funil). */
function RegistrarVendaModal({
  open,
  onClose,
  boardId,
}: {
  open: boolean
  onClose: () => void
  boardId: string
}) {
  const [nome, setNome] = React.useState('')
  const [mrr, setMrr] = React.useState('')
  const [impl, setImpl] = React.useState('')
  const [fechamento, setFechamento] = React.useState('')

  React.useEffect(() => {
    if (!open) return
    setNome('')
    setMrr('')
    setImpl('')
    setFechamento(isoDay(new Date()))
  }, [open])

  const submit = () => {
    const trimmed = nome.trim()
    if (!trimmed) return
    leadBoardsService.createRow(boardId, {
      nome: trimmed,
      valorMrr: mrr.trim(),
      valorImplementacao: impl.trim(),
      fechamento,
      status: 'Vendido',
    })
    toast.success(`Venda de "${trimmed}" registrada.`)
    onClose()
  }

  return (
    <Modal open={open} onClose={onClose} title="Registrar venda" size="sm">
      <div className="space-y-3">
        <Input
          label="Nome"
          value={nome}
          onChange={(e) => setNome(e.target.value)}
          autoFocus
          placeholder="Cliente ou empresa"
          onKeyDown={(e) => { if (e.key === 'Enter') submit() }}
        />
        <div className="grid grid-cols-2 gap-3">
          <Input label="Valor MRR" value={mrr} onChange={(e) => setMrr(e.target.value)} placeholder="R$ 0,00" />
          <Input
            label="Valor de implementação"
            value={impl}
            onChange={(e) => setImpl(e.target.value)}
            placeholder="R$ 0,00"
          />
        </div>
        <Input
          label="Data de fechamento"
          type="date"
          value={fechamento}
          onChange={(e) => setFechamento(e.target.value)}
        />
      </div>
      <div className="mt-5 flex justify-end gap-2">
        <Button variant="ghost" onClick={onClose}>Cancelar</Button>
        <Button onClick={submit} disabled={!nome.trim()}>Registrar</Button>
      </div>
    </Modal>
  )
}
