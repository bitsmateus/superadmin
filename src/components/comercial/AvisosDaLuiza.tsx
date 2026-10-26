import * as React from 'react'
import { BadgeCheck, CalendarCheck2, Sparkles, X } from 'lucide-react'
import { toast } from 'sonner'
import { onSseEvent } from '@/services/api'
import { leadAvisosService, type AvisoDaLuiza } from '@/services/leadAvisos'
import { agendamentoLegivel } from '@/services/reunioes'
import { rotuloDaOrigem } from '@/lib/regraDoStatus'
import { timeAgo } from '@/lib/time'
import { cn } from '@/lib/utils'

const VISIVEIS = 4
const INTERVALO_MS = 60_000

const TIPO: Record<AvisoDaLuiza['tipo'], { titulo: string; icone: React.ReactNode; cor: string }> = {
  novo: { titulo: 'Novo atendimento da Luiza', icone: <Sparkles className="h-4 w-4" />, cor: 'text-accent bg-accent/10' },
  qualificado: { titulo: 'Luiza qualificou', icone: <BadgeCheck className="h-4 w-4" />, cor: 'text-success bg-success/10' },
  reuniao_agendada: { titulo: 'Luiza agendou reunião', icone: <CalendarCheck2 className="h-4 w-4" />, cor: 'text-pink-500 bg-pink-500/10' },
}

/**
 * Avisos da Luiza na tela do CRM ARTHUR (card novo no CRM IA LUIZA, Qualificado, Reunião agendada). Ficam no canto,
 * sem travar nada, até a pessoa marcar como lido (X) — cada um tem o seu "lido". Chegam na hora pelo tempo real e,
 * de garantia, a cada 1 min.
 */
export function AvisosDaLuiza({ onAbrir }: { onAbrir: (cardId: string) => void }) {
  const [avisos, setAvisos] = React.useState<AvisoDaLuiza[]>([])

  const carregar = React.useCallback(async () => {
    try { setAvisos(await leadAvisosService.naoLidos()) } catch { /* sem rede: tenta no próximo ciclo */ }
  }, [])

  React.useEffect(() => {
    void carregar()
    const timer = window.setInterval(() => { void carregar() }, INTERVALO_MS)
    const desliga = onSseEvent((table) => { if (table === 'lead_avisos') void carregar() })
    return () => { window.clearInterval(timer); desliga() }
  }, [carregar])

  const marcar = async (ids?: string[]) => {
    const antes = avisos
    setAvisos((l) => (ids ? l.filter((a) => !ids.includes(a.id)) : []))
    try { await leadAvisosService.marcarLidos(ids) } catch (err) {
      setAvisos(antes)
      toast.error('Não deu pra marcar como lido: ' + (err as Error).message)
    }
  }

  if (!avisos.length) return null
  const resto = avisos.length - VISIVEIS

  return (
    <div className="fixed bottom-10 right-4 z-40 flex w-[min(22rem,calc(100vw-2rem))] flex-col gap-2" aria-live="polite">
      {avisos.slice(0, VISIVEIS).map((a) => {
        const t = TIPO[a.tipo]
        const detalhe = a.tipo === 'reuniao_agendada' && a.agendamento
          ? agendamentoLegivel(a.agendamento)
          : rotuloDaOrigem(a.origem)
        return (
          <div key={a.id} className="rounded-xl border border-line bg-card p-3 shadow-lg animate-fade-in">
            <div className="flex items-start gap-2.5">
              <span className={cn('grid h-8 w-8 shrink-0 place-items-center rounded-full', t.cor)}>{t.icone}</span>
              <div className="min-w-0 flex-1">
                <p className="text-xs font-medium text-foreground/50">{t.titulo} · {timeAgo(a.created_at)}</p>
                <p className="truncate text-sm font-semibold text-foreground">{a.nome || 'Lead sem nome'}</p>
                {(a.empresa || detalhe) && (
                  <p className="truncate text-xs text-foreground/60">{[a.empresa, detalhe].filter(Boolean).join(' · ')}</p>
                )}
                <button
                  type="button"
                  onClick={() => onAbrir(a.card_id)}
                  className="mt-1.5 text-xs font-medium text-accent hover:underline"
                >
                  Abrir card
                </button>
              </div>
              <button
                type="button"
                onClick={() => void marcar([a.id])}
                title="Marcar como lido"
                aria-label="Marcar como lido"
                className="rounded-md p-1 text-foreground/40 hover:bg-elevate/[0.06] hover:text-foreground"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>
        )
      })}
      {avisos.length > 1 && (
        <div className="flex items-center justify-between rounded-xl border border-line bg-card px-3 py-2 text-xs shadow-lg">
          <span className="text-foreground/55">{resto > 0 ? `+${resto} aviso(s)` : `${avisos.length} avisos`}</span>
          <button type="button" onClick={() => void marcar()} className="font-medium text-accent hover:underline">
            Marcar todos como lidos
          </button>
        </div>
      )}
    </div>
  )
}
