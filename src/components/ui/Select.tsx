import * as React from 'react'
import { ChevronDown } from 'lucide-react'
import { cn } from '@/lib/utils'

export interface SelectOption {
  value: string
  label: string
}

export interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  label?: string
  options: SelectOption[]
  hint?: string
  error?: string
}

export const Select = React.forwardRef<HTMLSelectElement, SelectProps>(
  ({ className, label, options, hint, error, id, ...rest }, ref) => {
    const inputId = id || React.useId()
    return (
      <div className="w-full">
        {label && (
          <label htmlFor={inputId} className="mb-1.5 block text-xs font-medium text-foreground/70">
            {label}
          </label>
        )}
        <div className="relative">
          <select
            ref={ref}
            id={inputId}
            className={cn(
              'h-10 w-full appearance-none rounded-lg bg-surface px-3 pr-9 text-sm text-foreground',
              'border border-elevate/10 focus:outline-none transition-colors',
              'focus:border-accent focus:ring-4 focus:ring-accent/15',
              error && 'border-danger/60 focus:border-danger focus:ring-danger/15',
              className,
            )}
            {...rest}
          >
            {options.map((opt) => (
              <option key={opt.value} value={opt.value} className="bg-card text-foreground">
                {opt.label}
              </option>
            ))}
          </select>
          <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-foreground/40" />
        </div>
        {(hint || error) && (
          <p className={cn('mt-1.5 text-xs', error ? 'text-danger' : 'text-foreground/40')}>
            {error || hint}
          </p>
        )}
      </div>
    )
  },
)
Select.displayName = 'Select'
