export type TenantStatus = 'active' | 'inactive' | string

export interface Tenant {
  id: string | number
  name: string
  slug?: string
  domain?: string
  email?: string
  status?: TenantStatus
  active?: boolean
  is_active?: boolean
  description?: string
  created_at?: string
  updated_at?: string
  api_key?: string
  api_token?: string
  apiId?: string
  identity?: string
  maxUsers?: number
  maxConnections?: number
  _serverId?: string
  _serverName?: string
  [key: string]: unknown
}

export interface TenantListResponse {
  data?: Tenant[]
  tenants?: Tenant[]
  items?: Tenant[]
  total?: number
}

export interface CreateApiPayload {
  name?: string
  /** Sessão/canal WhatsApp ao qual a API fica vinculada. */
  sessionId?: string | number
  urlServiceStatus?: string | null
  urlMessageStatus?: string | null
  userId?: string | number
  authToken?: string
  tenant?: string | number
  tenant_id?: string | number
  domain?: string
  description?: string
  [key: string]: unknown
}

/** Fila (queue) criada via /v2/api/external/{apiId}/createQueueData. */
export interface CreateQueuePayload {
  queue: string
  isActive?: boolean
  [key: string]: unknown
}

export interface StoreTenantPayload {
  status: 'active' | 'inactive'
  name: string
  maxUsers: number
  maxConnections: number
  acceptTerms: boolean
  email: string
  password: string
  userName: string
  profile: 'admin' | 'user'
}

export interface UpdateTenantPayload {
  id: string | number
  status?: 'active' | 'inactive'
  name?: string
  maxUsers?: number
  maxConnections?: number
  email?: string
  [key: string]: unknown
}

export interface ShowTenantPayload {
  id: string | number
}

export interface DeleteApiPayload {
  id?: string | number
  tenant_id?: string | number
  [key: string]: unknown
}

export interface CreateSessionTenantPayload {
  tenant: string | number
  name: string
  /** Ex.: "DISCONNECTED" ao criar. */
  status?: string
  /** Tipos suportados: whatsapp, baileys, meow, evo, uazapi, zapi. */
  type?: string
  [key: string]: unknown
}

export interface SessionResponse {
  token?: string
  url?: string
  expires_at?: string
  [key: string]: unknown
}

export interface AppUser {
  id: string | number
  name: string
  email: string
  role?: string
  tenant_id?: string | number
  status?: string
  active?: boolean
  is_active?: boolean
  created_at?: string
  [key: string]: unknown
}

export interface CreateUserPayload {
  name: string
  email: string
  password?: string
  role?: string
  tenant_id?: string | number
  permissions?: string[]
  [key: string]: unknown
}

export interface UpdateUserPayload {
  id: string | number
  name?: string
  email?: string
  password?: string
  role?: string
  tenant_id?: string | number
  active?: boolean
  [key: string]: unknown
}

export interface UserStatusResponse {
  id?: string | number
  status?: string
  active?: boolean
  [key: string]: unknown
}

export interface UserListResponse {
  data?: AppUser[]
  users?: AppUser[]
  items?: AppUser[]
  total?: number
}
