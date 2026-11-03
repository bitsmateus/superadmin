/**
 * Coletor de analytics do player (§8.1). Identifica o navegador (visitorId: localStorage `nxd_vid` +
 * cookie first-party de 1 ano) e a sessão (nova depois de 30 min sem atividade), junta os eventos numa
 * fila e manda em lote a cada 5s e ao sair/esconder a aba, via sendBeacon (fallback: fetch keepalive).
 * Heartbeat a cada 15s só com a aba visível — é dele que sai o tempo ativo real.
 *
 * O corpo vai como text/plain de propósito: é "requisição simples" (sem preflight de CORS), o único jeito
 * do sendBeacon funcionar entre o domínio da demo e o da API.
 */

export type EventoColetado =
  | { t: 'session_start' }
  | { t: 'step_view'; stepId: string; order: number }
  | { t: 'hotspot_click'; stepId: string }
  | { t: 'chapter_open'; chapter: string }
  | { t: 'lead_submit'; fields: Record<string, string> }
  | { t: 'cta_click'; cta: string }
  | { t: 'complete' }
  | { t: 'heartbeat'; activeMs: number }

const SESSAO_EXPIRA_MS = 30 * 60 * 1000
const INTERVALO_ENVIO_MS = 5000
const INTERVALO_HEARTBEAT_MS = 15000
const MAX_POR_LOTE = 50

function uuid(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID()
  // Navegador antigo (ex.: WebView do WhatsApp em Android velho): uuid v4 na mão.
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16)
  })
}

function lerArmazenado(chave: string): string | null {
  try {
    return window.localStorage.getItem(chave)
  } catch {
    return null
  }
}
function gravar(chave: string, valor: string) {
  try {
    window.localStorage.setItem(chave, valor)
  } catch { /* modo privado: segue só com o cookie */ }
}
function lerCookie(nome: string): string | null {
  const m = document.cookie.match(new RegExp(`(?:^|; )${nome}=([^;]*)`))
  return m ? decodeURIComponent(m[1]) : null
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function idDoVisitante(): string {
  let id = lerArmazenado('nxd_vid') || lerCookie('nxd_vid')
  if (!id || !UUID.test(id)) id = uuid()
  gravar('nxd_vid', id)
  document.cookie = `nxd_vid=${id}; max-age=31536000; path=/; SameSite=Lax`
  return id
}

/**
 * Sessão por demo: reaproveita a anterior se a última atividade foi há menos de 30 min E é do mesmo
 * visitante (quem limpou só os cookies, ou um id que sobrou de outra pessoa no mesmo aparelho, ganha
 * sessão nova — o servidor recusa sessão com visitante trocado).
 */
function idDaSessao(demoId: string, visitorId: string): { id: string; nova: boolean } {
  const chave = `nxd_sid_${demoId}`
  try {
    const salvo = JSON.parse(lerArmazenado(chave) || 'null') as { id: string; last: number; vid?: string } | null
    if (salvo && UUID.test(salvo.id) && salvo.vid === visitorId && Date.now() - salvo.last < SESSAO_EXPIRA_MS) {
      return { id: salvo.id, nova: false }
    }
  } catch { /* corrompido: sessão nova */ }
  return { id: uuid(), nova: true }
}

export interface Coletor {
  registrar: (e: EventoColetado) => void
  encerrar: () => void
}

export function criarColetor(opcoes: {
  endpoint: string
  demoId: string
  versionId: string | null
  linkCode?: string
}): Coletor {
  const visitorId = idDoVisitante()
  const sessao = idDaSessao(opcoes.demoId, visitorId)
  // Quem está logado no painel neste navegador não conta nos números (§8.1).
  const internal = !!lerArmazenado('auth_token')
  const qs = new URLSearchParams(window.location.search)
  const ctx = {
    // Sem querystring: ela pode trazer nome/empresa do lead.
    url: window.location.origin + window.location.pathname,
    referrer: document.referrer || '',
    utm: { source: qs.get('utm_source') ?? '', medium: qs.get('utm_medium') ?? '', campaign: qs.get('utm_campaign') ?? '' },
    screen: { w: window.screen?.width ?? 0, h: window.screen?.height ?? 0, dpr: window.devicePixelRatio || 1 },
    lang: navigator.language || '',
    tz: Intl.DateTimeFormat().resolvedOptions().timeZone || '',
  }

  let fila: (EventoColetado & { ts: number })[] = []
  let ultimoBatimento = document.visibilityState === 'visible' ? Date.now() : 0

  const tocarSessao = () => gravar(`nxd_sid_${opcoes.demoId}`, JSON.stringify({ id: sessao.id, last: Date.now(), vid: visitorId }))

  const enviar = (saindo: boolean) => {
    while (fila.length) {
      const lote = fila.slice(0, MAX_POR_LOTE)
      fila = fila.slice(MAX_POR_LOTE)
      const corpo = JSON.stringify({
        v: 1,
        demoId: opcoes.demoId,
        versionId: opcoes.versionId,
        linkCode: opcoes.linkCode,
        visitorId,
        sessionId: sessao.id,
        internal,
        ctx,
        events: lote,
      })
      let foi = false
      if (saindo && navigator.sendBeacon) {
        try {
          foi = navigator.sendBeacon(opcoes.endpoint, new Blob([corpo], { type: 'text/plain' }))
        } catch {
          foi = false
        }
      }
      if (!foi) {
        fetch(opcoes.endpoint, { method: 'POST', body: corpo, keepalive: true, headers: { 'Content-Type': 'text/plain' } }).catch(() => undefined)
      }
    }
  }

  const registrar = (e: EventoColetado) => {
    fila.push({ ...e, ts: Date.now() })
    tocarSessao()
  }

  /** Fecha o tempo ativo desde o último batimento (só conta enquanto a aba está visível). */
  const bater = () => {
    if (!ultimoBatimento) return
    const agora = Date.now()
    const ms = Math.min(agora - ultimoBatimento, INTERVALO_HEARTBEAT_MS + 5000)
    ultimoBatimento = agora
    if (ms > 0) registrar({ t: 'heartbeat', activeMs: ms })
  }

  const aoMudarVisibilidade = () => {
    if (document.visibilityState === 'hidden') {
      bater()
      ultimoBatimento = 0
      enviar(true)
    } else {
      ultimoBatimento = Date.now()
    }
  }
  const aoSair = () => {
    bater()
    enviar(true)
  }

  if (sessao.nova) registrar({ t: 'session_start' })
  const timerEnvio = window.setInterval(() => fila.length && enviar(false), INTERVALO_ENVIO_MS)
  const timerBatimento = window.setInterval(() => document.visibilityState === 'visible' && bater(), INTERVALO_HEARTBEAT_MS)
  document.addEventListener('visibilitychange', aoMudarVisibilidade)
  window.addEventListener('pagehide', aoSair)

  return {
    registrar,
    encerrar: () => {
      window.clearInterval(timerEnvio)
      window.clearInterval(timerBatimento)
      document.removeEventListener('visibilitychange', aoMudarVisibilidade)
      window.removeEventListener('pagehide', aoSair)
      aoSair()
    },
  }
}
