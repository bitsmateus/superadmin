import * as React from 'react'
import {
  AlertTriangle, Clock, FileText, Image as ImageIcon, MessageSquare, Paperclip, Pencil, Phone, Pin, PinOff, Send,
  SlidersHorizontal, StickyNote, Trash2, Users, X,
} from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/Button'
import { Textarea } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
import { Badge } from '@/components/ui/Badge'
import { Modal } from '@/components/ui/Modal'
import {
  TIPOS_HISTORICO, TIPOS_REUNIAO, gestaoClientes,
  type GcAnexo, type GcRegistroHistorico, type GcReuniaoTipo, type GcTipoHistorico,
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

function rotuloReuniao(r: Pick<GcRegistroHistorico, 'tipo' | 'reuniao_tipo'>): string {
  const sub = r.tipo === 'reuniao' ? TIPOS_REUNIAO.find((t) => t.valor === r.reuniao_tipo)?.label : null
  return sub ? `Reunião · ${sub}` : rotuloTipo(r.tipo)
}

/** Escolha do tipo da reunião (Alinhamento/Entrega/IA/Retenção) — aparece só quando o registro é reunião. */
function SeletorReuniao({ valor, onChange }: { valor: GcReuniaoTipo; onChange: (v: GcReuniaoTipo) => void }) {
  return (
    <div className="mt-2 flex flex-wrap items-center gap-1.5" role="group" aria-label="Tipo da reunião">
      <span className="text-xs text-foreground/45">Tipo da reunião:</span>
      {TIPOS_REUNIAO.map((t) => (
        <button
          key={t.valor}
          type="button"
          onClick={() => onChange(t.valor)}
          className={cn(
            'rounded-full border px-2.5 py-1 text-xs transition-colors',
            valor === t.valor ? 'border-accent/50 bg-accent/10 font-medium text-accent' : 'border-line text-foreground/55 hover:text-foreground',
          )}
        >
          {t.label}
        </button>
      ))}
    </div>
  )
}

function quando(iso: string): string {
  const data = new Date(iso)
  const hora = data.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
  // Por dia de calendário (não por 24h) e nunca negativo: relógio adiantado não vira "há -1 dias".
  const dia = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
  const dias = Math.max(0, Math.round((dia(new Date()) - dia(data)) / 86400000))
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

/** Cada tipo de registro com ícone e cor: bate o olho e já se sabe se foi reunião, ligação, reclamação… */
const ESTILO_DO_TIPO: Record<string, { icone: React.ElementType; cor: string; barra: string }> = {
  nota: { icone: StickyNote, cor: 'bg-elevate/[0.06] text-foreground/60', barra: 'before:bg-foreground/20' },
  reuniao: { icone: Users, cor: 'bg-accent/12 text-accent', barra: 'before:bg-accent' },
  ligacao: { icone: Phone, cor: 'bg-success/12 text-success', barra: 'before:bg-success' },
  reclamacao: { icone: AlertTriangle, cor: 'bg-danger/12 text-danger', barra: 'before:bg-danger' },
  ajuste: { icone: SlidersHorizontal, cor: 'bg-warning/15 text-warning', barra: 'before:bg-warning' },
}

function dataCompleta(iso: string): string {
  return new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

/** Uma nota da equipe: lê, e (pelo lápis) edita ali mesmo — texto, tipo e anexos. */
function CartaoDeNota({
  r, onAmpliar, onMudou,
}: {
  r: GcRegistroHistorico
  onAmpliar: (a: GcAnexo) => void
  onMudou: () => Promise<void> | void
}) {
  const [editando, setEditando] = React.useState(false)
  const [texto, setTexto] = React.useState(r.descricao)
  const [tipo, setTipo] = React.useState<GcTipoHistorico>(r.tipo)
  const [reuniaoTipo, setReuniaoTipo] = React.useState<GcReuniaoTipo>(r.reuniao_tipo ?? 'alinhamento')
  const [anexos, setAnexos] = React.useState<GcAnexo[]>(r.anexos ?? [])
  const [salvando, setSalvando] = React.useState(false)
  const inputArquivo = React.useRef<HTMLInputElement>(null)
  const estilo = ESTILO_DO_TIPO[r.tipo] ?? ESTILO_DO_TIPO.nota
  const Icone = estilo.icone
  const editada = r.updated_at && new Date(r.updated_at).getTime() - new Date(r.created_at).getTime() > 60_000

  const abrirEdicao = () => {
    setTexto(r.descricao)
    setTipo(r.tipo)
    setReuniaoTipo(r.reuniao_tipo ?? 'alinhamento')
    setAnexos(r.anexos ?? [])
    setEditando(true)
  }

  const agir = async (fn: () => Promise<unknown>) => {
    try {
      await fn()
      await onMudou()
    } catch (err) {
      toast.error('Falha ao salvar: ' + (err as Error).message)
    }
  }

  const salvar = async () => {
    if (!texto.trim() && anexos.length === 0) {
      toast.error('A nota não pode ficar vazia')
      return
    }
    setSalvando(true)
    try {
      await gestaoClientes.atualizarRegistro(r.id, {
        descricao: texto.trim(), tipo, anexos, reuniao_tipo: tipo === 'reuniao' ? reuniaoTipo : null,
      })
      await onMudou()
      setEditando(false)
      toast.success('Nota atualizada')
    } catch (err) {
      toast.error('Falha ao salvar: ' + (err as Error).message)
    } finally {
      setSalvando(false)
    }
  }

  const colar = async (e: React.ClipboardEvent) => {
    const colados = Array.from(e.clipboardData?.files ?? [])
    if (colados.length === 0) return
    e.preventDefault()
    const lidos = await lerArquivos(colados)
    setAnexos((a) => [...a, ...lidos])
  }

  return (
    <li
      className={cn(
        'group relative overflow-hidden rounded-2xl border border-line bg-surface px-4 py-3.5 pl-5 shadow-sm transition-shadow hover:shadow-md',
        'before:absolute before:inset-y-0 before:left-0 before:w-1',
        estilo.barra,
        r.fixado && 'border-accent/30 bg-accent/[0.03]',
      )}
    >
      <div className="flex items-start gap-3">
        <span className={cn('grid h-9 w-9 shrink-0 place-items-center rounded-xl', estilo.cor)}>
          <Icone className="h-4 w-4" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
            {r.fixado && <Pin className="h-3.5 w-3.5 text-accent" />}
            <span className="text-sm font-semibold text-foreground">{r.autor_nome ?? 'Equipe'}</span>
            <Badge tone={TOM[r.tipo] ?? 'neutral'}>{rotuloReuniao(r)}</Badge>
            <span className="text-xs text-foreground/45" title={dataCompleta(r.created_at)}>
              {quando(r.created_at)}
            </span>
            {editada && (
              <span className="text-xs italic text-foreground/35" title={`Editada em ${dataCompleta(r.updated_at!)}`}>
                · editada
              </span>
            )}
          </div>

          {editando ? (
            <div className="mt-2">
              <Textarea rows={4} value={texto} onChange={(e) => setTexto(e.target.value)} onPaste={colar} autoFocus />
              <div className="mt-2 flex flex-wrap gap-1.5">
                {TIPOS_HISTORICO.map((t) => (
                  <button
                    key={t.valor}
                    type="button"
                    onClick={() => setTipo(t.valor)}
                    className={cn(
                      'rounded-full border px-2.5 py-1 text-xs transition-colors',
                      tipo === t.valor ? 'border-accent/50 bg-accent/10 text-accent' : 'border-line text-foreground/55 hover:text-foreground',
                    )}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
              {tipo === 'reuniao' && <SeletorReuniao valor={reuniaoTipo} onChange={setReuniaoTipo} />}
              {anexos.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-2">
                  {anexos.map((a) => (
                    <div key={a.id} className="flex items-center gap-1.5 rounded-md border border-line bg-elevate/[0.03] px-2 py-1 text-xs text-foreground/70">
                      {a.type.startsWith('image/') ? <ImageIcon className="h-3.5 w-3.5" /> : <FileText className="h-3.5 w-3.5" />}
                      <span className="max-w-[140px] truncate">{a.name}</span>
                      <button type="button" onClick={() => setAnexos((x) => x.filter((y) => y.id !== a.id))} className="text-foreground/40 hover:text-danger" aria-label="Remover anexo">
                        <X className="h-3 w-3" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
              <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                <>
                  <input
                    ref={inputArquivo}
                    type="file"
                    multiple
                    className="hidden"
                    onChange={async (e) => {
                      const lidos = await lerArquivos(Array.from(e.target.files ?? []))
                      setAnexos((a) => [...a, ...lidos])
                      e.target.value = ''
                    }}
                  />
                  <Button type="button" variant="ghost" size="sm" leftIcon={<Paperclip className="h-3.5 w-3.5" />} onClick={() => inputArquivo.current?.click()}>
                    Anexar
                  </Button>
                </>
                <div className="flex gap-2">
                  <Button variant="ghost" size="sm" onClick={() => setEditando(false)}>
                    Cancelar
                  </Button>
                  <Button size="sm" loading={salvando} onClick={() => void salvar()}>
                    Salvar
                  </Button>
                </div>
              </div>
            </div>
          ) : (
            <>
              {r.descricao && <p className="mt-1.5 whitespace-pre-wrap text-sm leading-relaxed text-foreground/85">{r.descricao}</p>}
              {(r.anexos ?? []).length > 0 && (
                <div className="mt-2 flex flex-wrap gap-2">
                  {r.anexos.map((a) => (
                    <Anexo key={a.id} anexo={a} onAmpliar={onAmpliar} />
                  ))}
                </div>
              )}
            </>
          )}
        </div>
        {!editando && (
          <div className="flex shrink-0 items-center gap-0.5 opacity-100 transition-opacity sm:opacity-0 sm:group-hover:opacity-100">
            <button type="button" onClick={abrirEdicao} className="rounded-md p-1.5 text-foreground/35 hover:bg-elevate/[0.06] hover:text-accent" aria-label="Editar nota" title="Editar">
              <Pencil className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onClick={() => void agir(() => gestaoClientes.atualizarRegistro(r.id, { fixado: !r.fixado }))}
              className="rounded-md p-1.5 text-foreground/35 hover:bg-elevate/[0.06] hover:text-accent"
              aria-label={r.fixado ? 'Desafixar' : 'Fixar no topo'}
              title={r.fixado ? 'Desafixar' : 'Fixar no topo'}
            >
              {r.fixado ? <PinOff className="h-3.5 w-3.5" /> : <Pin className="h-3.5 w-3.5" />}
            </button>
            <button
              type="button"
              onClick={() => {
                if (window.confirm('Excluir esta nota? Não dá pra desfazer.')) void agir(() => gestaoClientes.excluirRegistro(r.id))
              }}
              className="rounded-md p-1.5 text-foreground/35 hover:bg-elevate/[0.06] hover:text-danger"
              aria-label="Excluir nota"
              title="Excluir"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>
        )}
      </div>
    </li>
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
  const [reuniaoTipo, setReuniaoTipo] = React.useState<GcReuniaoTipo>('alinhamento')
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
        reuniao_tipo: tipo === 'reuniao' ? reuniaoTipo : undefined,
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

  // Contagem interna por tipo de reunião (histórico todo do cliente) — pra metrificar o atendimento.
  const reunioes = TIPOS_REUNIAO.map((t) => ({
    ...t,
    total: historico.filter((r) => r.tipo === 'reuniao' && r.reuniao_tipo === t.valor).length,
  }))

  const abas: { valor: Aba; label: string; icone: React.ElementType; contagem: number }[] = [
    { valor: 'atualizacoes', label: 'Atualizações', icone: MessageSquare, contagem: daEquipe.length },
    { valor: 'arquivos', label: 'Arquivos', icone: Paperclip, contagem: arquivos.length },
    { valor: 'linha', label: 'Linha do tempo', icone: Clock, contagem: historico.length },
  ]

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-1.5 text-xs" title="Visível só pra equipe">
        <span className="text-foreground/45">Reuniões:</span>
        {reunioes.map((t) => (
          <span
            key={t.valor}
            className={cn(
              'rounded-full border px-2 py-0.5 tabular-nums',
              t.total > 0 ? 'border-accent/40 bg-accent/10 text-accent' : 'border-line text-foreground/40',
            )}
          >
            {t.label} {t.total}
          </span>
        ))}
      </div>
      <div className="-mx-1 flex items-center gap-1 overflow-x-auto border-b border-line px-1">
        {abas.map((a) => (
          <button
            key={a.valor}
            type="button"
            onClick={() => setAba(a.valor)}
            className={cn(
              'relative flex shrink-0 items-center gap-1.5 whitespace-nowrap px-3 py-2 text-sm font-medium transition-colors',
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
          <form onSubmit={registrar} className="rounded-2xl border border-line bg-surface p-3.5 shadow-sm">
            <Textarea
              rows={3}
              value={texto}
              onChange={(e) => setTexto(e.target.value)}
              onPaste={colar}
              onKeyDown={(e) => {
                if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') void registrar(e as unknown as React.FormEvent)
              }}
              placeholder="Escreva o que a equipe precisa saber — e cole o print com Ctrl+V."
            />

            {tipo === 'reuniao' && <SeletorReuniao valor={reuniaoTipo} onChange={setReuniaoTipo} />}

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
                <div className="flex flex-wrap gap-1.5" role="group" aria-label="Tipo do registro">
                  {TIPOS_HISTORICO.map((t) => (
                    <button
                      key={t.valor}
                      type="button"
                      onClick={() => setTipo(t.valor)}
                      className={cn(
                        'rounded-full border px-2.5 py-1 text-xs transition-colors',
                        tipo === t.valor ? 'border-accent/50 bg-accent/10 font-medium text-accent' : 'border-line text-foreground/55 hover:text-foreground',
                      )}
                    >
                      {t.label}
                    </button>
                  ))}
                </div>
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
            <ol className="space-y-2.5">
              {daEquipe.map((r) => (
                <CartaoDeNota key={r.id} r={r} onAmpliar={setAmpliado} onMudou={onMudou} />
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
                  {r.titulo || r.descricao?.split('\n')[0] || rotuloReuniao(r)}
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
