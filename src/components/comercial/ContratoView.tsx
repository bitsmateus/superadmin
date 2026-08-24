import * as React from 'react'
import { toast } from 'sonner'
import { CheckCircle2, Clock, Download, FileText, ListTodo, Loader2, Plus, Search, Settings, Trash2, X } from 'lucide-react'
import { TopBar } from '@/components/layout/TopBar'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
import { useAllLeadRows, useLeadBoards } from '@/hooks/useLeadBoards'
import { useContracts, useContractsLoaded, useContractTemplates } from '@/hooks/useContracts'
import { contractsService, type Contract, type ContractStatus, type ContractTemplate } from '@/services/contracts'
import { lookupCnpj, type CnpjData } from '@/services/cnpjLookup'
import { applyPlaceholders, cnpjFieldFor, extractPlaceholders } from '@/lib/contractPlaceholders'
import { formatCnpj, isValidCnpjLength } from '@/lib/cnpj'
import { formatBRLCents, parseBRLCents } from '@/lib/currency'
import { openContractSheet } from '@/lib/contractSheet'
import { useDebouncedCallback } from '@/hooks/useDebouncedCallback'
import { cn } from '@/lib/utils'
import type { LeadRow } from '@/types/leadBoard'

type Tab = 'pendentes-venda' | 'criar' | 'pendentes-contrato' | 'assinados'

/**
 * Aba Contrato — organizada em 4 seções: "Pendente de contrato" (vendas fechadas que ainda não
 * têm nenhum contrato gerado — cruza com o quadro de Vendas), "Criar contrato" (formulário com
 * busca automática por CNPJ), "Contratos pendentes" e "Contratos assinados" (marcação manual, sem
 * assinatura eletrônica — a pessoa marca quando o cliente devolve assinado).
 */
export function ContratoView({ pageId }: { pageId: string }) {
  const boards = useLeadBoards()
  const board = React.useMemo(
    () => boards.find((b) => b.page === pageId && b.isContrato) ?? boards.find((b) => b.page === pageId),
    [boards, pageId],
  )
  const allRows = useAllLeadRows()
  const loaded = useContractsLoaded()
  const templates = useContractTemplates()
  const allContracts = useContracts()
  const contracts = React.useMemo(
    () => (board ? allContracts.filter((c) => c.boardId === board.id) : []),
    [allContracts, board],
  )
  const template = templates[0] ?? null
  const placeholders = React.useMemo(() => (template ? extractPlaceholders(template.conteudo) : []), [template])

  // "Pendente de contrato" = vendas fechadas (quadro is_vendas, sem revertidas) que ainda não têm
  // nenhum contrato vinculado (contracts.venda_lead_id).
  const vendasBoard = React.useMemo(() => boards.find((b) => b.isVendas), [boards])
  const vendaRows = React.useMemo(
    () => (vendasBoard ? allRows.filter((r) => r.boardId === vendasBoard.id && !r.vendaRevertida) : []),
    [allRows, vendasBoard],
  )
  const contractedVendaIds = React.useMemo(
    () => new Set(contracts.filter((c) => c.vendaLeadId).map((c) => c.vendaLeadId as string)),
    [contracts],
  )
  const pendingVendas = React.useMemo(
    () => vendaRows
      .filter((r) => !contractedVendaIds.has(r.id))
      .sort((a, b) => (b.fechamento || b.createdAt).localeCompare(a.fechamento || a.createdAt)),
    [vendaRows, contractedVendaIds],
  )
  const pendingContracts = React.useMemo(() => contracts.filter((c) => c.status !== 'assinado'), [contracts])
  const signedContracts = React.useMemo(() => contracts.filter((c) => c.status === 'assinado'), [contracts])

  const [tab, setTab] = React.useState<Tab>('pendentes-venda')
  const [selectedId, setSelectedId] = React.useState<string | null>(null)
  const [draftCampos, setDraftCampos] = React.useState<Record<string, string>>({})
  const [draftVendaId, setDraftVendaId] = React.useState<string | null>(null)
  const [cnpjLoading, setCnpjLoading] = React.useState(false)
  const [creating, setCreating] = React.useState(false)
  const [editTemplateOpen, setEditTemplateOpen] = React.useState(false)

  const changeTab = (next: Tab) => { setTab(next); setSelectedId(null) }

  const listForTab = tab === 'assinados' ? signedContracts : tab === 'pendentes-contrato' ? pendingContracts : []
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

  const startNew = (venda?: LeadRow) => {
    const campos: Record<string, string> = {}
    if (venda && placeholders.includes('Nome Fantasia')) campos['Nome Fantasia'] = venda.nome
    setDraftCampos(campos)
    setDraftVendaId(venda?.id ?? null)
    setTab('criar')
  }

  const fillFromCnpj = async () => {
    const raw = draftCampos['CNPJ'] ?? ''
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

  const generate = async () => {
    if (!board || !template) return
    setCreating(true)
    try {
      const conteudo = applyPlaceholders(template.conteudo, draftCampos)
      const created = await contractsService.createContract(board.id, template.id, draftCampos, conteudo, draftVendaId)
      loadedIdRef.current = null
      setDraftCampos({})
      setDraftVendaId(null)
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
              <TabPill active={tab === 'pendentes-venda'} onClick={() => changeTab('pendentes-venda')} icon={<ListTodo className="h-3.5 w-3.5" />} label="Pendente de contrato" count={pendingVendas.length} />
              <TabPill active={tab === 'criar'} onClick={() => { setDraftCampos({}); setDraftVendaId(null); changeTab('criar') }} icon={<Plus className="h-3.5 w-3.5" />} label="Criar contrato" />
              <TabPill active={tab === 'pendentes-contrato'} onClick={() => changeTab('pendentes-contrato')} icon={<Clock className="h-3.5 w-3.5" />} label="Contratos pendentes" count={pendingContracts.length} />
              <TabPill active={tab === 'assinados'} onClick={() => changeTab('assinados')} icon={<CheckCircle2 className="h-3.5 w-3.5" />} label="Contratos assinados" count={signedContracts.length} />
            </div>

            {tab === 'pendentes-venda' && (
              <PendingVendasList vendas={pendingVendas} onCreate={startNew} />
            )}

            {tab === 'criar' && (
              <div className="rounded-2xl bg-white p-4 shadow-sm">
                <div className="mb-3 flex items-center justify-between gap-2">
                  <span className="text-sm font-semibold text-[#323338]">Novo contrato</span>
                  {draftVendaId && (
                    <span className="inline-flex items-center gap-1.5 rounded-full bg-accent/10 px-2.5 py-1 text-[11px] font-medium text-accent">
                      Vinculado a uma venda
                      <button type="button" onClick={() => setDraftVendaId(null)} title="Desvincular">
                        <X className="h-3 w-3" />
                      </button>
                    </span>
                  )}
                </div>
                <FieldForm
                  placeholders={placeholders}
                  campos={draftCampos}
                  onChange={(name, value) => setDraftCampos((prev) => ({ ...prev, [name]: value }))}
                  onCnpjBlur={fillFromCnpj}
                  cnpjLoading={cnpjLoading}
                />
                <div className="mt-4 flex justify-end gap-2">
                  <Button onClick={generate} loading={creating}>Gerar contrato</Button>
                </div>
              </div>
            )}

            {(tab === 'pendentes-contrato' || tab === 'assinados') && (
              <div className="flex flex-col gap-4 lg:flex-row">
                <aside className="shrink-0 rounded-2xl bg-white p-3 shadow-sm lg:w-64">
                  {listForTab.length === 0 ? (
                    <p className="px-1 py-6 text-center text-xs text-gray-400">
                      {tab === 'assinados' ? 'Nenhum contrato assinado ainda.' : 'Nenhum contrato pendente.'}
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

/** Vendas fechadas (quadro de Vendas) que ainda não têm nenhum contrato gerado — fila de "falta
 * fazer o contrato". "Criar contrato" já leva pro formulário com o nome pré-preenchido e vinculado
 * a essa venda, pra sumir da fila assim que o contrato for gerado. */
function PendingVendasList({ vendas, onCreate }: { vendas: LeadRow[]; onCreate: (venda: LeadRow) => void }) {
  if (vendas.length === 0) {
    return (
      <div className="grid min-h-[30vh] place-items-center rounded-2xl bg-white text-center text-sm text-gray-400 shadow-sm">
        Nenhuma venda pendente de contrato — tudo em dia.
      </div>
    )
  }
  return (
    <div className="overflow-hidden rounded-2xl bg-white shadow-sm">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[560px]">
          <thead>
            <tr className="border-b border-gray-200 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
              <th className="px-4 py-3">Nome</th>
              <th className="w-28 px-4 py-3">SDR</th>
              <th className="w-32 px-4 py-3 text-right">Valor MRR</th>
              <th className="w-32 px-4 py-3">Fechamento</th>
              <th className="w-40 px-2 py-3" />
            </tr>
          </thead>
          <tbody>
            {vendas.map((v) => (
              <tr key={v.id} className="border-b border-gray-100 last:border-0 hover:bg-gray-50/70">
                <td className="px-4 py-3 text-sm text-gray-700">{v.nome || 'Sem nome'}</td>
                <td className="px-4 py-3 text-sm text-gray-600">{v.sdr || '—'}</td>
                <td className="px-4 py-3 text-right text-sm tabular-nums">{formatBRLCents(parseBRLCents(v.valorMrr))}</td>
                <td className="px-4 py-3 text-sm text-gray-600">{(v.fechamento || v.createdAt).slice(0, 10).split('-').reverse().join('/')}</td>
                <td className="px-2 py-3 text-right">
                  <Button size="sm" onClick={() => onCreate(v)} leftIcon={<Plus className="h-3.5 w-3.5" />}>Criar contrato</Button>
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
