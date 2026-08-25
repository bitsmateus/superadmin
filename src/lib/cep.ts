import { onlyDigits } from '@/lib/cnpj'

export function isValidCepLength(value: string): boolean {
  return onlyDigits(value).length === 8
}

/** "00000-000" — formata enquanto digita. */
export function formatCep(value: string): string {
  const d = onlyDigits(value).slice(0, 8)
  return d.length > 5 ? `${d.slice(0, 5)}-${d.slice(5)}` : d
}
