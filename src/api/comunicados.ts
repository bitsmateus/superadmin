import { api } from '@/services/api'

/** Menu Comunicados — changelog público (/novidades), base de contatos e disparo por template da API
 *  Oficial. Ver server/src/routes/comunicados.ts. */

export type TipoComunicado = 'novidade' | 'melhoria' | 'correcao' | 'aviso'

export interface ComunicadoPost {
  id: string
  titulo: string
  corpo: string
  tipo: TipoComunicado
  publicado_em: string | null
  criado_por?: string
  created_at?: string
  updated_at?: string
}

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

export const TIPO_LABEL: Record<TipoComunicado, string> = {
  novidade: 'Novidade',
  melhoria: 'Melhoria',
  correcao: 'Correção',
  aviso: 'Aviso',
}

export const comunicadosApi = {
  posts: () => api.get<ComunicadoPost[]>('/api/comunicados/posts'),
  criarPost: (body: { titulo: string; corpo: string; tipo: TipoComunicado; publicar: boolean }) =>
    api.post<ComunicadoPost>('/api/comunicados/posts', body),
  editarPost: (id: string, body: Partial<{ titulo: string; corpo: string; tipo: TipoComunicado; publicado: boolean }>) =>
    api.patch<ComunicadoPost>(`/api/comunicados/posts/${id}`, body),
  excluirPost: (id: string) => api.delete(`/api/comunicados/posts/${id}`),

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

export const novidadesPublicApi = {
  list: () => api.get<ComunicadoPost[]>('/api/public/novidades'),
}

/** Link da página pública de atualizações, no domínio onde o painel está aberto. */
export function linkNovidades(): string {
  return `${window.location.origin}/novidades`
}
