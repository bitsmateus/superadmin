import { api } from '@/services/api'

/**
 * Cria uma instância na Evolution API (via backend, que guarda a apiKey).
 * `instanceName` deve ser o mesmo nome usado na sessão do NX (número
 * normalizado, 55+DDD+número) para "casar" as duas pontas.
 */
export async function createEvolutionInstance(instanceName: string): Promise<void> {
  await api.post('/api/evolution/instance', { instanceName })
}
