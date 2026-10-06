import { ArrowRight, Route } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { PastilhaSaude } from '@/components/gestaoClientes/Semaforo'
import type { GcClienteLista } from '@/services/gestaoClientes'
import { avaliarMesContraRota, faltaNoPlanejamento, resumoLinha, temPlanejamento } from '@/lib/gcPlanejamento'
import { planoDaLista } from '@/lib/gcPlanoAdaptadores'
import { comDerivadas, formatarMetrica, metricaUnidade } from '@/lib/gcMetricas'
import { cn } from '@/lib/utils'

/**
 * Resumo do planejamento na Visão geral do cliente: de onde parte, aonde quer chegar e como o mês
 * está contra a rota — sem abrir a aba Métricas e metas.
 *
 * Lê só a linha do cliente que a Visão geral já tem (ponto A, metas e números do mês), sem pedido
 * extra. É a mesma comparação que o semáforo faz em "Metas combinadas", então os dois não divergem.
 */
export function ResumoPlanejamento({
  cliente,
  onAbrir,
}: {
  cliente: GcClienteLista
  onAbrir: () => void
}) {
  const plano = planoDaLista(cliente)
  const temMetas = temPlanejamento(plano)

  if (!plano || !temMetas) {
    return (
      <section className="rounded-xl border border-dashed border-line p-4">
        <h2 className="mb-1 flex items-center gap-2 text-sm font-semibold text-foreground">
          <Route className="h-4 w-4 text-accent" /> Planejamento
        </h2>
        <p className="text-sm text-foreground/55">
          {plano
            ? 'O ponto A está registrado, mas ainda não há metas de 6 e 12 meses.'
            : 'Ainda não há planejamento: ponto de partida e metas de 6 e 12 meses.'}{' '}
          Sem ele, "Metas combinadas" não tem como dizer se o mês foi bom.
        </p>
        <Button className="mt-2" size="sm" variant="secondary" rightIcon={<ArrowRight className="h-3.5 w-3.5" />} onClick={onAbrir}>
          {plano ? 'Completar o planejamento' : 'Montar o planejamento'}
        </Button>
      </section>
    )
  }

  const periodo = cliente.periodo_referencia ?? ''
  const mes = comDerivadas(cliente.metricas_mes ?? {})
  const avaliacoes = avaliarMesContraRota(plano, mes, periodo)
  const falta = faltaNoPlanejamento(plano)
  const resumo = resumoLinha(plano)

  return (
    <section className="rounded-xl border border-line p-4">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-foreground">
          <Route className="h-4 w-4 text-accent" /> Planejamento
        </h2>
        <button
          type="button"
          onClick={onAbrir}
          className="flex items-center gap-1 text-xs text-foreground/50 transition-colors hover:text-accent"
        >
          abrir <ArrowRight className="h-3 w-3" />
        </button>
      </div>

      {resumo && <p className="text-xs leading-relaxed text-foreground/70">{resumo}</p>}
      {falta.length > 0 && <p className="mt-1 text-[11px] text-warning">Falta: {falta.join(', ')}</p>}

      <div className="mt-3 border-t border-line pt-3">
        <p className="mb-1.5 text-[11px] uppercase tracking-wide text-foreground/40">Este mês contra a rota</p>
        {avaliacoes.length === 0 ? (
          <p className="text-xs text-foreground/50">
            Nada pra comparar ainda: sem número lançado neste mês, ou o mês está fora da rota.
          </p>
        ) : (
          <ul className="space-y-1.5">
            {avaliacoes.map((a) => {
              const unidade = metricaUnidade(a.chave)
              const ruim = a.boa === false
              const grave = ruim && Math.abs(a.desvioPct) > 40
              return (
                <li key={a.chave} className="flex items-center justify-between gap-2 text-xs">
                  <span className="text-foreground/70">{a.label}</span>
                  <span className="flex items-center gap-2">
                    <span className="tabular-nums text-foreground/55">
                      {formatarMetrica(a.realizado, unidade)} <span className="text-foreground/35">de</span>{' '}
                      {formatarMetrica(a.projetado, unidade)}
                    </span>
                    <PastilhaSaude
                      className={cn('text-[10px]')}
                      estado={grave ? 'risco' : ruim && Math.abs(a.desvioPct) > 20 ? 'atencao' : 'otimo'}
                      texto={`${a.desvioPct > 0 ? '+' : ''}${a.desvioPct.toFixed(0)}%`}
                    />
                  </span>
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </section>
  )
}
