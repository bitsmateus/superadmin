import * as React from 'react'
import {
  FileText, Image as ImageIcon, Paperclip, Pin, PinOff, Send, Trash2, X,
} from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/Button'
import { Textarea } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
import { Badge } from '@/components/ui/Badge'
import { Modal } from '@/components/ui/Modal'
import {
  TIPOS_HISTORICO, gestaoClientes,
  type GcAnexo, type GcRegistroHistorico, type GcTipoHistorico,
} from '@/services/gestaoClientes'
import { cn } from '@/lib/utils'

/** Mesmo teto dos anexos do CRM: data URL grande demais engorda a linha no banco e a resposta. */
const MAX_BYTES = 5 * 1024 * 1024

const TOM: Partial<Record<GcTipoHistorico, 'info' | 'warning' | 'danger' | 'neutral'>> = {
  reuniao: 'info',
  ligacao: 'info',
  reclamacao: 'danger',
  ajuste: 'warning',
}

function rotuloTipo(tipo: GcTipoHistorico): string {
  if (tipo === 'evento_sistema') return 'Sistema'
  return TIPOS_HISTORICO.find((t) => t.valor === tipo)?.label ?? tipo
}

function quando(iso: string): string {
  const data = new Date(iso)
  const dias = Math.floor((Date.now() - data.getTime()) / 86400000)
  const exato = data.toLocaleString('pt-BR', {
    day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
  })
  if (dias === 0) return `hoje ${data.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`
  if (dias === 1) return 'ontem'
  if (dias < 30) return `há ${dias} dias`
  return exato
}

/** Lê os arquivos como data URL — é assim que o resto do projeto guarda anexo. */
async function lerArquivos(arquivos: File[]): Promise<GcAnexo[]> {
  const prontos: GcAnexo[] = []
  for (const arquivo of arquivos) {
    if (arquivo.size > MAX_BYTES) {
      toast.error(`"${arquivo.name || 'arquivo'}" passa de 5MB`)
      continue
    }
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const leitor = new FileReader()
      leitor.onload = () => resolve(leitor.result as string)
      leitor.onerror = reject
      leitor.readAsDataURL(arquivo)
    })
    prontos.push({
      id: crypto.randomUUID(),
      name: arquivo.name || (arquivo.type.startsWith('image/') ? 'print.png' : 'arquivo'),
      type: arquivo.type,
      size: arquivo.size,
      dataUrl,
    })
  }
  return prontos
}

function baixar(anexo: GcAnexo) {
  const link = document.createElement('a')
  link.href = anexo.dataUrl
  link.download = anexo.name
  link.click()
}

/** Miniatura do anexo: imagem abre ampliada, arquivo baixa. */
function Anexo({ anexo, onAmpliar }: { anexo: GcAnexo; onAmpliar: (a: GcAnexo) => void }) {
  if (anexo.type.startsWith('image/')) {
    return (
      <button
        type="button"
        onClick={() => onAmpliar(anexo)}
        className="overflow-hidden rounded-lg border border-line transition-colors hover:border-accent/50"
        title={anexo.name}
      >
        <img src={anexo.dataUrl} alt={anexo.name} className="h-24 w-36 object-cover" />
      </button>
    )
  }
  return (
    <button
      type="button"
      onClick={() => baixar(anexo)}
      className="flex items-center gap-1.5 rounded-lg border border-line px-2.5 py-1.5 text-xs text-foreground/70 transition-colors hover:border-accent/50 hover:text-foreground"
    >
      <FileText className="h-3.5 w-3.5" />
      <span className="max-w-[160px] truncate">{anexo.name}</span>
    </button>
  )
}

/**
 * Notas do cliente — o bloco de notas compartilhado da equipe, no mesmo lugar do histórico.
 *
 * Qualquer um da equipe escreve, todos leem, e fica registrado com autor e hora. Aceita print:
 * Ctrl+V na caixa cola a imagem direto (é como o pessoal manda prova de campanha, de conversa, de
 * painel). Os eventos automáticos — etapa concluída, relatório publicado, status trocado — entram
 * na mesma linha do tempo, pra "o que aconteceu com esse cliente?" ter uma resposta só.
 *
 * Nota fixada sobe pro topo e aparece também na Visão geral: é onde ficam os combinados que todo
 * mundo precisa ver antes de falar com o cliente.
 *
 * Evento do sistema não é editável nem apagável pela tela: o que o sistema registrou aconteceu.
 */
export function AbaNotas({
  historico,
  clienteId,
  onMudou,
}: {
  historico: GcRegistroHistorico[]
  clienteId: string
  onMudou: () => Promise<void> | void
}) {
  const [tipo, setTipo] = React.useState<GcTipoHistorico>('nota')
  const [texto, setTexto] = React.useState('')
  const [pendentes, setPendentes] = React.useState<GcAnexo[]>([])
  const [fixar, setFixar] = React.useState(false)
  const [salvando, setSalvando] = React.useState(false)
  const [ampliado, setAmpliado] = React.useState<GcAnexo | null>(null)
  const [filtro, setFiltro] = React.useState<'tudo' | 'equipe' | 'sistema'>('tudo')
  const inputArquivo = React.useRef<HTMLInputElement>(null)

  const registrar = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!texto.trim() && pendentes.length === 0) return
    setSalvando(true)
    try {
      await gestaoClientes.registrar(clienteId, {
        tipo,
        descricao: texto.trim(),
        fixado: fixar,
        anexos: pendentes,
      })
      setTexto('')
      setPendentes([])
      setFixar(false)
      await onMudou()
    } catch (err) {
      toast.error('Falha ao registrar: ' + (err as Error).message)
    } finally {
      setSalvando(false)
    }
  }

  const agir = async (fn: () => Promise<unknown>) => {
    try {
      await fn()
      await onMudou()
    } catch (err) {
      toast.error('Falha ao salvar: ' + (err as Error).message)
    }
  }

  const colar = async (e: React.ClipboardEvent) => {
    const arquivos = Array.from(e.clipboardData?.files ?? [])
    if (arquivos.length === 0) return
    // Só segura o evento quando havia arquivo: colar texto tem que continuar funcionando normal.
    e.preventDefault()
    const lidos = await lerArquivos(arquivos)
    setPendentes((p) => [...p, ...lidos])
  }

  const visiveis = historico.filter((r) => {
    if (filtro === 'equipe') return r.tipo !== 'evento_sistema'
    if (filtro === 'sistema') return r.tipo === 'evento_sistema'
    return true
  })
  const daEquipe = historico.filter((r) => r.tipo !== 'evento_sistema').length

  return (
    <div className="space-y-4">
      <form onSubmit={registrar} className="rounded-xl border border-line p-3">
        <Textarea
          rows={3}
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          onPaste={colar}
          placeholder="Escreva o que a equipe precisa saber — e cole o print com Ctrl+V."
        />

        {pendentes.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-2">
            {pendentes.map((a) => (
              <div
                key={a.id}
                className="flex items-center gap-1.5 rounded-md border border-line bg-elevate/[0.03] px-2 py-1 text-xs text-foreground/70"
              >
                {a.type.startsWith('image/') ? (
                  <ImageIcon className="h-3.5 w-3.5" />
                ) : (
                  <FileText className="h-3.5 w-3.5" />
                )}
                <span className="max-w-[140px] truncate">{a.name}</span>
                <button
                  type="button"
                  onClick={() => setPendentes((p) => p.filter((x) => x.id !== a.id))}
                  className="text-foreground/40 hover:text-danger"
                  aria-label="Remover anexo"
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            ))}
          </div>
        )}

        <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <Select
              options={TIPOS_HISTORICO.map((t) => ({ value: t.valor, label: t.label }))}
              value={tipo}
              onChange={(e) => setTipo(e.target.value as GcTipoHistorico)}
              className="w-40"
            />
            <input
              ref={inputArquivo}
              type="file"
              multiple
              className="hidden"
              onChange={async (e) => {
                const lidos = await lerArquivos(Array.from(e.target.files ?? []))
                setPendentes((p) => [...p, ...lidos])
                e.target.value = ''
              }}
            />
            <Button
              type="button"
              variant="ghost"
              size="sm"
              leftIcon={<Paperclip className="h-3.5 w-3.5" />}
              onClick={() => inputArquivo.current?.click()}
            >
              Anexar
            </Button>
            <button
              type="button"
              onClick={() => setFixar((f) => !f)}
              className={cn(
                'flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs transition-colors',
                fixar
                  ? 'border-accent/40 bg-accent/10 text-accent'
                  : 'border-line text-foreground/55 hover:text-foreground',
              )}
            >
              <Pin className="h-3.5 w-3.5" />
              {fixar ? 'será fixada no topo' : 'fixar no topo'}
            </button>
          </div>
          <Button
            type="submit"
            loading={salvando}
            disabled={!texto.trim() && pendentes.length === 0}
            leftIcon={<Send className="h-4 w-4" />}
          >
            Registrar
          </Button>
        </div>
      </form>

      <div className="flex items-center gap-1 text-xs">
        {(
          [
            { valor: 'tudo', label: `Tudo (${historico.length})` },
            { valor: 'equipe', label: `Da equipe (${daEquipe})` },
            { valor: 'sistema', label: `Do sistema (${historico.length - daEquipe})` },
          ] as const
        ).map((f) => (
          <button
            key={f.valor}
            type="button"
            onClick={() => setFiltro(f.valor)}
            className={cn(
              'rounded-full px-2.5 py-1 transition-colors',
              filtro === f.valor
                ? 'bg-elevate/[0.07] text-foreground'
                : 'text-foreground/50 hover:text-foreground/80',
            )}
          >
            {f.label}
          </button>
        ))}
      </div>

      {visiveis.length === 0 ? (
        <p className="py-8 text-center text-sm text-foreground/50">
          Nada aqui ainda. O que for escrito fica registrado com autor e hora.
        </p>
      ) : (
        <ol className="space-y-2">
          {visiveis.map((r) => (
            <li
              key={r.id}
              className={cn(
                'group rounded-xl border border-line px-4 py-3',
                r.fixado && 'border-accent/30 bg-accent/[0.03]',
              )}
            >
              <div className="flex items-start gap-2">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    {r.fixado && <Pin className="h-3.5 w-3.5 text-accent" />}
                    <Badge tone={TOM[r.tipo] ?? 'neutral'}>{rotuloTipo(r.tipo)}</Badge>
                    {r.titulo && <span className="font-medium text-foreground">{r.titulo}</span>}
                    <span className="text-xs text-foreground/45">
                      {quando(r.created_at)}
                      {r.autor_nome ? ` · ${r.autor_nome}` : ''}
                    </span>
                  </div>
                  {r.descricao && (
                    <p className="mt-1 whitespace-pre-wrap text-sm text-foreground/85">{r.descricao}</p>
                  )}
                  {(r.anexos ?? []).length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-2">
                      {r.anexos.map((a) => (
                        <Anexo key={a.id} anexo={a} onAmpliar={setAmpliado} />
                      ))}
                    </div>
                  )}
                </div>
                {r.tipo !== 'evento_sistema' && (
                  <div className="flex shrink-0 items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                    <button
                      type="button"
                      onClick={() =>
                        void agir(() => gestaoClientes.atualizarRegistro(r.id, { fixado: !r.fixado }))
                      }
                      className="text-foreground/30 hover:text-accent"
                      aria-label={r.fixado ? 'Desafixar' : 'Fixar no topo'}
                    >
                      {r.fixado ? <PinOff className="h-3.5 w-3.5" /> : <Pin className="h-3.5 w-3.5" />}
                    </button>
                    <button
                      type="button"
                      onClick={() => void agir(() => gestaoClientes.excluirRegistro(r.id))}
                      className="text-foreground/30 hover:text-danger"
                      aria-label="Excluir registro"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                )}
              </div>
            </li>
          ))}
        </ol>
      )}

      <Modal
        open={!!ampliado}
        onClose={() => setAmpliado(null)}
        size="2xl"
        title={ampliado?.name}
        footer={
          ampliado ? (
            <div className="flex justify-end">
              <Button variant="secondary" onClick={() => baixar(ampliado)}>
                Baixar
              </Button>
            </div>
          ) : undefined
        }
      >
        {ampliado && (
          <img src={ampliado.dataUrl} alt={ampliado.name} className="max-h-[70vh] w-full object-contain" />
        )}
      </Modal>
    </div>
  )
}
