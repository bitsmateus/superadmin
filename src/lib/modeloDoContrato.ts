/**
 * Inteligência do modelo padrão do contrato: o que cada "<<campo>>" vermelho significa (valor da instalação, mensalidade,
 * total, parcelas, fidelidade, vigência, data…), o cálculo automático do total e da vigência, a data de hoje e a limpeza do
 * vermelho na hora de gerar.
 *
 * Os nomes genéricos do modelo ("VALOR", "X", "DATA"), que aparecem várias vezes com significados diferentes, são separados
 * pelo texto que vem antes e depois de cada um ("...valor de instalação R$ <<VALOR>>" → Valor da Instalação).
 */

export type Papel =
  | 'telas' | 'instalacao' | 'mensal' | 'total' | 'parcela' | 'nParcelas' | 'fidelidade' | 'vigencia' | 'hoje' | 'primeiroVencimento'

export type TipoDeCampo = 'texto' | 'moeda' | 'numero' | 'data' | 'fidelidade'

export interface CampoDoModelo {
  nome: string
  papel?: Papel
  tipo: TipoDeCampo
  /** Trecho do contrato em volta do campo (pra reconhecer qual é qual quando o nome é genérico). */
  contexto: string
  /** Texto que vai junto do valor ("meses" quando o campo do modelo é "X meses"). */
  sufixo?: string
  /** O valor é calculado sozinho (total, vigência, data de hoje). */
  automatico?: boolean
}

const PLACEHOLDER = /&lt;&lt;([^&]+?)&gt;&gt;/g

export function normaliza(s: string): string {
  return (s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim()
}

const textoSimples = (html: string) =>
  html.replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').replace(/\s+/g, ' ')

const NOME_DO_PAPEL: Record<Papel, string> = {
  telas: 'NÚMERO DE TELAS',
  instalacao: 'Valor da Instalação',
  mensal: 'Valor Mensal',
  total: 'Valor Total',
  parcela: 'Valor das Parcelas',
  nParcelas: 'Número de Parcelas',
  fidelidade: 'Fidelidade (meses)',
  vigencia: 'Vigência (meses)',
  hoje: 'DATA',
  primeiroVencimento: 'Data do Primeiro Vencimento',
}

const TIPO_DO_PAPEL: Record<Papel, TipoDeCampo> = {
  telas: 'numero', instalacao: 'moeda', mensal: 'moeda', total: 'moeda', parcela: 'moeda', nParcelas: 'numero',
  fidelidade: 'fidelidade', vigencia: 'numero', hoje: 'data', primeiroVencimento: 'data',
}

/** Papel pelo NOME do campo (quando o nome já diz o que é). */
function papelPeloNome(nome: string): Papel | 'generico' | undefined {
  const n = normaliza(nome)
  const compacto = n.replace(/\s+/g, '')
  if (n === 'numero de telas' || n === 'telas') return 'telas'
  if (compacto === '3/6/12' || /^fidelidade/.test(n)) return 'fidelidade'
  if (/^(x\s*)?meses$/.test(n) || /^vigencia/.test(n)) return 'vigencia'
  if (/^valor (de|da|das)? ?instalacao/.test(n) || n === 'instalacao') return 'instalacao'
  if (/^valor (mensal|da mensalidade)/.test(n) || n === 'mensalidade') return 'mensal'
  if (/^valor total/.test(n) || n === 'total') return 'total'
  if (/^valor (das? )?parcelas?/.test(n)) return 'parcela'
  if (/^(x\s*)?(das\s*)?parcelas?$/.test(n) || /^(numero|quantidade|qtd\.?) (de )?parcelas/.test(n)) return 'nParcelas'
  if (/(primeiro )?vencimento/.test(n)) return 'primeiroVencimento'
  if (n === 'valor' || n === 'x' || n === 'data') return 'generico'
  return undefined
}

/** Papel de um "VALOR"/"X"/"DATA" genérico, pelo que vem antes e depois dele no texto. */
function papelPeloContexto(base: 'valor' | 'x' | 'data', antes: string, depois: string): Papel | undefined {
  const a = normaliza(antes)
  const d = normaliza(depois)
  const perto = a.slice(-70)
  if (base === 'data') {
    if (/vencimento/.test(a.slice(-35))) return 'primeiroVencimento'
    return 'hoje'
  }
  if (base === 'x') {
    if (/^(x\b|vezes\b|parcelas?\b)/.test(d)) return 'nParcelas'
    if (/^meses?\b/.test(d)) return 'vigencia'
    if (/parcela/.test(a.slice(-40))) return 'nParcelas'
    if (/(vigencia|prazo|fidelidade)/.test(a.slice(-60))) return 'vigencia'
    return undefined
  }
  // valor: vale a palavra-chave MAIS PERTO do campo ("instalação R$ <<VALOR>> em 3 parcelas de R$ <<VALOR>>": cada um com a sua).
  const chaves: [Papel, RegExp][] = [['instalacao', /instala/g], ['total', /total/g], ['parcela', /parcela/g], ['mensal', /mensal|mensalidade/g]]
  let melhor: Papel | undefined
  let posicao = -1
  for (const [papel, re] of chaves) {
    for (const m of perto.matchAll(re)) if ((m.index ?? -1) > posicao) { posicao = m.index ?? -1; melhor = papel }
  }
  if (melhor) return melhor
  if (/^\s*(cada|por parcela)/.test(d)) return 'parcela'
  return undefined
}

export interface ModeloPreparado {
  /** O modelo com os campos genéricos já renomeados (cada significado com o seu nome). */
  html: string
  campos: CampoDoModelo[]
}

export function prepararModelo(html: string): ModeloPreparado {
  const campos = new Map<string, CampoDoModelo>()
  const nomesGenericos: Record<string, number> = {}
  const saida = html.replace(PLACEHOLDER, (full: string, bruto: string, deslocamento: number) => {
    const nome = bruto.trim()
    const pelaNome = papelPeloNome(nome)
    const antes = textoSimples(html.slice(Math.max(0, deslocamento - 900), deslocamento)).slice(-160)
    const depois = textoSimples(html.slice(deslocamento + full.length, deslocamento + full.length + 400)).slice(0, 100)
    let papel: Papel | undefined
    let nomeFinal = nome
    if (pelaNome === 'generico') {
      const base = normaliza(nome) as 'valor' | 'x' | 'data'
      papel = papelPeloContexto(base, antes, depois)
      if (papel) nomeFinal = NOME_DO_PAPEL[papel]
      else {
        nomesGenericos[base] = (nomesGenericos[base] ?? 0) + 1
        if (nomesGenericos[base] > 1) nomeFinal = `${nome} (${nomesGenericos[base]})`
      }
    } else if (pelaNome) {
      papel = pelaNome
    }
    if (!campos.has(nomeFinal)) {
      const tipo = papel ? TIPO_DO_PAPEL[papel] : 'texto'
      const sufixo = papel === 'vigencia' && /meses$/i.test(nome) && !/\(meses\)/i.test(nome) ? ' meses' : undefined
      campos.set(nomeFinal, {
        nome: nomeFinal, papel, tipo, contexto: `${antes.slice(-55)}[${nomeFinal}]${depois.slice(0, 35)}`.trim(),
        sufixo, automatico: papel === 'total' || papel === 'vigencia' || papel === 'hoje',
      })
    }
    return `&lt;&lt;${nomeFinal}&gt;&gt;`
  })
  return { html: saida, campos: [...campos.values()] }
}

// ───────────────────────────── valores ─────────────────────────────

/** "1.047,00" / "349" / "349,5" → 349.5 (null se não for número). */
export function lerMoeda(v: string | undefined): number | null {
  const t = (v ?? '').replace(/[^\d,.-]/g, '')
  if (!/\d/.test(t)) return null
  let normal = t
  if (t.includes(',')) normal = t.replace(/\./g, '').replace(',', '.')
  else if (/^\d{1,3}(\.\d{3})+$/.test(t)) normal = t.replace(/\./g, '')
  const n = Number(normal)
  return Number.isFinite(n) ? n : null
}

export function formatarMoeda(n: number): string {
  return n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

export const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro']

/** "16 de novembro de 2026". */
export function dataPorExtenso(d: Date): string {
  return `${d.getDate()} de ${MESES[d.getMonth()]} de ${d.getFullYear()}`
}

const chaveManual = (nome: string) => `__manual:${nome}`
export const marcarManual = (campos: Record<string, string>, nome: string): Record<string, string> => ({ ...campos, [chaveManual(nome)]: '1' })

/**
 * Preenche o que dá pra calcular: total = mensalidade × meses da fidelidade, vigência = meses da fidelidade, data = hoje.
 * Um campo que a pessoa digitou à mão (marcado em marcarManual) não é mais mexido.
 */
export function aplicarAutomaticos(campos: Record<string, string>, modelo: CampoDoModelo[], opcoes: { hoje?: Date } = {}): Record<string, string> {
  const out = { ...campos }
  const por = (p: Papel) => modelo.find((c) => c.papel === p)
  const manual = (c: CampoDoModelo | undefined) => !!c && out[chaveManual(c.nome)] === '1'
  const mensal = por('mensal')
  const fid = por('fidelidade')
  const meses = fid ? Number((out[fid.nome] ?? '').replace(/\D/g, '')) : 0
  const total = por('total')
  if (total && !manual(total)) {
    const m = mensal ? lerMoeda(out[mensal.nome]) : null
    out[total.nome] = m != null && meses > 0 ? formatarMoeda(m * meses) : ''
  }
  const vig = por('vigencia')
  if (vig && !manual(vig) && meses > 0) out[vig.nome] = `${meses}${vig.sufixo ?? ''}`
  const hoje = por('hoje')
  if (hoje && opcoes.hoje && !manual(hoje)) out[hoje.nome] = dataPorExtenso(opcoes.hoje)
  return out
}

// ───────────────────────────── cor ─────────────────────────────

function ehVermelho(valor: string): boolean {
  const v = valor.trim().toLowerCase()
  if (v === 'red' || v === 'crimson' || v === 'firebrick' || v === 'darkred') return true
  let r: number, g: number, b: number
  const hex = v.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/)
  const rgb = v.match(/^rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)/)
  if (hex) {
    const h = hex[1].length === 3 ? hex[1].split('').map((c) => c + c).join('') : hex[1]
    r = parseInt(h.slice(0, 2), 16); g = parseInt(h.slice(2, 4), 16); b = parseInt(h.slice(4, 6), 16)
  } else if (rgb) {
    r = Number(rgb[1]); g = Number(rgb[2]); b = Number(rgb[3])
  } else return false
  return r >= 150 && g <= 100 && b <= 100 && r - Math.max(g, b) >= 80
}

/** Troca qualquer vermelho do texto (as marcações do modelo) por preto — o contrato gerado não leva vermelho. */
export function tirarVermelho(html: string): string {
  return html
    .replace(/((?:^|[;\s"'])color\s*:\s*)(#[0-9a-fA-F]{3,6}|rgba?\([^)]*\)|[a-zA-Z]+)/g, (m, pre: string, cor: string) => (ehVermelho(cor) ? `${pre}#000000` : m))
    .replace(/(<font[^>]*\scolor\s*=\s*["']?)(#[0-9a-fA-F]{3,6}|[a-zA-Z]+)(["']?)/gi, (m, pre: string, cor: string, pos: string) => (ehVermelho(cor) ? `${pre}#000000${pos}` : m))
}

// ───────────────────────────── puxar da lead do CRM ─────────────────────────────

export interface DadosDaLead {
  valorMrr?: string
  valorImplementacao?: string
  fidelidade?: string
  numeroAtendentes?: string
}

/** "R$ 349,00" → "349,00" (vazio se não tiver número). */
function moedaDoLead(v: string | undefined): string {
  const n = lerMoeda(v)
  return n == null ? '' : formatarMoeda(n)
}

/** "12 meses" / "12" → "12" quando for uma das fidelidades do contrato (3, 6 ou 12). */
export function mesesDaFidelidade(v: string | undefined): string {
  const m = (v ?? '').match(/\d+/)
  return m && ['3', '6', '12'].includes(m[0]) ? m[0] : ''
}

/** O que a lead do CRM já sabe e entra no contrato: mensalidade (MRR), instalação, fidelidade e nº de telas (atendentes). */
export function camposDaLead(modelo: CampoDoModelo[], lead: DadosDaLead): Record<string, string> {
  const out: Record<string, string> = {}
  const por = (p: Papel) => modelo.find((c) => c.papel === p)?.nome
  const poe = (p: Papel, valor: string) => { const n = por(p); if (n && valor) out[n] = valor }
  poe('mensal', moedaDoLead(lead.valorMrr))
  poe('instalacao', moedaDoLead(lead.valorImplementacao))
  poe('fidelidade', mesesDaFidelidade(lead.fidelidade))
  const telas = (lead.numeroAtendentes ?? '').match(/\d+/)?.[0]
  poe('telas', telas ?? '')
  return out
}
