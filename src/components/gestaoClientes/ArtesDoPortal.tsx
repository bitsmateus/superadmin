import * as React from 'react'
import { Check, Download, ImageIcon, Loader2, MessageSquareWarning, PenLine, X } from 'lucide-react'
import { gestaoClientes, type GcArtePortal } from '@/services/gestaoClientes'
import { cn } from '@/lib/utils'

/**
 * Aba "Artes para aprovar" do portal do cliente (sem login). O cliente vê as artes que a equipe mandou,
 * separadas por mês, e em cada uma aprova ou pede ajuste (com um comentário). O nome dele fica guardado
 * no aparelho, pra não digitar toda vez.
 */

const NOME_KEY = 'nx-portal-nome'
const lerNome = () => { try { return localStorage.getItem(NOME_KEY) ?? '' } catch { return '' } }
const salvarNome = (n: string) => { try { localStorage.setItem(NOME_KEY, n) } catch { /* sem storage */ } }

export function nomeDoMes(mes: string): string {
  const [a, m] = mes.split('-').map(Number)
  if (!a || !m) return mes
  const n = new Date(a, m - 1, 1).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })
  return n[0].toUpperCase() + n.slice(1)
}

const base = () => (import.meta.env.VITE_API_URL as string | undefined) ?? ''
const urlImagem = (token: string, arte: string, img: string, original = false) =>
  `${base()}/api/public/cliente/${encodeURIComponent(token)}/artes/${arte}/imagem/${img}${original ? '?original=1' : ''}`

/** Quantas artes esperam resposta (pra a aba abrir primeiro e mostrar o número). */
export function useArtesDoPortal(token: string) {
  const [artes, setArtes] = React.useState<GcArtePortal[] | null>(null)
  const carregar = React.useCallback(() => {
    gestaoClientes.artesDoPortal(token).then((r) => setArtes(r.artes)).catch(() => setArtes([]))
  }, [token])
  React.useEffect(() => { carregar() }, [carregar])
  return { artes, carregar }
}

function CartaoArte({ arte, token, nome, pedirNome, onMudou }: {
  arte: GcArtePortal; token: string; nome: string; pedirNome: () => string | null; onMudou: () => void
}) {
  const [i, setI] = React.useState(0)
  const [ajustando, setAjustando] = React.useState(false)
  const [comentario, setComentario] = React.useState('')
  const [enviando, setEnviando] = React.useState(false)
  const [erro, setErro] = React.useState('')
  const [ampliada, setAmpliada] = React.useState(false)
  const img = arte.imagens[Math.min(i, arte.imagens.length - 1)]

  const agir = async (fn: (quem: string) => Promise<unknown>) => {
    const quem = nome.trim() || pedirNome()
    if (!quem) return
    setEnviando(true)
    setErro('')
    try {
      await fn(quem)
      setAjustando(false)
      setComentario('')
      onMudou()
    } catch (err) {
      setErro((err as Error).message)
    } finally {
      setEnviando(false)
    }
  }

  const ultimoAjuste = [...arte.comentarios].reverse().find((c) => c.tipo === 'ajuste_cliente')

  return (
    <article className="overflow-hidden rounded-3xl border border-line bg-surface shadow-sm">
      <div className="relative bg-elevate/[0.04]">
        <button type="button" onClick={() => setAmpliada(true)} className="block w-full" aria-label="Ver a arte maior">
          <img src={urlImagem(token, arte.id, img.id)} alt={arte.titulo} className="mx-auto max-h-[460px] w-full object-contain" loading="lazy" />
        </button>
        {arte.imagens.length > 1 && (
          <div className="absolute inset-x-0 bottom-2 flex justify-center gap-1.5">
            {arte.imagens.map((x, n) => (
              <button
                key={x.id}
                type="button"
                onClick={() => setI(n)}
                aria-label={`Imagem ${n + 1}`}
                className={cn('h-2 w-2 rounded-full', n === i ? 'bg-accent' : 'bg-black/25')}
              />
            ))}
          </div>
        )}
      </div>
      <div className="space-y-3 p-4">
        <div className="flex items-start justify-between gap-2">
          <h3 className="text-[15px] font-semibold leading-snug text-foreground">{arte.titulo}</h3>
          <a
            href={urlImagem(token, arte.id, img.id, true)}
            className="shrink-0 rounded-lg p-1.5 text-foreground/40 hover:bg-elevate/[0.06] hover:text-foreground"
            aria-label="Baixar a imagem"
            title="Baixar"
          >
            <Download className="h-4 w-4" />
          </a>
        </div>

        {arte.situacao === 'aprovado' && (
          <p className="flex items-center gap-1.5 rounded-xl bg-success/10 px-3 py-2 text-sm font-medium text-success">
            <Check className="h-4 w-4" /> Aprovada{arte.aprovado_por && arte.aprovado_por !== 'Equipe' ? ` por ${arte.aprovado_por}` : ''}
            {arte.aprovado_em ? ` em ${new Date(arte.aprovado_em).toLocaleDateString('pt-BR')}` : ''}
          </p>
        )}
        {arte.situacao === 'ajuste' && (
          <div className="rounded-xl bg-warning/10 px-3 py-2 text-sm text-foreground/80">
            <p className="flex items-center gap-1.5 font-medium text-warning"><PenLine className="h-4 w-4" /> Ajuste pedido: a equipe está corrigindo</p>
            {ultimoAjuste && <p className="mt-1 whitespace-pre-wrap text-xs text-foreground/65">"{ultimoAjuste.texto}"</p>}
          </div>
        )}

        {arte.situacao === 'aguardando' && !ajustando && (
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              disabled={enviando}
              onClick={() => void agir((quem) => gestaoClientes.aprovarArtePortal(token, arte.id, quem))}
              className="flex h-11 items-center justify-center gap-1.5 rounded-xl bg-success text-sm font-semibold text-white shadow-sm hover:opacity-90 disabled:opacity-60"
            >
              {enviando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} Aprovar
            </button>
            <button
              type="button"
              disabled={enviando}
              onClick={() => setAjustando(true)}
              className="flex h-11 items-center justify-center gap-1.5 rounded-xl border border-line text-sm font-semibold text-foreground hover:bg-elevate/[0.05] disabled:opacity-60"
            >
              <PenLine className="h-4 w-4" /> Pedir ajuste
            </button>
          </div>
        )}

        {arte.situacao === 'aguardando' && ajustando && (
          <div className="space-y-2">
            <textarea
              value={comentario}
              onChange={(e) => setComentario(e.target.value)}
              rows={4}
              autoFocus
              placeholder="O que precisa mudar? Ex.: trocar o preço pra R$ 99, deixar a logo maior…"
              className="w-full resize-y rounded-xl border border-line bg-surface px-3 py-2 text-sm text-foreground focus:border-accent/60 focus:outline-none"
            />
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setAjustando(false)} className="h-10 rounded-xl px-4 text-sm text-foreground/60 hover:text-foreground">
                Cancelar
              </button>
              <button
                type="button"
                disabled={enviando || !comentario.trim()}
                onClick={() => void agir((quem) => gestaoClientes.ajusteArtePortal(token, arte.id, quem, comentario))}
                className="flex h-10 items-center gap-1.5 rounded-xl bg-accent px-4 text-sm font-semibold text-white disabled:opacity-50"
              >
                {enviando && <Loader2 className="h-4 w-4 animate-spin" />} Enviar ajuste
              </button>
            </div>
          </div>
        )}
        {erro && <p className="text-xs text-danger">{erro}</p>}
      </div>

      {ampliada && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/85 p-3" onClick={() => setAmpliada(false)}>
          <button type="button" className="absolute right-3 top-3 rounded-full bg-white/15 p-2 text-white" aria-label="Fechar">
            <X className="h-5 w-5" />
          </button>
          <img src={urlImagem(token, arte.id, img.id)} alt="" className="max-h-full max-w-full object-contain" />
        </div>
      )}
    </article>
  )
}

export function ArtesDoPortal({ token, artes, onMudou }: { token: string; artes: GcArtePortal[]; onMudou: () => void }) {
  const [nome, setNome] = React.useState(lerNome)
  const meses = [...new Set(artes.map((a) => a.mes))].sort().reverse()
  const pendentesPorMes = (m: string) => artes.filter((a) => a.mes === m && a.situacao === 'aguardando').length
  // Abre no mês mais recente que tem arte esperando; senão, no mais recente.
  const [mes, setMes] = React.useState<string | null>(null)
  const mesAberto = mes ?? meses.find((m) => pendentesPorMes(m) > 0) ?? meses[0]
  const doMes = artes.filter((a) => a.mes === mesAberto)
  const ordem = { aguardando: 0, ajuste: 1, aprovado: 2 } as const
  const pendentes = artes.filter((a) => a.situacao === 'aguardando').length

  const campoNome = React.useRef<HTMLInputElement>(null)
  const [faltaNome, setFaltaNome] = React.useState(false)
  /** Sem nome: destaca o campo lá em cima e não responde ainda. */
  const pedirNome = () => {
    const n = nome.trim()
    if (n) return n
    setFaltaNome(true)
    campoNome.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    campoNome.current?.focus()
    return null
  }

  if (artes.length === 0) {
    return (
      <section className="rounded-3xl border border-line bg-surface px-5 py-10 text-center shadow-sm">
        <ImageIcon className="mx-auto mb-3 h-8 w-8 text-foreground/30" />
        <h2 className="text-base font-semibold text-foreground">Nenhuma arte esperando aprovação</h2>
        <p className="mx-auto mt-1 max-w-sm text-sm text-foreground/55">Quando a equipe mandar novas artes, elas aparecem aqui pra você aprovar.</p>
      </section>
    )
  }

  return (
    <section className="space-y-4">
      <div className="rounded-3xl border border-line bg-surface p-4 shadow-sm sm:p-5">
        <h2 className="text-lg font-semibold text-foreground">Artes para aprovar</h2>
        <p className="mt-0.5 text-sm text-foreground/60">
          {pendentes > 0
            ? `${pendentes} arte${pendentes === 1 ? '' : 's'} esperando a sua resposta. Toque em Aprovar ou em Pedir ajuste.`
            : 'Tudo respondido por aqui. Obrigado!'}
        </p>
        {meses.length > 1 && (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {meses.map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setMes(m)}
                className={cn(
                  'flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs transition-colors',
                  m === mesAberto ? 'border-accent bg-accent/10 font-medium text-accent' : 'border-line text-foreground/60 hover:text-foreground',
                )}
              >
                {nomeDoMes(m)}
                {pendentesPorMes(m) > 0 && <span className="rounded-full bg-accent px-1.5 text-[10px] font-semibold text-white">{pendentesPorMes(m)}</span>}
              </button>
            ))}
          </div>
        )}
        <label className="mt-3 block">
          <span className={cn('mb-1 flex items-center gap-1 text-xs font-medium', faltaNome ? 'text-danger' : 'text-foreground/60')}>
            <MessageSquareWarning className="h-3 w-3" /> {faltaNome ? 'Escreva o seu nome antes de responder' : 'Seu nome (fica registrado junto da resposta)'}
          </span>
          <input
            ref={campoNome}
            value={nome}
            onChange={(e) => {
              setNome(e.target.value)
              salvarNome(e.target.value.trim())
              if (e.target.value.trim()) setFaltaNome(false)
            }}
            placeholder="Ex.: Maria"
            className={cn(
              'h-10 w-full rounded-xl border bg-surface px-3 text-sm text-foreground focus:outline-none',
              faltaNome ? 'border-danger' : 'border-line focus:border-accent/60',
            )}
          />
        </label>
      </div>
      <h3 className="px-1 text-sm font-semibold text-white">{nomeDoMes(mesAberto)}</h3>
      <div className="grid gap-4 sm:grid-cols-2">
        {[...doMes].sort((a, b) => ordem[a.situacao] - ordem[b.situacao]).map((a) => (
          <CartaoArte key={a.id} arte={a} token={token} nome={nome} pedirNome={pedirNome} onMudou={onMudou} />
        ))}
      </div>
    </section>
  )
}
