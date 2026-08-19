import * as React from 'react'
import { useDebouncedCallback } from '@/hooks/useDebouncedCallback'
import { cn } from '@/lib/utils'

/** Converte os dígitos digitados (centavos) pra "R$ 1.234,56", estilo maquininha. */
function formatBRLFromDigits(digits: string): string {
  const cents = digits ? parseInt(digits, 10) : 0
  return (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

export interface CurrencyFieldProps {
  value: string
  onSave: (next: string) => void
  className?: string
}

/** Campo de valor em R$ com mascara automatica: digitar numeros ja formata como moeda. */
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
        inputMode="numeric"
        value={local}
        placeholder="R$ 0,00"
        onFocus={() => { focusedRef.current = true }}
        onChange={(e) => {
          const digits = e.target.value.replace(/\D/g, '')
          const formatted = formatBRLFromDigits(digits)
          setLocal(formatted)
          debouncedSave(formatted)
        }}
        onBlur={() => {
          focusedRef.current = false
          if (local !== value) onSave(local)
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
        }}
        className={cn('h-full w-full outline-none placeholder:text-gray-300', className)}
      />
    )
  },
)
