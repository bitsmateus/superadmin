import * as React from 'react'
import { useAuthStore } from '@/store/authStore'

/**
 * Filtro de servidores compartilhado entre Dashboard/Tenants/Clients/Pipeline.
 *
 * Persiste em localStorage (chave única) pra que a seleção do usuário
 * sobreviva navegação e refresh. Filtra ids que não estão mais habilitados.
 */
const LS_KEY = 'tenanthub_server_filter'

function readLs(): string[] | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = window.localStorage.getItem(LS_KEY)
    if (!raw) return null
    const arr = JSON.parse(raw)
    return Array.isArray(arr) ? (arr as string[]) : null
  } catch {
    return null
  }
}

function writeLs(ids: string[]): void {
  try {
    window.localStorage.setItem(LS_KEY, JSON.stringify(ids))
  } catch {
    /* ignore */
  }
}

export function useServerFilter(): {
  selected: Set<string>
  setSelected: (next: Set<string>) => void
} {
  const enabledIds = useAuthStore((s) =>
    s.servers.filter((x) => x.enabled).map((x) => x.id),
  )
  const enabledKey = enabledIds.join(',')

  const [selected, setSelectedRaw] = React.useState<Set<string>>(() => {
    const persisted = readLs()
    if (persisted && persisted.length > 0) {
      const valid = persisted.filter((id) => enabledIds.includes(id))
      if (valid.length > 0) return new Set(valid)
    }
    return new Set(enabledIds)
  })

  // Quando a lista de servidores habilitados muda, garante consistência:
  // remove ids que não existem mais e adiciona novos se ficou vazio.
  React.useEffect(() => {
    setSelectedRaw((prev) => {
      const next = new Set<string>()
      for (const id of prev) {
        if (enabledIds.includes(id)) next.add(id)
      }
      if (next.size === 0) for (const id of enabledIds) next.add(id)
      return next
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabledKey])

  const setSelected = React.useCallback((next: Set<string>) => {
    setSelectedRaw(next)
    writeLs(Array.from(next))
  }, [])

  return { selected, setSelected }
}
