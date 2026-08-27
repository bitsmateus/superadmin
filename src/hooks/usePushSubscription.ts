import * as React from 'react'
import { api } from '@/services/api'
import { useAuth } from './useAuth'

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const rawData = window.atob(base64)
  return Uint8Array.from([...rawData].map((c) => c.charCodeAt(0)))
}

/**
 * Assina notificação push automaticamente pra qualquer sessão logada, sem botão de "ativar" —
 * quem de fato recebe cada notificação é filtrado no servidor (ex.: só quem tem acesso ao quadro
 * do lead), então não tem problema todo mundo logado assinar aqui.
 *
 * Em iOS, `PushManager` só existe quando o app já foi adicionado à Tela de Início (não funciona
 * numa aba normal do Safari) — a checagem de feature abaixo já cobre isso sozinha, sem precisar
 * de tratamento especial.
 */
export function usePushSubscription(): void {
  const { profile } = useAuth()

  React.useEffect(() => {
    if (!profile) return
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) return
    if (typeof Notification === 'undefined' || Notification.permission === 'denied') return

    let cancelled = false

    async function subscribe() {
      try {
        const registration = await navigator.serviceWorker.ready
        let subscription = await registration.pushManager.getSubscription()

        if (!subscription) {
          if (Notification.permission === 'default') {
            const permission = await Notification.requestPermission()
            if (permission !== 'granted' || cancelled) return
          } else if (Notification.permission !== 'granted') {
            return
          }
          const { key } = await api.get<{ key: string }>('/api/push/vapid-public-key')
          if (cancelled) return
          subscription = await registration.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: urlBase64ToUint8Array(key) as BufferSource,
          })
        }

        if (cancelled) return
        await api.post('/api/push/subscribe', subscription.toJSON())
      } catch (err) {
        console.error('[push] falha ao assinar notificações', err)
      }
    }

    subscribe()
    return () => {
      cancelled = true
    }
  }, [profile?.id])
}
