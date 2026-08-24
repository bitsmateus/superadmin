import * as React from 'react'
import { Loader2, Plus, RotateCcw, ShoppingBag, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { TopBar } from '@/components/layout/TopBar'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
import { Modal } from '@/components/ui/Modal'
import { CurrencyField } from '@/components/comercial/CurrencyField'
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

  // A venda cai aqui via INSERT feito pelo BACKEND (ao marcar "Vendido" num CRM) — não existe
  // criação otimista local pra essa linha, então essa tela depende 100% do SSE avisar. Como rede
  // de segurança, recarrega ao focar a aba/janela e a cada 15s enquanto estiver aberta — assim,
  // mesmo se uma notificação se perder, a demora pra aparecer é de segundos, não "precisa dar F5".
  React.useEffect(() => {
    void leadBoardsService.reloadRows()
    const onVisible = () => { if (document.visibilityState === 'visible') void leadBoardsService.reloadRows() }
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('focus', onVisible)
    const interval = window.setInterval(() => void leadBoardsService.reloadRows(), 15000)
    return () => {
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('focus', onVisible)
      window.clearInterval(interval)
    }
  }, [])

  const [periodo, setPeriodo] = React.useState<Periodo>('mes_atual')
  const [from, setFrom] = React.useState(() => monthRange(0).from)
  const [to, setTo] = React.useState(() => monthRange(0).to)
  const [registrarOpen, setRegistrarOpen] = React.useState(false)
  const [trashOpen, setTrashOpen] = React.useState(false)

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

  // Mesmos 4 nomes do seletor "Quem fechou a venda" — sempre aparecem, mesmo zerados, pra dar
  // pra comparar o time inteiro de cara. Alguém fora dessa lista (sdr em branco, nome antigo)
  // cai num "Outros" só se tiver de fato alguma venda.
  const resumoPorSdr = React.useMemo(() => {
    const nomes = ['Arthur', 'Luis', 'Ian', 'Mateus']
    const buckets = new Map<string, { vendas: number; mrr: number; impl: number }>()
    for (const nome of nomes) buckets.set(nome, { vendas: 0, mrr: 0, impl: 0 })
    for (const r of validas) {
      const nome = nomes.includes(r.sdr) ? r.sdr : (r.sdr || 'Outros')
      const b = buckets.get(nome) ?? { vendas: 0, mrr: 0, impl: 0 }
      b.vendas += 1
      b.mrr += parseBRLCents(r.valorMrr)
      b.impl += parseBRLCents(r.valorImplementacao)
      buckets.set(nome, b)
    }
    return [...nomes, ...(buckets.has('Outros') ? ['Outros'] : [])]
      .map((nome) => ({ nome, ...buckets.get(nome)! }))
  }, [validas])

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
          <div className="flex items-center gap-2">
            <Button variant="secondary" onClick={() => setTrashOpen(true)} leftIcon={<Trash2 className="h-4 w-4" />}>
              Lixeira
            </Button>
            <Button onClick={() => setRegistrarOpen(true)} leftIcon={<Plus className="h-4 w-4" />}>
              Registrar venda
            </Button>
          </div>
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

        {/* Resumo por SDR — mesmo período da lista acima */}
        <div className="mt-4 overflow-hidden rounded-2xl bg-white shadow-sm">
          <div className="border-b border-gray-200 px-4 py-3 text-xs font-semibold uppercase tracking-wide text-gray-500">
            Resumo por SDR
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[520px]">
              <thead>
                <tr className="border-b border-gray-200 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
                  <th className="px-4 py-3">SDR</th>
                  <th className="w-28 px-4 py-3 text-right">Vendas</th>
                  <th className="w-40 px-4 py-3 text-right">MRR (R$)</th>
                  <th className="w-40 px-4 py-3 text-right">Implementação (R$)</th>
                </tr>
              </thead>
              <tbody>
                {resumoPorSdr.map((r) => (
                  <tr key={r.nome} className="border-b border-gray-100 last:border-0 hover:bg-gray-50/70">
                    <td className="px-4 py-2.5 text-sm font-medium text-[#323338]">{r.nome}</td>
                    <td className="px-4 py-2.5 text-right text-sm tabular-nums">{r.vendas}</td>
                    <td className="px-4 py-2.5 text-right text-sm tabular-nums">{formatBRLCents(r.mrr)}</td>
                    <td className="px-4 py-2.5 text-right text-sm tabular-nums">{formatBRLCents(r.impl)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-gray-200 bg-gray-50 text-sm font-semibold text-[#323338]">
                  <td className="px-4 py-3">Equipe</td>
                  <td className="px-4 py-3 text-right tabular-nums">{validas.length}</td>
                  <td className="px-4 py-3 text-right tabular-nums text-emerald-700">{formatBRLCents(totalMrr)}</td>
                  <td className="px-4 py-3 text-right tabular-nums text-emerald-700">{formatBRLCents(totalImpl)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      </div>

      <RegistrarVendaModal
        open={registrarOpen}
        onClose={() => setRegistrarOpen(false)}
        boardId={board.id}
      />
      <VendasTrashModal
        open={trashOpen}
        onClose={() => setTrashOpen(false)}
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

/** Fundo amarelo = pagamento pendente daquele valor — marcação manual, ninguém calcula isso
 * sozinho. Toda venda nasce pendente (default true no banco); a pessoa desmarca quando confirma
 * o pagamento clicando na bolinha. Sem cor = pago/tudo certo. */
function PendenteValueCell({
  value,
  onSave,
  pendente,
  onTogglePendente,
  strikethrough,
}: {
  value: string
  onSave: (next: string) => void
  pendente: boolean
  onTogglePendente: () => void
  strikethrough?: boolean
}) {
  return (
    <td className={cn('px-1 py-1.5 text-sm tabular-nums', pendente && 'bg-amber-100', strikethrough && 'line-through')}>
      <div className="flex items-center gap-1.5">
        <button
          type="button"
          onClick={onTogglePendente}
          title={pendente ? 'Pendente de pagamento — clique para marcar como pago' : 'Pago — clique para marcar como pendente'}
          className={cn(
            'h-2.5 w-2.5 shrink-0 rounded-full ring-1 ring-inset transition-colors',
            pendente ? 'bg-amber-400 ring-amber-500' : 'bg-transparent ring-gray-300 hover:ring-gray-400',
          )}
        />
        <CurrencyField value={value} onSave={onSave} className="flex-1 bg-transparent text-right" />
      </div>
    </td>
  )
}

function VendaRow({ row }: { row: LeadRow }) {
  const [excluirOpen, setExcluirOpen] = React.useState(false)

  // Corrige o valor "oficial" (ex.: desconto negociado no fechamento) — se essa venda veio de um
  // lead do CRM (vendaOrigemId), o servidor propaga o mesmo valor pro lead de origem também.
  const saveMrr = (next: string) => leadBoardsService.updateRow(row.id, { valorMrr: next })
  const saveImpl = (next: string) => leadBoardsService.updateRow(row.id, { valorImplementacao: next })

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
      <PendenteValueCell
        value={row.valorMrr}
        onSave={saveMrr}
        pendente={row.mrrPendente}
        onTogglePendente={() => leadBoardsService.updateRow(row.id, { mrrPendente: !row.mrrPendente })}
        strikethrough={row.vendaRevertida}
      />
      <PendenteValueCell
        value={row.valorImplementacao}
        onSave={saveImpl}
        pendente={row.implPendente}
        onTogglePendente={() => leadBoardsService.updateRow(row.id, { implPendente: !row.implPendente })}
        strikethrough={row.vendaRevertida}
      />
      <td className="px-2 py-3">
        <button
          type="button"
          onClick={() => setExcluirOpen(true)}
          title="Excluir venda"
          className="grid h-6 w-6 place-items-center rounded text-gray-300 opacity-0 transition-opacity hover:bg-danger/10 hover:text-danger group-hover:opacity-100"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </td>
      <ExcluirVendaModal open={excluirOpen} onClose={() => setExcluirOpen(false)} row={row} />
    </tr>
  )
}

/** Excluir só tira a venda desta lista (soft delete, vai pra Lixeira) — o lead de origem no CRM
 * não é tocado, continua "Vendido" lá normalmente. Pede o motivo pra ficar registrado. */
function ExcluirVendaModal({
  open,
  onClose,
  row,
}: {
  open: boolean
  onClose: () => void
  row: LeadRow
}) {
  const [motivo, setMotivo] = React.useState('')
  const [saving, setSaving] = React.useState(false)

  React.useEffect(() => { if (open) setMotivo('') }, [open])

  const confirmar = async () => {
    setSaving(true)
    try {
      await leadBoardsService.deleteRow(row.id, motivo.trim())
      toast.success(`Venda de "${row.nome || 'sem nome'}" excluída.`)
      onClose()
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Excluir venda"
      description={`Some só desta lista — o lead "${row.nome || 'sem nome'}" continua "Vendido" no CRM normalmente. Vai pra Lixeira, dá pra restaurar depois.`}
      size="sm"
    >
      <Input
        label="Motivo (opcional)"
        value={motivo}
        onChange={(e) => setMotivo(e.target.value)}
        placeholder="Ex.: venda duplicada, cancelamento..."
        autoFocus
        onKeyDown={(e) => { if (e.key === 'Enter') void confirmar() }}
      />
      <div className="mt-5 flex justify-end gap-2">
        <Button variant="ghost" onClick={onClose} disabled={saving}>Cancelar</Button>
        <Button variant="danger" onClick={confirmar} loading={saving}>Excluir</Button>
      </div>
    </Modal>
  )
}

/** Vendas excluídas desta aba (Lixeira) — mesma trilha de soft delete/restore da Lixeira do CRM,
 * só que filtrada pro quadro de vendas e mostrando o motivo informado ao excluir. */
function VendasTrashModal({
  open,
  onClose,
  boardId,
}: {
  open: boolean
  onClose: () => void
  boardId: string
}) {
  const [loading, setLoading] = React.useState(false)
  const [rows, setRows] = React.useState<LeadRow[]>([])
  const [restoringId, setRestoringId] = React.useState<string | null>(null)

  React.useEffect(() => {
    if (!open) return
    setLoading(true)
    leadBoardsService.getTrash()
      .then((all) => setRows(all.filter((r) => r.boardId === boardId)))
      .catch((err) => toast.error('Falha ao carregar a lixeira: ' + (err as Error).message))
      .finally(() => setLoading(false))
  }, [open, boardId])

  const restore = async (id: string) => {
    setRestoringId(id)
    try {
      await leadBoardsService.restoreRow(id)
      setRows((prev) => prev.filter((r) => r.id !== id))
      toast.success('Venda restaurada.')
    } catch (err) {
      toast.error('Falha ao restaurar: ' + (err as Error).message)
    } finally {
      setRestoringId(null)
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Lixeira de Vendas" description="Vendas excluídas desta lista — restaure se precisar." size="lg">
      {loading ? (
        <div className="grid place-items-center py-10 text-sm text-foreground/50">
          <Loader2 className="h-5 w-5 animate-spin" />
        </div>
      ) : rows.length === 0 ? (
        <div className="grid place-items-center gap-2 py-10 text-center">
          <Trash2 className="h-6 w-6 text-foreground/25" />
          <p className="text-sm text-foreground/40">Nenhuma venda excluída por aqui.</p>
        </div>
      ) : (
        <ul className="max-h-[50vh] divide-y divide-white/[0.04] overflow-y-auto">
          {rows.map((r) => (
            <li key={r.id} className="flex items-center gap-3 py-2.5">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-foreground">{r.nome || 'Sem nome'}</p>
                <p className="truncate text-[11px] text-foreground/45">
                  {r.valorMrr ? formatBRLCents(parseBRLCents(r.valorMrr)) : '—'}
                  {r.deleteReason && <> · {r.deleteReason}</>}
                </p>
              </div>
              <Button
                size="sm"
                variant="secondary"
                onClick={() => restore(r.id)}
                loading={restoringId === r.id}
                leftIcon={<RotateCcw className="h-3.5 w-3.5" />}
              >
                Restaurar
              </Button>
            </li>
          ))}
        </ul>
      )}
    </Modal>
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
  const [fechadoPor, setFechadoPor] = React.useState('')

  React.useEffect(() => {
    if (!open) return
    setNome('')
    setMrr('')
    setImpl('')
    setFechamento(isoDay(new Date()))
    setFechadoPor('')
  }, [open])

  const submit = () => {
    const trimmed = nome.trim()
    if (!trimmed) return
    leadBoardsService.createRow(boardId, {
      nome: trimmed,
      valorMrr: mrr.trim(),
      valorImplementacao: impl.trim(),
      fechamento,
      sdr: fechadoPor,
      status: 'Vendido',
    })
    toast.success(`Venda de "${trimmed}" registrada.`)
    onClose()
  }

  return (
    <Modal open={open} onClose={onClose} title="Registrar venda" size="sm">
      <div className="space-y-4">
        <Input
          label="Nome"
          value={nome}
          onChange={(e) => setNome(e.target.value)}
          autoFocus
          placeholder="Cliente ou empresa"
          onKeyDown={(e) => { if (e.key === 'Enter') submit() }}
        />
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="mb-1.5 block text-xs font-medium text-foreground/70">Valor MRR</label>
            <CurrencyField
              value={mrr}
              onSave={setMrr}
              className="h-10 rounded-lg border border-line bg-surface px-3 text-foreground"
            />
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-medium text-foreground/70">Valor de implementação</label>
            <CurrencyField
              value={impl}
              onSave={setImpl}
              className="h-10 rounded-lg border border-line bg-surface px-3 text-foreground"
            />
          </div>
        </div>
        <Select
          label="Quem fechou a venda"
          value={fechadoPor}
          onChange={(e) => setFechadoPor(e.target.value)}
          options={[
            { value: '', label: 'Selecionar...' },
            { value: 'Arthur', label: 'SDR Arthur' },
            { value: 'Luis', label: 'SDR Luis' },
            { value: 'Ian', label: 'Ian' },
            { value: 'Mateus', label: 'Mateus' },
          ]}
        />
        <Input
          label="Data de fechamento"
          type="date"
          value={fechamento}
          onChange={(e) => setFechamento(e.target.value)}
        />
      </div>
      <div className="mt-6 flex justify-end gap-2">
        <Button variant="ghost" onClick={onClose}>Cancelar</Button>
        <Button onClick={submit} disabled={!nome.trim()}>Registrar</Button>
      </div>
    </Modal>
  )
}
