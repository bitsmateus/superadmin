import * as React from 'react'
import { ChevronLeft, ChevronRight, Loader2, Plus, Target, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
import { CampoData } from '@/components/gestaoClientes/CampoData'
import { PastilhaSaude } from '@/components/gestaoClientes/Semaforo'
import { ModalAvisos } from '@/components/gestaoClientes/ModalAvisos'
import {
  HORIZONTES, gestaoClientes,
  type GcHorizonte, type GcMeta, type GcMetrica,
} from '@/services/gestaoClientes'
import {
  METRICAS_DERIVADAS, METRICAS_LANCADAS, TODAS_METRICAS, comDerivadas, formatarMetrica,
  formatarPorChave, limitesDoMes, mesAtual, mesPorExtenso, metricaLabel, metricaUnidade,
  numeroDigitado, somarMeses, validarMetricas, variacaoDaMetrica,
} from '@/lib/gcMetricas'
import { progressoDaMeta } from '@/lib/gcSaude'
import { cn } from '@/lib/utils'

/** Métricas de um mês viradas em mapa chave → número, com as derivadas calculadas. */
function doMes(metricas: GcMetrica[], inicio: string): Record<string, number> {
  const brutas: Record<string, string> = {}
  for (const m of metricas) {
    if (String(m.periodo_inicio).slice(0, 10) === inicio) brutas[m.chave] = m.valor
  }
  return comDerivadas(brutas)
}

/** Data do banco ('2026-10-31T...' ou '2026-10-31') em 31/10/2026. */
function dataBr(valor: string | null | undefined): string {
  if (!valor) return '—'
  return String(valor).slice(0, 10).split('-').reverse().join('/')
}

/** Prazo padrão de cada horizonte, pra não obrigar ninguém a abrir o calendário. */
function prazoSugerido(horizonte: GcHorizonte): string {
  const hoje = new Date()
  if (horizonte === 'mes') {
    const fim = new Date(hoje.getFullYear(), hoje.getMonth() + 1, 0)
    return fim.toISOString().slice(0, 10)
  }
  const meses = horizonte === '6_meses' ? 6 : 12
  const fim = new Date(hoje.getFullYear(), hoje.getMonth() + meses, hoje.getDate())
  return fim.toISOString().slice(0, 10)
}

/** Quanto do prazo já passou, de 0 a 100 — é o que diz se a meta está no ritmo. */
function ritmoEsperado(meta: GcMeta): number | null {
  if (!meta.prazo || !meta.data_base) return null
  const inicio = new Date(String(meta.data_base).slice(0, 10)).getTime()
  const fim = new Date(String(meta.prazo).slice(0, 10)).getTime()
  if (!(fim > inicio)) return null
  return Math.max(0, Math.min(100, Math.round(((Date.now() - inicio) / (fim - inicio)) * 100)))
}

/** Variação contra o mês anterior, com a cor certa pra métrica (CPL caindo é bom). */
function Variacao({ chave, atual, anterior }: { chave: string; atual?: number; anterior?: number }) {
  const v = variacaoDaMetrica(chave, atual, anterior)
  if (!v) return null
  if (Math.abs(v.pct) < 0.5) {
    return <span className="text-[11px] text-foreground/40">estável</span>
  }
  return (
    <span className={cn('text-[11px] font-medium', v.boa ? 'text-success' : 'text-danger')}>
      {v.pct > 0 ? '▲' : '▼'} {Math.abs(v.pct).toFixed(0)}%
    </span>
  )
}

function CartaoMeta({
  meta,
  atual,
  onExcluir,
  onConcluir,
}: {
  meta: GcMeta
  atual: number | undefined
  onExcluir: () => void
  onConcluir: () => void
}) {
  const progresso = progressoDaMeta(meta, atual)
  const esperado = ritmoEsperado(meta)
  const atingida = progresso !== null && progresso >= 100
  // Fora do ritmo com a mesma folga de 20 pontos que o semáforo usa — os dois têm que concordar.
  const atrasada = progresso !== null && esperado !== null && progresso < esperado - 20

  return (
    <div className="group rounded-xl border border-line px-3 py-2.5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="font-medium text-foreground">{metricaLabel(meta.chave_metrica)}</span>
        <span className="text-base font-semibold tabular-nums text-foreground">
          {formatarPorChave(meta.chave_metrica, atual)}
          <span className="ml-1 text-xs font-medium text-foreground/50">
            de {formatarPorChave(meta.chave_metrica, Number(meta.valor_meta))}
          </span>
        </span>
      </div>

      <div className="relative mt-2 h-2 overflow-hidden rounded-full bg-elevate/[0.08]">
        <div
          className={cn(
            'h-full rounded-full transition-[width]',
            atingida ? 'bg-success' : atrasada ? 'bg-danger' : 'bg-accent',
          )}
          style={{ width: `${Math.max(0, Math.min(100, progresso ?? 0))}%` }}
        />
        {/* Onde a meta DEVERIA estar hoje, pelo prazo. É o que transforma "42 de 100" em "atrasado". */}
        {esperado !== null && (
          <span
            className="absolute top-0 h-full w-0.5 bg-foreground/35"
            style={{ left: `${esperado}%` }}
            title={`Ritmo esperado hoje: ${esperado}%`}
          />
        )}
      </div>

      <div className="mt-1.5 flex flex-wrap items-center justify-between gap-2 text-xs text-foreground/50">
        <span>
          partida {formatarPorChave(meta.chave_metrica, Number(meta.valor_base))}
          {meta.data_base ? ` em ${dataBr(meta.data_base)}` : ''}
          {meta.prazo ? ` · prazo ${dataBr(meta.prazo)}` : ' · sem prazo'}
        </span>
        <span className="flex items-center gap-2">
          <span className="tabular-nums">
            {progresso === null ? '—' : `${progresso}% do caminho`}
            {esperado !== null && ` (esperado ${esperado}%)`}
          </span>
          <PastilhaSaude
            estado={atingida ? 'otimo' : atrasada ? 'risco' : progresso === null ? 'neutro' : 'bom'}
            texto={atingida ? 'atingida' : atrasada ? 'atrasada' : progresso === null ? 'sem dado' : 'no ritmo'}
          />
          {meta.status === 'ativa' && atingida && (
            <button type="button" onClick={onConcluir} className="text-success hover:underline">
              marcar como atingida
            </button>
          )}
          <button
            type="button"
            onClick={onExcluir}
            className="text-foreground/25 opacity-0 transition-opacity hover:text-danger group-hover:opacity-100"
            aria-label="Excluir meta"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </span>
      </div>
    </div>
  )
}

/**
 * Métricas e metas do cliente.
 *
 * O lançamento é por mês: a pessoa escolhe o mês, digita o que tem e salva tudo de uma vez. Campo
 * em branco APAGA o lançamento em vez de gravar zero — zero é um número que alguém digitou ("não
 * veio lead nenhum"), branco é "ainda não sei", e as duas coisas não podem virar a mesma.
 *
 * As métricas derivadas (CPL, CTR, ROAS…) não são digitadas nem gravadas: aparecem calculadas do
 * lado. Guardar o CPL junto criaria dois números que podem discordar da própria divisão.
 *
 * As metas são separadas por horizonte (mês, 6 meses, 12 meses) porque é assim que se combina com
 * o cliente — "100 leads" sem dizer até quando não é meta, é desejo. Cada uma guarda o PONTO DE
 * PARTIDA, e o progresso conta de lá, não do zero: quem começou em 40 e foi a 60 andou 40% do
 * caminho até 90, não 66% da meta.
 */
export function AbaMetricas({ clienteId }: { clienteId: string }) {
  const [metricas, setMetricas] = React.useState<GcMetrica[]>([])
  const [metas, setMetas] = React.useState<GcMeta[]>([])
  const [carregando, setCarregando] = React.useState(true)
  const [periodo, setPeriodo] = React.useState(mesAtual())
  const [rascunho, setRascunho] = React.useState<Record<string, string>>({})
  const [salvando, setSalvando] = React.useState(false)
  const [novaMeta, setNovaMeta] = React.useState<{
    chave: string; horizonte: GcHorizonte; base: string; alvo: string; prazo: string | null
  }>({ chave: 'leads', horizonte: 'mes', base: '', alvo: '', prazo: null })
  const [criandoMeta, setCriandoMeta] = React.useState(false)

  const carregar = React.useCallback(async () => {
    try {
      const [m, g] = await Promise.all([
        gestaoClientes.metricas(clienteId),
        gestaoClientes.metas(clienteId),
      ])
      setMetricas(m)
      setMetas(g)
    } catch (err) {
      toast.error('Falha ao carregar as métricas: ' + (err as Error).message)
    } finally {
      setCarregando(false)
    }
  }, [clienteId])

  React.useEffect(() => {
    void carregar()
  }, [carregar])

  const { inicio, fim } = limitesDoMes(periodo)

  // Trocar de mês (ou recarregar) tem que repreencher os campos com o que está gravado naquele mês.
  React.useEffect(() => {
    const atual: Record<string, string> = {}
    for (const m of metricas) {
      if (String(m.periodo_inicio).slice(0, 10) === inicio) atual[m.chave] = String(Number(m.valor))
    }
    setRascunho(atual)
  }, [metricas, inicio])

  // O que está digitado, já em número: sem isso "1.500,00" chegaria como NaN nas derivadas e o
  // CPL piscaria em branco enquanto a pessoa digita.
  const valoresDoMes = comDerivadas(
    Object.fromEntries(Object.entries(rascunho).map(([chave, texto]) => [chave, numeroDigitado(texto)])),
  )
  const valoresAnteriores = doMes(metricas, limitesDoMes(somarMeses(periodo, -1)).inicio)

  const [avisos, setAvisos] = React.useState<string[] | null>(null)

  const salvar = async (ignorarAvisos = false) => {
    const valores = Object.fromEntries(
      METRICAS_LANCADAS.map((m) => [m.chave, numeroDigitado(rascunho[m.chave])]),
    )
    if (!ignorarAvisos) {
      const achados = validarMetricas(valores)
      if (achados.length > 0) {
        setAvisos(achados)
        return
      }
    }
    setAvisos(null)
    setSalvando(true)
    try {
      await gestaoClientes.salvarMetricas({
        gc_cliente_id: clienteId,
        periodo_inicio: inicio,
        periodo_fim: fim,
        valores,
      })
      toast.success(`Métricas de ${mesPorExtenso(periodo)} salvas`)
      await carregar()
    } catch (err) {
      toast.error('Falha ao salvar: ' + (err as Error).message)
    } finally {
      setSalvando(false)
    }
  }

  const criarMeta = async (e: React.FormEvent) => {
    e.preventDefault()
    const alvo = numeroDigitado(novaMeta.alvo)
    if (!alvo) {
      toast.error('Informe o valor da meta')
      return
    }
    setCriandoMeta(true)
    try {
      await gestaoClientes.criarMeta(clienteId, {
        chave_metrica: novaMeta.chave,
        horizonte: novaMeta.horizonte,
        // Sem ponto de partida informado, o de hoje é o que está lançado no mês — é o que faz o
        // progresso significar "andou", e não "já nasceu em 40%".
        valor_base: numeroDigitado(novaMeta.base) ?? valoresDoMes[novaMeta.chave] ?? 0,
        data_base: new Date().toISOString().slice(0, 10),
        valor_meta: alvo,
        prazo: novaMeta.prazo ?? prazoSugerido(novaMeta.horizonte),
      })
      setNovaMeta({ chave: 'leads', horizonte: novaMeta.horizonte, base: '', alvo: '', prazo: null })
      await carregar()
    } catch (err) {
      toast.error('Falha ao criar a meta: ' + (err as Error).message)
    } finally {
      setCriandoMeta(false)
    }
  }

  const agir = async (fn: () => Promise<unknown>) => {
    try {
      await fn()
      await carregar()
    } catch (err) {
      toast.error('Falha ao salvar: ' + (err as Error).message)
    }
  }

  // Os meses que já têm lançamento, do mais novo pro mais velho — é a tabela de histórico.
  const mesesLancados = Array.from(
    new Set(metricas.map((m) => String(m.periodo_inicio).slice(0, 7))),
  ).sort((a, b) => b.localeCompare(a))

  if (carregando) {
    return (
      <div className="flex items-center justify-center gap-2 py-16 text-sm text-foreground/60">
        <Loader2 className="h-4 w-4 animate-spin" /> Carregando métricas…
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <section className="rounded-xl border border-line p-4">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setPeriodo((p) => somarMeses(p, -1))}
              aria-label="Mês anterior"
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <span className="min-w-[160px] text-center text-sm font-semibold text-foreground">
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
          <Button onClick={() => void salvar()} loading={salvando}>
            Salvar o mês
          </Button>
        </div>

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {METRICAS_LANCADAS.map((m) => (
            <div key={m.chave}>
              <Input
                label={m.label}
                value={rascunho[m.chave] ?? ''}
                onChange={(e) => setRascunho((r) => ({ ...r, [m.chave]: e.target.value }))}
                placeholder={m.unidade === 'reais' ? '0,00' : '0'}
                inputMode="decimal"
              />
              <div className="mt-1 flex items-center justify-between gap-2">
                <span className="truncate text-[11px] text-foreground/40">{m.ajuda ?? ''}</span>
                <Variacao
                  chave={m.chave}
                  atual={valoresDoMes[m.chave]}
                  anterior={valoresAnteriores[m.chave]}
                />
              </div>
            </div>
          ))}
        </div>

        <div className="mt-4 border-t border-line pt-3">
          <p className="mb-2 text-xs uppercase tracking-wide text-foreground/45">
            Calculado a partir do que foi lançado
          </p>
          <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
            {METRICAS_DERIVADAS.map((d) => (
              <div key={d.chave} title={d.ajuda}>
                <span className="text-xs text-foreground/50">{d.label}</span>
                <span className="block text-base font-semibold tabular-nums text-foreground">
                  {formatarMetrica(valoresDoMes[d.chave] ?? null, d.unidade)}
                </span>
                <Variacao
                  chave={d.chave}
                  atual={valoresDoMes[d.chave]}
                  anterior={valoresAnteriores[d.chave]}
                />
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="rounded-xl border border-line p-4">
        <h2 className="mb-1 flex items-center gap-2 text-sm font-semibold text-foreground">
          <Target className="h-4 w-4 text-accent" /> Metas combinadas
        </h2>
        <p className="mb-3 text-xs text-foreground/50">
          O risco vertical em cada barra é onde a meta deveria estar hoje, pelo prazo. O progresso
          conta do ponto de partida.
        </p>

        <div className="space-y-4">
          {HORIZONTES.map((h) => {
            const doHorizonte = metas.filter((m) => (m.horizonte ?? 'mes') === h.valor)
            return (
              <div key={h.valor}>
                <h3 className="mb-1.5 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-foreground/55">
                  {h.label}
                  <span className="text-foreground/35">{doHorizonte.length}</span>
                </h3>
                {doHorizonte.length === 0 ? (
                  <p className="rounded-lg border border-dashed border-line px-3 py-2 text-xs text-foreground/40">
                    Nenhuma meta de {h.curto} combinada.
                  </p>
                ) : (
                  <div className="space-y-2">
                    {doHorizonte.map((meta) => (
                      <CartaoMeta
                        key={meta.id}
                        meta={meta}
                        atual={valoresDoMes[meta.chave_metrica]}
                        onExcluir={() => void agir(() => gestaoClientes.excluirMeta(meta.id))}
                        onConcluir={() =>
                          void agir(() => gestaoClientes.atualizarMeta(meta.id, { status: 'atingida' }))
                        }
                      />
                    ))}
                  </div>
                )}
              </div>
            )
          })}
        </div>

        <form
          onSubmit={criarMeta}
          className="mt-4 grid items-start gap-3 border-t border-line pt-4 sm:grid-cols-6"
        >
          <Select
            label="Métrica"
            options={TODAS_METRICAS.map((m) => ({ value: m.chave, label: m.label }))}
            value={novaMeta.chave}
            onChange={(e) => setNovaMeta((n) => ({ ...n, chave: e.target.value }))}
          />
          <Select
            label="Horizonte"
            options={HORIZONTES.map((h) => ({ value: h.valor, label: h.label }))}
            value={novaMeta.horizonte}
            onChange={(e) =>
              setNovaMeta((n) => ({ ...n, horizonte: e.target.value as GcHorizonte, prazo: null }))
            }
          />
          <Input
            label="Ponto de partida"
            value={novaMeta.base}
            onChange={(e) => setNovaMeta((n) => ({ ...n, base: e.target.value }))}
            placeholder={formatarPorChave(novaMeta.chave, valoresDoMes[novaMeta.chave] ?? 0)}
            inputMode="decimal"
          />
          <Input
            label="Meta"
            value={novaMeta.alvo}
            onChange={(e) => setNovaMeta((n) => ({ ...n, alvo: e.target.value }))}
            placeholder={metricaUnidade(novaMeta.chave) === 'reais' ? '0,00' : '0'}
            inputMode="decimal"
          />
          <CampoData
            label="Prazo"
            value={novaMeta.prazo ?? prazoSugerido(novaMeta.horizonte)}
            onChange={(v) => setNovaMeta((n) => ({ ...n, prazo: v }))}
          />
          <div>
            <span className="mb-1.5 block text-xs font-medium text-transparent" aria-hidden>
              .
            </span>
            <Button
              type="submit"
              loading={criandoMeta}
              leftIcon={<Plus className="h-4 w-4" />}
              className="h-10 w-full"
            >
              Criar meta
            </Button>
          </div>
        </form>
        <p className="mt-2 text-xs text-foreground/45">
          Ponto de partida vazio usa o valor lançado hoje no mês — é de lá que o progresso conta.
        </p>
      </section>

      <ModalAvisos
        avisos={avisos}
        salvando={salvando}
        onCorrigir={() => setAvisos(null)}
        onSalvarMesmoAssim={() => void salvar(true)}
      />

      {mesesLancados.length > 0 && (
        <section className="overflow-hidden rounded-xl border border-line">
          <h2 className="border-b border-line px-4 py-3 text-sm font-semibold text-foreground">
            Histórico mês a mês
          </h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-elevate/[0.02] text-left text-xs uppercase tracking-wide text-foreground/50">
                <tr>
                  <th className="px-4 py-2.5 font-medium">Mês</th>
                  {[...METRICAS_LANCADAS, ...METRICAS_DERIVADAS].map((m) => (
                    <th key={m.chave} className="px-3 py-2.5 text-right font-medium">
                      {m.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {mesesLancados.map((mes) => {
                  const v = doMes(metricas, limitesDoMes(mes).inicio)
                  return (
                    <tr key={mes} className={cn('border-t border-line', mes === periodo && 'bg-accent/[0.04]')}>
                      <td className="whitespace-nowrap px-4 py-2.5">
                        <button
                          type="button"
                          onClick={() => setPeriodo(mes)}
                          className="text-foreground/85 hover:text-accent"
                        >
                          {mesPorExtenso(mes)}
                        </button>
                      </td>
                      {[...METRICAS_LANCADAS, ...METRICAS_DERIVADAS].map((m) => (
                        <td
                          key={m.chave}
                          className="whitespace-nowrap px-3 py-2.5 text-right tabular-nums text-foreground/75"
                        >
                          {formatarMetrica(v[m.chave] ?? null, m.unidade)}
                        </td>
                      ))}
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  )
}
