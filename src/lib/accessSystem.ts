import { toast } from 'sonner'
import { copyToClipboard } from '@/lib/clipboard'
import { getServerById } from '@/store/authStore'
import { useAccessStore } from '@/store/accessStore'
import type { Client } from '@/types/client'

/** Subconjunto do cliente necessário para acessar o sistema — permite chamar
 *  a ação com o Client completo ou com um objeto mínimo. */
export type AccessTarget = Pick<Client, 'supportEmail' | 'tenantServerId' | 'platformApp' | 'platformWeb' | 'platformChat'>

/**
 * Qual servidor (chat/app/web) vale pra esse cliente: SEMPRE o que está marcado em "Criado em"
 * (platformApp/platformWeb/platformChat, editável na Visão Geral) — é o campo que a pessoa vê e
 * corrige na tela, então é ele quem manda. tenantServerId (gravado só na hora de criar o tenant)
 * fica de fallback pra quem nunca teve o "Criado em" tocado — sem isso os dois campos podem
 * divergir (alguém corrige o "Criado em" depois e o botão "Acessar sistema" continua abrindo o
 * servidor antigo).
 */
export function resolveClientServerId(client?: AccessTarget | null): string | undefined {
  if (!client) return undefined
  if (client.platformChat) return 'chat'
  if (client.platformApp) return 'app'
  if (client.platformWeb) return 'web'
  return client.tenantServerId
}

/** URL de login do sistema do cliente: a do servidor marcado em "Criado em" (ou tenantServerId, se
 *  isso nunca foi definido), ou a URL global configurada em Configurações. */
export function accessUrlFor(client?: AccessTarget | null): string {
  const fromServer = getServerById(resolveClientServerId(client))?.loginUrl
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
