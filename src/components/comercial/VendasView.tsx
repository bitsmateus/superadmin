import * as React from 'react'
import { Award, Loader2, Plus, RotateCcw, ShoppingBag, Trash2, TrendingUp, Wrench } from 'lucide-react'
import { toast } from 'sonner'
import { TopBar } from '@/components/layout/TopBar'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
import { Modal } from '@/components/ui/Modal'
import { CurrencyField } from '@/components/comercial/CurrencyField'
import { LeadDetailModal } from '@/components/comercial/LeadDetailModal'
import { useDebouncedCallback } from '@/hooks/useDebouncedCallback'
import { useLeadBoards, useLeadRows } from '@/hooks/useLeadBoards'
import { leadBoardsService } from '@/services/leadBoards'
import { formatBRLCents, parseBRLCents } from '@/lib/currency'
import { cn, initials } from '@/lib/utils'
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
  const [openLeadId, setOpenLeadId] = React.useState<string | null>(null)
  const [onlyPending, setOnlyPending] = React.useState(false)

  // Seleção "estilo Excel" — marca várias linhas (ou todas) e vê o total de MRR/implementação só
  // delas, sem precisar mudar o período. Some sozinha ao trocar de período (ids de outra janela
  // de tempo não fazem sentido continuar marcados).
  const [selectedIds, setSelectedIds] = React.useState<Set<string>>(new Set())
  React.useEffect(() => { setSelectedIds(new Set()) }, [from, to])

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
      .filter((r) => !onlyPending || r.mrrPendente || r.implPendente)
      .sort((a, b) => (a.fechamento || a.createdAt).localeCompare(b.fechamento || b.createdAt))
  }, [rows, from, to, onlyPending])

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

  const allSelected = noPeriodo.length > 0 && noPeriodo.every((r) => selectedIds.has(r.id))
  const toggleSelectAll = () => {
    setSelectedIds(allSelected ? new Set() : new Set(noPeriodo.map((r) => r.id)))
  }
  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }
  const selectedRows = React.useMemo(
    () => noPeriodo.filter((r) => selectedIds.has(r.id)),
    [noPeriodo, selectedIds],
  )
  const selMrr = React.useMemo(
    () => selectedRows.reduce((sum, r) => sum + parseBRLCents(r.valorMrr), 0),
    [selectedRows],
  )
  const selImpl = React.useMemo(
    () => selectedRows.reduce((sum, r) => sum + parseBRLCents(r.valorImplementacao), 0),
    [selectedRows],
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
  const maxSdrTotal = React.useMemo(
    () => Math.max(1, ...resumoPorSdr.map((r) => r.mrr + r.impl)),
    [resumoPorSdr],
  )

  if (!board) {
    return (
      <>
        <TopBar title="Vendas" subtitle="Comercial" />
        <div className="mx-auto mt-10 max-w-md rounded-2xl bg-card p-6 text-center shadow-sm">
          <ShoppingBag className="mx-auto h-8 w-8 text-foreground/30" />
          <p className="mt-3 text-sm font-medium text-foreground">Nenhum quadro de vendas nesta aba</p>
          <p className="mt-1 text-xs text-foreground/50">
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
        {/* Resumo do período — o que importa de cara, antes de entrar na lista linha a linha. */}
        <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <SummaryCard
            icon={<ShoppingBag className="h-4 w-4" />}
            label="Vendas no período"
            value={validas.length.toLocaleString('pt-BR')}
            tone="info"
          />
          <SummaryCard
            icon={<TrendingUp className="h-4 w-4" />}
            label="MRR do período"
            value={formatBRLCents(totalMrr)}
            tone="success"
          />
          <SummaryCard
            icon={<Wrench className="h-4 w-4" />}
            label="Implementação"
            value={formatBRLCents(totalImpl)}
            tone="info"
          />
          <SummaryCard
            icon={<Award className="h-4 w-4" />}
            label="Total fechado"
            value={formatBRLCents(totalMrr + totalImpl)}
            tone="warning"
          />
        </div>

        {/* Período */}
        <div className="mb-4 flex flex-wrap items-center gap-2 rounded-2xl bg-card p-3 shadow-sm">
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
                className="h-8 rounded-lg border border-line px-2 text-xs text-foreground/70 outline-none focus:border-accent"
              />
              <span className="text-xs text-foreground/40">até</span>
              <input
                type="date"
                value={to}
                onChange={(e) => setTo(e.target.value)}
                className="h-8 rounded-lg border border-line px-2 text-xs text-foreground/70 outline-none focus:border-accent"
              />
            </div>
          )}

          <button
            type="button"
            onClick={() => setOnlyPending((v) => !v)}
            className={cn(
              'ml-auto inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium ring-1 transition-colors',
              onlyPending
                ? 'bg-warning/25 text-warning ring-warning/40'
                : 'text-foreground/50 ring-transparent hover:bg-elevate/[0.04]',
            )}
          >
            <span className="h-2 w-2 shrink-0 rounded-full bg-amber-400 ring-1 ring-amber-500" />
            Só pendentes
          </button>
        </div>

        {/* Barra de seleção — some quando nada está marcado. */}
        {selectedRows.length > 0 && (
          <div className="mb-4 flex flex-wrap items-center gap-x-6 gap-y-2 rounded-2xl bg-accent/10 px-4 py-3 ring-1 ring-accent/20">
            <span className="text-sm font-semibold text-accent">
              {selectedRows.length} selecionado{selectedRows.length === 1 ? '' : 's'}
            </span>
            <span className="text-sm text-foreground/70">
              MRR: <strong className="tabular-nums text-foreground">{formatBRLCents(selMrr)}</strong>
            </span>
            <span className="text-sm text-foreground/70">
              Implementação: <strong className="tabular-nums text-foreground">{formatBRLCents(selImpl)}</strong>
            </span>
            <span className="text-sm text-foreground/70">
              Total: <strong className="tabular-nums text-foreground">{formatBRLCents(selMrr + selImpl)}</strong>
            </span>
            <div className="ml-auto flex items-center gap-3">
              <button
                type="button"
                onClick={() => { for (const r of selectedRows) leadBoardsService.updateRow(r.id, { veioDoFunil: true }) }}
                className="text-xs font-medium text-accent hover:underline"
              >
                Marcar como Funil
              </button>
              <button
                type="button"
                onClick={() => { for (const r of selectedRows) leadBoardsService.updateRow(r.id, { veioDoFunil: false }) }}
                className="text-xs font-medium text-foreground/60 hover:underline"
              >
                Marcar como Avulsa
              </button>
              <button
                type="button"
                onClick={() => setSelectedIds(new Set())}
                className="text-xs font-medium text-accent hover:underline"
              >
                Limpar seleção
              </button>
            </div>
          </div>
        )}

        {/* Lista */}
        <div className="overflow-hidden rounded-2xl bg-card shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[660px]">
              <thead>
                <tr className="border-b border-line text-left text-xs font-semibold uppercase tracking-wide text-foreground/50">
                  <th className="w-10 px-4 py-3">
                    <input
                      type="checkbox"
                      checked={allSelected}
                      onChange={toggleSelectAll}
                      disabled={noPeriodo.length === 0}
                      title="Selecionar todos"
                      className="h-4 w-4 rounded border-line accent-accent"
                    />
                  </th>
                  <th className="px-4 py-3">Nome</th>
                  <th className="w-28 px-4 py-3">SDR</th>
                  <th className="w-24 px-4 py-3">Funil</th>
                  <th className="w-28 px-4 py-3">Contrato</th>
                  <th className="w-48 px-4 py-3 text-right">Valor MRR</th>
                  <th className="w-56 px-4 py-3 text-right">Valor de implementação</th>
                  <th className="w-56 px-4 py-3">Observações</th>
                  <th className="w-10 px-2 py-3" />
                </tr>
              </thead>
              <tbody>
                {noPeriodo.length === 0 && (
                  <tr>
                    <td colSpan={9} className="px-4 py-10 text-center text-sm text-foreground/40">
                      {onlyPending ? 'Nenhuma venda pendente de pagamento neste período.' : 'Nenhuma venda neste período.'}
                    </td>
                  </tr>
                )}
                {noPeriodo.map((r) => (
                  <VendaRow
                    key={r.id}
                    row={r}
                    selected={selectedIds.has(r.id)}
                    onToggleSelect={() => toggleSelect(r.id)}
                    // A linha daqui é uma CÓPIA que o sistema cria sozinho ao marcar "Vendido" —
                    // ela nunca tem Atualizações/linha do tempo (ficam só no lead original do CRM).
                    // Com vendaOrigemId, abre o original de verdade; sem ele (venda avulsa, sem
                    // lead de origem), abre a própria linha — não tem outro lugar com mais dado.
                    onOpenLead={() => setOpenLeadId(r.vendaOrigemId || r.id)}
                  />
                ))}
              </tbody>
              {noPeriodo.length > 0 && (
                <tfoot>
                  <tr className="border-t-2 border-line bg-elevate/[0.03] text-sm font-semibold text-foreground">
                    <td />
                    <td className="px-4 py-3">Total</td>
                    <td />
                    <td />
                    <td />
                    <td className="px-4 py-3 text-right tabular-nums text-success">
                      {formatBRLCents(totalMrr)}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums text-success">
                      {formatBRLCents(totalImpl)}
                    </td>
                    <td />
                    <td />
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        </div>

        {/* Resumo por SDR — mesmo período da lista acima */}
        <div className="mt-4 overflow-hidden rounded-2xl bg-card shadow-sm">
          <div className="border-b border-line px-4 py-3 text-xs font-semibold uppercase tracking-wide text-foreground/50">
            Resumo por SDR
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[600px]">
              <thead>
                <tr className="border-b border-line text-left text-xs font-semibold uppercase tracking-wide text-foreground/50">
                  <th className="px-4 py-3">SDR</th>
                  <th className="w-28 px-4 py-3 text-right">Vendas</th>
                  <th className="w-40 whitespace-nowrap px-4 py-3 text-right">MRR (R$)</th>
                  <th className="w-48 whitespace-nowrap px-4 py-3 text-right">Implementação (R$)</th>
                  <th className="w-40 px-4 py-3">Participação</th>
                </tr>
              </thead>
              <tbody>
                {resumoPorSdr.map((r) => (
                  <tr key={r.nome} className="border-b border-line/60 last:border-0 hover:bg-elevate/[0.04]">
                    <td className="px-4 py-2.5 text-sm font-medium text-foreground">
                      <div className="flex items-center gap-2.5">
                        <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-accent/10 text-[10px] font-semibold text-accent">
                          {initials(r.nome)}
                        </span>
                        {r.nome}
                      </div>
                    </td>
                    <td className="px-4 py-2.5 text-right text-sm tabular-nums">{r.vendas}</td>
                    <td className="px-4 py-2.5 text-right text-sm tabular-nums">{formatBRLCents(r.mrr)}</td>
                    <td className="px-4 py-2.5 text-right text-sm tabular-nums">{formatBRLCents(r.impl)}</td>
                    <td className="px-4 py-2.5">
                      <div
                        className="h-1.5 w-full overflow-hidden rounded-full bg-elevate/[0.08]"
                        role="img"
                        aria-label={`${Math.round(((r.mrr + r.impl) / maxSdrTotal) * 100)}% do maior total entre os SDRs`}
                      >
                        <div
                          className="h-full rounded-full bg-accent"
                          style={{ width: `${Math.max(2, ((r.mrr + r.impl) / maxSdrTotal) * 100)}%` }}
                        />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-line bg-elevate/[0.03] text-sm font-semibold text-foreground">
                  <td className="px-4 py-3">Equipe</td>
                  <td className="px-4 py-3 text-right tabular-nums">{validas.length}</td>
                  <td className="px-4 py-3 text-right tabular-nums text-success">{formatBRLCents(totalMrr)}</td>
                  <td className="px-4 py-3 text-right tabular-nums text-success">{formatBRLCents(totalImpl)}</td>
                  <td />
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
      <LeadDetailModal leadRowId={openLeadId} onClose={() => setOpenLeadId(null)} />
    </>
  )
}

function SummaryCard({
  icon,
  label,
  value,
  tone,
}: {
  icon: React.ReactNode
  label: string
  value: string
  tone: 'info' | 'success' | 'warning'
}) {
  const tones = {
    info: 'bg-accent/10 text-accent ring-accent/20',
    success: 'bg-success/10 text-success ring-success/20',
    warning: 'bg-warning/10 text-warning ring-warning/20',
  }
  return (
    <div className="rounded-2xl border border-line bg-card p-4 shadow-sm">
      <div className="flex items-center justify-between">
        <span className="text-xs uppercase tracking-wider text-foreground/45">{label}</span>
        <span className={cn('grid h-7 w-7 place-items-center rounded-lg ring-1', tones[tone])}>{icon}</span>
      </div>
      <div className="mt-3 text-2xl font-semibold tracking-tight tabular-nums text-foreground">{value}</div>
    </div>
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
        active ? 'bg-accent/10 text-accent ring-1 ring-accent/20' : 'text-foreground/50 hover:bg-elevate/[0.04]',
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
    <td className={cn('px-1 py-1.5 text-sm tabular-nums', pendente && 'bg-warning/35', strikethrough && 'line-through')}>
      <div className="flex items-center gap-1.5">
        <button
          type="button"
          onClick={onTogglePendente}
          title={pendente ? 'Pendente de pagamento — clique para marcar como pago' : 'Pago — clique para marcar como pendente'}
          className={cn(
            'h-2.5 w-2.5 shrink-0 rounded-full ring-1 ring-inset transition-colors',
            pendente ? 'bg-amber-400 ring-amber-500' : 'bg-transparent ring-line hover:ring-foreground/40',
          )}
        />
        <CurrencyField value={value} onSave={onSave} className="flex-1 bg-transparent text-right" />
      </div>
    </td>
  )
}

/** Comentário livre pro controle manual (ex.: "paga metade metade", condição especial negociada)
 * — só existe aqui na aba Vendas, não é uma coluna do CRM. */
function ObservacoesCell({ value, onSave }: { value: string; onSave: (next: string) => void }) {
  const [local, setLocal] = React.useState(value)
  const focusedRef = React.useRef(false)
  const debouncedSave = useDebouncedCallback((next: string) => onSave(next), 600)

  React.useEffect(() => {
    if (!focusedRef.current) setLocal(value)
  }, [value])

  return (
    <td className="px-2 py-1.5">
      <input
        value={local}
        placeholder="Ex.: paga metade/metade..."
        onFocus={() => { focusedRef.current = true }}
        onChange={(e) => { setLocal(e.target.value); debouncedSave(e.target.value) }}
        onBlur={() => {
          focusedRef.current = false
          if (local !== value) onSave(local)
        }}
        className="h-9 w-full rounded-lg bg-elevate/[0.03] px-2 text-sm text-foreground/70 outline-none focus:bg-card focus:ring-1 focus:ring-accent/30"
      />
    </td>
  )
}

function VendaRow({
  row,
  selected,
  onToggleSelect,
  onOpenLead,
}: {
  row: LeadRow
  selected: boolean
  onToggleSelect: () => void
  onOpenLead: () => void
}) {
  const [excluirOpen, setExcluirOpen] = React.useState(false)

  // Corrige o valor "oficial" (ex.: desconto negociado no fechamento) — se essa venda veio de um
  // lead do CRM (vendaOrigemId), o servidor propaga o mesmo valor pro lead de origem também.
  const saveMrr = (next: string) => leadBoardsService.updateRow(row.id, { valorMrr: next })
  const saveImpl = (next: string) => leadBoardsService.updateRow(row.id, { valorImplementacao: next })
  const saveObs = (next: string) => leadBoardsService.updateRow(row.id, { observacoes: next })

  return (
    <tr
      className={cn(
        'group border-b border-line/60 last:border-0 hover:bg-elevate/[0.04]',
        selected && 'bg-accent/5',
        row.vendaRevertida && 'text-foreground/40',
      )}
    >
      <td className="px-4 py-3">
        <input
          type="checkbox"
          checked={selected}
          onChange={onToggleSelect}
          className="h-4 w-4 rounded border-line accent-accent"
        />
      </td>
      <td className="px-4 py-3">
        <button
          type="button"
          onClick={onOpenLead}
          title="Ver dados do lead"
          className="group/name flex items-center gap-2.5 rounded-md text-left"
        >
          <span
            className={cn(
              'grid h-7 w-7 shrink-0 place-items-center rounded-full bg-accent/10 text-[11px] font-semibold text-accent',
              row.vendaRevertida && 'bg-elevate/[0.06] text-foreground/40',
            )}
          >
            {initials(row.nome)}
          </span>
          <span
            className={cn(
              'text-sm group-hover/name:text-accent group-hover/name:underline',
              row.vendaRevertida && 'line-through decoration-foreground/30',
            )}
          >
            {row.nome || 'Sem nome'}
          </span>
          {row.vendaRevertida && (
            <span className="rounded-full bg-elevate/[0.08] px-1.5 py-0.5 text-[10px] font-medium text-foreground/50">
              revertida
            </span>
          )}
        </button>
      </td>
      <td className={cn('px-4 py-3 text-sm text-foreground/70', row.vendaRevertida && 'line-through')}>
        {row.sdr || '—'}
      </td>
      <td className="px-4 py-3">
        <button
          type="button"
          onClick={() => leadBoardsService.updateRow(row.id, { veioDoFunil: !row.veioDoFunil })}
          title={row.veioDoFunil ? 'Veio do funil — clique pra marcar como avulsa' : 'Avulsa — clique pra marcar como funil'}
          className={cn(
            'rounded-full px-2 py-0.5 text-[11px] font-medium transition-colors',
            row.veioDoFunil ? 'bg-accent/10 text-accent' : 'bg-elevate/[0.06] text-foreground/40 hover:bg-elevate/[0.1]',
          )}
        >
          {row.veioDoFunil ? 'Funil' : 'Avulsa'}
        </button>
      </td>
      <td className="px-4 py-3">
        <button
          type="button"
          onClick={() => leadBoardsService.updateRow(row.id, { contratoAssinado: !row.contratoAssinado })}
          title={row.contratoAssinado ? 'Assinado — clique pra marcar como pendente' : 'Pendente — clique pra marcar como assinado'}
          className={cn(
            'rounded-full px-2 py-0.5 text-[11px] font-medium transition-colors',
            row.contratoAssinado ? 'bg-success/10 text-success' : 'bg-warning/10 text-warning hover:bg-warning/15',
          )}
        >
          {row.contratoAssinado ? 'Assinado' : 'Pendente'}
        </button>
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
      <ObservacoesCell value={row.observacoes} onSave={saveObs} />
      <td className="px-2 py-3">
        <button
          type="button"
          onClick={() => setExcluirOpen(true)}
          title="Excluir venda"
          className="grid h-6 w-6 place-items-center rounded text-foreground/30 opacity-0 transition-opacity hover:bg-danger/10 hover:text-danger group-hover:opacity-100"
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
        <ul className="max-h-[50vh] divide-y divide-line/60 overflow-y-auto">
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
  const [observacoes, setObservacoes] = React.useState('')
  const [veioDoFunil, setVeioDoFunil] = React.useState(false)

  React.useEffect(() => {
    if (!open) return
    setNome('')
    setMrr('')
    setImpl('')
    setFechamento(isoDay(new Date()))
    setFechadoPor('')
    setObservacoes('')
    setVeioDoFunil(false)
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
      observacoes: observacoes.trim(),
      veioDoFunil,
    })
    toast.success(`Venda de "${trimmed}" registrada.`)
    onClose()
  }

  return (
    <Modal open={open} onClose={onClose} title="Registrar venda" size="sm">
      <div className="space-y-6">
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
        <div className="grid grid-cols-2 gap-3">
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
        <Input
          label="Observações (opcional)"
          value={observacoes}
          onChange={(e) => setObservacoes(e.target.value)}
          placeholder="Ex.: paga metade/metade, condição especial..."
        />
        <label className="flex items-center gap-2 text-sm text-foreground/70">
          <input
            type="checkbox"
            checked={veioDoFunil}
            onChange={(e) => setVeioDoFunil(e.target.checked)}
            className="h-4 w-4 rounded border-line accent-accent"
          />
          Veio do funil (SDR agendou/trabalhou o lead) — deixe desmarcado se for avulsa de verdade
        </label>
      </div>
      <div className="mt-6 flex justify-end gap-2">
        <Button variant="ghost" onClick={onClose}>Cancelar</Button>
        <Button onClick={submit} disabled={!nome.trim()}>Registrar</Button>
      </div>
    </Modal>
  )
}
