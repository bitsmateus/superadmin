import * as React from 'react'
import { ChevronLeft, ChevronRight, Loader2, Plus, Target, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
import { Badge } from '@/components/ui/Badge'
import { DatePickerField } from '@/components/comercial/DatePickerField'
import { gestaoClientes, type GcMeta, type GcMetrica } from '@/services/gestaoClientes'
import {
  METRICAS_DERIVADAS, METRICAS_LANCADAS, TODAS_METRICAS, comDerivadas, formatarMetrica,
  formatarPorChave, limitesDoMes, mesAtual, mesPorExtenso, metricaLabel, metricaUnidade,
  numeroDigitado, somarMeses,
} from '@/lib/gcMetricas'
import { cn } from '@/lib/utils'

/** Quanto da meta já foi andado, de 0 a 100 — conta do ponto de partida, não do zero. */
function progressoDaMeta(meta: GcMeta, atual: number | undefined): number | null {
  if (atual === undefined) return null
  const base = Number(meta.valor_base)
  const alvo = Number(meta.valor_meta)
  if (alvo === base) return atual >= alvo ? 100 : 0
  const andado = ((atual - base) / (alvo - base)) * 100
  return Math.max(0, Math.min(100, Math.round(andado)))
}

/** Métricas de um mês viradas em mapa chave → número. */
function doMes(metricas: GcMetrica[], inicio: string): Record<string, number> {
  const brutas: Record<string, string> = {}
  for (const m of metricas) {
    if (String(m.periodo_inicio).slice(0, 10) === inicio) brutas[m.chave] = m.valor
  }
  return comDerivadas(brutas)
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
 */
export function AbaMetricas({ clienteId }: { clienteId: string }) {
  const [metricas, setMetricas] = React.useState<GcMetrica[]>([])
  const [metas, setMetas] = React.useState<GcMeta[]>([])
  const [carregando, setCarregando] = React.useState(true)
  const [periodo, setPeriodo] = React.useState(mesAtual())
  const [rascunho, setRascunho] = React.useState<Record<string, string>>({})
  const [salvando, setSalvando] = React.useState(false)
  const [novaMeta, setNovaMeta] = React.useState<{ chave: string; base: string; alvo: string; prazo: string | null }>({
    chave: 'leads', base: '', alvo: '', prazo: null,
  })
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

  const salvar = async () => {
    setSalvando(true)
    try {
      await gestaoClientes.salvarMetricas({
        gc_cliente_id: clienteId,
        periodo_inicio: inicio,
        periodo_fim: fim,
        valores: Object.fromEntries(
          METRICAS_LANCADAS.map((m) => [m.chave, numeroDigitado(rascunho[m.chave])]),
        ),
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
        valor_base: numeroDigitado(novaMeta.base) ?? 0,
        valor_meta: alvo,
        prazo: novaMeta.prazo,
      })
      setNovaMeta({ chave: 'leads', base: '', alvo: '', prazo: null })
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
          <Button onClick={salvar} loading={salvando}>
            Salvar o mês
          </Button>
        </div>

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {METRICAS_LANCADAS.map((m) => (
            <Input
              key={m.chave}
              label={m.label}
              hint={m.ajuda}
              value={rascunho[m.chave] ?? ''}
              onChange={(e) => setRascunho((r) => ({ ...r, [m.chave]: e.target.value }))}
              placeholder={m.unidade === 'reais' ? '0,00' : '0'}
              inputMode="decimal"
            />
          ))}
        </div>

        <div className="mt-4 border-t border-line pt-3">
          <p className="mb-2 text-xs uppercase tracking-wide text-foreground/45">
            Calculado a partir do que foi lançado
          </p>
          <div className="flex flex-wrap gap-x-6 gap-y-2">
            {METRICAS_DERIVADAS.map((d) => (
              <div key={d.chave} title={d.ajuda}>
                <span className="text-xs text-foreground/50">{d.label}</span>
                <span className="block text-sm font-medium tabular-nums text-foreground">
                  {formatarMetrica(valoresDoMes[d.chave] ?? null, d.unidade)}
                </span>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="rounded-xl border border-line p-4">
        <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-foreground">
          <Target className="h-4 w-4 text-accent" /> Metas
        </h2>

        {metas.length > 0 && (
          <ul className="mb-4 space-y-2">
            {metas.map((meta) => {
              const atual = valoresDoMes[meta.chave_metrica]
              const progresso = progressoDaMeta(meta, atual)
              return (
                <li
                  key={meta.id}
                  className="group flex flex-wrap items-center gap-3 rounded-lg border border-line px-3 py-2.5"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block font-medium text-foreground">
                      {metricaLabel(meta.chave_metrica)}
                    </span>
                    <span className="block text-xs text-foreground/50">
                      de {formatarPorChave(meta.chave_metrica, Number(meta.valor_base))} para{' '}
                      {formatarPorChave(meta.chave_metrica, Number(meta.valor_meta))}
                      {meta.prazo ? ` · até ${String(meta.prazo).slice(0, 10).split('-').reverse().join('/')}` : ''}
                    </span>
                  </span>
                  <span className="text-sm tabular-nums text-foreground/80">
                    hoje {formatarPorChave(meta.chave_metrica, atual)}
                  </span>
                  {progresso !== null && (
                    <span className="flex items-center gap-2">
                      <span className="h-1.5 w-20 overflow-hidden rounded-full bg-elevate/[0.08]">
                        <span
                          className={cn(
                            'block h-full rounded-full',
                            progresso >= 100 ? 'bg-success' : 'bg-accent',
                          )}
                          style={{ width: `${progresso}%` }}
                        />
                      </span>
                      <span className="w-10 text-right text-xs tabular-nums text-foreground/60">
                        {progresso}%
                      </span>
                    </span>
                  )}
                  <Badge
                    tone={
                      meta.status === 'atingida' ? 'success' : meta.status === 'expirada' ? 'neutral' : 'info'
                    }
                  >
                    {meta.status}
                  </Badge>
                  <button
                    type="button"
                    onClick={() => void agir(() => gestaoClientes.excluirMeta(meta.id))}
                    className="text-foreground/25 opacity-0 transition-opacity hover:text-danger group-hover:opacity-100"
                    aria-label="Excluir meta"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </li>
              )
            })}
          </ul>
        )}

        <form onSubmit={criarMeta} className="grid items-end gap-3 sm:grid-cols-5">
          <Select
            label="Métrica"
            options={TODAS_METRICAS.map((m) => ({ value: m.chave, label: m.label }))}
            value={novaMeta.chave}
            onChange={(e) => setNovaMeta((n) => ({ ...n, chave: e.target.value }))}
          />
          <Input
            label="Ponto de partida"
            value={novaMeta.base}
            onChange={(e) => setNovaMeta((n) => ({ ...n, base: e.target.value }))}
            placeholder="0"
            inputMode="decimal"
          />
          <Input
            label="Meta"
            value={novaMeta.alvo}
            onChange={(e) => setNovaMeta((n) => ({ ...n, alvo: e.target.value }))}
            placeholder={metricaUnidade(novaMeta.chave) === 'reais' ? '0,00' : '0'}
            inputMode="decimal"
          />
          <div>
            <label className="mb-1.5 block text-xs font-medium text-foreground/70">Prazo</label>
            <DatePickerField
              value={novaMeta.prazo}
              onChange={(v) => setNovaMeta((n) => ({ ...n, prazo: v }))}
            />
          </div>
          <Button type="submit" loading={criandoMeta} leftIcon={<Plus className="h-4 w-4" />}>
            Criar meta
          </Button>
        </form>
      </section>

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
                    <tr
                      key={mes}
                      className={cn(
                        'border-t border-line',
                        mes === periodo && 'bg-accent/[0.04]',
                      )}
                    >
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
