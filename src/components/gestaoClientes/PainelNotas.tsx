import * as React from 'react'
import {
  Clock, FileText, Image as ImageIcon, MessageSquare, Paperclip, Pin, PinOff, Send, Trash2, X,
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
  const hora = data.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
  if (dias === 0) return `hoje às ${hora}`
  if (dias === 1) return `ontem às ${hora}`
  if (dias < 30) return `há ${dias} dias`
  return data.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' })
}

/** Iniciais do autor pro avatar — quem escreveu se reconhece antes de ler o nome. */
function iniciais(nome: string | null): string {
  if (!nome) return 'NX'
  return nome
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? '')
    .join('')
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

function tamanhoLegivel(bytes: number): string {
  if (!bytes) return ''
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

/** Miniatura do anexo: imagem abre ampliada, arquivo baixa. */
function Anexo({ anexo, onAmpliar }: { anexo: GcAnexo; onAmpliar: (a: GcAnexo) => void }) {
  if (anexo.type?.startsWith('image/')) {
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

type Aba = 'atualizacoes' | 'arquivos' | 'linha'

/**
 * Notas do cliente — o bloco compartilhado da equipe, no formato do painel de lead do CRM:
 * Atualizações, Arquivos e Linha do tempo.
 *
 * ATUALIZAÇÕES é onde se escreve e onde fica o que a equipe escreveu. Ctrl+V cola print direto —
 * é como o pessoal manda prova de campanha, de conversa, de painel. Nota fixada sobe pro topo e
 * aparece também na Visão geral.
 *
 * ARQUIVOS junta os anexos de todas as notas num lugar só: procurar o print do mês passado
 * rolando a conversa inteira não é procurar, é sorte.
 *
 * LINHA DO TEMPO mistura o que a equipe escreveu com o que o sistema registrou (etapa concluída,
 * relatório publicado, avaliação trocada) — é a resposta pra "o que aconteceu com esse cliente?".
 *
 * Evento do sistema não é editável nem apagável: o que o sistema registrou aconteceu.
 */
export function PainelNotas({
  historico,
  clienteId,
  onMudou,
}: {
  historico: GcRegistroHistorico[]
  clienteId: string
  onMudou: () => Promise<void> | void
}) {
  const [aba, setAba] = React.useState<Aba>('atualizacoes')
  const [tipo, setTipo] = React.useState<GcTipoHistorico>('nota')
  const [texto, setTexto] = React.useState('')
  const [pendentes, setPendentes] = React.useState<GcAnexo[]>([])
  const [fixar, setFixar] = React.useState(false)
  const [salvando, setSalvando] = React.useState(false)
  const [ampliado, setAmpliado] = React.useState<GcAnexo | null>(null)
  const inputArquivo = React.useRef<HTMLInputElement>(null)

  const daEquipe = historico.filter((r) => r.tipo !== 'evento_sistema')
  const arquivos = historico.flatMap((r) =>
    (r.anexos ?? []).map((a) => ({ anexo: a, registro: r })),
  )

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
    const arquivosColados = Array.from(e.clipboardData?.files ?? [])
    if (arquivosColados.length === 0) return
    // Só segura o evento quando havia arquivo: colar texto tem que continuar funcionando normal.
    e.preventDefault()
    const lidos = await lerArquivos(arquivosColados)
    setPendentes((p) => [...p, ...lidos])
  }

  const abas: { valor: Aba; label: string; icone: React.ElementType; contagem: number }[] = [
    { valor: 'atualizacoes', label: 'Atualizações', icone: MessageSquare, contagem: daEquipe.length },
    { valor: 'arquivos', label: 'Arquivos', icone: Paperclip, contagem: arquivos.length },
    { valor: 'linha', label: 'Linha do tempo', icone: Clock, contagem: historico.length },
  ]

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-1 border-b border-line">
        {abas.map((a) => (
          <button
            key={a.valor}
            type="button"
            onClick={() => setAba(a.valor)}
            className={cn(
              'relative flex items-center gap-1.5 px-3 py-2 text-sm font-medium transition-colors',
              aba === a.valor ? 'text-foreground' : 'text-foreground/50 hover:text-foreground/80',
            )}
          >
            <a.icone className="h-3.5 w-3.5" />
            {a.label}
            <span className="text-xs tabular-nums text-foreground/40">{a.contagem}</span>
            {aba === a.valor && <span className="absolute inset-x-2 -bottom-px h-px bg-accent" />}
          </button>
        ))}
      </div>

      {aba === 'atualizacoes' && (
        <>
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
                  className="w-36"
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

          {daEquipe.length === 0 ? (
            <p className="py-8 text-center text-sm text-foreground/50">
              Ninguém escreveu nada ainda. O que for escrito fica com autor e hora.
            </p>
          ) : (
            <ol className="space-y-2">
              {daEquipe.map((r) => (
                <li
                  key={r.id}
                  className={cn(
                    'group rounded-xl border border-line px-4 py-3',
                    r.fixado && 'border-accent/30 bg-accent/[0.03]',
                  )}
                >
                  <div className="flex items-start gap-3">
                    <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full border border-line bg-elevate/[0.04] text-[11px] font-semibold text-foreground/70">
                      {iniciais(r.autor_nome)}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        {r.fixado && <Pin className="h-3.5 w-3.5 text-accent" />}
                        <span className="text-sm font-medium text-foreground">
                          {r.autor_nome ?? 'Equipe'}
                        </span>
                        <Badge tone={TOM[r.tipo] ?? 'neutral'}>{rotuloTipo(r.tipo)}</Badge>
                        <span className="text-xs text-foreground/45">{quando(r.created_at)}</span>
                      </div>
                      {r.descricao && (
                        <p className="mt-1 whitespace-pre-wrap text-sm text-foreground/85">
                          {r.descricao}
                        </p>
                      )}
                      {(r.anexos ?? []).length > 0 && (
                        <div className="mt-2 flex flex-wrap gap-2">
                          {r.anexos.map((a) => (
                            <Anexo key={a.id} anexo={a} onAmpliar={setAmpliado} />
                          ))}
                        </div>
                      )}
                    </div>
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
                  </div>
                </li>
              ))}
            </ol>
          )}
        </>
      )}

      {aba === 'arquivos' && (
        <>
          {arquivos.length === 0 ? (
            <p className="py-8 text-center text-sm text-foreground/50">
              Nenhum arquivo ainda. Tudo que for colado ou anexado numa atualização aparece aqui.
            </p>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {arquivos.map(({ anexo, registro }) => (
                <div key={anexo.id} className="overflow-hidden rounded-xl border border-line">
                  {anexo.type?.startsWith('image/') ? (
                    <button
                      type="button"
                      onClick={() => setAmpliado(anexo)}
                      className="block w-full"
                      title={anexo.name}
                    >
                      <img src={anexo.dataUrl} alt={anexo.name} className="h-32 w-full object-cover" />
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => baixar(anexo)}
                      className="flex h-32 w-full items-center justify-center bg-elevate/[0.03] text-foreground/40"
                    >
                      <FileText className="h-8 w-8" />
                    </button>
                  )}
                  <div className="border-t border-line px-3 py-2">
                    <p className="truncate text-xs font-medium text-foreground">{anexo.name}</p>
                    <p className="truncate text-[11px] text-foreground/45">
                      {registro.autor_nome ?? 'equipe'} · {quando(registro.created_at)}
                      {anexo.size ? ` · ${tamanhoLegivel(anexo.size)}` : ''}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {aba === 'linha' && (
        <ol className="relative space-y-3 border-l border-line pl-5">
          {historico.length === 0 && (
            <p className="py-8 text-center text-sm text-foreground/50">Nada registrado ainda.</p>
          )}
          {historico.map((r) => (
            <li key={r.id} className="relative">
              <span
                className={cn(
                  'absolute -left-[23px] top-1.5 h-2.5 w-2.5 rounded-full border-2 border-surface',
                  r.tipo === 'evento_sistema' ? 'bg-foreground/25' : 'bg-accent',
                )}
              />
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm text-foreground">
                  {r.titulo || r.descricao?.split('\n')[0] || rotuloTipo(r.tipo)}
                </span>
                <span className="text-xs text-foreground/45">
                  {quando(r.created_at)}
                  {r.autor_nome ? ` · ${r.autor_nome}` : ''}
                </span>
                {(r.anexos ?? []).length > 0 && (
                  <span className="flex items-center gap-1 text-xs text-foreground/45">
                    <Paperclip className="h-3 w-3" />
                    {r.anexos.length}
                  </span>
                )}
              </div>
              {r.titulo && r.descricao && (
                <p className="mt-0.5 whitespace-pre-wrap text-xs text-foreground/60">{r.descricao}</p>
              )}
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

/** O mesmo painel numa janela — pra abrir as notas sem sair de onde se está. */
export function ModalNotas({
  aberto,
  onFechar,
  titulo,
  ...props
}: {
  aberto: boolean
  onFechar: () => void
  titulo: string
  historico: GcRegistroHistorico[]
  clienteId: string
  onMudou: () => Promise<void> | void
}) {
  return (
    <Modal open={aberto} onClose={onFechar} size="2xl" title={titulo} description="Notas, arquivos e histórico">
      <PainelNotas {...props} />
    </Modal>
  )
}
