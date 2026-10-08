import * as React from 'react'
import { useNavigate } from 'react-router-dom'
import { Loader2, Search } from 'lucide-react'
import { toast } from 'sonner'
import { TopBar } from '@/components/layout/TopBar'
import { AvatarCliente } from '@/components/gestaoClientes/AvatarCliente'
import { gestaoClientes, type GcSocialResumo } from '@/services/gestaoClientes'
import { cn } from '@/lib/utils'

/** Social media: todos os clientes, com o que há pra produzir, o que está em produção e quem está editando. */
export function SocialMediaPage() {
  const navegar = useNavigate()
  const [lista, setLista] = React.useState<GcSocialResumo[] | null>(null)
  const [busca, setBusca] = React.useState('')

  React.useEffect(() => {
    gestaoClientes
      .socialResumo()
      .then(setLista)
      .catch((err: Error) => {
        toast.error('Falha ao carregar: ' + err.message)
        setLista([])
      })
  }, [])

  const visiveis = (lista ?? []).filter((c) => c.nome_empresa.toLowerCase().includes(busca.trim().toLowerCase()))
  const totais = (lista ?? []).reduce(
    (t, c) => ({ para: t.para + c.para_producao, em: t.em + c.em_producao }),
    { para: 0, em: 0 },
  )

  return (
    <>
      <TopBar
        compacto
        title="Social media"
        subtitle="Clientes NX Digital"
        breadcrumbs={[
          { label: 'Grupo NX Digital', to: '/' },
          { label: 'Clientes NX Digital', to: '/clientesnxdigital/clientes' },
          { label: 'Social media' },
        ]}
      />
      <div className="space-y-4 px-4 pb-10 lg:px-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="relative w-full sm:w-72">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-foreground/40" />
            <input
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              placeholder="Buscar cliente…"
              className="h-10 w-full rounded-lg border border-line bg-surface pl-9 pr-3 text-sm text-foreground outline-none focus:border-accent"
            />
          </div>
          {lista && (
            <p className="text-xs text-foreground/55">
              <strong className="text-foreground">{totais.para}</strong> para produzir ·{' '}
              <strong className="text-foreground">{totais.em}</strong> em produção
            </p>
          )}
        </div>

        {lista === null ? (
          <div className="flex items-center justify-center gap-2 py-16 text-sm text-foreground/60">
            <Loader2 className="h-4 w-4 animate-spin" /> Carregando clientes…
          </div>
        ) : visiveis.length === 0 ? (
          <p className="py-12 text-center text-sm text-foreground/50">Nenhum cliente encontrado.</p>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {visiveis.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => navegar(`/clientesnxdigital/socialmedia/${c.id}`)}
                className="flex flex-col gap-3 rounded-2xl border border-line bg-surface p-4 text-left shadow-sm transition-all hover:-translate-y-0.5 hover:border-accent/40 hover:shadow-md"
              >
                <span className="flex items-center gap-3">
                  <AvatarCliente nome={c.nome_empresa} logoUrl={c.logo_url} className="h-10 w-10 rounded-xl text-xs" />
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-semibold text-foreground">{c.nome_empresa}</span>
                    <span className="block truncate text-xs text-foreground/50">{c.segmento || '—'}</span>
                  </span>
                </span>
                <span className="grid grid-cols-3 gap-2 text-center">
                  {[
                    { n: c.para_producao, rotulo: 'para produzir', cor: 'text-warning' },
                    { n: c.em_producao, rotulo: 'em produção', cor: 'text-accent' },
                    { n: c.prontas, rotulo: 'prontas', cor: 'text-success' },
                  ].map((x) => (
                    <span key={x.rotulo} className="rounded-lg bg-elevate/[0.04] px-1 py-1.5">
                      <span className={cn('block text-base font-semibold tabular-nums', x.n > 0 ? x.cor : 'text-foreground/30')}>{x.n}</span>
                      <span className="block text-[10px] text-foreground/45">{x.rotulo}</span>
                    </span>
                  ))}
                </span>
                <span className="flex items-center justify-between gap-2 text-xs text-foreground/55">
                  <span className="min-w-0 truncate">
                    {c.editores.length > 0 ? `Editando: ${c.editores.join(', ')}` : 'Ninguém editando'}
                  </span>
                  <span className="shrink-0">{c.materiais} arquivo(s)/link(s)</span>
                </span>
              </button>
            ))}
          </div>
        )}
      </div>
    </>
  )
}
