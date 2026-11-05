import * as React from 'react'
import { ArrowLeftRight, FileText, ImagePlus, Paperclip, Plus, Sparkles, X } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/Button'
import { gestaoClientes, type GcSocialProducao } from '@/services/gestaoClientes'
import { MAX_BYTES, ehFinal, lerArquivo } from '@/lib/socialArtes'
import { cn } from '@/lib/utils'

/**
 * Uma das duas áreas de anexos do card:
 *  - "Arte final": a arte pronta. É ela que vai pro PDF, pro cliente aprovar, pro tráfego e pra postagem.
 *  - "Imagens de referência": o material que a social media mandou pra designer se inspirar.
 * Anexa pelo botão, arrastando arquivos ou colando um print (Ctrl+V cai na arte final se a designer
 * estiver criando, senão nas referências). Cada imagem pode trocar de área.
 */
export function AnexosDoCard({ demanda, papel, onMudou, colarAqui }: {
  demanda: GcSocialProducao
  papel: 'final' | 'referencia'
  onMudou: (d: GcSocialProducao) => void
  /** Esta área recebe o Ctrl+V. */
  colarAqui?: boolean
}) {
  const [enviando, setEnviando] = React.useState(false)
  const [ampliada, setAmpliada] = React.useState<string | null>(null)
  const [arrastando, setArrastando] = React.useState(false)
  const input = React.useRef<HTMLInputElement>(null)
  const anexos = (demanda.anexos ?? []).filter((a) => (papel === 'final' ? ehFinal(a) : !ehFinal(a)))
  const final = papel === 'final'

  const enviar = React.useCallback(async (arquivos: File[]) => {
    if (arquivos.length === 0) return
    setEnviando(true)
    try {
      let atual: GcSocialProducao | null = null
      for (const arquivo of arquivos) {
        if (arquivo.size > MAX_BYTES) {
          toast.error(`"${arquivo.name}" passa de 5MB — use um link do Drive pra arquivos grandes`)
          continue
        }
        const { name, type, size, dataUrl } = await lerArquivo(arquivo)
        atual = await gestaoClientes.anexarNaProducao(demanda.id, { name, type, size, dataUrl, papel })
      }
      if (atual) {
        onMudou(atual)
        if (final) toast.success('Arte final anexada')
      }
    } catch (err) {
      toast.error('Falha ao anexar: ' + (err as Error).message)
    } finally {
      setEnviando(false)
    }
  }, [demanda.id, onMudou, papel, final])

  React.useEffect(() => {
    if (!colarAqui) return
    const aoColar = (e: ClipboardEvent) => {
      const arquivos = Array.from(e.clipboardData?.files ?? [])
      if (arquivos.length === 0) return
      e.preventDefault()
      void enviar(arquivos)
    }
    window.addEventListener('paste', aoColar)
    return () => window.removeEventListener('paste', aoColar)
  }, [enviar, colarAqui])

  const remover = async (anexoId: string) => {
    if (!window.confirm('Remover esta imagem?')) return
    try {
      onMudou(await gestaoClientes.removerAnexoDaProducao(demanda.id, anexoId))
    } catch (err) {
      toast.error('Falha ao remover: ' + (err as Error).message)
    }
  }

  const trocar = async (anexoId: string) => {
    try {
      onMudou(await gestaoClientes.papelDoAnexo(demanda.id, anexoId, final ? 'referencia' : 'final'))
    } catch (err) {
      toast.error((err as Error).message)
    }
  }

  return (
    <div
      onDragOver={(e) => { e.preventDefault(); setArrastando(true) }}
      onDragLeave={() => setArrastando(false)}
      onDrop={(e) => {
        e.preventDefault()
        setArrastando(false)
        void enviar(Array.from(e.dataTransfer.files))
      }}
      className={cn(
        'rounded-xl border p-3 transition-colors',
        final ? 'border-accent/30 bg-accent/[0.03]' : 'border-line',
        arrastando && 'border-accent bg-accent/[0.06]',
      )}
    >
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
            {final ? <Sparkles className="h-4 w-4 text-accent" /> : <Paperclip className="h-4 w-4 text-foreground/50" />}
            {final ? 'Arte final' : 'Imagens de referência'}
            {anexos.length > 0 && <span className="text-xs font-normal text-foreground/45">{anexos.length}</span>}
          </p>
          <p className="text-[11px] text-foreground/45">
            {final ? 'A arte pronta: vai pro cliente aprovar, pro PDF, pro tráfego e pra postagem.' : 'Material de apoio pra designer. Não vai pro cliente.'}
          </p>
        </div>
        <Button
          size="sm"
          variant={final ? 'primary' : 'secondary'}
          loading={enviando}
          leftIcon={final ? <ImagePlus className="h-3.5 w-3.5" /> : <Plus className="h-3.5 w-3.5" />}
          onClick={() => input.current?.click()}
        >
          {final ? 'Adicionar arte final' : 'Adicionar referência'}
        </Button>
        <input
          ref={input}
          type="file"
          multiple
          accept={final ? 'image/*,video/*' : 'image/*,video/*,.pdf'}
          className="hidden"
          onChange={(e) => {
            void enviar(Array.from(e.target.files ?? []))
            e.target.value = ''
          }}
        />
      </div>
      {anexos.length === 0 ? (
        <p className="rounded-lg border border-dashed border-line px-3 py-4 text-center text-xs text-foreground/40">
          {final
            ? 'Arraste a arte pronta aqui, cole (Ctrl+V) ou clique em Adicionar arte final. Mais de uma imagem vira carrossel.'
            : 'Arraste as imagens de referência aqui ou clique em Adicionar referência.'}
        </p>
      ) : (
        <div className={cn('grid gap-2', final ? 'grid-cols-2 sm:grid-cols-3' : 'grid-cols-3 sm:grid-cols-5')}>
          {anexos.map((a) => (
            <div key={a.id} className="group relative overflow-hidden rounded-lg border border-line bg-surface">
              {a.type.startsWith('image/') ? (
                <button type="button" onClick={() => setAmpliada(a.dataUrl)} className="block w-full" title={a.name}>
                  <img src={a.dataUrl} alt={a.name} className={cn('w-full object-cover', final ? 'h-36' : 'h-20')} />
                </button>
              ) : a.type.startsWith('video/') ? (
                <video src={a.dataUrl} className={cn('w-full bg-black object-cover', final ? 'h-36' : 'h-20')} muted controls={final} />
              ) : (
                <a href={a.dataUrl} download={a.name} title={`Baixar ${a.name}`} className="flex h-20 w-full flex-col items-center justify-center gap-1 bg-elevate/[0.03] px-2 text-foreground/45">
                  <FileText className="h-6 w-6" />
                  <span className="w-full truncate text-center text-[10px]">{a.name}</span>
                </a>
              )}
              <div className="absolute right-1 top-1 flex gap-1 opacity-0 transition-opacity group-hover:opacity-100 max-sm:opacity-100">
                {/^(image|video)\//.test(a.type) && (
                  <button
                    type="button"
                    onClick={() => void trocar(a.id)}
                    className="rounded-md bg-black/55 p-1 text-white hover:bg-accent"
                    aria-label={final ? 'Mover para referências' : 'Usar como arte final'}
                    title={final ? 'Mover para referências' : 'Usar como arte final'}
                  >
                    <ArrowLeftRight className="h-3 w-3" />
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => void remover(a.id)}
                  className="rounded-md bg-black/55 p-1 text-white hover:bg-danger"
                  aria-label="Remover imagem"
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
      {ampliada && (
        <button
          type="button"
          onClick={() => setAmpliada(null)}
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 p-4"
          aria-label="Fechar imagem"
        >
          <img src={ampliada} alt="" className="max-h-full max-w-full object-contain" />
        </button>
      )}
    </div>
  )
}
