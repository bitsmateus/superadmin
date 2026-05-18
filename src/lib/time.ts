export function daysBetween(a: Date, b: Date): number {
  const ms = b.getTime() - a.getTime()
  return Math.floor(ms / (1000 * 60 * 60 * 24))
}

export function timeAgo(iso?: string): string {
  if (!iso) return '—'
  const then = new Date(iso)
  if (Number.isNaN(then.getTime())) return '—'
  const now = new Date()
  const diff = Math.floor((now.getTime() - then.getTime()) / 1000)
  if (diff < 60) return 'agora'
  if (diff < 3600) return `há ${Math.floor(diff / 60)} min`
  if (diff < 86_400) return `há ${Math.floor(diff / 3600)} h`
  const days = Math.floor(diff / 86_400)
  if (days < 7) return `há ${days} dia${days > 1 ? 's' : ''}`
  if (days < 30) {
    const w = Math.floor(days / 7)
    return `há ${w} semana${w > 1 ? 's' : ''}`
  }
  if (days < 365) {
    const m = Math.floor(days / 30)
    return `há ${m} ${m > 1 ? 'meses' : 'mês'}`
  }
  const y = Math.floor(days / 365)
  return `há ${y} ano${y > 1 ? 's' : ''}`
}

export function daysSince(iso?: string): number {
  if (!iso) return 0
  const then = new Date(iso)
  if (Number.isNaN(then.getTime())) return 0
  return daysBetween(then, new Date())
}

export function isPast(iso?: string): boolean {
  if (!iso) return false
  const t = new Date(iso).getTime()
  return Number.isFinite(t) && t < Date.now()
}

export function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  )
}
