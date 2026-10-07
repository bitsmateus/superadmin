import * as React from 'react'
import { estiloDoAvatar } from '@/lib/gcVisual'
import { iniciaisDe } from '@/lib/gcIniciais'
import { cn } from '@/lib/utils'

/** O avatar do cliente: a logo, se foi enviada, ou as iniciais coloridas. */
export function AvatarCliente({
  nome, logoUrl, className,
}: {
  nome: string
  logoUrl?: string | null
  /** Tamanho e arredondamento (ex.: "h-9 w-9 rounded-xl text-xs"). */
  className?: string
}) {
  if (logoUrl) {
    return <img src={logoUrl} alt="" className={cn('shrink-0 border border-line bg-white object-contain p-0.5', className)} />
  }
  return (
    <span
      className={cn('grid shrink-0 place-items-center border font-semibold', className)}
      style={estiloDoAvatar(nome)}
    >
      {iniciaisDe(nome) || '—'}
    </span>
  )
}
