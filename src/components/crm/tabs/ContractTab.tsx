import * as React from 'react'
import {
  AlertTriangle,
  Calendar,
  CheckCircle2,
  CreditCard,
  FileSignature,
  Link as LinkIcon,
  Loader2,
  RefreshCw,
} from 'lucide-react'
import { toast } from 'sonner'
import { Section, FieldLabel } from '../ClientDrawer'
import { Input } from '@/components/ui/Input'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { db } from '@/services/db'
import { asaasApi, paymentStatusFromAsaas } from '@/services/asaas'
import { formatDate } from '@/lib/utils'
import { extractErrorMessage } from '@/api/client'
import type { Client } from '@/types/client'

export function ContractTab({ client }: { client: Client }) {
  const [contractUrl, setContractUrl] = React.useState(client.contractUrl ?? '')
  React.useEffect(() => setContractUrl(client.contractUrl ?? ''), [client.id])

  const [implValue, setImplValue] = React.useState(
    client.implementationValue?.toString() ?? '',
  )
  const [monthly, setMonthly] = React.useState(
    client.monthlyValue?.toString() ?? '',
  )
  const [dueDay, setDueDay] = React.useState(client.dueDay?.toString() ?? '')

  React.useEffect(() => {
    setImplValue(client.implementationValue?.toString() ?? '')
    setMonthly(client.monthlyValue?.toString() ?? '')
    setDueDay(client.dueDay?.toString() ?? '')
  }, [client.id])

  const [creatingCharge, setCreatingCharge] = React.useState(false)
  const [checkingPayment, setCheckingPayment] = React.useState(false)

  const saveUrl = () => {
    const url = contractUrl.trim()
    if (url === (client.contractUrl ?? '')) return
    db.updateClient(client.id, { contractUrl: url || undefined })
    db.addLog(client.id, 'Link do contrato atualizado')
  }

  const markSent = () => {
    const sentAt = new Date().toISOString()
    db.updateClient(client.id, { contractSentAt: sentAt })
    db.addLog(client.id, 'Contrato marcado como enviado')
    toast.success('Contrato marcado como enviado')
  }

  const maybeAdvance = (
    base: Partial<Client>,
    signedAt?: string | null,
    paymentId?: string | null,
  ): Partial<Client> => {
    const signed = signedAt ?? client.contractSignedAt
    const payment = paymentId ?? client.asaasPaymentId
    if (client.stage === 'contract' && signed && payment) {
      return { ...base, stage: 'briefing' }
    }
    return base
  }

  const markSigned = () => {
    const signedAt = new Date().toISOString()
    const patch = maybeAdvance({ contractSignedAt: signedAt }, signedAt, null)
    db.updateClient(client.id, patch)
    db.addLog(client.id, 'Contrato assinado')
    if (patch.stage === 'briefing') {
      toast.success('Contrato assinado · etapa avançada para Briefing')
    } else if (!client.asaasPaymentId) {
      toast.success('Contrato assinado · crie a cobrança para avançar')
    } else {
      toast.success('Contrato assinado')
    }
  }

  const saveFinancials = () => {
    const next: Partial<Client> = {
      implementationValue: implValue ? Number(implValue) : undefined,
      monthlyValue: monthly ? Number(monthly) : undefined,
      dueDay: dueDay ? Number(dueDay) : undefined,
    }
    db.updateClient(client.id, next)
    db.addLog(client.id, 'Valores financeiros atualizados')
    toast.success('Valores salvos')
  }

  const createCharge = async () => {
    if (!implValue || !monthly) {
      toast.error('Informe valor de implementação e mensalidade.')
      return
    }
    setCreatingCharge(true)
    try {
      let asaasCustomerId = client.asaasCustomerId
      if (!asaasCustomerId) {
        const customer = await asaasApi.createCustomer({
          name: client.name,
          email: client.email,
          phone: client.phone,
          mobilePhone: client.phone,
        })
        asaasCustomerId = customer.id
      }
      const today = new Date()
      const dueDate = today.toISOString().slice(0, 10)
      const payment = await asaasApi.createPayment({
        customer: asaasCustomerId!,
        value: Number(implValue),
        dueDate,
        description: `Implementação — ${client.company}`,
      })

      // Calcula próxima data de vencimento. Se dueDay informado, usa o dia
      // do mês (clamp 1..28 pra evitar mês curto). Se a data resultante
      // for <= hoje, joga pro próximo mês.
      const nextDue = new Date(today)
      if (dueDay) {
        const clampedDay = Math.min(Math.max(Number(dueDay), 1), 28)
        nextDue.setDate(clampedDay)
      } else {
        // padrão: próximo mês mesma data
        nextDue.setMonth(nextDue.getMonth() + 1)
      }
      if (nextDue.getTime() <= today.getTime()) {
        nextDue.setMonth(nextDue.getMonth() + 1)
      }

      const subscription = await asaasApi.createSubscription({
        customer: asaasCustomerId!,
        value: Number(monthly),
        nextDueDate: nextDue.toISOString().slice(0, 10),
        description: `Mensalidade — ${client.company}`,
      })

      const patch = maybeAdvance(
        {
          asaasCustomerId,
          asaasPaymentId: payment.id,
          asaasSubscriptionId: subscription.id,
          implementationValue: Number(implValue),
          monthlyValue: Number(monthly),
          dueDay: dueDay ? Number(dueDay) : undefined,
          paymentStatus: paymentStatusFromAsaas(payment.status),
          lastPaymentCheck: new Date().toISOString(),
        },
        null,
        payment.id,
      )
      db.updateClient(client.id, patch)
      db.addLog(
        client.id,
        'Cobrança criada no Asaas',
        `Impl: R$ ${implValue} · Mensal: R$ ${monthly}`,
      )
      if (patch.stage === 'briefing') {
        toast.success('Cobrança criada · etapa avançada para Briefing')
      } else if (!client.contractSignedAt) {
        toast.success('Cobrança criada · marque o contrato como assinado para avançar')
      } else {
        toast.success('Cobrança criada no Asaas')
      }
    } catch (err) {
      toast.error(extractErrorMessage(err, 'Falha ao criar cobrança'))
    } finally {
      setCreatingCharge(false)
    }
  }

  const checkPayment = async () => {
    if (!client.asaasPaymentId) {
      toast.error('Nenhuma cobrança Asaas vinculada.')
      return
    }
    setCheckingPayment(true)
    try {
      const payment = await asaasApi.getPayment(client.asaasPaymentId)
      const status = paymentStatusFromAsaas(payment.status)
      db.updateClient(client.id, {
        paymentStatus: status,
        lastPaymentCheck: new Date().toISOString(),
      })
      db.addLog(client.id, 'Status de pagamento verificado', payment.status)
      toast.success(`Status: ${payment.status}`)
    } catch (err) {
      toast.error(extractErrorMessage(err, 'Falha ao verificar pagamento'))
    } finally {
      setCheckingPayment(false)
    }
  }

  const contractStatus: 'Não enviado' | 'Enviado' | 'Assinado' = client.contractSignedAt
    ? 'Assinado'
    : client.contractSentAt
      ? 'Enviado'
      : 'Não enviado'
  const contractTone =
    contractStatus === 'Assinado'
      ? 'success'
      : contractStatus === 'Enviado'
        ? 'info'
        : 'neutral'

  const paymentTone =
    client.paymentStatus === 'paid'
      ? 'success'
      : client.paymentStatus === 'overdue'
        ? 'danger'
        : 'warning'

  return (
    <div className="space-y-5">
      <Section
        title={
          <span className="flex items-center gap-2">
            <FileSignature className="h-3.5 w-3.5 text-accent" />
            Contrato
          </span>
        }
        action={<Badge tone={contractTone}>{contractStatus}</Badge>}
      >
        <div className="space-y-3">
          <Input
            label="Link do contrato (Autentique)"
            leftIcon={<LinkIcon className="h-4 w-4" />}
            placeholder="https://app.autentique.com.br/…"
            value={contractUrl}
            onChange={(e) => setContractUrl(e.target.value)}
            onBlur={saveUrl}
          />
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 text-xs text-foreground/55">
            <div>
              <FieldLabel>Enviado em</FieldLabel>
              <p className="mt-1 text-foreground/85">
                {client.contractSentAt
                  ? formatDate(client.contractSentAt)
                  : '—'}
              </p>
            </div>
            <div>
              <FieldLabel>Assinado em</FieldLabel>
              <p className="mt-1 text-foreground/85">
                {client.contractSignedAt
                  ? formatDate(client.contractSignedAt)
                  : '—'}
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center justify-end gap-2">
            <Button
              size="sm"
              variant="secondary"
              onClick={markSent}
              disabled={Boolean(client.contractSentAt)}
            >
              Marcar como enviado
            </Button>
            <Button
              size="sm"
              variant="primary"
              onClick={markSigned}
              disabled={Boolean(client.contractSignedAt)}
              leftIcon={<CheckCircle2 className="h-3.5 w-3.5" />}
            >
              Marcar como assinado
            </Button>
          </div>
        </div>
      </Section>

      {client.paymentStatus === 'overdue' && (
        <div className="flex items-start gap-2 rounded-lg border border-danger/30 bg-danger/10 px-3 py-2.5 text-sm text-danger">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            Pagamento vencido — considere bloquear o tenant até regularizar.
          </span>
        </div>
      )}

      <Section
        title={
          <span className="flex items-center gap-2">
            <CreditCard className="h-3.5 w-3.5 text-accent" />
            Cobrança (Asaas)
          </span>
        }
        action={
          client.paymentStatus ? (
            <Badge tone={paymentTone} dot>
              {client.paymentStatus === 'paid'
                ? 'Pago'
                : client.paymentStatus === 'overdue'
                  ? 'Vencido'
                  : 'Pendente'}
            </Badge>
          ) : null
        }
      >
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Input
            label="Implementação (R$)"
            type="number"
            inputMode="decimal"
            value={implValue}
            onChange={(e) => setImplValue(e.target.value)}
          />
          <Input
            label="Mensalidade (R$)"
            type="number"
            inputMode="decimal"
            value={monthly}
            onChange={(e) => setMonthly(e.target.value)}
          />
          <Input
            label="Dia de vencimento"
            type="number"
            min={1}
            max={31}
            leftIcon={<Calendar className="h-4 w-4" />}
            value={dueDay}
            onChange={(e) => {
              const raw = e.target.value
              if (!raw) {
                setDueDay('')
                return
              }
              const n = Math.min(Math.max(Number(raw), 1), 31)
              setDueDay(String(n))
            }}
          />
        </div>
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-[11px] text-foreground/40">
          <span>
            {client.asaasCustomerId
              ? `Cliente Asaas: ${client.asaasCustomerId}`
              : 'Sem cliente Asaas vinculado'}
            {client.lastPaymentCheck && (
              <> · última verificação: {formatDate(client.lastPaymentCheck)}</>
            )}
          </span>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="ghost"
              onClick={saveFinancials}
            >
              Salvar valores
            </Button>
            <Button
              size="sm"
              variant="secondary"
              onClick={checkPayment}
              loading={checkingPayment}
              leftIcon={!checkingPayment ? <RefreshCw className="h-3.5 w-3.5" /> : undefined}
              disabled={!client.asaasPaymentId}
            >
              Verificar pagamento
            </Button>
            <Button
              size="sm"
              onClick={createCharge}
              loading={creatingCharge}
              leftIcon={!creatingCharge ? <CreditCard className="h-3.5 w-3.5" /> : undefined}
            >
              Criar cobrança no Asaas
            </Button>
          </div>
        </div>
      </Section>
    </div>
  )
}
