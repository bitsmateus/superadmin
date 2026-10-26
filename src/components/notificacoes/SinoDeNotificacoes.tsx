import * as React from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { Bell, Check, CircleDot, Eye } from 'lucide-react'
import {
  ajustarNotificacoes, notificacoesService, recarregarNotificacoes, useNotificacoes, type Notificacao,
} from '@/services/notificacoes'
import { VISUAL_DO_TIPO } from '@/components/notificacoes/tipos'
import { useOutsideClose } from '@/hooks/useOutsideClose'
import { timeAgo } from '@/lib/time'
import { cn } from '@/lib/utils'

/**
 * Sininho das notificações do comercial. Sem `pagina`: as de quem está logado (só aparece pra quem recebe — Arthur e
 * Luis). Com `pagina` (admin dentro do CRM do Arthur ou do Luis): as do dono daquela aba, só pra olhar — nada aqui marca
 * como lida nem conta como visto.
 */
export function SinoDeNotificacoes({ pagina, className }: { pagina?: string; className?: string }) {
  const dados = useNotificacoes(pagina)
  const navigate = useNavigate()
  const [aberto, setAberto] = React.useState(false)
  const [filtro, setFiltro] = React.useState<'nao_lidas' | 'todas'>('nao_lidas')
  const [pos, setPos] = React.useState<React.CSSProperties>({})
  const botao = React.useRef<HTMLButtonElement>(null)
  const painel = React.useRef<HTMLDivElement>(null)
  useOutsideClose(painel, aberto, () => setAberto(false))

  if (!dados.recebe) return null
  const leitura = dados.somente_leitura
  const itens = filtro === 'nao_lidas' ? dados.itens.filter((i) => !i.lida) : dados.itens

  const abrirPainel = () => {
    const r = botao.current?.getBoundingClientRect()
    if (r) {
      const largura = Math.min(380, window.innerWidth - 16)
      const left = Math.max(8, Math.min(r.left, window.innerWidth - largura - 8))
      // Botão na metade de baixo da tela (o do menu lateral): abre pra cima; senão, pra baixo.
      setPos(r.top > window.innerHeight / 2
        ? { left, bottom: window.innerHeight - r.top + 6, width: largura }
        : { left, top: r.bottom + 6, width: largura })
    }
    setAberto((a) => !a)
  }

  const marcar = async (n: Notificacao, lida: boolean) => {
    if (leitura) return
    ajustarNotificacoes(pagina, (d) => ({
      ...d,
      itens: d.itens.map((i) => (i.id === n.id ? { ...i, lida } : i)),
      nao_lidas: Math.max(0, d.nao_lidas + (lida === n.lida ? 0 : lida ? -1 : 1)),
    }))
    try { await notificacoesService.marcarLida(n.id, lida) } catch (err) {
      toast.error('Não deu pra atualizar: ' + (err as Error).message)
      void recarregarNotificacoes(pagina)
    }
  }

  const abrir = (n: Notificacao) => {
    if (!leitura && !n.lida) void marcar(n, true)
    if (n.link) { setAberto(false); navigate(n.link) }
  }

  const marcarTodas = async () => {
    ajustarNotificacoes(pagina, (d) => ({ ...d, nao_lidas: 0, itens: d.itens.map((i) => ({ ...i, lida: true })) }))
    try { await notificacoesService.marcarTodasLidas() } catch (err) {
      toast.error('Não deu pra marcar: ' + (err as Error).message)
      void recarregarNotificacoes(pagina)
    }
  }

  return (
    <>
      <button
        ref={botao}
        type="button"
        onClick={abrirPainel}
        // O clique no próprio sininho não conta como "clicou fora" (senão fecha e o clique reabre).
        onMouseDown={(e) => e.stopPropagation()}
        title={leitura ? `Notificações do ${dados.de?.nome ?? ''} (só visualização)` : 'Notificações'}
        aria-label="Notificações"
        // Bolinha azul cheia, bem visível; com não lida, um anel pulsando em volta e o número em vermelho.
        className={cn(
          'relative grid h-9 w-9 shrink-0 place-items-center rounded-full bg-accent text-white shadow-md ring-2 ring-accent/25 transition-transform hover:scale-105 focus-ring',
          className,
        )}
      >
        {dados.nao_lidas > 0 && <span className="absolute inset-0 animate-ping rounded-full bg-accent/40" aria-hidden />}
        <Bell className="relative h-[18px] w-[18px]" />
        {leitura && (
          <span className="absolute -bottom-1 -left-1 grid h-4 w-4 place-items-center rounded-full bg-card text-foreground/60 ring-1 ring-line" title="Só visualização">
            <Eye className="h-2.5 w-2.5" />
          </span>
        )}
        {dados.nao_lidas > 0 && (
          <span className="absolute -right-1.5 -top-1.5 min-w-[20px] rounded-full bg-danger px-1 text-center text-[11px] font-bold leading-5 text-white ring-2 ring-card">
            {dados.nao_lidas > 99 ? '99+' : dados.nao_lidas}
          </span>
        )}
      </button>
      {aberto && createPortal(
        <div ref={painel} style={pos} className="fixed z-50 flex max-h-[70vh] flex-col overflow-hidden rounded-xl border border-line bg-card shadow-2xl">
          <div className="border-b border-line px-3 py-2.5">
            <div className="flex items-center justify-between gap-2">
              <p className="text-sm font-semibold text-foreground">
                Notificações{leitura && dados.de ? ` do ${dados.de.nome.split(' ')[0]}` : ''}
              </p>
              {!leitura && dados.nao_lidas > 0 && (
                <button type="button" onClick={() => void marcarTodas()} className="text-xs font-medium text-accent hover:underline">
                  Marcar todas como lidas
                </button>
              )}
            </div>
            {leitura && <p className="mt-0.5 text-[11px] text-foreground/45">Só visualização: nada aqui marca como lida pra ele.</p>}
            <div className="mt-2 inline-flex overflow-hidden rounded-lg border border-line text-xs">
              {(['nao_lidas', 'todas'] as const).map((f) => (
                <button key={f} type="button" onClick={() => setFiltro(f)}
                  className={cn('px-2.5 py-1 font-medium', filtro === f ? 'bg-accent/10 text-accent' : 'text-foreground/55 hover:bg-elevate/[0.04]')}>
                  {f === 'nao_lidas' ? `Não lidas (${dados.nao_lidas})` : 'Todas'}
                </button>
              ))}
            </div>
          </div>
          <ul className="flex-1 overflow-y-auto">
            {!itens.length && <li className="px-3 py-6 text-center text-sm text-foreground/45">Nada por aqui.</li>}
            {itens.map((n) => {
              const v = VISUAL_DO_TIPO[n.tipo] ?? VISUAL_DO_TIPO.lead_novo_ia
              return (
                <li key={n.id} className={cn('flex items-start gap-2.5 border-b border-line/60 px-3 py-2.5', !n.lida && 'bg-accent/[0.03]')}>
                  <span className={cn('mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-full', v.cor)}>{v.icone}</span>
                  <button type="button" onClick={() => abrir(n)} className="min-w-0 flex-1 text-left">
                    <p className={cn('truncate text-sm text-foreground', !n.lida && 'font-semibold')}>{n.titulo}</p>
                    <p className="truncate text-xs text-foreground/70">{n.nome || 'Lead sem nome'}{n.mensagem ? ` · ${n.mensagem}` : ''}</p>
                    <p className="mt-0.5 text-[11px] text-foreground/45">
                      {timeAgo(n.created_at)}
                      {n.link && <span className="ml-2 font-medium text-accent">Abrir card</span>}
                    </p>
                  </button>
                  {!leitura ? (
                    <button
                      type="button"
                      onClick={() => void marcar(n, !n.lida)}
                      title={n.lida ? 'Marcar como não lida' : 'Marcar como lida'}
                      aria-label={n.lida ? 'Marcar como não lida' : 'Marcar como lida'}
                      className="rounded-md p-1 text-foreground/40 hover:bg-elevate/[0.06] hover:text-foreground"
                    >
                      {n.lida ? <CircleDot className="h-4 w-4" /> : <Check className="h-4 w-4" />}
                    </button>
                  ) : (
                    !n.lida && <span className="mt-2 h-2 w-2 shrink-0 rounded-full bg-accent" title="Não lida por ele" />
                  )}
                </li>
              )
            })}
          </ul>
        </div>,
        document.body,
      )}
    </>
  )
}
