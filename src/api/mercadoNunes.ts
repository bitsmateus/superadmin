import { api } from '@/services/api'

export interface MercadoNunesLayout {
  id: string
  nome: string
  patch: Record<string, unknown>
  created_at: string
}

/** Layouts salvos do gerador de cartazes do Mercado Nunes — guardados no banco (compartilhado
 *  entre todo mundo que usa a página, não só no navegador de quem salvou). */
export const mercadoNunesLayoutsApi = {
  list: () => api.get<{ layouts: MercadoNunesLayout[] }>('/api/public/mercadonunes/layouts'),
  create: (nome: string, patch: Record<string, unknown>) =>
    api.post<MercadoNunesLayout>('/api/public/mercadonunes/layouts', { nome, patch }),
  remove: (id: string) => api.delete(`/api/public/mercadonunes/layouts/${id}`),
}
