import * as React from 'react'
import { useNavigate } from 'react-router-dom'
import { AlertTriangle } from 'lucide-react'
import { Modal } from '@/components/ui/Modal'
import { useSettings } from '@/hooks/useClients'
import { resolveStageSla } from '@/constants/stageColors'
import { daysSince } from '@/lib/time'
import { SetupPanel } from '@/components/crm/setup/SetupPanel'
import { SETUP_BOARD_STAGES, SETUP_STEP_ORDER, SETUP_STEP_LABEL, computeSetup, type SetupStepKey } from '@/lib/setupSteps'
import { asText, cn } from '@/lib/utils'
import type { Client } from '@/types/client'

interface Card {
  client: Client
  current: SetupStepKey
  percent: number
  pending: string | null
  doneCount: number
  total: number
  /** Dias parado na etapa do pipeline e quanto passou do prazo (0 = dentro do prazo). */
  days: number
  over: number
}

const NO_OWNER = '__none__'

/**
 * Quadro "Configuração de clientes": as mesmas 5 colunas pra todo cliente, cada card na etapa em que ele
 * está. Clicar no card abre o mesmo painel que existe dentro do cliente (marcar, criar tenant, gerar
 * chatbot/IA, entrega…).
 */
export function SetupBoard({ clients }: { clients: Client[] }) {
  const navigate = useNavigate()
  const settings = useSettings()
  const [openId, setOpenId] = React.useState<string | null>(null)
  const [owner, setOwner] = React.useState('')
  const [onlyLate, setOnlyLate] = React.useState(false)

  // Responsáveis pela entrega presentes nos clientes do quadro.
  const owners = React.useMemo(() => {
    const set = new Set<string>()
    for (const c of clients) if (SETUP_BOARD_STAGES.includes(c.stage) && c.responsavelEntrega) set.add(c.responsavelEntrega)
    return [...set].sort((a, b) => a.localeCompare(b, 'pt-BR'))
  }, [clients])

  const columns = React.useMemo(() => {
    const by: Record<SetupStepKey, Card[]> = { briefing: [], tenant: [], config: [], test: [], delivery: [] }
    for (const c of clients) {
      if (!SETUP_BOARD_STAGES.includes(c.stage)) continue
      if (owner === NO_OWNER ? c.responsavelEntrega : owner && c.responsavelEntrega !== owner) continue
      const s = computeSetup(c)
      if (!s.current) continue
      const sla = resolveStageSla(c.stage, settings.slaByStage)
      const days = daysSince(c.stageUpdatedAt ?? c.createdAt)
      const over = sla != null && days > sla ? days - sla : 0
      if (onlyLate && over === 0) continue
      const cur = s.steps.find((x) => x.key === s.current)!
      by[s.current].push({
        client: c,
        current: s.current,
        percent: s.percent,
        pending: cur.items.find((i) => !i.checked)?.label ?? null,
        doneCount: cur.doneCount,
        total: cur.items.length,
        days,
        over,
      })
    }
    for (const k of SETUP_STEP_ORDER) {
      by[k].sort(
        (a, b) =>
          new Date(a.client.stageUpdatedAt ?? a.client.createdAt).getTime() -
          new Date(b.client.stageUpdatedAt ?? b.client.createdAt).getTime(),
      )
    }
    return by
  }, [clients, owner, onlyLate, settings.slaByStage])

  const lateCount = SETUP_STEP_ORDER.reduce((n, k) => n + columns[k].filter((c) => c.over > 0).length, 0)

  const openClient = openId ? clients.find((c) => c.id === openId) : undefined

  return (
    <>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <select
          value={owner}
          onChange={(e) => setOwner(e.target.value)}
          className="h-8 rounded-lg border border-line bg-elevate/[0.04] px-2 text-xs text-foreground/70 outline-none focus:border-accent/40"
        >
          <option value="">Entrega: todos</option>
          <option value={NO_OWNER}>Sem responsável</option>
          {owners.map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={() => setOnlyLate((v) => !v)}
          className={cn(
            'inline-flex h-8 items-center gap-1.5 rounded-lg border px-2.5 text-xs font-medium transition-colors',
            lateCount > 0 || onlyLate
              ? 'border-warning/40 bg-warning/10 text-warning'
              : 'border-line text-foreground/45',
            onlyLate && 'ring-1 ring-warning/50',
          )}
        >
          <AlertTriangle className="h-3.5 w-3.5" />
          {lateCount > 0 ? `${lateCount} parado(s) além do prazo` : 'Nenhum parado além do prazo'}
        </button>
      </div>

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
        {SETUP_STEP_ORDER.map((k) => (
          <div key={k} className="min-w-0 rounded-xl border border-line bg-elevate/[0.02]">
            <div className="flex items-center justify-between border-b border-line px-3 py-2">
              <span className="text-sm font-medium text-foreground">{SETUP_STEP_LABEL[k]}</span>
              <span className="flex items-center gap-1.5">
                {columns[k].some((c) => c.over > 0) && <AlertTriangle className="h-3.5 w-3.5 text-warning" />}
                <span className="rounded-full bg-elevate/[0.06] px-2 text-[11px] text-foreground/55">{columns[k].length}</span>
              </span>
            </div>
            <div className="max-h-[70vh] space-y-2 overflow-y-auto p-2">
              {columns[k].length === 0 && <p className="px-1 py-3 text-center text-[11px] text-foreground/35">Ninguém aqui</p>}
              {columns[k].map((card) => (
                <button
                  key={card.client.id}
                  type="button"
                  onClick={() => setOpenId(card.client.id)}
                  className={cn(
                    'w-full rounded-lg border bg-card px-2.5 py-2 text-left transition-colors hover:border-accent/40',
                    card.over > 0 ? 'border-warning/50 bg-warning/[0.04]' : 'border-line',
                  )}
                >
                  <div className="truncate text-xs font-medium text-foreground">{asText(card.client.company || card.client.name)}</div>
                  <div className="mt-0.5 truncate text-[11px] text-foreground/50">
                    {card.pending ? `Falta: ${card.pending}` : 'Etapa completa'}
                  </div>
                  {card.over > 0 && (
                    <div className="mt-1 inline-flex items-center gap-1 text-[10px] font-medium text-warning">
                      <AlertTriangle className="h-3 w-3" />
                      Parado há {card.days}d ({card.over}d além do prazo)
                    </div>
                  )}
                  <div className="mt-1.5 flex items-center gap-2">
                    <div className="h-1 flex-1 overflow-hidden rounded-full bg-elevate/[0.08]">
                      <div className={cn('h-full bg-accent')} style={{ width: `${card.percent}%` }} />
                    </div>
                    <span className="text-[10px] text-foreground/40">{card.percent}%</span>
                  </div>
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>

      <Modal
        open={Boolean(openClient)}
        onClose={() => setOpenId(null)}
        title={openClient ? asText(openClient.company || openClient.name) : ''}
        size="lg"
      >
        {openClient && (
          <SetupPanel
            client={openClient}
            onGoTo={() => {
              setOpenId(null)
              navigate(`/clients?open=${openClient.id}`)
            }}
          />
        )}
      </Modal>
    </>
  )
}
