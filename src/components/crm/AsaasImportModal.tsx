import * as React from 'react'
import { AlertTriangle, CheckCircle2, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { EmptyState } from '@/components/ui/EmptyState'
import { db } from '@/services/db'
import {
  linkAsaasCustomer,
  matchCustomersToCrm,
  syncAllLinked,
  type MatchResult,
} from '@/services/asaasSync'
import { asaasApi } from '@/services/asaas'
import { extractErrorMessage } from '@/api/client'

type Step = 'idle' | 'loading' | 'preview' | 'linking' | 'syncing' | 'done'

export function AsaasImportModal({
  open,
  onClose,
}: {
  open: boolean
  onClose: () => void
}) {
  const [step, setStep] = React.useState<Step>('idle')
  const [match, setMatch] = React.useState<MatchResult | null>(null)
  const [selected, setSelected] = React.useState<Set<string>>(new Set())
  const [summary, setSummary] = React.useState<string | null>(null)

  React.useEffect(() => {
    if (open && step === 'idle') void runMatch()
    if (!open) {
      setStep('idle')
      setMatch(null)
      setSelected(new Set())
      setSummary(null)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const runMatch = async () => {
    setStep('loading')
    try {
      const customers = await asaasApi.listAllCustomers()
      const clients = db.getClients()
      const r = matchCustomersToCrm(clients, customers)
      setMatch(r)
      // Pré-seleciona todas as sugestões automáticas
      setSelected(new Set(r.suggestions.map((s) => s.client.id)))
      setStep('preview')
    } catch (err) {
      toast.error(extractErrorMessage(err, 'Falha ao consultar Asaas'))
      setStep('idle')
      onClose()
    }
  }

  const toggle = (clientId: string) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(clientId)) next.delete(clientId)
      else next.add(clientId)
      return next
    })
  }

  const confirmAndSync = async () => {
    if (!match) return
    setStep('linking')

    // 1. Vincula os selecionados
    const toLink = match.suggestions.filter((s) => selected.has(s.client.id))
    for (const s of toLink) {
      linkAsaasCustomer(s.client.id, s.asaas.id)
    }

    // 2. Sincroniza pagamentos de todos os vinculados (incluindo os já vinculados)
    setStep('syncing')
    try {
      const r = await syncAllLinked()
      setSummary(
        `${toLink.length} vinculado(s). Pagamentos: ${r.inserted} novo(s), ${r.updated} atualizado(s) em ${r.clients} cliente(s).` +
          (r.errors.length > 0 ? ` ${r.errors.length} erro(s).` : ''),
      )
      setStep('done')
    } catch (err) {
      toast.error(extractErrorMessage(err, 'Falha ao sincronizar pagamentos'))
      setStep('preview')
    }
  }

  const totalCrm = db.getClients().length
  const m = match
  const stillUnlinkedAfter = m
    ? m.unmatchedCrm.length + (m.suggestions.length - selected.size)
    : 0

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Importar do Asaas"
      description="Casa clientes do CRM com customers do Asaas e importa o histórico de pagamentos."
      size="xl"
      footer={
        step === 'done' ? (
          <Button onClick={onClose}>Fechar</Button>
        ) : (
          <>
            <Button variant="secondary" onClick={onClose} disabled={step === 'linking' || step === 'syncing'}>
              Cancelar
            </Button>
            <Button
              onClick={confirmAndSync}
              disabled={step !== 'preview' || (selected.size === 0 && (m?.alreadyLinked.length ?? 0) === 0)}
              loading={step === 'linking' || step === 'syncing'}
            >
              {step === 'syncing'
                ? 'Sincronizando…'
                : step === 'linking'
                  ? 'Vinculando…'
                  : `Vincular ${selected.size} e sincronizar`}
            </Button>
          </>
        )
      }
    >
      {step === 'loading' && (
        <div className="grid place-items-center py-12 text-sm text-foreground/55">
          <span className="inline-flex items-center gap-2">
            <Loader2 className="h-4 w-4 animate-spin" />
            Consultando Asaas…
          </span>
        </div>
      )}

      {step === 'done' && summary && (
        <div className="grid place-items-center py-12 text-center">
          <CheckCircle2 className="h-10 w-10 text-success" />
          <p className="mt-3 text-sm text-foreground">Pronto!</p>
          <p className="mt-1 max-w-md text-xs text-foreground/55">{summary}</p>
        </div>
      )}

      {(step === 'preview' || step === 'linking' || step === 'syncing') && m && (
        <div className="space-y-4">
          <SummaryBar
            crmTotal={totalCrm}
            alreadyLinked={m.alreadyLinked.length}
            suggestions={m.suggestions.length}
            unmatchedCrm={m.unmatchedCrm.length}
            unmatchedAsaas={m.unmatchedAsaas.length}
          />

          {m.alreadyLinked.length > 0 && (
            <Section title="Já vinculados" tone="success" count={m.alreadyLinked.length}>
              <ul className="divide-y divide-white/[0.04]">
                {m.alreadyLinked.slice(0, 8).map(({ client, asaas }) => (
                  <li key={client.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                    <span className="text-foreground">{client.company || client.name}</span>
                    <span className="text-xs text-foreground/55">↔ {asaas.name}</span>
                  </li>
                ))}
                {m.alreadyLinked.length > 8 && (
                  <li className="py-2 text-center text-xs text-foreground/45">
                    + {m.alreadyLinked.length - 8} mais
                  </li>
                )}
              </ul>
              <p className="mt-2 text-xs text-foreground/45">
                Vão ser sincronizados automaticamente também.
              </p>
            </Section>
          )}

          {m.suggestions.length > 0 ? (
            <Section title="Sugestões de vínculo" tone="info" count={m.suggestions.length}>
              <ul className="divide-y divide-white/[0.04]">
                {m.suggestions.map(({ client, asaas, via }) => {
                  const isSelected = selected.has(client.id)
                  return (
                    <li
                      key={client.id}
                      className="flex items-center justify-between gap-3 py-2"
                    >
                      <label className="flex items-center gap-3 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => toggle(client.id)}
                          className="h-4 w-4 rounded border-line bg-surface accent-accent"
                        />
                        <div>
                          <div className="text-sm text-foreground">{client.company || client.name}</div>
                          <div className="text-xs text-foreground/55">
                            ↔ {asaas.name} · {asaas.email || asaas.cpfCnpj || asaas.id}
                          </div>
                        </div>
                      </label>
                      <Badge tone={via === 'email' ? 'success' : via === 'cpfCnpj' ? 'info' : 'warning'}>
                        via {via === 'cpfCnpj' ? 'CPF/CNPJ' : via === 'email' ? 'e-mail' : 'nome'}
                      </Badge>
                    </li>
                  )
                })}
              </ul>
            </Section>
          ) : (
            <Section title="Sugestões" tone="neutral" count={0}>
              <EmptyState
                title="Nenhuma sugestão automática"
                description="Os clientes do CRM não têm e-mail ou nome igual aos customers do Asaas. Vincule manualmente em cada card."
              />
            </Section>
          )}

          {m.unmatchedCrm.length > 0 && (
            <Section title="Clientes CRM sem match no Asaas" tone="warning" count={m.unmatchedCrm.length}>
              <p className="text-xs text-foreground/55">
                Cadastrados aqui mas não localizados na sua conta Asaas. Crie a cobrança pelo card do cliente
                ou vincule manualmente.
              </p>
            </Section>
          )}

          {m.unmatchedAsaas.length > 0 && (
            <Section title="Customers Asaas sem cliente no CRM" tone="warning" count={m.unmatchedAsaas.length}>
              <p className="text-xs text-foreground/55">
                Existem no Asaas mas não há cliente correspondente aqui. Crie-os manualmente em Clientes
                pra incluí-los no painel financeiro.
              </p>
            </Section>
          )}

          {stillUnlinkedAfter > 0 && (
            <div className="flex items-start gap-2 rounded-lg border border-warning/30 bg-warning/[0.08] px-3 py-2 text-xs text-warning">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>
                {stillUnlinkedAfter} cliente(s) ficarão sem vínculo. Você pode vincular caso a caso depois.
              </span>
            </div>
          )}
        </div>
      )}
    </Modal>
  )
}

function SummaryBar({
  crmTotal,
  alreadyLinked,
  suggestions,
  unmatchedCrm,
  unmatchedAsaas,
}: {
  crmTotal: number
  alreadyLinked: number
  suggestions: number
  unmatchedCrm: number
  unmatchedAsaas: number
}) {
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
      <Stat label="CRM total" value={crmTotal} />
      <Stat label="Já vinculados" value={alreadyLinked} tone="success" />
      <Stat label="Sugestões" value={suggestions} tone="info" />
      <Stat label="CRM sem match" value={unmatchedCrm} tone="warning" />
      <Stat label="Asaas órfãos" value={unmatchedAsaas} tone="warning" />
    </div>
  )
}

function Stat({
  label,
  value,
  tone = 'neutral',
}: {
  label: string
  value: number
  tone?: 'neutral' | 'success' | 'info' | 'warning'
}) {
  const tones = {
    neutral: 'text-foreground',
    success: 'text-success',
    info: 'text-accent',
    warning: 'text-warning',
  }
  return (
    <div className="rounded-lg border border-line bg-elevate/[0.02] px-3 py-2">
      <div className="text-[11px] uppercase tracking-wider text-foreground/45">{label}</div>
      <div className={`mt-0.5 text-lg font-semibold tabular-nums ${tones[tone]}`}>{value}</div>
    </div>
  )
}

function Section({
  title,
  count,
  tone,
  children,
}: {
  title: string
  count: number
  tone: 'success' | 'info' | 'warning' | 'neutral'
  children: React.ReactNode
}) {
  return (
    <section className="rounded-xl border border-line bg-elevate/[0.02] p-3">
      <header className="mb-2 flex items-center justify-between">
        <h4 className="text-sm font-medium text-foreground">{title}</h4>
        <Badge tone={tone}>{count}</Badge>
      </header>
      {children}
    </section>
  )
}

