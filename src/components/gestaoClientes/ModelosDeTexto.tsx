import * as React from 'react'
import { ArrowDown, ArrowUp, FileText, Plus, Power, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/Button'
import { Input, Textarea } from '@/components/ui/Input'
import { Modal } from '@/components/ui/Modal'
import { gestaoClientes, type GcCampoModelo, type GcModeloTexto } from '@/services/gestaoClientes'
import { VARIAVEIS_DE_MODELO } from '@/lib/gcPlanejamento'
import { useOutsideClose } from '@/hooks/useOutsideClose'
import { cn } from '@/lib/utils'

export const ROTULO_DO_CAMPO: Record<GcCampoModelo, string> = {
  situacao: 'Situação de hoje',
  objetivo: 'Onde quer chegar',
  estrategia: 'Estratégia',
  premissas: 'Premissas',
}

/**
 * "Preencher com modelo ▾" — fica ao lado do rótulo de um texto do planejamento.
 *
 * Se o campo JÁ TEM texto, aplicar um modelo pergunta antes: substituir ou acrescentar. Sobrescrever
 * em silêncio é como se perde um texto escrito com cuidado por um clique no lugar errado.
 */
export function SeletorDeModelo({
  campo,
  modelos,
  textoAtual,
  onAplicar,
  onGerenciar,
}: {
  campo: GcCampoModelo
  modelos: GcModeloTexto[]
  textoAtual: string
  /** `modo` só importa quando o campo já tinha texto. */
  onAplicar: (texto: string, modo: 'substituir' | 'acrescentar') => void
  onGerenciar: () => void
}) {
  const [aberto, setAberto] = React.useState(false)
  const [escolhido, setEscolhido] = React.useState<GcModeloTexto | null>(null)
  const ref = React.useRef<HTMLDivElement>(null)
  useOutsideClose(ref, aberto, () => {
    setAberto(false)
    setEscolhido(null)
  })
  const doCampo = modelos.filter((m) => m.campo === campo)
  const temTexto = textoAtual.trim().length > 0

  const aplicar = (m: GcModeloTexto, modo: 'substituir' | 'acrescentar') => {
    onAplicar(m.texto, modo)
    setAberto(false)
    setEscolhido(null)
  }

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setAberto((a) => !a)}
        className="flex items-center gap-1 text-[11px] text-foreground/50 transition-colors hover:text-accent"
      >
        <FileText className="h-3 w-3" /> preencher com modelo
      </button>
      {aberto && (
        <div className="absolute right-0 z-30 mt-1 w-72 rounded-xl border border-line bg-surface p-1.5 shadow-lg">
          {escolhido ? (
            <div className="p-2">
              <p className="text-xs text-foreground/70">
                O campo já tem texto. Com o modelo <strong className="text-foreground">{escolhido.nome}</strong>:
              </p>
              <div className="mt-2 flex flex-col gap-1.5">
                <Button size="sm" variant="secondary" onClick={() => aplicar(escolhido, 'acrescentar')}>
                  Acrescentar no final
                </Button>
                <Button size="sm" variant="ghost" onClick={() => aplicar(escolhido, 'substituir')}>
                  Substituir o que está escrito
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setEscolhido(null)}>
                  Voltar
                </Button>
              </div>
            </div>
          ) : (
            <>
              {doCampo.length === 0 && (
                <p className="px-2 py-3 text-center text-xs text-foreground/45">
                  Nenhum modelo de "{ROTULO_DO_CAMPO[campo].toLowerCase()}" ainda.
                </p>
              )}
              {doCampo.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => (temTexto ? setEscolhido(m) : aplicar(m, 'substituir'))}
                  className="block w-full rounded-lg px-2.5 py-2 text-left transition-colors hover:bg-elevate/[0.05]"
                >
                  <span className="block text-sm font-medium text-foreground">{m.nome}</span>
                  <span className="block truncate text-[11px] text-foreground/45">{m.texto.split('\n')[0]}</span>
                </button>
              ))}
              <div className="mt-1 border-t border-line pt-1">
                <button
                  type="button"
                  onClick={() => {
                    setAberto(false)
                    onGerenciar()
                  }}
                  className="w-full rounded-lg px-2.5 py-1.5 text-left text-xs text-foreground/55 hover:bg-elevate/[0.05] hover:text-foreground"
                >
                  Gerenciar modelos…
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}

/** Um modelo editável na janela de gestão. Salva ao sair do campo, sem botão "salvar" por linha. */
function LinhaDeModelo({
  modelo,
  primeiro,
  ultimo,
  onMudou,
  onMover,
}: {
  modelo: GcModeloTexto
  primeiro: boolean
  ultimo: boolean
  onMudou: () => Promise<void> | void
  onMover: (delta: -1 | 1) => void
}) {
  const [nome, setNome] = React.useState(modelo.nome)
  const [texto, setTexto] = React.useState(modelo.texto)
  React.useEffect(() => {
    setNome(modelo.nome)
    setTexto(modelo.texto)
  }, [modelo.nome, modelo.texto])

  const salvar = async (dados: Partial<Pick<GcModeloTexto, 'nome' | 'texto' | 'ativo'>>) => {
    try {
      await gestaoClientes.atualizarModeloTexto(modelo.id, dados)
      await onMudou()
    } catch (err) {
      toast.error('Falha ao salvar: ' + (err as Error).message)
    }
  }

  return (
    <div className={cn('rounded-xl border border-line p-3', !modelo.ativo && 'opacity-55')}>
      <div className="flex items-center gap-2">
        <input
          value={nome}
          onChange={(e) => setNome(e.target.value)}
          onBlur={() => {
            if (nome.trim() && nome !== modelo.nome) void salvar({ nome })
            else setNome(modelo.nome)
          }}
          className="h-8 min-w-0 flex-1 rounded-md border border-transparent bg-transparent px-1.5 text-sm font-medium text-foreground outline-none hover:border-line focus:border-accent/60"
          aria-label="Nome do modelo"
        />
        <button
          type="button"
          disabled={primeiro}
          onClick={() => onMover(-1)}
          className="p-1 text-foreground/35 hover:text-foreground disabled:opacity-30"
          aria-label="Subir"
        >
          <ArrowUp className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          disabled={ultimo}
          onClick={() => onMover(1)}
          className="p-1 text-foreground/35 hover:text-foreground disabled:opacity-30"
          aria-label="Descer"
        >
          <ArrowDown className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          onClick={() => void salvar({ ativo: !modelo.ativo })}
          className="p-1 text-foreground/35 hover:text-foreground"
          title={modelo.ativo ? 'Desativar (some do seletor)' : 'Reativar'}
          aria-label={modelo.ativo ? 'Desativar' : 'Reativar'}
        >
          <Power className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          onClick={async () => {
            try {
              await gestaoClientes.excluirModeloTexto(modelo.id)
              await onMudou()
            } catch (err) {
              toast.error('Falha ao excluir: ' + (err as Error).message)
            }
          }}
          className="p-1 text-foreground/35 hover:text-danger"
          aria-label="Excluir modelo"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>
      <Textarea
        rows={4}
        value={texto}
        onChange={(e) => setTexto(e.target.value)}
        onBlur={() => {
          if (texto !== modelo.texto) void salvar({ texto })
        }}
        className="mt-1.5 font-mono text-xs"
      />
    </div>
  )
}

/**
 * Janela de gestão dos modelos de texto: criar, editar, reordenar, desativar e excluir.
 *
 * Modelo é texto de apoio, sem referência de ninguém: o que já foi aplicado num planejamento é
 * CÓPIA e continua lá se o modelo for editado ou apagado. Por isso dá pra excluir de verdade.
 */
export function ModalModelosTexto({
  aberto,
  campoInicial,
  onFechar,
  onMudou,
}: {
  aberto: boolean
  campoInicial: GcCampoModelo
  onFechar: () => void
  /** Chamado quando algo mudou, pra o editor recarregar os modelos do seletor. */
  onMudou: () => Promise<void> | void
}) {
  const [campo, setCampo] = React.useState<GcCampoModelo>(campoInicial)
  const [modelos, setModelos] = React.useState<GcModeloTexto[]>([])
  const [novoNome, setNovoNome] = React.useState('')

  React.useEffect(() => {
    if (aberto) setCampo(campoInicial)
  }, [aberto, campoInicial])

  const carregar = React.useCallback(async () => {
    try {
      setModelos(await gestaoClientes.modelosTexto(true))
    } catch (err) {
      toast.error('Falha ao carregar os modelos: ' + (err as Error).message)
    }
  }, [])

  React.useEffect(() => {
    if (aberto) void carregar()
  }, [aberto, carregar])

  const doCampo = modelos.filter((m) => m.campo === campo)

  const mudou = async () => {
    await carregar()
    await onMudou()
  }

  const mover = async (indice: number, delta: -1 | 1) => {
    const alvo = indice + delta
    if (alvo < 0 || alvo >= doCampo.length) return
    const ids = doCampo.map((m) => m.id)
    ;[ids[indice], ids[alvo]] = [ids[alvo], ids[indice]]
    try {
      await gestaoClientes.ordenarModelosTexto(campo, ids)
      await mudou()
    } catch (err) {
      toast.error('Falha ao reordenar: ' + (err as Error).message)
    }
  }

  const criar = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!novoNome.trim()) return
    try {
      await gestaoClientes.criarModeloTexto({ campo, nome: novoNome.trim(), texto: '' })
      setNovoNome('')
      await mudou()
    } catch (err) {
      toast.error('Falha ao criar: ' + (err as Error).message)
    }
  }

  return (
    <Modal
      open={aberto}
      onClose={onFechar}
      size="xl"
      title="Modelos de texto do planejamento"
      description="Pontos de partida pra preencher os campos de texto. Edite à vontade — o que já foi aplicado num cliente não muda."
    >
      <div className="mb-3 flex flex-wrap gap-1">
        {(Object.keys(ROTULO_DO_CAMPO) as GcCampoModelo[]).map((c) => (
          <button
            key={c}
            type="button"
            onClick={() => setCampo(c)}
            aria-pressed={campo === c}
            className={cn(
              'rounded-lg border px-3 py-1.5 text-sm transition-colors',
              campo === c ? 'border-accent/40 bg-accent/10 text-foreground' : 'border-line text-foreground/55 hover:text-foreground',
            )}
          >
            {ROTULO_DO_CAMPO[c]}
            <span className="ml-1.5 text-xs text-foreground/40">{modelos.filter((m) => m.campo === c).length}</span>
          </button>
        ))}
      </div>

      <div className="mb-3 rounded-lg border border-line bg-elevate/[0.02] px-3 py-2 text-xs text-foreground/60">
        <p className="mb-1 font-medium text-foreground/75">Variáveis que o texto pode usar</p>
        <p className="leading-relaxed">
          {VARIAVEIS_DE_MODELO.map((v) => (
            <span key={v.nome} title={v.ajuda} className="mr-2 inline-block">
              <code className="rounded bg-elevate/[0.08] px-1">{`{${v.nome}}`}</code>
            </span>
          ))}
        </p>
        <p className="mt-1 text-foreground/45">
          Trocadas pelos dados do cliente ao aplicar. Se o dado não existe, a variável fica no texto pra você preencher.
        </p>
      </div>

      <div className="max-h-[48vh] space-y-2 overflow-y-auto pr-1">
        {doCampo.length === 0 && <p className="py-6 text-center text-sm text-foreground/45">Nenhum modelo neste campo.</p>}
        {doCampo.map((m, i) => (
          <LinhaDeModelo
            key={m.id}
            modelo={m}
            primeiro={i === 0}
            ultimo={i === doCampo.length - 1}
            onMudou={mudou}
            onMover={(d) => void mover(i, d)}
          />
        ))}
      </div>

      <form onSubmit={criar} className="mt-3 flex items-center gap-2 border-t border-line pt-3">
        <Input
          value={novoNome}
          onChange={(e) => setNovoNome(e.target.value)}
          placeholder={`Nome do novo modelo de "${ROTULO_DO_CAMPO[campo].toLowerCase()}"`}
          containerClassName="flex-1"
        />
        <Button type="submit" variant="secondary" leftIcon={<Plus className="h-4 w-4" />} disabled={!novoNome.trim()}>
          Criar
        </Button>
      </form>
    </Modal>
  )
}
