import { toast } from 'sonner'
import { api, onSseEvent } from '@/services/api'

export interface ContractTemplate {
  id: string
  name: string
  conteudo: string
  createdAt: string
  updatedAt: string
}

export type ContractStatus = 'pendente' | 'assinado'

export interface Contract {
  id: string
  boardId: string
  templateId: string | null
  /** Valor preenchido pra cada placeholder do modelo (chave = nome exato do placeholder). */
  campos: Record<string, string>
  conteudo: string
  /** Marcação manual — a pessoa marca quando o cliente devolve assinado. */
  status: ContractStatus
  /** Linha de origem no quadro de Vendas — legado, não é mais usado pra alimentar "Pendente de
   * contrato" (isso agora vem de `clientId`), mas fica pra contratos antigos que já tinham. */
  vendaLeadId: string | null
  /** Cliente que preencheu a ficha de cadastro pública, quando o contrato nasceu da fila
   * "Pendente de contrato" — null se foi criado direto (contrato avulso). */
  clientId: string | null
  /** Data em que foi marcado como assinado — null se nunca assinado ou desmarcado depois. */
  signedAt: string | null
  createdAt: string
  updatedAt: string
}

type TemplateRow = { id: string; name: string; conteudo: string; created_at: string; updated_at: string }
type ContractRow = {
  id: string; board_id: string; template_id: string | null; campos: Record<string, string>
  conteudo: string; status: ContractStatus; venda_lead_id: string | null; client_id: string | null
  signed_at: string | null; created_at: string; updated_at: string
}

function rowToTemplate(r: TemplateRow): ContractTemplate {
  return { id: r.id, name: r.name, conteudo: r.conteudo, createdAt: r.created_at, updatedAt: r.updated_at }
}
function rowToContract(r: ContractRow): Contract {
  return {
    id: r.id, boardId: r.board_id, templateId: r.template_id, campos: r.campos ?? {},
    conteudo: r.conteudo, status: r.status ?? 'pendente', vendaLeadId: r.venda_lead_id ?? null,
    clientId: r.client_id ?? null, signedAt: r.signed_at ?? null,
    createdAt: r.created_at, updatedAt: r.updated_at,
  }
}

let templates: ContractTemplate[] = []
let contracts: Contract[] = []
let loaded = false
let loadingPromise: Promise<void> | null = null

const subs = new Set<() => void>()
function notify() { for (const fn of subs) fn() }

let unsubSse: (() => void) | null = null
function ensureRealtime() {
  if (unsubSse) return
  unsubSse = onSseEvent((table) => {
    if (table !== 'contracts' && table !== 'contract_templates') return
    void reload()
  })
}

async function reload(): Promise<void> {
  try {
    const [tplRows, contractRows] = await Promise.all([
      api.get<TemplateRow[]>('/api/contract-templates'),
      api.get<ContractRow[]>('/api/contracts'),
    ])
    templates = tplRows.map(rowToTemplate)
    contracts = contractRows.map(rowToContract)
    loaded = true
    notify()
  } catch (err) {
    toast.error('Falha ao carregar contratos: ' + (err as Error).message)
  }
}

export function isContractsLoaded(): boolean { return loaded }

export const contractsService = {
  subscribe(fn: () => void): () => void { subs.add(fn); return () => { subs.delete(fn) } },

  getTemplates(): ContractTemplate[] { return templates },
  getContracts(): Contract[] { return contracts },

  async ensureLoaded(): Promise<void> {
    ensureRealtime()
    if (loaded) return
    if (loadingPromise) return loadingPromise
    loadingPromise = reload().finally(() => { loadingPromise = null })
    return loadingPromise
  },

  async updateTemplate(id: string, patch: { name?: string; conteudo?: string }): Promise<void> {
    try {
      await api.patch(`/api/contract-templates/${id}`, patch)
      await reload()
    } catch (err) {
      toast.error('Falha ao salvar o modelo: ' + (err as Error).message)
    }
  },

  async createContract(
    boardId: string,
    templateId: string | null,
    campos: Record<string, string>,
    conteudo: string,
    clientId?: string | null,
  ): Promise<Contract> {
    const row = await api.post<ContractRow>('/api/contracts', { boardId, templateId, campos, conteudo, clientId })
    await reload()
    return rowToContract(row)
  },

  async updateContract(id: string, patch: { campos?: Record<string, string>; conteudo?: string; status?: ContractStatus }): Promise<void> {
    try {
      await api.patch(`/api/contracts/${id}`, patch)
      await reload()
    } catch (err) {
      toast.error('Falha ao salvar o contrato: ' + (err as Error).message)
    }
  },

  /** PDF de verdade, renderizado no servidor (Chromium headless) — sem diálogo de impressão do
   * navegador, então sem o cabeçalho/rodapé que ele sempre adiciona. */
  async generatePdf(id: string, html: string, title: string): Promise<Blob> {
    return api.postForBlob(`/api/contracts/${id}/pdf`, { html, title })
  },

  async deleteContract(id: string): Promise<void> {
    try {
      await api.delete(`/api/contracts/${id}`)
      contracts = contracts.filter((c) => c.id !== id)
      notify()
    } catch (err) {
      toast.error('Falha ao excluir o contrato: ' + (err as Error).message)
    }
  },
}
