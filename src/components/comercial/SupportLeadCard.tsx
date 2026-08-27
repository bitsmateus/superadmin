import * as React from 'react'
import { Loader2, MessageSquare } from 'lucide-react'
import { Modal } from '@/components/ui/Modal'
import { fetchSupportLeadView, type SupportLeadInfo, type SupportLeadNote } from '@/services/leadRowLookup'
import { sanitizeHtml, stripHtml } from '@/lib/richText'
import { formatDateTimeShort } from '@/lib/utils'

/** Versão de LEITURA do card do CRM — usada como fallback em LeadLinkPanel quando quem está vendo
 * (ex.: Suporte) não tem acesso reativo ao quadro (LeadDetailModal precisa de useLeadRow, que
 * depende da allowlist de quadros). Busca pontual via GET /api/lead-rows/:id/support-view, que não
 * checa essa allowlist — dados + Atualizações, sem nenhum controle de edição. */
export function SupportLeadCard({ leadId, onClose }: { leadId: string | null; onClose: () => void }) {
  const [data, setData] = React.useState<{ lead: SupportLeadInfo; notes: SupportLeadNote[] } | null>(null)
  const [loading, setLoading] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  React.useEffect(() => {
    if (!leadId) { setData(null); setError(null); return }
    let cancelled = false
    setLoading(true)
    setData(null)
    fetchSupportLeadView(leadId)
      .then((res) => { if (!cancelled) setData(res) })
      .catch((err) => { if (!cancelled) setError((err as Error).message || 'Falha ao carregar.') })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [leadId])

  return (
    <Modal open={!!leadId} onClose={onClose} title={data?.lead.nome || data?.lead.empresa || 'Lead do CRM'} size="lg">
      {loading && (
        <div className="grid min-h-[30vh] place-items-center text-sm text-foreground/50">
          <span className="inline-flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin" />Carregando…</span>
        </div>
      )}
      {error && <p className="py-10 text-center text-sm text-danger">{error}</p>}
      {data && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-x-4 gap-y-3 rounded-xl border border-line/60 p-4 text-sm sm:grid-cols-3">
            <Field label="Empresa" value={data.lead.empresa} />
            <Field label="Telefone" value={data.lead.telefone} />
            <Field label="Status" value={data.lead.status} />
            <Field label="SDR" value={data.lead.sdr} />
            <Field label="Tipo" value={data.lead.tipo} />
            <Field label="Dia de contato" value={data.lead.dia_contato} />
            <Field label="Nº atendentes" value={data.lead.numero_atendentes} />
            <Field label="Valor MRR" value={data.lead.valor_mrr ? `R$ ${data.lead.valor_mrr}` : ''} />
            <Field label="Valor implementação" value={data.lead.valor_implementacao ? `R$ ${data.lead.valor_implementacao}` : ''} />
            <Field label="Dor do cliente" value={data.lead.dor_cliente} full />
          </div>
          <div>
            <span className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-foreground/60">
              <MessageSquare className="h-3.5 w-3.5" /> Atualizações
            </span>
            <div className="max-h-[45vh] space-y-2 overflow-y-auto pr-1">
              {data.notes.length === 0 && <p className="text-xs text-foreground/40">Nenhuma atualização ainda.</p>}
              {data.notes.map((n) => (
                stripHtml(n.content) && (
                  <div key={n.id} className="rounded-lg border border-line/60 bg-elevate/[0.02] p-3 text-sm">
                    <div className="mb-1 flex items-center justify-between text-[11px] text-foreground/40">
                      <span className="font-medium text-foreground/70">{n.author_name}</span>
                      <span>{formatDateTimeShort(n.created_at)}</span>
                    </div>
                    <div
                      className="whitespace-pre-wrap text-foreground/85"
                      dangerouslySetInnerHTML={{ __html: sanitizeHtml(n.content) }}
                    />
                  </div>
                )
              ))}
            </div>
          </div>
        </div>
      )}
    </Modal>
  )
}

function Field({ label, value, full }: { label: string; value: string; full?: boolean }) {
  if (!value) return null
  return (
    <div className={full ? 'col-span-2 sm:col-span-3' : undefined}>
      <div className="text-[10px] text-foreground/40">{label}</div>
      <div className="font-medium text-foreground">{value}</div>
    </div>
  )
}
