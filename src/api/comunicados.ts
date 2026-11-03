import { api } from '@/services/api'

/** Menu Comunicados — base de contatos e disparo por template da API Oficial. As novidades são escritas
 *  no site de ajuda (ajuda.nxsystems.com.br); aqui só vai o link. Ver server/src/routes/comunicados.ts. */

/** Site de ajuda (repo faqnx) — é lá que se escrevem as novidades, com o editor de foto e vídeo de lá. */
export const SITE_AJUDA = 'https://ajuda.nxsystems.com.br'

/** Página de novidades no site de ajuda: o link que vai no template "atualizações da semana". */
export const LINK_NOVIDADES = `${SITE_AJUDA}/novidades-e-atualizacoes`

export type OrigemContato = 'canais' | 'visao_geral' | 'manual'

export interface ContatoComunicado {
  numero: string
  nome: string
  clientes: { id: string; nome: string }[]
  origens: OrigemContato[]
  incluido: boolean
  manual: boolean
  invalido: boolean
}

export interface TemplateComunicado {
  id: string
  nome: string
  titulo: string
  categoria: 'UTILITY' | 'MARKETING'
  corpo: string
  variaveis: ('nome' | 'link' | 'texto')[]
}

export interface DisparoComunicado {
  id: string
  template: string
  parametros: { link?: string; texto?: string }
  status: 'enviando' | 'concluido' | 'cancelado'
  criado_por: string
  created_at: string
  finished_at: string | null
  total: number
  enviados: number
  falhas: number
  pendentes: number
}

export interface ItemDisparo {
  id: string
  numero: string
  nome: string
  status: 'pendente' | 'enviado' | 'falhou' | 'cancelado'
  detalhe: string | null
  enviado_em: string | null
}

export const comunicadosApi = {
  contatos: () => api.get<ContatoComunicado[]>('/api/comunicados/contatos'),
  marcarContato: (numero: string, incluido: boolean) =>
    api.put(`/api/comunicados/contatos/${encodeURIComponent(numero)}`, { incluido }),
  adicionarContato: (numero: string, nome: string) => api.post('/api/comunicados/contatos', { numero, nome }),
  removerContato: (numero: string) => api.delete(`/api/comunicados/contatos/${encodeURIComponent(numero)}`),

  templates: () => api.get<TemplateComunicado[]>('/api/comunicados/templates'),
  teste: (body: { numero: string; template: string; link?: string; texto?: string }) =>
    api.post('/api/comunicados/teste', body),
  disparos: () => api.get<DisparoComunicado[]>('/api/comunicados/disparos'),
  itens: (id: string) => api.get<ItemDisparo[]>(`/api/comunicados/disparos/${id}/itens`),
  disparar: (body: { template: string; link?: string; texto?: string }) =>
    api.post<{ id: string; total: number }>('/api/comunicados/disparos', body),
  cancelar: (id: string) => api.post(`/api/comunicados/disparos/${id}/cancelar`),
}
