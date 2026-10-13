import * as React from 'react'
import { FileText, Image as ImageIcon, Loader2, Paperclip, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { gestaoClientes, type GcArquivo } from '@/services/gestaoClientes'
import { cn } from '@/lib/utils'

/** Mesmo teto do servidor: o arquivo vai pro banco como data URL. */
const MAX_BYTES = 10 * 1024 * 1024

function tamanhoLegivel(bytes: number): string {
  if (!bytes) return ''
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function lerComoDataUrl(arquivo: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const leitor = new FileReader()
    leitor.onload = () => resolve(leitor.result as string)
    leitor.onerror = reject
    leitor.readAsDataURL(arquivo)
  })
}

/**
 * Arquivos guardados no cliente, numa área da ficha ("planejamento" ou "informacoes"). Subiu, já está salvo —
 * não depende do botão Salvar do texto. Imagem e PDF abrem numa aba nova; o resto baixa.
 */
export function AnexosDaArea({
  clienteId, area, titulo = 'Arquivos', ajuda,
}: {
  clienteId: string
  area: GcArquivo['area']
  titulo?: string
  ajuda?: string
}) {
  const [lista, setLista] = React.useState<GcArquivo[] | null>(null)
  const [enviando, setEnviando] = React.useState(false)
  const [abrindo, setAbrindo] = React.useState<string | null>(null)
  const [arrastando, setArrastando] = React.useState(false)
  const entrada = React.useRef<HTMLInputElement>(null)

  React.useEffect(() => {
    let vivo = true
    setLista(null)
    gestaoClientes
      .arquivos(clienteId, area)
      .then((l) => vivo && setLista(l))
      .catch((err: Error) => {
        if (vivo) setLista([])
        toast.error('Falha ao carregar os arquivos: ' + err.message)
      })
    return () => {
      vivo = false
    }
  }, [clienteId, area])

  const enviar = async (arquivos: File[]) => {
    if (!arquivos.length) return
    setEnviando(true)
    try {
      for (const f of arquivos) {
        if (f.size > MAX_BYTES) {
          toast.error(`"${f.name || 'arquivo'}" passa de 10MB`)
          continue
        }
        try {
          const dataUrl = await lerComoDataUrl(f)
          const criado = await gestaoClientes.anexarArquivo(clienteId, {
            area,
            nome: f.name || (f.type.startsWith('image/') ? 'print.png' : 'arquivo'),
            tipo: f.type,
            dataUrl,
          })
          setLista((l) => [criado, ...(l ?? [])])
        } catch (err) {
          toast.error(`Não consegui enviar "${f.name}": ` + (err as Error).message)
        }
      }
    } finally {
      setEnviando(false)
      if (entrada.current) entrada.current.value = ''
    }
  }

  const abrir = async (a: GcArquivo) => {
    setAbrindo(a.id)
    try {
      const c = await gestaoClientes.conteudoDoArquivo(a.id)
      const blob = await (await fetch(c.dataUrl)).blob()
      const url = URL.createObjectURL(blob)
      const naTela = a.tipo.startsWith('image/') && a.tipo !== 'image/svg+xml' || a.tipo === 'application/pdf'
      if (naTela) {
        window.open(url, '_blank', 'noopener')
      } else {
        const link = document.createElement('a')
        link.href = url
        link.download = a.nome
        link.click()
      }
      setTimeout(() => URL.revokeObjectURL(url), 60_000)
    } catch (err) {
      toast.error('Não consegui abrir o arquivo: ' + (err as Error).message)
    } finally {
      setAbrindo(null)
    }
  }

  const excluir = async (a: GcArquivo) => {
    if (!window.confirm(`Excluir "${a.nome}"? Não dá pra desfazer.`)) return
    try {
      await gestaoClientes.excluirArquivo(a.id)
      setLista((l) => (l ?? []).filter((x) => x.id !== a.id))
    } catch (err) {
      toast.error('Falha ao excluir: ' + (err as Error).message)
    }
  }

  return (
    <section
      className={cn('mt-4 rounded-xl border border-dashed p-3.5 transition-colors', arrastando ? 'border-accent bg-accent/[0.05]' : 'border-line')}
      onDragOver={(e) => { e.preventDefault(); setArrastando(true) }}
      onDragLeave={() => setArrastando(false)}
      onDrop={(e) => { e.preventDefault(); setArrastando(false); void enviar(Array.from(e.dataTransfer.files)) }}
      onPaste={(e) => {
        const colados = Array.from(e.clipboardData?.files ?? [])
        if (colados.length) { e.preventDefault(); void enviar(colados) }
      }}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <h3 className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
            <Paperclip className="h-3.5 w-3.5 text-accent" /> {titulo}
            {lista && lista.length > 0 && <span className="text-xs font-normal tabular-nums text-foreground/45">{lista.length}</span>}
          </h3>
          <p className="text-xs text-foreground/50">{ajuda ?? 'Arraste os arquivos pra cá, cole um print ou use o botão. Fica salvo no cliente (até 10MB cada).'}</p>
        </div>
        <input ref={entrada} type="file" multiple className="hidden" onChange={(e) => void enviar(Array.from(e.target.files ?? []))} />
        <button
          type="button"
          onClick={() => entrada.current?.click()}
          disabled={enviando}
          className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-surface px-3 py-1.5 text-xs font-medium text-foreground/80 hover:border-accent/40 disabled:opacity-60"
        >
          {enviando ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Paperclip className="h-3.5 w-3.5" />}
          Adicionar arquivo
        </button>
      </div>

      {lista === null ? (
        <p className="mt-3 flex items-center gap-2 text-xs text-foreground/45"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Carregando…</p>
      ) : lista.length > 0 ? (
        <ul className="mt-3 divide-y divide-line/60 rounded-lg border border-line">
          {lista.map((a) => (
            <li key={a.id} className="flex items-center gap-2.5 px-3 py-2">
              {a.tipo.startsWith('image/') ? <ImageIcon className="h-4 w-4 shrink-0 text-foreground/40" /> : <FileText className="h-4 w-4 shrink-0 text-foreground/40" />}
              <button
                type="button"
                onClick={() => void abrir(a)}
                className="min-w-0 flex-1 truncate text-left text-sm text-foreground hover:text-accent hover:underline"
                title="Abrir"
              >
                {abrindo === a.id ? 'Abrindo…' : a.nome}
              </button>
              <span className="hidden shrink-0 text-xs text-foreground/45 sm:inline">
                {[tamanhoLegivel(a.tamanho), a.autor, new Date(a.created_at).toLocaleDateString('pt-BR')].filter(Boolean).join(' · ')}
              </span>
              <button
                type="button"
                onClick={() => void excluir(a)}
                className="rounded p-1.5 text-foreground/35 hover:bg-danger/10 hover:text-danger"
                aria-label={`Excluir ${a.nome}`}
                title="Excluir"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  )
}
