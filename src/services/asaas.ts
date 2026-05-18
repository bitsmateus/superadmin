import axios, { AxiosError } from 'axios'
import { db } from './db'

const ASAAS_PROXY_PREFIX = '/_proxy/asaas' // configured in vite.config
const ASAAS_PROXY_SANDBOX_PREFIX = '/_proxy/asaas-sandbox'

export const ASAAS_PRODUCTION_URL = 'https://api.asaas.com'
export const ASAAS_SANDBOX_URL = 'https://sandbox.asaas.com/api'

function getBaseUrl(): string {
  const { asaasEnvironment } = db.getSettings()
  if (import.meta.env.DEV) {
    return asaasEnvironment === 'production'
      ? ASAAS_PROXY_PREFIX
      : ASAAS_PROXY_SANDBOX_PREFIX
  }
  return asaasEnvironment === 'production'
    ? ASAAS_PRODUCTION_URL
    : ASAAS_SANDBOX_URL
}

function getApiKey(): string {
  return db.getSettings().asaasApiKey?.trim() ?? ''
}

async function call<T = unknown>(
  method: 'GET' | 'POST',
  path: string,
  body?: unknown,
): Promise<T> {
  const apiKey = getApiKey()
  if (!apiKey) {
    throw new Error('Configure a API Key do Asaas em /settings.')
  }
  try {
    const { data } = await axios.request<T>({
      method,
      baseURL: getBaseUrl(),
      url: path,
      data: body,
      headers: {
        access_token: apiKey,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      timeout: 20_000,
    })
    return data
  } catch (err) {
    if (axios.isAxiosError(err)) {
      const data = (err as AxiosError).response?.data as
        | { errors?: { description?: string }[]; message?: string }
        | undefined
      const description = data?.errors?.[0]?.description
      if (description) throw new Error(description)
      if (typeof data?.message === 'string') throw new Error(data.message)
      if (err.code === 'ERR_NETWORK')
        throw new Error(
          'Asaas indisponível ou bloqueado por CORS — verifique o proxy / a chave.',
        )
    }
    throw err
  }
}

export interface AsaasCustomer {
  id: string
  name: string
  email?: string
  cpfCnpj?: string
  phone?: string
  mobilePhone?: string
}

export interface AsaasPayment {
  id: string
  customer: string
  subscription?: string | null
  value: number
  netValue?: number
  status:
    | 'PENDING'
    | 'CONFIRMED'
    | 'RECEIVED'
    | 'OVERDUE'
    | 'REFUNDED'
    | string
  dueDate: string
  paymentDate?: string | null
  clientPaymentDate?: string | null
  description?: string
  invoiceUrl?: string
  billingType: 'BOLETO' | 'PIX' | 'CREDIT_CARD' | 'UNDEFINED' | string
}

export interface AsaasListResponse<T> {
  data: T[]
  hasMore: boolean
  totalCount: number
  limit: number
  offset: number
}

export interface AsaasSubscription {
  id: string
  customer: string
  value: number
  nextDueDate: string
  cycle: 'MONTHLY' | string
  description?: string
  status: string
}

export interface AsaasAccount {
  name?: string
  email?: string
  company?: string
  walletId?: string
}

export const asaasApi = {
  async me(): Promise<AsaasAccount> {
    return call<AsaasAccount>('GET', '/v3/myAccount')
  },

  async createCustomer(input: {
    name: string
    email?: string
    cpfCnpj?: string
    phone?: string
    mobilePhone?: string
  }): Promise<AsaasCustomer> {
    return call<AsaasCustomer>('POST', '/v3/customers', input)
  },

  async createPayment(input: {
    customer: string
    billingType?: 'BOLETO' | 'PIX' | 'UNDEFINED'
    value: number
    dueDate: string
    description?: string
  }): Promise<AsaasPayment> {
    return call<AsaasPayment>('POST', '/v3/payments', {
      billingType: 'UNDEFINED',
      ...input,
    })
  },

  async createSubscription(input: {
    customer: string
    billingType?: 'BOLETO' | 'PIX' | 'UNDEFINED'
    value: number
    nextDueDate: string
    description?: string
  }): Promise<AsaasSubscription> {
    return call<AsaasSubscription>('POST', '/v3/subscriptions', {
      billingType: 'UNDEFINED',
      cycle: 'MONTHLY',
      ...input,
    })
  },

  async getPayment(id: string): Promise<AsaasPayment> {
    return call<AsaasPayment>('GET', `/v3/payments/${encodeURIComponent(id)}`)
  },

  async listCustomers(params: {
    email?: string
    cpfCnpj?: string
    name?: string
    offset?: number
    limit?: number
  } = {}): Promise<AsaasListResponse<AsaasCustomer>> {
    const q = new URLSearchParams()
    if (params.email) q.set('email', params.email)
    if (params.cpfCnpj) q.set('cpfCnpj', params.cpfCnpj)
    if (params.name) q.set('name', params.name)
    q.set('limit', String(params.limit ?? 100))
    q.set('offset', String(params.offset ?? 0))
    return call<AsaasListResponse<AsaasCustomer>>(
      'GET',
      `/v3/customers?${q.toString()}`,
    )
  },

  async listAllCustomers(): Promise<AsaasCustomer[]> {
    const out: AsaasCustomer[] = []
    let offset = 0
    const limit = 100
    // Hard cap pra evitar loop em conta gigante.
    for (let i = 0; i < 50; i++) {
      const page = await asaasApi.listCustomers({ offset, limit })
      out.push(...page.data)
      if (!page.hasMore) break
      offset += limit
    }
    return out
  },

  async listPayments(params: {
    customer?: string
    status?: string
    offset?: number
    limit?: number
  } = {}): Promise<AsaasListResponse<AsaasPayment>> {
    const q = new URLSearchParams()
    if (params.customer) q.set('customer', params.customer)
    if (params.status) q.set('status', params.status)
    q.set('limit', String(params.limit ?? 100))
    q.set('offset', String(params.offset ?? 0))
    return call<AsaasListResponse<AsaasPayment>>(
      'GET',
      `/v3/payments?${q.toString()}`,
    )
  },

  async listAllPaymentsForCustomer(customerId: string): Promise<AsaasPayment[]> {
    const out: AsaasPayment[] = []
    let offset = 0
    const limit = 100
    for (let i = 0; i < 50; i++) {
      const page = await asaasApi.listPayments({
        customer: customerId,
        offset,
        limit,
      })
      out.push(...page.data)
      if (!page.hasMore) break
      offset += limit
    }
    return out
  },
}

export function paymentStatusFromAsaas(
  status: string,
): 'pending' | 'paid' | 'overdue' {
  const s = status.toUpperCase()
  if (s === 'RECEIVED' || s === 'CONFIRMED') return 'paid'
  if (s === 'OVERDUE') return 'overdue'
  return 'pending'
}
