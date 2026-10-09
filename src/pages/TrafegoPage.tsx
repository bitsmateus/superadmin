import * as React from 'react'
import { Loader2, RefreshCw } from 'lucide-react'
import { toast } from 'sonner'
import { TopBar } from '@/components/layout/TopBar'
import { cn } from '@/lib/utils'
import { trafegoService, type FiltroPapel } from '@/services/trafego'
import { VisaoGeralTab } from '@/components/trafego/VisaoGeralTab'
import { CampanhasTab } from '@/components/trafego/CampanhasTab'
import { CriativosTab } from '@/components/trafego/CriativosTab'
import { NichosTab } from '@/components/trafego/NichosTab'
import { AlertasTab } from '@/components/trafego/AlertasTab'

const ABAS = [
  { id: 'geral', label: 'Visão geral' },
  { id: 'campanhas', label: 'Campanhas' },
  { id: 'criativos', label: 'Criativos' },
  { id: 'nichos', label: 'Nichos' },
  { id: 'alertas', label: 'Alertas e IA' },
] as const
type AbaId = (typeof ABAS)[number]['id']

const PERIODOS = [
  { dias: 7, label: '7 dias' },
  { dias: 14, label: '14 dias' },
  { dias: 30, label: '30 dias' },
  { dias: 90, label: '90 dias' },
] as const

const PAPEIS: { id: FiltroPapel; label: string }[] = [
  { id: 'todos', label: 'Todos' },
  { id: 'escala', label: 'Escala' },
  { id: 'teste', label: 'Teste' },
]

/** Data de São Paulo (YYYY-MM-DD) deslocada em `dias` — mesmo fuso que o servidor usa. */
function dataSp(dias: number): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' })
    .format(new Date(Date.now() - dias * 86_400_000))
}

function Pilula({ ativo, onClick, children, className }: { ativo: boolean; onClick: () => void; children: React.ReactNode; className?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors',
        // No celular: alvo de toque de 32px e sem quebrar o rótulo.
        'max-sm:shrink-0 max-sm:whitespace-nowrap max-sm:py-2',
        ativo ? 'bg-accent/10 text-accent ring-1 ring-accent/20' : 'text-foreground/50 hover:bg-elevate/[0.04]',
        className,
      )}
    >
      {children}
    </button>
  )
}

/** Aba Tráfego (admin/supervisor): gasto do Meta cruzado com o funil do CRM. */
export function TrafegoPage() {
  const [aba, setAba] = React.useState<AbaId>('geral')
  const [dias, setDias] = React.useState<number>(30)
  const [papel, setPapel] = React.useState<FiltroPapel>('todos')
  const [versao, setVersao] = React.useState(0)
  const [sincronizando, setSincronizando] = React.useState(false)

  const de = dataSp(dias - 1)
  const ate = dataSp(0)
  const usaPapel = aba === 'campanhas' || aba === 'criativos'

  const sincronizar = async () => {
    setSincronizando(true)
    try {
      await trafegoService.sincronizar()
      toast.success('Dados do Meta atualizados')
      setVersao((v) => v + 1)
    } catch (e) {
      toast.error('Falha ao sincronizar: ' + (e as Error).message)
    } finally {
      setSincronizando(false)
    }
  }

  return (
    <>
      <TopBar
        title="Tráfego"
        subtitle="Gasto dos anúncios do Meta cruzado com o funil do CRM"
        titleClassName="text-xl font-semibold lg:text-[36px]"
        breadcrumbs={[{ label: 'Grupo NX Digital', to: '/' }, { label: 'Tráfego' }]}
      />
      <div className="flex min-h-screen flex-col gap-4 bg-bg px-4 py-4 sm:px-6 sm:py-6 lg:px-8">
        {/* No celular: abas numa faixa que rola de lado; embaixo, períodos (esticados) + sincronizar só com o ícone,
         * e o filtro de papel numa linha própria. Do sm pra cima fica tudo como sempre. */}
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line bg-card p-3 max-sm:gap-2 max-sm:p-2">
          <div className="flex flex-wrap items-center gap-1.5 max-sm:w-full max-sm:flex-nowrap max-sm:gap-1 max-sm:overflow-x-auto max-sm:p-px max-sm:[scrollbar-width:none] max-sm:[&::-webkit-scrollbar]:hidden">
            {ABAS.map((a) => <Pilula key={a.id} ativo={aba === a.id} onClick={() => setAba(a.id)}>{a.label}</Pilula>)}
          </div>
          <div className="flex flex-wrap items-center gap-3 max-sm:w-full max-sm:gap-2 max-sm:border-t max-sm:border-line max-sm:pt-2">
            {usaPapel && (
              <div className="flex items-center gap-1 max-sm:order-last max-sm:w-full">
                {PAPEIS.map((p) => <Pilula key={p.id} ativo={papel === p.id} onClick={() => setPapel(p.id)} className="max-sm:flex-1">{p.label}</Pilula>)}
              </div>
            )}
            <div className="flex items-center gap-1 max-sm:min-w-0 max-sm:flex-1">
              {PERIODOS.map((p) => <Pilula key={p.dias} ativo={dias === p.dias} onClick={() => setDias(p.dias)} className="max-sm:flex-1 max-sm:px-1">{p.label}</Pilula>)}
            </div>
            <button
              type="button"
              onClick={() => void sincronizar()}
              disabled={sincronizando}
              className="inline-flex items-center gap-1.5 rounded-md border border-line px-2.5 py-1.5 text-xs font-medium text-foreground/60 hover:bg-elevate/[0.04] disabled:opacity-50 max-sm:h-8 max-sm:w-8 max-sm:shrink-0 max-sm:justify-center max-sm:p-0"
            >
              {sincronizando ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
              <span className="max-sm:sr-only">Sincronizar agora</span>
            </button>
          </div>
        </div>

        {aba === 'geral' && <VisaoGeralTab de={de} ate={ate} versao={versao} />}
        {aba === 'campanhas' && <CampanhasTab de={de} ate={ate} papel={papel} versao={versao} />}
        {aba === 'criativos' && <CriativosTab de={de} ate={ate} papel={papel} versao={versao} />}
        {aba === 'nichos' && <NichosTab de={de} ate={ate} versao={versao} />}
        {aba === 'alertas' && <AlertasTab versao={versao} />}
      </div>
    </>
  )
}
