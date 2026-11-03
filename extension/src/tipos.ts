/** Mensagens entre popup, service worker e content script. */
import type { AnonimizacaoAutomatica, RegraDeAnonimizacao } from '../../src/lib/demoStudio/anonimizar'

export type Modo = 'imagem' | 'html'

export interface Clique {
  x: number
  y: number
  w: number
  h: number
  selector?: string
  text?: string
}

/** O que o content script manda a cada clique (ou atalho): o print sai no service worker. */
export interface DadosDaTela {
  click: Clique | null
  viewport: { width: number; height: number; dpr: number }
  url: string
  title: string
  html?: string
}

/** Tela guardada no IndexedDB até o envio. */
export interface TelaCapturada extends DadosDaTela {
  id: string
  ordem: number
  image: string
}

export interface ConfigDoConteudo {
  anonimizar: boolean
  modo: Modo
  regras: RegraDeAnonimizacao[]
  auto: AnonimizacaoAutomatica
  total: number
}

/** Estado da captura (chrome.storage.session: sobrevive ao service worker dormir). */
export interface Estado {
  fase: 'parado' | 'gravando' | 'revisando' | 'enviando'
  tabId?: number
  demoId?: string
  demoNome?: string
  modo?: Modo
  anonimizar?: boolean
  total?: number
  envio?: { feito: number; total: number; erro?: string; editorUrl?: string; concluido?: boolean }
  aviso?: string
}

export type MsgParaSw =
  | { tipo: 'iniciar'; tabId: number; demoId: string; demoNome: string; anonimizar: boolean; modo: Modo }
  | { tipo: 'tela'; dados: DadosDaTela }
  | { tipo: 'css'; css: string }
  | { tipo: 'capturarAgora' }
  | { tipo: 'finalizar' }
  | { tipo: 'enviar'; removidas: string[] }
  | { tipo: 'descartar' }

export type MsgParaConteudo =
  | { tipo: 'config'; config: ConfigDoConteudo }
  | { tipo: 'capturarAgora' }
  | { tipo: 'total'; total: number; aviso?: string }
  | { tipo: 'parar' }

export const LIMITE_TELAS = 40
