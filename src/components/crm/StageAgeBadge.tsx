import { resolveStageSla } from '@/constants/stageColors'
import { daysSince } from '@/lib/time'
import { useSettings } from '@/hooks/useClients'
import { cn } from '@/lib/utils'
import type { PipelineStage } from '@/types/client'

/** Quantos dias o cliente está na etapa atual — muda de cor (aviso/estourado) conforme o SLA
 * configurado por etapa. Usado no Pipeline e em qualquer outra lista que agrupe clientes por
 * etapa (ex.: Contrato). */
export function StageAgeBadge({ stage, since }: { stage: PipelineStage; since: string }) {
  const settings = useSettings()
  const days = daysSince(since)
  const sla = resolveStageSla(stage, settings.slaByStage)
  let cls = 'bg-elevate/[0.05] text-foreground/55 ring-line'
  let title = `${days} dia(s) nesta etapa`
  if (sla != null) {
    if (days > sla) {
      cls = 'bg-danger/15 text-danger ring-danger/30'
      title = `${days} dia(s) — SLA de ${sla} dias estourado`
    } else if (days >= sla) {
      cls = 'bg-warning/15 text-warning ring-warning/30'
      title = `${days} dia(s) — no limite do SLA (${sla} dias)`
    }
  }
  return (
    <span
      title={title}
      className={cn(
        'inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium tabular-nums ring-1',
        cls,
      )}
    >
      {days}d
    </span>
  )
}
