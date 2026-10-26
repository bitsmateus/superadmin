import * as React from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { BellRing } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { useAuth } from '@/hooks/useAuth'
import {
  ajustarNotificacoes, notificacoesService, recarregarNotificacoes, useNotificacoes, type Notificacao,
} from '@/services/notificacoes'
import { VISUAL_DO_TIPO } from '@/components/notificacoes/tipos'
import { useOutroPopupObrigatorio, useTelaTravada } from '@/lib/telaTravada'
import { timeAgo } from '@/lib/time'
import { cn } from '@/lib/utils'

/** Notificação não lida há tanto tempo vira lembrete. */
const ESPERA_MS = 60 * 60 * 1000
/** Depois que a pessoa resolve o lembrete, ele só volta depois disso (se ainda tiver não lida antiga). */
const INTERVALO_ENTRE_LEMBRETES_MS = 60 * 60 * 1000
const VISIVEIS = 5
/** Checa de novo a cada minuto (a lista já se atualiza sozinha; isso é só pro relógio andar). */
const TIQUE_MS = 60_000

const chaveDoUltimo = (userId: string) => `notificacoes_lembrete:${userId}`

/**
 * Lembrete das notificações: quem recebe e tem notificação NÃO LIDA há 1h ou mais vê um popup no meio da tela com as
 * últimas não lidas, pra marcar como lidas (ou abrir uma). Direto ao ponto: só as da própria pessoa, nunca pra admin,
 * e nunca por cima de outro popup obrigatório (resultado da reunião, retorno da proposta) — espera eles saírem.
 */
export function LembreteDeNotificacoes() {
  const { profile } = useAuth()
  const dados = useNotificacoes()
  const navigate = useNavigate()
  const outroAberto = useOutroPopupObrigatorio('lembrete')
  const [agora, setAgora] = React.useState(() => Date.now())
  const [ultimo, setUltimo] = React.useState(0)
  const [enviando, setEnviando] = React.useState(false)

  React.useEffect(() => {
    const t = window.setInterval(() => setAgora(Date.now()), TIQUE_MS)
    return () => window.clearInterval(t)
  }, [])
  React.useEffect(() => {
    if (!profile?.id) return
    try { setUltimo(Number(window.localStorage.getItem(chaveDoUltimo(profile.id))) || 0) } catch { /* ignore */ }
  }, [profile?.id])

  const antigas = dados.itens.filter((n) => !n.lida && agora - new Date(n.created_at).getTime() >= ESPERA_MS)
  const pode = dados.recebe && !dados.somente_leitura && profile?.role !== 'admin'
  const aberto = pode && antigas.length > 0 && agora - ultimo >= INTERVALO_ENTRE_LEMBRETES_MS && !outroAberto
  useTelaTravada(aberto, 'lembrete')

  if (!aberto) return null
  const naoLidas = dados.itens.filter((n) => !n.lida)

  const resolvido = () => {
    const t = Date.now()
    setUltimo(t)
    try { if (profile?.id) window.localStorage.setItem(chaveDoUltimo(profile.id), String(t)) } catch { /* ignore */ }
  }
  const marcarTodas = async () => {
    setEnviando(true)
    ajustarNotificacoes(undefined, (d) => ({ ...d, nao_lidas: 0, itens: d.itens.map((i) => ({ ...i, lida: true })) }))
    try {
      await notificacoesService.marcarTodasLidas()
      resolvido()
    } catch (err) {
      toast.error('Não deu pra marcar: ' + (err as Error).message)
      void recarregarNotificacoes()
    } finally {
      setEnviando(false)
    }
  }
  const abrir = (n: Notificacao) => {
    ajustarNotificacoes(undefined, (d) => ({
      ...d, nao_lidas: Math.max(0, d.nao_lidas - 1), itens: d.itens.map((i) => (i.id === n.id ? { ...i, lida: true } : i)),
    }))
    notificacoesService.marcarLida(n.id, true).catch(() => { void recarregarNotificacoes() })
    resolvido()
    if (n.link) navigate(n.link)
  }

  return createPortal(
    <div className="fixed inset-0 z-[60] flex items-end justify-center p-0 sm:items-center sm:p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
      <div role="alertdialog" aria-modal="true" aria-labelledby="lembrete-titulo"
        className="relative z-10 flex max-h-[85dvh] w-full max-w-md flex-col overflow-hidden rounded-t-2xl border border-line bg-card shadow-2xl sm:rounded-2xl">
        <div className="flex items-center gap-3 border-b border-line px-4 py-3">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-accent text-white"><BellRing className="h-5 w-5" /></span>
          <div className="min-w-0">
            <h2 id="lembrete-titulo" className="text-base font-semibold text-foreground">
              Você tem {naoLidas.length} notificaç{naoLidas.length === 1 ? 'ão' : 'ões'} sem ler
            </h2>
            <p className="text-xs text-foreground/55">Dá uma olhada e marque como lidas.</p>
          </div>
        </div>
        <ul className="flex-1 overflow-y-auto">
          {naoLidas.slice(0, VISIVEIS).map((n) => {
            const v = VISUAL_DO_TIPO[n.tipo] ?? VISUAL_DO_TIPO.lead_novo_ia
            return (
              <li key={n.id} className="flex items-center gap-2.5 border-b border-line/60 px-4 py-2.5">
                <span className={cn('grid h-8 w-8 shrink-0 place-items-center rounded-full', v.cor)}>{v.icone}</span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-foreground">{n.titulo}</p>
                  <p className="truncate text-xs text-foreground/60">{n.nome || 'Lead sem nome'} · {timeAgo(n.created_at)}</p>
                </div>
                {n.link && (
                  <button type="button" onClick={() => abrir(n)} className="shrink-0 rounded-md px-2 py-1 text-xs font-medium text-accent hover:bg-accent/10">
                    Abrir
                  </button>
                )}
              </li>
            )
          })}
          {naoLidas.length > VISIVEIS && (
            <li className="px-4 py-2 text-xs text-foreground/50">+{naoLidas.length - VISIVEIS} no sininho</li>
          )}
        </ul>
        <div className="border-t border-line p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
          <Button className="w-full" loading={enviando} onClick={() => void marcarTodas()}>Marcar todas como lidas</Button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
