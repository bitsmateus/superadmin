import { useQuery } from '@tanstack/react-query'
import { api } from '@/services/api'
import type { Profile } from '@/services/supabase'

/** Usuários cadastrados no painel (equipe) — usados para escolher responsáveis. */
export function useTeamProfiles() {
  return useQuery({
    queryKey: ['team-profiles'],
    queryFn: () => api.get<Profile[]>('/api/users'),
    staleTime: 5 * 60 * 1000,
  })
}

/** Opções (label/value) de responsáveis a partir dos perfis. value = nome||email. */
export function profileOptions(profiles: Profile[] | undefined): { value: string; label: string }[] {
  return (profiles ?? [])
    .map((p) => {
      const v = (p.name && p.name.trim()) || p.email
      return { value: v, label: v }
    })
    .sort((a, b) => a.label.localeCompare(b.label))
}
