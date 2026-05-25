import * as React from 'react'
import { onSseEvent } from '@/services/api'
import { useAuth } from '@/hooks/useAuth'
import { canSeeFinancials } from '@/services/supabase'

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
    setTimeout(() => ctx.close().catch(() => {}), 600)
  } catch {
    /* ignore */
  }
}

export function useTicketNotifications(): void {
  const { profile } = useAuth()
  const canSee = canSeeFinancials(profile?.role) || profile?.role === 'suporte'

  React.useEffect(() => {
    if (!canSee) return
    if (typeof window === 'undefined') return

    const unsub = onSseEvent((table, type, data) => {
      if (table !== 'tickets' || type !== 'INSERT') return

      const row = data as {
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
    })

    return unsub
  }, [canSee])
}
