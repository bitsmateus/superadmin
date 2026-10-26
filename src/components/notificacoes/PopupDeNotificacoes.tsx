import * as React from 'react'
import { useNavigate } from 'react-router-dom'
import { X } from 'lucide-react'
import { useAuth } from '@/hooks/useAuth'
import {
  ajustarNotificacoes, notificacoesService, recarregarNotificacoes, useNotificacoes, type Notificacao,
} from '@/services/notificacoes'
import { VISUAL_DO_TIPO, tocarAviso } from '@/components/notificacoes/tipos'
import { timeAgo } from '@/lib/time'
import { cn } from '@/lib/utils'

const VISIVEIS = 4
/** Só vira popup o que chegou nas últimas 24h (o resto fica só no sininho). */
const JANELA_MS = 24 * 60 * 60 * 1000

/**
 * Popup das notificações (canto inferior direito, em qualquer tela), pra quem recebe — admin nunca. Fica até a pessoa
 * fechar (X) ou clicar. Fechar NÃO marca como lida: continua no sininho. Clicar marca como lida e abre o card. Toca um
 * som curto quando chega uma nova.
 */
export function PopupDeNotificacoes() {
  const { profile } = useAuth()
  const dados = useNotificacoes()
  const navigate = useNavigate()
  const vistos = React.useRef<Set<string> | null>(null)

  const abertos = dados.itens.filter(
    (n) => !n.lida && !n.popup_fechado && Date.now() - new Date(n.created_at).getTime() < JANELA_MS,
  )

  // Som só pra o que chegou depois de a tela abrir (o que já estava lá não apita de novo a cada recarga).
  React.useEffect(() => {
    if (!dados.recebe) return
    const ids = new Set(abertos.map((n) => n.id))
    if (vistos.current === null) { vistos.current = ids; return }
    const novos = [...ids].some((id) => !vistos.current!.has(id))
    for (const id of ids) vistos.current.add(id)
    if (novos) tocarAviso()
  }, [dados.recebe, abertos.map((n) => n.id).join(',')]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!dados.recebe || profile?.role === 'admin' || !abertos.length) return null

  const fechar = (n: Notificacao) => {
    ajustarNotificacoes(undefined, (d) => ({ ...d, itens: d.itens.map((i) => (i.id === n.id ? { ...i, popup_fechado: true } : i)) }))
    notificacoesService.fecharPopup(n.id).catch(() => { void recarregarNotificacoes() })
  }
  const abrir = (n: Notificacao) => {
    ajustarNotificacoes(undefined, (d) => ({
      ...d, nao_lidas: Math.max(0, d.nao_lidas - 1), itens: d.itens.map((i) => (i.id === n.id ? { ...i, lida: true } : i)),
    }))
    notificacoesService.marcarLida(n.id, true).catch(() => { void recarregarNotificacoes() })
    if (n.link) navigate(n.link)
  }

  const resto = abertos.length - VISIVEIS
  return (
    <div className="fixed bottom-10 right-4 z-40 flex w-[min(22rem,calc(100vw-2rem))] flex-col gap-2" aria-live="polite">
      {abertos.slice(0, VISIVEIS).map((n) => {
        const v = VISUAL_DO_TIPO[n.tipo] ?? VISUAL_DO_TIPO.lead_novo_ia
        return (
          <div key={n.id} className="rounded-xl border border-line bg-card p-3 shadow-lg animate-fade-in">
            <div className="flex items-start gap-2.5">
              <span className={cn('grid h-8 w-8 shrink-0 place-items-center rounded-full', v.cor)}>{v.icone}</span>
              <button type="button" onClick={() => abrir(n)} className="min-w-0 flex-1 text-left">
                <p className="text-xs font-medium text-foreground/50">{n.titulo} · {timeAgo(n.created_at)}</p>
                <p className="truncate text-sm font-semibold text-foreground">{n.nome || 'Lead sem nome'}</p>
                {n.mensagem && <p className="line-clamp-2 text-xs text-foreground/60">{n.mensagem}</p>}
                {n.link && <span className="mt-1.5 inline-block text-xs font-medium text-accent">Abrir card</span>}
              </button>
              <button
                type="button"
                onClick={() => fechar(n)}
                title="Fechar (continua no sininho como não lida)"
                aria-label="Fechar"
                className="rounded-md p-1 text-foreground/40 hover:bg-elevate/[0.06] hover:text-foreground"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>
        )
      })}
      {resto > 0 && (
        <div className="rounded-xl border border-line bg-card px-3 py-2 text-xs text-foreground/55 shadow-lg">
          +{resto} no sininho
        </div>
      )}
    </div>
  )
}
