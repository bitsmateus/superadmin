import { api } from '@/services/api'
import { onlyDigits } from '@/lib/cnpj'

export interface CnpjData {
  razaoSocial: string
  nomeFantasia: string
  logradouro: string
  numero: string
  complemento: string
  bairro: string
  municipio: string
  uf: string
  cep: string
}

/** Busca pontual — sem cache/estado, cada chamada é uma consulta nova. */
export function lookupCnpj(cnpj: string): Promise<CnpjData> {
  return api.get<CnpjData>(`/api/cnpj/${onlyDigits(cnpj)}`)
}
