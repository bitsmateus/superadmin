import { useQuery } from '@tanstack/react-query'
import { churnRiskService } from '@/services/churnRisk'

/** Sem refetch automático — a reconciliação de canais (um dos 4 sinais) é uma chamada ao vivo pro
 *  NX Monitor, não vale ficar repetindo sozinho. Atualiza ao entrar na tela e com o botão manual. */
export function useChurnRisk() {
  return useQuery({
    queryKey: ['churn-risk'],
    queryFn: () => churnRiskService.list(),
    staleTime: 5 * 60 * 1000,
  })
}
