import * as React from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import {
  AlertTriangle,
  ArrowDownCircle,
  ArrowUpCircle,
  Building2,
  Calendar,
  ChevronDown,
  ChevronRight,
  Clock,
  Link as LinkIcon,
  ListChecks,
  Lock,
  Pause,
  Phone,
  Play,
  PlusCircle,
  Search,
  UserCircle2,
} from 'lucide-react'
import { toast } from 'sonner'
import { TopBar } from '@/components/layout/TopBar'
import { useSupportView, useSupportViewText } from '@/components/support/SupportViewContext'
import { supportPagesService } from '@/services/supportPages'
import { AddClientsToPageModal } from '@/components/support/AddClientsToPageModal'
import { onSseEvent } from '@/services/api'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Modal } from '@/components/ui/Modal'
import { ClientDrawer } from '@/components/crm/ClientDrawerLazy'
import { StageBadge } from '@/components/crm/StageBadge'
import { StageAgeBadge } from '@/components/crm/StageAgeBadge'
import { useClients, useCurrentUser, useSettings } from '@/hooks/useClients'
import { useTeamProfiles, profileOptions } from '@/hooks/useTeamProfiles'
import type { TeamArea } from '@/services/supabase'
import { db } from '@/services/db'
import {
  NEXT_STAGE,
  PREV_STAGE,
  PIPELINE_STAGES,
  STAGE_COLORS,
} from '@/constants/stageColors'
import { computeReadiness } from '@/constants/readiness'
import {
  isDoingNow,
  resolveWipLimit,
  sortQueue,
  wipByOwner,
  wipCountFor,
  wipOwner,
} from '@/constants/setupQueue'
import { asText, cn, formatDateShort, formatDateTimeShort, initials, normalizeText } from '@/lib/utils'
import { daysSince, timeAgo } from '@/lib/time'
import type { Client, PipelineStage } from '@/types/client'

/** O Pipeline do Suporte não mostra "Boas-vindas" nem "Contrato" — essas duas ficam só na aba
 * Contrato do Financeiro. O Suporte só passa a ver o cliente a partir de "Briefing", que é quando
 * o Financeiro marca o contrato como assinado (sincroniza a etapa automaticamente). */
const SUPPORT_VISIBLE_STAGES = PIPELINE_STAGES.filter((s) => s !== 'welcome' && s !== 'contract')

/** Um bloco de linhas dentro de uma etapa (ex.: "Fazendo agora"). */
interface RowGroup {
  key: string
  /** Sem label, o bloco é renderizado sem cabeçalho (etapas comuns). */
  label?: string
  hint?: string
  tone?: 'default' | 'warning'
  clients: Client[]
  /** Numera as linhas com a posição na fila (#1, #2…). */
  numbered?: boolean
  emptyText?: string
}

const newClientSchema = z.object({
  name: z.string().min(2, 'Mínimo 2 caracteres'),
  company: z.string().min(2, 'Mínimo 2 caracteres'),
  phone: z.string().min(8, 'Telefone inválido'),
})
type NewClientValues = z.infer<typeof newClientSchema>

export function PipelinePage() {
  const clients = useClients()
  const settings = useSettings()
  /**
   * Numa CÓPIA criada com "Com tudo"/"Só os quadros", esta mesma tela mostra só os clientes que
   * foram postos nela, na etapa DELA — por isso a cópia sai idêntica ao Pipeline original em
   * layout, mudando só o conteúdo. `null` = rota fixa /pipeline, comportamento de sempre.
   */
  const supportView = useSupportView()
  const copyPageId = supportView?.pageId ?? null
  /** clientId -> etapa dentro da cópia. null enquanto carrega (ou fora de uma cópia). */
  const [membership, setMembership] = React.useState<Map<string, PipelineStage> | null>(null)

  const reloadMembership = React.useCallback(async () => {
    if (!copyPageId) { setMembership(null); return }
    try {
      const rows = await supportPagesService.getClients(copyPageId)
      setMembership(new Map(rows.map((r) => [r.id, r.page_stage_key as PipelineStage])))
    } catch {
      setMembership(new Map())
    }
  }, [copyPageId])

  React.useEffect(() => { void reloadMembership() }, [reloadMembership])
  React.useEffect(
    () => onSseEvent((table) => { if (table === 'support_page_clients') void reloadMembership() }),
    [reloadMembership],
  )
  const [currentUser] = useCurrentUser()
  // Numa cópia do menu ("Duplicar"), o filtro já abre no recorte salvo dela; na rota fixa
  // /pipeline, useSupportViewValue devolve o padrão e nada muda.
  const [search, setSearch] = React.useState(useSupportViewText('search'))
  const [openClientId, setOpenClientId] = React.useState<string | null>(null)
  const [openNew, setOpenNew] = React.useState(false)
  const [addToCopyOpen, setAddToCopyOpen] = React.useState(false)
  // Filtros separados: quem vendeu x quem está entregando. Ver só a própria
  // carga de entrega é o caso de uso principal da fila de configuração.
  const [filterComercial, setFilterComercial] = React.useState(useSupportViewText('filterComercial'))
  const [filterEntrega, setFilterEntrega] = React.useState(useSupportViewText('filterEntrega'))
  /** Confirmação de estouro do limite de configurações simultâneas. */
  const [wipConfirm, setWipConfirm] = React.useState<{
    client: Client
    owner: string
    count: number
    limit: number
  } | null>(null)

  const wipLimit = resolveWipLimit(settings)

  const { data: teamProfiles } = useTeamProfiles()

  /**
   * Opções do filtro: pessoas da equipe marcadas naquela área (ou em "ambos")
   * + quem já está gravado nos clientes naquele papel — assim um responsável
   * antigo, de fora da equipe, não some do filtro.
   */
  const buildOptions = React.useCallback(
    (area: TeamArea, pick: (c: Client) => (string | undefined)[]) => {
      const seen = new Set<string>()
      for (const o of profileOptions(teamProfiles, area)) seen.add(o.value)
      for (const c of clients) {
        for (const v of pick(c)) if (v) seen.add(v)
      }
      return [...seen].sort((a, b) => a.localeCompare(b, 'pt-BR'))
    },
    [clients, teamProfiles],
  )

  const comercialOptions = React.useMemo(
    () => buildOptions('comercial', (c) => [c.responsavelComercial, c.responsavel]),
    [buildOptions],
  )
  const entregaOptions = React.useMemo(
    () => buildOptions('entrega', (c) => [c.responsavelEntrega]),
    [buildOptions],
  )

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isValid },
  } = useForm<NewClientValues>({
    resolver: zodResolver(newClientSchema),
    mode: 'onChange',
  })

  const onCreate = (values: NewClientValues) => {
    const client = db.createClient({
      name: values.name.trim(),
      company: values.company.trim(),
      email: '',
      phone: values.phone.trim(),
      responsavel: undefined,
    })
    toast.success(`Cliente "${client.name}" criado`)
    setOpenNew(false)
    reset()
    setOpenClientId(client.id)
  }

  const byStage = React.useMemo(() => {
    // Busca insensível a acento e maiúsculas.
    const q = normalizeText(search)
    const buckets: Record<PipelineStage, Client[]> = {
      lead: [],
      welcome: [],
      contract: [],
      briefing: [],
      setup_start: [],
      setup: [],
      setup_done: [],
      delivery: [],
      delivered: [],
      active: [],
      churned: [],
    }
    for (const c of clients) {
      // Na cópia, quem não foi adicionado não aparece, e a etapa que vale é a local.
      if (copyPageId && !membership?.has(c.id)) continue
      const stage = (copyPageId ? membership?.get(c.id) : c.stage) ?? c.stage
      if (!buckets[stage]) continue
      if (q) {
        const blob = normalizeText(`${asText(c.name)} ${asText(c.company)}`)
        if (!blob.includes(q)) continue
      }
      // Comercial casa também com o campo legado `responsavel`.
      if (
        filterComercial &&
        c.responsavelComercial !== filterComercial &&
        c.responsavel !== filterComercial
      )
        continue
      if (filterEntrega && c.responsavelEntrega !== filterEntrega) continue
      buckets[stage].push(c)
    }
    // Oldest entries first within each stage
    for (const stage of Object.keys(buckets) as PipelineStage[]) {
      buckets[stage].sort(
        (a, b) =>
          new Date(a.stageUpdatedAt ?? a.createdAt).getTime() -
          new Date(b.stageUpdatedAt ?? b.createdAt).getTime(),
      )
    }
    return buckets
  }, [clients, search, filterComercial, filterEntrega, copyPageId, membership])

  /**
   * Blocos por etapa. As duas etapas de configuração ganham subdivisão:
   *  • Fila (setup_start) → "Prontos para configurar" x "Bloqueados"
   *  • Em configuração (setup) → "Fazendo agora" x "Aguardando vez"
   */
  const groupsFor = React.useCallback(
    (stage: PipelineStage): RowGroup[] => {
      const list = byStage[stage]
      if (stage === 'setup_start') {
        const ready: Client[] = []
        const blocked: Client[] = []
        for (const c of list) {
          if (computeReadiness(c).ready) ready.push(c)
          else blocked.push(c)
        }
        return [
          {
            key: 'ready',
            label: 'Prontos para configurar',
            hint: 'Ordem de chegada (aprovação do briefing). Puxe sempre o #1.',
            clients: sortQueue(ready),
            numbered: true,
            emptyText: 'Ninguém pronto na fila.',
          },
          {
            key: 'blocked',
            label: 'Bloqueados — aguardando o cliente',
            hint: 'Falta informação do cliente. Cobre as pendências em vez de puxar.',
            tone: 'warning',
            clients: sortQueue(blocked),
            emptyText: 'Nenhum cliente bloqueado.',
          },
        ]
      }
      if (stage === 'setup') {
        const doing = list.filter(isDoingNow)
        const waiting = list.filter((c) => !isDoingNow(c))
        const counts = wipByOwner(list)
        return [
          {
            key: 'doing',
            label: 'Fazendo agora',
            hint:
              counts.length > 0
                ? counts.map((x) => `${x.owner} ${x.count}/${wipLimit}`).join(' · ')
                : `Limite de ${wipLimit} por responsável.`,
            clients: [...doing].sort(
              (a, b) =>
                new Date(a.setupStartedAt ?? a.createdAt).getTime() -
                new Date(b.setupStartedAt ?? b.createdAt).getTime(),
            ),
            emptyText: 'Nenhuma configuração em andamento.',
          },
          {
            key: 'waiting',
            label: 'Aguardando vez (prioridade)',
            hint: 'Já estão na etapa, mas ainda não começaram. Ordem de prioridade.',
            clients: sortQueue(waiting),
            numbered: true,
            emptyText: 'Ninguém aguardando.',
          },
        ]
      }
      return [{ key: 'all', clients: list }]
    },
    [byStage, wipLimit],
  )

  /** Marca a config como iniciada, respeitando o limite de simultâneos. */
  const startSetup = (c: Client, force = false) => {
    const owner = (c.responsavelEntrega || currentUser || '').trim()
    const count = wipCountFor(clients, owner || 'Sem responsável', c.id)
    if (!force && count >= wipLimit) {
      setWipConfirm({ client: c, owner: owner || 'Sem responsável', count, limit: wipLimit })
      return
    }
    const patch: Partial<Client> = {
      stage: 'setup',
      setupStartedAt: new Date().toISOString(),
    }
    // Ao puxar da fila, assume a entrega se ainda não tiver responsável.
    if (!c.responsavelEntrega && currentUser) patch.responsavelEntrega = currentUser
    db.updateClient(c.id, patch)
    db.addLog(
      c.id,
      'Configuração iniciada',
      force
        ? `Limite de ${wipLimit} simultâneas ignorado por ${currentUser || 'usuário'}`
        : `Responsável: ${patch.responsavelEntrega ?? c.responsavelEntrega ?? '—'}`,
    )
    toast.success(`${c.name} → fazendo agora`)
    setWipConfirm(null)
  }

  /** Volta para "aguardando vez" — libera a vaga sem perder a etapa. */
  const pauseSetup = (c: Client) => {
    db.updateClient(c.id, { setupStartedAt: undefined })
    db.addLog(c.id, 'Configuração pausada', 'Voltou para "aguardando vez"')
    toast.info(`${c.name} → aguardando vez`)
  }

  /** Puxa o primeiro pronto da fila. */
  const pullNext = () => {
    const ready = sortQueue(byStage.setup_start.filter((c) => computeReadiness(c).ready))
    const next = ready[0]
    if (!next) {
      toast.info('Nenhum cliente pronto na fila.')
      return
    }
    startSetup(next)
  }

  /** Etapa que vale pra este cliente aqui: a da cópia, ou a global no Pipeline original. */
  const stageOf = React.useCallback(
    (c: Client): PipelineStage => (copyPageId ? membership?.get(c.id) ?? c.stage : c.stage),
    [copyPageId, membership],
  )

  /**
   * Mover DENTRO de uma cópia grava só a etapa local. `clients.stage` continua sendo a verdade do
   * Pipeline original e do que alimenta funil, Dashboard e relatórios — por isso a cópia não pode
   * escrever nele. Devolve true quando tratou o movimento (ou seja, estamos numa cópia).
   */
  const moveInCopy = React.useCallback(
    (c: Client, to: PipelineStage): boolean => {
      if (!copyPageId) return false
      setMembership((prev) => {
        const next = new Map(prev ?? [])
        next.set(c.id, to)
        return next
      })
      supportPagesService.setClientStage(copyPageId, c.id, to).catch((err: Error) => {
        toast.error('Não deu pra mover: ' + err.message)
        void reloadMembership()
      })
      toast.success(`${c.name} → ${STAGE_COLORS[to].label}`)
      return true
    },
    [copyPageId, reloadMembership],
  )

  const advanceStage = (c: Client) => {
    const next = NEXT_STAGE[stageOf(c)]
    if (!next) { toast.info('Cliente já está na etapa final'); return }
    if (moveInCopy(c, next)) return
    // Entrar em configuração passa pela regra de simultâneas.
    if (next === 'setup') { startSetup(c); return }
    // Sair de "Em Configuração" libera a vaga do responsável.
    db.updateClient(c.id, {
      stage: next,
      ...(c.stage === 'setup' ? { setupStartedAt: undefined } : {}),
    })
    db.addLog(c.id, 'Etapa alterada', `${STAGE_COLORS[c.stage].label} → ${STAGE_COLORS[next].label}`)
    toast.success(`${c.name} → ${STAGE_COLORS[next].label}`)
  }

  const regressStage = (c: Client) => {
    const prev = PREV_STAGE[stageOf(c)]
    if (!prev) { toast.info('Cliente já está na primeira etapa'); return }
    if (moveInCopy(c, prev)) return
    db.updateClient(c.id, {
      stage: prev,
      ...(c.stage === 'setup' ? { setupStartedAt: undefined } : {}),
    })
    db.addLog(c.id, 'Etapa revertida', `${STAGE_COLORS[c.stage].label} → ${STAGE_COLORS[prev].label}`)
    toast.success(`${c.name} → ${STAGE_COLORS[prev].label}`)
  }

  return (
    <>
      <TopBar
        title={supportView?.pageName ?? 'Pipeline'}
        subtitle={
          copyPageId
            ? `${membership?.size ?? 0} cliente(s) nesta aba`
            : `${clients.length} cliente(s) no funil`
        }
        rightSlot={
          <div className="flex items-center gap-2">
            {copyPageId && (
              // Numa cópia, o botão útil é trazer quem já existe pra cá — criar cliente novo
              // continua disponível ao lado, e o novo entra no funil original como sempre.
              <Button
                variant="secondary"
                onClick={() => setAddToCopyOpen(true)}
                leftIcon={<PlusCircle className="h-4 w-4" />}
              >
                Adicionar cliente
              </Button>
            )}
            <Button
              variant="secondary"
              onClick={() => {
                const url = `${window.location.origin}/ficha`
                navigator.clipboard
                  .writeText(url)
                  .then(() => toast.success('Link de cadastro copiado'))
                  .catch(() => toast.error('Não foi possível copiar'))
              }}
              leftIcon={<LinkIcon className="h-4 w-4" />}
            >
              Link de cadastro
            </Button>
            <Button
              onClick={() => setOpenNew(true)}
              leftIcon={<PlusCircle className="h-4 w-4" />}
            >
              Novo cliente
            </Button>
          </div>
        }
      />

      <div className="px-4 py-4 sm:px-6 sm:py-6 lg:px-8">
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <Input
            placeholder="Filtrar por nome ou empresa…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            leftIcon={<Search className="h-4 w-4" />}
            containerClassName="sm:max-w-xs"
          />
          {(comercialOptions.length > 0 || entregaOptions.length > 0) && (
            <>
              {comercialOptions.length > 0 && (
                <select
                  value={filterComercial}
                  onChange={(e) => setFilterComercial(e.target.value)}
                  className="h-9 rounded-lg border border-line bg-card px-3 text-sm text-foreground focus:border-accent focus:outline-none"
                >
                  <option value="">Comercial: todos</option>
                  {comercialOptions.map((r) => (
                    <option key={r} value={r}>Comercial: {r}</option>
                  ))}
                </select>
              )}
              {entregaOptions.length > 0 && (
                <select
                  value={filterEntrega}
                  onChange={(e) => setFilterEntrega(e.target.value)}
                  className="h-9 rounded-lg border border-line bg-card px-3 text-sm text-foreground focus:border-accent focus:outline-none"
                >
                  <option value="">Entrega: todos</option>
                  {entregaOptions.map((r) => (
                    <option key={r} value={r}>Entrega: {r}</option>
                  ))}
                </select>
              )}
              {currentUser && (
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() =>
                    setFilterEntrega((v) => (v === currentUser ? '' : currentUser))
                  }
                  className={cn(filterEntrega === currentUser && 'ring-1 ring-accent/40')}
                >
                  {filterEntrega === currentUser ? 'Vendo minha carga' : 'Só minha entrega'}
                </Button>
              )}
              {(filterComercial || filterEntrega) && (
                <button
                  type="button"
                  onClick={() => { setFilterComercial(''); setFilterEntrega('') }}
                  className="text-xs text-foreground/45 underline-offset-2 hover:text-foreground/70 hover:underline"
                >
                  limpar filtros
                </button>
              )}
            </>
          )}
        </div>

        <div className="space-y-3">
          {SUPPORT_VISIBLE_STAGES.map((stage) => (
            <ListGroup
              key={stage}
              stage={stage}
              defaultOpen={stage !== 'delivered' && stage !== 'active' && stage !== 'churned'}
              clients={byStage[stage]}
              groups={groupsFor(stage)}
              onRowClick={(id) => setOpenClientId(id)}
              onAdvance={advanceStage}
              onRegress={regressStage}
              onStartSetup={startSetup}
              onPauseSetup={pauseSetup}
              headerAction={
                stage === 'setup_start' ? (
                  <Button
                    size="sm"
                    onClick={(e) => { e.stopPropagation(); pullNext() }}
                    leftIcon={<Play className="h-3.5 w-3.5" />}
                  >
                    Puxar próximo
                  </Button>
                ) : undefined
              }
            />
          ))}
        </div>
      </div>

      <ClientDrawer
        clientId={openClientId}
        onClose={() => setOpenClientId(null)}
        showCrmLeadTab
      />

      {copyPageId && (
        <AddClientsToPageModal
          open={addToCopyOpen}
          onClose={() => setAddToCopyOpen(false)}
          pageId={copyPageId}
          pageName={supportView?.pageName ?? ''}
          firstStageKey={PIPELINE_STAGES[0]}
          alreadyIn={new Set(membership?.keys() ?? [])}
          onAdded={reloadMembership}
        />
      )}

      <Modal
        open={Boolean(wipConfirm)}
        onClose={() => setWipConfirm(null)}
        title="Limite de configurações simultâneas"
        size="md"
        footer={
          <>
            <Button variant="secondary" onClick={() => setWipConfirm(null)}>
              Cancelar
            </Button>
            <Button
              onClick={() => wipConfirm && startSetup(wipConfirm.client, true)}
            >
              Começar mesmo assim
            </Button>
          </>
        }
      >
        {wipConfirm && (
          <div className="space-y-3 text-sm text-foreground/70">
            <p>
              <strong className="text-foreground">{wipConfirm.owner}</strong> já tem{' '}
              <strong className="text-foreground">{wipConfirm.count}</strong> de{' '}
              {wipConfirm.limit} configurações em andamento.
            </p>
            <div className="rounded-lg border border-line bg-elevate/[0.02] p-3">
              <div className="mb-1.5 text-[11px] uppercase tracking-wider text-foreground/45">
                Em andamento
              </div>
              <ul className="space-y-1 text-xs">
                {clients
                  .filter((c) => isDoingNow(c) && wipOwner(c) === wipConfirm.owner)
                  .map((c) => (
                    <li key={c.id} className="text-foreground/80">
                      {asText(c.name)} · {asText(c.company)}
                    </li>
                  ))}
              </ul>
            </div>
            <p className="text-xs text-foreground/45">
              O ideal é concluir ou pausar uma antes de puxar a próxima. Se
              continuar, fica registrado no histórico do cliente.
            </p>
          </div>
        )}
      </Modal>

      <Modal
        open={openNew}
        onClose={() => { setOpenNew(false); reset() }}
        title="Novo cliente"
        description="Começa na etapa 'Boas-vindas'. Avance pelo pipeline depois."
        size="md"
      >
        <form
          onSubmit={handleSubmit(onCreate)}
          className="grid grid-cols-1 gap-4 sm:grid-cols-2"
        >
          <div className="sm:col-span-2">
            <Input
              label="Nome *"
              leftIcon={<UserCircle2 className="h-4 w-4" />}
              {...register('name')}
              error={errors.name?.message}
            />
          </div>
          <div className="sm:col-span-2">
            <Input
              label="Empresa *"
              leftIcon={<Building2 className="h-4 w-4" />}
              {...register('company')}
              error={errors.company?.message}
            />
          </div>
          <div className="sm:col-span-2">
            <Input
              label="Telefone *"
              leftIcon={<Phone className="h-4 w-4" />}
              {...register('phone')}
              error={errors.phone?.message}
            />
          </div>
          <div className="sm:col-span-2 mt-2 flex items-center justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => { setOpenNew(false); reset() }}>
              Cancelar
            </Button>
            <Button type="submit" disabled={!isValid}>
              Criar cliente
            </Button>
          </div>
        </form>
      </Modal>
    </>
  )
}

function ListGroup({
  stage,
  clients,
  groups,
  defaultOpen = true,
  headerAction,
  onRowClick,
  onAdvance,
  onRegress,
  onStartSetup,
  onPauseSetup,
}: {
  stage: PipelineStage
  clients: Client[]
  /** Blocos internos da etapa. Etapas comuns recebem um único bloco sem label. */
  groups: RowGroup[]
  onRowClick: (id: string) => void
  onAdvance: (c: Client) => void
  onRegress: (c: Client) => void
  onStartSetup: (c: Client) => void
  onPauseSetup: (c: Client) => void
  headerAction?: React.ReactNode
  defaultOpen?: boolean
}) {
  const [open, setOpen] = React.useState(defaultOpen)
  const style = STAGE_COLORS[stage]
  const subdivided = groups.length > 1

  return (
    <section
      className="overflow-hidden rounded-xl border border-line bg-card"
      style={{ borderLeft: `3px solid ${style.dot}` }}
    >
      <header
        className="flex cursor-pointer select-none items-center justify-between gap-3 px-4 py-3 hover:bg-elevate/[0.02]"
        onClick={() => setOpen((o) => !o)}
      >
        <div className="flex items-center gap-2">
          {open ? (
            <ChevronDown className="h-4 w-4 text-foreground/45" />
          ) : (
            <ChevronRight className="h-4 w-4 text-foreground/45" />
          )}
          <span
            className="text-sm font-semibold uppercase tracking-wide"
            style={{ color: style.text }}
          >
            {style.label}
          </span>
          <span className="text-xs text-foreground/45">
            {clients.length} cliente{clients.length === 1 ? '' : 's'}
          </span>
          {subdivided && (
            <span className="text-[11px] text-foreground/35">
              {groups.map((g) => `${g.label}: ${g.clients.length}`).join(' · ')}
            </span>
          )}
        </div>
        {headerAction}
      </header>

      {open && (
        <div className="border-t border-line">
          {clients.length === 0 ? (
            <p className="px-4 py-6 text-center text-xs text-foreground/35">
              Nenhum cliente nesta etapa.
            </p>
          ) : (
            groups.map((g) => (
              <div key={g.key}>
                {g.label && (
                  <div
                    className={cn(
                      'flex flex-wrap items-baseline gap-x-2 gap-y-0.5 border-b border-line px-4 py-2',
                      g.tone === 'warning' ? 'bg-warning/[0.06]' : 'bg-elevate/[0.02]',
                    )}
                  >
                    <span
                      className={cn(
                        'text-[11px] font-semibold uppercase tracking-wider',
                        g.tone === 'warning' ? 'text-warning' : 'text-foreground/60',
                      )}
                    >
                      {g.label}
                    </span>
                    <span className="text-[11px] text-foreground/40">
                      {g.clients.length}
                    </span>
                    {g.hint && (
                      <span className="text-[11px] text-foreground/35">· {g.hint}</span>
                    )}
                  </div>
                )}
                {g.clients.length === 0 ? (
                  <p className="px-4 py-4 text-center text-xs text-foreground/30">
                    {g.emptyText ?? 'Nenhum cliente.'}
                  </p>
                ) : (
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-line text-[11px] uppercase tracking-wider text-foreground/40">
                        <th className="px-4 py-2 text-left font-medium">Cliente</th>
                        <th className="px-4 py-2 text-left font-medium">Empresa</th>
                        <th className="px-4 py-2 text-left font-medium">Entrada</th>
                        <th className="px-4 py-2 text-left font-medium">Na etapa</th>
                        <th className="px-4 py-2 text-left font-medium">
                          Última atualização
                        </th>
                        <th className="px-4 py-2 text-left font-medium">Alertas</th>
                        <th className="w-px px-4 py-2 text-right font-medium">
                          Ações
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {g.clients.map((c, idx) => (
                        <ClientRow
                          key={c.id}
                          client={c}
                          position={g.numbered ? idx + 1 : undefined}
                          onRowClick={onRowClick}
                          onAdvance={onAdvance}
                          onRegress={onRegress}
                          onStartSetup={onStartSetup}
                          onPauseSetup={onPauseSetup}
                        />
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            ))
          )}
        </div>
      )}
    </section>
  )
}

function ClientRow({
  client: c,
  position,
  onRowClick,
  onAdvance,
  onRegress,
  onStartSetup,
  onPauseSetup,
}: {
  client: Client
  position?: number
  onRowClick: (id: string) => void
  onAdvance: (c: Client) => void
  onRegress: (c: Client) => void
  onStartSetup: (c: Client) => void
  onPauseSetup: (c: Client) => void
}) {
  const alerts = computeAlerts(c)
  const next = NEXT_STAGE[c.stage]
  const prev = PREV_STAGE[c.stage]
  // Pendências só interessam da etapa de briefing até a configuração — depois
  // disso o cliente já está rodando e a cobrança perde sentido.
  const showReadiness =
    c.stage === 'briefing' || c.stage === 'setup_start' || c.stage === 'setup'
  const readiness = showReadiness ? computeReadiness(c) : null
  const doing = isDoingNow(c)

  return (
    <tr
      onClick={() => onRowClick(c.id)}
      className="cursor-pointer border-b border-line/60 transition-colors hover:bg-elevate/[0.03] last:border-b-0"
    >
      <td className="px-4 py-3">
        <div className="flex items-center gap-2.5">
          {position != null ? (
            <div
              title={`Posição na fila: ${position}`}
              className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-accent/10 text-[11px] font-semibold tabular-nums text-accent ring-1 ring-accent/25"
            >
              {position}
            </div>
          ) : (
            <div className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-elevate/[0.05] text-[10px] font-medium text-foreground/85 ring-1 ring-line">
              {initials(c.name) || '?'}
            </div>
          )}
          <div className="min-w-0">
            <div className="font-medium text-foreground">
              {asText(c.name, '—')}
            </div>
            {(c.responsavelComercial || c.responsavelEntrega || c.responsavel) && (
              <div className="mt-0.5 text-[10.5px] text-foreground/40">
                {[
                  c.responsavelComercial && `Com.: ${c.responsavelComercial}`,
                  c.responsavelEntrega && `Ent.: ${c.responsavelEntrega}`,
                ]
                  .filter(Boolean)
                  .join(' · ') || c.responsavel}
              </div>
            )}
            <div className="mt-0.5 flex flex-wrap items-center gap-1">
              <StageBadge stage={c.stage} size="sm" />
              {doing && (
                <span className="inline-flex items-center gap-1 rounded-full bg-success/15 px-1.5 py-0.5 text-[10px] font-medium text-success ring-1 ring-success/25">
                  <Play className="h-2.5 w-2.5" />
                  há {timeAgo(c.setupStartedAt ?? c.createdAt)}
                </span>
              )}
            </div>
          </div>
        </div>
      </td>
      <td className="px-4 py-3 text-foreground/70">
        <div>{asText(c.company, '—')}</div>
        {c.stage === 'briefing' && (
          <BriefingSubStatus briefingStatus={c.briefingStatus} />
        )}
        {readiness && readiness.blockers.length > 0 && (
          <div
            title={readiness.blockers.map((b) => `• ${b.label}`).join('\n')}
            className="mt-1 inline-flex items-center gap-1 rounded-md border border-warning/30 bg-warning/10 px-1.5 py-0.5 text-[11px] font-medium text-warning"
          >
            <Lock className="h-3 w-3 shrink-0" />
            {readiness.blockers.length} pendência
            {readiness.blockers.length === 1 ? '' : 's'} do cliente
          </div>
        )}
        {(c.stage === 'setup_start' || c.stage === 'setup' || c.stage === 'setup_done') &&
          (() => {
            const hint = checklistHint(c)
            return hint ? (
              <div className="mt-0.5 text-[10.5px] text-foreground/45">
                Checklist {hint.done}/{hint.total} · {hint.label}
              </div>
            ) : null
          })()}
        {c.deliveryDate && (
          <div className="mt-1 inline-flex items-center gap-1 rounded-md border border-accent/30 bg-accent/10 px-1.5 py-0.5 text-[11px] font-medium text-accent">
            <Calendar className="h-3 w-3 shrink-0" />
            {formatDateTimeShort(c.deliveryDate)}
          </div>
        )}
      </td>
      <td className="px-4 py-3 text-foreground/55">
        {formatDateShort(c.createdAt)}
      </td>
      <td className="px-4 py-3">
        <StageAgeBadge stage={c.stage} since={c.stageUpdatedAt ?? c.createdAt} />
      </td>
      <td className="px-4 py-3 text-foreground/55">
        <span className="inline-flex items-center gap-1">
          <Clock className="h-3 w-3" />
          {timeAgo(c.stageUpdatedAt ?? c.createdAt)}
        </span>
      </td>
      <td className="px-4 py-3">
        {alerts.length === 0 ? (
          <span className="text-xs text-foreground/30">—</span>
        ) : (
          <div className="inline-flex items-center gap-1">
            {alerts.map((a, i) => (
              <span
                key={i}
                title={a.title}
                className={cn(
                  'grid h-5 w-5 place-items-center rounded-full',
                  a.tone === 'red'
                    ? 'bg-danger/15 text-danger'
                    : 'bg-warning/15 text-warning',
                )}
              >
                <AlertTriangle className="h-3 w-3" />
              </span>
            ))}
          </div>
        )}
      </td>
      <td className="px-4 py-3 text-right">
        <div className="inline-flex items-center gap-1">
          {/* Fila: puxar para "fazendo agora". Bloqueado não puxa. */}
          {c.stage === 'setup_start' && (
            <button
              type="button"
              title={
                readiness && !readiness.ready
                  ? 'Cliente com pendências — cobre antes de configurar'
                  : 'Começar a configurar agora'
              }
              disabled={Boolean(readiness && !readiness.ready)}
              onClick={(e) => { e.stopPropagation(); onStartSetup(c) }}
              className={cn(
                'inline-flex h-7 w-7 items-center justify-center rounded-full ring-1 transition-colors',
                readiness && !readiness.ready
                  ? 'cursor-not-allowed bg-elevate/[0.03] text-foreground/20 ring-line'
                  : 'bg-success/10 text-success ring-success/30 hover:bg-success/20',
              )}
            >
              <Play className="h-3.5 w-3.5" />
            </button>
          )}
          {/* Em configuração: alterna entre fazendo agora e aguardando vez. */}
          {c.stage === 'setup' && (
            <button
              type="button"
              title={doing ? 'Pausar (volta para aguardando vez)' : 'Começar agora'}
              onClick={(e) => {
                e.stopPropagation()
                if (doing) onPauseSetup(c)
                else onStartSetup(c)
              }}
              className={cn(
                'inline-flex h-7 w-7 items-center justify-center rounded-full ring-1 transition-colors',
                doing
                  ? 'bg-elevate/[0.06] text-foreground/50 ring-line hover:bg-warning/10 hover:text-warning hover:ring-warning/30'
                  : 'bg-success/10 text-success ring-success/30 hover:bg-success/20',
              )}
            >
              {doing ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
            </button>
          )}
          <button
            type="button"
            title={prev ? `Voltar para ${STAGE_COLORS[prev].label}` : 'Sem etapa anterior'}
            disabled={!prev}
            onClick={(e) => { e.stopPropagation(); onRegress(c) }}
            className={cn(
              'inline-flex h-7 w-7 items-center justify-center rounded-full ring-1 transition-colors',
              prev
                ? 'bg-elevate/[0.06] text-foreground/50 ring-line hover:bg-warning/10 hover:text-warning hover:ring-warning/30'
                : 'cursor-not-allowed bg-elevate/[0.03] text-foreground/20 ring-line',
            )}
          >
            <ArrowUpCircle className="h-4 w-4" />
          </button>
          <button
            type="button"
            title={next ? `Avançar para ${STAGE_COLORS[next].label}` : 'Já está na etapa final'}
            disabled={!next}
            onClick={(e) => { e.stopPropagation(); onAdvance(c) }}
            className={cn(
              'inline-flex h-7 w-7 items-center justify-center rounded-full ring-1 transition-colors',
              next
                ? 'bg-accent/10 text-accent ring-accent/30 hover:bg-accent/20'
                : 'cursor-not-allowed bg-elevate/[0.03] text-foreground/25 ring-line',
            )}
          >
            <ArrowDownCircle className="h-4 w-4" />
          </button>
        </div>
      </td>
    </tr>
  )
}


/**
 * Mostra há quantos dias o cliente está na etapa atual, com cor de acordo com
 * o SLA da etapa (verde/neutro dentro do prazo, laranja no limite, vermelho
 * estourado). Ajuda o time a não deixar cliente esquecido numa etapa.
 */
function checklistHint(
  c: Client,
): { done: number; total: number; label: string } | null {
  const items = c.deliveryChecklist ?? []
  if (items.length === 0) return null
  const done = items.filter((i) => i.checked).length
  const next = items.find((i) => !i.checked)
  return {
    done,
    total: items.length,
    label: next ? next.label : 'Checklist concluído',
  }
}

function BriefingSubStatus({ briefingStatus }: { briefingStatus?: string }) {
  if (!briefingStatus || briefingStatus === 'not_sent') {
    return (
      <div className="mt-0.5 text-[10.5px] text-foreground/40">
        Briefing não gerado
      </div>
    )
  }
  if (briefingStatus === 'sent' || briefingStatus === 'revision') {
    return (
      <div className="mt-0.5 text-[10.5px] text-warning">
        Aguardando preenchimento
      </div>
    )
  }
  return null
}

interface CardAlert {
  tone: 'red' | 'orange'
  title: string
}

function computeAlerts(c: Client): CardAlert[] {
  const alerts: CardAlert[] = []
  if (c.contractSentAt && !c.contractSignedAt) {
    const days = daysSince(c.contractSentAt)
    if (days >= 3)
      alerts.push({
        tone: 'red',
        title: `Contrato enviado há ${days} dias sem assinatura`,
      })
  }
  if (
    c.briefingSentAt &&
    (c.briefingStatus === 'sent' || c.briefingStatus === 'revision')
  ) {
    const days = daysSince(c.briefingSentAt)
    if (days >= 5)
      alerts.push({
        tone: 'orange',
        title: `Briefing enviado há ${days} dias sem resposta`,
      })
  }
  if (c.paymentStatus === 'overdue') {
    alerts.push({ tone: 'red', title: 'Pagamento vencido' })
  }
  // Entregas Recentes: passados 30 dias, sinaliza para mover manualmente p/ Ativo.
  if (c.stage === 'delivered') {
    const days = daysSince(c.stageUpdatedAt ?? c.createdAt)
    if (days >= 30)
      alerts.push({
        tone: 'orange',
        title: `Entregue há ${days} dias — mover para Ativo`,
      })
  }
  return alerts
}
