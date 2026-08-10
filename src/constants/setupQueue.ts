import type { AppSettings, Client } from '@/types/client'

/**
 * Fila de configuração.
 *
 * Regra de operação: a etapa "Iniciar Configuração" (setup_start) é a FILA —
 * ordenada por ordem de chegada — e "Em Configuração" (setup) é o trabalho em
 * andamento, limitado a N simultâneos por responsável de entrega.
 *
 * Dentro de "Em Configuração" existem dois blocos:
 *   • Fazendo agora   → tem `setupStartedAt` (conta para o limite)
 *   • Aguardando vez  → está na etapa mas não começou (não conta)
 */

/** Padrão: 2 configurações simultâneas por responsável de entrega. */
export const DEFAULT_SETUP_WIP_LIMIT = 2

export function resolveWipLimit(settings?: AppSettings | null): number {
  const n = settings?.setupWipLimit
  return typeof n === 'number' && n > 0 ? n : DEFAULT_SETUP_WIP_LIMIT
}

/**
 * Momento de entrada na fila. Usa a aprovação do briefing — é quando o cliente
 * de fato ficou pronto para ser configurado. Sem ela, cai para a data em que
 * chegou na etapa e, por último, a criação.
 *
 * Importante: não usamos `stageUpdatedAt` como primeira opção porque ele muda
 * a cada movimento de card, o que embaralharia a ordem de chegada.
 */
export function queueEntryAt(c: Client): string {
  return c.briefingApprovedAt ?? c.stageUpdatedAt ?? c.createdAt
}

/** Prioridade manual: menor passa na frente. Vazio = sem furar fila. */
function priorityOf(c: Client): number {
  const p = c.queuePriority
  return typeof p === 'number' && Number.isFinite(p) ? p : Number.MAX_SAFE_INTEGER
}

/** Ordena por prioridade manual e, em empate, por ordem de chegada. */
export function compareQueue(a: Client, b: Client): number {
  const pa = priorityOf(a)
  const pb = priorityOf(b)
  if (pa !== pb) return pa - pb
  return new Date(queueEntryAt(a)).getTime() - new Date(queueEntryAt(b)).getTime()
}

export function sortQueue(clients: Client[]): Client[] {
  return [...clients].sort(compareQueue)
}

/** Está em configuração ativa (conta para o limite de simultâneos). */
export function isDoingNow(c: Client): boolean {
  return c.stage === 'setup' && Boolean(c.setupStartedAt)
}

/** Nome usado para agrupar o WIP. Sem responsável, cai num balde "Sem responsável". */
export function wipOwner(c: Client): string {
  return (c.responsavelEntrega || c.responsavel || '').trim() || 'Sem responsável'
}

/** Quantos o responsável já tem em "fazendo agora" (ignorando `exceptId`). */
export function wipCountFor(
  clients: Client[],
  owner: string,
  exceptId?: string,
): number {
  const key = (owner || '').trim() || 'Sem responsável'
  return clients.filter(
    (c) => c.id !== exceptId && isDoingNow(c) && wipOwner(c) === key,
  ).length
}

/** Contagem por responsável — alimenta o cabeçalho "Mateus 2/2 · João 1/2". */
export function wipByOwner(clients: Client[]): { owner: string; count: number }[] {
  const map = new Map<string, number>()
  for (const c of clients) {
    if (!isDoingNow(c)) continue
    const key = wipOwner(c)
    map.set(key, (map.get(key) ?? 0) + 1)
  }
  return [...map.entries()]
    .map(([owner, count]) => ({ owner, count }))
    .sort((a, b) => b.count - a.count || a.owner.localeCompare(b.owner, 'pt-BR'))
}
