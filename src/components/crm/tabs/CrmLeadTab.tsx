import * as React from 'react'
import { Link2, Loader2 } from 'lucide-react'
import { Section } from '../ClientDrawer'
import { LeadLinkPanel } from '@/components/comercial/LeadLinkPanel'
import { contractsService } from '@/services/contracts'
import { fetchClientContract } from '@/services/crmLeadLookup'
import type { Client } from '@/types/client'

/** Aba "Lead do CRM" — só aparece quando o drawer é aberto a partir do Pipeline do Suporte (ver
 * showCrmLeadTab em ClientDrawerProps). Mostra a mesma lead do CRM (SDR) vinculada no contrato
 * desse cliente (aba Contrato do Comercial, ver LeadLinkPanel) — pra quem faz o atendimento
 * entender o histórico combinado com o cliente sem precisar pedir pro Financeiro/CRM em outra aba.
 * O vínculo é o mesmo em qualquer lugar que abrir (fica salvo em contracts.venda_lead_id) —
 * confirmar/trocar aqui também atualiza o que aparece na aba Contrato.
 *
 * Busca o contrato via fetchClientContract (não useContracts()) de propósito: aquele hook reflete
 * GET /api/contracts, que filtra por acesso a quadro — pro Suporte (sem permissão no Comercial)
 * isso sempre voltava vazio, e a aba dizia "cliente ainda não tem contrato" mesmo com o contrato
 * já existindo e assinado. */
export function CrmLeadTab({ client }: { client: Client }) {
  const [info, setInfo] = React.useState<{ contractId: string | null; vendaLeadId: string | null } | null>(null)

  React.useEffect(() => {
    let cancelled = false
    setInfo(null)
    fetchClientContract(client.id)
      .then((res) => { if (!cancelled) setInfo(res) })
      .catch(() => { if (!cancelled) setInfo({ contractId: null, vendaLeadId: null }) })
    return () => { cancelled = true }
  }, [client.id])

  return (
    <div className="space-y-4">
      <Section
        title={
          <span className="flex items-center gap-2">
            <Link2 className="h-3.5 w-3.5 text-accent" />
            Lead do CRM
          </span>
        }
      >
        {!info ? (
          <div className="grid min-h-[15vh] place-items-center text-sm text-foreground/50">
            <span className="inline-flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin" />Carregando…</span>
          </div>
        ) : info.contractId ? (
          <LeadLinkPanel
            clientId={client.id}
            vendaLeadId={info.vendaLeadId}
            onLink={(id) => void contractsService.updateContract(info.contractId as string, { vendaLeadId: id })}
          />
        ) : (
          <div className="rounded-xl border border-line bg-card px-4 py-10 text-center text-sm text-foreground/45">
            Este cliente ainda não tem contrato gerado — sem contrato não dá pra salvar o vínculo com uma lead do CRM.
          </div>
        )}
      </Section>
    </div>
  )
}
