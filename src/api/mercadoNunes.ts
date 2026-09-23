import { api } from '@/services/api'

export interface MercadoNunesLayout {
  id: string
  nome: string
  patch: Record<string, unknown>
  // Pasta onde o layout foi organizado (ex.: "Bebidas"). null/vazio = sem pasta, continua
  // aparecendo na lista simples da página principal.
  pasta: string | null
  created_at: string
}

/** Layouts salvos do gerador de cartazes do Mercado Nunes — guardados no banco (compartilhado
 *  entre todo mundo que usa a página, não só no navegador de quem salvou). */
export const mercadoNunesLayoutsApi = {
  list: () => api.get<{ layouts: MercadoNunesLayout[] }>('/api/public/mercadonunes/layouts'),
  create: (nome: string, patch: Record<string, unknown>, pasta?: string | null) =>
    api.post<MercadoNunesLayout>('/api/public/mercadonunes/layouts', { nome, patch, pasta }),
  /** Move um layout já salvo pra dentro (ou pra fora, com pasta=null) de uma pasta. */
  mover: (id: string, pasta: string | null) =>
    api.patch<MercadoNunesLayout>(`/api/public/mercadonunes/layouts/${id}`, { pasta }),
  remove: (id: string) => api.delete(`/api/public/mercadonunes/layouts/${id}`),
}

export interface MercadoNunesPasta {
  id: string
  nome: string
  created_at: string
}

/** Cadastro das pastas em si — criadas num campo próprio, pra aparecerem como opção no seletor
 *  mesmo antes de qualquer layout ser movido pra dentro delas. */
export const mercadoNunesPastasApi = {
  list: () => api.get<{ pastas: MercadoNunesPasta[] }>('/api/public/mercadonunes/pastas'),
  create: (nome: string) => api.post<MercadoNunesPasta>('/api/public/mercadonunes/pastas', { nome }),
  /** Renomeia a pasta — o back também atualiza o texto guardado em todo layout que já estava nela. */
  renomear: (id: string, nome: string) => api.patch<MercadoNunesPasta>(`/api/public/mercadonunes/pastas/${id}`, { nome }),
  /** Apaga a pasta; os layouts que estavam nela voltam a ficar sem pasta (nada é excluído). */
  remove: (id: string) => api.delete(`/api/public/mercadonunes/pastas/${id}`),
}
