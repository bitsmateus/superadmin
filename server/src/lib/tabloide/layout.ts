/**
 * Tabloide do Mercado Nunes — o layout em si (HTML + CSS puros, sem dependência nenhuma).
 *
 * Este arquivo é usado pelos DOIS lados: o front importa pra mostrar a prévia ao vivo (iframe) e o
 * servidor importa pra gerar o PNG/PDF/vídeo no Chromium. Mesmo código = a prévia é exatamente o
 * arquivo que sai. Por isso: nada de import, nada de API de Node ou de DOM — só string.
 */

export type FormatoTabloide = 'feed' | 'story' | 'a4'

export const FORMATOS: Record<FormatoTabloide, { nome: string; dica: string; w: number; h: number; maxPorPagina: number }> = {
  feed: { nome: 'Feed', dica: 'Instagram e Facebook (1080×1350)', w: 1080, h: 1350, maxPorPagina: 12 },
  story: { nome: 'Story / Status', dica: 'Story, Reels e status do WhatsApp (1080×1920)', w: 1080, h: 1920, maxPorPagina: 12 },
  a4: { nome: 'A4 / PDF', dica: 'Para imprimir ou mandar em PDF', w: 1240, h: 1754, maxPorPagina: 20 },
}

export interface ItemTabloide {
  id: string
  nome: string
  detalhe: string
  preco: string
  precoDe: string
  unidade: string // '' | 'kg' | 'un' | '100g' | 'bandeja'...
  produtoId: string | null
  destaque: boolean
  /** Preenchido na hora de montar (URL da foto na prévia, data URL no servidor). */
  fotoUrl?: string | null
}

export interface DadosTabloide {
  titulo: string
  subtitulo: string
  validade: string
  modeloId: string
  formato: FormatoTabloide
  /** 0 = automático. */
  porPagina: number
  itens: ItemTabloide[]
  endereco: string
  whatsapp: string
  /** Segunda loja (opcional). */
  endereco2?: string
  whatsapp2?: string
  aviso: string
  /** Foto de fundo enviada pelo usuário (data URL). Vazio = fundo do modelo. */
  fundoUrl?: string
  /** Quanto escurecer a foto de fundo, 0 a 80 (%). */
  fundoEscurecer?: number
}

/** Só aceita data URL de imagem em base64 (vai dentro de url() no CSS). */
export const fundoValido = (u: unknown): string =>
  typeof u === 'string' && /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(u) ? u : ''

export interface Modelo {
  id: string
  nome: string
  grupo: 'dia' | 'sazonal'
  tituloPadrao: string
  fundo: string // cor base
  padrao: string // camada de fundo (CSS background)
  titulo: string
  tituloSombra: string
  sub: string
  card: string
  cardBorda: string
  nomeCor: string
  precoBg: string
  precoTexto: string
  de: string
  faixaBg: string
  faixaTexto: string
  validadeBg: string
  validadeTexto: string
  rodapeBg: string
  rodapeTexto: string
}

const raios = (a: string, b: string, n = 24) =>
  `repeating-conic-gradient(from 0deg at 50% 18%, ${a} 0deg ${360 / n / 2}deg, ${b} ${360 / n / 2}deg ${360 / n}deg)`
const bolinhas = (cor: string, tam = 46) => `radial-gradient(${cor} 18%, transparent 19%) 0 0 / ${tam}px ${tam}px`
const listras = (a: string, b: string) => `repeating-linear-gradient(135deg, ${a} 0 38px, ${b} 38px 76px)`
const confete = (cores: string[]) =>
  cores
    .map((c, i) => `radial-gradient(circle at ${(i * 37) % 100}% ${(i * 61) % 100}%, ${c} 0 7px, transparent 8px) ${i * 23}px ${i * 41}px / ${150 + i * 13}px ${170 + i * 7}px`)
    .join(', ')

export const MODELOS: Modelo[] = [
  {
    id: 'semana', nome: 'Ofertas da semana', grupo: 'dia', tituloPadrao: 'OFERTAS DA SEMANA',
    fundo: '#E30613', padrao: raios('#E30613', '#F2262C'),
    titulo: '#FFE600', tituloSombra: '#9A0008', sub: '#FFFFFF', card: '#FFFFFF', cardBorda: '#FFE600', nomeCor: '#1E1E1E',
    precoBg: '#FFE600', precoTexto: '#E30613', de: '#6B6B6B', faixaBg: '#1E1E1E', faixaTexto: '#FFE600',
    validadeBg: '#FFFFFF', validadeTexto: '#E30613', rodapeBg: '#B5000A', rodapeTexto: '#FFFFFF',
  },
  {
    id: 'nunes', nome: 'Cores do Nunes', grupo: 'dia', tituloPadrao: 'OFERTAS NUNES',
    fundo: '#F6902F', padrao: raios('#F6902F', '#F89E45'),
    titulo: '#FFFFFF', tituloSombra: '#C1503F', sub: '#FFFFFF', card: '#FFFFFF', cardBorda: '#D2503A', nomeCor: '#2A2622',
    precoBg: '#D2503A', precoTexto: '#FFFFFF', de: '#7A716A', faixaBg: '#D2503A', faixaTexto: '#FFFFFF',
    validadeBg: '#D2503A', validadeTexto: '#FFFFFF', rodapeBg: '#D2503A', rodapeTexto: '#FFFFFF',
  },
  {
    id: 'hortifruti', nome: 'Hortifruti', grupo: 'dia', tituloPadrao: 'FEIRA DA SEMANA',
    fundo: '#1F8A3B', padrao: `${bolinhas('rgba(255,255,255,.10)', 54)}, ${raios('#1F8A3B', '#25984A', 20)}`,
    titulo: '#FFFFFF', tituloSombra: '#0E5222', sub: '#FFF4B8', card: '#FFFFFF', cardBorda: '#FFB000', nomeCor: '#173B20',
    precoBg: '#FF7A00', precoTexto: '#FFFFFF', de: '#5E6B60', faixaBg: '#FFB000', faixaTexto: '#173B20',
    validadeBg: '#FFB000', validadeTexto: '#173B20', rodapeBg: '#0E5222', rodapeTexto: '#FFFFFF',
  },
  {
    id: 'acougue', nome: 'Açougue', grupo: 'dia', tituloPadrao: 'OFERTAS DO AÇOUGUE',
    fundo: '#2A0B0B', padrao: listras('#2A0B0B', '#330E0E'),
    titulo: '#FFFFFF', tituloSombra: '#B3001B', sub: '#FFC9C9', card: '#FFF8F2', cardBorda: '#B3001B', nomeCor: '#2A0B0B',
    precoBg: '#D1001F', precoTexto: '#FFFFFF', de: '#7A5A5A', faixaBg: '#D1001F', faixaTexto: '#FFFFFF',
    validadeBg: '#D1001F', validadeTexto: '#FFFFFF', rodapeBg: '#160404', rodapeTexto: '#FFFFFF',
  },
  {
    id: 'fimdesemana', nome: 'Fim de semana', grupo: 'dia', tituloPadrao: 'FIM DE SEMANA',
    fundo: '#0B4FB3', padrao: raios('#0B4FB3', '#1259C2'),
    titulo: '#FFE600', tituloSombra: '#062C66', sub: '#FFFFFF', card: '#FFFFFF', cardBorda: '#FFE600', nomeCor: '#0D1B33',
    precoBg: '#FFE600', precoTexto: '#0B4FB3', de: '#5B6474', faixaBg: '#E30613', faixaTexto: '#FFFFFF',
    validadeBg: '#FFE600', validadeTexto: '#0B4FB3', rodapeBg: '#062C66', rodapeTexto: '#FFFFFF',
  },
  {
    id: 'blackfriday', nome: 'Black Friday', grupo: 'sazonal', tituloPadrao: 'BLACK FRIDAY',
    fundo: '#0A0A0A', padrao: listras('#0A0A0A', '#141414'),
    titulo: '#FFD400', tituloSombra: '#000000', sub: '#FFFFFF', card: '#1C1C1C', cardBorda: '#FFD400', nomeCor: '#FFFFFF',
    precoBg: '#FFD400', precoTexto: '#0A0A0A', de: '#A5A5A5', faixaBg: '#FFD400', faixaTexto: '#0A0A0A',
    validadeBg: '#FFD400', validadeTexto: '#0A0A0A', rodapeBg: '#000000', rodapeTexto: '#FFD400',
  },
  {
    id: 'natal', nome: 'Natal', grupo: 'sazonal', tituloPadrao: 'OFERTAS DE NATAL',
    fundo: '#B3001B', padrao: `${bolinhas('rgba(255,255,255,.16)', 40)}, linear-gradient(#B3001B, #8C0015)`,
    titulo: '#FFFFFF', tituloSombra: '#0F5B2E', sub: '#FFE7A3', card: '#FFFFFF', cardBorda: '#D4A62A', nomeCor: '#2A1414',
    precoBg: '#0F7A3C', precoTexto: '#FFFFFF', de: '#7A6262', faixaBg: '#D4A62A', faixaTexto: '#3A1A00',
    validadeBg: '#D4A62A', validadeTexto: '#3A1A00', rodapeBg: '#0F5B2E', rodapeTexto: '#FFFFFF',
  },
  {
    id: 'anonovo', nome: 'Fim de ano', grupo: 'sazonal', tituloPadrao: 'OFERTAS DE FIM DE ANO',
    fundo: '#0E1A3A', padrao: `${confete(['#D4A62A', '#FFFFFF', '#D4A62A', '#C0C7D6', '#D4A62A', '#FFFFFF'])}, linear-gradient(#0E1A3A, #182A5C)`,
    titulo: '#F2C94C', tituloSombra: '#000000', sub: '#FFFFFF', card: '#FFFFFF', cardBorda: '#F2C94C', nomeCor: '#0E1A3A',
    precoBg: '#F2C94C', precoTexto: '#0E1A3A', de: '#5C6478', faixaBg: '#F2C94C', faixaTexto: '#0E1A3A',
    validadeBg: '#F2C94C', validadeTexto: '#0E1A3A', rodapeBg: '#070E22', rodapeTexto: '#F2C94C',
  },
  {
    id: 'pascoa', nome: 'Páscoa', grupo: 'sazonal', tituloPadrao: 'OFERTAS DE PÁSCOA',
    fundo: '#7B4DB8', padrao: `${bolinhas('rgba(255,255,255,.14)', 60)}, linear-gradient(#8A5CC7, #6B3FA6)`,
    titulo: '#FFFFFF', tituloSombra: '#4A2A10', sub: '#FFE9F6', card: '#FFFFFF', cardBorda: '#F7B500', nomeCor: '#3B2210',
    precoBg: '#5A3416', precoTexto: '#FFFFFF', de: '#7A6A60', faixaBg: '#F7B500', faixaTexto: '#3B2210',
    validadeBg: '#F7B500', validadeTexto: '#3B2210', rodapeBg: '#4A2A10', rodapeTexto: '#FFFFFF',
  },
  {
    id: 'maes', nome: 'Dia das Mães', grupo: 'sazonal', tituloPadrao: 'MÊS DAS MÃES',
    fundo: '#E2387A', padrao: `${bolinhas('rgba(255,255,255,.14)', 52)}, linear-gradient(#EC4C8A, #C92466)`,
    titulo: '#FFFFFF', tituloSombra: '#8A0E3E', sub: '#FFE3EE', card: '#FFFFFF', cardBorda: '#FFC2D9', nomeCor: '#4A0F27',
    precoBg: '#8A0E3E', precoTexto: '#FFFFFF', de: '#86627A', faixaBg: '#FFFFFF', faixaTexto: '#C92466',
    validadeBg: '#FFFFFF', validadeTexto: '#C92466', rodapeBg: '#8A0E3E', rodapeTexto: '#FFFFFF',
  },
  {
    id: 'pais', nome: 'Dia dos Pais', grupo: 'sazonal', tituloPadrao: 'OFERTAS DIA DOS PAIS',
    fundo: '#12355B', padrao: listras('#12355B', '#163E69'),
    titulo: '#FFFFFF', tituloSombra: '#05162A', sub: '#BFD7F2', card: '#FFFFFF', cardBorda: '#E8A33D', nomeCor: '#12355B',
    precoBg: '#E8A33D', precoTexto: '#12355B', de: '#5D6B7A', faixaBg: '#E8A33D', faixaTexto: '#12355B',
    validadeBg: '#E8A33D', validadeTexto: '#12355B', rodapeBg: '#05162A', rodapeTexto: '#FFFFFF',
  },
  {
    id: 'aniversario', nome: 'Aniversário do mercado', grupo: 'sazonal', tituloPadrao: 'ANIVERSÁRIO NUNES',
    fundo: '#F6902F', padrao: `${confete(['#D2503A', '#FFFFFF', '#FFE600', '#1F8A3B', '#0B4FB3', '#FFFFFF', '#D2503A'])}, ${raios('#F6902F', '#F89E45')}`,
    titulo: '#FFFFFF', tituloSombra: '#B3361F', sub: '#FFFFFF', card: '#FFFFFF', cardBorda: '#D2503A', nomeCor: '#2A2622',
    precoBg: '#D2503A', precoTexto: '#FFFFFF', de: '#7A716A', faixaBg: '#FFE600', faixaTexto: '#B3361F',
    validadeBg: '#FFFFFF', validadeTexto: '#D2503A', rodapeBg: '#B3361F', rodapeTexto: '#FFFFFF',
  },
]

export const modeloPorId = (id: string): Modelo => MODELOS.find((m) => m.id === id) ?? MODELOS[0]

// ── Lista colada → itens ────────────────────────────────────────────────────

const RE_PRECO = /(?:R\$\s*)?(\d{1,4}(?:\.\d{3})*[.,]\d{2})(?!\d)/gi
const RE_MEDIDA = /(\d+(?:[.,]\d+)?)\s?(kg|g|gr|mg|l|lt|ml|un|und|unid|unidades|pct|cx)\b\.?/i

export interface LinhaLida {
  ean: string
  nome: string
  detalhe: string
  preco: string
  precoDe: string
  unidade: string
}

const normalizaPreco = (p: string): string => {
  const limpo = p.replace(/\./g, (m, i: number, s: string) => (s.length - i === 3 ? ',' : '')).replace(/[^\d,]/g, '')
  const [int, cent = '00'] = limpo.split(',')
  return `${String(Number(int) || 0)},${(cent + '00').slice(0, 2)}`
}

/** Valor numérico de "9,99" (ou NaN). */
export const precoNumero = (p: string): number => Number(String(p).replace(/\./g, '').replace(',', '.'))

/**
 * Lê uma linha do jeito que o mercado manda no WhatsApp:
 *   "Arroz Tio João 5kg 27,90" · "Coca-Cola 2L 9,99 de 11,49" · "de 11,49 por 9,99 Coca 2L"
 *   "Picanha kg 69,90" · "7894900011517 Coca-Cola 2L 9,99" · "Banana prata - R$ 4,99/kg"
 */
export function lerLinha(bruta: string): LinhaLida | null {
  let texto = bruta.replace(/\t/g, ' ').replace(/[•*·]/g, ' ').replace(/\s+/g, ' ').trim()
  if (!texto) return null
  let ean = ''
  const mEan = texto.match(/^(\d{8}|\d{12,14})\b/)
  if (mEan) {
    ean = mEan[1]
    texto = texto.slice(mEan[0].length).trim()
  }
  const precos: { valor: string; ini: number; fim: number; antes: string }[] = []
  for (const m of texto.matchAll(RE_PRECO)) {
    const ini = m.index ?? 0
    precos.push({ valor: normalizaPreco(m[1]), ini, fim: ini + m[0].length, antes: texto.slice(Math.max(0, ini - 4), ini).toLowerCase() })
  }
  let preco = ''
  let precoDe = ''
  if (precos.length >= 2) {
    const [a, b] = precos
    const aEhDe = /\bde\s*$/.test(a.antes) || /\bpor\s*$/.test(b.antes)
    const bEhDe = /\bde\s*$/.test(b.antes)
    if (aEhDe && !bEhDe) {
      precoDe = a.valor
      preco = b.valor
    } else if (bEhDe) {
      preco = a.valor
      precoDe = b.valor
    } else {
      const [menor, maior] = precoNumero(a.valor) <= precoNumero(b.valor) ? [a, b] : [b, a]
      preco = menor.valor
      precoDe = maior.valor
    }
  } else if (precos.length === 1) {
    preco = precos[0].valor
  }
  let unidade = ''
  // "/kg", "o kg", "kg" logo depois do preço
  const depoisPreco = precos.length ? texto.slice(precos[precos.length - 1].fim) : ''
  if (/^\s*(\/|o\s|a\s)?\s*kg\b/i.test(depoisPreco)) unidade = 'kg'
  if (/^\s*(\/|a\s)?\s*(un|und|unid|unidade)\b/i.test(depoisPreco)) unidade = 'un'
  // Tira os preços (e "de/por/R$") do nome
  let nome = texto
  for (const p of [...precos].reverse()) nome = nome.slice(0, p.ini) + ' ' + nome.slice(p.fim)
  nome = nome
    .replace(/\b(de|por|apenas|só|so)\s*(?=$|\s(de|por)\b)/gi, ' ')
    .replace(/\s(de|por|apenas)\s*$/i, ' ')
    .replace(/^\s*(de|por)\s/i, ' ')
    .replace(/R\$/gi, ' ')
    .replace(/\/\s*(kg|un|und|unid)\b/gi, ' ')
    .replace(/\s[-–|:=]+\s/g, ' ')
    .replace(/[-–|:=]+\s*$/g, '')
    .replace(/\s+/g, ' ')
    .trim()
  const unSolto = nome.match(/\s(un|und|unid|unidade)\.?$/i)
  if (unSolto) {
    unidade = unidade || 'un'
    nome = nome.slice(0, -unSolto[0].length).trim()
  }
  // "Picanha kg" → nome Picanha, preço por kg
  const kgSolto = nome.match(/\s(kg|o kg)$/i)
  if (kgSolto && !RE_MEDIDA.test(nome.slice(-6))) {
    unidade = 'kg'
    nome = nome.slice(0, -kgSolto[0].length).trim()
  }
  let detalhe = ''
  const mMedida = nome.match(new RegExp(RE_MEDIDA.source + '\\s*$', 'i')) ?? nome.match(RE_MEDIDA)
  if (mMedida && mMedida[0].length < nome.length) {
    detalhe = mMedida[0].replace(/\s+/g, '').replace(/^(\d+(?:[.,]\d+)?)(gr)$/i, '$1g').toUpperCase().replace(/LT$/, 'L')
    nome = (nome.slice(0, mMedida.index) + ' ' + nome.slice((mMedida.index ?? 0) + mMedida[0].length)).replace(/\s+/g, ' ').trim()
  }
  nome = nome.replace(/^[-–\s]+|[-–\s]+$/g, '')
  if (!nome && !ean) return null
  return { ean, nome, detalhe, preco, precoDe, unidade }
}

export const lerLista = (texto: string): LinhaLida[] =>
  texto.split(/\r?\n/).map(lerLinha).filter((l): l is LinhaLida => l !== null)

// ── Páginas e grade ─────────────────────────────────────────────────────────

const celulas = (itens: ItemTabloide[]) => itens.reduce((s, i) => s + (i.destaque ? 4 : 1), 0)

/** Divide os itens em páginas. Destaques vão pro começo da página (o bloco 2×2 fica em cima). */
export function paginar(itens: ItemTabloide[], formato: FormatoTabloide, porPagina: number): ItemTabloide[][] {
  if (!itens.length) return [[]]
  const max = porPagina > 0 ? porPagina : FORMATOS[formato].maxPorPagina
  const total = celulas(itens)
  const nPaginas = Math.max(1, Math.ceil(total / max))
  const alvo = Math.ceil(total / nPaginas)
  const paginas: ItemTabloide[][] = [[]]
  let usadas = 0
  for (const item of itens) {
    const c = item.destaque ? 4 : 1
    if (usadas + c > alvo && paginas[paginas.length - 1].length && paginas.length < nPaginas + 3) {
      paginas.push([])
      usadas = 0
    }
    paginas[paginas.length - 1].push(item)
    usadas += c
  }
  return paginas.map((p) => [...p.filter((i) => i.destaque), ...p.filter((i) => !i.destaque)])
}

/** Escolhe colunas × linhas pra que os cards fiquem com cara de card (um pouco mais altos que largos). */
export function escolherGrade(itens: ItemTabloide[], areaW: number, areaH: number): { cols: number; rows: number } {
  const n = celulas(itens)
  if (n <= 1) return { cols: 1, rows: 1 }
  const temDestaque = itens.some((i) => i.destaque)
  let melhor = { cols: 2, rows: Math.ceil(n / 2), nota: Infinity }
  for (let cols = temDestaque ? 2 : 1; cols <= 5; cols++) {
    let rows = Math.ceil(n / cols)
    if (temDestaque && rows < 2) rows = 2
    const vazias = cols * rows - n
    const proporcao = areaW / cols / (areaH / rows)
    const nota = Math.abs(Math.log(proporcao / 0.8)) + vazias * 0.22
    if (nota < melhor.nota) melhor = { cols, rows, nota }
  }
  return { cols: melhor.cols, rows: melhor.rows }
}

// ── HTML ────────────────────────────────────────────────────────────────────

export const esc = (s: string): string =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string)

const FONTES =
  '<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>' +
  '<link href="https://fonts.googleapis.com/css2?family=Anton&family=Archivo+Black&family=Poppins:wght@500;600;700;800&display=block" rel="stylesheet">'

function css(m: Modelo): string {
  return `
*{box-sizing:border-box;margin:0;padding:0}
html,body{background:transparent}
.pg{position:relative;overflow:hidden;background:${m.fundo};font-family:'Poppins',system-ui,sans-serif;display:flex;flex-direction:column}
.pg>.fundo{position:absolute;inset:0;background:${m.padrao}}
.pg>.fundo::after{content:'';position:absolute;inset:0;background:radial-gradient(ellipse at 50% 30%,transparent 40%,rgba(0,0,0,.22))}
.pg>.fundo.foto{background-size:cover;background-position:center;background-repeat:no-repeat}
.pg>.fundo.foto::after{background:rgba(0,0,0,var(--escuro,0))}
.topo{position:relative;display:flex;align-items:center;gap:var(--gap)}
.topo.empilhado{flex-direction:column;justify-content:center;gap:calc(var(--hu)*.5)}
.topo.empilhado .cab{flex:none;width:100%}
.logo{flex:none;background:#fff;border-radius:calc(var(--hu)*1.2);padding:calc(var(--hu)*.7);box-shadow:0 calc(var(--hu)*.4) calc(var(--hu)*1.2) rgba(0,0,0,.25);display:flex;align-items:center;justify-content:center}
.logo img{display:block;height:100%;width:auto;object-fit:contain}
.cab{flex:1;min-width:0;display:flex;flex-direction:column;align-items:center;text-align:center}
.titulo{font-family:'Anton',Impact,sans-serif;color:${m.titulo};line-height:.95;letter-spacing:.01em;text-transform:uppercase;text-shadow:0 calc(var(--hu)*.45) 0 ${m.tituloSombra},0 calc(var(--hu)*.8) calc(var(--hu)*1.4) rgba(0,0,0,.25)}
.sub{color:${m.sub};font-weight:800;text-transform:uppercase;letter-spacing:.06em;margin-top:calc(var(--hu)*.6)}
.validade{display:inline-block;margin-top:calc(var(--hu)*.9);background:${m.validadeBg};color:${m.validadeTexto};font-weight:800;border-radius:999px;padding:calc(var(--hu)*.35) calc(var(--hu)*1.6);text-transform:uppercase;letter-spacing:.03em;box-shadow:0 calc(var(--hu)*.3) 0 rgba(0,0,0,.18)}
.grade{position:relative;flex:1;display:grid;grid-auto-flow:row dense;min-height:0}
.card{position:relative;background:${m.card};border:calc(var(--u)*.22) solid ${m.cardBorda};border-radius:calc(var(--u)*1.1);display:flex;flex-direction:column;align-items:center;padding:calc(var(--u)*.7) calc(var(--u)*.6) calc(var(--u)*.6);box-shadow:0 calc(var(--u)*.35) calc(var(--u)*.9) rgba(0,0,0,.28);min-width:0;min-height:0}
.card.dest{grid-column:span 2;grid-row:span 2}
.faixa{position:absolute;top:calc(var(--u)*-.2);left:50%;transform:translate(-50%,-45%) rotate(-2deg);background:${m.faixaBg};color:${m.faixaTexto};font-family:'Anton',Impact,sans-serif;font-size:calc(var(--u)*1.05);padding:calc(var(--u)*.12) calc(var(--u)*.9);border-radius:calc(var(--u)*.4);white-space:nowrap;letter-spacing:.04em;box-shadow:0 calc(var(--u)*.2) calc(var(--u)*.5) rgba(0,0,0,.3);z-index:2}
.foto{flex:1;min-height:0;width:100%;display:flex;align-items:center;justify-content:center}
.foto img{max-width:100%;max-height:100%;object-fit:contain;filter:drop-shadow(0 calc(var(--u)*.25) calc(var(--u)*.35) rgba(0,0,0,.25))}
.foto .semfoto{width:42%;max-height:80%;fill:${m.precoBg};opacity:.22}
.nome{color:${m.nomeCor};font-weight:800;text-transform:uppercase;text-align:center;line-height:1.05;margin-top:calc(var(--u)*.35);display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;word-break:break-word}
.det{color:${m.nomeCor};opacity:.7;font-weight:600;font-size:calc(var(--u)*.78);text-transform:uppercase;line-height:1.1;margin-top:calc(var(--u)*.08)}
.precos{display:flex;flex-direction:column;align-items:center;margin-top:calc(var(--u)*.3)}
.de{color:${m.de};font-weight:700;font-size:calc(var(--u)*.78);line-height:1}
.de s{text-decoration-thickness:calc(var(--u)*.1)}
.preco{display:flex;align-items:flex-start;background:${m.precoBg};color:${m.precoTexto};border-radius:calc(var(--u)*.55);padding:calc(var(--u)*.18) calc(var(--u)*.55) calc(var(--u)*.12);transform:rotate(-2deg);margin-top:calc(var(--u)*.2);box-shadow:0 calc(var(--u)*.18) 0 rgba(0,0,0,.18);font-family:'Archivo Black',Impact,sans-serif;line-height:1}
.preco .rs{font-size:calc(var(--u)*.85);margin-top:calc(var(--u)*.35);margin-right:calc(var(--u)*.12)}
.preco .int{font-size:calc(var(--u)*2.9);letter-spacing:-.03em}
.preco .dir{display:flex;flex-direction:column;align-items:flex-start;margin-left:calc(var(--u)*.06)}
.preco .cent{font-size:calc(var(--u)*1.3);margin-top:calc(var(--u)*.22)}
.preco .un{font-family:'Poppins',sans-serif;font-weight:800;font-size:calc(var(--u)*.7);text-transform:uppercase;margin-top:calc(var(--u)*.05)}
.rodape{position:relative;background:${m.rodapeBg};color:${m.rodapeTexto};display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;border-radius:calc(var(--hu)*1.1);padding:calc(var(--hu)*.7) calc(var(--hu)*1.2)}
.rodape .linha{display:flex;align-items:center;justify-content:center;gap:calc(var(--hu)*1.4);font-weight:700;flex-wrap:wrap}
.rodape .linha span{display:inline-flex;align-items:center;gap:calc(var(--hu)*.45)}
.rodape svg{width:1.1em;height:1.1em;fill:currentColor}
.rodape .aviso{opacity:.85;font-weight:500;margin-top:calc(var(--hu)*.25)}
.npag{position:absolute;right:calc(var(--hu)*1.4);bottom:calc(var(--hu)*.6);color:${m.rodapeTexto};opacity:.7;font-weight:700;font-size:calc(var(--hu)*1.1)}
/* Animação (vídeo): o servidor pausa e posiciona o tempo quadro a quadro. */
@keyframes desce{from{transform:translateY(-120%);opacity:0}to{transform:none;opacity:1}}
@keyframes sobe{from{transform:translateY(140%);opacity:0}to{transform:none;opacity:1}}
@keyframes entra{0%{transform:scale(.4) rotate(-6deg);opacity:0}70%{transform:scale(1.06) rotate(1deg);opacity:1}100%{transform:none;opacity:1}}
@keyframes pulsa{0%,100%{transform:rotate(-2deg) scale(1)}50%{transform:rotate(-2deg) scale(1.12)}}
@keyframes gira{from{transform:rotate(0)}to{transform:rotate(25deg)}}
.anim .topo{animation:desce .7s cubic-bezier(.2,.9,.3,1.2) both}
.anim .rodape{animation:sobe .6s ease-out both;animation-delay:var(--drod)}
.anim .card{animation:entra .55s cubic-bezier(.2,.9,.3,1.1) both;animation-delay:var(--d)}
.anim .card .preco{animation:pulsa .5s ease-in-out both;animation-delay:calc(var(--d) + .5s)}
.anim>.fundo{animation:gira var(--dur) linear both;transform-origin:50% 18%;inset:-30%}
.anim>.fundo.foto{animation:zoom var(--dur) linear both;transform-origin:50% 50%;inset:0}
@keyframes zoom{from{transform:scale(1)}to{transform:scale(1.08)}}
`
}

/** Linhas do rodapé: uma por loja (endereço + WhatsApp). */
function linhasDoRodape(d: DadosTabloide): string[] {
  return [
    { e: d.endereco?.trim() ?? '', w: d.whatsapp?.trim() ?? '' },
    { e: d.endereco2?.trim() ?? '', w: d.whatsapp2?.trim() ?? '' },
  ]
    .filter((l) => l.e || l.w)
    .map((l) => (l.e ? `<span>${ICONE_LOCAL}${esc(l.e)}</span>` : '') + (l.w ? `<span>${ICONE_WHATS}${esc(l.w)}</span>` : ''))
}

const ICONE_WHATS =
  '<svg viewBox="0 0 24 24"><path d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2zm5.8 14.2c-.2.7-1.4 1.3-2 1.4-.5.1-1.2.1-1.9-.1a17 17 0 0 1-1.7-.6 13.3 13.3 0 0 1-5.1-4.5c-.4-.5-1-1.5-1-2.8s.7-2 1-2.3c.2-.3.5-.3.7-.3h.5c.2 0 .4 0 .6.5l.8 2c.1.2.1.4 0 .6l-.4.6-.3.4c-.1.1-.3.3-.1.5.1.3.6 1 1.3 1.6.9.8 1.6 1 1.9 1.2.2.1.4.1.5-.1l.7-.9c.2-.2.3-.2.6-.1l1.9.9c.3.1.5.2.5.3.1.2.1.8-.1 1.4z"/></svg>'
const ICONE_LOCAL =
  '<svg viewBox="0 0 24 24"><path d="M12 2a7 7 0 0 0-7 7c0 5.2 7 13 7 13s7-7.8 7-13a7 7 0 0 0-7-7zm0 9.5A2.5 2.5 0 1 1 12 6.5a2.5 2.5 0 0 1 0 5z"/></svg>'

function partesPreco(preco: string): { int: string; cent: string } {
  const n = precoNumero(preco)
  if (!Number.isFinite(n)) return { int: esc(preco || '0'), cent: '' }
  const [int, cent] = n.toFixed(2).split('.')
  return { int: Number(int).toLocaleString('pt-BR'), cent: `,${cent}` }
}

const unidadeTexto = (u: string): string => {
  const t = (u || '').trim()
  if (!t) return ''
  return /^(kg|un|g|l|ml|100g|cada|bandeja|dz|pct|cx)$/i.test(t) ? (t.toLowerCase() === 'cada' ? 'cada' : `/${t}`) : t
}

function card(item: ItemTabloide, u: number, atraso: number): string {
  const uu = item.destaque ? u * 1.9 : u
  const { int, cent } = partesPreco(item.preco)
  const nome = item.nome || 'Produto'
  const tamNome = uu * (nome.length > 34 ? 0.78 : nome.length > 22 ? 0.9 : nome.length > 14 ? 1.02 : 1.15)
  const temDe = item.precoDe && precoNumero(item.precoDe) > precoNumero(item.preco)
  const foto = item.fotoUrl ? `<img src="${esc(item.fotoUrl)}" alt="">` : '<svg class="semfoto" viewBox="0 0 24 24"><path d="M7 18a2 2 0 1 0 0 4 2 2 0 0 0 0-4zm10 0a2 2 0 1 0 0 4 2 2 0 0 0 0-4zM5.2 4l.4 2H21l-2.3 8.2a2 2 0 0 1-1.9 1.4H8.1a2 2 0 0 1-2-1.6L3.6 3H1V1h4a1 1 0 0 1 1 .8L6.2 4z"/></svg>'
  const un = unidadeTexto(item.unidade)
  return `<div class="card${item.destaque ? ' dest' : ''}" style="--u:${uu.toFixed(2)}px;--d:${atraso.toFixed(2)}s">
${item.destaque ? '<div class="faixa">SUPER OFERTA</div>' : ''}
<div class="foto">${foto}</div>
<div class="nome" style="font-size:${tamNome.toFixed(1)}px">${esc(nome)}</div>
${item.detalhe ? `<div class="det">${esc(item.detalhe)}</div>` : ''}
<div class="precos">${temDe ? `<div class="de">de <s>R$ ${esc(item.precoDe)}</s> por</div>` : ''}
<div class="preco"><span class="rs">R$</span><span class="int">${int}</span><span class="dir"><span class="cent">${cent}</span>${un ? `<span class="un">${esc(un)}</span>` : ''}</span></div></div>
</div>`
}

/** Medidas fixas por formato: margens (story deixa espaço pros botões do Instagram), cabeçalho e rodapé. */
function medidas(formato: FormatoTabloide) {
  const { w, h } = FORMATOS[formato]
  if (formato === 'story') return { w, h, padX: 54, padTop: 140, padBot: 170, topoH: 430, rodH: 120, gap: 22, hu: 22, empilhado: true }
  if (formato === 'a4') return { w, h, padX: 60, padTop: 54, padBot: 50, topoH: 300, rodH: 120, gap: 22, hu: 22, empilhado: false }
  return { w, h, padX: 46, padTop: 40, padBot: 36, topoH: 250, rodH: 96, gap: 18, hu: 18, empilhado: false }
}

/** Quanto tempo (segundos) a animação de uma página leva até ficar parada, e quanto tempo segura. */
export function duracaoPagina(qtdItens: number): { entrada: number; total: number } {
  const entrada = 0.6 + qtdItens * 0.14 + 1.0
  return { entrada, total: entrada + 4 }
}

function quebraEmDuas(t: string): string[] {
  const p = t.split(' ')
  if (p.length < 2) return [t]
  let melhor = [t, '']
  for (let i = 1; i < p.length; i++) {
    const a = p.slice(0, i).join(' ')
    const b = p.slice(i).join(' ')
    if (Math.max(a.length, b.length) < Math.max(melhor[0].length, melhor[1].length)) melhor = [a, b]
  }
  return melhor
}

export interface PaginaMontada {
  html: string
  w: number
  h: number
  duracao: number
}

/**
 * Monta as páginas do tabloide. Cada página é um <div class="pg"> com tamanho fixo em px; quem usa
 * decide a escala (a prévia encolhe com transform, o servidor tira o print no tamanho real).
 */
export function montarPaginas(dados: DadosTabloide, logoUrl: string, opcoes: { animado?: boolean } = {}): PaginaMontada[] {
  const modelo = modeloPorId(dados.modeloId)
  const md = medidas(dados.formato)
  const paginas = paginar(dados.itens, dados.formato, dados.porPagina)
  const fundoFoto = fundoValido(dados.fundoUrl)
  const escuro = (Math.max(0, Math.min(80, Number(dados.fundoEscurecer ?? 25) || 0)) / 100).toFixed(2)
  const linhasRodape = linhasDoRodape(dados)
  const temRodape = !!(linhasRodape.length || dados.aviso)
  const rodH = temRodape ? Math.round(md.rodH * (1 + 0.42 * Math.max(0, linhasRodape.length - 1))) : 0
  const areaW = md.w - md.padX * 2
  const areaH = md.h - md.padTop - md.padBot - md.topoH - rodH - md.gap * (temRodape ? 2 : 1)
  const titulo = dados.titulo || modelo.tituloPadrao
  const logoH = md.empilhado ? md.topoH * 0.3 : md.topoH * 0.72
  // Título cabe na largura: uma linha se der pra ficar grande, senão quebra em duas.
  const larguraTitulo = md.empilhado ? md.w - md.padX * 2 : md.w - md.padX * 2 - logoH * 1.25 - md.gap
  const maxTitulo = md.hu * (md.empilhado ? 6.4 : 6.2)
  const umaLinha = larguraTitulo / (Math.max(titulo.length, 4) * 0.47)
  const metade = Math.max(...quebraEmDuas(titulo).map((l) => l.length), 4)
  const tamTitulo = umaLinha >= maxTitulo * 0.62 || !titulo.includes(' ')
    ? Math.min(maxTitulo, umaLinha)
    : Math.min(maxTitulo * 0.8, larguraTitulo / (metade * 0.47))

  return paginas.map((itens, idx) => {
    const { cols, rows } = escolherGrade(itens, areaW, areaH)
    const gapG = Math.round(md.gap * (cols >= 4 ? 0.8 : 1))
    const cw = (areaW - gapG * (cols - 1)) / cols
    const ch = (areaH - gapG * (rows - 1)) / rows
    const u = Math.min(cw / 9.4, ch / 13)
    const dur = duracaoPagina(itens.length)
    const cards = itens.map((it, i) => card(it, u, 0.6 + i * 0.14)).join('')
    const npag = paginas.length > 1 ? `<div class="npag">${idx + 1}/${paginas.length}</div>` : ''
    const html = `<div class="pg${opcoes.animado ? ' anim' : ''}" style="width:${md.w}px;height:${md.h}px;padding:${md.padTop}px ${md.padX}px ${md.padBot}px;gap:${md.gap}px;--hu:${md.hu}px;--gap:${md.gap}px;--drod:${(0.6 + itens.length * 0.14).toFixed(2)}s;--dur:${dur.total.toFixed(2)}s">
${fundoFoto ? `<div class="fundo foto" style="background-image:url(${fundoFoto});--escuro:${escuro}"></div>` : '<div class="fundo"></div>'}
<div class="topo${md.empilhado ? ' empilhado' : ''}" style="height:${md.topoH}px">
  ${logoUrl ? `<div class="logo" style="height:${logoH.toFixed(0)}px"><img src="${esc(logoUrl)}" alt=""></div>` : ''}
  <div class="cab">
    <div class="titulo" style="font-size:${tamTitulo.toFixed(0)}px">${esc(titulo)}</div>
    ${dados.subtitulo ? `<div class="sub" style="font-size:${(md.hu * 1.5).toFixed(0)}px">${esc(dados.subtitulo)}</div>` : ''}
    ${dados.validade ? `<div class="validade" style="font-size:${(md.hu * 1.25).toFixed(0)}px">${esc(dados.validade)}</div>` : ''}
  </div>
</div>
<div class="grade" style="grid-template-columns:repeat(${cols},1fr);grid-template-rows:repeat(${rows},1fr);gap:${gapG}px">${cards}</div>
${temRodape ? `<div class="rodape" style="height:${rodH}px;font-size:${(md.hu * 1.15).toFixed(0)}px">
  ${linhasRodape.map((l) => `<div class="linha">${l}</div>`).join('')}
  ${dados.aviso ? `<div class="aviso" style="font-size:${(md.hu * 0.82).toFixed(0)}px">${esc(dados.aviso)}</div>` : ''}
</div>` : ''}
${npag}
</div>`
    return { html, w: md.w, h: md.h, duracao: dur.total }
  })
}

/** Documento HTML completo com UMA página (é o que a prévia põe no iframe e o servidor fotografa). */
export function documentoDaPagina(dados: DadosTabloide, pagina: PaginaMontada): string {
  return `<!doctype html><html><head><meta charset="utf-8">${FONTES}<style>${css(modeloPorId(dados.modeloId))}
html,body{width:${pagina.w}px;height:${pagina.h}px;overflow:hidden}</style></head><body>${pagina.html}</body></html>`
}

/** Documento com todas as páginas uma embaixo da outra, uma por folha (PDF). */
export function documentoCompleto(dados: DadosTabloide, paginas: PaginaMontada[]): string {
  const { w, h } = paginas[0] ?? { w: 1080, h: 1350 }
  return `<!doctype html><html><head><meta charset="utf-8">${FONTES}<style>${css(modeloPorId(dados.modeloId))}
html,body{width:${w}px}
.pg{break-after:page;page-break-after:always}</style></head><body>${paginas.map((p) => p.html).join('')}</body></html>`
}

export const DADOS_VAZIOS = (): DadosTabloide => ({
  titulo: '',
  subtitulo: '',
  validade: '',
  modeloId: 'semana',
  formato: 'feed',
  porPagina: 0,
  itens: [],
  endereco: '',
  whatsapp: '',
  endereco2: '',
  whatsapp2: '',
  fundoUrl: '',
  fundoEscurecer: 25,
  aviso: 'Ofertas válidas enquanto durarem os estoques. Imagens meramente ilustrativas.',
})
