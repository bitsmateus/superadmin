import * as React from 'react'
import { Link2 } from 'lucide-react'
import { Section } from '../ClientDrawer'
import { LeadLinkPanel } from '@/components/comercial/LeadLinkPanel'
import { useContracts } from '@/hooks/useContracts'
import { contractsService } from '@/services/contracts'
import type { Client } from '@/types/client'

/** Aba "Lead do CRM" — só aparece quando o drawer é aberto a partir do Pipeline do Suporte (ver
 * showCrmLeadTab em ClientDrawerProps). Mostra a mesma lead do CRM (SDR) vinculada no contrato
 * desse cliente (aba Contrato do Comercial, ver LeadLinkPanel) — pra quem faz o atendimento
 * entender o histórico combinado com o cliente sem precisar pedir pro Financeiro/CRM em outra aba.
 * O vínculo é o mesmo em qualquer lugar que abrir (fica salvo em contracts.venda_lead_id) —
 * confirmar/trocar aqui também atualiza o que aparece na aba Contrato. */
export function CrmLeadTab({ client }: { client: Client }) {
  const contracts = useContracts()
  const contract = React.useMemo(() => contracts.find((c) => c.clientId === client.id), [contracts, client.id])

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
        {contract ? (
          <LeadLinkPanel
            clientId={client.id}
            vendaLeadId={contract.vendaLeadId}
            onLink={(id) => void contractsService.updateContract(contract.id, { vendaLeadId: id })}
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
