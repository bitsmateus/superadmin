import * as React from 'react'
import { toast } from 'sonner'
import { baixarArquivo, tabloideApi } from '@/api/mercadoNunesTabloide'
import type { DadosTabloide } from '../../../server/src/lib/tabloide/layout'
import { Modal, btnPrimario, btnSecundario, inputCls } from './EscolherFoto'

export interface VideoPronto {
  id: string
  url: string
  chave: string // conteúdo do tabloide quando o vídeo foi gerado (pra saber se ficou velho)
}

/** Gera o vídeo do Reels/Story no servidor e acompanha o progresso. */
export function ModalVideo({
  dados,
  chave,
  video,
  onPronto,
  onFechar,
  onPublicar,
}: {
  dados: DadosTabloide
  chave: string
  video: VideoPronto | null
  onPronto: (v: VideoPronto) => void
  onFechar: () => void
  onPublicar: () => void
}) {
  const atualizado = video?.chave === chave
  const [progresso, setProgresso] = React.useState<number | null>(atualizado ? 1 : null)
  const [erro, setErro] = React.useState<string | null>(null)
  const paginas = React.useRef(0)

  const gerar = React.useCallback(async () => {
    setErro(null)
    setProgresso(0)
    try {
      const { id, paginasNoVideo } = await tabloideApi.gerarVideo(dados)
      paginas.current = paginasNoVideo
      for (;;) {
        await new Promise((r) => setTimeout(r, 1500))
        const s = await tabloideApi.statusVideo(id)
        if (s.status === 'erro') throw new Error(s.erro ?? 'Não consegui gerar o vídeo.')
        setProgresso(s.progresso)
        if (s.status === 'pronto') {
          const blob = await tabloideApi.baixarVideo(id)
          onPronto({ id, url: URL.createObjectURL(blob), chave })
          setProgresso(1)
          return
        }
      }
    } catch (e) {
      setErro((e as Error).message)
      setProgresso(null)
    }
  }, [dados, chave, onPronto])

  React.useEffect(() => {
    if (!atualizado) void gerar()
    // só na abertura
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <Modal titulo="Vídeo para Reels / Story" onFechar={onFechar} largura={520}>
      {atualizado && video ? (
        <div className="flex flex-col items-center gap-3">
          <video src={video.url} controls autoPlay loop muted playsInline className="max-h-[60vh] rounded-lg bg-black" />
          <p className="text-center text-xs text-[#9A928B]">
            Vídeo vertical 1080×1920, sem música.
          </p>
          <div className="flex flex-wrap justify-center gap-2">
            <button className={btnSecundario} onClick={() => baixarArquivo(video.url, 'tabloide-reels.mp4')}>
              Baixar vídeo
            </button>
            <button className={btnPrimario} onClick={onPublicar}>
              Publicar como Reels
            </button>
          </div>
        </div>
      ) : erro ? (
        <div className="flex flex-col items-center gap-3 py-6 text-center">
          <p className="text-sm text-red-600">{erro}</p>
          <button className={btnPrimario} onClick={() => void gerar()}>
            Tentar de novo
          </button>
        </div>
      ) : (
        <div className="flex flex-col gap-3 py-6 text-center">
          <p className="text-sm font-semibold text-[#2A2622]">Montando o vídeo… leva uns 20 a 60 segundos.</p>
          <div className="h-3 overflow-hidden rounded-full bg-[#F4F1EC]">
            <div className="h-full rounded-full bg-[#C1503F] transition-all" style={{ width: `${Math.round((progresso ?? 0) * 100)}%` }} />
          </div>
          <p className="text-xs text-[#9A928B]">
            O vídeo usa o formato Story e mostra até 4 páginas. Pode fechar esta janela: o vídeo continua sendo feito.
          </p>
        </div>
      )}
    </Modal>
  )
}

const agoraMais = (min: number) => {
  const d = new Date(Date.now() + min * 60_000)
  d.setSeconds(0, 0)
  return new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16)
}

/** Publica (ou agenda) no Instagram/Facebook do mercado, pelo Social media do painel NX. */
export function ModalPublicar({
  dados,
  video,
  chave,
  formatoInicial,
  iaDisponivel,
  onGerarVideo,
  onFechar,
}: {
  dados: DadosTabloide
  video: VideoPronto | null
  chave: string
  formatoInicial: 'feed' | 'story' | 'reels'
  iaDisponivel: boolean
  onGerarVideo: () => void
  onFechar: () => void
}) {
  const [conta, setConta] = React.useState<{ ok: boolean; username?: string; motivo?: string } | null>(null)
  const [formato, setFormato] = React.useState(formatoInicial)
  const [facebook, setFacebook] = React.useState(false)
  const [legenda, setLegenda] = React.useState('')
  const [quando, setQuando] = React.useState<'agora' | 'agendar'>('agora')
  const [dataHora, setDataHora] = React.useState(agoraMais(60))
  const [gerandoLegenda, setGerandoLegenda] = React.useState(false)
  const [enviando, setEnviando] = React.useState(false)
  const [feito, setFeito] = React.useState<string | null>(null)

  React.useEffect(() => {
    tabloideApi
      .instagram()
      .then(setConta)
      .catch((e: Error) => setConta({ ok: false, motivo: e.message }))
  }, [])

  const videoOk = video?.chave === chave
  const gerarLegenda = async () => {
    setGerandoLegenda(true)
    try {
      setLegenda((await tabloideApi.legenda(dados)).legenda)
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setGerandoLegenda(false)
    }
  }

  const publicar = async () => {
    if (formato === 'reels' && !videoOk) return toast.error('Gere o vídeo antes de publicar o Reels.')
    setEnviando(true)
    try {
      const r = await tabloideApi.publicar({
        dados,
        formato,
        legenda,
        agendado_para: quando === 'agendar' ? new Date(dataHora).toISOString() : null,
        redes: formato !== 'story' && facebook ? ['instagram', 'facebook'] : ['instagram'],
        video_id: formato === 'reels' ? video?.id : undefined,
      })
      const hora = new Date(r.agendadoPara).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })
      setFeito(quando === 'agendar' ? `Agendado para ${hora}.` : 'Enviado! Sai no Instagram em até 1 minuto.')
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setEnviando(false)
    }
  }

  return (
    <Modal titulo="Publicar no Instagram" onFechar={onFechar} largura={600}>
      {feito ? (
        <div className="flex flex-col items-center gap-3 py-6 text-center">
          <div className="text-4xl">✅</div>
          <p className="font-bold text-[#2A2622]">{feito}</p>
          <p className="text-sm text-[#7A716A]">
            O post também aparece no Social media do Mercado Nunes, no painel da NX, com o status da publicação.
          </p>
          <button className={btnPrimario} onClick={onFechar}>
            Fechar
          </button>
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          {conta === null ? (
            <p className="text-sm text-[#9A928B]">Conferindo o Instagram do mercado…</p>
          ) : conta.ok ? (
            <p className="rounded-lg bg-green-50 px-3 py-2 text-sm text-green-800">
              Publica em <b>@{conta.username}</b>.
            </p>
          ) : (
            <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">{conta.motivo}</p>
          )}

          <div>
            <div className="mb-1 text-xs font-bold uppercase tracking-wide text-[#7A716A]">Como</div>
            <div className="grid grid-cols-3 gap-2">
              {(
                [
                  ['feed', 'Post no feed', 'Carrossel se tiver mais de uma página'],
                  ['story', 'Story', 'Cada página vira um story'],
                  ['reels', 'Reels', 'O vídeo animado'],
                ] as const
              ).map(([id, nome, dica]) => (
                <button
                  key={id}
                  onClick={() => setFormato(id)}
                  className={`rounded-lg border p-2 text-left ${formato === id ? 'border-[#C1503F] bg-[#FCEFEC]' : 'border-[#E7E1D9] bg-white'}`}
                >
                  <div className="text-sm font-bold text-[#2A2622]">{nome}</div>
                  <div className="text-[11px] text-[#9A928B]">{dica}</div>
                </button>
              ))}
            </div>
            {formato === 'reels' && !videoOk && (
              <div className="mt-2 flex items-center justify-between gap-2 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
                Primeiro gere o vídeo deste tabloide.
                <button className={btnSecundario} onClick={onGerarVideo}>
                  Gerar vídeo
                </button>
              </div>
            )}
            {formato !== 'story' && (
              <label className="mt-2 flex items-center gap-2 text-sm text-[#2A2622]">
                <input type="checkbox" checked={facebook} onChange={(e) => setFacebook(e.target.checked)} />
                Publicar também na página do Facebook
              </label>
            )}
          </div>

          {formato !== 'story' && (
            <div>
              <div className="mb-1 flex items-center justify-between">
                <span className="text-xs font-bold uppercase tracking-wide text-[#7A716A]">Legenda</span>
                {iaDisponivel && (
                  <button className="text-sm font-bold text-[#C1503F] hover:underline disabled:opacity-50" disabled={gerandoLegenda} onClick={gerarLegenda}>
                    {gerandoLegenda ? 'Escrevendo…' : '✨ Escrever com IA'}
                  </button>
                )}
              </div>
              <textarea value={legenda} onChange={(e) => setLegenda(e.target.value)} rows={7} maxLength={2200} className={inputCls} placeholder="Texto do post…" />
              <div className="text-right text-[11px] text-[#9A928B]">{legenda.length}/2200</div>
            </div>
          )}

          <div>
            <div className="mb-1 text-xs font-bold uppercase tracking-wide text-[#7A716A]">Quando</div>
            <div className="flex flex-wrap items-center gap-3 text-sm">
              <label className="flex items-center gap-1.5">
                <input type="radio" checked={quando === 'agora'} onChange={() => setQuando('agora')} /> Agora
              </label>
              <label className="flex items-center gap-1.5">
                <input type="radio" checked={quando === 'agendar'} onChange={() => setQuando('agendar')} /> Agendar
              </label>
              {quando === 'agendar' && (
                <input type="datetime-local" value={dataHora} min={agoraMais(2)} onChange={(e) => setDataHora(e.target.value)} className={inputCls} style={{ width: 220 }} />
              )}
            </div>
          </div>

          <div className="flex justify-end gap-2">
            <button className={btnSecundario} onClick={onFechar}>
              Cancelar
            </button>
            <button className={btnPrimario} disabled={enviando || !conta?.ok} onClick={publicar}>
              {enviando ? 'Enviando…' : quando === 'agendar' ? 'Agendar' : 'Publicar agora'}
            </button>
          </div>
        </div>
      )}
    </Modal>
  )
}

/** Legenda pronta pra copiar (WhatsApp, Facebook…), sem publicar. */
export function ModalLegenda({ dados, onFechar }: { dados: DadosTabloide; onFechar: () => void }) {
  const [legenda, setLegenda] = React.useState<string | null>(null)
  const [erro, setErro] = React.useState<string | null>(null)
  const gerar = React.useCallback(() => {
    setLegenda(null)
    setErro(null)
    tabloideApi
      .legenda(dados)
      .then((r) => setLegenda(r.legenda))
      .catch((e: Error) => setErro(e.message))
  }, [dados])
  React.useEffect(gerar, [])
  return (
    <Modal titulo="Legenda com IA" onFechar={onFechar} largura={560}>
      {erro ? (
        <p className="text-sm text-red-600">{erro}</p>
      ) : legenda === null ? (
        <p className="py-6 text-center text-sm text-[#9A928B]">Escrevendo a legenda…</p>
      ) : (
        <div className="flex flex-col gap-3">
          <textarea value={legenda} onChange={(e) => setLegenda(e.target.value)} rows={10} className={inputCls} />
          <div className="flex justify-end gap-2">
            <button className={btnSecundario} onClick={gerar}>
              Escrever outra
            </button>
            <button
              className={btnPrimario}
              onClick={() => {
                void navigator.clipboard.writeText(legenda).then(() => toast.success('Legenda copiada.'))
              }}
            >
              Copiar
            </button>
          </div>
        </div>
      )}
    </Modal>
  )
}
