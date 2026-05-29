import { apiRequest } from './client'
import type { ServerConfig } from '@/store/authStore'
import type { CreateQueuePayload } from '@/types'

export const queuesApi = {
  /**
   * Cria uma fila (queue) em uma API/sessão de um tenant.
   * POST /v2/api/external/{apiId}/createQueueData
   */
  async create(
    server: ServerConfig,
    apiId: string,
    payload: CreateQueuePayload,
  ): Promise<unknown> {
    return apiRequest(server, {
      method: 'POST',
      url: `/v2/api/external/${encodeURIComponent(apiId)}/createQueueData`,
      data: payload,
    })
  },
}
