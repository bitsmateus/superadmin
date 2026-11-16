/**
 * Endereço do contratante no contrato: junta o que a Receita (CNPJ), o CEP (ViaCEP) e o endereço escrito na ficha de
 * cadastro trazem, nessa ordem de preferência por campo. O que nenhuma fonte souber fica vazio pra preencher à mão; só o
 * complemento tem padrão: sem complemento, vale "Empresa".
 */

export interface EnderecoParcial {
  logradouro?: string
  numero?: string
  bairro?: string
  municipio?: string
  uf?: string
  cep?: string
}

export interface EnderecoCompleto {
  logradouro: string
  numero: string
  complemento: string
  bairro: string
  municipio: string
  uf: string
  cep: string
}

export const COMPLEMENTO_PADRAO = 'Empresa'

const NUMERO_RE = /^(?:n[º°o]?\.?\s*)?(\d{1,6}[a-z]?|s\/?n)$/i
const CEP_RE = /\b\d{5}-?\d{3}\b/

const limpa = (v: string | null | undefined) => (v ?? '').replace(/\s+/g, ' ').trim()

/**
 * Lê o endereço escrito à mão na ficha ("Rua das Flores, 123, Centro, Tapiratiba - SP, 13760-000"): rua, número, bairro
 * e CEP quando aparecem. Cidade e UF vêm do CNPJ/CEP, que são mais confiáveis que o texto.
 */
export function lerEnderecoDaFicha(texto: string | null | undefined): EnderecoParcial {
  const bruto = limpa(texto)
  if (!bruto) return {}
  const out: EnderecoParcial = {}
  const cep = bruto.match(CEP_RE)?.[0]
  if (cep) out.cep = cep.replace(/\D/g, '')
  const semCep = bruto.replace(CEP_RE, '')
  const partes = semCep.split(/\s*[,;]\s*|\s+[-–]\s+/).map(limpa).filter(Boolean)
  if (!partes.length) return out

  let rua = partes[0]
  let i = 1
  // "Rua X nº 123" / "Rua X 123" na mesma parte.
  const junto = rua.match(/^(.*?\D)\s*(?:n[º°o]?\.?\s*)?(\d{1,6}[a-z]?)$/i)
  if (junto && !/^\d/.test(rua)) {
    rua = limpa(junto[1])
    out.numero = junto[2]
  } else if (partes[1] && NUMERO_RE.test(partes[1])) {
    const n = partes[1].replace(/^(?:n[º°o]?\.?\s*)/i, '')
    out.numero = /^s\/?n$/i.test(n) ? 'S/N' : n
    i = 2
  }
  if (rua && !/^\d+$/.test(rua)) out.logradouro = rua
  // O que vem depois do número, antes da cidade: o bairro (só quando sobra mais de uma parte além de cidade/UF).
  const resto = partes.slice(i).filter((p) => !/^[A-Za-z]{2}$/.test(p))
  if (resto.length >= 2) out.bairro = resto[0]
  return out
}

/** Primeiro valor preenchido. */
const primeiro = (...v: (string | null | undefined)[]) => v.map(limpa).find(Boolean) ?? ''

/**
 * @param cnpj    o que a consulta de CNPJ trouxe
 * @param viaCep  o que o CEP trouxe (null se não consultou/não achou)
 * @param ficha   o endereço escrito na ficha de cadastro
 */
export function mesclarEndereco(
  cnpj: { logradouro?: string; numero?: string; complemento?: string; bairro?: string; municipio?: string; uf?: string; cep?: string },
  viaCep: { logradouro?: string; bairro?: string; localidade?: string; uf?: string } | null,
  ficha: string | null | undefined,
): EnderecoCompleto {
  const f = lerEnderecoDaFicha(ficha)
  return {
    // Rua e bairro: Receita, depois o que o cliente escreveu na ficha, depois o CEP (que no CEP geral da cidade vem vazio).
    logradouro: primeiro(cnpj.logradouro, f.logradouro, viaCep?.logradouro),
    numero: primeiro(cnpj.numero, f.numero),
    complemento: primeiro(cnpj.complemento) || COMPLEMENTO_PADRAO,
    bairro: primeiro(cnpj.bairro, f.bairro, viaCep?.bairro),
    municipio: primeiro(cnpj.municipio, viaCep?.localidade),
    uf: primeiro(cnpj.uf, viaCep?.uf),
    cep: primeiro(cnpj.cep, f.cep),
  }
}

/** Falta rua, bairro, cidade ou UF? Aí vale consultar o CEP pra completar. */
export function precisaConsultarCep(cnpj: { logradouro?: string; bairro?: string; municipio?: string; uf?: string }): boolean {
  return !limpa(cnpj.logradouro) || !limpa(cnpj.bairro) || !limpa(cnpj.municipio) || !limpa(cnpj.uf)
}
