/**
 * Tenant → Client import.
 *
 * Pra cada tenant nos servidores conectados, propõe criar um Client no CRM
 * ou vincular a um Client existente que parece ser o mesmo.
 *
 * Regras de match:
 *  - Forte: client.tenantServerId + client.tenantId já bate → alreadyLinked
 *  - Sugestão: client sem vínculo, mas email/nome normalizado idêntico
 */

import { db } from './db'
import type { TaggedTenant } from '@/hooks/useTenants'
import type { Client } from '@/types/client'
import { asText } from '@/lib/utils'

function normEmail(s: string | undefined | null): string {
  return (s ?? '').trim().toLowerCase()
}
function normName(s: string | undefined | null): string {
  return (s ?? '')
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
}

export interface TenantMatchRow {
  tenant: TaggedTenant
  /** Status do match em relação ao CRM. */
  kind: 'linked' | 'suggest_link' | 'new'
  /** Quando `kind = linked` ou `suggest_link`. */
  candidate?: Client
  /** Como casou (para 'suggest_link'). */
  via?: 'email' | 'name'
}

export interface TenantMatchResult {
  rows: TenantMatchRow[]
  linkedCount: number
  suggestCount: number
  newCount: number
}

export function matchTenantsToClients(
  tenants: TaggedTenant[],
  clients: Client[],
): TenantMatchResult {
  // Index dos clientes
  const byTenantKey = new Map<string, Client>()
  for (const c of clients) {
    if (c.tenantServerId && c.tenantId) {
      byTenantKey.set(`${c.tenantServerId}:${String(c.tenantId)}`, c)
    }
  }
  const byEmail = new Map<string, Client>()
  const byName = new Map<string, Client>()
  for (const c of clients) {
    if (c.tenantId) continue // já vinculado, não conta como candidato
    const email = normEmail(c.email)
    if (email && !byEmail.has(email)) byEmail.set(email, c)
    const name =
      normName(c.company) || normName(c.name) || normName(c.tenantName)
    if (name && !byName.has(name)) byName.set(name, c)
  }

  const rows: TenantMatchRow[] = []
  const used = new Set<string>()

  for (const t of tenants) {
    const key = `${t._serverId}:${String(t.id)}`
    const linked = byTenantKey.get(key)
    if (linked) {
      rows.push({ tenant: t, kind: 'linked', candidate: linked })
      continue
    }
    const email = normEmail(t.email)
    if (email && byEmail.has(email)) {
      const c = byEmail.get(email)!
      if (!used.has(c.id)) {
        rows.push({ tenant: t, kind: 'suggest_link', candidate: c, via: 'email' })
        used.add(c.id)
        continue
      }
    }
    const name = normName(asText(t.name))
    if (name && byName.has(name)) {
      const c = byName.get(name)!
      if (!used.has(c.id)) {
        rows.push({ tenant: t, kind: 'suggest_link', candidate: c, via: 'name' })
        used.add(c.id)
        continue
      }
    }
    rows.push({ tenant: t, kind: 'new' })
  }

  return {
    rows,
    linkedCount: rows.filter((r) => r.kind === 'linked').length,
    suggestCount: rows.filter((r) => r.kind === 'suggest_link').length,
    newCount: rows.filter((r) => r.kind === 'new').length,
  }
}

export interface ImportPlanItem {
  tenant: TaggedTenant
  /** 'create' = novo client; 'link' = atualiza client existente; 'skip' = ignora. */
  action: 'create' | 'link' | 'skip'
  /** Client existente quando action = 'link'. */
  existing?: Client
}

export interface ImportResult {
  created: number
  linked: number
  skipped: number
  errors: { tenant: TaggedTenant; error: string }[]
}

/**
 * Executa o plano: cria clients novos pros tenants 'create' e vincula
 * os existentes pros tenants 'link'. Stage padrão = 'active' (já em uso).
 */
export async function executeImportPlan(
  plan: ImportPlanItem[],
): Promise<ImportResult> {
  const result: ImportResult = { created: 0, linked: 0, skipped: 0, errors: [] }
  for (const item of plan) {
    try {
      if (item.action === 'skip') {
        result.skipped++
        continue
      }
      if (item.action === 'link' && item.existing) {
        db.updateClient(item.existing.id, {
          tenantId: String(item.tenant.id),
          tenantServerId: item.tenant._serverId,
          tenantName: asText(item.tenant.name),
          tenantApiId:
            typeof item.tenant.apiId === 'string' ? item.tenant.apiId : undefined,
        })
        db.addLog(item.existing.id, 'Tenant vinculado', `${item.tenant._serverName} · ${asText(item.tenant.name)}`)
        result.linked++
        continue
      }
      if (item.action === 'create') {
        const name = asText(item.tenant.name, 'Sem nome')
        db.createClient({
          name,
          company: name,
          email:
            typeof item.tenant.email === 'string' && item.tenant.email
              ? item.tenant.email
              : '',
          phone: '',
          stage: 'active',
          tenantId: String(item.tenant.id),
          tenantServerId: item.tenant._serverId,
          tenantName: name,
          tenantApiId:
            typeof item.tenant.apiId === 'string' ? item.tenant.apiId : undefined,
        })
        result.created++
      }
    } catch (err) {
      result.errors.push({
        tenant: item.tenant,
        error: err instanceof Error ? err.message : String(err),
      })
    }
  }
  return result
}
