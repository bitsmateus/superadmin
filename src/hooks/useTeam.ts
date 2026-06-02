import * as React from 'react'
import { api } from '@/services/api'

export interface TeamMember {
  id: string
  name: string | null
  email: string
  role: string
}

/** Lista de membros do time (pro seletor de responsável). Carrega uma vez. */
export function useTeam(): TeamMember[] {
  const [team, setTeam] = React.useState<TeamMember[]>([])
  React.useEffect(() => {
    let cancelled = false
    api
      .get<TeamMember[]>('/api/team')
      .then((rows) => {
        if (!cancelled) setTeam(rows ?? [])
      })
      .catch(() => {
        /* sem permissão / offline — fica vazio */
      })
    return () => {
      cancelled = true
    }
  }, [])
  return team
}

export function teamMemberLabel(m: TeamMember): string {
  return m.name?.trim() || m.email
}
