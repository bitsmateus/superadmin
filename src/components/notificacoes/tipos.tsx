import * as React from 'react'
import { BadgeCheck, CalendarCheck2, FileText, Headset, Sparkles } from 'lucide-react'
import type { Notificacao } from '@/services/notificacoes'

/** Ícone e cor de cada tipo: transferência laranja, reunião verde, proposta azul, lead novo cinza. */
export const VISUAL_DO_TIPO: Record<Notificacao['tipo'], { icone: React.ReactNode; cor: string; rotulo: string }> = {
  transferencia_ia: { icone: <Headset className="h-4 w-4" />, cor: 'text-orange-500 bg-orange-500/10', rotulo: 'Transferência' },
  reuniao_agendada_ia: { icone: <CalendarCheck2 className="h-4 w-4" />, cor: 'text-green-600 bg-green-500/10', rotulo: 'Reunião' },
  resposta_proposta: { icone: <FileText className="h-4 w-4" />, cor: 'text-blue-500 bg-blue-500/10', rotulo: 'Proposta' },
  lead_novo_ia: { icone: <Sparkles className="h-4 w-4" />, cor: 'text-foreground/60 bg-elevate/[0.08]', rotulo: 'Lead novo' },
  lead_qualificado_ia: { icone: <BadgeCheck className="h-4 w-4" />, cor: 'text-foreground/60 bg-elevate/[0.08]', rotulo: 'Qualificado' },
}

/** Som curto de aviso (gerado na hora, sem arquivo). Navegador pode bloquear antes do primeiro clique: aí fica mudo. */
export function tocarAviso() {
  try {
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!Ctx) return
    const ctx = new Ctx()
    const tom = (freq: number, inicio: number) => {
      const osc = ctx.createOscillator()
      const ganho = ctx.createGain()
      osc.frequency.value = freq
      ganho.gain.setValueAtTime(0.0001, ctx.currentTime + inicio)
      ganho.gain.exponentialRampToValueAtTime(0.18, ctx.currentTime + inicio + 0.02)
      ganho.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + inicio + 0.16)
      osc.connect(ganho).connect(ctx.destination)
      osc.start(ctx.currentTime + inicio)
      osc.stop(ctx.currentTime + inicio + 0.18)
    }
    tom(880, 0)
    tom(1320, 0.12)
    window.setTimeout(() => { void ctx.close() }, 600)
  } catch { /* sem áudio: segue mudo */ }
}
