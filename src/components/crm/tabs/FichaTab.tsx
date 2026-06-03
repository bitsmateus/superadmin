import * as React from 'react'
import { ClipboardList } from 'lucide-react'
import { Section } from '../ClientDrawer'
import { asText } from '@/lib/utils'
import type { Client } from '@/types/client'

/** Aba "Ficha de cadastro" — dados que o cliente preencheu no formulário público. */
export function FichaTab({ client }: { client: Client }) {
  const f = client.fichaCadastro
  if (!f) {
    return (
      <div className="rounded-xl border border-line bg-card px-4 py-10 text-center text-sm text-foreground/45">
        Este cliente não preencheu a ficha de cadastro pública.
      </div>
    )
  }
  return (
    <div className="space-y-4">
      <Section
        title={
          <span className="flex items-center gap-2">
            <ClipboardList className="h-3.5 w-3.5 text-accent" />
            Ficha de cadastro
          </span>
        }
      >
        <dl className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2">
          <Row k="Empresa" v={client.company} />
          <Row k="CNPJ" v={f.cnpj} />
          <Row k="CPF do responsável" v={f.cpfResponsavel} />
          <Row k="Melhor dia de pagamento" v={f.paymentDay} />
          <Row k="Precisa de Nota Fiscal?" v={f.needsNF == null ? undefined : f.needsNF ? 'Sim' : 'Não'} />
          <Row k="Número (NF+Boleto)" v={f.nfNumber} />
          <Row k="E-mail (NF+Boleto)" v={f.nfEmail} />
          <Row k="Endereço completo" v={f.address} full />
        </dl>
        {f.submittedAt && (
          <p className="mt-4 text-[11px] text-foreground/40">
            Preenchida em {new Date(f.submittedAt).toLocaleString('pt-BR')}
          </p>
        )}
      </Section>
    </div>
  )
}

function Row({ k, v, full }: { k: string; v?: string; full?: boolean }) {
  return (
    <div className={full ? 'sm:col-span-2' : undefined}>
      <dt className="text-[11px] uppercase tracking-wider text-foreground/40">{k}</dt>
      <dd className="mt-0.5 text-sm text-foreground/85">{asText(v, '—')}</dd>
    </div>
  )
}
