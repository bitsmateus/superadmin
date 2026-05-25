import * as React from 'react'

/**
 * Fecha um popover/menu quando o usuário clica fora do elemento referenciado
 * ou aperta ESC. Use no contêiner do dropdown.
 *
 * Uso:
 *   const ref = React.useRef<HTMLDivElement>(null)
 *   useOutsideClose(ref, open, () => setOpen(false))
 *   return <div ref={ref}>…</div>
 */
export function useOutsideClose<T extends HTMLElement>(
  ref: React.RefObject<T>,
  open: boolean,
  onClose: () => void,
): void {
  React.useEffect(() => {
    if (!open) return
    const onMouseDown = (e: MouseEvent) => {
      const el = ref.current
      if (!el) return
      if (e.target instanceof Node && !el.contains(e.target)) onClose()
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('mousedown', onMouseDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onMouseDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [ref, open, onClose])
}
