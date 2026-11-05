import * as React from 'react'
import { CalendarClock, CheckCircle2, ImagePlus, Loader2, Send, Sparkles, Trash2, XCircle } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
import { gestaoClientes, type GcRedeSocial, type GcSocialAgendamento, type GcSocialProducao } from '@/services/gestaoClientes'
import { MAX_BYTES, lerArquivo, midiasFinais } from '@/lib/socialArtes'
import { cn } from '@/lib/utils'
import { campoDataHora, legendaDosDetalhes } from './DetalheDaArte'

/**
 * "Postar todas": agenda de uma vez os posts das artes que estão em "No tráfego". Mostra todos os
 * criativos; em cada um dá pra gerar a legenda com IA, escolher a data e hora, trocar o formato ou
 * tirar da lista. Também dá pra adicionar uma imagem pronta direto aqui (vira um card novo em "No tráfego").
 */

interface Item {
  card: GcSocialProducao
  quando: string
  legenda: string
  formato: GcSocialAgendamento['formato']
  gerando: boolean
  resultado?: 'ok' | string
}

/** Amanhã em diante, um post por dia no horário escolhido. */
function datasEspalhadas(n: number, hora: string, intervaloDias: number, inicio?: string): string[] {
  const [h, m] = hora.split(':').map(Number)
  const d0 = inicio ? new Date(`${inicio}T00:00`) : new Date(Date.now() + 86_400_000)
  return Array.from({ length: n }, (_, i) => {
    const d = new Date(d0)
    d.setDate(d0.getDate() + i * intervaloDias)
    d.setHours(h || 18, m || 0, 0, 0)
    return campoDataHora(d)
  })
}

const ehVideo = (c: GcSocialProducao) => midiasFinais(c).some((a) => a.type.startsWith('video/'))

export function ModalPostarTodas({ aberto, onFechar, clienteId, cards, mes, onMudou }: {
  aberto: boolean
  onFechar: () => void
  clienteId: string
  /** Os cards da coluna "No tráfego" (já filtrados pelo mês da tela). */
  cards: GcSocialProducao[]
  mes: string | null
  onMudou: () => void
}) {
  const [itens, setItens] = React.useState<Item[]>([])
  const [redes, setRedes] = React.useState<GcRedeSocial[]>(['instagram'])
  const [hora, setHora] = React.useState('18:00')
  const [intervalo, setIntervalo] = React.useState(1)
  const [inicio, setInicio] = React.useState('')
  const [postando, setPostando] = React.useState(false)
  const [adicionando, setAdicionando] = React.useState(false)
  const input = React.useRef<HTMLInputElement>(null)

  // Ao abrir: entram as artes com mídia que ainda não estão agendadas nem publicadas.
  React.useEffect(() => {
    if (!aberto) return
    const livres = cards.filter((c) => midiasFinais(c).length > 0 && !['agendado', 'publicando', 'publicado'].includes(c.agendamento?.status ?? ''))
    const datas = datasEspalhadas(livres.length, hora, intervalo, inicio || undefined)
    setItens(livres.map((c, i) => ({
      card: c, quando: datas[i], legenda: legendaDosDetalhes(c.descricao), formato: ehVideo(c) ? 'reels' : 'feed', gerando: false,
    })))
  }, [aberto]) // eslint-disable-line react-hooks/exhaustive-deps

  const mudar = (id: string, x: Partial<Item>) => setItens((l) => l.map((it) => (it.card.id === id ? { ...it, ...x } : it)))

  const redistribuir = () => {
    const datas = datasEspalhadas(itens.length, hora, intervalo, inicio || undefined)
    setItens((l) => l.map((it, i) => ({ ...it, quando: datas[i] })))
  }

  const gerarLegenda = async (id: string) => {
    mudar(id, { gerando: true })
    try {
      const { legenda } = await gestaoClientes.iaLegenda(id)
      mudar(id, { legenda, gerando: false })
    } catch (err) {
      mudar(id, { gerando: false })
      toast.error((err as Error).message)
    }
  }

  const gerarTodas = async () => {
    const semLegenda = itens.filter((it) => !it.legenda.trim() && it.formato !== 'story')
    const alvo = semLegenda.length ? semLegenda : itens.filter((it) => it.formato !== 'story')
    // Duas de cada vez: rápido sem estourar a IA.
    for (let i = 0; i < alvo.length; i += 2) {
      await Promise.all(alvo.slice(i, i + 2).map((it) => gerarLegenda(it.card.id)))
    }
  }

  const adicionarImagens = async (arquivos: File[]) => {
    if (arquivos.length === 0) return
    setAdicionando(true)
    try {
      const novos: Item[] = []
      for (const arquivo of arquivos) {
        if (arquivo.size > MAX_BYTES) {
          toast.error(`"${arquivo.name}" passa de 5MB`)
          continue
        }
        const titulo = `Post: ${arquivo.name.replace(/\.\w+$/, '').replace(/[-_]+/g, ' ').trim() || 'imagem'}`
        const criado = await gestaoClientes.criarSocialProducao(clienteId, { titulo, status: 'trafego', ...(mes ? { mes } : {}) })
        const { name, type, size, dataUrl } = await lerArquivo(arquivo)
        const card = await gestaoClientes.anexarNaProducao(criado.id, { name, type, size, dataUrl, papel: 'final' })
        novos.push({ card, quando: '', legenda: '', formato: type.startsWith('video/') ? 'reels' : 'feed', gerando: false })
      }
      if (novos.length) {
        setItens((l) => {
          const todos = [...l, ...novos]
          const datas = datasEspalhadas(todos.length, hora, intervalo, inicio || undefined)
          return todos.map((it, i) => (it.quando ? it : { ...it, quando: datas[i] }))
        })
        onMudou()
      }
    } catch (err) {
      toast.error('Falha ao adicionar: ' + (err as Error).message)
    } finally {
      setAdicionando(false)
    }
  }

  const postar = async () => {
    if (redes.length === 0) return toast.error('Escolha Instagram e/ou Facebook')
    const pendentes = itens.filter((it) => it.resultado !== 'ok')
    if (pendentes.length === 0) return toast.error('Nada pra agendar')
    if (pendentes.some((it) => !it.quando)) return toast.error('Escolha a data de todos os posts')
    if (pendentes.some((it) => it.formato === 'story' && redes.includes('facebook'))) {
      return toast.error('Story pela API só no Instagram. Desmarque o Facebook ou troque o formato.')
    }
    setPostando(true)
    let ok = 0
    for (const it of pendentes) {
      try {
        await gestaoClientes.agendarPostagem(it.card.id, {
          redes, formato: it.formato, legenda: it.formato === 'story' ? '' : it.legenda, agendado_para: new Date(it.quando).toISOString(),
        })
        mudar(it.card.id, { resultado: 'ok' })
        ok++
      } catch (err) {
        mudar(it.card.id, { resultado: (err as Error).message })
      }
    }
    setPostando(false)
    onMudou()
    if (ok === pendentes.length) {
      toast.success(`${ok} post${ok === 1 ? '' : 's'} agendado${ok === 1 ? '' : 's'}`)
      onFechar()
    } else {
      toast.error(`${ok} de ${pendentes.length} agendados. Veja os erros na lista.`)
    }
  }

  const alternarRede = (r: GcRedeSocial) => setRedes((x) => (x.includes(r) ? x.filter((y) => y !== r) : [...x, r]))
  const campo = 'h-9 rounded-lg border border-line bg-surface px-2 text-sm text-foreground'

  return (
    <Modal
      open={aberto}
      onClose={() => !postando && onFechar()}
      size="2xl"
      title="Postar todas"
      description="Todos os criativos da coluna No tráfego. Gere a legenda, escolha a data de cada um e tire o que não quiser postar."
      footer={
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-xs text-foreground/50">{itens.length} post{itens.length === 1 ? '' : 's'} na lista</span>
          <div className="flex gap-2">
            <Button variant="ghost" disabled={postando} onClick={onFechar}>Cancelar</Button>
            <Button loading={postando} disabled={itens.length === 0} leftIcon={<Send className="h-4 w-4" />} onClick={() => void postar()}>
              Agendar {itens.filter((it) => it.resultado !== 'ok').length} post{itens.length === 1 ? '' : 's'}
            </Button>
          </div>
        </div>
      }
    >
      <div className="space-y-3">
        <div className="flex flex-wrap items-end gap-3 rounded-xl border border-line bg-elevate/[0.02] p-3">
          <div>
            <p className="mb-1 text-xs font-medium text-foreground/70">Onde postar</p>
            <div className="flex gap-1.5">
              {(['instagram', 'facebook'] as GcRedeSocial[]).map((r) => (
                <button
                  key={r}
                  type="button"
                  onClick={() => alternarRede(r)}
                  className={cn(
                    'h-9 rounded-full border px-3 text-xs transition-colors',
                    redes.includes(r) ? 'border-accent bg-accent/10 font-medium text-accent' : 'border-line text-foreground/55 hover:text-foreground',
                  )}
                >
                  {r === 'instagram' ? 'Instagram' : 'Facebook'}
                </button>
              ))}
            </div>
          </div>
          <label className="text-xs font-medium text-foreground/70">
            <span className="mb-1 block">A partir de</span>
            <input type="date" value={inicio} onChange={(e) => setInicio(e.target.value)} className={campo} />
          </label>
          <label className="text-xs font-medium text-foreground/70">
            <span className="mb-1 block">Horário</span>
            <input type="time" value={hora} onChange={(e) => setHora(e.target.value)} className={campo} />
          </label>
          <label className="text-xs font-medium text-foreground/70">
            <span className="mb-1 block">A cada</span>
            <select value={intervalo} onChange={(e) => setIntervalo(Number(e.target.value))} className={campo}>
              {[1, 2, 3, 7].map((n) => <option key={n} value={n}>{n === 1 ? '1 dia' : `${n} dias`}</option>)}
            </select>
          </label>
          <Button size="sm" variant="secondary" leftIcon={<CalendarClock className="h-3.5 w-3.5" />} onClick={redistribuir}>
            Distribuir datas
          </Button>
          <div className="ml-auto flex flex-wrap gap-2">
            <Button size="sm" variant="secondary" leftIcon={<Sparkles className="h-3.5 w-3.5" />} disabled={itens.length === 0 || itens.some((it) => it.gerando)} onClick={() => void gerarTodas()}>
              Gerar todas as legendas
            </Button>
            <Button size="sm" variant="secondary" loading={adicionando} leftIcon={<ImagePlus className="h-3.5 w-3.5" />} onClick={() => input.current?.click()}>
              Adicionar imagem
            </Button>
            <input
              ref={input}
              type="file"
              multiple
              accept="image/*,video/*"
              className="hidden"
              onChange={(e) => {
                void adicionarImagens(Array.from(e.target.files ?? []))
                e.target.value = ''
              }}
            />
          </div>
        </div>

        {itens.length === 0 ? (
          <p className="rounded-xl border border-dashed border-line px-4 py-10 text-center text-sm text-foreground/50">
            Nenhuma arte livre pra postar em No tráfego{mes ? ' neste mês' : ''}. As que já estão agendadas ou publicadas não entram.
            Use "Adicionar imagem" pra postar uma arte pronta direto daqui.
          </p>
        ) : (
          <ul className="max-h-[58vh] space-y-2 overflow-y-auto pr-1">
            {itens.map((it) => {
              const midias = midiasFinais(it.card)
              return (
                <li
                  key={it.card.id}
                  className={cn(
                    'rounded-xl border p-3',
                    it.resultado === 'ok' ? 'border-success/40 bg-success/[0.04]' : it.resultado ? 'border-danger/40 bg-danger/[0.03]' : 'border-line',
                  )}
                >
                  <div className="flex gap-3 max-sm:flex-col">
                    <div className="flex shrink-0 gap-1">
                      {midias.slice(0, 3).map((a) => (a.type.startsWith('video/')
                        ? <video key={a.id} src={a.dataUrl} muted className="h-28 w-24 rounded-lg bg-black object-cover" />
                        : <img key={a.id} src={a.dataUrl} alt="" className="h-28 w-24 rounded-lg object-cover" />))}
                      {midias.length > 3 && <span className="flex h-28 w-8 items-center justify-center text-xs text-foreground/45">+{midias.length - 3}</span>}
                    </div>
                    <div className="min-w-0 flex-1 space-y-2">
                      <div className="flex items-start justify-between gap-2">
                        <p className="truncate text-sm font-medium text-foreground">{it.card.titulo}</p>
                        <button
                          type="button"
                          onClick={() => setItens((l) => l.filter((x) => x.card.id !== it.card.id))}
                          className="shrink-0 rounded-md p-1 text-foreground/35 hover:bg-danger/10 hover:text-danger"
                          title="Tirar da lista (não posta)"
                          aria-label="Tirar da lista"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <input
                          type="datetime-local"
                          value={it.quando}
                          min={campoDataHora(new Date())}
                          onChange={(e) => mudar(it.card.id, { quando: e.target.value })}
                          className={campo}
                          aria-label="Data e hora do post"
                        />
                        <select
                          value={it.formato}
                          onChange={(e) => mudar(it.card.id, { formato: e.target.value as Item['formato'] })}
                          className={campo}
                          aria-label="Formato"
                        >
                          <option value="feed">Feed{midias.length > 1 ? ' (carrossel)' : ''}</option>
                          <option value="reels" disabled={!ehVideo(it.card)}>Reels</option>
                          <option value="story">Story</option>
                        </select>
                        {it.formato !== 'story' && (
                          <Button
                            size="sm"
                            variant="secondary"
                            loading={it.gerando}
                            leftIcon={<Sparkles className="h-3.5 w-3.5" />}
                            onClick={() => void gerarLegenda(it.card.id)}
                          >
                            {it.legenda ? 'Gerar outra legenda' : 'Gerar legenda'}
                          </Button>
                        )}
                      </div>
                      {it.formato !== 'story' ? (
                        <textarea
                          value={it.legenda}
                          onChange={(e) => mudar(it.card.id, { legenda: e.target.value })}
                          rows={3}
                          placeholder={it.gerando ? 'Escrevendo a legenda…' : 'Legenda do post (ou clique em Gerar legenda)'}
                          className="w-full resize-y rounded-lg border border-line bg-surface px-2.5 py-1.5 text-sm text-foreground"
                        />
                      ) : (
                        <p className="text-xs text-foreground/45">Story não tem legenda.</p>
                      )}
                      {it.resultado === 'ok' && <p className="flex items-center gap-1 text-xs font-medium text-success"><CheckCircle2 className="h-3.5 w-3.5" /> Agendado</p>}
                      {it.resultado && it.resultado !== 'ok' && <p className="flex items-center gap-1 text-xs text-danger"><XCircle className="h-3.5 w-3.5" /> {it.resultado}</p>}
                    </div>
                  </div>
                </li>
              )
            })}
          </ul>
        )}
        {postando && <p className="flex items-center gap-1.5 text-xs text-foreground/55"><Loader2 className="h-3 w-3 animate-spin" /> Agendando…</p>}
      </div>
    </Modal>
  )
}
