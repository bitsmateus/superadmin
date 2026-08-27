import * as React from 'react'
import { ClipboardList, Link2, Search, Unlink } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Modal } from '@/components/ui/Modal'
import { LeadDetailModal } from '@/components/comercial/LeadDetailModal'
import { useAllLeadRows, useLeadRow } from '@/hooks/useLeadBoards'
import { suggestCrmLead } from '@/services/crmLeadLookup'

/** Vínculo do contrato com o card do CRM (SDR) do mesmo prospect — não existe ligação automática
 * garantida entre a ficha de cadastro e o CRM (cadastros separados, às vezes sem telefone
 * preenchido no CRM), então: sugere um vínculo por telefone/nome quando possível, mas SEMPRE deixa
 * a pessoa confirmar/trocar/remover à mão (contract.vendaLeadId) — inclusive pra contrato avulso,
 * sem lead nenhuma vindo do funil. "Ver dados do lead" abre o card completo de verdade
 * (LeadDetailModal, o mesmo do quadro), não um resumo à parte. */
export function LeadLinkPanel({
  clientId,
  vendaLeadId,
  onLink,
}: {
  clientId: string | null
  vendaLeadId: string | null
  onLink: (leadId: string | null) => void
}) {
  const [suggestedId, setSuggestedId] = React.useState<string | null>(null)
  const [pickerOpen, setPickerOpen] = React.useState(false)
  const [detailLeadId, setDetailLeadId] = React.useState<string | null>(null)

  React.useEffect(() => {
    if (vendaLeadId || !clientId) { setSuggestedId(null); return }
    let cancelled = false
    suggestCrmLead(clientId)
      .then((res) => { if (!cancelled) setSuggestedId(res.leadId) })
      .catch(() => { if (!cancelled) setSuggestedId(null) })
    return () => { cancelled = true }
  }, [clientId, vendaLeadId])

  const effectiveId = vendaLeadId ?? suggestedId
  const row = useLeadRow(effectiveId)
  const isSuggestion = !vendaLeadId && !!suggestedId

  return (
    <div className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-line/60 p-3">
      <div className="flex min-w-0 items-center gap-2 text-xs">
        <ClipboardList className="h-3.5 w-3.5 shrink-0 text-accent" />
        {effectiveId && row ? (
          <span className="truncate">
            <span className="font-medium text-foreground">{row.nome || row.empresa || 'Lead do CRM'}</span>
            <span className="text-foreground/40"> {row.sdr ? `— SDR ${row.sdr}` : ''}{isSuggestion ? ' (sugestão automática)' : ''}</span>
          </span>
        ) : (
          <span className="text-foreground/40">Nenhuma lead do CRM vinculada.</span>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {effectiveId && row && (
          <Button size="sm" variant="secondary" onClick={() => setDetailLeadId(effectiveId)}>Ver dados do lead</Button>
        )}
        <Button size="sm" variant="secondary" onClick={() => setPickerOpen(true)} leftIcon={<Link2 className="h-3.5 w-3.5" />}>
          {vendaLeadId ? 'Trocar vínculo' : effectiveId ? 'Confirmar/trocar' : 'Vincular lead'}
        </Button>
        {vendaLeadId && (
          <Button size="sm" variant="ghost" onClick={() => onLink(null)} leftIcon={<Unlink className="h-3.5 w-3.5" />}>
            Desvincular
          </Button>
        )}
      </div>

      <LeadPickerModal open={pickerOpen} onClose={() => setPickerOpen(false)} onSelect={(id) => onLink(id)} />
      <LeadDetailModal leadRowId={detailLeadId} onClose={() => setDetailLeadId(null)} />
    </div>
  )
}

function LeadPickerModal({
  open,
  onClose,
  onSelect,
}: {
  open: boolean
  onClose: () => void
  onSelect: (leadId: string) => void
}) {
  const allRows = useAllLeadRows()
  const [q, setQ] = React.useState('')

  React.useEffect(() => { if (open) setQ('') }, [open])

  const results = React.useMemo(() => {
    const needle = q.trim().toLowerCase()
    if (needle.length < 2) return []
    const needleDigits = needle.replace(/\D/g, '')
    return allRows
      // vendaOrigemId marca a CÓPIA que o sistema cria sozinho na aba Vendas quando um lead vira
      // "Vendido" (mesmo nome/telefone do original) — ela nunca tem Atualizações (ficam só no
      // original), então nunca deve aparecer como opção de vínculo, senão a busca "acha" e a
      // pessoa vincula errado sem perceber que é uma cópia vazia.
      .filter((r) => !r.vendaOrigemId)
      .filter((r) => {
        if (r.nome.toLowerCase().includes(needle)) return true
        if (r.empresa.toLowerCase().includes(needle)) return true
        if (needleDigits.length >= 3 && r.telefone.replace(/\D/g, '').includes(needleDigits)) return true
        return false
      })
      .slice(0, 30)
  }, [allRows, q])

  return (
    <Modal open={open} onClose={onClose} title="Vincular a uma lead do CRM" size="md">
      <Input
        placeholder="Buscar por nome, empresa ou telefone…"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        leftIcon={<Search className="h-4 w-4" />}
        autoFocus
      />
      <div className="mt-3 max-h-80 space-y-1 overflow-y-auto">
        {results.map((r) => (
          <button
            key={r.id}
            type="button"
            onClick={() => { onSelect(r.id); onClose() }}
            className="flex w-full flex-col rounded-lg px-3 py-2 text-left transition-colors hover:bg-elevate/[0.06]"
          >
            <span className="text-sm font-medium text-foreground">{r.nome || r.empresa || 'Sem nome'}</span>
            <span className="text-xs text-foreground/50">
              {[r.empresa, r.sdr, r.status].filter(Boolean).join(' · ') || '—'}
            </span>
          </button>
        ))}
        {q.trim().length >= 2 && results.length === 0 && (
          <p className="px-3 py-6 text-center text-xs text-foreground/40">Nenhuma lead encontrada.</p>
        )}
        {q.trim().length < 2 && (
          <p className="px-3 py-6 text-center text-xs text-foreground/40">Digite ao menos 2 caracteres pra buscar.</p>
        )}
      </div>
    </Modal>
  )
}
