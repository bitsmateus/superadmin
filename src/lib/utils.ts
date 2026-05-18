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

export function deriveSupportEmail(companyName: string): string {
  const slug = slugify(companyName ?? '')
  return slug ? `suportenx-${slug}@gmail.com` : ''
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
