import * as React from 'react'
import {
  ChevronLeft, ChevronRight, Copy, ExternalLink, FileDown, Link2, Loader2, Send, Trash2, Undo2,
} from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/Button'
import { Textarea } from '@/components/ui/Input'
import { Badge } from '@/components/ui/Badge'
import {
  gestaoClientes,
  type GcClienteDetalhe, type GcLinkPublico, type GcMeta, type GcMetrica,
  type GcRelatorio, type GcSnapshot,
} from '@/services/gestaoClientes'
import { progressoDaMeta } from '@/lib/gcSaude'
import {
  METRICAS_DERIVADAS, METRICAS_LANCADAS, comDerivadas, formatarMetrica,
  limitesDoMes, mesAtual, mesPorExtenso, metricaLabel, metricaUnidade, somarMeses,
} from '@/lib/gcMetricas'

/** Métricas de um período, em números, com as derivadas calculadas. */
function doPeriodo(metricas: GcMetrica[], inicio: string): Record<string, number> {
  const brutas: Record<string, string> = {}
  for (const m of metricas) {
    if (String(m.periodo_inicio).slice(0, 10) === inicio) brutas[m.chave] = m.valor
  }
  return comDerivadas(brutas)
}

/**
 * Relatórios do cliente e o link do portal.
 *
 * Publicar CONGELA uma foto (snapshot) do que está na tela: números, metas, estratégias e os dois
 * textos do gestor. O portal e o PDF leem só essa foto — corrigir a métrica do mês depois não muda
 * o relatório que o cliente já leu. Pra mexer no texto de um publicado, tem que despublicar
 * primeiro; é a forma de não trocar por baixo dele o que ele viu.
 *
 * A foto é montada aqui, na tela, e não no servidor, porque é aqui que estão as definições das
 * métricas (src/lib/gcMetricas.ts). Ela sai auto-descritiva — cada número leva label e unidade —
 * pra que o portal e o PDF não precisem dessas definições pra desenhar.
 */
export function AbaRelatorios({ detalhe }: { detalhe: GcClienteDetalhe }) {
  const clienteId = detalhe.cliente.id
  const [relatorios, setRelatorios] = React.useState<GcRelatorio[]>([])
  const [metricas, setMetricas] = React.useState<GcMetrica[]>([])
  const [metas, setMetas] = React.useState<GcMeta[]>([])
  const [link, setLink] = React.useState<GcLinkPublico | null>(null)
  const [carregando, setCarregando] = React.useState(true)
  const [periodo, setPeriodo] = React.useState(mesAtual())
  const [comentario, setComentario] = React.useState('')
  const [proximos, setProximos] = React.useState('')
  const [ocupado, setOcupado] = React.useState<string | null>(null)

  const carregar = React.useCallback(async () => {
    try {
      const [r, m, g, l] = await Promise.all([
        gestaoClientes.relatorios(clienteId),
        gestaoClientes.metricas(clienteId),
        gestaoClientes.metas(clienteId),
        gestaoClientes.linkDoCliente(clienteId),
      ])
      setRelatorios(r)
      setMetricas(m)
      setMetas(g)
      setLink(l)
    } catch (err) {
      toast.error('Falha ao carregar os relatórios: ' + (err as Error).message)
    } finally {
      setCarregando(false)
    }
  }, [clienteId])

  React.useEffect(() => {
    void carregar()
  }, [carregar])

  const { inicio, fim } = limitesDoMes(periodo)
  const doMes = relatorios.find((r) => String(r.periodo_inicio).slice(0, 10) === inicio) ?? null

  // Trocar de mês traz o texto já escrito pra aquele mês — ou limpa, se não existe relatório ainda.
  React.useEffect(() => {
    setComentario(doMes?.comentario_gestor ?? '')
    setProximos(doMes?.proximos_passos ?? '')
  }, [doMes])

  const numeros = doPeriodo(metricas, inicio)
  const anteriores = doPeriodo(metricas, limitesDoMes(somarMeses(periodo, -1)).inicio)

  const montarSnapshot = (): GcSnapshot => ({
    versao: 1,
    cliente: {
      nome_empresa: detalhe.cliente.nome_empresa,
      segmento: detalhe.cliente.segmento,
      cidade: detalhe.cliente.cidade,
      responsavel_nome: detalhe.cliente.responsavel_nome,
    },
    periodo: { inicio, fim, rotulo: mesPorExtenso(periodo) },
    numeros: [...METRICAS_LANCADAS, ...METRICAS_DERIVADAS].map((m) => ({
      chave: m.chave,
      label: m.label,
      unidade: m.unidade,
      valor: numeros[m.chave] ?? null,
      anterior: anteriores[m.chave] ?? null,
      subirEhBom: m.subirEhBom !== false,
    })),
    // O essencial escolhido aqui, pro portal e o PDF não precisarem saber quais chaves importam.
    resumo: {
      investimento: numeros.investimento ?? null,
      vendas: numeros.vendas ?? null,
      receita: numeros.receita ?? null,
      retorno: numeros.roas ?? null,
    },
    metas: metas.map((meta) => ({
      label: metricaLabel(meta.chave_metrica),
      unidade: metricaUnidade(meta.chave_metrica),
      base: Number(meta.valor_base),
      meta: Number(meta.valor_meta),
      atual: numeros[meta.chave_metrica] ?? null,
      progresso: progressoDaMeta(meta, numeros[meta.chave_metrica]),
      horizonte: meta.horizonte ?? 'mes',
      prazo: meta.prazo,
    })),
    jornada: detalhe.jornada.map((j) => ({ nome: j.nome, status: j.status })),
    estrategias: detalhe.estrategias.map((e) => ({
      nome: e.nome,
      status: e.status,
      feitos: e.itens.filter((i) => i.concluido).length,
      total: e.itens.length,
    })),
    comentario_gestor: comentario,
    proximos_passos: proximos,
  })

  const agir = async (chave: string, fn: () => Promise<unknown>) => {
    setOcupado(chave)
    try {
      await fn()
      await carregar()
    } catch (err) {
      toast.error((err as Error).message)
    } finally {
      setOcupado(null)
    }
  }

  const salvarRascunho = () =>
    agir('salvar', async () => {
      await gestaoClientes.salvarRelatorio(clienteId, {
        periodo_inicio: inicio,
        periodo_fim: fim,
        comentario_gestor: comentario,
        proximos_passos: proximos,
      })
      toast.success('Rascunho salvo')
    })

  const publicar = () =>
    agir('publicar', async () => {
      // Publicar sem rascunho salvo é o caso comum (a pessoa escreve e publica de uma vez), então
      // o salvamento faz parte do publicar em vez de ser um passo obrigatório antes.
      const salvo = await gestaoClientes.salvarRelatorio(clienteId, {
        periodo_inicio: inicio,
        periodo_fim: fim,
        comentario_gestor: comentario,
        proximos_passos: proximos,
      })
      await gestaoClientes.publicarRelatorio(salvo.id, montarSnapshot())
      toast.success(`Relatório de ${mesPorExtenso(periodo)} publicado`)
    })

  const baixarPdf = async (relatorio: GcRelatorio | null) => {
    if (!relatorio) {
      toast.error('Salve o rascunho antes de gerar o PDF')
      return
    }
    setOcupado('pdf')
    try {
      const blob = await gestaoClientes.pdfDoRelatorio(relatorio.id, montarSnapshot())
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `relatorio-${String(relatorio.periodo_inicio).slice(0, 7)}-${detalhe.cliente.nome_empresa}.pdf`
      a.click()
      URL.revokeObjectURL(url)
    } catch (err) {
      toast.error('Falha ao gerar o PDF: ' + (err as Error).message)
    } finally {
      setOcupado(null)
    }
  }

  const enderecoDoPortal = link ? `${window.location.origin}/cliente/${link.token}` : ''

  if (carregando) {
    return (
      <div className="flex items-center justify-center gap-2 py-16 text-sm text-foreground/60">
        <Loader2 className="h-4 w-4 animate-spin" /> Carregando relatórios…
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <section className="rounded-xl border border-line p-4">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-1">
            <Button variant="ghost" size="sm" onClick={() => setPeriodo((p) => somarMeses(p, -1))} aria-label="Mês anterior">
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <span className="min-w-[160px] text-center text-sm font-semibold text-foreground">
              {mesPorExtenso(periodo)}
            </span>
            <Button variant="ghost" size="sm" onClick={() => setPeriodo((p) => somarMeses(p, 1))} aria-label="Próximo mês">
              <ChevronRight className="h-4 w-4" />
            </Button>
            {doMes && (
              <Badge tone={doMes.status === 'publicado' ? 'success' : 'neutral'}>
                {doMes.status === 'publicado' ? 'publicado' : 'rascunho'}
              </Badge>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              loading={ocupado === 'pdf'}
              leftIcon={<FileDown className="h-4 w-4" />}
              onClick={() => void baixarPdf(doMes)}
            >
              PDF
            </Button>
            {doMes?.status === 'publicado' ? (
              <Button
                variant="secondary"
                size="sm"
                loading={ocupado === 'despublicar'}
                leftIcon={<Undo2 className="h-4 w-4" />}
                onClick={() => void agir('despublicar', () => gestaoClientes.despublicarRelatorio(doMes.id))}
              >
                Despublicar
              </Button>
            ) : (
              <>
                <Button variant="secondary" size="sm" loading={ocupado === 'salvar'} onClick={salvarRascunho}>
                  Salvar rascunho
                </Button>
                <Button
                  size="sm"
                  loading={ocupado === 'publicar'}
                  leftIcon={<Send className="h-4 w-4" />}
                  onClick={publicar}
                >
                  Publicar
                </Button>
              </>
            )}
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {[...METRICAS_LANCADAS, ...METRICAS_DERIVADAS].map((m) => (
            <div key={m.chave} className="rounded-lg border border-line px-3 py-2">
              <p className="text-xs uppercase tracking-wide text-foreground/45">{m.label}</p>
              <p className="text-lg font-semibold tabular-nums text-foreground">
                {formatarMetrica(numeros[m.chave] ?? null, m.unidade)}
              </p>
            </div>
          ))}
        </div>

        <div className="mt-4 grid gap-3 lg:grid-cols-2">
          <Textarea
            label="Comentário do gestor"
            rows={5}
            value={comentario}
            onChange={(e) => setComentario(e.target.value)}
            placeholder="O que explica os números do mês, na linguagem do cliente."
            disabled={doMes?.status === 'publicado'}
          />
          <Textarea
            label="Próximos passos"
            rows={5}
            value={proximos}
            onChange={(e) => setProximos(e.target.value)}
            placeholder="O que vai ser feito no mês que vem."
            disabled={doMes?.status === 'publicado'}
          />
        </div>
        {doMes?.status === 'publicado' && (
          <p className="mt-2 text-xs text-foreground/50">
            Relatório publicado não é editado: o cliente já leu esse texto. Despublique pra mexer.
          </p>
        )}
      </section>

      <section className="rounded-xl border border-line p-4">
        <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-foreground">
          <Link2 className="h-4 w-4 text-accent" /> Portal do cliente
        </h2>
        {link ? (
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <code className="min-w-0 flex-1 truncate rounded-lg border border-line bg-elevate/[0.03] px-3 py-2 text-xs text-foreground/80">
                {enderecoDoPortal}
              </code>
              <Button
                variant="secondary"
                size="sm"
                leftIcon={<Copy className="h-3.5 w-3.5" />}
                onClick={() => {
                  void navigator.clipboard.writeText(enderecoDoPortal)
                  toast.success('Link copiado')
                }}
              >
                Copiar
              </Button>
              <Button
                variant="ghost"
                size="sm"
                leftIcon={<ExternalLink className="h-3.5 w-3.5" />}
                onClick={() => window.open(enderecoDoPortal, '_blank')}
              >
                Abrir
              </Button>
            </div>
            <p className="text-xs text-foreground/50">
              {Number(link.acessos)} acesso(s)
              {link.ultimo_acesso
                ? ` · último em ${new Date(link.ultimo_acesso).toLocaleString('pt-BR')}`
                : ' · ninguém abriu ainda'}
              . O portal mostra só os relatórios publicados.
            </p>
            <div className="flex gap-2">
              <Button
                variant="ghost"
                size="sm"
                loading={ocupado === 'gerar'}
                onClick={() => void agir('gerar', () => gestaoClientes.gerarLink(clienteId))}
              >
                Gerar link novo
              </Button>
              <Button
                variant="ghost"
                size="sm"
                loading={ocupado === 'revogar'}
                leftIcon={<Trash2 className="h-3.5 w-3.5" />}
                onClick={() => void agir('revogar', () => gestaoClientes.revogarLink(clienteId))}
              >
                Revogar
              </Button>
            </div>
            <p className="text-xs text-foreground/45">
              Gerar um link novo derruba o anterior — quem tiver o endereço antigo deixa de ver.
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            <p className="text-sm text-foreground/60">
              Esse cliente ainda não tem portal. O link dá acesso sem senha aos relatórios
              publicados — nada de jornada interna, custo ou histórico do time.
            </p>
            <Button
              size="sm"
              loading={ocupado === 'gerar'}
              leftIcon={<Link2 className="h-4 w-4" />}
              onClick={() => void agir('gerar', () => gestaoClientes.gerarLink(clienteId))}
            >
              Gerar link do portal
            </Button>
          </div>
        )}
      </section>

      {relatorios.length > 0 && (
        <section className="overflow-hidden rounded-xl border border-line">
          <h2 className="border-b border-line px-4 py-3 text-sm font-semibold text-foreground">
            Relatórios do cliente
          </h2>
          <ul>
            {relatorios.map((r) => (
              <li
                key={r.id}
                className="group flex flex-wrap items-center gap-3 border-b border-line px-4 py-2.5 last:border-b-0"
              >
                <button
                  type="button"
                  onClick={() => setPeriodo(String(r.periodo_inicio).slice(0, 7))}
                  className="min-w-0 flex-1 text-left text-sm text-foreground/85 hover:text-accent"
                >
                  {mesPorExtenso(String(r.periodo_inicio).slice(0, 7))}
                </button>
                <Badge tone={r.status === 'publicado' ? 'success' : 'neutral'}>{r.status}</Badge>
                <span className="text-xs text-foreground/45">
                  {r.publicado_em
                    ? `publicado em ${new Date(r.publicado_em).toLocaleDateString('pt-BR')}`
                    : 'não publicado'}
                  {r.publicado_por_nome ? ` · ${r.publicado_por_nome}` : ''}
                </span>
                <button
                  type="button"
                  onClick={() => void agir('excluir', () => gestaoClientes.excluirRelatorio(r.id))}
                  className="text-foreground/25 opacity-0 transition-opacity hover:text-danger group-hover:opacity-100"
                  aria-label="Excluir relatório"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}
