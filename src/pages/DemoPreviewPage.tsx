import * as React from 'react'
import { Link, useParams } from 'react-router-dom'
import { ArrowLeft, Monitor, RotateCcw, Smartphone } from 'lucide-react'
import { TopBar } from '@/components/layout/TopBar'
import { Button } from '@/components/ui/Button'
import { cn } from '@/lib/utils'

/**
 * Pré-visualização do rascunho (§4.3): o player roda num iframe, então "Celular" é um iframe de 390×844
 * de verdade — o player decide desktop/celular pela largura da janela, igual a um aparelho.
 */
export function DemoPreviewPage() {
  const { id = '' } = useParams()
  const [modo, setModo] = React.useState<'desktop' | 'celular'>('desktop')
  const [chave, setChave] = React.useState(0)
  const [empresa, setEmpresa] = React.useState('')
  const src = `/demo-studio/preview/${id}${empresa ? `?empresa=${encodeURIComponent(empresa)}` : ''}`

  return (
    <>
      <TopBar
        compacto
        title="Pré-visualizar"
        subtitle="Demo Studio"
        breadcrumbs={[{ label: 'Demo Studio', to: '/demo-studio' }, { label: 'Demos', to: '/demo-studio/demos' }, { label: 'Pré-visualizar' }]}
      />
      <div className="px-4 pb-10 lg:px-6">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <Link to={`/demo-studio/demos/${id}`} className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-sm text-foreground/60 hover:text-foreground">
            <ArrowLeft className="h-4 w-4" /> Voltar ao editor
          </Link>
          <div className="ml-auto flex items-center gap-2">
            <input
              value={empresa}
              onChange={(e) => setEmpresa(e.target.value)}
              placeholder="Testar {{empresa}}…"
              className="h-9 w-48 rounded-lg border border-line bg-transparent px-3 text-sm"
            />
            <div className="flex rounded-lg border border-line p-0.5">
              {(['desktop', 'celular'] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setModo(m)}
                  className={cn('inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm', modo === m ? 'bg-elevate/[0.08] text-foreground' : 'text-foreground/55')}
                >
                  {m === 'desktop' ? <Monitor className="h-4 w-4" /> : <Smartphone className="h-4 w-4" />}
                  {m === 'desktop' ? 'Desktop' : 'Celular'}
                </button>
              ))}
            </div>
            <Button variant="outline" size="sm" leftIcon={<RotateCcw className="h-4 w-4" />} onClick={() => setChave((k) => k + 1)}>
              Recarregar
            </Button>
          </div>
        </div>
        <div className="flex justify-center rounded-xl border border-line bg-elevate/[0.02] p-4">
          <iframe
            key={`${chave}-${modo}`}
            title="Pré-visualização da demo"
            src={src}
            className={cn('rounded-lg border border-line bg-white', modo === 'celular' ? 'h-[844px] w-[390px]' : 'h-[78vh] w-full')}
          />
        </div>
      </div>
    </>
  )
}
