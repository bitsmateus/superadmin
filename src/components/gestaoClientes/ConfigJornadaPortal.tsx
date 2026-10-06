import * as React from 'react'
import { Eye, Loader2, Lock } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/Button'
import { PreviaPortal } from '@/components/gestaoClientes/PreviaPortal'
import { gestaoClientes, type GcPortalJornadaOpcoes } from '@/services/gestaoClientes'
import { cn } from '@/lib/utils'

const IGUAIS = (a: GcPortalJornadaOpcoes, b: GcPortalJornadaOpcoes) =>
  a.ativo === b.ativo && a.mostrar_situacao === b.mostrar_situacao && a.mostrar_objetivo === b.mostrar_objetivo

/**
 * As opções do bloco "Nossa jornada" do portal — ligar, os dois textos opcionais e a prévia "ver como
 * o cliente vê". Mora na aba Relatórios, junto do link do portal: é o único lugar onde se configura o
 * que o cliente enxerga do planejamento.
 *
 * Desligado por padrão, cliente a cliente. Estratégia e premissas nunca vão pro portal e não existe
 * opção pra isso. A prévia mostra o que está SALVO (é montada pelo servidor, pelo mesmo caminho do portal).
 */
export function ConfigJornadaPortal({ clienteId }: { clienteId: string }) {
  const [salvo, setSalvo] = React.useState<GcPortalJornadaOpcoes | null>(null)
  const [rascunho, setRascunho] = React.useState<GcPortalJornadaOpcoes | null>(null)
  const [salvando, setSalvando] = React.useState(false)
  const [previaAberta, setPreviaAberta] = React.useState(false)

  React.useEffect(() => {
    let cancelado = false
    gestaoClientes
      .planejamento(clienteId)
      .then((p) => {
        if (cancelado) return
        setSalvo(p.portal)
        setRascunho(p.portal)
      })
      .catch((err: Error) => toast.error('Falha ao carregar as opções do portal: ' + err.message))
    return () => {
      cancelado = true
    }
  }, [clienteId])

  if (!rascunho || !salvo) {
    return (
      <p className="flex items-center gap-2 text-xs text-foreground/50">
        <Loader2 className="h-3.5 w-3.5 animate-spin" /> Carregando…
      </p>
    )
  }

  const sujo = !IGUAIS(rascunho, salvo)

  const guardar = async () => {
    setSalvando(true)
    try {
      const novo = await gestaoClientes.salvarPortalJornada(clienteId, rascunho)
      setSalvo(novo)
      setRascunho(novo)
      toast.success('Opções do portal salvas')
    } catch (err) {
      toast.error('Falha ao salvar: ' + (err as Error).message)
    } finally {
      setSalvando(false)
    }
  }

  return (
    <div className="mt-4 border-t border-line pt-4">
      <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-foreground">"Nossa jornada" no portal</h3>
        <Button
          variant="secondary"
          size="sm"
          leftIcon={<Eye className="h-3.5 w-3.5" />}
          disabled={sujo}
          title={sujo ? 'Salve as opções primeiro — a prévia mostra o que está salvo' : undefined}
          onClick={() => setPreviaAberta(true)}
        >
          Ver como o cliente vê
        </Button>
      </div>
      <p className="mb-2 text-xs text-foreground/50">
        Desligado por padrão. Ligado, o cliente vê o ponto A (só os números), as metas de 6 e 12 meses e o gráfico de
        realizado × projeção, com o realizado dos meses de relatório já publicado.
      </p>
      <label className="flex cursor-pointer items-center gap-2 text-sm text-foreground/85">
        <input
          type="checkbox"
          checked={rascunho.ativo}
          onChange={(e) => setRascunho((r) => (r ? { ...r, ativo: e.target.checked } : r))}
          className="h-4 w-4 rounded border-line"
        />
        Mostrar "Nossa jornada" no portal deste cliente
      </label>
      <div className={cn('ml-6 mt-2 space-y-1.5', !rascunho.ativo && 'opacity-45')}>
        <label className="flex cursor-pointer items-center gap-2 text-sm text-foreground/75">
          <input
            type="checkbox"
            disabled={!rascunho.ativo}
            checked={rascunho.mostrar_situacao}
            onChange={(e) => setRascunho((r) => (r ? { ...r, mostrar_situacao: e.target.checked } : r))}
            className="h-3.5 w-3.5 rounded border-line"
          />
          Mostrar o texto "situação de hoje"
        </label>
        <label className="flex cursor-pointer items-center gap-2 text-sm text-foreground/75">
          <input
            type="checkbox"
            disabled={!rascunho.ativo}
            checked={rascunho.mostrar_objetivo}
            onChange={(e) => setRascunho((r) => (r ? { ...r, mostrar_objetivo: e.target.checked } : r))}
            className="h-3.5 w-3.5 rounded border-line"
          />
          Mostrar o texto "onde quer chegar" de cada cenário
        </label>
        <p className="flex items-center gap-1 text-xs text-foreground/45">
          <Lock className="h-3 w-3" /> Estratégia e premissas nunca vão pro portal.
        </p>
      </div>
      <div className="mt-3 flex items-center gap-2">
        <Button size="sm" loading={salvando} disabled={!sujo} onClick={() => void guardar()}>
          Salvar opções do portal
        </Button>
        {sujo && (
          <Button size="sm" variant="ghost" onClick={() => setRascunho(salvo)}>
            Descartar
          </Button>
        )}
      </div>
      <PreviaPortal aberto={previaAberta} clienteId={clienteId} onFechar={() => setPreviaAberta(false)} />
    </div>
  )
}
