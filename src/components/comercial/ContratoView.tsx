import * as React from 'react'
import { toast } from 'sonner'
import {
  ArrowLeft, ArrowRight, CheckCircle2, ChevronDown, ClipboardList, Clock, Download, Eye,
  FileText, Loader2, Pencil, Plus, Printer, Save, Search, Settings, Trash2,
  UserRound, X,
} from 'lucide-react'
import { TopBar } from '@/components/layout/TopBar'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
import { MonthFilterBar } from '@/components/ui/MonthFilterBar'
import { addMonthsToId, currentMonthId, useMonthFilter, withinBounds } from '@/hooks/useMonthFilter'
import { useAuth } from '@/hooks/useAuth'
import { useLeadBoards } from '@/hooks/useLeadBoards'
import { useClients } from '@/hooks/useClients'
import { db } from '@/services/db'
import { canDeleteClient } from '@/services/supabase'
import { ClientDrawer } from '@/components/crm/ClientDrawerLazy'
import { StageAgeBadge } from '@/components/crm/StageAgeBadge'
import { PREV_STAGE, STAGE_COLORS } from '@/constants/stageColors'
import { useContracts, useContractsLoaded, useContractTemplates } from '@/hooks/useContracts'
import { contractsService, type Contract, type ContractStatus, type ContractTemplate } from '@/services/contracts'
import { lookupCnpj, type CnpjData } from '@/services/cnpjLookup'
import { lookupCep, type CepData } from '@/services/cepLookup'
import {
  applyPlaceholders, applyServicesTable, cepFieldFor, cnpjFieldFor, defaultValueFor,
  DEFAULT_SERVICE_ROWS, extractPlaceholders, hintFor, parseServiceRows, sectionFor,
  SECTION_LABELS, SECTION_ORDER, type PlaceholderSection, type ServiceRow,
} from '@/lib/contractPlaceholders'
import { formatCnpj, isValidCnpjLength } from '@/lib/cnpj'
import { formatCep, isValidCepLength } from '@/lib/cep'
import { openContractSheet } from '@/lib/contractSheet'
import { RichTextToolbar } from '@/components/comercial/RichTextToolbar'
import { LeadLinkPanel } from '@/components/comercial/LeadLinkPanel'
import { useDebouncedCallback } from '@/hooks/useDebouncedCallback'
import { formatDateShort, initials } from '@/lib/utils'
import { cn } from '@/lib/utils'
import type { Client } from '@/types/client'

type Tab = 'boas-vindas' | 'criar' | 'pendentes-contrato' | 'assinados'

/**
 * Aba Contrato — organizada em seções: "Boas-vindas" (ficha preenchida, ainda não tem contrato —
 * "avançar" já abre o formulário de gerar contrato direto, sem etapa intermediária), "Pendente de
 * assinatura" (contrato já gerado, aguardando o cliente devolver assinado) e "Contratos assinados"
 * (marcação manual, sem assinatura eletrônica — a pessoa marca quando o cliente devolve assinado;
 * as duas últimas têm filtro por mês/período, igual o Painel do Mês).
 */
export function ContratoView({ pageId }: { pageId: string }) {
  const { profile } = useAuth()
  const canDelete = canDeleteClient(profile?.role)
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

  // "Boas-vindas" = ficha preenchida, ainda sem contrato gerado — "avançar" já abre o formulário
  // de criar contrato direto (ver createContractFromDrawer), sem etapa intermediária pra esperar.
  const contractedClientIds = React.useMemo(
    () => new Set(contracts.filter((c) => c.clientId).map((c) => c.clientId as string)),
    [contracts],
  )
  const sortByFicha = (a: Client, b: Client) =>
    new Date(b.fichaCadastro?.submittedAt ?? b.createdAt).getTime() - new Date(a.fichaCadastro?.submittedAt ?? a.createdAt).getTime()
  const boasVindasClients = React.useMemo(
    () => clients
      .filter((c) => c.fichaCadastro && (c.stage === 'welcome' || c.stage === 'lead' || c.stage === 'contract') && !contractedClientIds.has(c.id))
      .sort(sortByFicha),
    [clients, contractedClientIds],
  )
  const pendingContracts = React.useMemo(() => contracts.filter((c) => c.status !== 'assinado'), [contracts])
  const signedContracts = React.useMemo(() => contracts.filter((c) => c.status === 'assinado'), [contracts])

  // Mostra o mês passado junto do atual de cara — sem isso só aparecia o mês corrente e a pessoa
  // precisava clicar em "Adicionar mês" toda vez que quisesse conferir o mês anterior.
  const lastMonthId = React.useMemo(() => addMonthsToId(currentMonthId(), -1), [])
  const boasVindasFilter = useMonthFilter([lastMonthId])
  const pendingFilter = useMonthFilter([lastMonthId])
  const signedFilter = useMonthFilter([lastMonthId])
  const boasVindasInRange = React.useMemo(
    () => boasVindasClients.filter((c) => withinBounds(c.fichaCadastro?.submittedAt ?? c.createdAt, boasVindasFilter.bounds)),
    [boasVindasClients, boasVindasFilter.bounds],
  )
  const pendingContractsInRange = React.useMemo(
    () => pendingContracts.filter((c) => withinBounds(c.createdAt, pendingFilter.bounds)),
    [pendingContracts, pendingFilter.bounds],
  )
  const signedContractsInRange = React.useMemo(
    () => signedContracts.filter((c) => withinBounds(c.signedAt ?? c.createdAt, signedFilter.bounds)),
    [signedContracts, signedFilter.bounds],
  )

  const [tab, setTab] = React.useState<Tab>('boas-vindas')
  const [selectedId, setSelectedId] = React.useState<string | null>(null)
  const [draftCampos, setDraftCampos] = React.useState<Record<string, string>>({})
  const [draftClientId, setDraftClientId] = React.useState<string | null>(null)
  const [draftVendaLeadId, setDraftVendaLeadId] = React.useState<string | null>(null)
  const [draftPdfData, setDraftPdfData] = React.useState<string | null>(null)
  const [draftPdfFilename, setDraftPdfFilename] = React.useState<string | null>(null)
  const [cnpjLoading, setCnpjLoading] = React.useState(false)
  const [cepLoading, setCepLoading] = React.useState(false)
  const [creating, setCreating] = React.useState(false)
  const [editTemplateOpen, setEditTemplateOpen] = React.useState(false)
  const [pdfLoading, setPdfLoading] = React.useState<'baixar' | 'ver' | null>(null)
  const [openClientId, setOpenClientId] = React.useState<string | null>(null)
  const openClient = React.useMemo(() => clients.find((c) => c.id === openClientId) ?? null, [clients, openClientId])

  const changeTab = (next: Tab) => { setTab(next); setSelectedId(null) }

  const listForTab = tab === 'assinados' ? signedContractsInRange : tab === 'pendentes-contrato' ? pendingContractsInRange : []
  const selected = listForTab.find((c) => c.id === selectedId) ?? null

  // O pdfData completo (base64) não vem na listagem (campo pesado) — busca sob demanda ao abrir
  // o detalhe de um contrato específico, mesmo padrão do ClientDrawer com loadFullClient.
  React.useEffect(() => {
    if (selectedId) void contractsService.loadFullContract(selectedId)
  }, [selectedId])

  const bodyRef = React.useRef<HTMLDivElement>(null)
  const detailOpen = !!selected
  // Contrato abre em modo leitura — só vira contentEditable depois de clicar "Editar texto".
  // Reseta pra leitura toda vez que o modal fecha, pra sempre abrir limpo da próxima vez.
  const [editingBody, setEditingBody] = React.useState(false)
  React.useEffect(() => {
    if (!detailOpen) setEditingBody(false)
  }, [detailOpen])
  // O corpo editável (contentEditable) desmonta sempre que sai do modo edição ou o modal fecha —
  // recarrega o texto toda vez que ENTRA em edição, não dá pra confiar num "já carreguei antes".
  React.useEffect(() => {
    if (detailOpen && editingBody && bodyRef.current && selected) bodyRef.current.innerHTML = selected.conteudo
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detailOpen, editingBody])

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

  const fillFromCep = async (cepOverride?: string) => {
    const raw = cepOverride ?? draftCampos['CEP'] ?? ''
    if (!isValidCepLength(raw)) { toast.error('Digite um CEP com 8 dígitos.'); return }
    setCepLoading(true)
    try {
      const data = await lookupCep(raw)
      setDraftCampos((prev) => {
        const next = { ...prev }
        for (const name of placeholders) {
          const key = cepFieldFor(name)
          if (key) {
            const value = data[key as keyof CepData]
            if (value) next[name] = value
          }
        }
        return next
      })
      toast.success('Endereço preenchido a partir do CEP.')
    } catch (err) {
      toast.error((err as Error).message || 'Falha ao consultar o CEP.')
    } finally {
      setCepLoading(false)
    }
  }

  const startNew = (client?: Client) => {
    setDraftCampos(client ? { 'Nome Fantasia': client.company || client.name } : {})
    setDraftClientId(client?.id ?? null)
    setDraftVendaLeadId(null)
    setDraftPdfData(null)
    setDraftPdfFilename(null)
    setTab('criar')
  }

  const generate = async () => {
    if (!board || !template) return
    setCreating(true)
    try {
      const conteudo = applyPlaceholders(applyServicesTable(template.conteudo, draftCampos), draftCampos)
      const created = await contractsService.createContract(board.id, template.id, draftCampos, conteudo, draftClientId, draftVendaLeadId)
      // Sai de "Boas-vindas" só agora que o contrato existe de verdade — não no clique de
      // "avançar" (senão, se a pessoa fechasse o formulário sem gerar, o cliente ficava perdido,
      // sem contrato e sem aparecer em lugar nenhum). Também é o que libera o "Marcar como
      // assinado" a avançar pra Briefing depois (aquele fluxo espera stage === 'contract').
      if (draftClientId) {
        const client = clients.find((cl) => cl.id === draftClientId)
        if (client && client.stage !== 'contract') {
          db.updateClient(draftClientId, { stage: 'contract' })
          db.addLog(draftClientId, 'Etapa alterada', `${STAGE_COLORS[client.stage].label} → ${STAGE_COLORS.contract.label}`)
        }
      }
      setDraftCampos({})
      setDraftClientId(null)
      setDraftVendaLeadId(null)
      setTab('pendentes-contrato')
      setSelectedId(created.id)
      toast.success('Contrato gerado.')
    } finally {
      setCreating(false)
    }
  }

  // Fluxo atual: o contrato é gerado por fora e só anexado aqui em PDF — sem geração automática a
  // partir de modelo/campos (ver generate() acima, mantida pra quando isso voltar a ficar completo).
  const registerContract = async () => {
    if (!board) return
    setCreating(true)
    try {
      const created = await contractsService.createContract(
        board.id, null, draftCampos, '', draftClientId, draftVendaLeadId, draftPdfData, draftPdfFilename,
      )
      // Mesmo gatilho de etapa que generate() já fazia — ver comentário ali.
      if (draftClientId) {
        const client = clients.find((cl) => cl.id === draftClientId)
        if (client && client.stage !== 'contract') {
          db.updateClient(draftClientId, { stage: 'contract' })
          db.addLog(draftClientId, 'Etapa alterada', `${STAGE_COLORS[client.stage].label} → ${STAGE_COLORS.contract.label}`)
        }
      }
      setDraftCampos({})
      setDraftClientId(null)
      setDraftVendaLeadId(null)
      setDraftPdfData(null)
      setDraftPdfFilename(null)
      setTab('pendentes-contrato')
      setSelectedId(created.id)
      toast.success('Contrato registrado.')
    } finally {
      setCreating(false)
    }
  }

  const regenerate = () => {
    if (!selected || !template) return
    if (!window.confirm('Isso reaplica os campos preenchidos no texto do modelo, sobrescrevendo o corpo atual do contrato (inclusive edições manuais). Continuar?')) return
    const conteudo = applyPlaceholders(applyServicesTable(template.conteudo, selected.campos), selected.campos)
    if (bodyRef.current) bodyRef.current.innerHTML = conteudo
    void contractsService.updateContract(selected.id, { conteudo })
  }

  // Enquanto o contrato ainda não foi assinado, mudar um campo já reaplica sozinho no texto —
  // sem isso a pessoa precisava lembrar de clicar em "Reaplicar no texto" toda vez que corrigia
  // algo (ex.: número de telas errado), e o contrato ficava mostrando um valor antigo até alguém
  // notar. Depois de assinado, o texto já foi pro cliente/Autentique — aí só o campo muda, o corpo
  // fica intocado (evita reescrever um documento que já pode ter sido baixado/assinado).
  const applyFieldsToContract = (contract: Contract, nextCampos: Record<string, string>) => {
    if (!template || contract.status === 'assinado') {
      void contractsService.updateContract(contract.id, { campos: nextCampos })
      return
    }
    const conteudo = applyPlaceholders(applyServicesTable(template.conteudo, nextCampos), nextCampos)
    if (editingBody && bodyRef.current && selected?.id === contract.id) bodyRef.current.innerHTML = conteudo
    void contractsService.updateContract(contract.id, { campos: nextCampos, conteudo })
  }

  // Só o campo "Nome Fantasia" (identificação na lista) fica editável aqui agora — sem geração
  // automática de texto, não precisa passar por applyFieldsToContract (mantida acima pra quando o
  // fluxo completo de modelo voltar).
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
      applyFieldsToContract(selected, next)
      toast.success(selected.status === 'assinado' ? 'Dados do CNPJ preenchidos.' : 'Dados do CNPJ preenchidos e aplicados no contrato.')
    } catch (err) {
      toast.error((err as Error).message || 'Falha ao consultar o CNPJ.')
    } finally {
      setCnpjLoading(false)
    }
  }

  const fillSelectedFromCep = async () => {
    if (!selected) return
    const raw = selected.campos['CEP'] ?? ''
    if (!isValidCepLength(raw)) { toast.error('Digite um CEP com 8 dígitos.'); return }
    setCepLoading(true)
    try {
      const data = await lookupCep(raw)
      const next = { ...selected.campos }
      for (const name of placeholders) {
        const key = cepFieldFor(name)
        if (key) {
          const value = data[key as keyof CepData]
          if (value) next[name] = value
        }
      }
      applyFieldsToContract(selected, next)
      toast.success(selected.status === 'assinado' ? 'Endereço preenchido.' : 'Endereço preenchido e aplicado no contrato.')
    } catch (err) {
      toast.error((err as Error).message || 'Falha ao consultar o CEP.')
    } finally {
      setCepLoading(false)
    }
  }

  // O avanço "Contrato -> Briefing" (e a cópia das Atualizações do CRM pra Mensagens registradas)
  // agora acontece no servidor, dentro do próprio PATCH — mesmo caminho usado pelo webhook do
  // Autentique (ver server/src/lib/briefingHandoff.ts), pra não ter duas implementações da mesma
  // regra desencontradas.
  const setContractStatus = (c: Contract, next: ContractStatus) => {
    void contractsService.updateContract(c.id, { status: next })
  }

  const toggleSigned = () => {
    if (!selected) return
    setContractStatus(selected, selected.status === 'assinado' ? 'pendente' : 'assinado')
  }

  const removeContract = (c: Contract) => {
    if (!window.confirm(`Excluir o contrato de "${contractLabel(c)}"?`)) return
    if (selectedId === c.id) setSelectedId(null)
    void contractsService.deleteContract(c.id)
  }

  // Único jeito de chegar na aba "Criar contrato": pela ficha do cliente, seja pelo botão
  // "avançar" em Boas-vindas ou pelo drawer aberto ao clicar no nome — nunca direto (evita gerar
  // contrato solto, sem ficha de cadastro vinculada). O stage só avança pra "contract" quando o
  // contrato é gerado de verdade (ver generate()), não aqui — assim, se a pessoa fechar o
  // formulário sem gerar, o cliente continua normalmente em Boas-vindas.
  const createContractFromDrawer = (client: Client) => {
    setOpenClientId(null)
    startNew(client)
  }

  // Botão de voltar etapa, ao lado do de avançar — "Pendente de contrato" volta pra "Boas-vindas".
  // Em Boas-vindas não tem etapa anterior (PREV_STAGE não tem entrada pra "welcome"), então o botão
  // fica ali mas não faz nada além de avisar, sem risco de mandar o cliente pra um estado inválido.
  const regressStage = (client: Client) => {
    const prev = PREV_STAGE[client.stage]
    if (!prev) { toast.info('Cliente já está na primeira etapa'); return }
    db.updateClient(client.id, { stage: prev })
    db.addLog(client.id, 'Etapa revertida', `${STAGE_COLORS[client.stage].label} → ${STAGE_COLORS[prev].label}`)
    toast.success(`Etapa: ${STAGE_COLORS[prev].label}`)
  }

  const archiveClient = (client: Client) => {
    const label = client.company || client.name
    const ok = window.confirm(
      `Arquivar "${label}"?\n\n` +
        'O cliente sai dessa fila e do pipeline, mas pode ser restaurado ou ' +
        'excluído permanentemente na tela "Arquivados".',
    )
    if (!ok) return
    db.archiveClient(client.id)
    toast.success('Cliente arquivado')
  }

  const currentBodyHtml = () => (editingBody ? bodyRef.current?.innerHTML : undefined) ?? selected?.conteudo ?? ''

  // PDF de verdade, gerado no servidor — sem passar pelo diálogo de impressão do navegador (evita
  // o cabeçalho/rodapé que o Chrome sempre adiciona ali e que nenhuma página consegue desligar).
  const slugify = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')

  const download = async () => {
    if (!selected) return
    setPdfLoading('baixar')
    try {
      const blob = await contractsService.generatePdf(selected.id, currentBodyHtml(), `Contrato — ${contractLabel(selected)}`)
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `contrato-${slugify(contractLabel(selected))}.pdf`
      a.click()
      URL.revokeObjectURL(url)
    } catch (err) {
      toast.error('Falha ao gerar o PDF: ' + (err as Error).message)
    } finally {
      setPdfLoading(null)
    }
  }

  const printContract = () => {
    if (!selected) return
    openContractSheet(currentBodyHtml(), `Contrato — ${contractLabel(selected)}`)
  }

  const viewContractSheet = async () => {
    if (!selected) return
    setPdfLoading('ver')
    try {
      const blob = await contractsService.generatePdf(selected.id, currentBodyHtml(), `Contrato — ${contractLabel(selected)}`)
      const url = URL.createObjectURL(blob)
      window.open(url, '_blank')
    } catch (err) {
      toast.error('Falha ao gerar o PDF: ' + (err as Error).message)
    } finally {
      setPdfLoading(null)
    }
  }

  const saveNow = () => {
    if (!selected) return
    const html = editingBody ? bodyRef.current?.innerHTML ?? selected.conteudo : selected.conteudo
    void contractsService.updateContract(selected.id, { conteudo: html })
    toast.success('Contrato salvo.')
  }

  if (!board) {
    return (
      <>
        <TopBar title="Contrato" subtitle="Comercial" />
        <div className="mx-auto mt-10 max-w-md rounded-2xl bg-card p-6 text-center shadow-sm">
          <FileText className="mx-auto h-8 w-8 text-foreground/30" />
          <p className="mt-3 text-sm font-medium text-foreground">Nenhum quadro nesta aba</p>
        </div>
      </>
    )
  }

  return (
    <>
      <TopBar
        title="Contrato"
        subtitle={`${contracts.length} contrato(s) registrado(s)`}
      />

      <div className="px-1 pb-8">
        {!loaded ? (
          <div className="grid min-h-[30vh] place-items-center text-sm text-foreground/50">
            <span className="inline-flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin" />Carregando…</span>
          </div>
        ) : (
          <>
            <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
              <StageTabCard
                active={tab === 'boas-vindas'}
                onClick={() => changeTab('boas-vindas')}
                icon={<UserRound className="h-4 w-4" />}
                label="Boas-vindas"
                description="Ficha preenchida, falta gerar o contrato"
                count={boasVindasClients.length}
                tone="info"
              />
              <StageTabCard
                active={tab === 'pendentes-contrato'}
                onClick={() => changeTab('pendentes-contrato')}
                icon={<Clock className="h-4 w-4" />}
                label="Pendente de assinatura"
                description="Contrato gerado, aguardando o cliente assinar"
                count={pendingContracts.length}
                tone="warning"
              />
              <StageTabCard
                active={tab === 'assinados'}
                onClick={() => changeTab('assinados')}
                icon={<CheckCircle2 className="h-4 w-4" />}
                label="Contratos assinados"
                description="Cliente já devolveu assinado"
                count={signedContracts.length}
                tone="success"
              />
            </div>

            {tab === 'boas-vindas' && (
              <>
                <MonthFilterBar filter={boasVindasFilter} />
                <PendingClientsList clients={boasVindasInRange} onOpen={(c) => setOpenClientId(c.id)} onArchive={canDelete ? archiveClient : undefined} onAdvance={createContractFromDrawer} onRegress={regressStage} emptyText="Nenhum cliente em Boas-vindas nesse período." />
              </>
            )}

            {tab === 'criar' && (
              <div className="rounded-2xl bg-card p-4 shadow-sm">
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                  <span className="text-sm font-semibold text-foreground">Novo contrato</span>
                  {draftClientId && (
                    <span className="inline-flex items-center gap-1.5 rounded-full bg-accent/10 px-2.5 py-1 text-[11px] font-medium text-accent">
                      Vinculado a uma ficha de cadastro
                      <button type="button" onClick={() => setDraftClientId(null)} title="Desvincular">
                        <X className="h-3 w-3" />
                      </button>
                    </span>
                  )}
                </div>
                <LeadLinkPanel clientId={draftClientId} vendaLeadId={draftVendaLeadId} onLink={setDraftVendaLeadId} />
                <div className="mb-4">
                  <label className="mb-1 block text-[11px] font-medium text-foreground/50">
                    Nome (identificação do contrato)
                  </label>
                  <input
                    value={draftCampos['Nome Fantasia'] ?? ''}
                    onChange={(e) => setDraftCampos((prev) => ({ ...prev, 'Nome Fantasia': e.target.value }))}
                    placeholder="Ex.: Empresa Cliente Ltda"
                    className="h-9 w-full rounded-lg border border-line px-3 text-sm text-foreground/70 outline-none focus:border-accent"
                  />
                </div>
                <ContractPdfField
                  data={draftPdfData}
                  filename={draftPdfFilename}
                  onChange={(data, filename) => { setDraftPdfData(data); setDraftPdfFilename(filename) }}
                />
                <div className="mt-4 flex justify-end gap-2">
                  <Button variant="ghost" onClick={() => changeTab('boas-vindas')}>Cancelar</Button>
                  <Button onClick={registerContract} loading={creating} disabled={!draftPdfData}>
                    Registrar contrato
                  </Button>
                </div>
              </div>
            )}

            {(tab === 'pendentes-contrato' || tab === 'assinados') && (
              <>
                <MonthFilterBar filter={tab === 'assinados' ? signedFilter : pendingFilter} />
                <ContractsList
                  contracts={listForTab}
                  showSignedAt={tab === 'assinados'}
                  onOpen={(c) => setSelectedId(c.id)}
                  onAdvance={tab === 'pendentes-contrato' ? (c) => setContractStatus(c, 'assinado') : undefined}
                  onArchive={removeContract}
                  emptyText={tab === 'assinados' ? 'Nenhum contrato assinado nesse período.' : 'Nenhum contrato pendente de assinatura nesse período.'}
                />
              </>
            )}
          </>
        )}
      </div>

      <EditTemplateModal open={editTemplateOpen} onClose={() => setEditTemplateOpen(false)} template={template} />

      <ClientDrawer
        clientId={openClientId}
        onClose={() => setOpenClientId(null)}
        extraHeaderAction={
          openClient && openClient.fichaCadastro && !contractedClientIds.has(openClient.id) ? (
            <Button size="sm" onClick={() => createContractFromDrawer(openClient)} leftIcon={<Plus className="h-3.5 w-3.5" />}>
              Criar contrato
            </Button>
          ) : undefined
        }
      />

      <Modal
        open={detailOpen}
        onClose={() => setSelectedId(null)}
        title={selected ? contractLabel(selected) : ''}
        size="xl"
      >
        {selected && (
          <div className="space-y-4">
            <div className="rounded-2xl bg-elevate/[0.03] p-4">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <span className="text-sm font-semibold text-foreground">Dados do contrato</span>
                <div className="flex items-center gap-2">
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => selected.clientId && setOpenClientId(selected.clientId)}
                    disabled={!selected.clientId}
                    title={selected.clientId ? undefined : 'Este contrato não veio de uma ficha de cadastro (foi criado avulso)'}
                    leftIcon={<ClipboardList className="h-3.5 w-3.5" />}
                  >
                    Ver ficha de cadastro
                  </Button>
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
              <AutentiqueField
                contractId={selected.id}
                value={selected.autentiqueDocumentId}
                signed={selected.status === 'assinado'}
              />
              <LeadLinkPanel
                clientId={selected.clientId}
                vendaLeadId={selected.vendaLeadId}
                onLink={(id) => void contractsService.updateContract(selected.id, { vendaLeadId: id })}
              />
              <div>
                <label className="mb-1 block text-[11px] font-medium text-foreground/50">
                  Nome (identificação do contrato)
                </label>
                <input
                  value={selected.campos['Nome Fantasia'] ?? ''}
                  onChange={(e) => saveField(selected, 'Nome Fantasia', e.target.value)}
                  placeholder="Ex.: Empresa Cliente Ltda"
                  className="h-9 w-full rounded-lg border border-line px-3 text-sm text-foreground/70 outline-none focus:border-accent"
                />
              </div>
            </div>

            <div className="rounded-2xl bg-elevate/[0.03] p-4">
              <span className="mb-3 block text-sm font-semibold text-foreground">Contrato (PDF)</span>
              <ContractPdfField
                data={selected.pdfData}
                filename={selected.pdfFilename}
                onChange={(data, filename) => void contractsService.updateContract(selected.id, { pdfData: data, pdfFilename: filename })}
              />
            </div>
          </div>
        )}
      </Modal>
    </>
  )
}

/** Mesmo layout de tabela de Boas-vindas/Pendente de contrato (PendingClientsList) — clicar na
 * linha abre o detalhe do contrato num modal. */
function ContractsList({
  contracts,
  showSignedAt,
  onOpen,
  onAdvance,
  onArchive,
  emptyText,
}: {
  contracts: Contract[]
  showSignedAt: boolean
  onOpen: (contract: Contract) => void
  onAdvance?: (contract: Contract) => void
  onArchive: (contract: Contract) => void
  emptyText: string
}) {
  return (
    <div className="overflow-hidden rounded-2xl bg-card shadow-sm">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[560px]">
          <thead>
            <tr className="border-b border-line text-left text-xs font-semibold uppercase tracking-wide text-foreground/50">
              <th className="px-4 py-3">Empresa</th>
              <th className="w-40 px-4 py-3">CNPJ</th>
              <th className="w-32 px-4 py-3">Criado em</th>
              {showSignedAt && <th className="w-32 px-4 py-3">Assinado em</th>}
              <th className="w-24 px-2 py-3" />
            </tr>
          </thead>
          <tbody>
            {contracts.length === 0 && (
              <tr>
                <td colSpan={showSignedAt ? 5 : 4} className="px-4 py-10 text-center text-sm text-foreground/40">
                  {emptyText}
                </td>
              </tr>
            )}
            {contracts.map((c) => (
              <tr
                key={c.id}
                onClick={() => onOpen(c)}
                className="cursor-pointer border-b border-line/60 last:border-0 hover:bg-elevate/[0.04]"
              >
                <td className="px-4 py-3 text-sm font-medium text-accent">
                  <div className="flex items-center gap-2.5">
                    <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-accent/10 text-[11px] font-semibold text-accent">
                      {initials(contractLabel(c))}
                    </span>
                    {contractLabel(c)}
                  </div>
                </td>
                <td className="px-4 py-3 text-sm text-foreground/70">{c.campos['CNPJ'] || '—'}</td>
                <td className="whitespace-nowrap px-4 py-3 text-sm text-foreground/70">{formatDateShort(c.createdAt)}</td>
                {showSignedAt && (
                  <td className="whitespace-nowrap px-4 py-3 text-sm text-foreground/70">
                    {c.signedAt ? formatDateShort(c.signedAt) : '—'}
                  </td>
                )}
                <td className="px-2 py-3">
                  <div className="flex items-center justify-end gap-1.5">
                    {onAdvance && (
                      <button
                        type="button"
                        title="Marcar como assinado"
                        onClick={(e) => { e.stopPropagation(); onAdvance(c) }}
                        className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-success/10 text-success transition-colors hover:bg-success/20 lg:h-8 lg:w-8"
                      >
                        <ArrowRight className="h-3.5 w-3.5" />
                      </button>
                    )}
                    <button
                      type="button"
                      title="Excluir contrato"
                      onClick={(e) => { e.stopPropagation(); onArchive(c) }}
                      className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-danger/10 text-danger transition-colors hover:bg-danger/20 lg:h-8 lg:w-8"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function contractLabel(c: Contract): string {
  return c.campos['Nome Fantasia'] || c.campos['Razão Social'] || c.campos['CNPJ'] || 'Sem nome'
}

/** Card grande e colorido por estágio — dobra como seletor de aba E resumo (bate o olho no que
 * tem de cada coisa sem precisar entrar em nenhuma). Cor por estágio: Boas-vindas (info) ainda
 * não tem contrato, Pendente (warning) já foi gerado mas falta o cliente assinar, Assinados
 * (success) já fechou. */
function StageTabCard({
  active,
  onClick,
  icon,
  label,
  description,
  count,
  tone,
}: {
  active: boolean
  onClick: () => void
  icon: React.ReactNode
  label: string
  description: string
  count: number
  tone: 'info' | 'warning' | 'success'
}) {
  const tones = {
    info: 'bg-accent/10 text-accent ring-accent/20',
    warning: 'bg-warning/10 text-warning ring-warning/20',
    success: 'bg-success/10 text-success ring-success/20',
  }
  const activeRing = {
    info: 'ring-accent/30 border-accent/40',
    warning: 'ring-warning/30 border-warning/40',
    success: 'ring-success/30 border-success/40',
  }
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'rounded-2xl border bg-card p-4 text-left shadow-sm transition-all',
        active ? cn('ring-1', activeRing[tone]) : 'border-line hover:border-elevate/20 hover:shadow-md',
      )}
    >
      <div className="flex items-center justify-between">
        <span className={cn('grid h-8 w-8 place-items-center rounded-lg ring-1', tones[tone])}>{icon}</span>
        <span className="text-2xl font-semibold tracking-tight tabular-nums text-foreground">{count}</span>
      </div>
      <p className="mt-2.5 text-sm font-semibold text-foreground">{label}</p>
      <p className="text-[11px] text-foreground/45">{description}</p>
    </button>
  )
}


/** Clientes que preencheram a ficha de cadastro pública (app/ficha) e ainda não têm nenhum
 * contrato gerado — fila de "falta fazer o contrato". Clicar no nome abre a ficha completa do
 * cliente (mesmo drawer usado em Clientes/Pipeline); "Criar contrato" só existe lá dentro — não dá
 * pra gerar um contrato sem antes ver a ficha. */
function PendingClientsList({
  clients,
  onOpen,
  onArchive,
  onAdvance,
  onRegress,
  emptyText = 'Nenhuma ficha pendente de contrato — tudo em dia.',
}: {
  clients: Client[]
  onOpen: (client: Client) => void
  onArchive?: (client: Client) => void
  onAdvance?: (client: Client) => void
  onRegress?: (client: Client) => void
  emptyText?: string
}) {
  return (
    <div className="overflow-hidden rounded-2xl bg-card shadow-sm">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[560px]">
          <thead>
            <tr className="border-b border-line text-left text-xs font-semibold uppercase tracking-wide text-foreground/50">
              <th className="px-4 py-3">Empresa</th>
              <th className="w-40 px-4 py-3">CNPJ</th>
              <th className="w-32 px-4 py-3">Entrada</th>
              <th className="w-24 px-4 py-3">Na etapa</th>
              <th className="w-24 px-2 py-3" />
            </tr>
          </thead>
          <tbody>
            {clients.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-10 text-center text-sm text-foreground/40">
                  {emptyText}
                </td>
              </tr>
            )}
            {clients.map((c) => (
              <tr
                key={c.id}
                onClick={() => onOpen(c)}
                className="cursor-pointer border-b border-line/60 last:border-0 hover:bg-elevate/[0.04]"
              >
                <td className="px-4 py-3 text-sm font-medium text-accent">
                  <div className="flex items-center gap-2.5">
                    <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-accent/10 text-[11px] font-semibold text-accent">
                      {initials(c.company || c.name)}
                    </span>
                    {c.company || c.name}
                  </div>
                </td>
                <td className="px-4 py-3 text-sm text-foreground/70">{c.fichaCadastro?.cnpj ? formatCnpj(c.fichaCadastro.cnpj) : '—'}</td>
                <td className="whitespace-nowrap px-4 py-3 text-sm text-foreground/70">{formatDateShort(c.createdAt)}</td>
                <td className="px-4 py-3 text-sm"><StageAgeBadge stage={c.stage} since={c.stageUpdatedAt ?? c.createdAt} /></td>
                <td className="px-2 py-3">
                  <div className="flex items-center justify-end gap-1.5">
                    {onRegress && (
                      <button
                        type="button"
                        title="Voltar etapa"
                        onClick={(e) => { e.stopPropagation(); onRegress(c) }}
                        className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-elevate/[0.08] text-foreground/50 transition-colors hover:bg-elevate/[0.14] hover:text-foreground lg:h-8 lg:w-8"
                      >
                        <ArrowLeft className="h-3.5 w-3.5" />
                      </button>
                    )}
                    {onAdvance && (
                      <button
                        type="button"
                        title="Avançar etapa"
                        onClick={(e) => { e.stopPropagation(); onAdvance(c) }}
                        className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-success/10 text-success transition-colors hover:bg-success/20 lg:h-8 lg:w-8"
                      >
                        <ArrowRight className="h-3.5 w-3.5" />
                      </button>
                    )}
                    {onArchive && (
                      <button
                        type="button"
                        title="Arquivar cliente"
                        onClick={(e) => { e.stopPropagation(); onArchive(c) }}
                        className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-danger/10 text-danger transition-colors hover:bg-danger/20 lg:h-8 lg:w-8"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

/** Agrupa os placeholders detectados no modelo em seções numeradas (Dados do contratante,
 * Serviços, Valores, Vigência, e "Outros campos" pra qualquer coisa nova adicionada direto no
 * modelo). CNPJ e CEP ganham busca automática; "Tabela de Serviços" vira uma lista repetível em
 * vez de um campo de texto único. */
function FieldForm({
  placeholders,
  campos,
  onChange,
  onCnpjBlur,
  cnpjLoading,
  onCepBlur,
  cepLoading,
}: {
  placeholders: string[]
  campos: Record<string, string>
  onChange: (name: string, value: string) => void
  onCnpjBlur: () => void
  cnpjLoading: boolean
  onCepBlur: () => void
  cepLoading: boolean
}) {
  if (placeholders.length === 0) {
    return <p className="text-xs text-foreground/40">O modelo não tem nenhum campo "&lt;&lt;...&gt;&gt;" pra preencher.</p>
  }

  const bySection = new Map<PlaceholderSection, string[]>()
  for (const name of placeholders) {
    const section = sectionFor(name)
    const list = bySection.get(section) ?? []
    list.push(name)
    bySection.set(section, list)
  }
  const activeSections = SECTION_ORDER.filter((s) => bySection.has(s))

  return (
    <div className="space-y-3">
      {activeSections.map((section, i) => (
        <FieldSection
          key={section}
          number={i + 1}
          label={SECTION_LABELS[section]}
          names={bySection.get(section)!}
          campos={campos}
          onChange={onChange}
          onCnpjBlur={onCnpjBlur}
          cnpjLoading={cnpjLoading}
          onCepBlur={onCepBlur}
          cepLoading={cepLoading}
        />
      ))}
    </div>
  )
}

function FieldSection({
  number,
  label,
  names,
  campos,
  onChange,
  onCnpjBlur,
  cnpjLoading,
  onCepBlur,
  cepLoading,
}: {
  number: number
  label: string
  names: string[]
  campos: Record<string, string>
  onChange: (name: string, value: string) => void
  onCnpjBlur: () => void
  cnpjLoading: boolean
  onCepBlur: () => void
  cepLoading: boolean
}) {
  const [open, setOpen] = React.useState(true)
  return (
    <div className="overflow-hidden rounded-xl border border-line/60">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-2 bg-elevate/[0.02] px-3 py-2.5 text-left text-xs font-semibold text-foreground"
      >
        <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-accent/10 text-[10px] text-accent">{number}</span>
        {label}
        <ChevronDown className={cn('ml-auto h-3.5 w-3.5 shrink-0 text-foreground/40 transition-transform', !open && '-rotate-90')} />
      </button>
      {open && (
        <div className="grid grid-cols-1 gap-3 border-t border-line/60 p-3 sm:grid-cols-2">
          {names.map((name) => {
            if (name === 'Tabela de Serviços') {
              return (
                <div key={name} className="sm:col-span-2">
                  <ServicesTableField value={campos[name] ?? ''} onChange={(v) => onChange(name, v)} />
                </div>
              )
            }
            const isCnpj = name.trim().toLowerCase() === 'cnpj'
            const isCep = name.trim().toLowerCase() === 'cep'
            const hint = hintFor(name)
            return (
              <FieldInput
                key={name}
                name={name}
                value={campos[name] ?? ''}
                onChange={onChange}
                isCnpj={isCnpj}
                isCep={isCep}
                hint={hint}
                onCnpjBlur={onCnpjBlur}
                cnpjLoading={cnpjLoading}
                onCepBlur={onCepBlur}
                cepLoading={cepLoading}
              />
            )
          })}
        </div>
      )}
    </div>
  )
}

/** Campo de texto do formulário lateral — estado local + debounce antes de salvar. Sem isso, cada
 * tecla disparava um PATCH pro servidor E recarregava a lista inteira de contratos ANTES do campo
 * sequer atualizar visualmente (o input era 100% controlado por `campos[name]`, vindo do estado
 * reativo) — digitar qualquer nome ficava visivelmente travado. Mesmo padrão do ObservacoesCell
 * da aba Vendas. */
function FieldInput({
  name,
  value,
  onChange,
  isCnpj,
  isCep,
  hint,
  onCnpjBlur,
  cnpjLoading,
  onCepBlur,
  cepLoading,
}: {
  name: string
  value: string
  onChange: (name: string, value: string) => void
  isCnpj: boolean
  isCep: boolean
  hint?: string
  onCnpjBlur: () => void
  cnpjLoading: boolean
  onCepBlur: () => void
  cepLoading: boolean
}) {
  const [local, setLocal] = React.useState(value)
  const focusedRef = React.useRef(false)
  const debouncedSave = useDebouncedCallback((next: string) => onChange(name, next), 500)

  React.useEffect(() => {
    if (!focusedRef.current) setLocal(value)
  }, [value])

  return (
    <div className={isCnpj ? 'sm:col-span-2' : undefined}>
      <label className="mb-1 block text-[11px] font-medium text-foreground/50">{name}</label>
      <div className="flex items-center gap-1.5">
        <input
          value={local}
          onFocus={() => { focusedRef.current = true }}
          onChange={(e) => {
            const next = isCnpj ? formatCnpj(e.target.value) : isCep ? formatCep(e.target.value) : e.target.value
            setLocal(next)
            debouncedSave(next)
          }}
          onBlur={() => {
            focusedRef.current = false
            if (local !== value) onChange(name, local)
            if (isCnpj) onCnpjBlur()
            if (isCep) onCepBlur()
          }}
          placeholder={isCnpj ? '00.000.000/0000-00' : isCep ? '00000-000' : undefined}
          className="h-9 w-full rounded-lg border border-line px-3 text-sm text-foreground/70 outline-none focus:border-accent"
        />
        {(isCnpj || isCep) && (
          <button
            type="button"
            onClick={isCnpj ? onCnpjBlur : onCepBlur}
            title="Buscar"
            className="grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-line text-foreground/40 transition-colors hover:bg-elevate/[0.04] hover:text-foreground"
          >
            {(isCnpj ? cnpjLoading : cepLoading) ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
          </button>
        )}
      </div>
      {hint && <p className="mt-1 text-[10px] text-foreground/40">{hint}</p>}
    </div>
  )
}

const MAX_PDF_BYTES = 15 * 1024 * 1024

/** Anexa o contrato pronto (gerado por fora) em PDF — arrasta ou clica pra escolher. Fica salvo
 * como data URL (mesmo padrão dos anexos de Atualizações do lead), sem geração/edição de texto
 * aqui — só anexar, ver/baixar e trocar. */
function ContractPdfField({
  data,
  filename,
  onChange,
}: {
  data: string | null
  filename: string | null
  onChange: (data: string | null, filename: string | null) => void
}) {
  const inputRef = React.useRef<HTMLInputElement>(null)
  const [dragOver, setDragOver] = React.useState(false)
  const [loading, setLoading] = React.useState(false)

  const handleFile = async (file: File) => {
    const isPdf = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')
    if (!isPdf) {
      toast.error('Só é possível anexar arquivos PDF.')
      return
    }
    if (file.size > MAX_PDF_BYTES) {
      toast.error(`"${file.name}" passa de ${Math.round(MAX_PDF_BYTES / 1024 / 1024)}MB.`)
      return
    }
    setLoading(true)
    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => resolve(reader.result as string)
        reader.onerror = reject
        reader.readAsDataURL(file)
      })
      onChange(dataUrl, file.name)
      toast.success('Contrato anexado.')
    } catch {
      toast.error('Falha ao ler o arquivo — tenta de novo.')
    } finally {
      setLoading(false)
    }
  }

  const pickFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (file) void handleFile(file)
  }

  const download = () => {
    if (!data) return
    const a = document.createElement('a')
    a.href = data
    a.download = filename || 'contrato.pdf'
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
  }

  if (data) {
    return (
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line/60 bg-card p-4">
        <div className="flex min-w-0 items-center gap-2.5">
          <FileText className="h-5 w-5 shrink-0 text-accent" />
          <span className="min-w-0 truncate text-sm font-medium text-foreground">
            {filename || 'contrato.pdf'}
          </span>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button size="sm" variant="secondary" onClick={download} leftIcon={<Download className="h-3.5 w-3.5" />}>
            Baixar
          </Button>
          <Button size="sm" variant="secondary" onClick={() => window.open(data, '_blank')} leftIcon={<Eye className="h-3.5 w-3.5" />}>
            Ver
          </Button>
          <Button size="sm" variant="ghost" loading={loading} onClick={() => inputRef.current?.click()}>
            Trocar
          </Button>
          <button
            type="button"
            onClick={() => onChange(null, null)}
            title="Remover contrato anexado"
            className="rounded-md p-2.5 text-foreground/40 hover:bg-danger/10 hover:text-danger lg:p-1.5"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
        <input ref={inputRef} type="file" accept="application/pdf" className="hidden" onChange={pickFile} />
      </div>
    )
  }

  return (
    <div
      onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        e.preventDefault()
        setDragOver(false)
        const file = e.dataTransfer.files?.[0]
        if (file) void handleFile(file)
      }}
      onClick={() => inputRef.current?.click()}
      className={cn(
        'flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed p-8 text-center transition-colors',
        dragOver ? 'border-accent bg-accent/5' : 'border-line hover:border-accent/40 hover:bg-elevate/[0.02]',
      )}
    >
      {loading ? (
        <Loader2 className="h-6 w-6 animate-spin text-foreground/40" />
      ) : (
        <FileText className="h-6 w-6 text-foreground/30" />
      )}
      <p className="text-sm font-medium text-foreground/70">
        Arraste o PDF do contrato aqui, ou clique pra escolher
      </p>
      <p className="text-xs text-foreground/40">Gere o contrato por fora e anexe o arquivo pronto aqui.</p>
      <input ref={inputRef} type="file" accept="application/pdf" className="hidden" onChange={pickFile} />
    </div>
  )
}

/** Vínculo com o documento no Autentique — o contrato é gerado aqui, mas enviado pra assinatura
 * lá fora (a pessoa sobe o PDF manualmente, não existe criação via API). Colar o ID (ou o link)
 * do documento aqui é o que liga o webhook de "documento assinado" de volta a este contrato, pra
 * marcar como assinado e avançar o cliente pra Briefing sozinho (ver server/src/routes/webhooks.ts). */
function AutentiqueField({
  contractId,
  value,
  signed,
}: {
  contractId: string
  value: string | null
  signed: boolean
}) {
  const [local, setLocal] = React.useState(value ?? '')
  const focusedRef = React.useRef(false)
  const debouncedSave = useDebouncedCallback((next: string) => {
    void contractsService.updateContract(contractId, { autentiqueDocumentId: next.trim() || null })
  }, 500)

  React.useEffect(() => {
    if (!focusedRef.current) setLocal(value ?? '')
  }, [value])

  // Aceita colar o link inteiro do documento (ex.: .../documentos/<id>) em vez do ID puro.
  const extractId = (raw: string) => {
    const trimmed = raw.trim()
    const match = trimmed.match(/documentos?\/([a-zA-Z0-9-]+)/)
    return match ? match[1] : trimmed
  }

  return (
    <div className="mb-4 rounded-xl border border-line/60 p-3">
      <label className="mb-1 block text-[11px] font-medium text-foreground/50">ID do documento no Autentique</label>
      <input
        value={local}
        onFocus={() => { focusedRef.current = true }}
        onChange={(e) => {
          // Extrai NA HORA (não só no blur) — colar um link inteiro e fechar o modal antes de
          // desfocar o campo salvava a URL crua (com "https://.../documentos/"), o que nunca bate
          // com o ID que o Autentique manda no webhook — o contrato ficava "vinculado" mas o
          // "documento assinado" nunca era reconhecido, exigindo marcar manual toda vez.
          const extracted = extractId(e.target.value)
          setLocal(extracted)
          debouncedSave(extracted)
        }}
        onBlur={() => { focusedRef.current = false }}
        placeholder="Cole o ID ou o link do documento depois de subir no Autentique"
        className="h-9 w-full rounded-lg border border-line px-3 text-sm text-foreground/70 outline-none focus:border-accent"
      />
      <p className="mt-1 text-[10px] text-foreground/40">
        {value
          ? signed
            ? '✓ Vinculado — assinatura detectada automaticamente pelo Autentique.'
            : '✓ Vinculado — quando todo mundo assinar lá, esse contrato marca como assinado sozinho aqui.'
          : 'Sem isso, "Marcar como assinado" continua manual — cole aqui pra automatizar.'}
      </p>
    </div>
  )
}

/** "Serviços contratados" (Cláusula 2ª) — lista de código+descrição que a pessoa monta na mão,
 * em vez de um campo de texto único. Guardada como JSON no próprio campo (ver
 * lib/contractPlaceholders.ts, parseServiceRows/applyServicesTable). */
function ServicesTableField({ value, onChange }: { value: string; onChange: (next: string) => void }) {
  const rows = parseServiceRows(value)
  const update = (next: ServiceRow[]) => onChange(JSON.stringify(next))

  return (
    <div>
      <label className="mb-1 block text-[11px] font-medium text-foreground/50">Tabela de serviços (Cláusula 2ª)</label>
      <div className="space-y-1.5">
        {rows.map((row, i) => (
          <div key={i} className="flex items-center gap-1.5">
            <input
              value={row.codigo}
              onChange={(e) => update(rows.map((r, j) => (j === i ? { ...r, codigo: e.target.value } : r)))}
              placeholder="01"
              className="h-9 w-14 shrink-0 rounded-lg border border-line px-2 text-center text-sm text-foreground/70 outline-none focus:border-accent"
            />
            <input
              value={row.nome}
              onChange={(e) => update(rows.map((r, j) => (j === i ? { ...r, nome: e.target.value } : r)))}
              placeholder="Ex.: PLATAFORMA NX"
              className="h-9 flex-1 rounded-lg border border-line px-3 text-sm text-foreground/70 outline-none focus:border-accent"
            />
            <button
              type="button"
              onClick={() => update(rows.filter((_, j) => j !== i))}
              title="Remover serviço"
              className="grid h-9 w-9 shrink-0 place-items-center rounded-lg text-foreground/40 transition-colors hover:bg-danger/10 hover:text-danger"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        ))}
        <button
          type="button"
          onClick={() => update([...rows, { codigo: String(rows.length + 1).padStart(2, '0'), nome: '' }])}
          className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-line py-2 text-xs font-medium text-foreground/50 transition-colors hover:bg-elevate/[0.04]"
        >
          <Plus className="h-3.5 w-3.5" /> Adicionar serviço
        </button>
      </div>
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
      <RichTextToolbar targetRef={bodyRef} className="mx-auto mb-2 max-w-[800px]" />
      <div
        ref={bodyRef}
        contentEditable
        suppressContentEditableWarning
        className="mx-auto max-h-[55vh] max-w-[800px] overflow-y-auto rounded-lg border border-line bg-card p-8 text-[12pt] leading-relaxed outline-none focus:ring-1 focus:ring-accent/30"
        style={{ fontFamily: 'Arial, Helvetica, sans-serif', color: '#000000' }}
      />
    </Modal>
  )
}
