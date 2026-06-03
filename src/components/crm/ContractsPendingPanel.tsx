import * as React from 'react'
import { ArrowRight, FileSignature } from 'lucide-react'
import { Badge } from '@/components/ui/Badge'
import { ClientDrawer } from '@/components/crm/ClientDrawerLazy'
import { useClients } from '@/hooks/useClients'
import { formatDateShort } from '@/lib/utils'

/**
 * Contratos pendentes: clientes que preencheram a ficha de cadastro mas ainda
 * não tiveram o contrato assinado. O operador pega os dados (aba "Ficha de
 * cadastro" do cliente), faz o contrato por fora e marca como assinado.
 */
export function ContractsPendingPanel() {
  const clients = useClients()
  const [openId, setOpenId] = React.useState<string | null>(null)

  const pending = React.useMemo(
    () =>
      clients
        .filter(
          (c) =>
            c.fichaCadastro &&
            !c.contractSignedAt &&
            c.stage !== 'active' &&
            c.stage !== 'churned',
        )
        .sort(
          (a, b) =>
            new Date(a.fichaCadastro?.submittedAt ?? a.createdAt).getTime() -
            new Date(b.fichaCadastro?.submittedAt ?? b.createdAt).getTime(),
        ),
    [clients],
  )

  return (
    <section className="rounded-2xl border border-line bg-card">
      <header className="flex items-center gap-2.5 border-b border-line px-4 py-3">
        <span className="grid h-7 w-7 place-items-center rounded-lg bg-warning/10 text-warning ring-1 ring-warning/20">
          <FileSignature className="h-3.5 w-3.5" />
        </span>
        <div className="flex-1">
          <h3 className="text-sm font-medium text-foreground">Contratos pendentes</h3>
          <p className="text-[11px] text-foreground/45">
            Ficha preenchida — montar contrato e marcar como assinado
          </p>
        </div>
        <Badge tone={pending.length === 0 ? 'neutral' : 'warning'} dot={pending.length > 0}>
          {pending.length}
        </Badge>
      </header>

      {pending.length === 0 ? (
        <p className="px-4 py-6 text-center text-xs text-foreground/40">
          Nenhum contrato pendente. 🎉
        </p>
      ) : (
        <ul className="divide-y divide-line">
          {pending.map((c) => (
            <li
              key={c.id}
              className="flex items-center gap-3 px-4 py-2.5 transition-colors hover:bg-elevate/[0.02]"
            >
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-foreground">
                  {c.company || c.name}
                </p>
                <p className="truncate text-[11px] text-foreground/50">
                  Ficha em {formatDateShort(c.fichaCadastro?.submittedAt ?? c.createdAt)}
                  {c.fichaCadastro?.cnpj ? ` · CNPJ ${c.fichaCadastro.cnpj}` : ''}
                </p>
              </div>
              <button
                onClick={() => setOpenId(c.id)}
                className="inline-flex shrink-0 items-center gap-1 rounded-lg bg-elevate/[0.06] px-2.5 py-1.5 text-xs font-medium text-foreground/70 ring-1 ring-line hover:text-accent"
              >
                Abrir <ArrowRight className="h-3.5 w-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}

      <ClientDrawer clientId={openId} onClose={() => setOpenId(null)} />
    </section>
  )
}
