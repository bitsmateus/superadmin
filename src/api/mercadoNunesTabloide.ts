import type { DadosTabloide } from '../../server/src/lib/tabloide/layout'

/**
 * Cliente da API do tabloide (/mercadonunes/tabloide). Página pública, sem login.
 */

export const API_URL = import.meta.env.VITE_API_URL ?? ''
const BASE = `${API_URL}/api/public/mercadonunes`

export interface ProdutoCatalogo {
  id: string
  nome: string
  detalhe: string
  marca: string
  ean: string | null
  fundo_removido: boolean
  foto_versao: number
  tem_foto: boolean
  updated_at: string
}

export interface TabloideSalvo {
  id: string
  titulo: string
  dados: DadosTabloide
  criado_por: string | null
  created_at: string
  updated_at: string
}

export interface ConfigTabloide {
  endereco: string
  whatsapp: string
  endereco2: string
  whatsapp2: string
  aviso: string
  removeBg: boolean
  cosmos: boolean
  ia: boolean
}

export interface LayoutTabloide {
  id: string
  nome: string
  dados: DadosTabloide
  created_at: string
}

export type ModoRecorte = 'auto' | 'sem' | 'removebg'

export const fotoDoProduto = (p: Pick<ProdutoCatalogo, 'id' | 'foto_versao' | 'tem_foto'>): string | null =>
  p.tem_foto ? `${BASE}/produtos/${p.id}/foto?v=${p.foto_versao}` : null

async function req<T>(path: string, options: RequestInit = {}, comoBlob = false): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...options,
    headers: {
      ...(options.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
    },
  })
  if (!res.ok) {
    const corpo = await res.json().catch(() => ({}))
    throw new Error((corpo as { message?: string }).message ?? `Erro ${res.status}`)
  }
  return (comoBlob ? res.blob() : res.json()) as Promise<T>
}

const json = (body: unknown): RequestInit => ({ method: 'POST', body: JSON.stringify(body) })

export const tabloideApi = {
  produtos: (q = '') => req<{ produtos: ProdutoCatalogo[] }>(`/produtos?q=${encodeURIComponent(q)}`),
  criarProduto: (dados: { nome: string; detalhe?: string; marca?: string; ean?: string; foto?: string; modo?: ModoRecorte }) =>
    req<{ produto: ProdutoCatalogo; aviso: string | null }>('/produtos', json(dados)),
  editarProduto: (id: string, dados: Partial<Pick<ProdutoCatalogo, 'nome' | 'detalhe' | 'marca' | 'ean'>>) =>
    req<ProdutoCatalogo>(`/produtos/${id}`, { method: 'PATCH', body: JSON.stringify(dados) }),
  fotoDoProduto: (id: string, foto: string | null, modo: ModoRecorte) =>
    req<{ produto: ProdutoCatalogo; aviso: string | null }>(`/produtos/${id}/foto`, json({ foto, modo })),
  removerProduto: (id: string) => req<{ ok: true }>(`/produtos/${id}`, { method: 'DELETE' }),
  combinar: (itens: { nome: string; detalhe: string; ean: string }[]) =>
    req<{ resultados: { produto: ProdutoCatalogo | null; nota: number }[] }>('/produtos/combinar', json({ itens })),
  porEan: (ean: string, nome?: string, detalhe?: string) =>
    req<{ produto: ProdutoCatalogo; fonte: string; aviso: string | null }>('/produtos/ean', json({ ean, nome, detalhe })),

  config: () => req<ConfigTabloide>('/tabloide/config'),
  salvarConfig: (c: Partial<Pick<ConfigTabloide, 'endereco' | 'whatsapp' | 'endereco2' | 'whatsapp2' | 'aviso'>>) =>
    req<ConfigTabloide>('/tabloide/config', { method: 'PATCH', body: JSON.stringify(c) }),

  tabloides: () => req<{ tabloides: TabloideSalvo[] }>('/tabloides'),
  criarTabloide: (titulo: string, dados: DadosTabloide) => req<TabloideSalvo>('/tabloides', json({ titulo, dados })),
  salvarTabloide: (id: string, titulo: string, dados: DadosTabloide) =>
    req<TabloideSalvo>(`/tabloides/${id}`, { method: 'PATCH', body: JSON.stringify({ titulo, dados }) }),
  removerTabloide: (id: string) => req<{ ok: true }>(`/tabloides/${id}`, { method: 'DELETE' }),

  layouts: () => req<{ layouts: LayoutTabloide[] }>('/tabloide/layouts'),
  salvarLayout: (nome: string, dados: DadosTabloide) => req<LayoutTabloide>('/tabloide/layouts', json({ nome, dados })),
  removerLayout: (id: string) => req<{ ok: true }>(`/tabloide/layouts/${id}`, { method: 'DELETE' }),

  exportarPng: (dados: DadosTabloide) =>
    req<{ arquivos: { nome: string; dataUrl: string }[] }>('/tabloides/exportar', json({ dados, saida: 'png' })),
  exportarPdf: (dados: DadosTabloide) => req<Blob>('/tabloides/exportar', json({ dados, saida: 'pdf' }), true),
  gerarVideo: (dados: DadosTabloide) => req<{ id: string; paginasNoVideo: number }>('/tabloides/video', json({ dados })),
  statusVideo: (id: string) =>
    req<{ status: 'gerando' | 'pronto' | 'erro'; progresso: number; erro: string | null; tamanho: number }>(`/tabloides/video/${id}`),
  baixarVideo: (id: string) => req<Blob>(`/tabloides/video/${id}/arquivo`, {}, true),
  legenda: (dados: DadosTabloide) => req<{ legenda: string }>('/tabloides/legenda', json({ dados })),
  instagram: () => req<{ ok: boolean; username?: string; cliente?: string; motivo?: string }>('/tabloides/instagram'),
  testarConexao: () =>
    req<{ itens: { nome: string; status: 'ok' | 'aviso' | 'erro'; detalhe: string }[]; podePublicar: boolean }>(
      '/tabloides/instagram/testar',
      json({ base_url: API_URL || window.location.origin }),
    ),
  publicar: (p: {
    dados: DadosTabloide
    formato: 'feed' | 'story' | 'reels'
    legenda: string
    agendado_para: string | null
    redes: ('instagram' | 'facebook')[]
    video_id?: string
  }) =>
    req<{ producaoId: string; agendadoPara: string; imagens: number }>(
      '/tabloides/publicar',
      json({ ...p, base_url: API_URL || window.location.origin }),
    ),
}

/** Lê um arquivo do computador/celular como data URL (pra mandar a foto). Reduz fotos enormes antes. */
export function lerImagem(arquivo: File, max = 1600): Promise<string> {
  return new Promise((resolve, reject) => {
    const leitor = new FileReader()
    leitor.onerror = () => reject(new Error('Não consegui ler a imagem.'))
    leitor.onload = () => {
      const url = String(leitor.result)
      const img = new Image()
      img.onerror = () => reject(new Error('Esse arquivo não é uma imagem.'))
      img.onload = () => {
        const escala = Math.min(1, max / Math.max(img.width, img.height))
        if (escala === 1 && arquivo.size < 4 * 1024 * 1024) return resolve(url)
        const c = document.createElement('canvas')
        c.width = Math.round(img.width * escala)
        c.height = Math.round(img.height * escala)
        c.getContext('2d')?.drawImage(img, 0, 0, c.width, c.height)
        resolve(c.toDataURL(arquivo.type === 'image/png' ? 'image/png' : 'image/jpeg', 0.92))
      }
      img.src = url
    }
    leitor.readAsDataURL(arquivo)
  })
}

/** Foto de fundo: sempre vira JPEG de até 1920px, pra caber no rascunho e no histórico. */
export function lerFundo(arquivo: File, max = 1920): Promise<string> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(arquivo)
    const img = new Image()
    img.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('Esse arquivo não é uma imagem.'))
    }
    img.onload = () => {
      const escala = Math.min(1, max / Math.max(img.width, img.height))
      const c = document.createElement('canvas')
      c.width = Math.round(img.width * escala)
      c.height = Math.round(img.height * escala)
      const ctx = c.getContext('2d')
      if (!ctx) return reject(new Error('Não consegui ler a imagem.'))
      ctx.fillStyle = '#fff'
      ctx.fillRect(0, 0, c.width, c.height)
      ctx.drawImage(img, 0, 0, c.width, c.height)
      URL.revokeObjectURL(url)
      resolve(c.toDataURL('image/jpeg', 0.82))
    }
    img.src = url
  })
}

export function baixarArquivo(conteudo: Blob | string, nome: string): void {
  const url = typeof conteudo === 'string' ? conteudo : URL.createObjectURL(conteudo)
  const a = document.createElement('a')
  a.href = url
  a.download = nome
  document.body.appendChild(a)
  a.click()
  a.remove()
  if (typeof conteudo !== 'string') setTimeout(() => URL.revokeObjectURL(url), 5000)
}
