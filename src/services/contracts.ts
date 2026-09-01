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
  /** Valor preenchido pra cada placeholder do modelo (chave = nome exato do placeholder). Hoje só
   * usado pra "Nome Fantasia" (identificação do contrato na lista) — geração automática do corpo
   * a partir do modelo ficou desativada, ver pdfData abaixo. */
  campos: Record<string, string>
  conteudo: string
  /** Marcação manual — a pessoa marca quando o cliente devolve assinado. */
  status: ContractStatus
  /** Lead do CRM (card do SDR) vinculada a este contrato — sugerida automaticamente por telefone/
   * nome (ver crmLeadLookup.ts), mas confirmável/trocável à mão em LeadLinkPanel (útil pra
   * contrato avulso, sem lead nenhuma no funil, ou quando a sugestão erra). null = sem vínculo. */
  vendaLeadId: string | null
  /** Cliente que preencheu a ficha de cadastro pública, quando o contrato nasceu da fila
   * "Pendente de contrato" — null se foi criado direto (contrato avulso). */
  clientId: string | null
  /** Data em que foi marcado como assinado — null se nunca assinado ou desmarcado depois. */
  signedAt: string | null
  /** ID do documento no Autentique — colado à mão depois de subir o PDF lá pra assinatura. Quando
   * preenchido, o webhook de "documento assinado" marca esse contrato sozinho quando o Autentique
   * avisar (ver server/src/routes/webhooks.ts). null = ainda não vinculado, ou nunca foi mandado
   * pro Autentique. */
  autentiqueDocumentId: string | null
  /** Contrato pronto (gerado por fora) anexado aqui — data URL em base64. null = nada anexado
   * ainda. Campo pesado: a listagem (GET /api/contracts) não traz isso, só o detalhe de UM
   * contrato (GET /api/contracts/:id) — ver loadFullContract. */
  pdfData: string | null
  pdfFilename: string | null
  createdAt: string
  updatedAt: string
}

type TemplateRow = { id: string; name: string; conteudo: string; created_at: string; updated_at: string }
type ContractRow = {
  id: string; board_id: string; template_id: string | null; campos: Record<string, string>
  conteudo: string; status: ContractStatus; venda_lead_id: string | null; client_id: string | null
  signed_at: string | null; autentique_document_id: string | null
  pdf_data?: string | null; pdf_filename: string | null
  created_at: string; updated_at: string
}

function rowToTemplate(r: TemplateRow): ContractTemplate {
  return { id: r.id, name: r.name, conteudo: r.conteudo, createdAt: r.created_at, updatedAt: r.updated_at }
}
// `prevPdfData` é o valor já em cache (se algum) — usado quando a linha vem da LISTAGEM, que
// nunca traz pdf_data (chave ausente, não null): sem isso, todo reload() apagava da tela o PDF
// de um contrato que já tinha sido aberto/carregado por completo.
function rowToContract(r: ContractRow, prevPdfData?: string | null): Contract {
  return {
    id: r.id, boardId: r.board_id, templateId: r.template_id, campos: r.campos ?? {},
    conteudo: r.conteudo, status: r.status ?? 'pendente', vendaLeadId: r.venda_lead_id ?? null,
    clientId: r.client_id ?? null, signedAt: r.signed_at ?? null,
    autentiqueDocumentId: r.autentique_document_id ?? null,
    pdfData: 'pdf_data' in r ? (r.pdf_data ?? null) : (prevPdfData ?? null),
    pdfFilename: r.pdf_filename ?? null,
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
    const prevById = new Map(contracts.map((c) => [c.id, c]))
    contracts = contractRows.map((r) => rowToContract(r, prevById.get(r.id)?.pdfData))
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

  /** Registro completo (com pdfData) de UM contrato — chamado ao abrir o detalhe, já que a
   * listagem vem sem esse campo pesado (ver rowToContract). */
  async loadFullContract(id: string): Promise<void> {
    try {
      const row = await api.get<ContractRow>(`/api/contracts/${id}`)
      const full = rowToContract(row)
      const idx = contracts.findIndex((c) => c.id === id)
      if (idx === -1) contracts = [full, ...contracts]
      else { const copy = contracts.slice(); copy[idx] = full; contracts = copy }
      notify()
    } catch { /* mantém a versão da cache */ }
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
    vendaLeadId?: string | null,
    pdfData?: string | null,
    pdfFilename?: string | null,
  ): Promise<Contract> {
    const row = await api.post<ContractRow>('/api/contracts', {
      boardId, templateId, campos, conteudo, clientId, vendaLeadId, pdfData, pdfFilename,
    })
    const full = rowToContract(row)
    contracts = [full, ...contracts]
    notify()
    void reload()
    return full
  },

  async updateContract(id: string, patch: {
    campos?: Record<string, string>; conteudo?: string; status?: ContractStatus
    autentiqueDocumentId?: string | null; vendaLeadId?: string | null
    pdfData?: string | null; pdfFilename?: string | null
  }): Promise<void> {
    try {
      const row = await api.patch<ContractRow>(`/api/contracts/${id}`, patch)
      const full = rowToContract(row)
      const idx = contracts.findIndex((c) => c.id === id)
      if (idx !== -1) { const copy = contracts.slice(); copy[idx] = full; contracts = copy; notify() }
      void reload()
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
