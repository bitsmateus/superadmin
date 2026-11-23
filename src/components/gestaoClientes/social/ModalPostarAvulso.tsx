import * as React from 'react'
import { CalendarClock, CheckCircle2, ChevronLeft, ChevronRight, ExternalLink, Film, ImagePlus, Loader2, Send, Trash2, XCircle } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
import { gestaoClientes, type GcRedeSocial, type GcSocialAgendamento, type GcSocialProducao } from '@/services/gestaoClientes'
import { MAX_BYTES, MAX_VIDEO_BYTES, anexarMidia, capaDoCard } from '@/lib/socialArtes'
import { cn } from '@/lib/utils'
import { campoDataHora } from './DetalheDaArte'
import { CapaDoReels } from './CapaDoReels'

/**
 * "Postar avulso": sobe imagens e vídeos em massa e posta SEM passar pela coluna "No tráfego".
 *  - Avulso: cada arquivo é um post, com data, formato e legenda próprios.
 *  - Carrossel: os arquivos viram UM post; dá pra organizar a ordem e agendar ou postar agora.
 * Os arquivos só sobem quando você agenda/posta. Os posts ficam guardados à parte (aba "Enviados"), fora do quadro.
 */

type Formato = GcSocialAgendamento['formato']
interface Item {
  key: string
  arquivo: File
  preview: string
  video: boolean
  quando: string
  legenda: string
  formato: Formato
  /** Capa escolhida pro Reels (data URL), antes de subir. */
  capa?: string
  erroArquivo?: string
  resultado?: 'ok' | string
}

const MAX_CARROSSEL = 10
const campo = 'h-9 rounded-lg border border-line bg-surface px-2 text-sm text-foreground'

function espalhar(n: number, hora: string, intervaloDias: number, inicio?: string): string[] {
  const [h, m] = hora.split(':').map(Number)
  const d0 = inicio ? new Date(`${inicio}T00:00`) : new Date(Date.now() + 86_400_000)
  return Array.from({ length: n }, (_, i) => {
    const d = new Date(d0)
    d.setDate(d0.getDate() + i * intervaloDias)
    d.setHours(h || 18, m || 0, 0, 0)
    return campoDataHora(d)
  })
}

const proximaHora = () => {
  const d = new Date(Date.now() + 60 * 60_000)
  d.setMinutes(0, 0, 0)
  return campoDataHora(d)
}

function problemaDoArquivo(a: File): string | undefined {
  if (!/^(image|video)\//.test(a.type)) return 'Só imagem ou vídeo'
  if (a.type.startsWith('video/') && !/^video\/(mp4|quicktime|webm|x-m4v)$/.test(a.type)) return 'Vídeo precisa ser MP4 ou MOV'
  if (a.type.startsWith('video/') && a.size > MAX_VIDEO_BYTES) return 'Vídeo passa de 100MB'
  if (a.type.startsWith('image/') && a.size > MAX_BYTES) return 'Imagem passa de 5MB'
  return undefined
}

const dataHoraBr = (iso: string) =>
  new Date(iso).toLocaleString('pt-BR', { weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })

export function ModalPostarAvulso({ aberto, onFechar, clienteId }: { aberto: boolean; onFechar: () => void; clienteId: string }) {
  const [aba, setAba] = React.useState<'novo' | 'enviados'>('novo')
  const [modo, setModo] = React.useState<'avulso' | 'carrossel'>('avulso')
  const [itens, setItens] = React.useState<Item[]>([])
  const [redes, setRedes] = React.useState<GcRedeSocial[]>(['instagram'])
  const [hora, setHora] = React.useState('18:00')
  const [intervalo, setIntervalo] = React.useState(1)
  const [inicio, setInicio] = React.useState('')
  const [legendaCarrossel, setLegendaCarrossel] = React.useState('')
  const [quandoCarrossel, setQuandoCarrossel] = React.useState(proximaHora)
  const [postando, setPostando] = React.useState(false)
  const [arrastando, setArrastando] = React.useState(false)
  const [dragIdx, setDragIdx] = React.useState<number | null>(null)
  const [capaDe, setCapaDe] = React.useState<string | null>(null)
  const [enviados, setEnviados] = React.useState<GcSocialProducao[] | null>(null)
  const input = React.useRef<HTMLInputElement>(null)
  const itensRef = React.useRef<Item[]>([])
  itensRef.current = itens

  const soltarPrevias = (l: Item[]) => l.forEach((i) => URL.revokeObjectURL(i.preview))
  React.useEffect(() => () => soltarPrevias(itensRef.current), [])

  const carregarEnviados = React.useCallback(() => {
    gestaoClientes.postsAvulsos(clienteId).then(setEnviados).catch((e: Error) => toast.error(e.message))
  }, [clienteId])
  React.useEffect(() => {
    if (aberto && aba === 'enviados') carregarEnviados()
  }, [aberto, aba, carregarEnviados])

  const fechar = () => {
    if (postando) return
    soltarPrevias(itens)
    setItens([])
    setLegendaCarrossel('')
    setAba('novo')
    onFechar()
  }

  const adicionar = (arquivos: File[]) => {
    if (arquivos.length === 0) return
    const novos: Item[] = arquivos.map((a) => ({
      key: crypto.randomUUID(),
      arquivo: a,
      preview: URL.createObjectURL(a),
      video: a.type.startsWith('video/'),
      quando: '',
      legenda: '',
      formato: a.type.startsWith('video/') ? 'reels' : 'feed',
      erroArquivo: problemaDoArquivo(a),
    }))
    setItens((l) => {
      const todos = [...l, ...novos]
      const datas = espalhar(todos.length, hora, intervalo, inicio || undefined)
      return todos.map((it, i) => (it.quando ? it : { ...it, quando: datas[i] }))
    })
  }

  const mudar = (key: string, x: Partial<Item>) => setItens((l) => l.map((it) => (it.key === key ? { ...it, ...x } : it)))
  const tirar = (key: string) =>
    setItens((l) => {
      const alvo = l.find((i) => i.key === key)
      if (alvo) URL.revokeObjectURL(alvo.preview)
      return l.filter((i) => i.key !== key)
    })
  const mover = (de: number, para: number) =>
    setItens((l) => {
      if (para < 0 || para >= l.length || de === para) return l
      const c = [...l]
      const [x] = c.splice(de, 1)
      c.splice(para, 0, x)
      return c
    })
  const redistribuir = () => {
    const datas = espalhar(itens.length, hora, intervalo, inicio || undefined)
    setItens((l) => l.map((it, i) => ({ ...it, quando: datas[i] })))
  }
  const alternarRede = (r: GcRedeSocial) => setRedes((x) => (x.includes(r) ? x.filter((y) => y !== r) : [...x, r]))

  /** Cria o card oculto, sobe os arquivos na ordem e agenda. Se der erro no meio, apaga o card pra não deixar resto. */
  const publicar = async (arquivos: Item[], titulo: string, formato: Formato, legenda: string, quando: string, comCapa?: string) => {
    const card = await gestaoClientes.criarSocialProducao(clienteId, { titulo, status: 'aprovado', avulso: true })
    try {
      let atual: GcSocialProducao = card
      for (const it of arquivos) atual = await anexarMidia(card.id, it.arquivo, 'final')
      if (comCapa) {
        const v = [...(atual.anexos ?? [])].reverse().find((a) => a.type.startsWith('video/'))
        if (v) await gestaoClientes.definirCapaDoAnexo(card.id, v.id, comCapa).catch(() => undefined)
      }
      await gestaoClientes.agendarPostagem(card.id, { redes, formato, legenda: formato === 'story' ? '' : legenda, agendado_para: new Date(quando).toISOString() })
    } catch (err) {
      await gestaoClientes.excluirSocialProducao(card.id).catch(() => undefined)
      throw err
    }
  }

  const executar = async (agora: boolean) => {
    if (redes.length === 0) return toast.error('Escolha Instagram e/ou Facebook')
    const agoraIso = campoDataHora(new Date())
    if (modo === 'carrossel') {
      const lista = itens
      if (lista.length < 2) return toast.error('Carrossel precisa de pelo menos 2 arquivos')
      if (lista.length > MAX_CARROSSEL) return toast.error(`Carrossel aceita até ${MAX_CARROSSEL} arquivos`)
      if (lista.some((i) => i.erroArquivo)) return toast.error('Tire os arquivos com problema antes de postar')
      if (!agora && !quandoCarrossel) return toast.error('Escolha a data e a hora')
      setPostando(true)
      try {
        await publicar(lista, `Carrossel avulso (${lista.length})`, 'feed', legendaCarrossel, agora ? agoraIso : quandoCarrossel)
        toast.success(agora ? 'Carrossel entrando no ar em até 1 minuto' : 'Carrossel agendado')
        soltarPrevias(lista)
        setItens([])
        setLegendaCarrossel('')
        setAba('enviados')
      } catch (err) {
        toast.error((err as Error).message)
      } finally {
        setPostando(false)
      }
      return
    }
    const pendentes = itens.filter((i) => i.resultado !== 'ok')
    if (pendentes.length === 0) return toast.error('Nada pra postar')
    if (pendentes.some((i) => i.erroArquivo)) return toast.error('Tire os arquivos com problema antes de postar')
    if (!agora && pendentes.some((i) => !i.quando)) return toast.error('Escolha a data de todos os posts')
    if (redes.includes('facebook') && pendentes.some((i) => i.formato === 'story')) return toast.error('Story pela API só no Instagram. Desmarque o Facebook ou troque o formato.')
    setPostando(true)
    let ok = 0
    for (const it of pendentes) {
      try {
        await publicar([it], `Avulso: ${it.arquivo.name.replace(/\.\w+$/, '').replace(/[-_]+/g, ' ').trim() || 'post'}`, it.formato, it.legenda, agora ? agoraIso : it.quando, it.capa)
        mudar(it.key, { resultado: 'ok' })
        ok++
      } catch (err) {
        mudar(it.key, { resultado: (err as Error).message })
      }
    }
    setPostando(false)
    if (ok === pendentes.length) {
      toast.success(agora ? `${ok} post${ok === 1 ? '' : 's'} entrando no ar em até 1 minuto` : `${ok} post${ok === 1 ? '' : 's'} agendado${ok === 1 ? '' : 's'}`)
      soltarPrevias(itens)
      setItens([])
      setAba('enviados')
    } else {
      toast.error(`${ok} de ${pendentes.length} enviados. Veja os erros na lista.`)
    }
  }

  const cancelar = async (ag: GcSocialAgendamento) => {
    if (!window.confirm('Cancelar este agendamento?')) return
    try {
      await gestaoClientes.cancelarAgendamento(ag.id)
      carregarEnviados()
    } catch (err) {
      toast.error((err as Error).message)
    }
  }

  const nomeRede = (r: GcRedeSocial) => (r === 'instagram' ? 'Instagram' : 'Facebook')
  const alvoCapa = itens.find((i) => i.key === capaDe)

  const seletorDeArquivos = (
    <>
      <Button size="sm" leftIcon={<ImagePlus className="h-3.5 w-3.5" />} onClick={() => input.current?.click()}>
        Selecionar imagens e vídeos
      </Button>
      <input
        ref={input}
        type="file"
        multiple
        accept="image/*,video/mp4,video/quicktime,video/webm"
        className="hidden"
        onChange={(e) => {
          adicionar(Array.from(e.target.files ?? []))
          e.target.value = ''
        }}
      />
    </>
  )

  return (
    <Modal
      open={aberto}
      onClose={fechar}
      size="2xl"
      title="Postar avulso"
      description="Suba as artes e poste direto, sem passar por No tráfego. Avulso: cada arquivo é um post. Carrossel: tudo num post só."
      footer={
        aba === 'novo' ? (
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-xs text-foreground/50">
              {modo === 'carrossel' ? `${itens.length} de ${MAX_CARROSSEL} no carrossel` : `${itens.filter((i) => i.resultado !== 'ok').length} post${itens.length === 1 ? '' : 's'} na lista`}
            </span>
            <div className="flex gap-2">
              <Button variant="ghost" disabled={postando} onClick={fechar}>Fechar</Button>
              <Button variant="secondary" loading={postando} disabled={itens.length === 0} leftIcon={<Send className="h-4 w-4" />} onClick={() => void executar(true)}>
                Postar agora
              </Button>
              <Button loading={postando} disabled={itens.length === 0} leftIcon={<CalendarClock className="h-4 w-4" />} onClick={() => void executar(false)}>
                Agendar
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex justify-end"><Button variant="ghost" onClick={fechar}>Fechar</Button></div>
        )
      }
    >
      <div className="space-y-3">
        <div className="flex gap-1.5">
          {([['novo', 'Novo post'], ['enviados', 'Enviados']] as const).map(([v, r]) => (
            <button
              key={v}
              type="button"
              onClick={() => setAba(v)}
              className={cn('h-9 rounded-full border px-4 text-sm transition-colors', aba === v ? 'border-accent bg-accent/10 font-medium text-accent' : 'border-line text-foreground/55 hover:text-foreground')}
            >
              {r}
            </button>
          ))}
        </div>

        {aba === 'enviados' && (
          enviados === null ? (
            <p className="flex items-center gap-1.5 text-sm text-foreground/55"><Loader2 className="h-4 w-4 animate-spin" /> Carregando…</p>
          ) : enviados.length === 0 ? (
            <p className="rounded-xl border border-dashed border-line px-4 py-10 text-center text-sm text-foreground/50">Nenhum post avulso ainda.</p>
          ) : (
            <ul className="max-h-[60vh] space-y-2 overflow-y-auto pr-1">
              {enviados.map((c) => {
                const ag = c.agendamento
                const capa = capaDoCard(c)
                return (
                  <li key={c.id} className="flex items-center gap-3 rounded-xl border border-line p-2.5">
                    {capa ? <img src={capa} alt="" className="h-14 w-12 shrink-0 rounded-lg object-cover" /> : <span className="flex h-14 w-12 shrink-0 items-center justify-center rounded-lg bg-black text-white/60"><Film className="h-4 w-4" /></span>}
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-foreground">{c.titulo}</p>
                      {ag ? (
                        <p className="text-xs text-foreground/60">
                          <span className={cn('mr-1.5 rounded-full px-2 py-0.5 font-medium', ag.status === 'publicado' ? 'bg-success/15 text-success' : ag.status === 'erro' ? 'bg-danger/10 text-danger' : 'bg-accent/10 text-accent')}>
                            {ag.status === 'agendado' ? 'Agendado' : ag.status === 'publicando' ? 'Publicando…' : ag.status === 'publicado' ? 'Publicado' : 'Erro'}
                          </span>
                          {dataHoraBr(ag.status === 'publicado' && ag.publicado_em ? ag.publicado_em : ag.agendado_para)} · {ag.redes.map(nomeRede).join(' + ')} · {ag.formato === 'reels' ? 'Reels' : ag.formato === 'story' ? 'Story' : (c.anexos?.length ?? 0) > 1 ? 'Carrossel' : 'Feed'}
                        </p>
                      ) : <p className="text-xs text-foreground/45">Sem agendamento (cancelado)</p>}
                      {ag?.erro && <p className="mt-0.5 text-xs text-danger">{ag.erro}</p>}
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      {ag?.redes.map((r) => ag.resultado?.[r]?.link && (
                        <a key={r} href={ag.resultado[r]!.link} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs font-medium text-accent hover:underline">
                          <ExternalLink className="h-3 w-3" /> {nomeRede(r)}
                        </a>
                      ))}
                      {ag?.status === 'agendado' && <Button size="sm" variant="ghost" onClick={() => void cancelar(ag)}>Cancelar</Button>}
                    </div>
                  </li>
                )
              })}
            </ul>
          )
        )}

        {aba === 'novo' && (
          <>
            <div className="flex flex-wrap items-end gap-3 rounded-xl border border-line bg-elevate/[0.02] p-3">
              <div>
                <p className="mb-1 text-xs font-medium text-foreground/70">Tipo</p>
                <div className="flex gap-1.5">
                  {([['avulso', 'Avulso (1 post por arquivo)'], ['carrossel', 'Carrossel (1 post só)']] as const).map(([v, r]) => (
                    <button
                      key={v}
                      type="button"
                      onClick={() => setModo(v)}
                      className={cn('h-9 rounded-full border px-3 text-xs transition-colors', modo === v ? 'border-accent bg-accent/10 font-medium text-accent' : 'border-line text-foreground/55 hover:text-foreground')}
                    >
                      {r}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <p className="mb-1 text-xs font-medium text-foreground/70">Onde postar</p>
                <div className="flex gap-1.5">
                  {(['instagram', 'facebook'] as GcRedeSocial[]).map((r) => (
                    <button
                      key={r}
                      type="button"
                      onClick={() => alternarRede(r)}
                      className={cn('h-9 rounded-full border px-3 text-xs transition-colors', redes.includes(r) ? 'border-accent bg-accent/10 font-medium text-accent' : 'border-line text-foreground/55 hover:text-foreground')}
                    >
                      {nomeRede(r)}
                    </button>
                  ))}
                </div>
              </div>
              {modo === 'avulso' && (
                <>
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
                  <Button size="sm" variant="secondary" leftIcon={<CalendarClock className="h-3.5 w-3.5" />} disabled={itens.length === 0} onClick={redistribuir}>
                    Distribuir datas
                  </Button>
                </>
              )}
              <div className="ml-auto">{seletorDeArquivos}</div>
            </div>

            <div
              onDragOver={(e) => { e.preventDefault(); if (dragIdx === null) setArrastando(true) }}
              onDragLeave={() => setArrastando(false)}
              onDrop={(e) => {
                setArrastando(false)
                if (dragIdx !== null) return
                e.preventDefault()
                adicionar(Array.from(e.dataTransfer.files))
              }}
              className={cn('rounded-xl border border-dashed p-1 transition-colors', arrastando ? 'border-accent bg-accent/[0.05]' : 'border-transparent')}
            >
              {itens.length === 0 ? (
                <p className="rounded-xl border border-dashed border-line px-4 py-12 text-center text-sm text-foreground/50">
                  Arraste as imagens e vídeos aqui ou use “Selecionar imagens e vídeos”. Dá pra escolher vários de uma vez.
                </p>
              ) : modo === 'carrossel' ? (
                <div className="space-y-3">
                  <p className="text-xs text-foreground/55">
                    Ordem do carrossel (a 1 é a capa): arraste os quadros ou use as setas.
                    {redes.includes('facebook') && itens.some((i) => i.video) ? ' No Facebook, vídeos ficam de fora do carrossel.' : ''}
                  </p>
                  <ul className="grid grid-cols-3 gap-2 sm:grid-cols-5">
                    {itens.map((it, i) => (
                      <li
                        key={it.key}
                        draggable
                        onDragStart={() => setDragIdx(i)}
                        onDragEnd={() => setDragIdx(null)}
                        onDragOver={(e) => { if (dragIdx !== null) e.preventDefault() }}
                        onDrop={(e) => {
                          e.preventDefault()
                          e.stopPropagation()
                          if (dragIdx !== null) mover(dragIdx, i)
                          setDragIdx(null)
                        }}
                        className={cn('group relative cursor-grab overflow-hidden rounded-lg border bg-surface', it.erroArquivo ? 'border-danger/50' : 'border-line', dragIdx === i && 'opacity-40')}
                      >
                        {it.video
                          ? <video src={it.preview} muted className="aspect-square w-full bg-black object-cover" />
                          : <img src={it.preview} alt="" className="aspect-square w-full object-cover" />}
                        <span className="absolute left-1 top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-accent px-1 text-[11px] font-semibold text-white">{i + 1}</span>
                        {it.video && <span className="absolute right-1 top-1 rounded bg-black/60 p-0.5 text-white"><Film className="h-3 w-3" /></span>}
                        <div className="flex items-center justify-between gap-1 border-t border-line px-1 py-0.5">
                          <button type="button" disabled={i === 0} onClick={() => mover(i, i - 1)} className="rounded p-0.5 text-foreground/60 hover:bg-elevate/[0.08] disabled:opacity-30" aria-label="Mover pra trás"><ChevronLeft className="h-4 w-4" /></button>
                          <button type="button" onClick={() => tirar(it.key)} className="rounded p-0.5 text-foreground/40 hover:bg-danger/10 hover:text-danger" aria-label="Tirar" title="Tirar do carrossel"><Trash2 className="h-3.5 w-3.5" /></button>
                          <button type="button" disabled={i === itens.length - 1} onClick={() => mover(i, i + 1)} className="rounded p-0.5 text-foreground/60 hover:bg-elevate/[0.08] disabled:opacity-30" aria-label="Mover pra frente"><ChevronRight className="h-4 w-4" /></button>
                        </div>
                        {it.erroArquivo && <p className="px-1 pb-1 text-[10px] text-danger">{it.erroArquivo}</p>}
                      </li>
                    ))}
                  </ul>
                  <div className="grid gap-3 sm:grid-cols-[220px_1fr]">
                    <label className="text-xs font-medium text-foreground/70">
                      <span className="mb-1 block">Data e hora (se for agendar)</span>
                      <input type="datetime-local" value={quandoCarrossel} min={campoDataHora(new Date())} onChange={(e) => setQuandoCarrossel(e.target.value)} className={cn(campo, 'w-full')} />
                    </label>
                    <label className="text-xs font-medium text-foreground/70">
                      <span className="mb-1 block">Legenda</span>
                      <textarea value={legendaCarrossel} onChange={(e) => setLegendaCarrossel(e.target.value)} rows={3} placeholder="Texto que vai junto do carrossel, com hashtags." className="w-full resize-y rounded-lg border border-line bg-surface px-2.5 py-1.5 text-sm text-foreground" />
                    </label>
                  </div>
                </div>
              ) : (
                <ul className="max-h-[52vh] space-y-2 overflow-y-auto pr-1">
                  {itens.map((it) => (
                    <li
                      key={it.key}
                      className={cn('rounded-xl border p-3', it.resultado === 'ok' ? 'border-success/40 bg-success/[0.04]' : it.resultado || it.erroArquivo ? 'border-danger/40 bg-danger/[0.03]' : 'border-line')}
                    >
                      <div className="flex gap-3 max-sm:flex-col">
                        <div className="shrink-0">
                          {it.video
                            ? <video src={it.preview} muted className="h-28 w-24 rounded-lg bg-black object-cover" />
                            : <img src={it.preview} alt="" className="h-28 w-24 rounded-lg object-cover" />}
                        </div>
                        <div className="min-w-0 flex-1 space-y-2">
                          <div className="flex items-start justify-between gap-2">
                            <p className="truncate text-sm font-medium text-foreground">{it.arquivo.name} <span className="text-xs font-normal text-foreground/45">{(it.arquivo.size / 1048576).toFixed(1)}MB</span></p>
                            <button type="button" onClick={() => tirar(it.key)} className="shrink-0 rounded-md p-1 text-foreground/35 hover:bg-danger/10 hover:text-danger" title="Tirar da lista" aria-label="Tirar da lista">
                              <Trash2 className="h-4 w-4" />
                            </button>
                          </div>
                          <div className="flex flex-wrap gap-2">
                            <input type="datetime-local" value={it.quando} min={campoDataHora(new Date())} onChange={(e) => mudar(it.key, { quando: e.target.value })} className={campo} aria-label="Data e hora do post" />
                            <select value={it.formato} onChange={(e) => mudar(it.key, { formato: e.target.value as Formato })} className={campo} aria-label="Formato">
                              <option value="feed">Feed</option>
                              <option value="reels" disabled={!it.video}>Reels</option>
                              <option value="story">Story</option>
                            </select>
                            {it.video && it.formato === 'reels' && (
                              <Button size="sm" variant="secondary" onClick={() => setCapaDe(it.key)}>{it.capa ? 'Trocar capa' : 'Escolher capa'}</Button>
                            )}
                            {it.capa && <img src={it.capa} alt="Capa" className="aspect-[9/16] h-9 rounded object-cover" />}
                          </div>
                          {it.formato !== 'story'
                            ? <textarea value={it.legenda} onChange={(e) => mudar(it.key, { legenda: e.target.value })} rows={2} placeholder="Legenda do post" className="w-full resize-y rounded-lg border border-line bg-surface px-2.5 py-1.5 text-sm text-foreground" />
                            : <p className="text-xs text-foreground/45">Story não tem legenda.</p>}
                          {it.erroArquivo && <p className="flex items-center gap-1 text-xs text-danger"><XCircle className="h-3.5 w-3.5" /> {it.erroArquivo}</p>}
                          {it.resultado === 'ok' && <p className="flex items-center gap-1 text-xs font-medium text-success"><CheckCircle2 className="h-3.5 w-3.5" /> Enviado</p>}
                          {it.resultado && it.resultado !== 'ok' && <p className="flex items-center gap-1 text-xs text-danger"><XCircle className="h-3.5 w-3.5" /> {it.resultado}</p>}
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            {postando && <p className="flex items-center gap-1.5 text-xs text-foreground/55"><Loader2 className="h-3 w-3 animate-spin" /> Enviando arquivos e agendando… (vídeos grandes demoram um pouco)</p>}
          </>
        )}
      </div>

      <CapaDoReels
        aberto={!!alvoCapa}
        onFechar={() => setCapaDe(null)}
        arquivoLocal={alvoCapa?.arquivo}
        capaAtual={alvoCapa?.capa}
        onEscolher={(dataUrl) => { if (capaDe) mudar(capaDe, { capa: dataUrl }) }}
      />
    </Modal>
  )
}
