/**
 * Asaas ↔ TenantHub sync.
 *
 * Responsabilidades:
 *  - match/link: tenta casar um Client (CRM) com um AsaasCustomer por email,
 *    CPF/CNPJ ou nome
 *  - sync de pagamentos: lista todos os payments de um customer Asaas e
 *    mescla em client.payments. Dedup por `externalId`.
 *  - nunca sobrescreve pagamentos manuais (sem externalId).
 */

import { db } from './db'
import { asaasApi, type AsaasCustomer, type AsaasPayment } from './asaas'
import type { Client, Payment, PaymentMethod, PaymentType } from '@/types/client'

// ---------- Normalizadores ----------

function normalizeEmail(s: string | undefined | null): string {
  return (s ?? '').trim().toLowerCase()
}
function normalizeDoc(s: string | undefined | null): string {
  return (s ?? '').replace(/\D+/g, '')
}
function normalizeName(s: string | undefined | null): string {
  return (s ?? '')
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
}

// ---------- Match ----------

export interface MatchSuggestion {
  client: Client
  asaas: AsaasCustomer
  /** Como casou — pra exibir um rótulo de confiança no preview. */
  via: 'email' | 'cpfCnpj' | 'name'
}

export interface MatchResult {
  /** Já vinculados (têm asaasCustomerId que existe na lista atual). */
  alreadyLinked: { client: Client; asaas: AsaasCustomer }[]
  /** Sugestões automáticas (alta confiança). */
  suggestions: MatchSuggestion[]
  /** Clientes do CRM sem match. */
  unmatchedCrm: Client[]
  /** Customers no Asaas que não bateram com nenhum cliente. */
  unmatchedAsaas: AsaasCustomer[]
}

export function matchCustomersToCrm(
  clients: Client[],
  asaasCustomers: AsaasCustomer[],
): MatchResult {
  const byId = new Map(asaasCustomers.map((c) => [c.id, c]))
  const byEmail = new Map<string, AsaasCustomer>()
  const byDoc = new Map<string, AsaasCustomer>()
  const byName = new Map<string, AsaasCustomer>()
  for (const c of asaasCustomers) {
    const email = normalizeEmail(c.email)
    if (email) byEmail.set(email, c)
    const doc = normalizeDoc(c.cpfCnpj)
    if (doc) byDoc.set(doc, c)
    const name = normalizeName(c.name)
    if (name) byName.set(name, c)
  }

  const alreadyLinked: MatchResult['alreadyLinked'] = []
  const suggestions: MatchSuggestion[] = []
  const unmatchedCrm: Client[] = []
  const usedAsaas = new Set<string>()

  for (const client of clients) {
    if (client.asaasCustomerId) {
      const linked = byId.get(client.asaasCustomerId)
      if (linked) {
        alreadyLinked.push({ client, asaas: linked })
        usedAsaas.add(linked.id)
        continue
      }
      // Tem id mas não está na conta atual (talvez ambiente errado).
      // Cai pro fluxo de match.
    }

    const email = normalizeEmail(client.email)
    if (email && byEmail.has(email)) {
      const a = byEmail.get(email)!
      if (!usedAsaas.has(a.id)) {
        suggestions.push({ client, asaas: a, via: 'email' })
        usedAsaas.add(a.id)
        continue
      }
    }

    // CPF/CNPJ não está no schema do CRM — pulamos por enquanto. Mantido
    // o branch pra quando for adicionado.
    const doc = ''
    if (doc && byDoc.has(doc)) {
      const a = byDoc.get(doc)!
      if (!usedAsaas.has(a.id)) {
        suggestions.push({ client, asaas: a, via: 'cpfCnpj' })
        usedAsaas.add(a.id)
        continue
      }
    }

    const name = normalizeName(client.company) || normalizeName(client.name)
    if (name && byName.has(name)) {
      const a = byName.get(name)!
      if (!usedAsaas.has(a.id)) {
        suggestions.push({ client, asaas: a, via: 'name' })
        usedAsaas.add(a.id)
        continue
      }
    }

    unmatchedCrm.push(client)
  }

  const unmatchedAsaas = asaasCustomers.filter((c) => !usedAsaas.has(c.id))

  return { alreadyLinked, suggestions, unmatchedCrm, unmatchedAsaas }
}

// ---------- Link / unlink ----------

export function linkAsaasCustomer(clientId: string, asaasCustomerId: string): void {
  db.updateClient(clientId, { asaasCustomerId })
  db.addLog(clientId, 'Cliente vinculado ao Asaas', asaasCustomerId)
}

export function unlinkAsaasCustomer(clientId: string): void {
  db.updateClient(clientId, { asaasCustomerId: undefined })
  db.addLog(clientId, 'Vínculo com Asaas removido')
}

// ---------- Sync de pagamentos ----------

export function asaasPaymentToLocal(p: AsaasPayment): Payment {
  return {
    id: db.newId(),
    externalId: p.id,
    type: inferType(p),
    value: p.value,
    dueDate: p.dueDate,
    paidAt:
      p.paymentDate ||
      p.clientPaymentDate ||
      (isPaid(p.status) ? p.dueDate : undefined),
    method: methodFromBillingType(p.billingType),
    reference: p.description || undefined,
    source: 'asaas',
    createdAt: new Date().toISOString(),
  }
}

function inferType(p: AsaasPayment): PaymentType {
  if (p.subscription) return 'monthly'
  const desc = (p.description ?? '').toLowerCase()
  if (/implementa|setup|onboarding|impl\./.test(desc)) return 'implementation'
  if (/mensa|assinatu/.test(desc)) return 'monthly'
  return 'monthly'
}

function isPaid(status: string): boolean {
  const s = status.toUpperCase()
  return s === 'RECEIVED' || s === 'CONFIRMED' || s === 'RECEIVED_IN_CASH'
}

function methodFromBillingType(bt: string): PaymentMethod | undefined {
  const t = (bt ?? '').toUpperCase()
  if (t === 'PIX') return 'pix'
  if (t === 'BOLETO') return 'boleto'
  if (t === 'CREDIT_CARD') return 'card'
  if (t === 'TRANSFER' || t === 'DEBIT_CARD') return 'transfer'
  if (t === 'UNDEFINED') return 'asaas'
  return undefined
}

export interface SyncResult {
  inserted: number
  updated: number
  skipped: number
}

/**
 * Faz pull dos pagamentos do Asaas pro client e mescla.
 *  - novos (externalId não existe) → insere
 *  - existentes do Asaas (externalId bate) → atualiza valor/status/paidAt
 *  - manuais (sem externalId) → nunca toca
 */
export async function syncPaymentsForClient(client: Client): Promise<SyncResult> {
  if (!client.asaasCustomerId) {
    throw new Error('Cliente sem vínculo Asaas.')
  }
  const remote = await asaasApi.listAllPaymentsForCustomer(client.asaasCustomerId)
  const current = client.payments ?? []
  const byExt = new Map<string, Payment>()
  for (const p of current) {
    if (p.externalId) byExt.set(p.externalId, p)
  }

  let inserted = 0
  let updated = 0
  let skipped = 0

  const next: Payment[] = current.slice()
  for (const r of remote) {
    const mapped = asaasPaymentToLocal(r)
    const existing = byExt.get(r.id)
    if (!existing) {
      next.push(mapped)
      inserted++
      continue
    }
    // Atualiza só campos derivados do Asaas; preserva id local.
    const merged: Payment = {
      ...existing,
      value: mapped.value,
      dueDate: mapped.dueDate,
      paidAt: mapped.paidAt,
      method: mapped.method ?? existing.method,
      reference: mapped.reference ?? existing.reference,
      type: existing.type, // não muda tipo após import inicial
    }
    if (
      merged.value !== existing.value ||
      merged.dueDate !== existing.dueDate ||
      merged.paidAt !== existing.paidAt ||
      merged.method !== existing.method ||
      merged.reference !== existing.reference
    ) {
      const idx = next.findIndex((x) => x.id === existing.id)
      if (idx >= 0) next[idx] = merged
      updated++
    } else {
      skipped++
    }
  }

  db.updateClient(client.id, { payments: next, lastPaymentCheck: new Date().toISOString() })
  if (inserted > 0 || updated > 0) {
    db.addLog(
      client.id,
      'Pagamentos sincronizados do Asaas',
      `${inserted} novo(s), ${updated} atualizado(s)`,
    )
  }
  return { inserted, updated, skipped }
}

export async function syncAllLinked(): Promise<{
  clients: number
  inserted: number
  updated: number
  errors: { client: Client; error: string }[]
}> {
  const linked = db.getClients().filter((c) => c.asaasCustomerId)
  let inserted = 0
  let updated = 0
  const errors: { client: Client; error: string }[] = []
  for (const c of linked) {
    try {
      const r = await syncPaymentsForClient(c)
      inserted += r.inserted
      updated += r.updated
    } catch (err) {
      errors.push({
        client: c,
        error: err instanceof Error ? err.message : String(err),
      })
    }
  }
  return { clients: linked.length, inserted, updated, errors }
}
