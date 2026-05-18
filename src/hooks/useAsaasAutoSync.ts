import * as React from 'react'
import { db, isBooted } from '@/services/db'
import { syncAllLinked } from '@/services/asaasSync'
import { useAuth } from '@/hooks/useAuth'
import { canSeeFinancials } from '@/services/supabase'

/**
 * Auto-sync polling de pagamentos Asaas.
 *
 * Comportamento:
 *  - Só roda se usuário pode ver financeiro (admin/supervisor)
 *  - Lê intervalo de db.getSettings().asaasSyncIntervalMin (default 15min, 0 desliga)
 *  - Pausa quando a aba não está visível (Page Visibility API)
 *  - Não roda se sem chave Asaas configurada
 *  - Falhas viram console.warn, sem toast — pra não poluir
 */
export function useAsaasAutoSync(): void {
  const { profile } = useAuth()
  const canSee = canSeeFinancials(profile?.role)

  // Tick: força re-leitura dos settings quando atualizam
  const [tick, setTick] = React.useState(0)
  React.useEffect(() => db.subscribe(() => setTick((n) => n + 1)), [])

  const settings = db.getSettings()
  const intervalMin = settings.asaasSyncIntervalMin ?? 15
  const hasKey = Boolean(settings.asaasApiKey)
  const enabled = canSee && hasKey && intervalMin > 0 && isBooted()

  React.useEffect(() => {
    if (!enabled) return

    let timerId: number | null = null
    let cancelled = false
    let running = false

    const runOnce = async () => {
      if (running || document.hidden) return
      running = true
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

    const schedule = () => {
      if (cancelled) return
      timerId = window.setTimeout(
        async () => {
          await runOnce()
          schedule()
        },
        intervalMin * 60 * 1000,
      )
    }

    // Primeiro tick depois de 30s pra dar tempo da UI estabilizar
    timerId = window.setTimeout(async () => {
      await runOnce()
      schedule()
    }, 30_000)

    const onVisibility = () => {
      if (!document.hidden) void runOnce()
    }
    document.addEventListener('visibilitychange', onVisibility)

    return () => {
      cancelled = true
      if (timerId) window.clearTimeout(timerId)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [enabled, intervalMin, tick])
}
