import type { Estado } from '@/lib/gcSaude'

/** Um número estável (0–359) a partir do nome: o mesmo cliente tem sempre a mesma cor de avatar. */
export function matizDoNome(nome: string): number {
  let h = 0
  for (let i = 0; i < nome.length; i++) h = (h * 31 + nome.charCodeAt(i)) % 360
  return h
}

/** Estilo do avatar de iniciais: degradê suave na cor do cliente, texto na mesma família. */
export function estiloDoAvatar(nome: string): { background: string; color: string; borderColor: string } {
  const h = matizDoNome(nome)
  return {
    background: `linear-gradient(135deg, hsl(${h} 70% 55% / 0.28), hsl(${(h + 40) % 360} 70% 55% / 0.10))`,
    color: `hsl(${h} 85% 72%)`,
    borderColor: `hsl(${h} 70% 55% / 0.30)`,
  }
}

/** Faixa lateral do card/linha pela saúde do cliente — cor + posição, nunca só cor (a pastilha traz o texto). */
export const FAIXA_DA_SAUDE: Record<Estado, string> = {
  otimo: 'border-l-success',
  bom: 'border-l-accent',
  atencao: 'border-l-warning',
  risco: 'border-l-danger',
  neutro: 'border-l-foreground/20',
}
