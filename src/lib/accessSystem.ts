import { toast } from 'sonner'
import { copyToClipboard } from '@/lib/clipboard'
import { getServerById } from '@/store/authStore'
import { useAccessStore } from '@/store/accessStore'
import type { Client } from '@/types/client'

/** Subconjunto do cliente necessário para acessar o sistema — permite chamar
 *  a ação com o Client completo ou com um objeto mínimo. */
export type AccessTarget = Pick<Client, 'supportEmail' | 'tenantServerId'>

/** URL de login do sistema do cliente: a do servidor vinculado ao tenant, ou a
 *  URL global configurada em Configurações. */
export function accessUrlFor(client?: AccessTarget | null): string {
  const fromServer = getServerById(client?.tenantServerId)?.loginUrl
  return fromServer ?? useAccessStore.getState().systemUrl
}

/** Há e-mail de suporte cadastrado para copiar? */
export function hasSupportEmail(client?: AccessTarget | null): boolean {
  return Boolean(client?.supportEmail?.trim())
}

/**
 * "Acessar sistema": copia o e-mail de suporte cadastrado no cliente e abre o
 * login do sistema numa nova aba.
 *
 * A cópia acontece ANTES do window.open — abrir primeiro tira o foco do
 * documento e a Clipboard API falha.
 */
export async function accessClientSystem(client?: AccessTarget | null): Promise<void> {
  const email = client?.supportEmail?.trim()
  if (email) {
    const ok = await copyToClipboard(email)
    if (ok) toast.success('E-mail de suporte copiado')
    else toast.message('Não foi possível copiar — copie o e-mail manualmente')
  }
  window.open(accessUrlFor(client), '_blank', 'noopener,noreferrer')
}
