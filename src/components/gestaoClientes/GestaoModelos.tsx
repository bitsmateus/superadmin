import * as React from 'react'
import { ArrowDown, ArrowUp, ChevronDown, Lightbulb, Plus, Power, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/Button'
import { Input, Textarea } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
import { Badge } from '@/components/ui/Badge'
import { Modal } from '@/components/ui/Modal'
import { EmptyState } from '@/components/ui/EmptyState'
import { EsqueletoDeCarga } from '@/components/gestaoClientes/EsqueletoDeCarga'
import {
  TIPOS_SERVICO, gestaoClientes, type GcModeloEstrategia,
} from '@/services/gestaoClientes'
import { cn } from '@/lib/utils'

const OPCOES_TIPO = [
  { value: '', label: '— qualquer serviço —' },
  ...TIPOS_SERVICO.map((t) => ({ value: t.valor, label: t.label })),
]

/** Janela de criar/editar o cabeçalho de um modelo (nome, descrição, serviço). */
function ModalModelo({
  aberto,
  modelo,
  onFechar,
  onSalvo,
}: {
  aberto: boolean
  /** Null = criando. */
  modelo: GcModeloEstrategia | null
  onFechar: () => void
  onSalvo: () => void
}) {
  const [nome, setNome] = React.useState('')
  const [descricao, setDescricao] = React.useState('')
  const [tipo, setTipo] = React.useState('')
  const [passos, setPassos] = React.useState('')
  const [salvando, setSalvando] = React.useState(false)

  React.useEffect(() => {
    if (!aberto) return
    setNome(modelo?.nome ?? '')
    setDescricao(modelo?.descricao ?? '')
    setTipo(modelo?.servico_tipo ?? '')
    setPassos('')
  }, [aberto, modelo])

  const salvar = async () => {
    if (!nome.trim()) {
      toast.error('Dê um nome pra estratégia')
      return
    }
    setSalvando(true)
    try {
      if (modelo) {
        await gestaoClientes.atualizarModeloEstrategia(modelo.id, {
          nome, descricao, servico_tipo: tipo || null,
        })
      } else {
        await gestaoClientes.criarModeloEstrategia({
          nome,
          descricao,
          servico_tipo: tipo || null,
          // Um passo por linha — é mais rápido que adicionar um a um depois.
          passos: passos.split('\n').map((p) => p.trim()).filter(Boolean),
        })
      }
      toast.success(modelo ? 'Modelo atualizado' : 'Modelo criado')
      onSalvo()
      onFechar()
    } catch (err) {
      toast.error('Falha ao salvar: ' + (err as Error).message)
    } finally {
      setSalvando(false)
    }
  }

  return (
    <Modal
      open={aberto}
      onClose={onFechar}
      size="lg"
      title={modelo ? 'Editar modelo de estratégia' : 'Novo modelo de estratégia'}
      description={
        modelo
          ? 'Mudar o modelo não altera as estratégias que já foram aplicadas nos clientes.'
          : undefined
      }
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onFechar}>
            Cancelar
          </Button>
          <Button loading={salvando} onClick={salvar}>
            {modelo ? 'Salvar' : 'Criar modelo'}
          </Button>
        </div>
      }
    >
      <div className="space-y-3">
        <Input label="Nome" value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Ex.: Campanha de inverno" />
        <Select label="Serviço" options={OPCOES_TIPO} value={tipo} onChange={(e) => setTipo(e.target.value)} />
        <Textarea
          label="Descrição"
          rows={2}
          value={descricao}
          onChange={(e) => setDescricao(e.target.value)}
          placeholder="Pra que serve essa estratégia"
        />
        {!modelo && (
          <Textarea
            label="Passos (um por linha)"
            rows={5}
            value={passos}
            onChange={(e) => setPassos(e.target.value)}
            placeholder={'Definir público e região\nProduzir 3 criativos\nSubir campanha'}
          />
        )}
      </div>
    </Modal>
  )
}

/** Um modelo, com seus passos editáveis na própria linha. */
function CartaoModelo({
  modelo,
  onMudou,
  onEditar,
}: {
  modelo: GcModeloEstrategia
  onMudou: () => Promise<void> | void
  onEditar: () => void
}) {
  const [aberto, setAberto] = React.useState(false)
  const [novoPasso, setNovoPasso] = React.useState('')
  const [editando, setEditando] = React.useState<string | null>(null)
  const [textoEditado, setTextoEditado] = React.useState('')
  const rotuloServico = modelo.servico_tipo
    ? TIPOS_SERVICO.find((t) => t.valor === modelo.servico_tipo)?.label ?? modelo.servico_tipo
    : null
  const passos = [...modelo.passos].sort((a, b) => a.ordem - b.ordem)

  const agir = async (fn: () => Promise<unknown>) => {
    try {
      await fn()
      await onMudou()
    } catch (err) {
      toast.error('Falha ao salvar: ' + (err as Error).message)
    }
  }

  const mover = (indice: number, delta: -1 | 1) => {
    const alvo = indice + delta
    if (alvo < 0 || alvo >= passos.length) return
    const ids = passos.map((p) => p.id)
    ;[ids[indice], ids[alvo]] = [ids[alvo], ids[indice]]
    void agir(() => gestaoClientes.ordenarPassosDeModelo(modelo.id, ids))
  }

  return (
    <div className={cn('overflow-hidden rounded-xl border border-line', !modelo.ativo && 'opacity-60')}>
      <div className="flex items-center gap-3 px-4 py-3">
        <button
          type="button"
          onClick={() => setAberto((a) => !a)}
          className="flex min-w-0 flex-1 items-center gap-3 text-left"
        >
          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-accent/10 text-accent">
            <Lightbulb className="h-4 w-4" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate font-medium text-foreground">{modelo.nome}</span>
            <span className="block truncate text-xs text-foreground/50">
              {modelo.descricao || 'sem descrição'} · {passos.length} passos
            </span>
          </span>
          {rotuloServico && <Badge tone="info">{rotuloServico}</Badge>}
          {!modelo.ativo && <Badge tone="neutral">desativado</Badge>}
          <ChevronDown
            className={cn('h-4 w-4 shrink-0 text-foreground/40 transition-transform', aberto ? '' : '-rotate-90')}
          />
        </button>
      </div>

      {aberto && (
        <div className="border-t border-line bg-elevate/[0.015] px-4 py-3">
          <ol className="space-y-1">
            {passos.map((p, i) => (
              <li key={p.id} className="group flex items-center gap-2">
                <span className="w-5 shrink-0 text-right text-xs tabular-nums text-foreground/35">{i + 1}.</span>
                {editando === p.id ? (
                  <input
                    autoFocus
                    value={textoEditado}
                    onChange={(e) => setTextoEditado(e.target.value)}
                    onBlur={() => {
                      const novo = textoEditado.trim()
                      setEditando(null)
                      if (novo && novo !== p.titulo) {
                        void agir(() => gestaoClientes.renomearPassoDeModelo(p.id, novo))
                      }
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
                      if (e.key === 'Escape') setEditando(null)
                    }}
                    className="h-7 flex-1 rounded-md border border-accent/50 bg-surface px-2 text-sm text-foreground outline-none"
                  />
                ) : (
                  <button
                    type="button"
                    onClick={() => {
                      setEditando(p.id)
                      setTextoEditado(p.titulo)
                    }}
                    className="min-w-0 flex-1 truncate text-left text-sm text-foreground/85 hover:text-accent"
                    title="Clique pra renomear"
                  >
                    {p.titulo}
                  </button>
                )}
                <span className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
                  <button
                    type="button"
                    disabled={i === 0}
                    onClick={() => mover(i, -1)}
                    className="p-1 text-foreground/35 hover:text-foreground disabled:opacity-30"
                    aria-label="Subir passo"
                  >
                    <ArrowUp className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    disabled={i === passos.length - 1}
                    onClick={() => mover(i, 1)}
                    className="p-1 text-foreground/35 hover:text-foreground disabled:opacity-30"
                    aria-label="Descer passo"
                  >
                    <ArrowDown className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => void agir(() => gestaoClientes.excluirPassoDeModelo(p.id))}
                    className="p-1 text-foreground/35 hover:text-danger"
                    aria-label="Excluir passo"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </span>
              </li>
            ))}
            {passos.length === 0 && <li className="text-sm text-foreground/45">Nenhum passo ainda.</li>}
          </ol>

          <form
            className="mt-3 flex items-center gap-2"
            onSubmit={(e) => {
              e.preventDefault()
              const titulo = novoPasso.trim()
              if (!titulo) return
              void agir(async () => {
                await gestaoClientes.criarPassoDeModelo(modelo.id, titulo)
                setNovoPasso('')
              })
            }}
          >
            <Input
              value={novoPasso}
              onChange={(e) => setNovoPasso(e.target.value)}
              placeholder="Adicionar passo"
              containerClassName="flex-1"
            />
            <Button type="submit" variant="secondary" size="sm" leftIcon={<Plus className="h-3.5 w-3.5" />}>
              Adicionar
            </Button>
          </form>

          <div className="mt-3 flex items-center gap-2 border-t border-line pt-3">
            <Button variant="ghost" size="sm" onClick={onEditar}>
              Editar nome e descrição
            </Button>
            <Button
              variant="ghost"
              size="sm"
              leftIcon={<Power className="h-3.5 w-3.5" />}
              onClick={() =>
                void agir(() => gestaoClientes.atualizarModeloEstrategia(modelo.id, { ativo: !modelo.ativo }))
              }
            >
              {modelo.ativo ? 'Desativar' : 'Reativar'}
            </Button>
            <span className="text-xs text-foreground/40">
              {modelo.ativo
                ? 'Desativado some dos seletores; o que já foi aplicado continua.'
                : 'Não aparece pra aplicar nos clientes.'}
            </span>
          </div>
        </div>
      )}
    </div>
  )
}

/**
 * Catálogo de modelos de estratégia: criar, editar passos e desativar.
 *
 * Aplicar um modelo num cliente COPIA nome e passos — por isso editar aqui é seguro (não reescreve o
 * que já está rodando) e não existe "excluir": o que não serve mais é desativado.
 */
export function GestaoModelos({
  clientes,
  onAbrirCliente,
}: {
  clientes: { id: string; nome_empresa: string }[]
  onAbrirCliente: (id: string) => void
}) {
  const [modelos, setModelos] = React.useState<GcModeloEstrategia[]>([])
  const [carregando, setCarregando] = React.useState(true)
  const [janela, setJanela] = React.useState<{ aberta: boolean; modelo: GcModeloEstrategia | null }>({
    aberta: false,
    modelo: null,
  })

  const carregar = React.useCallback(async () => {
    try {
      setModelos((await gestaoClientes.modelos(true)).estrategias)
    } catch (err) {
      toast.error('Falha ao carregar os modelos: ' + (err as Error).message)
    } finally {
      setCarregando(false)
    }
  }, [])

  React.useEffect(() => {
    void carregar()
  }, [carregar])

  if (carregando) return null

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-foreground/60">
          Aplicar uma estratégia é feito dentro do cliente, na aba Estratégias dele. Aqui você cria e
          ajusta os modelos.
        </p>
        <Button size="sm" leftIcon={<Plus className="h-4 w-4" />} onClick={() => setJanela({ aberta: true, modelo: null })}>
          Novo modelo
        </Button>
      </div>

      {carregando ? (
        <EsqueletoDeCarga tipo="lista" linhas={4} />
      ) : modelos.length === 0 ? (
        <EmptyState
          icon={<Lightbulb className="h-6 w-6" />}
          title="Nenhum modelo de estratégia"
          description="Crie o primeiro pra poder aplicar nos clientes."
        />
      ) : (
        <div className="space-y-2">
          {modelos.map((m) => (
            <CartaoModelo
              key={m.id}
              modelo={m}
              onMudou={carregar}
              onEditar={() => setJanela({ aberta: true, modelo: m })}
            />
          ))}
        </div>
      )}

      {clientes.length > 0 && (
        <section className="rounded-xl border border-line p-4">
          <h2 className="mb-2 text-sm font-semibold text-foreground">Aplicar em qual cliente?</h2>
          <div className="flex flex-wrap gap-2">
            {clientes.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => onAbrirCliente(c.id)}
                className="rounded-lg border border-line px-3 py-1.5 text-sm text-foreground/80 transition-colors hover:border-accent/40 hover:text-foreground"
              >
                {c.nome_empresa}
              </button>
            ))}
          </div>
        </section>
      )}

      <ModalModelo
        aberto={janela.aberta}
        modelo={janela.modelo}
        onFechar={() => setJanela({ aberta: false, modelo: null })}
        onSalvo={() => void carregar()}
      />
    </div>
  )
}
