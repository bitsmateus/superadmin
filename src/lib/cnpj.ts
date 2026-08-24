/** Só dígitos — pra validar/enviar pra API. */
export function onlyDigits(value: string): string {
  return (value || '').replace(/\D/g, '')
}

export function isValidCnpjLength(value: string): boolean {
  return onlyDigits(value).length === 14
}

/** "00.000.000/0000-00" — formata enquanto digita, sem travar em tamanhos parciais. */
export function formatCnpj(value: string): string {
  const d = onlyDigits(value).slice(0, 14)
  let out = d
  if (d.length > 2) out = `${d.slice(0, 2)}.${d.slice(2)}`
  if (d.length > 5) out = `${out.slice(0, 6)}.${out.slice(6)}`
  if (d.length > 8) out = `${out.slice(0, 10)}/${out.slice(10)}`
  if (d.length > 12) out = `${out.slice(0, 15)}-${out.slice(15)}`
  return out
}
