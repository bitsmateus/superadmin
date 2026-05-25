import * as React from 'react'
import { db, isBooted } from '@/services/db'
import { syncAllLinked } from '@/services/asaasSync'
import { useAuth } from '@/hooks/useAuth'
import { canSeeFinancials } from '@/services/supabase'

/**
 * Auto-sync polling de pagamentos Asaas.
 *
 * Estratégia:
 *  - Um único setInterval (não recreia em toda notify do db)
 *  - Lê settings dentro do callback (pega valor atualizado)
 *  - Throttle de visibilitychange: só roda se passou >60s do último sync
 *  - Pausa quando a aba está hidden
 *  - Falhas viram console.warn, sem toast — pra não poluir
 */
export function useAsaasAutoSync(): void {
  const { profile } = useAuth()
  const canSee = canSeeFinancials(profile?.role)

  React.useEffect(() => {
    if (!canSee) return

    let cancelled = false
    let running = false
    let lastRunAt = 0
    let interval: number | null = null

    const tickMs = () => {
      const min = db.getSettings().asaasSyncIntervalMin ?? 15
      return Math.max(1, min) * 60 * 1000
    }

    const shouldRun = () => {
      if (cancelled || running || document.hidden) return false
      if (!isBooted()) return false
      const s = db.getSettings()
      if (!s.asaasApiKey) return false
      if ((s.asaasSyncIntervalMin ?? 15) <= 0) return false
      return true
    }

    const runOnce = async () => {
      if (!shouldRun()) return
      running = true
      lastRunAt = Date.now()
      try {
        const r = await syncAllLinked()
        // eslint-disable-next-line no-console
        console.info('[asaas] auto-sync', r)
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn('[asaas] auto-sync falhou', err)
      } finally {
        running = false
      }
    }

    // Setup do interval recorrente
    const restartInterval = () => {
      if (interval) window.clearInterval(interval)
      interval = window.setInterval(() => {
        void runOnce()
      }, tickMs())
    }

    // Primeiro tick depois de 30s pra dar tempo da UI estabilizar
    const firstTickId = window.setTimeout(() => {
      void runOnce()
      restartInterval()
    }, 30_000)

    // Visibility: re-sync quando aba volta a ficar visível, mas só se
    // passou >60s do último (evita spam em troca de aba rápida).
    const onVisibility = () => {
      if (document.hidden) return
      if (Date.now() - lastRunAt < 60_000) return
      void runOnce()
    }
    document.addEventListener('visibilitychange', onVisibility)

    return () => {
      cancelled = true
      window.clearTimeout(firstTickId)
      if (interval) window.clearInterval(interval)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [canSee])
}
