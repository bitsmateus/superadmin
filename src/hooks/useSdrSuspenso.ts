import * as React from 'react'
import { useTeamProfiles } from '@/hooks/useTeamProfiles'
import { sdrSuspensoEntre } from '@/lib/sdrEQuadro'

/** (sdr) => true quando a etiqueta de SDR é de alguém suspenso/removido — fica fora das listas de escolha. */
export function useSdrSuspenso(): (sdr: string) => boolean {
  const { data } = useTeamProfiles()
  return React.useCallback((sdr: string) => sdrSuspensoEntre(data ?? [], sdr), [data])
}
