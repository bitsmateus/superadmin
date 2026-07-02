import * as React from 'react'
import { Archive, RotateCcw, Search, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { TopBar } from '@/components/layout/TopBar'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { EmptyState } from '@/components/ui/EmptyState'
import { Table, THead, TBody, TR, TH, TD } from '@/components/ui/Table'
import { StageBadge } from '@/components/crm/StageBadge'
import { ClientDrawer } from '@/components/crm/ClientDrawerLazy'
import { useArchivedClients } from '@/hooks/useClients'
import { useAuth } from '@/hooks/useAuth'
import { db } from '@/services/db'
import { canDeleteClient } from '@/services/supabase'
import { asText, formatDate, initials } from '@/lib/utils'

export function ArchivedClientsPage() {
  const archived = useArchivedClients()
  const { profile } = useAuth()
  const canDelete = canDeleteClient(profile?.role)
  const [search, setSearch] = React.useState('')
  const [openClientId, setOpenClientId] = React.useState<string | null>(null)

  const filtered = React.useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return archived
    return archived.filter((c) => {
      const blob =
        asText(c.name).toLowerCase() +
        ' ' +
        asText(c.company).toLowerCase() +
        ' ' +
        asText(c.email).toLowerCase()
      return blob.includes(q)
    })
  }, [archived, search])

  const onRestore = (id: string, label: string) => {
    db.unarchiveClient(id)
    toast.success(`"${label}" restaurado`)
  }

  const onDeleteForever = (id: string, label: string) => {
    const ok = window.confirm(
      `Excluir permanentemente "${label}"?\n\n` +
        'Esta ação é irreversível e apaga o cliente, briefing, histórico e ' +
        'financeiro do banco de dados.',
    )
    if (!ok) return
    void db.removeClient(id).then(() => toast.success('Cliente excluído permanentemente'))
  }

  return (
    <>
      <TopBar
        title="Arquivados"
        subtitle={`${archived.length} cliente(s) arquivado(s)`}
      />

      <div className="px-4 py-4 sm:px-6 sm:py-6 lg:px-8">
        <div className="mb-4">
          <Input
            placeholder="Buscar por nome, empresa, e-mail…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            leftIcon={<Search className="h-4 w-4" />}
            containerClassName="sm:max-w-sm"
          />
        </div>

        {filtered.length === 0 ? (
          <EmptyState
            icon={<Archive className="h-5 w-5" />}
            title={
              archived.length === 0
                ? 'Nenhum cliente arquivado'
                : 'Nada encontrado'
            }
            description={
              archived.length === 0
                ? 'Clientes arquivados aparecem aqui. Você pode restaurá-los ou excluí-los permanentemente.'
                : 'Tente outra busca.'
            }
          />
        ) : (
          <Table>
            <THead>
              <tr>
                <TH>Nome</TH>
                <TH>Empresa</TH>
                <TH>Etapa</TH>
                <TH>Arquivado em</TH>
                <TH className="text-right">Ações</TH>
              </tr>
            </THead>
            <TBody>
              {filtered.map((c) => (
                <TR
                  key={c.id}
                  className="cursor-pointer"
                  onClick={() => setOpenClientId(c.id)}
                >
                  <TD>
                    <div className="flex items-center gap-3">
                      <div className="grid h-8 w-8 place-items-center rounded-full bg-elevate/[0.04] text-[11px] font-medium text-foreground/80 ring-1 ring-line">
                        {initials(c.name) || '?'}
                      </div>
                      <div>
                        <div className="text-sm font-medium text-foreground">
                          {asText(c.name, '—')}
                        </div>
                        <div className="text-[11px] text-foreground/40">
                          {asText(c.email)}
                        </div>
                      </div>
                    </div>
                  </TD>
                  <TD className="text-foreground/85">{asText(c.company)}</TD>
                  <TD>
                    <StageBadge stage={c.stage} />
                  </TD>
                  <TD className="text-foreground/60">
                    {formatDate(c.archivedAt)}
                  </TD>
                  <TD className="text-right">
                    <div className="inline-flex items-center gap-1.5">
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={(e) => {
                          e.stopPropagation()
                          onRestore(c.id, c.company || c.name)
                        }}
                        leftIcon={<RotateCcw className="h-3.5 w-3.5" />}
                      >
                        Restaurar
                      </Button>
                      {canDelete && (
                        <button
                          type="button"
                          title="Excluir permanentemente"
                          onClick={(e) => {
                            e.stopPropagation()
                            onDeleteForever(c.id, c.company || c.name)
                          }}
                          className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-foreground/40 ring-1 ring-line transition-colors hover:bg-danger/10 hover:text-danger hover:ring-danger/30"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      )}
                    </div>
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </div>

      <ClientDrawer
        clientId={openClientId}
        onClose={() => setOpenClientId(null)}
      />
    </>
  )
}
