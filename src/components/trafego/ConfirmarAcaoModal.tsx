import * as React from 'react'
import { AlertTriangle, ArrowRight, Loader2, ShieldCheck } from 'lucide-react'
import { toast } from 'sonner'
import { Modal } from '@/components/ui/Modal'
import { trafegoService, type AcaoMeta, type PreviaAcao } from '@/services/trafego'
import { Estado, useCarregar } from '@/components/trafego/format'

const brlDia = (v: number | null | undefined): string =>
  v == null ? '—' : `R$ ${v.toFixed(2).replace('.', ',')} / dia`
const rotuloStatus = (s: string): string =>
  s === 'ACTIVE' ? 'Ativa (gastando)' : s === 'PAUSED' ? 'Pausada (sem gastar)' : s || '—'
const NIVEL: Record<AcaoMeta['nivel'], string> = { campanha: 'Campanha', conjunto: 'Conjunto de anúncios', anuncio: 'Anúncio' }

export interface ConfirmarAcaoModalProps {
  acao: AcaoMeta | null
  /** Sugestão de origem — marcada como aplicada quando der certo. */
  sugestao?: { dia: string; id: string }
  /** Texto do cabeçalho quando for uma reversão. */
  reversao?: boolean
  onClose: () => void
  onAplicada: () => void
}

/** Tela de confirmação ANTES de mexer no Meta: mostra o item, o antes/depois, como funciona e os riscos. */
export function ConfirmarAcaoModal({ acao, sugestao, reversao, onClose, onAplicada }: ConfirmarAcaoModalProps) {
  const [valor, setValor] = React.useState<string>('')
  const [valorAplicado, setValorAplicado] = React.useState<number | undefined>(undefined)
  const [ciente, setCiente] = React.useState(false)
  const [aplicando, setAplicando] = React.useState(false)
  const [erroAplicar, setErroAplicar] = React.useState<string | null>(null)

  // Ao abrir (ou trocar o valor de orçamento), consulta o Meta de novo pra mostrar o estado de agora.
  const acaoEfetiva = React.useMemo<AcaoMeta | null>(() => {
    if (!acao) return null
    if (acao.tipo !== 'orcamento') return acao
    return { ...acao, valor: valorAplicado ?? acao.valor }
  }, [acao, valorAplicado])

  React.useEffect(() => {
    if (acao) {
      setValor(acao.valor != null ? String(acao.valor).replace('.', ',') : '')
      setValorAplicado(acao.valor)
      setCiente(false)
      setErroAplicar(null)
    }
  }, [acao])

  const previa = useCarregar<PreviaAcao | null>(
    () => (acaoEfetiva ? trafegoService.previaAcao(acaoEfetiva) : Promise.resolve(null)),
    [acaoEfetiva?.tipo, acaoEfetiva?.nivel, acaoEfetiva?.id, acaoEfetiva?.valor],
  )

  const aplicar = async () => {
    if (!acaoEfetiva) return
    setAplicando(true); setErroAplicar(null)
    try {
      await trafegoService.executarAcao(acaoEfetiva, sugestao, reversao)
      toast.success(reversao ? 'Revertido no Meta' : 'Aplicado no Meta')
      onAplicada()
      onClose()
    } catch (e) {
      setErroAplicar((e as Error).message)
    } finally {
      setAplicando(false)
    }
  }

  const p = previa.dados
  const titulo = reversao ? 'Reverter mudança no Meta' : 'Aplicar mudança no Meta'

  return (
    <Modal open={!!acao} onClose={aplicando ? () => {} : onClose} title={titulo} size="lg">
      <div className="space-y-4">
        <div className="flex items-start gap-2 rounded-lg bg-amber-500/10 px-3 py-2.5 text-sm text-amber-800 dark:text-amber-300">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <p>
            Isto <strong>altera a campanha de verdade no Meta Ads</strong>, com dinheiro real. Leia o que vai mudar abaixo antes de confirmar.
            Nada acontece até você clicar em “Confirmar e aplicar no Meta”.
          </p>
        </div>

        {acao?.tipo === 'orcamento' && (
          <label className="block text-xs font-medium text-foreground/60">
            Novo orçamento diário (R$) — você pode ajustar o valor sugerido
            <input
              value={valor}
              onChange={(e) => setValor(e.target.value)}
              onBlur={() => {
                const n = Number(valor.replace(/\./g, '').replace(',', '.'))
                if (Number.isFinite(n) && n > 0) setValorAplicado(Math.round(n * 100) / 100)
              }}
              inputMode="decimal"
              className="mt-1 h-9 w-40 rounded-md border border-line bg-surface px-2 text-sm text-foreground focus:border-accent focus:outline-none max-sm:block"
            />
          </label>
        )}

        <Estado carregando={previa.carregando} erro={previa.erro}>
          {p && (
            <>
              <section className="rounded-lg border border-line p-3">
                <p className="text-[11px] uppercase tracking-wide text-foreground/40">{NIVEL[p.acao.nivel]}</p>
                <p className="break-words text-sm font-semibold text-foreground">{p.nome}</p>
                <p className="mt-1 text-sm font-medium text-foreground">{p.titulo}</p>
                <div className="mt-3 grid grid-cols-[1fr_auto_1fr] items-center gap-2 text-sm max-sm:gap-1.5">
                  <div className="rounded-md bg-elevate/[0.05] p-2.5">
                    <p className="text-[11px] text-foreground/40">Hoje no Meta</p>
                    <p className="font-medium text-foreground">{rotuloStatus(p.antes.status)}</p>
                    {p.antes.orcamentoDia != null && <p className="text-foreground/70">{brlDia(p.antes.orcamentoDia)}</p>}
                  </div>
                  <ArrowRight className="h-4 w-4 text-foreground/40" />
                  <div className="rounded-md bg-accent/10 p-2.5 ring-1 ring-accent/30">
                    <p className="text-[11px] text-accent">Depois de confirmar</p>
                    <p className="font-medium text-foreground">{rotuloStatus(p.depois.status)}</p>
                    {p.depois.orcamentoDia != null && <p className="text-foreground/80">{brlDia(p.depois.orcamentoDia)}</p>}
                  </div>
                </div>
              </section>

              <section>
                <h4 className="mb-1 text-sm font-semibold text-foreground">Como vai funcionar</h4>
                <ul className="list-disc space-y-1 pl-5 text-sm text-foreground/75">
                  {p.comoFunciona.map((t) => <li key={t}>{t}</li>)}
                </ul>
              </section>

              {p.avisos.length > 0 && (
                <section className="rounded-lg bg-danger/10 px-3 py-2.5">
                  <h4 className="mb-1 flex items-center gap-1.5 text-sm font-semibold text-danger"><AlertTriangle className="h-4 w-4" />Atenção</h4>
                  <ul className="list-disc space-y-1 pl-5 text-sm text-foreground/80">
                    {p.avisos.map((t) => <li key={t}>{t}</li>)}
                  </ul>
                </section>
              )}

              <p className="flex items-start gap-1.5 text-xs text-foreground/50">
                <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                Fica registrado quem aplicou, quando e o valor antes/depois. O painel não faz nada além disso: não exclui nada, não cria campanha e não mexe em outros itens.
              </p>

              <label className="flex cursor-pointer items-start gap-2 text-sm text-foreground">
                <input type="checkbox" checked={ciente} onChange={(e) => setCiente(e.target.checked)} className="mt-1 max-sm:mt-0.5 max-sm:h-5 max-sm:w-5 max-sm:shrink-0" />
                Entendi o que vai mudar e quero aplicar essa mudança na campanha real no Meta.
              </label>
            </>
          )}
        </Estado>

        {erroAplicar && <p className="rounded-lg bg-danger/10 px-3 py-2 text-sm text-danger">{erroAplicar}</p>}

        {/* No celular os dois botões ficam um embaixo do outro, largura toda, com o de confirmar em cima. */}
        <div className="flex justify-end gap-2 border-t border-line pt-3 max-sm:flex-col-reverse">
          <button type="button" onClick={onClose} disabled={aplicando}
            className="rounded-md px-3 py-2 text-sm font-medium text-foreground/60 hover:bg-elevate/[0.06] disabled:opacity-50">
            Cancelar (não alterar nada)
          </button>
          <button type="button" onClick={() => void aplicar()} disabled={!p || !ciente || aplicando}
            className="inline-flex items-center gap-1.5 rounded-md bg-accent px-3 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-40 max-sm:justify-center max-sm:py-2.5">
            {aplicando && <Loader2 className="h-4 w-4 animate-spin" />}
            Confirmar e aplicar no Meta
          </button>
        </div>
      </div>
    </Modal>
  )
}
