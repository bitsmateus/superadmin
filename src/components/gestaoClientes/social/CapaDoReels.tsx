import * as React from 'react'
import { ImagePlus, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
import { gestaoClientes, type GcSocialAnexo, type GcSocialProducao } from '@/services/gestaoClientes'
import { quadroDoVideo } from '@/lib/socialArtes'

/**
 * Escolher a capa do Reels: arrasta a barra até o quadro que quer (a prévia já mostra no formato do Reels, 9:16)
 * e clica em "Usar este quadro", ou sobe uma imagem pronta. A capa fica no anexo do vídeo e vai junto na publicação.
 */
export function CapaDoReels({ aberto, onFechar, demanda, video, onMudou, arquivoLocal, capaAtual, onEscolher }: {
  aberto: boolean
  onFechar: () => void
  /** Vídeo que já está num card… */
  demanda?: GcSocialProducao
  video?: GcSocialAnexo | undefined
  onMudou?: (d: GcSocialProducao) => void
  /** …ou um arquivo ainda no computador (antes de subir): a capa volta por onEscolher. */
  arquivoLocal?: File
  capaAtual?: string
  onEscolher?: (dataUrl: string) => void
}) {
  const [fonte, setFonte] = React.useState('')
  const [carregando, setCarregando] = React.useState(false)
  const [duracao, setDuracao] = React.useState(0)
  const [tempo, setTempo] = React.useState(0)
  const [salvando, setSalvando] = React.useState(false)
  const player = React.useRef<HTMLVideoElement>(null)
  const input = React.useRef<HTMLInputElement>(null)

  // Vídeos novos ficam no servidor (precisa do login pra baixar); os antigos vêm embutidos no card.
  React.useEffect(() => {
    if (!aberto || (!video && !arquivoLocal)) return
    setTempo(0)
    setDuracao(0)
    if (arquivoLocal) {
      const u = URL.createObjectURL(arquivoLocal)
      setFonte(u)
      return () => {
        URL.revokeObjectURL(u)
        setFonte('')
      }
    }
    if (!video) return
    if (!video.videoId) {
      setFonte(video.dataUrl)
      return
    }
    let url = ''
    let cancelado = false
    setCarregando(true)
    gestaoClientes
      .baixarVideo(video.videoId)
      .then((b) => {
        if (cancelado) return
        url = URL.createObjectURL(b)
        setFonte(url)
      })
      .catch((e: Error) => toast.error('Não consegui abrir o vídeo: ' + e.message))
      .finally(() => !cancelado && setCarregando(false))
    return () => {
      cancelado = true
      if (url) URL.revokeObjectURL(url)
      setFonte('')
    }
  }, [aberto, video?.id, arquivoLocal]) // eslint-disable-line react-hooks/exhaustive-deps

  const salvar = async (dataUrl: string) => {
    if (onEscolher) {
      onEscolher(dataUrl)
      onFechar()
      return
    }
    if (!video || !demanda || !onMudou) return
    setSalvando(true)
    try {
      onMudou(await gestaoClientes.definirCapaDoAnexo(demanda.id, video.id, dataUrl))
      toast.success('Capa do Reels salva')
      onFechar()
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setSalvando(false)
    }
  }

  const usarQuadro = () => {
    const v = player.current
    if (!v) return
    try {
      void salvar(quadroDoVideo(v))
    } catch {
      toast.error('Não consegui capturar o quadro. Tente subir uma imagem.')
    }
  }

  const subirImagem = (arquivo: File | undefined) => {
    if (!arquivo) return
    if (!/^image\/(png|jpeg|webp)$/.test(arquivo.type)) return void toast.error('Envie JPG ou PNG.')
    if (arquivo.size > 3 * 1024 * 1024) return void toast.error('A imagem passa de 3MB.')
    const leitor = new FileReader()
    leitor.onload = () => void salvar(String(leitor.result))
    leitor.readAsDataURL(arquivo)
  }

  return (
    <Modal
      open={aberto}
      onClose={() => !salvando && onFechar()}
      size="lg"
      title="Capa do Reels"
      description="Escolha o quadro do vídeo ou envie uma imagem. A capa aparece no formato do Reels (vertical, 9:16)."
      footer={
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Button variant="secondary" size="sm" disabled={salvando} leftIcon={<ImagePlus className="h-3.5 w-3.5" />} onClick={() => input.current?.click()}>
            Enviar imagem
          </Button>
          <input ref={input} type="file" accept="image/png,image/jpeg" className="hidden" onChange={(e) => { subirImagem(e.target.files?.[0]); e.target.value = '' }} />
          <div className="flex gap-2">
            <Button variant="ghost" disabled={salvando} onClick={onFechar}>Cancelar</Button>
            <Button loading={salvando} disabled={!fonte || carregando} onClick={usarQuadro}>Usar este quadro</Button>
          </div>
        </div>
      }
    >
      <div className="flex flex-wrap items-start justify-center gap-6">
        <div className="w-52 shrink-0">
          <p className="mb-1 text-xs font-medium text-foreground/70">Prévia (9:16)</p>
          <div className="relative aspect-[9/16] w-full overflow-hidden rounded-xl bg-black">
            {fonte ? (
              <video
                ref={player}
                src={fonte}
                muted
                playsInline
                preload="auto"
                className="h-full w-full object-cover"
                onLoadedMetadata={(e) => setDuracao(e.currentTarget.duration || 0)}
                onTimeUpdate={(e) => setTempo(e.currentTarget.currentTime)}
              />
            ) : (
              <span className="absolute inset-0 flex items-center justify-center text-white/60">
                {carregando ? <Loader2 className="h-6 w-6 animate-spin" /> : 'Sem vídeo'}
              </span>
            )}
          </div>
        </div>
        <div className="min-w-[220px] flex-1 space-y-3">
          <label className="block text-xs font-medium text-foreground/70">
            Quadro do vídeo · {tempo.toFixed(1)}s{duracao ? ` de ${duracao.toFixed(1)}s` : ''}
            <input
              type="range"
              min={0}
              max={duracao || 1}
              step={0.1}
              value={Math.min(tempo, duracao || 1)}
              disabled={!duracao}
              onChange={(e) => {
                const t = Number(e.target.value)
                setTempo(t)
                if (player.current) player.current.currentTime = t
              }}
              className="mt-2 w-full accent-[var(--color-accent,#6366f1)]"
            />
          </label>
          {(capaAtual ?? video?.capa) && (
            <div>
              <p className="mb-1 text-xs font-medium text-foreground/70">Capa atual</p>
              <img src={capaAtual ?? video?.capa} alt="Capa atual" className="aspect-[9/16] w-20 rounded-lg object-cover" />
            </div>
          )}
          <p className="text-[11px] text-foreground/45">Se não escolher, o Instagram usa o primeiro quadro do vídeo.</p>
        </div>
      </div>
    </Modal>
  )
}
