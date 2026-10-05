import * as React from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, Loader2, Pencil, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { TopBar } from '@/components/layout/TopBar'
import { Button } from '@/components/ui/Button'
import { Tabs } from '@/components/ui/Tabs'
import { Modal } from '@/components/ui/Modal'
import { ModalCliente } from '@/components/gestaoClientes/ModalCliente'
import { AbaVisaoGeral } from '@/components/gestaoClientes/AbaVisaoGeral'
import { AbaJornada } from '@/components/gestaoClientes/AbaJornada'
import { AbaNotas } from '@/components/gestaoClientes/AbaNotas'
import { AbaMetricas } from '@/components/gestaoClientes/AbaMetricas'
import { AbaEstrategias } from '@/components/gestaoClientes/AbaEstrategias'
import { AbaRelatorios } from '@/components/gestaoClientes/AbaRelatorios'
import { gestaoClientes, type GcClienteDetalhe } from '@/services/gestaoClientes'

type Aba = 'visao' | 'jornada' | 'metricas' | 'estrategias' | 'relatorios' | 'notas'

/**
 * Detalhe do cliente de tráfego — Visão geral, Jornada e Histórico.
 *
 * Tudo vem de uma chamada só (/api/gc/clientes/:id) e, depois de qualquer ação, a página refaz
 * essa chamada: marcar um item do checklist pode fechar a etapa e abrir a próxima do lado do
 * servidor, então o estado que vale é sempre o que ele devolveu — não o que a tela adivinhou.
 */
export function ClienteNxDetalhePage() {
  const { id = '' } = useParams<{ id: string }>()
  const navegar = useNavigate()
  const [detalhe, setDetalhe] = React.useState<GcClienteDetalhe | null>(null)
  const [carregando, setCarregando] = React.useState(true)
  const [aba, setAba] = React.useState<Aba>('visao')
  const [editando, setEditando] = React.useState(false)
  const [confirmandoExclusao, setConfirmandoExclusao] = React.useState(false)
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
                Excluir
              </Button>
              <Button
                variant="secondary"
                size="sm"
                leftIcon={<Pencil className="h-4 w-4" />}
                onClick={() => setEditando(true)}
              >
                Editar cliente
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
          <div className="flex items-center justify-center gap-2 py-16 text-sm text-foreground/60">
            <Loader2 className="h-4 w-4 animate-spin" /> Carregando…
          </div>
        ) : !detalhe ? (
          <p className="py-16 text-center text-sm text-foreground/60">Cliente não encontrado.</p>
        ) : (
          <>
            <Tabs
              value={aba}
              onChange={(v) => setAba(v as Aba)}
              items={[
                { value: 'visao', label: 'Visão geral' },
                {
                  value: 'jornada',
                  label: (
                    <span className="flex items-center gap-1.5">
                      Jornada
                      <span className="text-xs tabular-nums text-foreground/45">
                        {detalhe.jornada.filter((j) => j.status === 'concluida').length}/
                        {detalhe.jornada.length}
                      </span>
                    </span>
                  ),
                },
                { value: 'metricas', label: 'Métricas e metas' },
                {
                  value: 'estrategias',
                  label: (
                    <span className="flex items-center gap-1.5">
                      Estratégias
                      <span className="text-xs tabular-nums text-foreground/45">
                        {detalhe.estrategias.length}
                      </span>
                    </span>
                  ),
                },
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

            {aba === 'visao' && (
              <AbaVisaoGeral
                detalhe={detalhe}
                onMudou={carregar}
                onVerNotas={() => setAba('notas')}
              />
            )}
            {aba === 'jornada' && <AbaJornada jornada={detalhe.jornada} onMudou={carregar} />}
            {aba === 'metricas' && <AbaMetricas clienteId={id} />}
            {aba === 'relatorios' && <AbaRelatorios detalhe={detalhe} />}
            {aba === 'estrategias' && (
              <AbaEstrategias estrategias={detalhe.estrategias} clienteId={id} onMudou={carregar} />
            )}
            {aba === 'notas' && (
              <AbaNotas historico={detalhe.historico} clienteId={id} onMudou={carregar} />
            )}
          </>
        )}
      </div>

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
