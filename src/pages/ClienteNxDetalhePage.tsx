import * as React from 'react'
import { useModuloNxNoCelular } from '@/hooks/useModuloNxNoCelular'
import { useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, Loader2, MessageSquare, Pencil, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { TopBar } from '@/components/layout/TopBar'
import { Button } from '@/components/ui/Button'
import { Tabs } from '@/components/ui/Tabs'
import { Modal } from '@/components/ui/Modal'
import { ModalCliente } from '@/components/gestaoClientes/ModalCliente'
import { AbaVisaoGeral } from '@/components/gestaoClientes/AbaVisaoGeral'
import { ModalNotas, PainelNotas } from '@/components/gestaoClientes/PainelNotas'
import { AbaMetricas } from '@/components/gestaoClientes/AbaMetricas'
import { EsqueletoDeCarga } from '@/components/gestaoClientes/EsqueletoDeCarga'
import { AbaPlanejamento } from '@/components/gestaoClientes/AbaPlanejamento'
import { AbaEstrategias } from '@/components/gestaoClientes/AbaEstrategias'
import { AbaRelatorios } from '@/components/gestaoClientes/AbaRelatorios'
import { gestaoClientes, type GcClienteDetalhe } from '@/services/gestaoClientes'
import type { Destino } from '@/lib/gcSaude'

type Aba = 'visao' | 'metricas' | 'planejamento' | 'estrategias' | 'relatorios' | 'notas'

/**
 * Detalhe do cliente de tráfego — Visão geral, Jornada e Histórico.
 *
 * Tudo vem de uma chamada só (/api/gc/clientes/:id) e, depois de qualquer ação, a página refaz
 * essa chamada: marcar um item do checklist pode fechar a etapa e abrir a próxima do lado do
 * servidor, então o estado que vale é sempre o que ele devolveu — não o que a tela adivinhou.
 */
export function ClienteNxDetalhePage() {
  useModuloNxNoCelular()
  const { id = '' } = useParams<{ id: string }>()
  const navegar = useNavigate()
  const [detalhe, setDetalhe] = React.useState<GcClienteDetalhe | null>(null)
  const [carregando, setCarregando] = React.useState(true)
  const [aba, setAba] = React.useState<Aba>('visao')
  const [editando, setEditando] = React.useState(false)
  const [confirmandoExclusao, setConfirmandoExclusao] = React.useState(false)
  const [notasAbertas, setNotasAbertas] = React.useState(false)
  const [excluindo, setExcluindo] = React.useState(false)
  const carregar = React.useCallback(async () => {
    try {
      setDetalhe(await gestaoClientes.detalhe(id))
    } catch (err) {
      toast.error('Falha ao carregar o cliente: ' + (err as Error).message)
    } finally {
      setCarregando(false)
    }
  }, [id])

  React.useEffect(() => {
    void carregar()
  }, [carregar])

  /**
   * Leva pro lugar onde o sinal do semáforo se resolve. Os que moram na própria Visão geral
   * (avaliação, serviços) rolam até o bloco e o destacam por um instante; os outros trocam de aba
   * ou abrem a janela certa.
   */
  const irPara = (destino: Destino) => {
    switch (destino) {
      case 'metricas':
      case 'planejamento':
      case 'relatorios':
        setAba(destino)
        window.scrollTo({ top: 0, behavior: 'smooth' })
        return
      case 'notas':
        setNotasAbertas(true)
        return
      case 'editar':
        setEditando(true)
        return
      case 'avaliacao':
      case 'servicos': {
        setAba('visao')
        // Espera a aba montar antes de procurar o bloco — ao vir de outra aba ele ainda não existe.
        window.setTimeout(() => {
          const alvo = document.getElementById(destino === 'avaliacao' ? 'gc-avaliacao' : 'gc-servicos')
          if (!alvo) return
          alvo.scrollIntoView({ behavior: 'smooth', block: 'center' })
          alvo.classList.add('ring-2', 'ring-accent/60')
          window.setTimeout(() => alvo.classList.remove('ring-2', 'ring-accent/60'), 1600)
        }, 60)
        return
      }
    }
  }

  const excluir = async () => {
    setExcluindo(true)
    try {
      await gestaoClientes.excluir(id)
      toast.success('Cliente excluído')
      navegar('/clientesnxdigital/clientes')
    } catch (err) {
      toast.error('Falha ao excluir: ' + (err as Error).message)
      setExcluindo(false)
    }
  }

  const nome = detalhe?.cliente.nome_empresa ?? 'Cliente'

  return (
    <>
      <TopBar
        compacto
        title={nome}
        subtitle="Clientes NX Digital"
        breadcrumbs={[
          { label: 'Grupo NX Digital', to: '/' },
          { label: 'Clientes', to: '/clientesnxdigital/clientes' },
          { label: nome },
        ]}
        rightSlot={
          detalhe ? (
            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                size="sm"
                leftIcon={<Trash2 className="h-4 w-4" />}
                onClick={() => setConfirmandoExclusao(true)}
              >
                <span className="hidden sm:inline">Excluir</span>
              </Button>
              <Button
                variant="ghost"
                size="sm"
                leftIcon={<MessageSquare className="h-4 w-4" />}
                onClick={() => setNotasAbertas(true)}
              >
                <span className="hidden sm:inline">Notas</span>
              </Button>
              <Button
                variant="secondary"
                size="sm"
                leftIcon={<Pencil className="h-4 w-4" />}
                onClick={() => setEditando(true)}
              >
                <span className="hidden sm:inline">Editar cliente</span>
              </Button>
            </div>
          ) : undefined
        }
      />

      <div className="space-y-4 px-4 pb-10 lg:px-6">
        <button
          type="button"
          onClick={() => navegar('/clientesnxdigital/clientes')}
          className="flex items-center gap-1.5 text-sm text-foreground/55 transition-colors hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" /> Voltar para a lista
        </button>

        {carregando ? (
          <EsqueletoDeCarga tipo="ficha" />
        ) : !detalhe ? (
          <p className="py-16 text-center text-sm text-foreground/60">Cliente não encontrado.</p>
        ) : (
          <>
            {/* Abas fixas logo abaixo da barra do topo: trocar de aba não exige voltar ao início da página. */}
            <div className="sticky top-[57px] z-10 -mx-4 bg-bg/95 px-4 backdrop-blur lg:-mx-6 lg:px-6">
            <Tabs
              value={aba}
              onChange={(v) => setAba(v as Aba)}
              items={[
                { value: 'visao', label: 'Visão geral' },
                { value: 'planejamento', label: 'Planejamento' },
                { value: 'metricas', label: 'Métricas' },
                // Só existe pra quem ainda tem estratégia com passos (a de hoje agora mora no Planejamento).
                ...(detalhe.estrategias.length > 0
                  ? [
                    {
                  value: 'estrategias',
                  // O contador some quando é zero: "Estratégias 0" só ocupa espaço.
                  label: (
                    <span className="flex items-center gap-1.5">
                      Estratégias
                      {detalhe.estrategias.length > 0 && (
                        <span className="text-xs tabular-nums text-foreground/45">
                          {detalhe.estrategias.length}
                        </span>
                      )}
                    </span>
                  ),
                    },
                    ]
                  : []),
                { value: 'relatorios', label: 'Relatórios' },
                {
                  value: 'notas',
                  label: (
                    <span className="flex items-center gap-1.5">
                      Notas e histórico
                      <span className="text-xs tabular-nums text-foreground/45">
                        {detalhe.historico.length}
                      </span>
                    </span>
                  ),
                },
              ]}
            />
            </div>

            {aba === 'visao' && (
              <AbaVisaoGeral
                detalhe={detalhe}
                onMudou={carregar}
                onVerNotas={() => setNotasAbertas(true)}
                onIr={irPara}
                onEditar={() => setEditando(true)}
              />
            )}
            {aba === 'metricas' && <AbaMetricas clienteId={id} />}
            {aba === 'planejamento' && (
              <AbaPlanejamento clienteId={id} cliente={detalhe.cliente} onMudou={carregar} />
            )}
            {aba === 'relatorios' && <AbaRelatorios detalhe={detalhe} />}
            {aba === 'estrategias' && (
              <AbaEstrategias estrategias={detalhe.estrategias} onMudou={carregar} />
            )}
            {aba === 'notas' && (
              <PainelNotas historico={detalhe.historico} clienteId={id} onMudou={carregar} />
            )}
          </>
        )}
      </div>

      {detalhe && (
        <ModalNotas
          aberto={notasAbertas}
          onFechar={() => setNotasAbertas(false)}
          titulo={nome}
          historico={detalhe.historico}
          clienteId={id}
          onMudou={carregar}
        />
      )}

      <ModalCliente
        aberto={editando}
        cliente={detalhe?.cliente ?? null}
        onFechar={() => setEditando(false)}
        onSalvo={() => void carregar()}
      />

      <Modal
        open={confirmandoExclusao}
        onClose={() => setConfirmandoExclusao(false)}
        size="sm"
        title="Excluir este cliente?"
        description="A jornada, o checklist, as métricas e o histórico dele vão junto, e isso não tem como desfazer. Pra tirar o cliente da lista sem perder o histórico, mude o status pra Encerrado."
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setConfirmandoExclusao(false)}>
              Cancelar
            </Button>
            <Button variant="danger" loading={excluindo} onClick={excluir}>
              Excluir mesmo assim
            </Button>
          </div>
        }
      >
        <p className="text-sm text-foreground/70">
          Cliente: <span className="font-medium text-foreground">{nome}</span>
        </p>
      </Modal>
    </>
  )
}
