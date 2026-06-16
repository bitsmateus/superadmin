import { clsx, type ClassValue } from 'clsx'

export function cn(...inputs: ClassValue[]) {
  return clsx(inputs)
}

export function formatDate(value?: string | number | Date | null): string {
  if (!value) return '—'
  const d = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleString('pt-BR', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export function formatDateShort(value?: string | number | Date | null): string {
  if (!value) return '—'
  const d = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleDateString('pt-BR', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  })
}

export function isTenantActive(t: { status?: string; active?: boolean; is_active?: boolean }): boolean {
  if (typeof t.active === 'boolean') return t.active
  if (typeof t.is_active === 'boolean') return t.is_active
  if (typeof t.status === 'string') {
    const s = t.status.toLowerCase()
    return s === 'active' || s === 'ativo' || s === 'enabled' || s === '1' || s === 'true'
  }
  return false
}

export function slugify(input: string): string {
  return input
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

/**
 * Normaliza um número de WhatsApp para só dígitos com prefixo 55 (Brasil).
 * Ex.: "(62) 99276-4210" → "5562992764210". Usado como nome da instância na
 * Evolution e da sessão no NX (mesmo identificador nas duas pontas).
 */
export function normalizeWhatsappNumber(input: string): string {
  let digits = (input ?? '').replace(/\D/g, '')
  if (!digits) return ''
  if (!digits.startsWith('55')) digits = '55' + digits
  return digits
}

export function deriveSupportEmail(companyName: string): string {
  // Nome da empresa compactado: sem acento, minúsculo e SEM separadores
  // (espaços/hífens removidos). Ex.: "RK Tendas" → "suportenx-rktendas@gmail.com".
  const compact = (companyName ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '')
  return compact ? `suportenx-${compact}@gmail.com` : ''
}

export function isLikelyEmail(value: unknown): value is string {
  return typeof value === 'string' && /\S+@\S+\.\S+/.test(value)
}

export function asText(value: unknown, fallback = ''): string {
  if (value === null || value === undefined) return fallback
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>
    if (typeof obj.name === 'string') return obj.name
    if (typeof obj.title === 'string') return obj.title
    if (typeof obj.label === 'string') return obj.label
    try {
      return JSON.stringify(value)
    } catch {
      return fallback
    }
  }
  return String(value)
}

export function initials(name?: string): string {
  if (!name) return '?'
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? '')
    .join('')
}
