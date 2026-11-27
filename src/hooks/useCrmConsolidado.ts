import { useQuery } from '@tanstack/react-query'
import { api } from '@/services/api'

/** A aba que junta os CRMs depois da consolidação (o id não muda; o nome vira "CRM LUIS ATUALIZADO"). */
export const PAGINA_UNIFICADA = 'crm-arthur'

/** Os CRMs já foram consolidados? Até lá a tela se comporta como sempre. */
export function useCrmConsolidado(): boolean {
  const { data } = useQuery({
    queryKey: ['crm-consolidacao'],
    queryFn: () => api.get<{ consolidado: boolean }>('/api/crm/consolidacao'),
    staleTime: 60 * 1000,
  })
  return !!data?.consolidado
}
