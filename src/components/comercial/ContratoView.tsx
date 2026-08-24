import * as React from 'react'
import { toast } from 'sonner'
import { CalendarRange, CheckCircle2, Clock, Download, FileText, ListTodo, Loader2, Plus, Search, Settings, Trash2, X } from 'lucide-react'
import { TopBar } from '@/components/layout/TopBar'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
import { useLeadBoards } from '@/hooks/useLeadBoards'
import { useClients } from '@/hooks/useClients'
import { useContracts, useContractsLoaded, useContractTemplates } from '@/hooks/useContracts'
import { contractsService, type Contract, type ContractStatus, type ContractTemplate } from '@/services/contracts'
import { lookupCnpj, type CnpjData } from '@/services/cnpjLookup'
import { applyPlaceholders, cnpjFieldFor, extractPlaceholders } from '@/lib/contractPlaceholders'
import { formatCnpj, isValidCnpjLength } from '@/lib/cnpj'
import { openContractSheet } from '@/lib/contractSheet'
import { useDebouncedCallback } from '@/hooks/useDebouncedCallback'
import { formatDateShort } from '@/lib/utils'
import { cn } from '@/lib/utils'
import type { Client } from '@/types/client'

type Tab = 'pendentes-venda' | 'criar' | 'pendentes-contrato' | 'assinados'

const MONTH_NAMES = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez']

function currentMonthId(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}
function addMonthsToId(id: string, n: number): string {
  const [y, m] = id.split('-').map(Number)
  const d = new Date(y, m - 1 + n, 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}
function monthLabelPt(id: string): string {
  const [y, m] = id.split('-').map(Number)
  return `${MONTH_NAMES[m - 1] ?? id}/${y}`
}
function monthIdBounds(id: string): { from: string; to: string } {
  const [y, m] = id.split('-').map(Number)
  const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  return { from: iso(new Date(y, m - 1, 1)), to: iso(new Date(y, m, 0)) }
}
function withinBounds(iso: string | null, bounds: { from: string; to: string }): boolean {
  if (!iso) return false
  const d = iso.slice(0, 10)
  if (bounds.from && d < bounds.from) return false
  if (bounds.to && d > bounds.to) return false
  return true
}

/** Estado do filtro de período (mês/personalizado) de UMA lista — cada aba de contratos tem o
 * seu próprio, igual ao Painel do Mês: pills de mês + "Adicionar mês" (mês seguinte ao último
 * pill) + opção "Personalizado" com data de/até livre. */
function useMonthFilter() {
  const [months, setMonths] = React.useState<string[]>(() => [currentMonthId()])
  const [selected, setSelected] = React.useState<string>(() => currentMonthId())
  const [customMode, setCustomMode] = React.useState(false)
  const [customFrom, setCustomFrom] = React.useState('')
  const [customTo, setCustomTo] = React.useState('')

  const addMonth = () => {
    const next = addMonthsToId(months[months.length - 1] ?? currentMonthId(), 1)
    setMonths((prev) => (prev.includes(next) ? prev : [...prev, next]))
    setSelected(next)
    setCustomMode(false)
  }

  const bounds = customMode ? { from: customFrom, to: customTo } : monthIdBounds(selected)

  return { months, selected, setSelected, addMonth, customMode, setCustomMode, customFrom, setCustomFrom, customTo, setCustomTo, bounds }
}
type MonthFilter = ReturnType<typeof useMonthFilter>

/**
 * Aba Contrato — organizada em 4 seções: "Pendente de contrato" (clientes que preencheram a ficha
 * de cadastro pública e ainda não têm contrato gerado), "Criar contrato" (formulário com busca
 * automática por CNPJ), "Contratos pendentes" e "Contratos assinados" (marcação manual, sem
 * assinatura eletrônica — a pessoa marca quando o cliente devolve assinado; as duas últimas têm
 * filtro por mês/período, igual o Painel do Mês).
 */
export function ContratoView({ pageId }: { pageId: string }) {
  const boards = useLeadBoards()
  const board = React.useMemo(
    () => boards.find((b) => b.page === pageId && b.isContrato) ?? boards.find((b) => b.page === pageId),
    [boards, pageId],
  )
  const clients = useClients()
  const loaded = useContractsLoaded()
  const templates = useContractTemplates()
  const allContracts = useContracts()
  const contracts = React.useMemo(
    () => (board ? allContracts.filter((c) => c.boardId === board.id) : []),
    [allContracts, board],
  )
  const template = templates[0] ?? null
  const placeholders = React.useMemo(() => (template ? extractPlaceholders(template.conteudo) : []), [template])

  // "Pendente de contrato" = clientes que preencheram a ficha (app/ficha) e ainda não têm nenhum
  // contrato vinculado (contracts.client_id) — não depende mais de venda registrada manualmente.
  const contractedClientIds = React.useMemo(
    () => new Set(contracts.filter((c) => c.clientId).map((c) => c.clientId as string)),
    [contracts],
  )
  const pendingClients = React.useMemo(
    () => clients
      .filter((c) => c.fichaCadastro && !contractedClientIds.has(c.id))
      .sort((a, b) => new Date(b.fichaCadastro?.submittedAt ?? b.createdAt).getTime() - new Date(a.fichaCadastro?.submittedAt ?? a.createdAt).getTime()),
    [clients, contractedClientIds],
  )
  const pendingContracts = React.useMemo(() => contracts.filter((c) => c.status !== 'assinado'), [contracts])
  const signedContracts = React.useMemo(() => contracts.filter((c) => c.status === 'assinado'), [contracts])

  const pendingFilter = useMonthFilter()
  const signedFilter = useMonthFilter()
  const pendingContractsInRange = React.useMemo(
    () => pendingContracts.filter((c) => withinBounds(c.createdAt, pendingFilter.bounds)),
    [pendingContracts, pendingFilter.bounds],
  )
  const signedContractsInRange = React.useMemo(
    () => signedContracts.filter((c) => withinBounds(c.signedAt ?? c.createdAt, signedFilter.bounds)),
    [signedContracts, signedFilter.bounds],
  )

  const [tab, setTab] = React.useState<Tab>('pendentes-venda')
  const [selectedId, setSelectedId] = React.useState<string | null>(null)
  const [draftCampos, setDraftCampos] = React.useState<Record<string, string>>({})
  const [draftClientId, setDraftClientId] = React.useState<string | null>(null)
  const [cnpjLoading, setCnpjLoading] = React.useState(false)
  const [creating, setCreating] = React.useState(false)
  const [editTemplateOpen, setEditTemplateOpen] = React.useState(false)

  const changeTab = (next: Tab) => { setTab(next); setSelectedId(null) }

  const listForTab = tab === 'assinados' ? signedContractsInRange : tab === 'pendentes-contrato' ? pendingContractsInRange : []
  const selected = listForTab.find((c) => c.id === selectedId) ?? null

  const bodyRef = React.useRef<HTMLDivElement>(null)
  const loadedIdRef = React.useRef<string | null>(null)
  React.useEffect(() => {
    if (!selected || !bodyRef.current) return
    if (loadedIdRef.current === selected.id) return
    bodyRef.current.innerHTML = selected.conteudo
    loadedIdRef.current = selected.id
  }, [selected])

  const debouncedSaveBody = useDebouncedCallback((html: string) => {
    if (selected) void contractsService.updateContract(selected.id, { conteudo: html })
  }, 800)

  const fillFromCnpj = async (cnpjOverride?: string) => {
    const raw = cnpjOverride ?? draftCampos['CNPJ'] ?? ''
    if (!isValidCnpjLength(raw)) { toast.error('Digite um CNPJ com 14 dígitos.'); return }
    setCnpjLoading(true)
    try {
      const data = await lookupCnpj(raw)
      setDraftCampos((prev) => {
        const next = { ...prev }
        for (const name of placeholders) {
          const key = cnpjFieldFor(name)
          if (key) {
            const value = data[key as keyof CnpjData]
            if (value) next[name] = value
          }
        }
        return next
      })
      toast.success('Dados do CNPJ preenchidos — confira antes de gerar.')
    } catch (err) {
      toast.error((err as Error).message || 'Falha ao consultar o CNPJ.')
    } finally {
      setCnpjLoading(false)
    }
  }

  const startNew = (client?: Client) => {
    const campos: Record<string, string> = {}
    if (client) {
      if (placeholders.includes('Nome Fantasia')) campos['Nome Fantasia'] = client.company || client.name
      const cnpj = client.fichaCadastro?.cnpj
      if (cnpj && placeholders.includes('CNPJ')) campos['CNPJ'] = formatCnpj(cnpj)
    }
    setDraftCampos(campos)
    setDraftClientId(client?.id ?? null)
    setTab('criar')
    // Já veio da ficha com o CNPJ — dispara a busca sozinho, sem esperar o blur do campo.
    if (client?.fichaCadastro?.cnpj) void fillFromCnpj(client.fichaCadastro.cnpj)
  }

  const generate = async () => {
    if (!board || !template) return
    setCreating(true)
    try {
      const conteudo = applyPlaceholders(template.conteudo, draftCampos)
      const created = await contractsService.createContract(board.id, template.id, draftCampos, conteudo, draftClientId)
      loadedIdRef.current = null
      setDraftCampos({})
      setDraftClientId(null)
      setTab('pendentes-contrato')
      setSelectedId(created.id)
      toast.success('Contrato gerado.')
    } finally {
      setCreating(false)
    }
  }

  const regenerate = () => {
    if (!selected || !template) return
    if (!window.confirm('Isso reaplica os campos preenchidos no texto do modelo, sobrescrevendo o corpo atual do contrato (inclusive edições manuais). Continuar?')) return
    const conteudo = applyPlaceholders(template.conteudo, selected.campos)
    if (bodyRef.current) bodyRef.current.innerHTML = conteudo
    void contractsService.updateContract(selected.id, { conteudo })
  }

  const saveField = (contract: Contract, name: string, value: string) => {
    void contractsService.updateContract(contract.id, { campos: { ...contract.campos, [name]: value } })
  }

  const fillSelectedFromCnpj = async () => {
    if (!selected) return
    const raw = selected.campos['CNPJ'] ?? ''
    if (!isValidCnpjLength(raw)) { toast.error('Digite um CNPJ com 14 dígitos.'); return }
    setCnpjLoading(true)
    try {
      const data = await lookupCnpj(raw)
      const next = { ...selected.campos }
      for (const name of placeholders) {
        const key = cnpjFieldFor(name)
        if (key) {
          const value = data[key as keyof CnpjData]
          if (value) next[name] = value
        }
      }
      await contractsService.updateContract(selected.id, { campos: next })
      toast.success('Dados do CNPJ preenchidos — clique em "Reaplicar no texto" pra atualizar o corpo.')
    } catch (err) {
      toast.error((err as Error).message || 'Falha ao consultar o CNPJ.')
    } finally {
      setCnpjLoading(false)
    }
  }

  const toggleSigned = () => {
    if (!selected) return
    const next: ContractStatus = selected.status === 'assinado' ? 'pendente' : 'assinado'
    void contractsService.updateContract(selected.id, { status: next })
  }

  const removeContract = (c: Contract) => {
    if (!window.confirm(`Excluir o contrato de "${contractLabel(c)}"?`)) return
    if (selectedId === c.id) setSelectedId(null)
    void contractsService.deleteContract(c.id)
  }

  const download = () => {
    if (!selected) return
    openContractSheet(bodyRef.current?.innerHTML ?? selected.conteudo, `Contrato — ${contractLabel(selected)}`)
  }

  if (!board) {
    return (
      <>
        <TopBar title="Contrato" subtitle="Comercial" />
        <div className="mx-auto mt-10 max-w-md rounded-2xl bg-white p-6 text-center shadow-sm">
          <FileText className="mx-auto h-8 w-8 text-gray-300" />
          <p className="mt-3 text-sm font-medium text-[#323338]">Nenhum quadro nesta aba</p>
        </div>
      </>
    )
  }

  return (
    <>
      <TopBar
        title="Contrato"
        subtitle={`${contracts.length} contrato(s) gerado(s)`}
        rightSlot={
          <Button variant="secondary" onClick={() => setEditTemplateOpen(true)} leftIcon={<Settings className="h-4 w-4" />}>
            Editar modelo padrão
          </Button>
        }
      />

      <div className="px-1 pb-8">
        {!loaded ? (
          <div className="grid min-h-[30vh] place-items-center text-sm text-gray-500">
            <span className="inline-flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin" />Carregando…</span>
          </div>
        ) : !template ? (
          <p className="py-10 text-center text-sm text-gray-400">Nenhum modelo de contrato cadastrado.</p>
        ) : (
          <>
            <div className="mb-4 flex flex-wrap gap-2 rounded-2xl bg-white p-3 shadow-sm">
              <TabPill active={tab === 'pendentes-venda'} onClick={() => changeTab('pendentes-venda')} icon={<ListTodo className="h-3.5 w-3.5" />} label="Pendente de contrato" count={pendingClients.length} />
              <TabPill active={tab === 'criar'} onClick={() => { setDraftCampos({}); setDraftClientId(null); changeTab('criar') }} icon={<Plus className="h-3.5 w-3.5" />} label="Criar contrato" />
              <TabPill active={tab === 'pendentes-contrato'} onClick={() => changeTab('pendentes-contrato')} icon={<Clock className="h-3.5 w-3.5" />} label="Contratos pendentes" count={pendingContracts.length} />
              <TabPill active={tab === 'assinados'} onClick={() => changeTab('assinados')} icon={<CheckCircle2 className="h-3.5 w-3.5" />} label="Contratos assinados" count={signedContracts.length} />
            </div>

            {tab === 'pendentes-venda' && (
              <PendingClientsList clients={pendingClients} onCreate={startNew} />
            )}

            {tab === 'criar' && (
              <div className="rounded-2xl bg-white p-4 shadow-sm">
                <div className="mb-3 flex items-center justify-between gap-2">
                  <span className="text-sm font-semibold text-[#323338]">Novo contrato</span>
                  {draftClientId && (
                    <span className="inline-flex items-center gap-1.5 rounded-full bg-accent/10 px-2.5 py-1 text-[11px] font-medium text-accent">
                      Vinculado a uma ficha de cadastro
                      <button type="button" onClick={() => setDraftClientId(null)} title="Desvincular">
                        <X className="h-3 w-3" />
                      </button>
                    </span>
                  )}
                </div>
                <FieldForm
                  placeholders={placeholders}
                  campos={draftCampos}
                  onChange={(name, value) => setDraftCampos((prev) => ({ ...prev, [name]: value }))}
                  onCnpjBlur={() => fillFromCnpj()}
                  cnpjLoading={cnpjLoading}
                />
                <div className="mt-4 flex justify-end gap-2">
                  <Button onClick={generate} loading={creating}>Gerar contrato</Button>
                </div>
              </div>
            )}

            {(tab === 'pendentes-contrato' || tab === 'assinados') && (
              <>
                <MonthFilterBar filter={tab === 'assinados' ? signedFilter : pendingFilter} />
                <div className="flex flex-col gap-4 lg:flex-row">
                  <aside className="shrink-0 rounded-2xl bg-white p-3 shadow-sm lg:w-64">
                    {listForTab.length === 0 ? (
                      <p className="px-1 py-6 text-center text-xs text-gray-400">
                        {tab === 'assinados' ? 'Nenhum contrato assinado nesse período.' : 'Nenhum contrato pendente nesse período.'}
                      </p>
                    ) : (
                      <ul className="space-y-1">
                        {listForTab.map((c) => (
                          <li key={c.id}>
                            <button
                              type="button"
                              onClick={() => setSelectedId(c.id)}
                              className={cn(
                                'group flex w-full items-center justify-between gap-2 rounded-lg px-2.5 py-2 text-left text-xs transition-colors',
                                selectedId === c.id ? 'bg-accent/10 text-accent' : 'text-gray-600 hover:bg-gray-50',
                              )}
                            >
                              <span className="min-w-0 flex-1 truncate font-medium">{contractLabel(c)}</span>
                              <Trash2
                                className="h-3.5 w-3.5 shrink-0 text-gray-300 opacity-0 hover:text-danger group-hover:opacity-100"
                                onClick={(e) => { e.stopPropagation(); removeContract(c) }}
                              />
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                  </aside>

                  <div className="min-w-0 flex-1 space-y-4">
                    {selected ? (
                      <>
                        <div className="rounded-2xl bg-white p-4 shadow-sm">
                          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                            <span className="text-sm font-semibold text-[#323338]">Campos do cliente</span>
                            <div className="flex items-center gap-2">
                              <Button size="sm" variant="secondary" onClick={regenerate}>Reaplicar no texto</Button>
                              <Button
                                size="sm"
                                variant={selected.status === 'assinado' ? 'secondary' : 'primary'}
                                onClick={toggleSigned}
                                leftIcon={<CheckCircle2 className="h-3.5 w-3.5" />}
                              >
                                {selected.status === 'assinado' ? 'Marcar como pendente' : 'Marcar como assinado'}
                              </Button>
                            </div>
                          </div>
                          <FieldForm
                            placeholders={placeholders}
                            campos={selected.campos}
                            onChange={(name, value) => saveField(selected, name, value)}
                            onCnpjBlur={fillSelectedFromCnpj}
                            cnpjLoading={cnpjLoading}
                          />
                        </div>

                        <div className="rounded-2xl bg-white p-4 shadow-sm">
                          <div className="mb-3 flex items-center justify-between gap-2">
                            <span className="text-sm font-semibold text-[#323338]">Contrato</span>
                            <Button size="sm" onClick={download} leftIcon={<Download className="h-3.5 w-3.5" />}>Baixar PDF</Button>
                          </div>
                          <div
                            ref={bodyRef}
                            contentEditable
                            suppressContentEditableWarning
                            onInput={(e) => debouncedSaveBody((e.target as HTMLDivElement).innerHTML)}
                            className="mx-auto max-w-[800px] rounded-lg border border-gray-100 bg-white p-10 text-[11.5pt] leading-relaxed outline-none focus:ring-1 focus:ring-accent/30"
                            style={{ fontFamily: '"Times New Roman", Georgia, serif' }}
                          />
                        </div>
                      </>
                    ) : (
                      <div className="grid min-h-[30vh] place-items-center text-center text-sm text-gray-400">
                        Selecione um contrato na lista.
                      </div>
                    )}
                  </div>
                </div>
              </>
            )}
          </>
        )}
      </div>

      <EditTemplateModal open={editTemplateOpen} onClose={() => setEditTemplateOpen(false)} template={template} />
    </>
  )
}

function contractLabel(c: Contract): string {
  return c.campos['Nome Fantasia'] || c.campos['Razão Social'] || c.campos['CNPJ'] || 'Sem nome'
}

function TabPill({
  active,
  onClick,
  icon,
  label,
  count,
}: {
  active: boolean
  onClick: () => void
  icon: React.ReactNode
  label: string
  count?: number
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
        active ? 'bg-accent/10 text-accent ring-1 ring-accent/20' : 'text-gray-500 hover:bg-gray-50',
      )}
    >
      {icon}
      {label}
      {count !== undefined && (
        <span className={cn(
          'rounded-full px-1.5 py-0.5 text-[10px] font-semibold',
          active ? 'bg-accent/20 text-accent' : 'bg-gray-100 text-gray-500',
        )}>
          {count}
        </span>
      )}
    </button>
  )
}

/** Barra de mês/período — mesmo espírito do Painel do Mês: pills de mês + "Adicionar mês" (o mês
 * seguinte ao último pill) + "Personalizado" com data de/até livre. */
function MonthFilterBar({ filter }: { filter: MonthFilter }) {
  return (
    <div className="mb-4 flex flex-wrap items-center gap-1.5 rounded-xl border border-gray-200 bg-white p-2.5">
      <CalendarRange className="h-4 w-4 shrink-0 text-gray-400" />
      {filter.months.map((m) => (
        <button
          key={m}
          type="button"
          onClick={() => { filter.setSelected(m); filter.setCustomMode(false) }}
          className={cn(
            'rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors',
            !filter.customMode && filter.selected === m ? 'bg-accent/10 text-accent ring-1 ring-accent/20' : 'text-gray-500 hover:bg-gray-50',
          )}
        >
          {monthLabelPt(m)}
        </button>
      ))}
      <button
        type="button"
        onClick={filter.addMonth}
        className="inline-flex items-center gap-1 rounded-md px-2.5 py-1.5 text-xs font-medium text-gray-500 hover:bg-gray-50"
      >
        <Plus className="h-3 w-3" /> Adicionar mês
      </button>
      <button
        type="button"
        onClick={() => filter.setCustomMode(true)}
        className={cn(
          'rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors',
          filter.customMode ? 'bg-accent/10 text-accent ring-1 ring-accent/20' : 'text-gray-500 hover:bg-gray-50',
        )}
      >
        Personalizado
      </button>
      {filter.customMode && (
        <div className="ml-1 flex items-center gap-2">
          <input
            type="date"
            value={filter.customFrom}
            onChange={(e) => filter.setCustomFrom(e.target.value)}
            className="h-8 rounded-lg border border-gray-200 px-2 text-xs text-gray-700 outline-none focus:border-accent"
          />
          <span className="text-xs text-gray-400">até</span>
          <input
            type="date"
            value={filter.customTo}
            onChange={(e) => filter.setCustomTo(e.target.value)}
            className="h-8 rounded-lg border border-gray-200 px-2 text-xs text-gray-700 outline-none focus:border-accent"
          />
        </div>
      )}
    </div>
  )
}

/** Clientes que preencheram a ficha de cadastro pública (app/ficha) e ainda não têm nenhum
 * contrato gerado — fila de "falta fazer o contrato". "Criar contrato" já leva pro formulário com
 * o nome e o CNPJ pré-preenchidos (e já dispara a busca automática), pra sumir da fila assim que
 * o contrato for gerado. */
function PendingClientsList({ clients, onCreate }: { clients: Client[]; onCreate: (client: Client) => void }) {
  if (clients.length === 0) {
    return (
      <div className="grid min-h-[30vh] place-items-center rounded-2xl bg-white text-center text-sm text-gray-400 shadow-sm">
        Nenhuma ficha pendente de contrato — tudo em dia.
      </div>
    )
  }
  return (
    <div className="overflow-hidden rounded-2xl bg-white shadow-sm">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[560px]">
          <thead>
            <tr className="border-b border-gray-200 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
              <th className="px-4 py-3">Empresa</th>
              <th className="w-44 px-4 py-3">CNPJ</th>
              <th className="w-32 px-4 py-3">Ficha em</th>
              <th className="w-40 px-2 py-3" />
            </tr>
          </thead>
          <tbody>
            {clients.map((c) => (
              <tr key={c.id} className="border-b border-gray-100 last:border-0 hover:bg-gray-50/70">
                <td className="px-4 py-3 text-sm text-gray-700">{c.company || c.name}</td>
                <td className="px-4 py-3 text-sm text-gray-600">{c.fichaCadastro?.cnpj ? formatCnpj(c.fichaCadastro.cnpj) : '—'}</td>
                <td className="px-4 py-3 text-sm text-gray-600">{formatDateShort(c.fichaCadastro?.submittedAt ?? c.createdAt)}</td>
                <td className="px-2 py-3 text-right">
                  <Button size="sm" onClick={() => onCreate(c)} leftIcon={<Plus className="h-3.5 w-3.5" />}>Criar contrato</Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function FieldForm({
  placeholders,
  campos,
  onChange,
  onCnpjBlur,
  cnpjLoading,
}: {
  placeholders: string[]
  campos: Record<string, string>
  onChange: (name: string, value: string) => void
  onCnpjBlur: () => void
  cnpjLoading: boolean
}) {
  if (placeholders.length === 0) {
    return <p className="text-xs text-gray-400">O modelo não tem nenhum campo "&lt;&lt;...&gt;&gt;" pra preencher.</p>
  }
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      {placeholders.map((name) => {
        const isCnpj = name.trim().toLowerCase() === 'cnpj'
        return (
          <div key={name} className={isCnpj ? 'sm:col-span-2' : undefined}>
            <label className="mb-1 block text-[11px] font-medium text-gray-500">{name}</label>
            <div className="relative">
              <input
                value={campos[name] ?? ''}
                onChange={(e) => onChange(name, isCnpj ? formatCnpj(e.target.value) : e.target.value)}
                onBlur={isCnpj ? onCnpjBlur : undefined}
                placeholder={isCnpj ? '00.000.000/0000-00' : undefined}
                className="h-9 w-full rounded-lg border border-gray-200 px-3 pr-8 text-sm text-gray-700 outline-none focus:border-accent"
              />
              {isCnpj && (
                <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-300">
                  {cnpjLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
                </span>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}

function EditTemplateModal({ open, onClose, template }: { open: boolean; onClose: () => void; template: ContractTemplate | null }) {
  const bodyRef = React.useRef<HTMLDivElement>(null)
  const [saving, setSaving] = React.useState(false)

  React.useEffect(() => {
    if (open && bodyRef.current && template) bodyRef.current.innerHTML = template.conteudo
  }, [open, template])

  const save = async () => {
    if (!template || !bodyRef.current) return
    setSaving(true)
    try {
      await contractsService.updateTemplate(template.id, { conteudo: bodyRef.current.innerHTML })
      toast.success('Modelo atualizado — só afeta contratos gerados a partir de agora.')
      onClose()
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Editar modelo padrão"
      description='Use "<<Nome do campo>>" pra marcar um ponto que deve virar um campo no formulário lateral.'
      size="xl"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={saving}>Cancelar</Button>
          <Button onClick={save} loading={saving}>Salvar modelo</Button>
        </>
      }
    >
      <div
        ref={bodyRef}
        contentEditable
        suppressContentEditableWarning
        className="mx-auto max-h-[55vh] max-w-[800px] overflow-y-auto rounded-lg border border-gray-200 bg-white p-8 text-[11pt] leading-relaxed outline-none focus:ring-1 focus:ring-accent/30"
        style={{ fontFamily: '"Times New Roman", Georgia, serif' }}
      />
    </Modal>
  )
}
