import * as React from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowUpDown, Loader2, Plus, Search, ShieldAlert, Users } from 'lucide-react'
import { toast } from 'sonner'
import { TopBar } from '@/components/layout/TopBar'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Badge } from '@/components/ui/Badge'
import { EmptyState } from '@/components/ui/EmptyState'
import { Tabs } from '@/components/ui/Tabs'
import { ModalCliente } from '@/components/gestaoClientes/ModalCliente'
import { PastilhaSaude } from '@/components/gestaoClientes/Semaforo'
import {
  NIVEIS_AVALIACAO, PRIORIDADES, TIPOS_SERVICO, gestaoClientes, progressoDoCliente,
  type GcClienteLista, type GcNivelAvaliacao, type GcPrioridade, type GcStatusCliente,
} from '@/services/gestaoClientes'
import {
  avaliarSaude, compararPorGravidade, compararPorPrioridade, type Saude,
} from '@/lib/gcSaude'
import { formatarMetrica, mesPorExtenso, mesAtual } from '@/lib/gcMetricas'
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

const ESTILO_PRIORIDADE: Record<GcPrioridade, string> = {
  alta: 'border-danger/30 bg-danger/10 text-danger',
  media: 'border-line bg-elevate/[0.04] text-foreground/60',
  baixa: 'border-line bg-transparent text-foreground/40',
}

/** Como a lista é ordenada. "Fila" é o padrão: prioridade combinada, depois gravidade. */
type Ordem = 'fila' | 'gravidade' | 'nome'

const ORDENS: { valor: Ordem; label: string }[] = [
  { valor: 'fila', label: 'Ordem de prioridade' },
  { valor: 'gravidade', label: 'Pior primeiro' },
  { valor: 'nome', label: 'Nome' },
]

/** A nota do gestor pintada do jeito que ela aparece no detalhe. */
const CORES_NOTA: Record<GcNivelAvaliacao, string> = {
  otimo: 'text-success',
  bom: 'text-accent',
  regular: 'text-warning',
  ruim: 'text-danger',
}

function rotuloNota(nivel: GcNivelAvaliacao): string {
  return NIVEIS_AVALIACAO.find((n) => n.valor === nivel)?.label ?? nivel
}

function rotuloServico(tipo: string): string {
  return TIPOS_SERVICO.find((t) => t.valor === tipo)?.label ?? tipo
}

/** Barra de progresso do checklist — fina, só pra dar a noção de "quanto falta" na lista. */
function BarraProgresso({ valor }: { valor: number }) {
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-20 overflow-hidden rounded-full bg-elevate/[0.08]">
        <div className="h-full rounded-full bg-accent transition-[width]" style={{ width: `${valor}%` }} />
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

/** Um número grande do topo. Clicável quando serve de filtro. */
function Indicador({
  rotulo,
  valor,
  ajuda,
  tom,
  ativo,
  onClick,
}: {
  rotulo: string
  valor: string
  ajuda?: string
  tom?: 'danger' | 'warning' | 'accent'
  ativo?: boolean
  onClick?: () => void
}) {
  const Elemento = onClick ? 'button' : 'div'
  return (
    <Elemento
      type={onClick ? 'button' : undefined}
      onClick={onClick}
      className={cn(
        'rounded-xl border px-4 py-3 text-left transition-colors',
        ativo ? 'border-accent/50 bg-accent/[0.05]' : 'border-line',
        onClick && !ativo && 'hover:border-foreground/20',
      )}
    >
      <p className="text-xs uppercase tracking-wide text-foreground/45">{rotulo}</p>
      <p
        className={cn(
          'mt-0.5 text-2xl font-semibold tabular-nums',
          tom === 'danger' ? 'text-danger' : tom === 'warning' ? 'text-warning' : 'text-foreground',
        )}
      >
        {valor}
      </p>
      {ajuda && <p className="text-xs text-foreground/45">{ajuda}</p>}
    </Elemento>
  )
}

/**
 * CLIENTES NX DIGITAL → Clientes.
 *
 * A base de clientes de tráfego: quem é, quem atende, quais serviços tem, em que ponto da jornada
 * está e — a coluna que mais importa no dia a dia — se está bem ou não. O semáforo é calculado em
 * src/lib/gcSaude.ts, com os mesmos dados que a tela de Tráfego e o detalhe do cliente usam.
 *
 * Cadastro próprio do módulo (tabelas `gc_*`) — não é a lista do Suporte nem a de Clientes Geral
 * do Financeiro, de propósito: aqui o que importa é a entrega, não a cobrança.
 */
export function ClientesNxDigitalPage() {
  const navegar = useNavigate()
  const [clientes, setClientes] = React.useState<GcClienteLista[]>([])
  const [carregando, setCarregando] = React.useState(true)
  const [busca, setBusca] = React.useState('')
  const [aba, setAba] = React.useState<GcStatusCliente | 'todos'>('ativo')
  const [soProblemas, setSoProblemas] = React.useState(false)
  const [ordem, setOrdem] = React.useState<Ordem>('fila')
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

  // Mudar a prioridade é o tipo de coisa que se faz olhando a lista inteira, então ela é editável
  // aqui mesmo — abrir o cadastro do cliente só pra isso seria um desvio no meio do raciocínio.
  const mudarPrioridade = async (id: string, prioridade: GcPrioridade) => {
    setClientes((atual) => atual.map((c) => (c.id === id ? { ...c, prioridade } : c)))
    try {
      await gestaoClientes.atualizar(id, { prioridade })
    } catch (err) {
      toast.error('Falha ao mudar a prioridade: ' + (err as Error).message)
      await carregar()
    }
  }

  React.useEffect(() => {
    void carregar()
  }, [carregar])

  // O semáforo é calculado uma vez por carga, não a cada render: são ~15 sinais por cliente.
  const comSaude = React.useMemo(
    () => clientes.map((c) => ({ cliente: c, saude: avaliarSaude(c) })),
    [clientes],
  )

  const termo = busca.trim().toLowerCase()
  const visiveis = comSaude.filter(({ cliente: c, saude }) => {
    if (aba !== 'todos' && c.status !== aba) return false
    if (soProblemas && saude.nivel !== 'risco' && saude.nivel !== 'atencao') return false
    if (!termo) return true
    const digitos = termo.replace(/\D/g, '')
    return (
      [c.nome_empresa, c.nome_contato, c.cidade, c.segmento, c.responsavel_nome ?? ''].some((v) =>
        (v ?? '').toLowerCase().includes(termo),
      ) || (digitos.length >= 3 && (c.cnpj ?? '').replace(/\D/g, '').includes(digitos))
    )
  })

  const ordenados = [...visiveis].sort(
    ordem === 'fila'
      ? compararPorPrioridade
      : ordem === 'gravidade'
        ? compararPorGravidade
        : (a, b) => a.cliente.nome_empresa.localeCompare(b.cliente.nome_empresa),
  )

  const contagem = (status: GcStatusCliente | 'todos') =>
    status === 'todos' ? clientes.length : clientes.filter((c) => c.status === status).length

  // Os indicadores do topo falam só dos clientes ATIVOS: cliente encerrado não tem o que cobrar.
  const ativos = comSaude.filter(({ cliente }) => cliente.status === 'ativo')
  const emRisco = ativos.filter(({ saude }) => saude.nivel === 'risco').length
  const precisamAtencao = ativos.filter(({ saude }) => saude.nivel === 'atencao').length
  const semLancamento = ativos.filter(
    ({ cliente }) => Object.keys(cliente.metricas_mes ?? {}).length === 0,
  ).length
  const semNota = ativos.filter(({ cliente }) => !cliente.avaliacao).length
  const altaPrioridade = ativos.filter(({ cliente }) => cliente.prioridade === 'alta').length
  const investimentoDoMes = ativos.reduce(
    (soma, { cliente }) => soma + Number(cliente.metricas_mes?.investimento ?? 0),
    0,
  )

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
        {!carregando && clientes.length > 0 && (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            <Indicador
              rotulo="Clientes ativos"
              valor={String(ativos.length)}
              ajuda={
                altaPrioridade > 0 ? `${altaPrioridade} de prioridade alta` : `${clientes.length} no total`
              }
            />
            <Indicador
              rotulo="Em risco"
              valor={String(emRisco)}
              ajuda={precisamAtencao > 0 ? `+ ${precisamAtencao} pedindo atenção` : 'nenhum alerta grave'}
              tom={emRisco > 0 ? 'danger' : undefined}
              ativo={soProblemas}
              onClick={() => setSoProblemas((v) => !v)}
            />
            <Indicador
              rotulo="Sem lançamento"
              valor={String(semLancamento)}
              ajuda={`métricas de ${mesPorExtenso(mesAtual()).toLowerCase()}`}
              tom={semLancamento > 0 ? 'warning' : undefined}
            />
            <Indicador
              rotulo="Sem a sua nota"
              valor={String(semNota)}
              ajuda="você ainda não disse se o mês foi bom"
              tom={semNota > 0 ? 'warning' : undefined}
            />
            <Indicador
              rotulo="Investimento do mês"
              valor={formatarMetrica(investimentoDoMes, 'reais')}
              ajuda="soma dos clientes ativos"
            />
          </div>
        )}

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
          <div className="flex items-center gap-2">
            {soProblemas && (
              <Button
                variant="ghost"
                size="sm"
                leftIcon={<ShieldAlert className="h-3.5 w-3.5" />}
                onClick={() => setSoProblemas(false)}
              >
                só quem precisa de atenção
              </Button>
            )}
            <label className="flex items-center gap-1.5 text-xs text-foreground/50">
              <ArrowUpDown className="h-3.5 w-3.5" />
              <select
                value={ordem}
                onChange={(e) => setOrdem(e.target.value as Ordem)}
                className="h-9 rounded-lg border border-line bg-transparent px-2 text-sm text-foreground outline-none focus:border-accent/60"
              >
                {ORDENS.map((o) => (
                  <option key={o.valor} value={o.valor}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>
            <Input
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              placeholder="Buscar por empresa, contato, cidade, CNPJ…"
              leftIcon={<Search className="h-4 w-4" />}
              containerClassName="sm:w-64"
            />
          </div>
        </div>

        {carregando ? (
          <div className="flex items-center justify-center gap-2 py-16 text-sm text-foreground/60">
            <Loader2 className="h-4 w-4 animate-spin" /> Carregando clientes…
          </div>
        ) : ordenados.length === 0 ? (
          <EmptyState
            icon={<Users className="h-6 w-6" />}
            title={clientes.length === 0 ? 'Nenhum cliente cadastrado' : 'Nada com esse filtro'}
            description={
              clientes.length === 0
                ? 'Cadastre o primeiro cliente de tráfego — a jornada de implantação é criada junto.'
                : 'Mude a aba, limpe a busca ou desligue o filtro de atenção.'
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
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-elevate/[0.02] text-left text-xs uppercase tracking-wide text-foreground/50">
                  <tr>
                    <th className="px-4 py-2.5 font-medium">#</th>
                    <th className="px-4 py-2.5 font-medium">Empresa</th>
                    <th className="px-4 py-2.5 font-medium">Prioridade</th>
                    <th className="px-4 py-2.5 font-medium">Como está</th>
                    <th className="hidden px-4 py-2.5 font-medium lg:table-cell">Serviços</th>
                    <th className="px-4 py-2.5 font-medium">Etapa atual</th>
                    <th className="hidden px-4 py-2.5 font-medium sm:table-cell">Checklist</th>
                    <th className="px-4 py-2.5 font-medium">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {ordenados.map(({ cliente: c, saude }, i) => (
                    <LinhaCliente
                      key={c.id}
                      posicao={ordem === 'nome' ? null : i + 1}
                      cliente={c}
                      saude={saude}
                      onAbrir={() => navegar(`/clientesnxdigital/clientes/${c.id}`)}
                      onPrioridade={(p) => void mudarPrioridade(c.id, p)}
                    />
                  ))}
                </tbody>
              </table>
            </div>
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

function LinhaCliente({
  cliente: c,
  saude,
  posicao,
  onAbrir,
  onPrioridade,
}: {
  cliente: GcClienteLista
  saude: Saude
  /** Lugar na fila. Null quando a lista está em ordem alfabética, onde o número não diria nada. */
  posicao: number | null
  onAbrir: () => void
  onPrioridade: (p: GcPrioridade) => void
}) {
  // O pior sinal explica a pastilha: "Risco" sozinho não diz o que foi, e é isso que faz a pessoa
  // abrir o cliente certo em vez de abrir todos.
  const ordem = ['risco', 'atencao', 'neutro', 'bom', 'otimo']
  const pior = [...saude.sinais].sort(
    (a, b) => ordem.indexOf(a.estado) - ordem.indexOf(b.estado),
  )[0]

  return (
    <tr
      onClick={onAbrir}
      className="cursor-pointer border-t border-line transition-colors hover:bg-elevate/[0.03]"
    >
      <td className="w-10 px-4 py-3 text-center">
        {posicao === null ? (
          <span className="text-foreground/20">—</span>
        ) : (
          <span
            className={cn(
              'text-sm font-semibold tabular-nums',
              posicao <= 3 ? 'text-foreground' : 'text-foreground/35',
            )}
          >
            {posicao}
          </span>
        )}
      </td>
      <td className="px-4 py-3">
        <div className="flex items-center gap-2.5">
          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg border border-line bg-elevate/[0.04] text-xs font-semibold text-foreground/70">
            {iniciais(c.nome_empresa) || '—'}
          </span>
          <span className="min-w-0">
            <span className="block truncate font-medium text-foreground">{c.nome_empresa}</span>
            <span className="block truncate text-xs text-foreground/50">
              {[c.nome_contato, c.responsavel_nome].filter(Boolean).join(' · ') || '—'}
            </span>
          </span>
        </div>
      </td>
      <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
        <select
          value={c.prioridade ?? 'media'}
          onChange={(e) => onPrioridade(e.target.value as GcPrioridade)}
          title={PRIORIDADES.find((p) => p.valor === (c.prioridade ?? 'media'))?.ajuda}
          className={cn(
            'rounded-full border px-2 py-0.5 text-xs font-medium outline-none transition-colors',
            ESTILO_PRIORIDADE[c.prioridade ?? 'media'],
          )}
        >
          {PRIORIDADES.map((p) => (
            <option key={p.valor} value={p.valor} className="bg-surface text-foreground">
              {p.label}
            </option>
          ))}
        </select>
      </td>
      <td className="px-4 py-3">
        <PastilhaSaude estado={saude.nivel} />
        {pior && (saude.nivel === 'risco' || saude.nivel === 'atencao') && (
          <span className="mt-1 block max-w-[220px] truncate text-xs text-foreground/50">
            {pior.titulo}: {pior.detalhe}
          </span>
        )}
        {c.avaliacao ? (
          <span className={cn('mt-1 block text-xs', CORES_NOTA[c.avaliacao.nivel])}>
            sua nota do mês: {rotuloNota(c.avaliacao.nivel)}
          </span>
        ) : (
          <span className="mt-1 block text-xs text-foreground/35">sem nota sua neste mês</span>
        )}
        {(saude.churn.nivel === 'medio' || saude.churn.nivel === 'alto') && (
          <span className="mt-0.5 block text-xs text-danger/80">churn {saude.churn.nivel}</span>
        )}
      </td>
      <td className="hidden px-4 py-3 lg:table-cell">
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
      <td className="px-4 py-3">
        <span className="text-foreground/80">
          {c.etapa_atual ?? <span className="text-success">Jornada concluída</span>}
        </span>
        <span className="block text-xs text-foreground/45">
          {Number(c.etapas_concluidas)} de {Number(c.etapas_total)} etapas
          {Number(c.itens_atrasados) > 0 && (
            <span className="text-danger"> · {Number(c.itens_atrasados)} atrasado(s)</span>
          )}
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
  )
}
