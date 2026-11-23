import { gestaoClientes, type GcSocialAnexo, type GcSocialProducao, type GcSocialStatus } from '@/services/gestaoClientes'

/** As 6 etapas do fluxo de criação, na ordem do quadro. */
export const ETAPAS_ARTE: { valor: GcSocialStatus; titulo: string; ajuda: string; cor: string }[] = [
  { valor: 'para_producao', titulo: 'Pedido', ajuda: 'A social media pediu; esperando a designer pegar', cor: 'bg-warning' },
  { valor: 'em_producao', titulo: 'Em criação', ajuda: 'A designer está criando (ou corrigindo um ajuste)', cor: 'bg-accent' },
  { valor: 'revisao', titulo: 'Revisão interna', ajuda: 'Arte pronta: a social media confere antes do cliente', cor: 'bg-violet-500' },
  { valor: 'com_cliente', titulo: 'Com o cliente', ajuda: 'Enviada pro cliente aprovar (PDF ou portal)', cor: 'bg-orange-500' },
  { valor: 'aprovado', titulo: 'Aprovado', ajuda: 'O cliente aprovou: pronta pro tráfego', cor: 'bg-success' },
  { valor: 'trafego', titulo: 'No tráfego', ajuda: 'O gestor já usou no anúncio (ou foi postada)', cor: 'bg-emerald-700' },
]
export const nomeDaEtapa = (s: GcSocialStatus) => ETAPAS_ARTE.find((e) => e.valor === s)?.titulo ?? s

export const ehFinal = (a: GcSocialAnexo) => a.papel !== 'referencia'
export const artesFinais = (p: Pick<GcSocialProducao, 'anexos'>) => (p.anexos ?? []).filter(ehFinal)
export const imagensFinais = (p: Pick<GcSocialProducao, 'anexos'>) => artesFinais(p).filter((a) => a.type.startsWith('image/'))
export const midiasFinais = (p: Pick<GcSocialProducao, 'anexos'>) => artesFinais(p).filter((a) => /^(image|video)\//.test(a.type))

/** Mês (YYYY-MM) de hoje, no fuso de quem vê. */
export function mesDeHoje(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}
export function somarMes(mes: string, n: number): string {
  const [a, m] = mes.split('-').map(Number)
  const d = new Date(a, m - 1 + n, 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}
export function nomeDoMes(mes: string, curto = false): string {
  const [a, m] = mes.split('-').map(Number)
  if (!a || !m) return mes
  const n = new Date(a, m - 1, 1).toLocaleDateString('pt-BR', curto ? { month: 'short', year: '2-digit' } : { month: 'long', year: 'numeric' })
  return n[0].toUpperCase() + n.slice(1).replace(' de ', ' ')
}
/** Os meses pra escolher num select: 6 pra trás e 3 pra frente, mais o que já estiver em uso. */
export function opcoesDeMes(extra: string[] = []): { value: string; label: string }[] {
  const hoje = mesDeHoje()
  const lista = new Set<string>([...Array.from({ length: 10 }, (_, i) => somarMes(hoje, i - 6)), ...extra.filter(Boolean)])
  return [...lista].sort().reverse().map((m) => ({ value: m, label: nomeDoMes(m) }))
}

export const MAX_BYTES = 5 * 1024 * 1024

function salvarComo(href: string, nome: string) {
  const a = document.createElement('a')
  a.href = href
  a.download = nome
  document.body.appendChild(a)
  a.click()
  a.remove()
}

/** Baixa uma arte (imagem ou vídeo) pro computador. O nome do arquivo é o do próprio anexo. */
export async function baixarAnexo(a: GcSocialAnexo): Promise<void> {
  if (a.videoId) {
    const url = URL.createObjectURL(await gestaoClientes.baixarVideo(a.videoId))
    salvarComo(url, a.name || 'video.mp4')
    window.setTimeout(() => URL.revokeObjectURL(url), 10_000)
    return
  }
  salvarComo(a.dataUrl, a.name || 'arte')
}

/**
 * Baixa as artes finais de vários cards num único ZIP (um arquivo só, em vez de dezenas de downloads que o
 * navegador bloquearia). Os arquivos levam o título do card; card com mais de uma arte ganha -1, -2...
 * Devolve quantos arquivos entraram.
 */
export async function baixarZipDasArtes(cards: Pick<GcSocialProducao, 'titulo' | 'anexos'>[], nomeZip: string, aoAndar?: (feitos: number, total: number) => void): Promise<number> {
  const { default: JSZip } = await import('jszip')
  const zip = new JSZip()
  const usados = new Set<string>()
  const total = cards.reduce((s, c) => s + midiasFinais(c).length, 0)
  let feitos = 0
  const limpar = (t: string) => t.replace(/^(arte|reels|criativo|post)\s*:\s*/i, '').replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80) || 'arte'
  for (const card of cards) {
    const midias = midiasFinais(card)
    for (let i = 0; i < midias.length; i++) {
      const a = midias[i]
      const ext = (/\.([a-z0-9]{2,4})$/i.exec(a.name)?.[1] ?? (a.type.split('/')[1] || 'bin').replace('jpeg', 'jpg')).toLowerCase()
      const base = limpar(card.titulo) + (midias.length > 1 ? `-${i + 1}` : '')
      let nome = `${base}.${ext}`
      for (let n = 2; usados.has(nome.toLowerCase()); n++) nome = `${base} (${n}).${ext}`
      usados.add(nome.toLowerCase())
      if (a.videoId) zip.file(nome, await gestaoClientes.baixarVideo(a.videoId))
      else zip.file(nome, a.dataUrl.slice(a.dataUrl.indexOf(',') + 1), { base64: true })
      aoAndar?.(++feitos, total)
    }
  }
  if (total === 0) return 0
  const blob = await zip.generateAsync({ type: 'blob', compression: 'STORE' })
  const url = URL.createObjectURL(blob)
  salvarComo(url, nomeZip)
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000)
  return total
}

/** Baixa toda a arte final de um card (uma por vez, com um respiro pro navegador não bloquear). */
export async function baixarArtesDoCard(p: Pick<GcSocialProducao, 'anexos'>): Promise<number> {
  const lista = midiasFinais(p)
  for (let i = 0; i < lista.length; i++) {
    if (i > 0) await new Promise((r) => setTimeout(r, 250))
    await baixarAnexo(lista[i])
  }
  return lista.length
}
export const MAX_VIDEO_BYTES = 100 * 1024 * 1024

/** A miniatura do card: a primeira imagem da arte final ou, num Reels, a capa do vídeo. */
export const capaDoCard = (p: Pick<GcSocialProducao, 'anexos'>): string =>
  imagensFinais(p)[0]?.dataUrl || midiasFinais(p).find((a) => a.type.startsWith('video/') && a.capa)?.capa || ''
export const videoDoCard = (p: Pick<GcSocialProducao, 'anexos'>) => midiasFinais(p).find((a) => a.type.startsWith('video/'))

/** O quadro que o vídeo está mostrando agora, como JPG (data URL). */
export function quadroDoVideo(v: HTMLVideoElement): string {
  const escala = Math.min(1, 1080 / (v.videoWidth || 1080))
  const c = document.createElement('canvas')
  c.width = Math.round((v.videoWidth || 1080) * escala)
  c.height = Math.round((v.videoHeight || 1920) * escala)
  c.getContext('2d')!.drawImage(v, 0, 0, c.width, c.height)
  return c.toDataURL('image/jpeg', 0.9)
}

/** Capa automática: o quadro de ~0,5s do vídeo (null se o navegador não conseguir ler o formato). */
function capaAutomatica(arquivo: File): Promise<string | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(arquivo)
    const v = document.createElement('video')
    const fim = (r: string | null) => {
      URL.revokeObjectURL(url)
      resolve(r)
    }
    const limite = window.setTimeout(() => fim(null), 15_000)
    v.muted = true
    v.preload = 'auto'
    v.onerror = () => { window.clearTimeout(limite); fim(null) }
    v.onloadedmetadata = () => { v.currentTime = Math.min(0.5, (v.duration || 1) / 2) }
    v.onseeked = () => {
      window.clearTimeout(limite)
      try { fim(quadroDoVideo(v)) } catch { fim(null) }
    }
    v.src = url
  })
}

/**
 * Anexa imagem (até 5MB, vai no card) ou vídeo (até 100MB, vai à parte) e devolve o card atualizado.
 * O vídeo já sai com uma capa automática; dá pra trocar depois em "Capa do Reels".
 */
export async function anexarMidia(cardId: string, arquivo: File, papel: 'final' | 'referencia' = 'final'): Promise<GcSocialProducao> {
  if (arquivo.type.startsWith('video/')) {
    if (arquivo.size > MAX_VIDEO_BYTES) throw new Error(`"${arquivo.name}" passa de 100MB`)
    let card = await gestaoClientes.anexarVideo(cardId, arquivo, papel)
    const capa = await capaAutomatica(arquivo)
    const anexo = card.anexos?.[card.anexos.length - 1]
    if (capa && anexo) card = await gestaoClientes.definirCapaDoAnexo(cardId, anexo.id, capa).catch(() => card)
    return card
  }
  if (arquivo.size > MAX_BYTES) throw new Error(`"${arquivo.name}" passa de 5MB — use um link do Drive pra arquivos grandes`)
  const { name, type, size, dataUrl } = await lerArquivo(arquivo)
  return gestaoClientes.anexarNaProducao(cardId, { name, type, size, dataUrl, papel })
}

export function lerArquivo(arquivo: File): Promise<{ id: string; name: string; type: string; size: number; dataUrl: string }> {
  return new Promise((resolve, reject) => {
    const leitor = new FileReader()
    leitor.onload = () =>
      resolve({
        id: crypto.randomUUID(),
        name: arquivo.name || (arquivo.type.startsWith('image/') ? 'imagem.png' : 'arquivo'),
        type: arquivo.type,
        size: arquivo.size,
        dataUrl: leitor.result as string,
      })
    leitor.onerror = reject
    leitor.readAsDataURL(arquivo)
  })
}

export const enderecoDoPortal = (token: string, aba?: string) => `${window.location.origin}/cliente/${token}${aba ? `?aba=${aba}` : ''}`

export async function copiar(texto: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(texto)
    return true
  } catch {
    return false
  }
}
