import * as React from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { BarChart3, ChevronLeft, ChevronRight, Columns3, Loader2, Pencil, X } from 'lucide-react'
import { toast } from 'sonner'
import { TopBar } from '@/components/layout/TopBar'
import { Button } from '@/components/ui/Button'
import { EmptyState } from '@/components/ui/EmptyState'
import { PastilhaSaude } from '@/components/gestaoClientes/Semaforo'
import { ModalAvisos } from '@/components/gestaoClientes/ModalAvisos'
import { FaixaLancamento } from '@/components/gestaoClientes/FaixaLancamento'
import { useLancamentoPendente } from '@/hooks/useLancamentoPendente'
import { avisosDoErro, gestaoClientes, type GcClienteLista } from '@/services/gestaoClientes'
import {
  METRICAS_DERIVADAS, METRICAS_LANCADAS, comDerivadas, formatarMetrica,
  mesAtual, mesPorExtenso, numeroDigitado, numeroParaCampo, somarMeses, validarMetricas, variacaoDaMetrica,
} from '@/lib/gcMetricas'
import { avaliarSaude, contaNoTotal, type Saude } from '@/lib/gcSaude'
import { useOutsideClose } from '@/hooks/useOutsideClose'
import { cn } from '@/lib/utils'

/** Todas as colunas de número que existem, na ordem em que aparecem. */
const TODAS_COLUNAS = [...METRICAS_LANCADAS, ...METRICAS_DERIVADAS]

/**
 * As colunas que aparecem sem a pessoa pedir. São as que respondem "esse cliente está dando
 * resultado?" — o resto (impressões, cliques, CTR...) é detalhe de otimização e fica um clique
 * adiante, no seletor "Colunas". Tabela com 14 colunas de número é tabela que ninguém lê.
 */
const COLUNAS_PADRAO = ['investimento', 'leads', 'cpl', 'vendas', 'roas']

const CHAVE_ARMAZENAMENTO = 'gc:trafego:colunas-extras'

function lerExtras(): string[] {
  try {
    const bruto = window.localStorage.getItem(CHAVE_ARMAZENAMENTO)
    const lista = bruto ? JSON.parse(bruto) : []
    // Só aceita chave que ainda existe: métrica removida do catálogo não pode quebrar a tela.
    return Array.isArray(lista) ? lista.filter((k) => TODAS_COLUNAS.some((c) => c.chave === k)) : []
  } catch {
    return []
  }
}

/**
 * Soma do mês. Métricas de volume somam; as derivadas são recalculadas em cima da soma, nunca
 * somadas ou tiradas na média — média de CPL de clientes com verbas diferentes não quer dizer nada.
 */
function totalDoMes(linhas: GcClienteLista[], campo: 'metricas_mes' | 'metricas_mes_anterior') {
  const soma: Record<string, number | string> = {}
  for (const l of linhas) {
    for (const m of METRICAS_LANCADAS) {
      const v = l[campo]?.[m.chave]
      if (v === undefined || v === null || v === '') continue
      soma[m.chave] = Number(soma[m.chave] ?? 0) + Number(v)
    }
  }
  return comDerivadas(soma)
}

/** Variação do total contra o mês anterior, com a cor certa pra métrica. */
function Variacao({ chave, atual, anterior }: { chave: string; atual?: number; anterior?: number }) {
  const v = variacaoDaMetrica(chave, atual, anterior)
  if (!v || Math.abs(v.pct) < 0.5) return null
  return (
    <span className={cn('text-xs font-medium', v.boa ? 'text-success' : 'text-danger')}>
      {v.pct > 0 ? '▲' : '▼'} {Math.abs(v.pct).toFixed(0)}% vs. mês anterior
    </span>
  )
}

/** O relatório do mês, em uma pastilha: publicado, rascunho ou nada ainda. */
function PastilhaRelatorio({ status }: { status: GcClienteLista['relatorio_mes'] }) {
  if (status === 'publicado') return <PastilhaSaude estado="otimo" texto="Publicado" />
  if (status === 'rascunho') return <PastilhaSaude estado="atencao" texto="Rascunho" />
  return <PastilhaSaude estado="neutro" texto="Sem relatório" />
}

type Rascunho = Record<string, Record<string, string>>

/** O que está gravado hoje, em texto, no formato que a grade edita. */
function rascunhoInicial(linhas: GcClienteLista[]): Rascunho {
  const r: Rascunho = {}
  for (const l of linhas) {
    r[l.id] = {}
    for (const m of METRICAS_LANCADAS) {
      const v = l.metricas_mes?.[m.chave]
      if (v !== undefined && v !== null && v !== '') r[l.id][m.chave] = numeroParaCampo(v)
    }
  }
  return r
}

/**
 * CLIENTES NX DIGITAL → Tráfego.
 *
 * Os números de todos os clientes num mês, uma linha por cliente, com o total embaixo e o semáforo
 * de cada um na frente. Por padrão mostra só as colunas que respondem "está dando resultado?"; o
 * resto vem do seletor "Colunas".
 *
 * "Lançar mês" transforma a tabela numa grade editável (clientes × métricas) e salva tudo de uma
 * vez, numa transação: é o jeito de fechar o mês de 11 clientes sem abrir 11 telas.
 */
export function TrafegoNxPage() {
  const navegar = useNavigate()
  const [periodo, setPeriodo] = React.useState(mesAtual())
  const [linhas, setLinhas] = React.useState<GcClienteLista[]>([])
  const [carregando, setCarregando] = React.useState(true)
  const [extras, setExtras] = React.useState<string[]>(lerExtras)
  const [menuColunas, setMenuColunas] = React.useState(false)
  const [editando, setEditando] = React.useState(false)
  const [rascunho, setRascunho] = React.useState<Rascunho>({})
  const [avisos, setAvisos] = React.useState<string[] | null>(null)
  const [salvando, setSalvando] = React.useState(false)
  // Versão dos dados lançados: sobe depois de salvar e faz a faixa de "faltam X" se recalcular.
  const [versao, setVersao] = React.useState(0)
  const pendencia = useLancamentoPendente(versao)
  const [params, setParams] = useSearchParams()
  // Mês cuja grade deve abrir assim que os dados dele chegarem (vem do atalho da faixa).
  const [abrirGrade, setAbrirGrade] = React.useState<string | null>(null)
  const [periodoCarregado, setPeriodoCarregado] = React.useState('')
  const ultimoPedido = React.useRef('')
  const refMenu = React.useRef<HTMLDivElement>(null)
  useOutsideClose(refMenu, menuColunas, () => setMenuColunas(false))

  const carregar = React.useCallback(async () => {
    setCarregando(true)
    ultimoPedido.current = periodo
    try {
      const r = await gestaoClientes.trafego(periodo)
      // Resposta de um mês que já não é o pedido (a pessoa trocou de mês no meio) é descartada: sem
      // isso, os números de outubro apareciam sob o título "Setembro".
      if (ultimoPedido.current !== periodo) return
      setLinhas(r)
      setPeriodoCarregado(periodo)
    } catch (err) {
      toast.error('Falha ao carregar o tráfego: ' + (err as Error).message)
    } finally {
      if (ultimoPedido.current === periodo) setCarregando(false)
    }
  }, [periodo])

  React.useEffect(() => {
    // Trocar de mês no meio da edição descartaria o que foi digitado sem aviso — sai do modo antes.
    setEditando(false)
    void carregar()
  }, [carregar])

  // Atalho da faixa de outras telas: /trafego?lancar=2026-09 abre a grade daquele mês.
  React.useEffect(() => {
    const pedido = params.get('lancar')
    if (pedido && /^\d{4}-\d{2}$/.test(pedido)) {
      setPeriodo(pedido)
      setAbrirGrade(pedido)
      setParams({}, { replace: true })
    }
    // Só na entrada: depois disso quem manda é o estado, não a URL.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const alternarExtra = (chave: string) => {
    setExtras((atual) => {
      const novo = atual.includes(chave) ? atual.filter((k) => k !== chave) : [...atual, chave]
      try {
        window.localStorage.setItem(CHAVE_ARMAZENAMENTO, JSON.stringify(novo))
      } catch {
        /* sem armazenamento: a escolha vale só até recarregar, e nada quebra */
      }
      return novo
    })
  }

  const colunasVisiveis = TODAS_COLUNAS.filter(
    (c) => COLUNAS_PADRAO.includes(c.chave) || extras.includes(c.chave),
  )

  // Em edição, as linhas "efetivas" trazem o que está digitado — é com elas que o total e as
  // colunas calculadas (CPL, ROAS) se atualizam enquanto a pessoa digita.
  const linhasEfetivas = React.useMemo(() => {
    if (!editando) return linhas
    return linhas.map((l) => {
      const mesEditado: Record<string, string> = {}
      for (const m of METRICAS_LANCADAS) {
        const n = numeroDigitado(rascunho[l.id]?.[m.chave])
        if (n !== null) mesEditado[m.chave] = String(n)
      }
      return { ...l, metricas_mes: mesEditado }
    })
  }, [editando, linhas, rascunho])

  const comSaude = React.useMemo(
    () => linhasEfetivas.map((c) => ({ cliente: c, saude: avaliarSaude(c) })),
    [linhasEfetivas],
  )

  // Cliente sem número nenhum no mês continua na lista, no fim: ver quem ficou sem lançamento é
  // metade do uso desta tela. Em edição a ordem é a alfabética e FIXA — linha que muda de lugar
  // enquanto se digita faz a pessoa perder onde estava.
  const ordenadas = editando
    ? [...comSaude].sort((a, b) => a.cliente.nome_empresa.localeCompare(b.cliente.nome_empresa))
    : [
        ...comSaude.filter(({ cliente }) => Object.keys(cliente.metricas_mes ?? {}).length > 0),
        ...comSaude.filter(({ cliente }) => Object.keys(cliente.metricas_mes ?? {}).length === 0),
      ]

  // Os cartões, o total e o "em risco" contam só quem entra nos totais (ativo, não-teste). As linhas
  // dos de teste continuam na tabela, marcadas, mas não somam.
  const contados = comSaude.filter(({ cliente }) => contaNoTotal(cliente))
  const total = totalDoMes(contados.map((x) => x.cliente), 'metricas_mes')
  const totalAnterior = totalDoMes(contados.map((x) => x.cliente), 'metricas_mes_anterior')
  const emRisco = contados.filter(({ saude }) => saude.nivel === 'risco').length
  const contadosComNumeros = contados.filter(
    ({ cliente }) => Object.keys(cliente.metricas_mes ?? {}).length > 0,
  ).length

  // ---------------------------------------------------------------- edição em grade
  const entrarNaEdicao = () => {
    setRascunho(rascunhoInicial(linhas))
    setEditando(true)
  }

  // Abre a grade quando os dados do mês pedido chegaram — antes disso `linhas` ainda é de outro mês.
  React.useEffect(() => {
    if (abrirGrade && !carregando && periodoCarregado === abrirGrade && linhas.length > 0) {
      setRascunho(rascunhoInicial(linhas))
      setEditando(true)
      setAbrirGrade(null)
    }
  }, [abrirGrade, carregando, periodoCarregado, linhas])

  const original = React.useMemo(() => rascunhoInicial(linhas), [linhas])

  /** Só o que MUDOU: salvar 11 clientes quando 2 foram editados reescreveria 9 sem motivo. */
  const alteracoes = React.useMemo(() => {
    const porCliente: { id: string; valores: Record<string, number | null> }[] = []
    let celulas = 0
    for (const l of linhas) {
      const valores: Record<string, number | null> = {}
      for (const m of METRICAS_LANCADAS) {
        const antes = (original[l.id]?.[m.chave] ?? '').trim()
        const depois = (rascunho[l.id]?.[m.chave] ?? '').trim()
        if (antes !== depois) {
          valores[m.chave] = numeroDigitado(depois)
          celulas++
        }
      }
      if (Object.keys(valores).length > 0) porCliente.push({ id: l.id, valores })
    }
    return { porCliente, celulas }
  }, [linhas, original, rascunho])

  const salvarGrade = async (ignorarAvisos = false) => {
    if (!ignorarAvisos) {
      // Valida cada cliente alterado com o conjunto COMPLETO dos números dele, não só as células
      // mexidas: vendas > leads só aparece olhando os dois lados.
      const achados: string[] = []
      for (const { id } of alteracoes.porCliente) {
        const l = linhas.find((x) => x.id === id)!
        const cheio: Record<string, number | null> = {}
        for (const m of METRICAS_LANCADAS) cheio[m.chave] = numeroDigitado(rascunho[id]?.[m.chave])
        for (const aviso of validarMetricas(cheio)) achados.push(`${l.nome_empresa}: ${aviso}`)
      }
      if (achados.length > 0) {
        setAvisos(achados)
        return
      }
    }
    setAvisos(null)
    setSalvando(true)
    try {
      const r = await gestaoClientes.salvarMetricasEmLote({
        periodo,
        linhas: alteracoes.porCliente.map((x) => ({ gc_cliente_id: x.id, valores: x.valores })),
        confirmar_avisos: ignorarAvisos,
      })
      toast.success(`${mesPorExtenso(periodo)} salvo — ${r.clientes} cliente(s) atualizado(s)`)
      setEditando(false)
      setVersao((v) => v + 1)
      await carregar()
    } catch (err) {
      const doServidor = avisosDoErro(err)
      if (doServidor) setAvisos(doServidor)
      else toast.error('Falha ao salvar o mês: ' + (err as Error).message)
    } finally {
      setSalvando(false)
    }
  }

  /** Enter desce pra mesma coluna da linha de baixo — é como se preenche planilha. */
  const aoTeclar = (e: React.KeyboardEvent<HTMLInputElement>, chave: string, indice: number) => {
    if (e.key !== 'Enter') return
    e.preventDefault()
    const proxima = document.querySelector<HTMLInputElement>(`[data-celula="${chave}-${indice + 1}"]`)
    proxima?.focus()
    proxima?.select()
  }

  const colunasDaGrade = [...METRICAS_LANCADAS]

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
              disabled={editando}
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
              disabled={editando}
              onClick={() => setPeriodo((p) => somarMeses(p, 1))}
              aria-label="Próximo mês"
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        }
      />

      <div className="space-y-4 px-4 pb-10 lg:px-6">
        {!editando && (
          <FaixaLancamento
            pendencia={pendencia}
            onLancar={(p) => {
              setPeriodo(p)
              setAbrirGrade(p)
            }}
          />
        )}

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
              {(['investimento', 'leads', 'vendas', 'receita'] as const).map((chave) => {
                const def = TODAS_COLUNAS.find((c) => c.chave === chave)!
                return (
                  <div key={chave} className="rounded-xl border border-line p-4">
                    <p className="text-xs uppercase tracking-wide text-foreground/45">{def.label}</p>
                    <p className="mt-0.5 text-2xl font-semibold tabular-nums text-foreground">
                      {formatarMetrica(total[chave] ?? null, def.unidade)}
                    </p>
                    <Variacao chave={chave} atual={total[chave]} anterior={totalAnterior[chave]} />
                  </div>
                )
              })}
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-sm text-foreground/60">
                <span>
                  <strong className="text-foreground">{contadosComNumeros}</strong> de {contados.length}{' '}
                  clientes com lançamento
                </span>
                <span>
                  Retorno da carteira:{' '}
                  <strong className="text-foreground">
                    {total.roas === undefined ? '—' : `${total.roas.toFixed(2).replace('.', ',')}x`}
                  </strong>
                </span>
                <span>
                  CPL da carteira:{' '}
                  <strong className="text-foreground">{formatarMetrica(total.cpl ?? null, 'reais')}</strong>
                </span>
                {emRisco > 0 && (
                  <span className="text-danger">
                    {emRisco} cliente(s) em risco — a coluna "Como está" aponta o motivo
                  </span>
                )}
              </div>

              <div className="flex items-center gap-2">
                {!editando && (
                  <div ref={refMenu} className="relative">
                    <Button
                      variant="secondary"
                      size="sm"
                      leftIcon={<Columns3 className="h-4 w-4" />}
                      onClick={() => setMenuColunas((v) => !v)}
                    >
                      Colunas
                    </Button>
                    {menuColunas && (
                      <div className="absolute right-0 z-20 mt-1 w-56 rounded-xl border border-line bg-surface p-2 shadow-lg">
                        <p className="px-2 pb-1 text-[11px] uppercase tracking-wide text-foreground/40">
                          Mostrar também
                        </p>
                        {TODAS_COLUNAS.filter((c) => !COLUNAS_PADRAO.includes(c.chave)).map((c) => (
                          <label
                            key={c.chave}
                            className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm text-foreground/80 hover:bg-elevate/[0.04]"
                          >
                            <input
                              type="checkbox"
                              checked={extras.includes(c.chave)}
                              onChange={() => alternarExtra(c.chave)}
                              className="h-3.5 w-3.5 rounded border-line"
                            />
                            {c.label}
                          </label>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {editando ? (
                  <>
                    <span className="text-xs text-foreground/50">
                      {alteracoes.celulas === 0
                        ? 'nada alterado'
                        : `${alteracoes.celulas} alteração(ões) em ${alteracoes.porCliente.length} cliente(s)`}
                    </span>
                    <Button
                      variant="ghost"
                      size="sm"
                      leftIcon={<X className="h-4 w-4" />}
                      onClick={() => setEditando(false)}
                    >
                      Cancelar
                    </Button>
                    <Button
                      size="sm"
                      loading={salvando}
                      disabled={alteracoes.celulas === 0}
                      onClick={() => void salvarGrade()}
                    >
                      Salvar o mês
                    </Button>
                  </>
                ) : (
                  <Button size="sm" leftIcon={<Pencil className="h-4 w-4" />} onClick={entrarNaEdicao}>
                    Lançar mês
                  </Button>
                )}
              </div>
            </div>

            {editando && (
              <p className="rounded-lg border border-accent/25 bg-accent/[0.04] px-3 py-2 text-xs text-foreground/70">
                Preencha direto na tabela — <strong>Enter</strong> desce pra linha de baixo. Campo
                vazio apaga o lançamento (zero é um número). CPL e retorno se recalculam sozinhos, e só
                o que você mudou é salvo.
              </p>
            )}

            <div className="overflow-hidden rounded-xl border border-line">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-elevate/[0.02] text-left text-xs uppercase tracking-wide text-foreground/50">
                    <tr>
                      <th className="sticky left-0 bg-surface px-4 py-2.5 font-medium">Cliente</th>
                      {!editando && <th className="px-3 py-2.5 font-medium">Como está</th>}
                      {editando
                        ? colunasDaGrade.map((c) => (
                            <th key={c.chave} className="px-2 py-2.5 text-right font-medium" title={c.ajuda}>
                              {c.label}
                            </th>
                          ))
                        : colunasVisiveis.map((c) => (
                            <th key={c.chave} className="px-3 py-2.5 text-right font-medium" title={c.ajuda}>
                              {c.label}
                            </th>
                          ))}
                      {editando && (
                        <>
                          <th className="px-3 py-2.5 text-right font-medium">CPL</th>
                          <th className="px-3 py-2.5 text-right font-medium">ROAS</th>
                        </>
                      )}
                      {!editando && <th className="px-3 py-2.5 font-medium">Relatório</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {ordenadas.map(({ cliente: l, saude }, indice) =>
                      editando ? (
                        <LinhaEditavel
                          key={l.id}
                          indice={indice}
                          cliente={l}
                          valores={rascunho[l.id] ?? {}}
                          original={original[l.id] ?? {}}
                          colunas={colunasDaGrade.map((c) => c.chave)}
                          onMudar={(chave, texto) =>
                            setRascunho((r) => ({ ...r, [l.id]: { ...(r[l.id] ?? {}), [chave]: texto } }))
                          }
                          onTeclar={aoTeclar}
                        />
                      ) : (
                        <Linha
                          key={l.id}
                          cliente={l}
                          saude={saude}
                          colunas={colunasVisiveis.map((c) => c.chave)}
                          onAbrir={() => navegar(`/clientesnxdigital/clientes/${l.id}`)}
                        />
                      ),
                    )}
                  </tbody>
                  <tfoot>
                    <tr className="border-t border-line bg-elevate/[0.03] font-medium">
                      <td className="sticky left-0 bg-surface px-4 py-2.5 text-foreground">Total</td>
                      {!editando && <td />}
                      {(editando ? colunasDaGrade : colunasVisiveis).map((c) => (
                        <td
                          key={c.chave}
                          className="whitespace-nowrap px-3 py-2.5 text-right tabular-nums text-foreground"
                        >
                          {formatarMetrica(total[c.chave] ?? null, c.unidade)}
                        </td>
                      ))}
                      {editando && (
                        <>
                          <td className="whitespace-nowrap px-3 py-2.5 text-right tabular-nums text-foreground">
                            {formatarMetrica(total.cpl ?? null, 'reais')}
                          </td>
                          <td className="whitespace-nowrap px-3 py-2.5 text-right tabular-nums text-foreground">
                            {formatarMetrica(total.roas ?? null, 'decimal')}
                          </td>
                        </>
                      )}
                      {!editando && <td />}
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>

            <p className="text-xs text-foreground/45">
              As colunas calculadas (CPL, CTR, CAC, ticket, conversão, ROAS) saem da divisão dos
              números lançados — no total, da divisão das somas, não da média dos clientes. Clientes de
              teste aparecem na lista, mas não entram nos totais.
            </p>
          </>
        )}
      </div>

      <ModalAvisos
        avisos={avisos}
        salvando={salvando}
        onCorrigir={() => setAvisos(null)}
        onSalvarMesmoAssim={() => void salvarGrade(true)}
      />
    </>
  )
}

function NomeDoCliente({ cliente: l }: { cliente: GcClienteLista }) {
  return (
    <>
      <span className="block font-medium text-foreground">
        {l.nome_empresa}
        {l.fora_dos_totais && (
          <span className="ml-1.5 rounded border border-line px-1 text-[10px] font-normal uppercase text-foreground/45">
            teste
          </span>
        )}
      </span>
      <span className="block text-xs text-foreground/45">{l.responsavel_nome ?? 'sem responsável'}</span>
    </>
  )
}

function Linha({
  cliente: l,
  saude,
  colunas,
  onAbrir,
}: {
  cliente: GcClienteLista
  saude: Saude
  colunas: string[]
  onAbrir: () => void
}) {
  const v = comDerivadas(l.metricas_mes ?? {})
  const anterior = comDerivadas(l.metricas_mes_anterior ?? {})
  return (
    <tr
      onClick={onAbrir}
      className="cursor-pointer border-t border-line transition-colors hover:bg-elevate/[0.03]"
    >
      <td className="sticky left-0 whitespace-nowrap bg-surface px-4 py-2.5">
        <NomeDoCliente cliente={l} />
      </td>
      <td className="whitespace-nowrap px-3 py-2.5">
        <PastilhaSaude estado={saude.nivel} />
      </td>
      {colunas.map((chave) => {
        const def = TODAS_COLUNAS.find((c) => c.chave === chave)!
        const variacao = variacaoDaMetrica(chave, v[chave], anterior[chave])
        return (
          <td
            key={chave}
            className="whitespace-nowrap px-3 py-2.5 text-right tabular-nums text-foreground/75"
          >
            {formatarMetrica(v[chave] ?? null, def.unidade)}
            {variacao && Math.abs(variacao.pct) >= 5 && (
              <span className={cn('ml-1 text-[10px]', variacao.boa ? 'text-success' : 'text-danger')}>
                {variacao.pct > 0 ? '▲' : '▼'}
              </span>
            )}
          </td>
        )
      })}
      <td className="whitespace-nowrap px-3 py-2.5">
        <PastilhaRelatorio status={l.relatorio_mes} />
      </td>
    </tr>
  )
}

/** Uma linha da grade de lançamento: um campo por métrica, mais CPL e ROAS recalculados na hora. */
function LinhaEditavel({
  indice,
  cliente: l,
  valores,
  original,
  colunas,
  onMudar,
  onTeclar,
}: {
  indice: number
  cliente: GcClienteLista
  valores: Record<string, string>
  original: Record<string, string>
  colunas: string[]
  onMudar: (chave: string, texto: string) => void
  onTeclar: (e: React.KeyboardEvent<HTMLInputElement>, chave: string, indice: number) => void
}) {
  const brutas: Record<string, number | null> = {}
  for (const chave of colunas) brutas[chave] = numeroDigitado(valores[chave])
  const calculado = comDerivadas(brutas)

  return (
    <tr className="border-t border-line">
      <td className="sticky left-0 whitespace-nowrap bg-surface px-4 py-2">
        <NomeDoCliente cliente={l} />
      </td>
      {colunas.map((chave) => {
        const def = METRICAS_LANCADAS.find((m) => m.chave === chave)!
        const mudou = (valores[chave] ?? '').trim() !== (original[chave] ?? '').trim()
        return (
          <td key={chave} className="px-1.5 py-1.5">
            <input
              data-celula={`${chave}-${indice}`}
              value={valores[chave] ?? ''}
              onChange={(e) => onMudar(chave, e.target.value)}
              onKeyDown={(e) => onTeclar(e, chave, indice)}
              onFocus={(e) => e.target.select()}
              inputMode="decimal"
              placeholder={def.unidade === 'reais' ? '0,00' : '0'}
              className={cn(
                'h-8 w-24 rounded-md border bg-surface px-2 text-right text-sm tabular-nums text-foreground outline-none',
                'placeholder:text-foreground/25 focus:border-accent focus:ring-2 focus:ring-accent/15',
                mudou ? 'border-accent/60 bg-accent/[0.04]' : 'border-line',
              )}
            />
          </td>
        )
      })}
      <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums text-foreground/60">
        {formatarMetrica(calculado.cpl ?? null, 'reais')}
      </td>
      <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums text-foreground/60">
        {formatarMetrica(calculado.roas ?? null, 'decimal')}
      </td>
    </tr>
  )
}
