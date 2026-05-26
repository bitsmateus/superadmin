import * as React from 'react'
import { CheckCircle2 } from 'lucide-react'
import { cn } from '@/lib/utils'

export interface TabItem {
  value: string
  label: React.ReactNode
}

export function Tabs({
  value,
  onChange,
  items,
  rightItems,
  rightLabel = 'Finalizados',
  className,
}: {
  value: string
  onChange: (v: string) => void
  items: TabItem[]
  rightItems?: TabItem[]
  rightLabel?: string
  className?: string
}) {
  const renderTab = (it: TabItem, finalized = false) => {
    const active = it.value === value
    return (
      <button
        key={it.value}
        role="tab"
        aria-selected={active}
        type="button"
        onClick={() => onChange(it.value)}
        className={cn(
          'relative inline-flex items-center gap-1.5 px-3 py-2.5 text-sm font-medium transition-colors',
          active
            ? 'text-foreground'
            : finalized
              ? 'text-success/85 hover:text-success'
              : 'text-foreground/50 hover:text-foreground/80',
        )}
      >
        {finalized && <CheckCircle2 className="h-3.5 w-3.5 text-success" />}
        {it.label}
        {active && (
          <span
            className={cn(
              'absolute inset-x-2 -bottom-px h-px',
              finalized ? 'bg-success' : 'bg-accent',
            )}
          />
        )}
      </button>
    )
  }

  return (
    <div
      className={cn(
        'flex items-center justify-between gap-2 border-b border-line px-2',
        className,
      )}
      role="tablist"
    >
      <div className="flex flex-wrap items-center gap-1">
        {items.map((it) => renderTab(it, false))}
      </div>
      {rightItems && rightItems.length > 0 && (
        <div className="flex items-center gap-1">
          <span className="px-2 text-[10px] uppercase tracking-wider text-foreground/35">
            {rightLabel}
          </span>
          <div className="flex items-center gap-1">
            {rightItems.map((it) => renderTab(it, true))}
          </div>
        </div>
      )}
    </div>
  )
}
