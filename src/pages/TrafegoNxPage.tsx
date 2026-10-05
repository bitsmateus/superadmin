import * as React from 'react'
import { useNavigate } from 'react-router-dom'
import { BarChart3, ChevronLeft, ChevronRight, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { TopBar } from '@/components/layout/TopBar'
import { Button } from '@/components/ui/Button'
import { EmptyState } from '@/components/ui/EmptyState'
import { gestaoClientes, type GcLinhaTrafego } from '@/services/gestaoClientes'
import {
  METRICAS_DERIVADAS, METRICAS_LANCADAS, comDerivadas, formatarMetrica,
  mesAtual, mesPorExtenso, somarMeses,
} from '@/lib/gcMetricas'

/** As colunas da tabela: o que foi lançado e, depois, o que sai da conta. */
const COLUNAS = [...METRICAS_LANCADAS, ...METRICAS_DERIVADAS]

/**
 * Soma do mês. Métricas de volume somam; as derivadas são recalculadas em cima da soma, nunca
 * somadas ou tiradas na média — média de CPL de clientes com verbas diferentes não quer dizer nada.
 */
function totalDoMes(linhas: GcLinhaTrafego[]): Record<string, number> {
  const soma: Record<string, number | string> = {}
  for (const l of linhas) {
    for (const m of METRICAS_LANCADAS) {
      const v = l.metricas?.[m.chave]
      if (v === undefined || v === null || v === '') continue
      soma[m.chave] = Number(soma[m.chave] ?? 0) + Number(v)
    }
  }
  return comDerivadas(soma)
}

/**
 * CLIENTES NX DIGITAL → Tráfego.
 *
 * Os números de todos os clientes num mês, uma linha por cliente, e o total embaixo. É a tela de
 * "como foi o mês" — pra mexer no número de um cliente, o lugar é a aba Métricas dele.
 */
export function TrafegoNxPage() {
  const navegar = useNavigate()
  const [periodo, setPeriodo] = React.useState(mesAtual())
  const [linhas, setLinhas] = React.useState<GcLinhaTrafego[]>([])
  const [carregando, setCarregando] = React.useState(true)

  React.useEffect(() => {
    let cancelado = false
    setCarregando(true)
    gestaoClientes
      .trafego(periodo)
      .then((r) => {
        if (!cancelado) setLinhas(r)
      })
      .catch((err: Error) => toast.error('Falha ao carregar o tráfego: ' + err.message))
      .finally(() => {
        if (!cancelado) setCarregando(false)
      })
    return () => {
      cancelado = true
    }
  }, [periodo])

  // Cliente sem número nenhum no mês continua na lista, no fim: ver quem ficou sem lançamento é
  // metade do uso desta tela.
  const comNumeros = linhas.filter((l) => Object.keys(l.metricas ?? {}).length > 0)
  const semNumeros = linhas.filter((l) => Object.keys(l.metricas ?? {}).length === 0)
  const total = totalDoMes(linhas)

  return (
    <>
      <TopBar
        title="Tráfego"
        subtitle="Clientes NX Digital"
        breadcrumbs={[
          { label: 'Grupo NX Digital', to: '/' },
          { label: 'Clientes NX Digital', to: '/clientesnxdigital/clientes' },
          { label: 'Tráfego' },
        ]}
        rightSlot={
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setPeriodo((p) => somarMeses(p, -1))}
              aria-label="Mês anterior"
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <span className="min-w-[150px] text-center text-sm font-semibold text-foreground">
              {mesPorExtenso(periodo)}
            </span>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setPeriodo((p) => somarMeses(p, 1))}
              aria-label="Próximo mês"
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        }
      />

      <div className="space-y-4 px-4 pb-10 lg:px-6">
        {carregando ? (
          <div className="flex items-center justify-center gap-2 py-16 text-sm text-foreground/60">
            <Loader2 className="h-4 w-4 animate-spin" /> Carregando…
          </div>
        ) : linhas.length === 0 ? (
          <EmptyState
            icon={<BarChart3 className="h-6 w-6" />}
            title="Nenhum cliente ativo"
            description="Cadastre clientes na aba Clientes pra acompanhar o tráfego deles aqui."
          />
        ) : (
          <>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {['investimento', 'leads', 'cpl', 'receita'].map((chave) => {
                const def = COLUNAS.find((c) => c.chave === chave)!
                return (
                  <div key={chave} className="rounded-xl border border-line p-4">
                    <p className="text-xs uppercase tracking-wide text-foreground/45">{def.label}</p>
                    <p className="mt-1 text-2xl font-semibold tabular-nums text-foreground">
                      {formatarMetrica(total[chave] ?? null, def.unidade)}
                    </p>
                    <p className="mt-0.5 text-xs text-foreground/45">
                      {comNumeros.length} de {linhas.length} clientes com lançamento
                    </p>
                  </div>
                )
              })}
            </div>

            <div className="overflow-hidden rounded-xl border border-line">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-elevate/[0.02] text-left text-xs uppercase tracking-wide text-foreground/50">
                    <tr>
                      <th className="sticky left-0 bg-surface px-4 py-2.5 font-medium">Cliente</th>
                      {COLUNAS.map((c) => (
                        <th key={c.chave} className="px-3 py-2.5 text-right font-medium" title={c.ajuda}>
                          {c.label}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {[...comNumeros, ...semNumeros].map((l) => {
                      const v = comDerivadas(l.metricas ?? {})
                      return (
                        <tr
                          key={l.id}
                          onClick={() => navegar(`/clientesnxdigital/clientes/${l.id}`)}
                          className="cursor-pointer border-t border-line transition-colors hover:bg-elevate/[0.03]"
                        >
                          <td className="sticky left-0 whitespace-nowrap bg-surface px-4 py-2.5">
                            <span className="block font-medium text-foreground">{l.nome_empresa}</span>
                            <span className="block text-xs text-foreground/45">
                              {l.responsavel_nome ?? 'sem responsável'}
                            </span>
                          </td>
                          {COLUNAS.map((c) => (
                            <td
                              key={c.chave}
                              className="whitespace-nowrap px-3 py-2.5 text-right tabular-nums text-foreground/75"
                            >
                              {formatarMetrica(v[c.chave] ?? null, c.unidade)}
                            </td>
                          ))}
                        </tr>
                      )
                    })}
                  </tbody>
                  <tfoot>
                    <tr className="border-t border-line bg-elevate/[0.03] font-medium">
                      <td className="sticky left-0 bg-surface px-4 py-2.5 text-foreground">Total</td>
                      {COLUNAS.map((c) => (
                        <td
                          key={c.chave}
                          className="whitespace-nowrap px-3 py-2.5 text-right tabular-nums text-foreground"
                        >
                          {formatarMetrica(total[c.chave] ?? null, c.unidade)}
                        </td>
                      ))}
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>

            <p className="text-xs text-foreground/45">
              As colunas calculadas (CPL, CTR, CAC, ticket, conversão, ROAS) saem da divisão dos
              números lançados — no total, da divisão das somas, não da média dos clientes.
            </p>
          </>
        )}
      </div>
    </>
  )
}
