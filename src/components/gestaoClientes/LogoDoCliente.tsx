import * as React from 'react'
import { ImagePlus, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/Button'
import { AvatarCliente } from '@/components/gestaoClientes/AvatarCliente'
import { gestaoClientes } from '@/services/gestaoClientes'

/** Reduz a imagem pra caber em 256px e devolve um data URL PNG (a logo fica guardada no próprio cadastro). */
function reduzir(arquivo: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(arquivo)
    const img = new Image()
    img.onload = () => {
      const lado = 256
      const escala = Math.min(1, lado / Math.max(img.width, img.height))
      const c = document.createElement('canvas')
      c.width = Math.max(1, Math.round(img.width * escala))
      c.height = Math.max(1, Math.round(img.height * escala))
      c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height)
      URL.revokeObjectURL(url)
      resolve(c.toDataURL('image/png'))
    }
    img.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('Não consegui ler essa imagem'))
    }
    img.src = url
  })
}

/** Envia/troca/remove a logo do cliente. Aparece na lista, no kanban, no portal e no PDF do relatório. */
export function LogoDoCliente({
  clienteId, nome, logoUrl, onMudou,
}: {
  clienteId: string
  nome: string
  logoUrl: string | null
  onMudou: () => Promise<void> | void
}) {
  const entrada = React.useRef<HTMLInputElement>(null)
  const [salvando, setSalvando] = React.useState(false)

  const salvar = async (valor: string) => {
    setSalvando(true)
    try {
      await gestaoClientes.atualizar(clienteId, { logo_url: valor })
      await onMudou()
      toast.success(valor ? 'Logo salva' : 'Logo removida')
    } catch (err) {
      toast.error('Falha ao salvar a logo: ' + (err as Error).message)
    } finally {
      setSalvando(false)
    }
  }

  const escolher = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const arquivo = e.target.files?.[0]
    e.target.value = ''
    if (!arquivo) return
    if (!arquivo.type.startsWith('image/')) {
      toast.error('Escolha um arquivo de imagem (PNG, JPG…)')
      return
    }
    try {
      await salvar(await reduzir(arquivo))
    } catch (err) {
      toast.error((err as Error).message)
    }
  }

  return (
    <div className="flex items-center gap-3">
      <AvatarCliente nome={nome} logoUrl={logoUrl} className="h-14 w-14 rounded-2xl text-base" />
      <div className="min-w-0">
        <p className="text-sm font-medium text-foreground">Logo do cliente</p>
        <p className="mb-1.5 text-xs text-foreground/50">Aparece na lista, no portal e no relatório em PDF.</p>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" size="sm" loading={salvando} leftIcon={<ImagePlus className="h-3.5 w-3.5" />} onClick={() => entrada.current?.click()}>
            {logoUrl ? 'Trocar logo' : 'Enviar logo'}
          </Button>
          {logoUrl && (
            <Button variant="ghost" size="sm" leftIcon={<Trash2 className="h-3.5 w-3.5" />} onClick={() => void salvar('')}>
              Remover
            </Button>
          )}
        </div>
      </div>
      <input ref={entrada} type="file" accept="image/*" className="hidden" onChange={(e) => void escolher(e)} />
    </div>
  )
}
