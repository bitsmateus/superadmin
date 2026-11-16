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
  /** Não tem marcação no texto do modelo, mas entra no formulário porque as contas precisam dele (ex.: a mensalidade). */
  implicito?: boolean
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
  // valor: vale a palavra-chave MAIS PERTO do campo (até 150 letras antes) ("instalação R$ <<VALOR>> em 3 parcelas de R$ <<VALOR>>": cada um com a sua).
  const chaves: [Papel, RegExp][] = [['instalacao', /instala/g], ['total', /total/g], ['parcela', /parcela/g], ['mensal', /mensal|mensalidade/g]]
  let melhor: Papel | undefined
  let posicao = -1
  for (const [papel, re] of chaves) {
    for (const m of a.slice(-150).matchAll(re)) if ((m.index ?? -1) > posicao) { posicao = m.index ?? -1; melhor = papel }
  }
  if (melhor) return melhor
  if (/^\s*(cada|por parcela)/.test(d)) return 'parcela'
  return undefined
}

/** Tabela de serviços que já existe no modelo (cabeçalho "Serviços | Pacote"): vira o campo editável, mantendo o visual dela. */
export interface ServicosDoModelo {
  linhasPadrao: { codigo: string; nome: string }[]
  /** Da abertura da tabela até a linha de cabeçalho (inclusive). */
  prefixo: string
  /** Uma linha de serviço do modelo, usada como molde pra todas as outras. */
  linhaMolde: string
  /** Do fim da última linha até o fechamento da tabela. */
  sufixo: string
}

export interface ModeloPreparado {
  /** O modelo com os campos genéricos já renomeados (cada significado com o seu nome). */
  html: string
  campos: CampoDoModelo[]
  servicos?: ServicosDoModelo
}

const escHtml = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

/** Troca o primeiro texto de uma célula pelo novo, mantendo as tags (fonte, tamanho, negrito) do modelo. */
function trocarTexto(interior: string, novo: string): string {
  let usado = false
  const r = `>${interior}<`.replace(/>([^<]*)</g, (m: string, t: string) => {
    if (!t.trim()) return m
    if (!usado) { usado = true; return `>${escHtml(novo)}<` }
    return '><'
  })
  return usado ? r.slice(1, -1) : escHtml(novo)
}

export function montarLinhaDeServico(molde: string, codigo: string, nome: string): string {
  let i = 0
  return molde.replace(/(<t[dh][^>]*>)([\s\S]*?)(<\/t[dh]>)/gi, (_m: string, abre: string, interior: string, fecha: string) => {
    const texto = i === 0 ? codigo : i === 1 ? nome : ''
    i += 1
    return i <= 2 ? `${abre}${trocarTexto(interior, texto)}${fecha}` : `${abre}${interior}${fecha}`
  })
}

export function montarTabelaDeServicos(sv: ServicosDoModelo, linhas: { codigo: string; nome: string }[]): string {
  return `${sv.prefixo}${linhas.map((l) => montarLinhaDeServico(sv.linhaMolde, l.codigo, l.nome)).join('')}${sv.sufixo}`
}

/** Acha no modelo a tabela "Serviços | Pacote" e a troca pelo campo "Tabela de Serviços" (editável no formulário). */
function extrairTabelaDeServicos(html: string): { html: string; servicos?: ServicosDoModelo } {
  for (const m of html.matchAll(/<table[\s\S]*?<\/table>/gi)) {
    const tabela = m[0]
    const n = normaliza(textoSimples(tabela))
    if (!/servicos/.test(n) || !/pacote/.test(n)) continue
    const linhas = [...tabela.matchAll(/<tr[\s\S]*?<\/tr>/gi)]
    if (linhas.length < 2) continue
    const corpo = linhas.slice(1)
    const celulas = (tr: string) => [...tr.matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((c) => textoSimples(c[1]).trim())
    const linhasPadrao = corpo.map((l) => celulas(l[0])).filter((c) => c.length >= 2 && (c[0] || c[1])).map((c) => ({ codigo: c[0], nome: c[1] }))
    const ultima = corpo[corpo.length - 1]
    const servicos: ServicosDoModelo = {
      linhasPadrao,
      prefixo: tabela.slice(0, corpo[0].index),
      linhaMolde: corpo[0][0],
      sufixo: tabela.slice((ultima.index ?? 0) + ultima[0].length),
    }
    return { html: html.replace(tabela, '&lt;&lt;Tabela de Serviços&gt;&gt;'), servicos }
  }
  return { html }
}

interface Ocorrencia { inicio: number; fim: number; nome: string; base?: 'valor' | 'x' | 'data'; papel?: Papel; antes: string; depois: string }

export function prepararModelo(htmlOriginal: string): ModeloPreparado {
  const { html, servicos } = extrairTabelaDeServicos(htmlOriginal)
  // 1) Cada marcação do modelo, com o texto de antes e depois.
  const ocorrencias: Ocorrencia[] = [...html.matchAll(PLACEHOLDER)].map((m) => {
    const inicio = m.index ?? 0
    const nome = m[1].trim()
    const pelaNome = papelPeloNome(nome)
    const antes = textoSimples(html.slice(Math.max(0, inicio - 900), inicio)).slice(-160)
    const depois = textoSimples(html.slice(inicio + m[0].length, inicio + m[0].length + 400)).slice(0, 100)
    const base = pelaNome === 'generico' ? (normaliza(nome) as 'valor' | 'x' | 'data') : undefined
    const papel = base ? papelPeloContexto(base, antes, depois) : (pelaNome as Papel | undefined)
    return { inicio, fim: inicio + m[0].length, nome, base, papel, antes, depois }
  })
  // 2) VALOR que ficou sem significado: o primeiro antes do valor total é a instalação (a ordem do contrato).
  const iTotal = ocorrencias.findIndex((o) => o.papel === 'total')
  if (iTotal > 0 && !ocorrencias.some((o) => o.papel === 'instalacao')) {
    const primeiro = ocorrencias.findIndex((o, i) => i < iTotal && o.base === 'valor' && !o.papel)
    if (primeiro >= 0) ocorrencias[primeiro].papel = 'instalacao'
  }
  // 3) Nomes finais e lista de campos.
  const campos = new Map<string, CampoDoModelo>()
  const genericos: Record<string, number> = {}
  let saida = ''
  let cursor = 0
  for (const o of ocorrencias) {
    let nomeFinal = o.nome
    if (o.base) {
      if (o.papel) nomeFinal = NOME_DO_PAPEL[o.papel]
      else {
        genericos[o.base] = (genericos[o.base] ?? 0) + 1
        if (genericos[o.base] > 1) nomeFinal = `${o.nome} (${genericos[o.base]})`
      }
    }
    if (!campos.has(nomeFinal)) {
      const tipo = o.papel ? TIPO_DO_PAPEL[o.papel] : 'texto'
      const sufixo = o.papel === 'vigencia' && /meses$/i.test(o.nome) && !/\(meses\)/i.test(o.nome) ? ' meses' : undefined
      campos.set(nomeFinal, {
        nome: nomeFinal, papel: o.papel, tipo, contexto: `${o.antes.slice(-55)}[${nomeFinal}]${o.depois.slice(0, 35)}`.trim(),
        sufixo, automatico: o.papel === 'total' || o.papel === 'vigencia' || o.papel === 'hoje' || o.papel === 'nParcelas' || o.papel === 'parcela',
      })
    }
    saida += html.slice(cursor, o.inicio) + `&lt;&lt;${nomeFinal}&gt;&gt;`
    cursor = o.fim
  }
  saida += html.slice(cursor)
  // 4) A conta do total precisa da mensalidade; se o modelo não tem marcação pra ela, o campo entra mesmo assim no formulário.
  const lista = [...campos.values()]
  if (lista.some((c) => c.papel === 'total') && !lista.some((c) => c.papel === 'mensal')) {
    lista.push({ nome: NOME_DO_PAPEL.mensal, papel: 'mensal', tipo: 'moeda', contexto: 'Mensalidade (MRR) — o total é ela × os meses da fidelidade', implicito: true })
  }
  return { html: saida, campos: lista, servicos }
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
  const nParc = por('nParcelas')
  if (nParc && !manual(nParc) && meses > 0) out[nParc.nome] = String(meses)
  const parcela = por('parcela')
  if (parcela && !manual(parcela)) {
    const t = total ? lerMoeda(out[total.nome]) : null
    const np = nParc ? Number((out[nParc.nome] ?? '').replace(/\D/g, '')) : 0
    out[parcela.nome] = t != null && np > 0 ? formatarMoeda(t / np) : ''
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
