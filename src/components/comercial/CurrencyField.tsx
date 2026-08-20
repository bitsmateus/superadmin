import * as React from 'react'
import { useDebouncedCallback } from '@/hooks/useDebouncedCallback'
import { cn } from '@/lib/utils'

/** Só dígitos e, no máximo, uma vírgula com até 2 casas — sem "R$" nem separador de milhar,
 * pra não brigar com a posição do cursor enquanto a pessoa ainda tá digitando. */
function sanitizeRaw(input: string): string {
  let s = input.replace(/^R\$\s?/, '').replace(/\./g, '').replace(/[^\d,]/g, '')
  const firstComma = s.indexOf(',')
  if (firstComma !== -1) {
    s = s.slice(0, firstComma + 1) + s.slice(firstComma + 1).replace(/,/g, '')
  }
  const [intPart, decPart] = s.split(',')
  if (decPart !== undefined && decPart.length > 2) s = `${intPart},${decPart.slice(0, 2)}`
  return s
}

/** Digitou só a parte inteira (ex.: "250") = R$ 250,00 direto — não precisa completar com zeros.
 * Só entra centavo diferente se a pessoa mesmo digitar a vírgula (ex.: "299,9" = R$ 299,90). */
function prettifyRaw(raw: string): string {
  const [intPart, decPart] = raw.split(',')
  const intNumber = parseInt(intPart || '0', 10) || 0
  const cents = (decPart ?? '00').padEnd(2, '0').slice(0, 2)
  return `R$ ${intNumber.toLocaleString('pt-BR')},${cents}`
}

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
        className={cn('h-full w-full outline-none placeholder:text-gray-300', className)}
      />
    )
  },
)
