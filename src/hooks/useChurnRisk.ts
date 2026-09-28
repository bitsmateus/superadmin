import { useQuery, useQueryClient } from '@tanstack/react-query'
import { churnRiskService } from '@/services/churnRisk'

/** Sem refetch automático — a reconciliação de canais (um dos sinais) é uma chamada ao vivo pro
 *  NX Monitor, não vale ficar repetindo sozinho. Atualiza ao entrar na tela e com o botão manual. */
export function useChurnRisk() {
  return useQuery({
    queryKey: ['churn-risk'],
    queryFn: () => churnRiskService.list(),
    staleTime: 5 * 60 * 1000,
  })
}

/** Agregados pra tela de Relatórios — mesmo cálculo do useChurnRisk, direto do servidor (não
 *  recalcula em cima da lista já carregada, pra bater sempre com o histórico de flags manuais). */
export function useChurnRiskReport(enabled: boolean) {
  return useQuery({
    queryKey: ['churn-risk-report'],
    queryFn: () => churnRiskService.report(),
    staleTime: 5 * 60 * 1000,
    enabled,
  })
}

/** Invalida a lista e o relatório juntos — usado depois de marcar/resolver um risco manual. */
export function useInvalidateChurnRisk() {
  const qc = useQueryClient()
  return () => {
    void qc.invalidateQueries({ queryKey: ['churn-risk'] })
    void qc.invalidateQueries({ queryKey: ['churn-risk-report'] })
  }
}
