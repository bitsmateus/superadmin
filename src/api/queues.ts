import { apiRequest } from './client'
import type { ServerConfig } from '@/store/authStore'
import type { CreateQueuePayload } from '@/types'

export const queuesApi = {
  /**
   * Cria uma fila (queue) em uma API/sessão de um tenant.
   * POST /v2/api/external/{apiId}/createQueueData
   * Autentica com o token da API do tenant (`apiToken`), não o do servidor.
   */
  async create(
    server: ServerConfig,
    apiId: string,
    payload: CreateQueuePayload,
    apiToken?: string,
  ): Promise<unknown> {
    return apiRequest(
      server,
      {
        method: 'POST',
        url: `/v2/api/external/${encodeURIComponent(apiId)}/createQueueData`,
        data: payload,
      },
      apiToken,
    )
  },
}

/** Extrai o id da fila da resposta do createQueueData (formato variável). */
export function extractQueueId(resp: unknown): string | undefined {
  const idOf = (o: unknown): unknown =>
    o && typeof o === 'object' ? (o as Record<string, unknown>).id ?? (o as Record<string, unknown>).queueId : undefined
  const r = resp as Record<string, unknown> | null | undefined
  const v = idOf(r) ?? idOf(r?.data) ?? idOf(r?.queue) ?? idOf((r?.data as Record<string, unknown> | undefined)?.queue)
  return v != null ? String(v) : undefined
}
