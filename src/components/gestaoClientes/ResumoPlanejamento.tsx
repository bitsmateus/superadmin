import { ArrowRight, Route } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { PastilhaSaude } from '@/components/gestaoClientes/Semaforo'
import type { GcClienteLista } from '@/services/gestaoClientes'
import { avaliarMesContraRota, estadoDoPlanejamento, resumoLinha, temPlanejamento } from '@/lib/gcPlanejamento'
import { planoDaLista } from '@/lib/gcPlanoAdaptadores'
import { comDerivadas, formatarMetrica, metricaUnidade } from '@/lib/gcMetricas'
import { cn } from '@/lib/utils'

const dataBR = (iso: string) => iso.slice(0, 10).split('-').reverse().join('/')

/**
 * Resumo do planejamento na Visão geral do cliente: de onde parte, aonde quer chegar e como o mês
 * está contra a rota — sem abrir a aba Métricas e metas.
 *
 * Lê só a linha do cliente que a Visão geral já tem (ponto A, metas e números do mês), sem pedido
 * extra. É a mesma comparação que o semáforo faz em "Metas combinadas", então os dois não divergem.
 *
 * Sem número nenhum o planejamento está "A definir": cinza, neutro. Só vira "Atenção" se o lembrete de
 * completar que a própria equipe marcou já venceu.
 */
export function ResumoPlanejamento({
  cliente,
  onAbrir,
}: {
  cliente: GcClienteLista
  onAbrir: () => void
}) {
  const plano = planoDaLista(cliente)
  const estado = estadoDoPlanejamento(plano, {
    aguardando: cliente.planejamento?.aguardando_cliente,
    lembrarEm: cliente.planejamento?.lembrar_em,
  })

  if (!plano || estado !== 'definido') {
    const vencido = estado === 'atencao'
    return (
      <section className="rounded-xl border border-line p-4">
        <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-foreground">
            <Route className="h-4 w-4 text-accent" /> Planejamento
          </h2>
          <PastilhaSaude
            estado={vencido ? 'atencao' : 'neutro'}
            texto={vencido ? 'Atenção' : 'A definir'}
          />
        </div>
        <p className="text-sm text-foreground/55">
          {vencido
            ? `O lembrete de ${dataBR(cliente.planejamento?.lembrar_em ?? '')} venceu: veja se o cliente já trouxe os números.`
            : cliente.planejamento?.aguardando_cliente
              ? `Aguardando o cliente${cliente.planejamento.lembrar_em ? ` — lembrar em ${dataBR(cliente.planejamento.lembrar_em)}` : ''}.`
              : 'Preencha quando o cliente tiver esses números.'}
        </p>
        <Button className="mt-2" size="sm" variant="secondary" rightIcon={<ArrowRight className="h-3.5 w-3.5" />} onClick={onAbrir}>
          Abrir o planejamento
        </Button>
      </section>
    )
  }

  const periodo = cliente.periodo_referencia ?? ''
  const mes = comDerivadas(cliente.metricas_mes ?? {})
  const avaliacoes = temPlanejamento(plano) ? avaliarMesContraRota(plano, mes, periodo) : []
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

      <div className="mt-3 border-t border-line pt-3">
        <p className="mb-1.5 text-[11px] uppercase tracking-wide text-foreground/40">Este mês contra a rota</p>
        {avaliacoes.length === 0 ? (
          <p className="text-xs text-foreground/50">
            {temPlanejamento(plano)
              ? 'Nada pra comparar ainda: sem número lançado neste mês, ou o mês está fora da rota.'
              : 'Metas de 6 e 12 meses a definir — sem elas não há rota pra comparar.'}
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
