import * as React from 'react'

/** Retorna uma versão "debounced" de fn — só dispara `delayMs` depois da última chamada. */
export function useDebouncedCallback<A extends unknown[]>(
  fn: (...args: A) => void,
  delayMs: number,
): (...args: A) => void {
  const fnRef = React.useRef(fn)
  fnRef.current = fn

  const timeoutRef = React.useRef<ReturnType<typeof setTimeout>>()
  React.useEffect(() => () => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current)
  }, [])

  return React.useCallback(
    (...args: A) => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current)
      timeoutRef.current = setTimeout(() => fnRef.current(...args), delayMs)
    },
    [delayMs],
  )
}
