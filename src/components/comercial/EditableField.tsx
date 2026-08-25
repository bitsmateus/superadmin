import * as React from 'react'
import { useDebouncedCallback } from '@/hooks/useDebouncedCallback'
import { cn } from '@/lib/utils'

export interface EditableFieldProps {
  value: string
  type?: 'text' | 'date' | 'datetime-local'
  placeholder?: string
  onSave: (next: string) => void
  className?: string
}

/** Campo com auto-save: salva com debounce enquanto digita e também ao sair do campo. */
export const EditableField = React.forwardRef<HTMLInputElement, EditableFieldProps>(
  function EditableField({ value, type = 'text', placeholder, onSave, className }, ref) {
    const [local, setLocal] = React.useState(value)
    const focusedRef = React.useRef(false)
    const debouncedSave = useDebouncedCallback((next: string) => onSave(next), 600)

    React.useEffect(() => {
      if (!focusedRef.current) setLocal(value)
    }, [value])

    return (
      <input
        ref={ref}
        type={type}
        value={local}
        placeholder={placeholder}
        onFocus={() => { focusedRef.current = true }}
        onChange={(e) => {
          setLocal(e.target.value)
          debouncedSave(e.target.value)
        }}
        onBlur={() => {
          focusedRef.current = false
          if (local !== value) onSave(local)
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
        }}
        className={cn('h-full w-full outline-none placeholder:text-foreground/30', className)}
      />
    )
  },
)
