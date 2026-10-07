import * as React from 'react'
import { Eye, Plus, StickyNote, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { gestaoClientes, type GcInfoMes } from '@/services/gestaoClientes'
import { cn } from '@/lib/utils'

/**
 * "Adicionar info": informações livres do mês — um número relevante do tráfego, algo que aconteceu —
 * que não cabem nas métricas fixas. Cada uma tem título, valor (opcional) e observação (opcional) e
 * pode ser marcada pra aparecer no relatório do cliente (portal e PDF). Por padrão fica só interna.
 *
 * Salva na hora, uma por uma: é anotação, não parte da grade do mês, então não depende do "Salvar o mês".
 */
export function InfosDoMes({ clienteId, inicio }: { clienteId: string; inicio: string }) {
  const [infos, setInfos] = React.useState<GcInfoMes[] | null>(null)
  const [adicionando, setAdicionando] = React.useState(false)
  const [titulo, setTitulo] = React.useState('')
  const [valor, setValor] = React.useState('')
  const [observacao, setObservacao] = React.useState('')
  const [noRelatorio, setNoRelatorio] = React.useState(false)
  const [salvando, setSalvando] = React.useState(false)

  const carregar = React.useCallback(async () => {
    try {
      setInfos(await gestaoClientes.infos(clienteId, inicio))
    } catch (err) {
      toast.error('Falha ao carregar as informações: ' + (err as Error).message)
      setInfos([])
    }
  }, [clienteId, inicio])

  React.useEffect(() => {
    setInfos(null)
    setAdicionando(false)
    void carregar()
  }, [carregar])

  const limpar = () => {
    setTitulo('')
    setValor('')
    setObservacao('')
    setNoRelatorio(false)
  }

  const adicionar = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!titulo.trim()) {
      toast.error('Dê um título à informação')
      return
    }
    setSalvando(true)
    try {
      await gestaoClientes.criarInfo(clienteId, {
        periodo_inicio: inicio, titulo, valor, observacao, no_relatorio: noRelatorio,
      })
      limpar()
      setAdicionando(false)
      await carregar()
    } catch (err) {
      toast.error('Falha ao salvar: ' + (err as Error).message)
    } finally {
      setSalvando(false)
    }
  }

  const agir = async (fn: () => Promise<unknown>) => {
    try {
      await fn()
      await carregar()
    } catch (err) {
      toast.error('Falha: ' + (err as Error).message)
    }
  }

  return (
    <div className="mt-5 border-t border-line pt-4">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
          <StickyNote className="h-4 w-4 text-accent" /> Informações do mês
          <span className="text-xs font-normal text-foreground/45">algo do tráfego, um número relevante…</span>
        </h3>
        {!adicionando && (
          <Button variant="secondary" size="sm" leftIcon={<Plus className="h-3.5 w-3.5" />} onClick={() => setAdicionando(true)}>
            Adicionar info
          </Button>
        )}
      </div>

      {adicionando && (
        <form onSubmit={adicionar} className="mb-3 rounded-xl border border-accent/30 bg-accent/[0.03] p-3">
          <div className="grid gap-3 sm:grid-cols-[1fr_180px]">
            <Input
              label="Título"
              value={titulo}
              onChange={(e) => setTitulo(e.target.value)}
              placeholder="Ex.: Alcance, CPM, orçamento do Google, criativo campeão…"
              autoFocus
            />
            <Input label="Valor (opcional)" value={valor} onChange={(e) => setValor(e.target.value)} placeholder="Ex.: 12,5 · 38 mil · subiu 20%" />
          </div>
          <div className="mt-3">
            <Input
              label="Observação (opcional)"
              value={observacao}
              onChange={(e) => setObservacao(e.target.value)}
              placeholder="O que isso significa, de onde veio…"
            />
          </div>
          <label className="mt-3 flex cursor-pointer items-center gap-2 text-sm text-foreground/75">
            <input
              type="checkbox"
              checked={noRelatorio}
              onChange={(e) => setNoRelatorio(e.target.checked)}
              className="h-4 w-4 rounded border-line"
            />
            Mostrar no relatório do cliente
            <span className="text-xs text-foreground/40">(por padrão fica só interna)</span>
          </label>
          <div className="mt-3 flex justify-end gap-2">
            <Button
              variant="ghost"
              size="sm"
              type="button"
              onClick={() => {
                limpar()
                setAdicionando(false)
              }}
            >
              Cancelar
            </Button>
            <Button size="sm" type="submit" loading={salvando}>
              Adicionar
            </Button>
          </div>
        </form>
      )}

      {infos === null ? (
        <p className="text-xs text-foreground/40">Carregando…</p>
      ) : infos.length === 0 ? (
        !adicionando && <p className="text-sm text-foreground/45">Nenhuma informação neste mês.</p>
      ) : (
        <ul className="grid gap-2 sm:grid-cols-2">
          {infos.map((i) => (
            <li key={i.id} className="group flex items-start gap-3 rounded-xl border border-line p-3">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-foreground">{i.titulo}</p>
                {i.valor && <p className="text-lg font-semibold tabular-nums text-foreground">{i.valor}</p>}
                {i.observacao && <p className="mt-0.5 text-xs text-foreground/55">{i.observacao}</p>}
                <button
                  type="button"
                  onClick={() => void agir(() => gestaoClientes.atualizarInfo(i.id, { no_relatorio: !i.no_relatorio }))}
                  className={cn(
                    'mt-1.5 inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] transition-colors',
                    i.no_relatorio
                      ? 'border-accent/30 bg-accent/10 text-accent'
                      : 'border-line text-foreground/45 hover:text-foreground/75',
                  )}
                  title={i.no_relatorio ? 'Aparece no relatório do cliente — clique pra tirar' : 'Só interna — clique pra mostrar no relatório do cliente'}
                >
                  <Eye className="h-3 w-3" />
                  {i.no_relatorio ? 'no relatório do cliente' : 'só interna'}
                </button>
              </div>
              <button
                type="button"
                onClick={() => void agir(() => gestaoClientes.excluirInfo(i.id))}
                className="shrink-0 text-foreground/25 transition-opacity hover:text-danger sm:opacity-0 sm:group-hover:opacity-100"
                aria-label="Excluir informação"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
