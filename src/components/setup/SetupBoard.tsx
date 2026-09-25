import * as React from 'react'
import { useNavigate } from 'react-router-dom'
import { Modal } from '@/components/ui/Modal'
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
}

/**
 * Quadro "Configuração de clientes": as mesmas 5 colunas pra todo cliente, cada card na etapa em que ele
 * está. Clicar no card abre o mesmo painel que existe dentro do cliente (marcar, criar tenant, gerar
 * chatbot/IA, entrega…).
 */
export function SetupBoard({ clients }: { clients: Client[] }) {
  const navigate = useNavigate()
  const [openId, setOpenId] = React.useState<string | null>(null)

  const columns = React.useMemo(() => {
    const by: Record<SetupStepKey, Card[]> = { briefing: [], tenant: [], config: [], test: [], delivery: [] }
    for (const c of clients) {
      if (!SETUP_BOARD_STAGES.includes(c.stage)) continue
      const s = computeSetup(c)
      if (!s.current) continue
      const cur = s.steps.find((x) => x.key === s.current)!
      by[s.current].push({
        client: c,
        current: s.current,
        percent: s.percent,
        pending: cur.items.find((i) => !i.checked)?.label ?? null,
        doneCount: cur.doneCount,
        total: cur.items.length,
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
  }, [clients])

  const openClient = openId ? clients.find((c) => c.id === openId) : undefined

  return (
    <>
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
        {SETUP_STEP_ORDER.map((k) => (
          <div key={k} className="min-w-0 rounded-xl border border-line bg-elevate/[0.02]">
            <div className="flex items-center justify-between border-b border-line px-3 py-2">
              <span className="text-sm font-medium text-foreground">{SETUP_STEP_LABEL[k]}</span>
              <span className="rounded-full bg-elevate/[0.06] px-2 text-[11px] text-foreground/55">{columns[k].length}</span>
            </div>
            <div className="max-h-[70vh] space-y-2 overflow-y-auto p-2">
              {columns[k].length === 0 && <p className="px-1 py-3 text-center text-[11px] text-foreground/35">Ninguém aqui</p>}
              {columns[k].map((card) => (
                <button
                  key={card.client.id}
                  type="button"
                  onClick={() => setOpenId(card.client.id)}
                  className="w-full rounded-lg border border-line bg-card px-2.5 py-2 text-left transition-colors hover:border-accent/40"
                >
                  <div className="truncate text-xs font-medium text-foreground">{asText(card.client.company || card.client.name)}</div>
                  <div className="mt-0.5 truncate text-[11px] text-foreground/50">
                    {card.pending ? `Falta: ${card.pending}` : 'Etapa completa'}
                  </div>
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
