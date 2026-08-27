import * as React from 'react'
import { ClipboardList, Loader2, MessageSquare } from 'lucide-react'
import { lookupCrmLead, type CrmLeadLookup } from '@/services/crmLeadLookup'
import { sanitizeHtml, stripHtml } from '@/lib/richText'
import { formatDateTimeShort } from '@/lib/utils'

/** Mostra, na hora de gerar/ver o contrato, o card do CRM (SDR) que provavelmente é o mesmo
 * prospect (achado por telefone — ver server/src/routes/clients.ts, GET /crm-lead) — valores
 * combinados, dor do cliente e as "Atualizações" que o SDR escreveu, pra ajudar a escrever o
 * contrato sem precisar abrir o CRM em outra aba. Fica em branco (nada renderiza) enquanto não
 * tem clientId; mostra um aviso curto se não achar nenhum lead correspondente. */
export function SdrLeadPanel({ clientId }: { clientId: string | null }) {
  const [data, setData] = React.useState<CrmLeadLookup | null>(null)
  const [loading, setLoading] = React.useState(false)

  React.useEffect(() => {
    if (!clientId) { setData(null); return }
    let cancelled = false
    setLoading(true)
    lookupCrmLead(clientId)
      .then((res) => { if (!cancelled) setData(res) })
      .catch(() => { if (!cancelled) setData({ lead: null, notes: [] }) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [clientId])

  if (!clientId) return null

  if (loading) {
    return (
      <div className="mb-4 flex items-center gap-2 rounded-xl border border-line/60 p-3 text-xs text-foreground/40">
        <Loader2 className="h-3.5 w-3.5 animate-spin" /> Procurando dados do CRM…
      </div>
    )
  }

  if (!data?.lead) {
    return (
      <p className="mb-4 text-[11px] text-foreground/40">
        Nenhum lead do CRM encontrado com o telefone desse cliente.
      </p>
    )
  }

  const { lead, notes } = data

  return (
    <div className="mb-4 overflow-hidden rounded-xl border border-line/60">
      <div className="flex flex-wrap items-center justify-between gap-2 bg-elevate/[0.02] px-3 py-2.5">
        <span className="inline-flex items-center gap-2 text-xs font-semibold text-foreground">
          <ClipboardList className="h-3.5 w-3.5 text-accent" />
          Dados do CRM {lead.sdr ? `— SDR ${lead.sdr}` : ''}
        </span>
        {lead.status && (
          <span className="rounded-full bg-accent/10 px-2 py-0.5 text-[10px] font-medium text-accent">{lead.status}</span>
        )}
      </div>
      <div className="grid grid-cols-2 gap-x-4 gap-y-2 border-t border-line/60 p-3 text-xs sm:grid-cols-4">
        <Field label="Tipo" value={lead.tipo} />
        <Field label="Dia de contato" value={lead.dia_contato} />
        <Field label="Nº atendentes" value={lead.numero_atendentes} />
        <Field label="Valor MRR" value={lead.valor_mrr ? `R$ ${lead.valor_mrr}` : ''} />
        <Field label="Valor implementação" value={lead.valor_implementacao ? `R$ ${lead.valor_implementacao}` : ''} />
        <Field label="Dor do cliente" value={lead.dor_cliente} span />
      </div>
      {notes.length > 0 && (
        <div className="border-t border-line/60 p-3">
          <span className="mb-2 flex items-center gap-1.5 text-[11px] font-medium text-foreground/50">
            <MessageSquare className="h-3 w-3" /> Atualizações do SDR
          </span>
          <div className="max-h-48 space-y-2 overflow-y-auto pr-1">
            {notes.map((n) => (
              stripHtml(n.content) && (
                <div key={n.id} className="rounded-lg bg-elevate/[0.03] p-2 text-xs">
                  <div className="mb-1 flex items-center justify-between text-[10px] text-foreground/40">
                    <span className="font-medium text-foreground/60">{n.author_name}</span>
                    <span>{formatDateTimeShort(n.created_at)}</span>
                  </div>
                  <div className="text-foreground/70" dangerouslySetInnerHTML={{ __html: sanitizeHtml(n.content) }} />
                </div>
              )
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function Field({ label, value, span }: { label: string; value: string; span?: boolean }) {
  if (!value) return null
  return (
    <div className={span ? 'col-span-2 sm:col-span-4' : undefined}>
      <div className="text-[10px] text-foreground/40">{label}</div>
      <div className="font-medium text-foreground/80">{value}</div>
    </div>
  )
}
