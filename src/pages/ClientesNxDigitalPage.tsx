import * as React from 'react'
import { useNavigate } from 'react-router-dom'
import { Loader2, Plus, Search, Users } from 'lucide-react'
import { toast } from 'sonner'
import { TopBar } from '@/components/layout/TopBar'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Badge } from '@/components/ui/Badge'
import { EmptyState } from '@/components/ui/EmptyState'
import { Tabs } from '@/components/ui/Tabs'
import { ModalCliente } from '@/components/gestaoClientes/ModalCliente'
import {
  TIPOS_SERVICO, gestaoClientes, progressoDoCliente,
  type GcClienteLista, type GcStatusCliente,
} from '@/services/gestaoClientes'
import { cn } from '@/lib/utils'

const ABAS: { value: GcStatusCliente | 'todos'; label: string }[] = [
  { value: 'ativo', label: 'Ativos' },
  { value: 'pausado', label: 'Pausados' },
  { value: 'encerrado', label: 'Encerrados' },
  { value: 'todos', label: 'Todos' },
]

const TOM_DO_STATUS: Record<GcStatusCliente, 'success' | 'warning' | 'neutral'> = {
  ativo: 'success',
  pausado: 'warning',
  encerrado: 'neutral',
}

function rotuloServico(tipo: string): string {
  return TIPOS_SERVICO.find((t) => t.valor === tipo)?.label ?? tipo
}

/** Barra de progresso do checklist — fina, só pra dar a noção de "quanto falta" na lista. */
function BarraProgresso({ valor }: { valor: number }) {
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-20 overflow-hidden rounded-full bg-elevate/[0.08]">
        <div
          className="h-full rounded-full bg-accent transition-[width]"
          style={{ width: `${valor}%` }}
        />
      </div>
      <span className="text-xs tabular-nums text-foreground/60">{valor}%</span>
    </div>
  )
}

function iniciais(nome: string): string {
  return nome
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? '')
    .join('')
}

/**
 * CLIENTES NX DIGITAL → Clientes.
 *
 * A base de clientes de tráfego: quem é, quem atende, quais serviços tem e em que ponto da jornada
 * está. Cadastro próprio do módulo (tabelas `gc_*`) — não é a mesma lista do Suporte nem a de
 * Clientes Geral do Financeiro, de propósito: aqui o que importa é a entrega, não a cobrança.
 */
export function ClientesNxDigitalPage() {
  const navegar = useNavigate()
  const [clientes, setClientes] = React.useState<GcClienteLista[]>([])
  const [carregando, setCarregando] = React.useState(true)
  const [busca, setBusca] = React.useState('')
  const [aba, setAba] = React.useState<GcStatusCliente | 'todos'>('ativo')
  const [modalAberto, setModalAberto] = React.useState(false)

  const carregar = React.useCallback(async () => {
    try {
      setClientes(await gestaoClientes.listar())
    } catch (err) {
      toast.error('Falha ao carregar os clientes: ' + (err as Error).message)
    } finally {
      setCarregando(false)
    }
  }, [])

  React.useEffect(() => {
    void carregar()
  }, [carregar])

  const termo = busca.trim().toLowerCase()
  const visiveis = clientes.filter((c) => {
    if (aba !== 'todos' && c.status !== aba) return false
    if (!termo) return true
    const digitos = termo.replace(/\D/g, '')
    return (
      [c.nome_empresa, c.nome_contato, c.cidade, c.segmento, c.responsavel_nome ?? '']
        .some((v) => (v ?? '').toLowerCase().includes(termo)) ||
      (digitos.length >= 3 && (c.cnpj ?? '').replace(/\D/g, '').includes(digitos))
    )
  })

  const contagem = (status: GcStatusCliente | 'todos') =>
    status === 'todos' ? clientes.length : clientes.filter((c) => c.status === status).length

  return (
    <>
      <TopBar
        title="Clientes"
        subtitle="Clientes NX Digital"
        breadcrumbs={[
          { label: 'Grupo NX Digital', to: '/' },
          { label: 'Clientes NX Digital', to: '/clientesnxdigital/clientes' },
          { label: 'Clientes' },
        ]}
        rightSlot={
          <Button leftIcon={<Plus className="h-4 w-4" />} onClick={() => setModalAberto(true)}>
            Novo cliente
          </Button>
        }
      />

      <div className="space-y-4 px-4 pb-10 lg:px-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <Tabs
            value={aba}
            onChange={(v) => setAba(v as GcStatusCliente | 'todos')}
            items={ABAS.map((a) => ({
              value: a.value,
              label: (
                <span className="flex items-center gap-1.5">
                  {a.label}
                  <span className="text-xs tabular-nums text-foreground/45">{contagem(a.value)}</span>
                </span>
              ),
            }))}
          />
          <Input
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Buscar por empresa, contato, cidade, CNPJ…"
            leftIcon={<Search className="h-4 w-4" />}
            containerClassName="sm:w-80"
          />
        </div>

        {carregando ? (
          <div className="flex items-center justify-center gap-2 py-16 text-sm text-foreground/60">
            <Loader2 className="h-4 w-4 animate-spin" /> Carregando clientes…
          </div>
        ) : visiveis.length === 0 ? (
          <EmptyState
            icon={<Users className="h-6 w-6" />}
            title={clientes.length === 0 ? 'Nenhum cliente cadastrado' : 'Nada com esse filtro'}
            description={
              clientes.length === 0
                ? 'Cadastre o primeiro cliente de tráfego — a jornada de implantação é criada junto.'
                : 'Mude a aba ou limpe a busca.'
            }
            action={
              clientes.length === 0 ? (
                <Button leftIcon={<Plus className="h-4 w-4" />} onClick={() => setModalAberto(true)}>
                  Novo cliente
                </Button>
              ) : undefined
            }
          />
        ) : (
          <div className="overflow-hidden rounded-xl border border-line">
            <table className="w-full text-sm">
              <thead className="bg-elevate/[0.02] text-left text-xs uppercase tracking-wide text-foreground/50">
                <tr>
                  <th className="px-4 py-2.5 font-medium">Empresa</th>
                  <th className="hidden px-4 py-2.5 font-medium md:table-cell">Serviços</th>
                  <th className="hidden px-4 py-2.5 font-medium lg:table-cell">Responsável</th>
                  <th className="px-4 py-2.5 font-medium">Etapa atual</th>
                  <th className="hidden px-4 py-2.5 font-medium sm:table-cell">Checklist</th>
                  <th className="px-4 py-2.5 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {visiveis.map((c) => (
                  <tr
                    key={c.id}
                    onClick={() => navegar(`/clientesnxdigital/clientes/${c.id}`)}
                    className="cursor-pointer border-t border-line transition-colors hover:bg-elevate/[0.03]"
                  >
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2.5">
                        <span
                          className={cn(
                            'grid h-8 w-8 shrink-0 place-items-center rounded-lg border border-line',
                            'bg-elevate/[0.04] text-xs font-semibold text-foreground/70',
                          )}
                        >
                          {iniciais(c.nome_empresa) || '—'}
                        </span>
                        <span className="min-w-0">
                          <span className="block truncate font-medium text-foreground">
                            {c.nome_empresa}
                          </span>
                          <span className="block truncate text-xs text-foreground/50">
                            {[c.nome_contato, c.cidade].filter(Boolean).join(' · ') || '—'}
                          </span>
                        </span>
                      </div>
                    </td>
                    <td className="hidden px-4 py-3 md:table-cell">
                      {c.servicos.length === 0 ? (
                        <span className="text-xs text-foreground/40">—</span>
                      ) : (
                        <div className="flex flex-wrap gap-1">
                          {c.servicos.map((s) => (
                            <Badge key={s.id} tone={s.status === 'ativo' ? 'info' : 'neutral'}>
                              {rotuloServico(s.tipo)}
                            </Badge>
                          ))}
                        </div>
                      )}
                    </td>
                    <td className="hidden px-4 py-3 text-foreground/70 lg:table-cell">
                      {c.responsavel_nome ?? <span className="text-foreground/40">—</span>}
                    </td>
                    <td className="px-4 py-3">
                      <span className="text-foreground/80">
                        {c.etapa_atual ?? (
                          <span className="text-success">Jornada concluída</span>
                        )}
                      </span>
                      <span className="block text-xs text-foreground/45">
                        {Number(c.etapas_concluidas)} de {Number(c.etapas_total)} etapas
                      </span>
                    </td>
                    <td className="hidden px-4 py-3 sm:table-cell">
                      <BarraProgresso valor={progressoDoCliente(c)} />
                    </td>
                    <td className="px-4 py-3">
                      <Badge tone={TOM_DO_STATUS[c.status]} dot>
                        {ABAS.find((a) => a.value === c.status)?.label.replace(/s$/, '') ?? c.status}
                      </Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <ModalCliente
        aberto={modalAberto}
        onFechar={() => setModalAberto(false)}
        onSalvo={(id) => navegar(`/clientesnxdigital/clientes/${id}`)}
      />
    </>
  )
}
