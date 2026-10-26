import * as React from 'react'
import { api, onSseEvent } from '@/services/api'

/** Notificação do comercial (ver server/src/routes/notificacoes.ts). */
export interface Notificacao {
  id: string
  tipo: 'transferencia_ia' | 'reuniao_agendada_ia' | 'resposta_proposta' | 'lead_novo_ia' | 'lead_qualificado_ia'
  titulo: string
  mensagem: string
  nome: string
  telefone: string
  ticket_nx: string
  card_id: string | null
  ultima_mensagem_lead: string
  resposta_luiza: string
  reuniao_em: string | null
  link_reuniao: string
  created_at: string
  lida: boolean
  popup_fechado: boolean
  /** "Abrir card" pra quem está olhando (null = sem card). */
  link: string | null
}

export interface SininhoDados {
  recebe: boolean
  /** Admin olhando o sininho de outra pessoa: não marca nada. */
  somente_leitura: boolean
  de: { id: string; nome: string } | null
  nao_lidas: number
  itens: Notificacao[]
}

export const notificacoesService = {
  carregar: (pagina?: string) =>
    api.get<SininhoDados>(`/api/notificacoes${pagina ? `?pagina=${encodeURIComponent(pagina)}` : ''}`),
  marcarLida: (id: string, lida: boolean) => api.post<{ ok: true }>(`/api/notificacoes/${id}/lida`, { lida }),
  marcarTodasLidas: () => api.post<{ ok: true }>('/api/notificacoes/lidas', {}),
  fecharPopup: (id: string) => api.post<{ ok: true }>(`/api/notificacoes/${id}/popup-fechado`, {}),
}

const INTERVALO_MS = 60_000
const VAZIO: SininhoDados = { recebe: false, somente_leitura: false, de: null, nao_lidas: 0, itens: [] }

/**
 * As notificações de quem está logado (ou, com `pagina`, as do dono daquela aba, pra admin só olhar). Um estado por
 * chave, dividido entre o sininho e o popup: chega na hora pelo tempo real e, de garantia, a cada 1 min.
 */
const estados = new Map<string, { dados: SininhoDados; ouvintes: Set<() => void>; parar?: () => void }>()

function estadoDe(chave: string) {
  let e = estados.get(chave)
  if (!e) { e = { dados: VAZIO, ouvintes: new Set() }; estados.set(chave, e) }
  return e
}

export async function recarregarNotificacoes(pagina?: string) {
  const e = estadoDe(pagina ?? '')
  try {
    e.dados = await notificacoesService.carregar(pagina)
    e.ouvintes.forEach((f) => f())
  } catch { /* sem rede: tenta no próximo ciclo */ }
}

/** Atualiza só na tela (antes da resposta do servidor), pro clique parecer instantâneo. */
export function ajustarNotificacoes(pagina: string | undefined, mudar: (d: SininhoDados) => SininhoDados) {
  const e = estadoDe(pagina ?? '')
  e.dados = mudar(e.dados)
  e.ouvintes.forEach((f) => f())
}

export function useNotificacoes(pagina?: string): SininhoDados {
  const chave = pagina ?? ''
  const assinar = React.useCallback((avisar: () => void) => {
    const e = estadoDe(chave)
    e.ouvintes.add(avisar)
    if (e.ouvintes.size === 1) {
      void recarregarNotificacoes(pagina)
      const timer = window.setInterval(() => { void recarregarNotificacoes(pagina) }, INTERVALO_MS)
      const desliga = onSseEvent((table) => { if (table === 'notificacao_destinatarios') void recarregarNotificacoes(pagina) })
      const aoVoltar = () => { if (document.visibilityState === 'visible') void recarregarNotificacoes(pagina) }
      document.addEventListener('visibilitychange', aoVoltar)
      e.parar = () => { window.clearInterval(timer); desliga(); document.removeEventListener('visibilitychange', aoVoltar) }
    }
    return () => {
      e.ouvintes.delete(avisar)
      if (!e.ouvintes.size) { e.parar?.(); e.parar = undefined }
    }
  }, [chave, pagina])
  return React.useSyncExternalStore(assinar, () => estadoDe(chave).dados, () => VAZIO)
}
