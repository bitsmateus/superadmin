import * as React from 'react'
import { DatePickerField } from '@/components/comercial/DatePickerField'
import { cn } from '@/lib/utils'

/**
 * Campo de data com a mesma caixa dos <Input> do módulo.
 *
 * O DatePickerField é só o botão com o calendário flutuante (sem borda, sem altura própria), pra
 * poder viver dentro de uma célula de tabela. Num formulário, ao lado de um Input, ele ficava
 * "solto", sem caixa nem alinhamento — este componente dá a moldura e o rótulo.
 */
export function CampoData({
  label,
  value,
  onChange,
  hint,
  className,
}: {
  label?: string
  value: string | null
  onChange: (v: string | null) => void
  hint?: string
  className?: string
}) {
  return (
    <div className={className}>
      {label && (
        <label className="mb-1.5 block text-xs font-medium text-foreground/70">{label}</label>
      )}
      <div
        className={cn(
          'flex h-9 items-center rounded-lg border border-line bg-transparent px-3',
          'focus-within:border-accent/60',
        )}
      >
        <DatePickerField value={value} onChange={onChange} placeholder="dd/mm/aaaa" />
      </div>
      {hint && <p className="mt-1 text-[11px] text-foreground/45">{hint}</p>}
    </div>
  )
}

/** Versão miúda, pra viver dentro de uma linha de checklist sem empurrar o resto. */
export function DataMiuda({
  value,
  onChange,
  atrasado,
}: {
  value: string | null
  onChange: (v: string | null) => void
  atrasado?: boolean
}) {
  return (
    <span
      className={cn(
        'inline-flex h-6 items-center rounded-md border px-1.5 text-xs',
        atrasado ? 'border-danger/40 text-danger' : 'border-line text-foreground/55',
      )}
    >
      <DatePickerField value={value} onChange={onChange} placeholder="prazo" />
    </span>
  )
}
