import * as React from 'react'
import { Download, FileText, ImagePlus, Loader2, Play, X } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
import { gestaoClientes, type GcSocialMaterial } from '@/services/gestaoClientes'

const MAX_BYTES = 5 * 1024 * 1024

function lerArquivo(arquivo: File): Promise<NonNullable<GcSocialMaterial['anexo']>> {
  return new Promise((resolve, reject) => {
    const leitor = new FileReader()
    leitor.onload = () =>
      resolve({
        id: crypto.randomUUID(),
        name: arquivo.name || (arquivo.type.startsWith('image/') ? 'imagem.png' : 'arquivo'),
        type: arquivo.type,
        size: arquivo.size,
        dataUrl: leitor.result as string,
      })
    leitor.onerror = reject
    leitor.readAsDataURL(arquivo)
  })
}

/**
 * Fotos, vídeos e arquivos do cliente. É a mesma biblioteca da aba Social media: o que se anexa no briefing
 * aparece lá pra designer, e vice-versa. Cada arquivo até 5MB; maiores, use um link do Drive.
 */
export function ArquivosDoCliente({ clienteId }: { clienteId: string }) {
  const [arquivos, setArquivos] = React.useState<GcSocialMaterial[] | null>(null)
  const [enviando, setEnviando] = React.useState(false)
  const [ampliado, setAmpliado] = React.useState<GcSocialMaterial | null>(null)
  const entrada = React.useRef<HTMLInputElement>(null)

  const carregar = React.useCallback(async () => {
    try {
      const r = await gestaoClientes.social(clienteId)
      setArquivos(r.materiais.filter((m) => m.tipo === 'arquivo'))
    } catch (err) {
      toast.error('Falha ao carregar os arquivos: ' + (err as Error).message)
      setArquivos([])
    }
  }, [clienteId])

  React.useEffect(() => {
    void carregar()
  }, [carregar])

  const enviar = async (lista: File[]) => {
    if (lista.length === 0) return
    setEnviando(true)
    try {
      for (const arquivo of lista) {
        if (arquivo.size > MAX_BYTES) {
          toast.error(`"${arquivo.name}" passa de 5MB — use um link do Drive pra arquivos grandes`)
          continue
        }
        await gestaoClientes.criarSocialMaterial(clienteId, { tipo: 'arquivo', anexo: await lerArquivo(arquivo) })
      }
      await carregar()
    } catch (err) {
      toast.error('Falha ao enviar: ' + (err as Error).message)
    } finally {
      setEnviando(false)
    }
  }

  const remover = async (m: GcSocialMaterial) => {
    if (!window.confirm('Remover este arquivo?')) return
    try {
      await gestaoClientes.excluirSocialMaterial(m.id)
      await carregar()
    } catch (err) {
      toast.error('Falha ao remover: ' + (err as Error).message)
    }
  }

  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-foreground/50">Fotos, vídeos e documentos do cliente (até 5MB cada; maiores, use um link do Drive).</p>
        <Button variant="secondary" size="sm" loading={enviando} leftIcon={<ImagePlus className="h-4 w-4" />} onClick={() => entrada.current?.click()}>
          Enviar fotos, vídeos e arquivos
        </Button>
        <input
          ref={entrada}
          type="file"
          multiple
          accept="image/*,video/*,.pdf,.doc,.docx,.xls,.xlsx,.zip,.psd,.ai"
          className="hidden"
          onChange={(e) => {
            void enviar(Array.from(e.target.files ?? []))
            e.target.value = ''
          }}
        />
      </div>

      {arquivos === null ? (
        <div className="flex items-center gap-2 py-4 text-sm text-foreground/50">
          <Loader2 className="h-4 w-4 animate-spin" /> Carregando…
        </div>
      ) : arquivos.length === 0 ? (
        <p className="rounded-xl border border-dashed border-line px-3 py-6 text-center text-sm text-foreground/40">Nenhum arquivo ainda.</p>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {arquivos.map((m) => {
            const tipo = m.anexo?.type ?? ''
            return (
              <div key={m.id} className="overflow-hidden rounded-xl border border-line">
                {tipo.startsWith('image/') ? (
                  <button type="button" onClick={() => setAmpliado(m)} className="block w-full" title={m.titulo}>
                    <img src={m.anexo!.dataUrl} alt={m.titulo} className="h-28 w-full object-cover" />
                  </button>
                ) : tipo.startsWith('video/') ? (
                  <button type="button" onClick={() => setAmpliado(m)} className="relative block h-28 w-full bg-black" title={m.titulo}>
                    <video src={m.anexo!.dataUrl} className="h-full w-full object-cover" muted preload="metadata" />
                    <span className="absolute inset-0 grid place-items-center bg-black/30 text-white">
                      <Play className="h-8 w-8" />
                    </span>
                  </button>
                ) : (
                  <a href={m.anexo?.dataUrl} download={m.anexo?.name} className="flex h-28 w-full flex-col items-center justify-center gap-1 bg-elevate/[0.03] text-foreground/40" title="Baixar">
                    <FileText className="h-8 w-8" />
                    <Download className="h-3.5 w-3.5" />
                  </a>
                )}
                <div className="flex items-center justify-between gap-1 border-t border-line px-2 py-1.5">
                  <p className="min-w-0 truncate text-[11px] text-foreground/65">{m.titulo}</p>
                  <button type="button" onClick={() => void remover(m)} className="shrink-0 text-foreground/30 hover:text-danger" aria-label="Remover arquivo">
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      )}

      <Modal open={!!ampliado} onClose={() => setAmpliado(null)} size="2xl" title={ampliado?.titulo}>
        {ampliado?.anexo &&
          (ampliado.anexo.type.startsWith('video/') ? (
            <video src={ampliado.anexo.dataUrl} controls autoPlay className="max-h-[70vh] w-full" />
          ) : (
            <img src={ampliado.anexo.dataUrl} alt={ampliado.titulo} className="max-h-[70vh] w-full object-contain" />
          ))}
      </Modal>
    </div>
  )
}
