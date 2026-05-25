/**
 * Helpers puros de cálculo pra analytics. Não tocam serviço — recebem os
 * snapshots de clients/stageHistory/tickets/nps já carregados pelos hooks.
 */
import type {
  Client,
  PipelineStage,
  StageHistoryEntry,
} from '@/types/client'
import type { NpsResponse, Ticket } from '@/types/ticket'
import { PIPELINE_STAGES } from '@/constants/stageColors'

export interface FunnelBucket {
  stage: PipelineStage
  count: number
  /** % que avançou desse stage pra o próximo na sequência. null se for o último. */
  conversionToNext: number | null
}

/**
 * Funil de conversão baseado em stage_history:
 *   - Pra cada stage, conta quantos clientes JÁ PASSARAM por ele (qualquer hora)
 *   - Conversão = (clientes que chegaram no próximo) / (clientes que chegaram aqui)
 *
 * Janela: opcional, em dias. Se fornecido, considera só transições recentes.
 */
export function computeFunnel(
  history: StageHistoryEntry[],
  windowDays?: number,
): FunnelBucket[] {
  const cutoff = windowDays
    ? Date.now() - windowDays * 24 * 60 * 60 * 1000
    : null

  // Pra cada stage, conjunto de clients que chegaram nele.
  const reachedByStage: Record<PipelineStage, Set<string>> = {
    lead: new Set(),
    welcome: new Set(),
    contract: new Set(),
    briefing: new Set(),
    setup: new Set(),
    delivery: new Set(),
    active: new Set(),
    churned: new Set(),
  }

  for (const h of history) {
    if (cutoff && new Date(h.at).getTime() < cutoff) continue
    reachedByStage[h.toStage].add(h.clientId)
  }

  return PIPELINE_STAGES.map((stage, i) => {
    const count = reachedByStage[stage].size
    const next = PIPELINE_STAGES[i + 1]
    if (!next) return { stage, count, conversionToNext: null }
    const nextCount = reachedByStage[next].size
    return {
      stage,
      count,
      conversionToNext: count === 0 ? null : (nextCount / count) * 100,
    }
  })
}

export interface StageDuration {
  stage: PipelineStage
  /** Média de dias que clientes ficaram nesse stage antes de avançar. */
  avgDays: number | null
  /** Quantos transições amostradas. */
  sampleSize: number
}

/**
 * Tempo médio em cada stage. Pra um par de transições (toStage=X em t1,
 * próxima transição em t2 do mesmo cliente), a duração em X é t2 - t1.
 *
 * Stages sem amostras retornam null.
 */
export function computeStageDurations(
  history: StageHistoryEntry[],
): StageDuration[] {
  // Agrupa por cliente, ordena por at asc
  const byClient: Record<string, StageHistoryEntry[]> = {}
  for (const h of history) {
    if (!byClient[h.clientId]) byClient[h.clientId] = []
    byClient[h.clientId].push(h)
  }
  for (const list of Object.values(byClient)) {
    list.sort((a, b) => a.at.localeCompare(b.at))
  }

  const sumByStage: Record<PipelineStage, { total: number; n: number }> = {
    lead: { total: 0, n: 0 },
    welcome: { total: 0, n: 0 },
    contract: { total: 0, n: 0 },
    briefing: { total: 0, n: 0 },
    setup: { total: 0, n: 0 },
    delivery: { total: 0, n: 0 },
    active: { total: 0, n: 0 },
    churned: { total: 0, n: 0 },
  }

  for (const list of Object.values(byClient)) {
    for (let i = 0; i < list.length - 1; i++) {
      const cur = list[i]
      const nxt = list[i + 1]
      const ms = new Date(nxt.at).getTime() - new Date(cur.at).getTime()
      if (ms < 0) continue
      const days = ms / (24 * 60 * 60 * 1000)
      sumByStage[cur.toStage].total += days
      sumByStage[cur.toStage].n += 1
    }
  }

  return PIPELINE_STAGES.map((stage) => {
    const s = sumByStage[stage]
    return {
      stage,
      avgDays: s.n === 0 ? null : s.total / s.n,
      sampleSize: s.n,
    }
  })
}

export interface AgentPerformance {
  agentKey: string
  activeClients: number
  /** Clientes que chegaram em 'active' no mês corrente, pelos quais este agente é responsável. */
  conversionsThisMonth: number
  ticketsResolvedThisMonth: number
}

/**
 * Performance individual por responsável. Como `responsavel` é um texto livre
 * em clients, agrupamos por esse texto (case-insensitive). Tickets são
 * casados via assignee_id → profile.name/email (passado em agentMap).
 */
export function computeAgentPerformance(
  clients: Client[],
  history: StageHistoryEntry[],
  tickets: Ticket[],
  agentMap: Map<string, { name?: string | null; email: string }>,
): AgentPerformance[] {
  const now = new Date()
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).getTime()

  // Mapa: key (normalizada) → métricas
  const acc: Record<
    string,
    { display: string; active: number; conversions: number; tickets: number }
  > = {}

  function bumpKey(rawKey: string, field: 'active' | 'conversions' | 'tickets') {
    const display = rawKey
    const key = rawKey.trim().toLowerCase()
    if (!key) return
    if (!acc[key]) acc[key] = { display, active: 0, conversions: 0, tickets: 0 }
    acc[key][field] += 1
  }

  // Clientes ativos por responsável
  for (const c of clients) {
    if (!c.responsavel) continue
    if (c.stage === 'churned') continue
    bumpKey(c.responsavel, 'active')
  }

  // Conversões do mês: transição → 'active' dentro do mês corrente
  // Atribuído ao `responsavel` atual do cliente.
  const clientById = new Map(clients.map((c) => [c.id, c]))
  for (const h of history) {
    if (h.toStage !== 'active') continue
    if (new Date(h.at).getTime() < monthStart) continue
    const client = clientById.get(h.clientId)
    if (!client?.responsavel) continue
    bumpKey(client.responsavel, 'conversions')
  }

  // Tickets resolvidos no mês por assignee
  for (const t of tickets) {
    if (!t.resolvedAt) continue
    if (new Date(t.resolvedAt).getTime() < monthStart) continue
    if (!t.assigneeId) continue
    const agent = agentMap.get(t.assigneeId)
    if (!agent) continue
    bumpKey(agent.name || agent.email, 'tickets')
  }

  return Object.values(acc)
    .map((a) => ({
      agentKey: a.display,
      activeClients: a.active,
      conversionsThisMonth: a.conversions,
      ticketsResolvedThisMonth: a.tickets,
    }))
    .sort(
      (a, b) =>
        b.conversionsThisMonth +
        b.ticketsResolvedThisMonth -
        (a.conversionsThisMonth + a.ticketsResolvedThisMonth),
    )
}

export interface MonthlyActuals {
  newClients: number
  mrr: number
  npsScore: number | null
  /** NPS calculado como %promoters - %detractors do mês. */
  npsResponses: number
}

/** Métricas atuais do mês corrente — comparáveis com as metas em AppSettings. */
export function computeMonthlyActuals(
  clients: Client[],
  history: StageHistoryEntry[],
  nps: NpsResponse[],
): MonthlyActuals {
  const now = new Date()
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).getTime()

  // novos clientes: transição inicial (from_stage = null) no mês.
  // Como nem todo histórico antigo tem isso, fallback pra clients.createdAt.
  const newViaHistory = new Set<string>()
  for (const h of history) {
    if (h.fromStage !== null) continue
    if (new Date(h.at).getTime() < monthStart) continue
    newViaHistory.add(h.clientId)
  }
  const newViaCreated = clients.filter(
    (c) => new Date(c.createdAt).getTime() >= monthStart,
  )
  const newClientsCount = Math.max(
    newViaHistory.size,
    newViaCreated.length,
  )

  // MRR: soma de monthly_value de clientes não-churned ativos.
  const mrr = clients
    .filter((c) => c.stage !== 'churned')
    .reduce((acc, c) => acc + (c.monthlyValue ?? 0), 0)

  // NPS do mês: respostas com responded_at no mês corrente.
  const respondedThisMonth = nps.filter(
    (n) =>
      n.respondedAt &&
      new Date(n.respondedAt).getTime() >= monthStart &&
      n.score !== undefined &&
      n.score !== null,
  )
  let npsScore: number | null = null
  if (respondedThisMonth.length > 0) {
    const promoters = respondedThisMonth.filter((n) => (n.score ?? 0) >= 9).length
    const detractors = respondedThisMonth.filter((n) => (n.score ?? 0) <= 6).length
    npsScore = Math.round(
      ((promoters - detractors) / respondedThisMonth.length) * 100,
    )
  }

  return {
    newClients: newClientsCount,
    mrr,
    npsScore,
    npsResponses: respondedThisMonth.length,
  }
}

export function formatCurrencyBRL(value: number): string {
  return value.toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  })
}
