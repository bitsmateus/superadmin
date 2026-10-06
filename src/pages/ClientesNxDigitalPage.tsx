import * as React from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowUpDown, KanbanSquare, Loader2, Plus, Search, ShieldAlert, Table2, Users } from 'lucide-react'
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
  KanbanClientes, KanbanSituacao, type ColunaKanban,
} from '@/components/gestaoClientes/KanbanClientes'
import { ModalMoverEtapa } from '@/components/gestaoClientes/ModalMoverEtapa'
import { FaixaLancamento } from '@/components/gestaoClientes/FaixaLancamento'
import { useLancamentoPendente } from '@/hooks/useLancamentoPendente'
import {
  NIVEIS_AVALIACAO, PRIORIDADES, TIPOS_SERVICO, gestaoClientes, progressoDoCliente,
  type GcClienteLista, type GcNivelAvaliacao, type GcPreviaMover, type GcPrioridade,
  type GcStatusCliente,
} from '@/services/gestaoClientes'
import {
  DIAS_AVISO_RENOVACAO, avaliarSaude, compararPorGravidade, compararPorPrioridade, contaNoTotal,
  type Saude,
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

/** Dias daqui até uma data 'YYYY-MM-DD' (negativo = já passou). */
function diasAteData(data: string | null): number | null {
  if (!data) return null
  const quando = new Date(`${String(data).slice(0, 10)}T12:00:00`).getTime()
  return Number.isNaN(quando) ? null : Math.round((quando - Date.now()) / 86400000)
}

function dataBr(data: string | null): string {
  return data ? String(data).slice(0, 10).split('-').reverse().join('/') : '—'
}

/** "hoje", "ontem", "há 5 dias" — pra data que importa pelo quão recente é. */
function haQuantoTempo(iso: string | null): string {
  if (!iso) return ''
  const dias = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000)
  if (dias <= 0) return 'hoje'
  if (dias === 1) return 'ontem'
  return `há ${dias} dias`
}

type Visao = 'tabela' | 'kanban'
const CHAVE_VISAO = 'gc:clientes:visao'

/** O que o Kanban agrupa: as etapas da jornada ou a situação do mês (lançado, relatório...). */
type Agrupamento = 'etapa' | 'situacao'
const CHAVE_AGRUPAMENTO = 'gc:clientes:kanban-agrupamento'

function lerAgrupamento(): Agrupamento {
  try {
    return window.localStorage.getItem(CHAVE_AGRUPAMENTO) === 'situacao' ? 'situacao' : 'etapa'
  } catch {
    return 'etapa'
  }
}

function lerVisao(): Visao {
  try {
    return window.localStorage.getItem(CHAVE_VISAO) === 'kanban' ? 'kanban' : 'tabela'
  } catch {
    return 'tabela'
  }
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
  const pendencia = useLancamentoPendente()
  const [visao, setVisao] = React.useState<Visao>(lerVisao)
  const [agrupamento, setAgrupamento] = React.useState<Agrupamento>(lerAgrupamento)
  // A visão por situação tem o próprio mês e a própria carga: a lista principal é do mês corrente, e
  // navegar pra setembro aqui não pode bagunçar os indicadores e o semáforo da tela inteira.
  const [periodoSituacao, setPeriodoSituacao] = React.useState(mesAtual())
  const [clientesSituacao, setClientesSituacao] = React.useState<GcClienteLista[]>([])
  const [carregandoSituacao, setCarregandoSituacao] = React.useState(false)
  const [colunas, setColunas] = React.useState<ColunaKanban[]>([])
  const [mover, setMover] = React.useState<{
    cliente: GcClienteLista
    destinoId: string
    previa: GcPreviaMover
  } | null>(null)
  const [movendo, setMovendo] = React.useState(false)

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

  React.useEffect(() => {
    gestaoClientes
      .modelos()
      .then((m) => setColunas(m.etapas.map((e) => ({ id: e.id, nome: e.nome }))))
      .catch(() => {
        // Sem as colunas o Kanban fica vazio, mas a tabela continua funcionando — não vale
        // derrubar a tela por causa disso.
      })
  }, [])

  React.useEffect(() => {
    if (visao !== 'kanban' || agrupamento !== 'situacao') return
    let cancelado = false
    setCarregandoSituacao(true)
    gestaoClientes
      .listar(periodoSituacao)
      .then((lista) => {
        if (!cancelado) setClientesSituacao(lista)
      })
      .catch((err: Error) => toast.error('Falha ao carregar a situação do mês: ' + err.message))
      .finally(() => {
        if (!cancelado) setCarregandoSituacao(false)
      })
    return () => {
      cancelado = true
    }
  }, [visao, agrupamento, periodoSituacao])

  const escolherAgrupamento = (a: Agrupamento) => {
    setAgrupamento(a)
    try {
      window.localStorage.setItem(CHAVE_AGRUPAMENTO, a)
    } catch {
      /* sem armazenamento: vale até recarregar */
    }
  }

  const escolherVisao = (v: Visao) => {
    setVisao(v)
    try {
      window.localStorage.setItem(CHAVE_VISAO, v)
    } catch {
      /* sem armazenamento: vale até recarregar */
    }
  }

  // Arrastar (ou escolher no seletor) NÃO executa: pede ao servidor a prévia do que aconteceria e só
  // move depois da confirmação, porque mexe no checklist do cliente.
  const pedirMover = async (cliente: GcClienteLista, destinoId: string) => {
    try {
      const previa = await gestaoClientes.moverEtapa(cliente.id, destinoId)
      if (previa.sem_mudanca) return
      setMover({ cliente, destinoId, previa })
    } catch (err) {
      toast.error('Não foi possível mover: ' + (err as Error).message)
    }
  }

  const confirmarMover = async () => {
    if (!mover) return
    setMovendo(true)
    try {
      await gestaoClientes.moverEtapa(mover.cliente.id, mover.destinoId, true)
      toast.success(`${mover.cliente.nome_empresa} movido pra ${mover.previa.destino}`)
      setMover(null)
      await carregar()
    } catch (err) {
      toast.error('Falha ao mover: ' + (err as Error).message)
    } finally {
      setMovendo(false)
    }
  }

  // O semáforo é calculado uma vez por carga, não a cada render: são ~15 sinais por cliente.
  const comSaude = React.useMemo(
    () => clientes.map((c) => ({ cliente: c, saude: avaliarSaude(c) })),
    [clientes],
  )

  const termo = busca.trim().toLowerCase()
  // Mesmo filtro e mesma ordem pra tabela, pro Kanban por etapa e pro Kanban por situação: três
  // telas que filtram de um jeito cada uma é como a pessoa acha que um cliente "sumiu".
  const passaNoFiltro = ({ cliente: c, saude }: { cliente: GcClienteLista; saude: Saude }) => {
    if (aba !== 'todos' && c.status !== aba) return false
    if (soProblemas && saude.nivel !== 'risco' && saude.nivel !== 'atencao') return false
    if (!termo) return true
    const digitos = termo.replace(/\D/g, '')
    return (
      [c.nome_empresa, c.nome_contato, c.cidade, c.segmento, c.responsavel_nome ?? ''].some((v) =>
        (v ?? '').toLowerCase().includes(termo),
      ) || (digitos.length >= 3 && (c.cnpj ?? '').replace(/\D/g, '').includes(digitos))
    )
  }
  const comparador =
    ordem === 'fila'
      ? compararPorPrioridade
      : ordem === 'gravidade'
        ? compararPorGravidade
        : (a: { cliente: GcClienteLista }, b: { cliente: GcClienteLista }) =>
            a.cliente.nome_empresa.localeCompare(b.cliente.nome_empresa)

  const visiveis = comSaude.filter(passaNoFiltro)
  const ordenados = [...visiveis].sort(comparador)

  const ordenadosSituacao = React.useMemo(
    () =>
      clientesSituacao
        .map((c) => ({ cliente: c, saude: avaliarSaude(c) }))
        .filter(passaNoFiltro)
        .sort(comparador),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [clientesSituacao, aba, soProblemas, termo, ordem],
  )

  const contagem = (status: GcStatusCliente | 'todos') =>
    status === 'todos' ? clientes.length : clientes.filter((c) => c.status === status).length

  // Os indicadores do topo falam só de quem CONTA nos totais: ativo e não marcado como teste. Cliente
  // encerrado não tem o que cobrar, e cadastro de teste inflaria a carteira e o "em risco".
  const ativos = comSaude.filter(({ cliente }) => contaNoTotal(cliente))
  const foraDosTotais = comSaude.filter(({ cliente }) => cliente.fora_dos_totais).length
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
        <FaixaLancamento
          pendencia={pendencia}
          onLancar={(p) => navegar(`/clientesnxdigital/trafego?lancar=${p}`)}
        />

        {!carregando && clientes.length > 0 && (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            <Indicador
              rotulo="Clientes ativos"
              valor={String(ativos.length)}
              ajuda={
                altaPrioridade > 0
                  ? `${altaPrioridade} de prioridade alta`
                  : foraDosTotais > 0
                    ? `${foraDosTotais} de teste fora da conta`
                    : `${clientes.length} no total`
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
            <div className="flex overflow-hidden rounded-lg border border-line" role="group" aria-label="Visão">
              {(
                [
                  { valor: 'tabela', rotulo: 'Tabela', icone: Table2 },
                  { valor: 'kanban', rotulo: 'Kanban por etapa', icone: KanbanSquare },
                ] as const
              ).map((v) => (
                <button
                  key={v.valor}
                  type="button"
                  onClick={() => escolherVisao(v.valor)}
                  title={v.rotulo}
                  aria-pressed={visao === v.valor}
                  className={cn(
                    'flex h-9 items-center gap-1.5 px-2.5 text-xs transition-colors',
                    visao === v.valor
                      ? 'bg-elevate/[0.08] text-foreground'
                      : 'text-foreground/50 hover:text-foreground/80',
                  )}
                >
                  <v.icone className="h-3.5 w-3.5" />
                  <span className="hidden sm:inline">{v.rotulo}</span>
                </button>
              ))}
            </div>
            {visao === 'kanban' && (
              <div className="flex overflow-hidden rounded-lg border border-line" role="group" aria-label="Agrupar por">
                {(
                  [
                    { valor: 'etapa', rotulo: 'Por etapa' },
                    { valor: 'situacao', rotulo: 'Situação do mês' },
                  ] as const
                ).map((a) => (
                  <button
                    key={a.valor}
                    type="button"
                    onClick={() => escolherAgrupamento(a.valor)}
                    aria-pressed={agrupamento === a.valor}
                    className={cn(
                      'h-9 px-2.5 text-xs transition-colors',
                      agrupamento === a.valor
                        ? 'bg-elevate/[0.08] text-foreground'
                        : 'text-foreground/50 hover:text-foreground/80',
                    )}
                  >
                    {a.rotulo}
                  </button>
                ))}
              </div>
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
        ) : visao === 'kanban' && agrupamento === 'situacao' ? (
          <KanbanSituacao
            itens={ordenadosSituacao}
            periodo={periodoSituacao}
            carregando={carregandoSituacao}
            onPeriodo={setPeriodoSituacao}
            onAbrir={(id) => navegar(`/clientesnxdigital/clientes/${id}`)}
            onLancar={(p) => navegar(`/clientesnxdigital/trafego?lancar=${p}`)}
          />
        ) : visao === 'kanban' ? (
          <KanbanClientes
            itens={ordenados}
            colunas={colunas}
            onAbrir={(id) => navegar(`/clientesnxdigital/clientes/${id}`)}
            onMover={(c, destino) => void pedirMover(c, destino)}
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
                    <th className="hidden px-4 py-2.5 font-medium xl:table-cell">Renovação</th>
                    <th className="hidden px-4 py-2.5 font-medium xl:table-cell">Último relatório</th>
                    <th className="hidden px-4 py-2.5 font-medium 2xl:table-cell">Portal</th>
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

      <ModalMoverEtapa
        aberto={mover !== null}
        cliente={mover?.cliente.nome_empresa ?? ''}
        previa={mover?.previa ?? null}
        confirmando={movendo}
        onCancelar={() => setMover(null)}
        onConfirmar={() => void confirmarMover()}
      />
    </>
  )
}

/** Próxima renovação: a data, e quanto falta — em vermelho se já venceu ou vence em até 30 dias. */
function Renovacao({ data }: { data: string | null }) {
  const dias = diasAteData(data)
  if (dias === null) return <span className="text-xs text-foreground/35">sem data</span>
  const urgente = dias <= DIAS_AVISO_RENOVACAO
  return (
    <span className={urgente ? 'text-danger' : 'text-foreground/80'}>
      {dataBr(data)}
      <span className="block text-xs">
        {dias < 0 ? `venceu há ${Math.abs(dias)} dia(s)` : dias === 0 ? 'vence hoje' : `em ${dias} dia(s)`}
      </span>
    </span>
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
            <span className="flex items-center gap-1.5 truncate font-medium text-foreground">
              {c.nome_empresa}
              {c.fora_dos_totais && (
                <span
                  className="shrink-0 rounded border border-line px-1 text-[10px] font-normal uppercase text-foreground/45"
                  title="Fora dos totais"
                >
                  teste
                </span>
              )}
            </span>
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
          <span
            className="mt-0.5 block text-xs text-danger/80"
            title={saude.churn.explicacao ?? undefined}
          >
            churn {saude.churn.nivel}
            {saude.churn.origem === 'acompanhamento' ? ' · falta de acompanhamento' : ''}
          </span>
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
      <td className="hidden whitespace-nowrap px-4 py-3 xl:table-cell">
        <Renovacao data={c.proxima_renovacao} />
      </td>
      <td className="hidden whitespace-nowrap px-4 py-3 xl:table-cell">
        {c.ultimo_relatorio ? (
          <span className="text-foreground/80">
            {String(c.ultimo_relatorio).slice(0, 7).split('-').reverse().join('/')}
          </span>
        ) : (
          <span className="text-xs text-foreground/35">nunca publicado</span>
        )}
      </td>
      <td className="hidden whitespace-nowrap px-4 py-3 2xl:table-cell">
        {c.ultimo_acesso_portal ? (
          <span className="text-foreground/80">{haQuantoTempo(c.ultimo_acesso_portal)}</span>
        ) : (
          <span className="text-xs text-foreground/35">nunca abriu</span>
        )}
      </td>
      <td className="px-4 py-3">
        <Badge tone={TOM_DO_STATUS[c.status]} dot>
          {ABAS.find((a) => a.value === c.status)?.label.replace(/s$/, '') ?? c.status}
        </Badge>
      </td>
    </tr>
  )
}
