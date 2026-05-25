import * as React from 'react'
import { supabase } from '@/services/supabase'
import { useAuth } from '@/hooks/useAuth'
import { canSeeFinancials } from '@/services/supabase'

/**
 * Notificações de tickets pro time interno:
 *  - Toca um som curto (Web Audio API — sem arquivo) quando entra novo ticket
 *  - Mostra Notification API se a aba está oculta (após permissão)
 *
 * Comportamento:
 *  - Só roda se o usuário pode ver tickets (admin/supervisor)
 *  - Pede permissão de Notification apenas 1x (interação do usuário)
 *  - Som não toca em respostas próprias do operador
 *  - Configurável via localStorage `tenanthub_notif_enabled`
 */
const LS_KEY = 'tenanthub_notif_enabled'

export function readNotificationPref(): boolean {
  if (typeof window === 'undefined') return false
  try {
    return window.localStorage.getItem(LS_KEY) === '1'
  } catch {
    return false
  }
}

export function setNotificationPref(enabled: boolean): void {
  try {
    window.localStorage.setItem(LS_KEY, enabled ? '1' : '0')
  } catch {
    /* ignore */
  }
}

export async function requestNotificationPermission(): Promise<boolean> {
  if (typeof Notification === 'undefined') return false
  if (Notification.permission === 'granted') return true
  if (Notification.permission === 'denied') return false
  const result = await Notification.requestPermission()
  return result === 'granted'
}

function playBeep() {
  try {
    const AudioCtx = (window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)
    if (!AudioCtx) return
    const ctx = new AudioCtx()
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.connect(gain)
    gain.connect(ctx.destination)
    osc.type = 'sine'
    osc.frequency.setValueAtTime(880, ctx.currentTime)
    osc.frequency.setValueAtTime(1320, ctx.currentTime + 0.12)
    gain.gain.setValueAtTime(0.0001, ctx.currentTime)
    gain.gain.exponentialRampToValueAtTime(0.18, ctx.currentTime + 0.02)
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.35)
    osc.start(ctx.currentTime)
    osc.stop(ctx.currentTime + 0.4)
    // Fecha o contexto após o som — evita leaks
    setTimeout(() => ctx.close().catch(() => {}), 600)
  } catch {
    /* ignore — sound is best-effort */
  }
}

export function useTicketNotifications(): void {
  const { profile } = useAuth()
  const canSee = canSeeFinancials(profile?.role) || profile?.role === 'suporte'

  React.useEffect(() => {
    if (!canSee) return
    if (typeof window === 'undefined') return

    const channel = supabase
      .channel('ticket-notifications')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'tickets' },
        (payload) => {
          const row = payload.new as {
            id: string
            number: number
            subject: string
            customer_name: string | null
            customer_company: string | null
            priority: string
          }

          if (!readNotificationPref()) return

          playBeep()

          if (
            typeof Notification !== 'undefined' &&
            Notification.permission === 'granted' &&
            document.hidden
          ) {
            const n = new Notification(`Novo ticket #${row.number}`, {
              body: `${row.customer_company ?? row.customer_name ?? 'Cliente'}\n${row.subject}`,
              tag: `ticket-${row.id}`,
              icon: '/favicon.ico',
            })
            n.onclick = () => {
              window.focus()
              window.location.assign(`/tickets/${row.id}`)
              n.close()
            }
          }
        },
      )
      .subscribe()

    return () => {
      void supabase.removeChannel(channel)
    }
  }, [canSee])
}
