import { STAGE_COLORS } from '@/constants/stageColors'
import type { PipelineStage } from '@/types/client'
import { cn } from '@/lib/utils'

export function StageBadge({
  stage,
  className,
  size = 'md',
}: {
  stage: PipelineStage
  className?: string
  size?: 'sm' | 'md'
}) {
  const style = STAGE_COLORS[stage]
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-md border font-medium leading-5',
        size === 'sm'
          ? 'px-1.5 py-0 text-[10px]'
          : 'px-2 py-0.5 text-[11px]',
        className,
      )}
      style={{
        background: style.bg,
        color: style.text,
        borderColor: style.ring,
      }}
    >
      <span
        className="h-1.5 w-1.5 rounded-full"
        style={{ background: style.dot }}
      />
      {style.label}
    </span>
  )
}
