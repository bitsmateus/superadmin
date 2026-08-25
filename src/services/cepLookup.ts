import { onlyDigits } from '@/lib/cnpj'

export interface CepData {
  logradouro: string
  complemento: string
  bairro: string
  localidade: string
  uf: string
}

/** ViaCEP é público, sem chave e aceita CORS direto do navegador — sem precisar passar pelo
 * backend (diferente do CNPJ, que usa a BrasilAPI escondida atrás de /api/cnpj pra evitar CORS/
 * expor rate-limit). Busca pontual, sem cache/estado. */
export async function lookupCep(cep: string): Promise<CepData> {
  const digits = onlyDigits(cep)
  const res = await fetch(`https://viacep.com.br/ws/${digits}/json/`)
  if (!res.ok) throw new Error('Falha ao consultar o CEP.')
  const data = await res.json()
  if (data.erro) throw new Error('CEP não encontrado.')
  return {
    logradouro: data.logradouro ?? '',
    complemento: data.complemento ?? '',
    bairro: data.bairro ?? '',
    localidade: data.localidade ?? '',
    uf: data.uf ?? '',
  }
}
