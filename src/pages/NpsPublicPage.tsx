import * as React from 'react'
import { useParams } from 'react-router-dom'
import { CheckCircle2, MessageCircle, Star } from 'lucide-react'
import { toast } from 'sonner'
import { publicSupport } from '@/services/tickets'
import { cn } from '@/lib/utils'

/**
 * Página pública /nps/:token — cliente avalia a entrega (0-10) e deixa
 * comentário opcional. Acesso anônimo via token.
 */
export function NpsPublicPage() {
  const { token } = useParams<{ token: string }>()
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [info, setInfo] = React.useState<Awaited<
    ReturnType<typeof publicSupport.getNps>
  >>(null)
  const [score, setScore] = React.useState<number | null>(null)
  const [comment, setComment] = React.useState('')
  const [submitting, setSubmitting] = React.useState(false)
  const [done, setDone] = React.useState(false)

  React.useEffect(() => {
    if (!token) return
    void (async () => {
      try {
        const r = await publicSupport.getNps(token)
        if (!r) setError('Link inválido ou expirado.')
        else if (r.responded) setError('Esta pesquisa já foi respondida. Obrigado!')
        else setInfo(r)
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err))
      } finally {
        setLoading(false)
      }
    })()
  }, [token])

  const submit = async () => {
    if (score === null || !token) {
      toast.error('Escolha uma nota de 0 a 10.')
      return
    }
    setSubmitting(true)
    try {
      await publicSupport.submitNps(token, score, comment)
      setDone(true)
    } catch (err) {
      toast.error('Falha: ' + (err instanceof Error ? err.message : String(err)))
    } finally {
      setSubmitting(false)
    }
  }

  if (loading) {
    return (
      <Shell>
        <p className="text-center text-sm text-white/55 py-12">Carregando…</p>
      </Shell>
    )
  }

  if (error) {
    return (
      <Shell>
        <p className="text-center text-sm text-white/65 py-12">{error}</p>
      </Shell>
    )
  }

  if (done) {
    return (
      <Shell>
        <div className="text-center pt-10">
          <CheckCircle2 className="h-12 w-12 text-success mx-auto" />
          <h2 className="mt-4 text-xl font-semibold text-white">Obrigado!</h2>
          <p className="mt-2 max-w-md mx-auto text-sm text-white/65">
            Sua resposta foi registrada. Nosso time vai dar continuidade —
            qualquer coisa, é só chamar.
          </p>
        </div>
      </Shell>
    )
  }

  const greeting = info?.clientName ? `, ${info.clientName.split(' ')[0]}` : ''

  return (
    <Shell>
      <div className="space-y-6">
        <div className="text-center">
          <h1 className="text-2xl font-semibold tracking-tight">
            Sua opinião conta{greeting}!
          </h1>
          <p className="mt-2 max-w-md mx-auto text-sm text-white/55">
            De 0 a 10, o quanto você recomendaria a NX pra um amigo?
          </p>
        </div>

        <div className="rounded-2xl border border-line bg-card p-5">
          <ScoreSelector value={score} onChange={setScore} />

          <div className="mt-6 flex items-center justify-between gap-3 text-[10px] uppercase tracking-wider text-white/40">
            <span>Nem provável</span>
            <span>Muito provável</span>
          </div>

          {score !== null && (
            <div className={cn('mt-5 rounded-lg border px-4 py-3 text-sm', feedbackTone(score))}>
              {feedbackMessage(score)}
            </div>
          )}

          <div className="mt-5">
            <label className="text-[11px] uppercase tracking-wider text-white/45 inline-flex items-center gap-1.5">
              <MessageCircle className="h-3 w-3" />
              {score !== null && score <= 6
                ? 'O que podemos melhorar?'
                : score !== null && score >= 9
                  ? 'O que mais gostou?'
                  : 'Comentário (opcional)'}
            </label>
            <textarea
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              rows={4}
              maxLength={2000}
              placeholder="Conta pra gente…"
              className="mt-1.5 w-full rounded-lg bg-surface px-3 py-2 text-sm text-white border border-white/10 placeholder:text-white/30 focus:outline-none focus:border-accent focus:ring-4 focus:ring-accent/15 resize-y"
            />
            <div className="mt-1 text-right text-[10px] text-white/30">
              {comment.length}/2000
            </div>
          </div>

          <div className="mt-4 flex justify-end">
            <button
              onClick={submit}
              disabled={score === null || submitting}
              className="inline-flex items-center justify-center h-10 px-5 rounded-lg bg-accent text-white font-medium text-sm hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed transition-opacity"
            >
              {submitting ? 'Enviando…' : 'Enviar resposta'}
            </button>
          </div>
        </div>

        {info?.clientCompany && (
          <p className="text-center text-[11px] text-white/35">
            Empresa: {info.clientCompany}
          </p>
        )}
      </div>
    </Shell>
  )
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-bg text-white">
      <header className="border-b border-line bg-card/40 backdrop-blur">
        <div className="mx-auto max-w-2xl px-4 py-4 flex items-center gap-2">
          <div className="grid h-8 w-8 place-items-center rounded-lg bg-accent/15 ring-1 ring-accent/30">
            <Star className="h-4 w-4 text-accent" />
          </div>
          <div className="leading-tight">
            <div className="text-sm font-semibold text-white">Pesquisa de satisfação</div>
            <div className="text-[10px] uppercase tracking-wider text-white/40">NX</div>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-2xl px-4 py-8">{children}</main>
    </div>
  )
}

function ScoreSelector({
  value,
  onChange,
}: {
  value: number | null
  onChange: (n: number) => void
}) {
  return (
    <div className="grid grid-cols-11 gap-1.5">
      {Array.from({ length: 11 }).map((_, i) => {
        const isSelected = value === i
        return (
          <button
            key={i}
            onClick={() => onChange(i)}
            className={cn(
              'aspect-square rounded-lg border text-sm font-medium transition-all',
              isSelected
                ? scoreBg(i)
                : 'border-line bg-white/[0.02] text-white/65 hover:bg-white/[0.06]',
            )}
            aria-label={`Nota ${i}`}
          >
            {i}
          </button>
        )
      })}
    </div>
  )
}

function scoreBg(n: number): string {
  if (n <= 6) return 'border-danger/50 bg-danger/15 text-danger ring-2 ring-danger/30'
  if (n <= 8) return 'border-warning/50 bg-warning/15 text-warning ring-2 ring-warning/30'
  return 'border-success/50 bg-success/15 text-success ring-2 ring-success/30'
}

function feedbackTone(n: number): string {
  if (n <= 6) return 'border-danger/30 bg-danger/[0.08] text-danger'
  if (n <= 8) return 'border-warning/30 bg-warning/[0.08] text-warning'
  return 'border-success/30 bg-success/[0.08] text-success'
}

function feedbackMessage(n: number): string {
  if (n <= 6)
    return 'Lamentamos a experiência. Vamos te ouvir pra entender e melhorar.'
  if (n <= 8) return 'Obrigado! Ajude a gente a chegar no 10.'
  return 'Que ótimo! Adoraríamos saber o que mais funcionou bem pra você.'
}
