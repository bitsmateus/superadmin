import * as React from 'react'
import { useDebouncedCallback } from '@/hooks/useDebouncedCallback'
import { sanitizeCurrencyRaw as sanitizeRaw, prettifyCurrencyRaw as prettifyRaw } from '@/lib/currency'
import { cn } from '@/lib/utils'

export interface CurrencyFieldProps {
  value: string
  onSave: (next: string) => void
  className?: string
}

/** Campo de valor em R$: digita normal (250 → R$ 250,00), só mexe nos centavos se digitar a vírgula. */
export const CurrencyField = React.forwardRef<HTMLInputElement, CurrencyFieldProps>(
  function CurrencyField({ value, onSave, className }, ref) {
    const [local, setLocal] = React.useState(value)
    const focusedRef = React.useRef(false)
    const debouncedSave = useDebouncedCallback((next: string) => onSave(next), 600)

    React.useEffect(() => {
      if (!focusedRef.current) setLocal(value)
    }, [value])

    return (
      <input
        ref={ref}
        inputMode="decimal"
        value={local}
        placeholder="R$ 0,00"
        onFocus={(e) => {
          focusedRef.current = true
          // Tira o "R$" e os pontos de milhar pra digitar livre, sem reformatar a cada tecla.
          setLocal(sanitizeRaw(e.target.value))
        }}
        onChange={(e) => {
          const next = sanitizeRaw(e.target.value)
          setLocal(next)
          if (next) debouncedSave(prettifyRaw(next))
        }}
        onBlur={() => {
          focusedRef.current = false
          const formatted = local ? prettifyRaw(local) : ''
          setLocal(formatted)
          if (formatted !== value) onSave(formatted)
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
        }}
        className={cn('h-full w-full outline-none placeholder:text-foreground/30', className)}
      />
    )
  },
)
