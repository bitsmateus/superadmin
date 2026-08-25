/**
 * Placeholders do modelo de contrato ficam guardados como entidades HTML — "&lt;&lt;Nome
 * Fantasia&gt;&gt;" — pra serem HTML válido dentro do próprio texto (o "<<...>>" visual do
 * documento original não pode ir cru, o navegador tentaria interpretar como tag). Essa regex casa
 * exatamente esse formato.
 */
const PLACEHOLDER_RE = /&lt;&lt;([^&]+?)&gt;&gt;/g

/** Nomes dos placeholders detectados no modelo, na ordem em que aparecem, sem repetir — cada nome
 * vira UM campo no formulário (preencher uma vez substitui TODAS as ocorrências). */
export function extractPlaceholders(html: string): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const m of html.matchAll(PLACEHOLDER_RE)) {
    const name = m[1].trim()
    if (!seen.has(name)) { seen.add(name); out.push(name) }
  }
  return out
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/** "Tabela de Serviços" não é texto simples — o valor já vem como HTML pronto (ver
 * applyServicesTable) e não pode ser escapado, senão a tabela apareceria como texto cru. */
const RAW_PLACEHOLDER_NAMES = new Set(['Tabela de Serviços'])

/** Substitui cada placeholder pelo valor preenchido em `campos`. Sem valor (ou vazio) = mantém o
 * token visível, pintado de vermelho — mesmo aviso visual do documento original de referência. */
export function applyPlaceholders(html: string, campos: Record<string, string>): string {
  return html.replace(PLACEHOLDER_RE, (full, rawName: string) => {
    const name = rawName.trim()
    const value = campos[name]?.trim()
    if (!value) return `<span style="color:#dc2626;font-weight:600;">${full}</span>`
    return RAW_PLACEHOLDER_NAMES.has(name) ? value : escapeHtml(value)
  })
}

function normalize(s: string): string {
  const noAccents = s
    .normalize('NFD')
    .split('')
    .filter((ch) => {
      const code = ch.codePointAt(0) ?? 0
      return code < 0x0300 || code > 0x036f
    })
    .join('')
  return noAccents.toLowerCase().trim()
}

/** Casamento EXATO (não parcial) entre o nome do placeholder normalizado e o campo da BrasilAPI —
 * evita, por exemplo, "Número" (endereço) confundir com "Número de telas". */
const CNPJ_FIELD_ALIASES: Record<string, string> = {
  'nome fantasia': 'nomeFantasia',
  'razao social': 'razaoSocial',
  'logradouro/rua': 'logradouro',
  'logradouro': 'logradouro',
  'rua': 'logradouro',
  'numero': 'numero',
  'complemento': 'complemento',
  'bairro': 'bairro',
  'cidade': 'municipio',
  'municipio': 'municipio',
  'estado': 'uf',
  'uf': 'uf',
  'cep': 'cep',
}

/** Pro placeholder detectado no modelo, devolve a chave correspondente na resposta da BrasilAPI
 * (ou undefined se não for um campo derivável do CNPJ — esses ficam sempre manuais). */
export function cnpjFieldFor(placeholderName: string): string | undefined {
  return CNPJ_FIELD_ALIASES[normalize(placeholderName)]
}

/** Casamento EXATO entre o nome do placeholder normalizado e o campo da resposta do ViaCEP. */
const CEP_FIELD_ALIASES: Record<string, string> = {
  'logradouro/rua': 'logradouro',
  'logradouro': 'logradouro',
  'rua': 'logradouro',
  'complemento': 'complemento',
  'bairro': 'bairro',
  'cidade': 'localidade',
  'municipio': 'localidade',
  'estado': 'uf',
  'uf': 'uf',
}

export function cepFieldFor(placeholderName: string): string | undefined {
  return CEP_FIELD_ALIASES[normalize(placeholderName)]
}

// ---------- Seções do formulário ----------

export type PlaceholderSection = 'contratante' | 'servicos' | 'valores' | 'vigencia' | 'outros'

export const SECTION_LABELS: Record<PlaceholderSection, string> = {
  contratante: 'Dados do contratante',
  servicos: 'Serviços contratados',
  valores: 'Valores e vencimentos',
  vigencia: 'Vigência e multa',
  outros: 'Outros campos',
}

export const SECTION_ORDER: PlaceholderSection[] = ['contratante', 'servicos', 'valores', 'vigencia', 'outros']

const SECTION_ALIASES: Record<string, PlaceholderSection> = {
  'nome fantasia': 'contratante',
  'razao social': 'contratante',
  'cnpj': 'contratante',
  'cep': 'contratante',
  'logradouro/rua': 'contratante',
  'logradouro': 'contratante',
  'rua': 'contratante',
  'numero': 'contratante',
  'complemento': 'contratante',
  'bairro': 'contratante',
  'cidade': 'contratante',
  'municipio': 'contratante',
  'estado': 'contratante',
  'uf': 'contratante',
  'numero de telas': 'servicos',
  'tabela de servicos': 'servicos',
  'valor de instalacao': 'valores',
  'valor mensal': 'valores',
  'data': 'valores',
  'data de inicio': 'valores',
  'vigencia (meses)': 'vigencia',
  'reajuste (meses)': 'vigencia',
  'multa rescisoria (%)': 'vigencia',
}

/** Placeholder sem seção conhecida (ex.: alguém adicionou um novo `<<...>>` editando o modelo
 * padrão) cai em "Outros campos" — nunca some do formulário. */
export function sectionFor(placeholderName: string): PlaceholderSection {
  return SECTION_ALIASES[normalize(placeholderName)] ?? 'outros'
}

const HINT_ALIASES: Record<string, string> = {
  'numero de telas': 'Cláusula 1ª, § 1º.',
  'vigencia (meses)': 'Cláusula 16ª. Os padrões já são os do contrato original — só mexa se o cliente negociou diferente.',
  'reajuste (meses)': 'Cláusula 6ª. Os padrões já são os do contrato original — só mexa se o cliente negociou diferente.',
  'multa rescisoria (%)': 'Cláusulas 14ª e § 1º. Os padrões já são os do contrato original — só mexa se o cliente negociou diferente.',
}

export function hintFor(placeholderName: string): string | undefined {
  return HINT_ALIASES[normalize(placeholderName)]
}

/** Valor que já vem preenchido num contrato novo, antes mesmo de buscar o CNPJ — os padrões do
 * próprio contrato (vigência, reajuste, multa), editáveis se o cliente negociou diferente. */
const DEFAULT_ALIASES: Record<string, string> = {
  'vigencia (meses)': '12',
  'reajuste (meses)': '12',
  'multa rescisoria (%)': '30',
}

export function defaultValueFor(placeholderName: string): string | undefined {
  return DEFAULT_ALIASES[normalize(placeholderName)]
}

// ---------- Tabela de serviços (repetível) ----------

export interface ServiceRow {
  codigo: string
  nome: string
}

export const DEFAULT_SERVICE_ROWS: ServiceRow[] = [
  { codigo: '01', nome: 'PLATAFORMA NX' },
  { codigo: '02', nome: 'API' },
  { codigo: '03', nome: 'SUPORTE DEDICADO' },
]

/** O campo "Tabela de Serviços" guarda as linhas como JSON (não o HTML pronto) — assim dá pra
 * reabrir e continuar editando depois, sem precisar reconstruir a partir do HTML gerado. */
export function parseServiceRows(raw: string | undefined): ServiceRow[] {
  if (!raw) return DEFAULT_SERVICE_ROWS
  try {
    const parsed = JSON.parse(raw)
    if (Array.isArray(parsed) && parsed.every((r) => typeof r?.codigo === 'string' && typeof r?.nome === 'string')) {
      return parsed as ServiceRow[]
    }
  } catch {
    /* ignore */
  }
  return DEFAULT_SERVICE_ROWS
}

function buildServicesTableHtml(rows: ServiceRow[]): string {
  const body = rows
    .map(
      (r) =>
        `<tr><td style="border:1px solid #999;padding:6pt;text-align:center;">${escapeHtml(r.codigo)}</td><td style="border:1px solid #999;padding:6pt;">${escapeHtml(r.nome)}</td></tr>`,
    )
    .join('')
  return `<table style="width:100%;border-collapse:collapse;margin:0 0 14pt;"><thead><tr><th style="border:1px solid #999;padding:6pt;background:#f1f1f1;">Serviços</th><th style="border:1px solid #999;padding:6pt;background:#f1f1f1;">Pacote</th></tr></thead><tbody>${body || '<tr><td colspan="2" style="border:1px solid #999;padding:6pt;text-align:center;color:#999;">Nenhum serviço</td></tr>'}</tbody></table>`
}

/** Roda ANTES de applyPlaceholders — troca o token da tabela pelo HTML já pronto, montado a partir
 * das linhas em `campos['Tabela de Serviços']` (JSON). O restante dos campos passa pelo caminho
 * normal (texto escapado) na sequência. */
export function applyServicesTable(html: string, campos: Record<string, string>): string {
  const rows = parseServiceRows(campos['Tabela de Serviços'])
  const tableHtml = buildServicesTableHtml(rows)
  return html.replace(/&lt;&lt;Tabela de Serviços&gt;&gt;/g, tableHtml)
}
