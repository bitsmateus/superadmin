import { useQuery } from '@tanstack/react-query'
import { api } from '@/services/api'
import { resolveArea, type Profile, type TeamArea } from '@/services/supabase'

/** Usuários cadastrados no painel (equipe) — usados para escolher responsáveis. Usa /api/team (não
 * /api/users, que é admin-only) porque esse seletor precisa funcionar pra qualquer usuário
 * autenticado, inclusive Suporte — era exatamente por chamar a rota errada que o dropdown de
 * "Responsável de entrega" aparecia vazio ("— Sem responsável —") pra quem não é admin: a chamada
 * dava 403 em silêncio e a lista de opções ficava vazia. */
export function useTeamProfiles() {
  return useQuery({
    queryKey: ['team-profiles'],
    queryFn: () => api.get<Profile[]>('/api/team'),
    staleTime: 5 * 60 * 1000,
  })
}

/**
 * Opções (label/value) de responsáveis a partir dos perfis. value = nome||email.
 *
 * `area` filtra quem aparece: passando 'comercial' ou 'entrega', só entram as
 * pessoas daquela área (e as marcadas como 'ambos'). Sem área, vem todo mundo.
 */
export function profileOptions(
  profiles: Profile[] | undefined,
  area?: TeamArea,
): { value: string; label: string }[] {
  return (profiles ?? [])
    .filter((p) => {
      if (!area || area === 'ambos') return true
      const a = resolveArea(p.area)
      return a === 'ambos' || a === area
    })
    .map((p) => {
      const v = (p.name && p.name.trim()) || p.email
      return { value: v, label: v }
    })
    .sort((a, b) => a.label.localeCompare(b.label))
}
