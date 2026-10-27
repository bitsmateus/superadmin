import * as React from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { toast } from 'sonner'
import { CalendarClock, ChevronLeft, ChevronRight, Video, X } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import {
  ESTADOS_ENCERRADOS, MINIMO_MOTIVO, VISUAL_DO_ESTADO, VISUAL_DO_TIPO, rotinaService,
  type BlocoDoDia, type ReuniaoDoBloco, type RotinaDeHoje, type StatusDaMarcacao,
} from '@/services/rotina'
import { abaDeFora } from '@/lib/abasJuntas'
import { cn } from '@/lib/utils'

const INTERVALO_MS = 60_000
const CHAVE_RECOLHIDA = 'rotina-lateral-recolhida'

const lerRecolhida = () => {
  try {
    const v = localStorage.getItem(CHAVE_RECOLHIDA)
    return v === null ? !window.matchMedia('(min-width: 1024px)').matches : v === '1'
  } catch { return false }
}
const gravarRecolhida = (v: boolean) => { try { localStorage.setItem(CHAVE_RECOLHIDA, v ? '1' : '0') } catch { /* sem storage */ } }

/** "HH:MM" de agora em Brasília (o mesmo relógio dos blocos). */
const horaDeBrasilia = () => new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString().slice(11, 16)
const minutos = (h: string) => Number(h.slice(0, 2)) * 60 + Number(h.slice(3, 5))
function emQuanto(de: string, ate: string): string {
  const m = Math.max(0, minutos(ate) - minutos(de))
  return m >= 60 ? `${Math.floor(m / 60)}h${m % 60 ? String(m % 60).padStart(2, '0') : ''}` : `${m} min`
}

export function linkDaReuniao(r: ReuniaoDoBloco): string {
  const fora = abaDeFora(r.pagina)
  return fora ? `/comercial/${fora}?quadro=${r.pagina}&lead=${r.card_id}` : `/comercial/${r.pagina}?lead=${r.card_id}`
}

/**
 * Barra fina fixa à direita com a rotina do dia de quem é dono do CRM ARTHUR ou do CRM LUIS CLOSER
 * (server/src/routes/rotina.ts). Cada bloco é uma bolinha: azul pulsando = agora, amarelo = passou e falta marcar.
 * Clicar abre o painel por cima da tela (sem empurrar o CRM) e a marcação (Feito / Parcial / Não deu) é feita ali.
 * Nada trava a tela; dá pra recolher a barra num botão pequeno.
 */
export function RotinaLateral() {
  const [rotina, setRotina] = React.useState<RotinaDeHoje>({ tem: false })
  const [aberto, setAberto] = React.useState(false)
  const [recolhida, setRecolhida] = React.useState(lerRecolhida)
  const [foco, setFoco] = React.useState<string | null>(null)
  const [params, setParams] = useSearchParams()
  const painel = React.useRef<HTMLDivElement>(null)
  const [, setRelogio] = React.useState(0)

  const carregar = React.useCallback(async () => {
    try { setRotina(await rotinaService.hoje()) } catch { /* sem rede: tenta no próximo ciclo */ }
  }, [])

  React.useEffect(() => {
    void carregar()
    const timer = window.setInterval(() => { void carregar(); setRelogio((n) => n + 1) }, INTERVALO_MS)
    const aoVoltar = () => { if (document.visibilityState === 'visible') void carregar() }
    document.addEventListener('visibilitychange', aoVoltar)
    return () => { window.clearInterval(timer); document.removeEventListener('visibilitychange', aoVoltar) }
  }, [carregar])

  // O push do início do bloco abre o app com ?rotina=1: já abre o painel.
  React.useEffect(() => {
    if (params.get('rotina') !== '1') return
    setAberto(true)
    setRecolhida(false)
    setParams((p) => { const n = new URLSearchParams(p); n.delete('rotina'); return n }, { replace: true })
  }, [params, setParams])

  React.useEffect(() => {
    if (!aberto) return
    const fora = (e: MouseEvent) => {
      const alvo = e.target as Node
      if (painel.current?.contains(alvo) || (alvo as Element).closest?.('[data-rotina-barra]')) return
      setAberto(false)
    }
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setAberto(false) }
    document.addEventListener('mousedown', fora)
    document.addEventListener('keydown', esc)
    return () => { document.removeEventListener('mousedown', fora); document.removeEventListener('keydown', esc) }
  }, [aberto])

  if (!rotina.tem || rotina.somente_leitura || !rotina.dia_util || !rotina.blocos.length) return null

  const blocos = rotina.blocos
  const encerrados = blocos.filter((b) => ESTADOS_ENCERRADOS.includes(b.estado))
  const feitos = encerrados.filter((b) => b.estado === 'feito' || b.estado === 'reuniao').length
  const faltaMarcar = blocos.filter((b) => b.pode_marcar && (b.estado === 'pendente' || b.estado === 'sem_resposta'))
  const atual = blocos.find((b) => b.estado === 'agora')
  const proximo = blocos.find((b) => b.estado === 'futuro')

  const abrir = (id?: string) => { setFoco(id ?? null); setAberto(true) }
  const recolher = (v: boolean) => { setRecolhida(v); gravarRecolhida(v); if (v) setAberto(false) }

  return (
    <>
      {recolhida ? (
        <button
          type="button"
          data-rotina-barra
          onClick={() => recolher(false)}
          title="Mostrar a rotina do dia"
          className="fixed right-0 top-1/2 z-30 flex -translate-y-1/2 flex-col items-center gap-1 rounded-l-lg border border-r-0 border-line bg-card px-1.5 py-2 text-[10px] font-semibold text-foreground/70 shadow-md hover:text-foreground"
        >
          <ChevronLeft className="h-3.5 w-3.5" />
          <CalendarClock className="h-4 w-4" />
          {rotina.folga ? 'Folga' : `${feitos}/${blocos.length}`}
          {faltaMarcar.length > 0 && !rotina.folga && <span className="h-2 w-2 rounded-full bg-warning" />}
        </button>
      ) : (
        <div
          data-rotina-barra
          className="fixed right-0 top-1/2 z-30 flex max-h-[86vh] w-12 -translate-y-1/2 flex-col items-center rounded-l-xl border border-r-0 border-line bg-card py-2 shadow-lg"
        >
          <button
            type="button"
            onClick={() => (aberto ? setAberto(false) : abrir())}
            title="Rotina do dia"
            className={cn('mb-1 grid h-8 w-8 place-items-center rounded-lg text-foreground/70 hover:bg-elevate/[0.06] hover:text-foreground', aberto && 'bg-elevate/[0.08] text-foreground')}
          >
            <CalendarClock className="h-4 w-4" />
          </button>
          {rotina.folga ? (
            <div className="px-1 py-3 text-center text-[10px] font-semibold leading-tight text-foreground/60">Folga hoje</div>
          ) : (
            <div className="flex min-h-0 flex-1 flex-col items-center gap-0.5 overflow-y-auto px-1 [scrollbar-width:none]">
              {blocos.map((b) => {
                const v = VISUAL_DO_ESTADO[b.estado]
                return (
                  <button
                    key={b.id}
                    type="button"
                    onClick={() => abrir(b.id)}
                    title={`${b.inicio}–${b.fim} · ${b.titulo} · ${v.nome}`}
                    className={cn(
                      'group flex w-10 flex-col items-center gap-0.5 rounded-md py-1 hover:bg-elevate/[0.06]',
                      b.estado === 'agora' && 'bg-accent/10',
                    )}
                  >
                    <span className="flex items-center gap-1">
                      <span className={cn('h-2.5 w-0.5 rounded-full', VISUAL_DO_TIPO[b.tipo].barra)} />
                      <span className={cn('text-[10px] tabular-nums leading-none', b.estado === 'agora' ? 'font-bold text-accent' : 'text-foreground/60')}>
                        {b.inicio.replace(':00', 'h')}
                      </span>
                    </span>
                    <span className={cn('grid h-3.5 w-3.5 place-items-center rounded-full text-[8px] font-bold leading-none text-white', v.bolinha)}>
                      {v.icone}
                    </span>
                  </button>
                )
              })}
            </div>
          )}
          <div className="mt-1 text-[10px] font-semibold tabular-nums text-foreground/60" title="Blocos feitos / blocos do dia">
            {feitos}/{blocos.length}
          </div>
          <button
            type="button"
            onClick={() => recolher(true)}
            title="Recolher"
            className="mt-1 grid h-6 w-8 place-items-center rounded text-foreground/40 hover:bg-elevate/[0.06] hover:text-foreground"
          >
            <ChevronRight className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {aberto && !recolhida && (
        <div
          ref={painel}
          className="fixed right-14 top-1/2 z-30 flex max-h-[86vh] w-[min(360px,calc(100vw-4.5rem))] -translate-y-1/2 animate-fade-in flex-col overflow-hidden rounded-xl border border-line bg-card shadow-2xl"
        >
          <div className="flex items-center justify-between border-b border-line px-4 py-3">
            <div>
              <div className="text-sm font-semibold text-foreground">Rotina de hoje</div>
              <div className="text-xs text-foreground/55">
                {rotina.folga ? 'Hoje está marcado como folga.' : `${feitos} de ${blocos.length} feitos${faltaMarcar.length ? ` · ${faltaMarcar.length} para marcar` : ''}`}
              </div>
            </div>
            <button type="button" onClick={() => setAberto(false)} className="rounded p-1 text-foreground/50 hover:bg-elevate/[0.06] hover:text-foreground" aria-label="Fechar">
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3">
            {!rotina.folga && (atual ? (
              <CartaoDoBloco bloco={atual} destaque={`Agora · faltam ${emQuanto(horaDeBrasilia(), atual.fim)}`} aoMarcar={carregar} />
            ) : proximo ? (
              <CartaoDoBloco bloco={proximo} destaque={`Próximo · começa em ${emQuanto(horaDeBrasilia(), proximo.inicio)}`} aoMarcar={carregar} />
            ) : null)}

            {faltaMarcar.length > 0 && (
              <div className="space-y-2">
                <div className="text-[11px] font-semibold uppercase tracking-wide text-warning">Falta marcar</div>
                {faltaMarcar.map((b) => <CartaoDoBloco key={b.id} bloco={b} aoMarcar={carregar} compacto />)}
              </div>
            )}

            <div>
              <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-foreground/45">O dia todo</div>
              <ul className="divide-y divide-line rounded-lg border border-line">
                {blocos.map((b) => (
                  <LinhaDoBloco key={b.id} bloco={b} aberta={foco === b.id} alternar={() => setFoco((f) => (f === b.id ? null : b.id))} aoMarcar={carregar} />
                ))}
              </ul>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

function ListaDeReunioes({ reunioes }: { reunioes: ReuniaoDoBloco[] }) {
  return (
    <ul className="space-y-1">
      {reunioes.map((r) => (
        <li key={r.card_id}>
          <Link to={linkDaReuniao(r)} className="flex items-center gap-1.5 rounded-md bg-orange-500/10 px-2 py-1 text-xs text-foreground hover:bg-orange-500/20">
            <Video className="h-3.5 w-3.5 shrink-0 text-orange-500" />
            <span className="tabular-nums font-semibold">{r.agendamento.slice(11, 16)}</span>
            <span className="truncate">{r.nome || r.empresa || 'Lead sem nome'}{r.nome && r.empresa ? ` · ${r.empresa}` : ''}</span>
          </Link>
        </li>
      ))}
    </ul>
  )
}

function ItensDoBloco({ bloco }: { bloco: BlocoDoDia }) {
  const comReuniao = bloco.tipo === 'reuniao' && bloco.reunioes.length > 0
  return (
    <>
      {comReuniao && <ListaDeReunioes reunioes={bloco.reunioes} />}
      {bloco.itens.length > 0 && (
        <ul className={cn('list-disc space-y-0.5 pl-4 text-xs text-foreground/75', comReuniao && 'opacity-50')}>
          {bloco.itens.map((t, i) => <li key={i}>{t}</li>)}
        </ul>
      )}
    </>
  )
}

/** O bloco em destaque (agora/próximo) ou o que falta marcar: itens e os botões. */
function CartaoDoBloco({ bloco, destaque, compacto, aoMarcar }: { bloco: BlocoDoDia; destaque?: string; compacto?: boolean; aoMarcar: () => Promise<void> }) {
  const t = VISUAL_DO_TIPO[bloco.tipo]
  return (
    <div className={cn('space-y-2 rounded-lg border border-line p-3', destaque && 'border-accent/40 bg-accent/[0.06]')}>
      {destaque && <div className="text-[11px] font-semibold uppercase tracking-wide text-accent">{destaque}</div>}
      <div className="flex items-start gap-2">
        <span className={cn('mt-0.5 h-8 w-1 shrink-0 rounded-full', t.barra)} />
        <div className="min-w-0">
          <div className="text-xs tabular-nums text-foreground/55">{bloco.inicio}–{bloco.fim} · <span className={t.texto}>{t.nome}</span></div>
          <div className="text-sm font-semibold text-foreground">{bloco.titulo}</div>
        </div>
      </div>
      {!compacto && <ItensDoBloco bloco={bloco} />}
      {bloco.pode_marcar && <Marcar bloco={bloco} aoMarcar={aoMarcar} />}
    </div>
  )
}

function LinhaDoBloco({ bloco, aberta, alternar, aoMarcar }: { bloco: BlocoDoDia; aberta: boolean; alternar: () => void; aoMarcar: () => Promise<void> }) {
  const v = VISUAL_DO_ESTADO[bloco.estado]
  const item = React.useRef<HTMLLIElement>(null)
  React.useEffect(() => { if (aberta) item.current?.scrollIntoView({ block: 'nearest' }) }, [aberta])
  return (
    <li ref={item}>
      <button type="button" onClick={alternar} className={cn('flex w-full items-center gap-2 px-2.5 py-2 text-left hover:bg-elevate/[0.04]', bloco.estado === 'agora' && 'bg-accent/[0.06]')}>
        <span className={cn('h-5 w-0.5 shrink-0 rounded-full', VISUAL_DO_TIPO[bloco.tipo].barra)} />
        <span className="w-[74px] shrink-0 text-[11px] tabular-nums text-foreground/55">{bloco.inicio}–{bloco.fim}</span>
        <span className="min-w-0 flex-1 truncate text-xs text-foreground">{bloco.titulo}</span>
        {bloco.reunioes.length > 0 && (
          <span className="shrink-0 rounded bg-orange-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-orange-600 dark:text-orange-400">
            {bloco.reunioes.length} {bloco.reunioes.length === 1 ? 'reunião' : 'reuniões'}
          </span>
        )}
        <span className={cn('grid h-4 w-4 shrink-0 place-items-center rounded-full text-[9px] font-bold text-white', v.bolinha)} title={v.nome}>{v.icone}</span>
      </button>
      {aberta && (
        <div className="space-y-2 px-3 pb-3 pl-6">
          <ItensDoBloco bloco={bloco} />
          {bloco.estado === 'reuniao' && !bloco.marcacao && (
            <p className="text-[11px] text-foreground/55">Teve reunião nesse horário: o resultado vai pelo popup da reunião.</p>
          )}
          {bloco.marcacao && (
            <p className="text-[11px] text-foreground/60">
              Marcado como <b>{VISUAL_DO_ESTADO[bloco.marcacao.status].nome}</b> às {bloco.marcacao.marcado_em.slice(11, 16)}
              {bloco.marcacao.atrasado ? ' (depois do horário)' : ''}{bloco.marcacao.motivo ? ` · ${bloco.marcacao.motivo}` : ''}
            </p>
          )}
          {bloco.pode_marcar && <Marcar bloco={bloco} aoMarcar={aoMarcar} />}
        </div>
      )}
    </li>
  )
}

const OPCOES: { status: StatusDaMarcacao; nome: string; cls: string }[] = [
  { status: 'feito', nome: 'Feito', cls: 'border-success/40 text-success hover:bg-success/10' },
  { status: 'parcial', nome: 'Parcial', cls: 'border-warning/40 text-warning hover:bg-warning/10' },
  { status: 'nao_deu', nome: 'Não deu', cls: 'border-danger/40 text-danger hover:bg-danger/10' },
]

/** Feito marca na hora; Parcial e Não deu pedem um motivo curto. Marcar de novo troca. */
function Marcar({ bloco, aoMarcar }: { bloco: BlocoDoDia; aoMarcar: () => Promise<void> }) {
  const [escolha, setEscolha] = React.useState<StatusDaMarcacao | null>(null)
  const [motivo, setMotivo] = React.useState('')
  const [enviando, setEnviando] = React.useState(false)
  const atual = bloco.marcacao?.status

  const enviar = async (status: StatusDaMarcacao, texto = '') => {
    setEnviando(true)
    try {
      await rotinaService.marcar(bloco.id, status, texto)
      toast.success(`${bloco.inicio} ${bloco.titulo}: ${VISUAL_DO_ESTADO[status].nome.toLowerCase()}.`)
      setEscolha(null)
      setMotivo('')
      await aoMarcar()
    } catch (err) {
      toast.error((err as Error).message || 'Não deu pra marcar.')
    } finally {
      setEnviando(false)
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex gap-1.5">
        {OPCOES.map((o) => (
          <button
            key={o.status}
            type="button"
            disabled={enviando}
            onClick={() => (o.status === 'feito' ? void enviar('feito') : setEscolha(o.status))}
            className={cn(
              'h-7 flex-1 rounded-md border text-xs font-semibold transition-colors disabled:opacity-50',
              o.cls,
              (escolha ?? atual) === o.status && 'bg-elevate/[0.08] ring-1 ring-current',
            )}
          >
            {o.nome}
          </button>
        ))}
      </div>
      {escolha && (
        <div className="space-y-1.5">
          <textarea
            autoFocus
            value={motivo}
            onChange={(e) => setMotivo(e.target.value)}
            rows={2}
            maxLength={500}
            placeholder="O que aconteceu? (curto)"
            className="w-full resize-none rounded-md border border-line bg-card px-2 py-1.5 text-xs text-foreground outline-none focus:border-accent/60"
          />
          <div className="flex justify-end gap-1.5">
            <Button size="sm" variant="ghost" onClick={() => { setEscolha(null); setMotivo('') }}>Cancelar</Button>
            <Button size="sm" loading={enviando} disabled={motivo.trim().length < MINIMO_MOTIVO} onClick={() => void enviar(escolha, motivo)}>
              Salvar
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
