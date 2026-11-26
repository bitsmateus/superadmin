import * as React from 'react'
import { toast } from 'sonner'
import { lerFundo, tabloideApi, urlDaMusica, type FundoSalvo, type MusicaSalva, type VolumesVideo } from '@/api/mercadoNunesTabloide'
import { btnSecundario, inputCls } from './EscolherFoto'

/** Música, fundo e volumes do vídeo. As músicas e fundos ficam salvos no servidor; a escolha, no navegador. */
export interface PrefsVideo {
  musicaId: string
  fundoId: string
  volumes: VolumesVideo
}

const CHAVE = 'mn-video-prefs'
const PADRAO: PrefsVideo = { musicaId: '', fundoId: '', volumes: { musica: 25, voz: 100, efeitos: 50 } }

export function usePrefsVideo() {
  const [prefs, setPrefs] = React.useState<PrefsVideo>(() => {
    try {
      const salvo = JSON.parse(localStorage.getItem(CHAVE) ?? '{}') as Partial<PrefsVideo>
      return { ...PADRAO, ...salvo, volumes: { ...PADRAO.volumes, ...salvo.volumes } }
    } catch {
      return PADRAO
    }
  })
  const mudar = React.useCallback((p: Partial<PrefsVideo>) => {
    setPrefs((atual) => {
      const novo = { ...atual, ...p }
      try {
        localStorage.setItem(CHAVE, JSON.stringify(novo))
      } catch {
        /* sem armazenamento: só não lembra */
      }
      return novo
    })
  }, [])
  return [prefs, mudar] as const
}

const lerArquivo = (arquivo: File) =>
  new Promise<string>((resolve, reject) => {
    const leitor = new FileReader()
    leitor.onload = () => resolve(String(leitor.result))
    leitor.onerror = () => reject(new Error('Não consegui ler o arquivo.'))
    leitor.readAsDataURL(arquivo)
  })

const nomeDoArquivo = (a: File) => a.name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').trim().slice(0, 60)

function Volume({ rotulo, valor, max, onMudar }: { rotulo: string; valor: number; max: number; onMudar: (v: number) => void }) {
  return (
    <label className="flex items-center gap-2 text-xs font-semibold text-[#6B645D]">
      <span className="w-28 flex-none">{rotulo}</span>
      <input type="range" min={0} max={max} step={5} value={valor} onChange={(e) => onMudar(Number(e.target.value))} className="flex-1 accent-[#C1503F]" />
      <span className="w-10 flex-none text-right tabular-nums">{valor}%</span>
    </label>
  )
}

export function SomEFundo({ prefs, mudar, comVoz }: { prefs: PrefsVideo; mudar: (p: Partial<PrefsVideo>) => void; comVoz: boolean }) {
  const [musicas, setMusicas] = React.useState<MusicaSalva[] | null>(null)
  const [fundos, setFundos] = React.useState<FundoSalvo[] | null>(null)
  const [enviando, setEnviando] = React.useState<null | 'musica' | 'fundo'>(null)
  const [tocando, setTocando] = React.useState(false)
  const player = React.useRef<HTMLAudioElement | null>(null)

  const parar = React.useCallback(() => {
    player.current?.pause()
    player.current = null
    setTocando(false)
  }, [])

  React.useEffect(() => {
    tabloideApi.musicas().then((r) => setMusicas(r.musicas)).catch(() => toast.error('Não consegui listar as músicas.'))
    tabloideApi.fundos().then((r) => setFundos(r.fundos)).catch(() => toast.error('Não consegui listar os fundos.'))
    return () => player.current?.pause()
  }, [])

  // A música ou o fundo escolhido foi apagado (por aqui ou por outra pessoa): volta pro padrão.
  React.useEffect(() => {
    if (musicas && prefs.musicaId && !musicas.some((m) => m.id === prefs.musicaId)) mudar({ musicaId: '' })
    if (fundos && prefs.fundoId && !fundos.some((f) => f.id === prefs.fundoId)) mudar({ fundoId: '' })
  }, [musicas, fundos, prefs.musicaId, prefs.fundoId, mudar])

  // A prévia toca no volume escolhido, pra dar noção de quanto vai ficar alto.
  React.useEffect(() => {
    if (player.current) player.current.volume = prefs.volumes.musica / 100
  }, [prefs.volumes.musica])

  const volume = (qual: keyof VolumesVideo) => (v: number) => mudar({ volumes: { ...prefs.volumes, [qual]: v } })

  const ouvir = () => {
    if (tocando) return parar()
    const a = new Audio(urlDaMusica(prefs.musicaId))
    a.volume = prefs.volumes.musica / 100
    a.onended = () => setTocando(false)
    player.current = a
    setTocando(true)
    void a.play().catch(() => {
      parar()
      toast.error('Não consegui tocar a música.')
    })
  }

  const enviarMusica = async (arquivo: File | undefined) => {
    if (!arquivo) return
    if (arquivo.size > 14 * 1024 * 1024) return toast.error('Arquivo grande demais (até 14 MB).')
    setEnviando('musica')
    try {
      const m = await tabloideApi.enviarMusica(await lerArquivo(arquivo), nomeDoArquivo(arquivo))
      parar()
      setMusicas((l) => [m, ...(l ?? [])])
      mudar({ musicaId: m.id })
      toast.success('Música salva e escolhida.')
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setEnviando(null)
    }
  }

  const apagarMusica = async () => {
    const m = musicas?.find((x) => x.id === prefs.musicaId)
    if (!m || !window.confirm(`Apagar a música "${m.nome}"? Ela some para todo mundo.`)) return
    try {
      await tabloideApi.removerMusica(m.id)
      parar()
      setMusicas((l) => (l ?? []).filter((x) => x.id !== m.id))
    } catch (e) {
      toast.error((e as Error).message)
    }
  }

  const enviarFundo = async (arquivo: File | undefined) => {
    if (!arquivo) return
    setEnviando('fundo')
    try {
      const imagem = await lerFundo(arquivo)
      const f = await tabloideApi.salvarFundo(imagem, await lerFundo(imagem, 240, 0.7), nomeDoArquivo(arquivo) || 'Fundo do vídeo')
      setFundos((l) => [f, ...(l ?? [])])
      mudar({ fundoId: f.id })
      toast.success('Fundo salvo e escolhido.')
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setEnviando(null)
    }
  }

  const quadro = (ativo: boolean) =>
    `h-20 w-12 flex-none overflow-hidden rounded-lg border-2 ${ativo ? 'border-[#C1503F]' : 'border-[#E6E1DA] hover:border-[#C1503F]/50'}`

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-[#E6E1DA] p-3">
      <div className="flex flex-col gap-1.5">
        <span className="text-sm font-bold text-[#2A2622]">Música de fundo</span>
        <div className="flex flex-wrap items-center gap-2">
          <select
            className={inputCls + ' min-w-[160px] flex-1'}
            value={prefs.musicaId}
            onChange={(e) => {
              parar()
              mudar({ musicaId: e.target.value })
            }}
          >
            <option value="">Sem música</option>
            {(musicas ?? []).map((m) => (
              <option key={m.id} value={m.id}>
                {m.nome}
              </option>
            ))}
          </select>
          {prefs.musicaId && (
            <>
              <button type="button" className={btnSecundario} onClick={ouvir}>
                {tocando ? '⏸ Parar' : '▶ Ouvir'}
              </button>
              <button type="button" className={btnSecundario} onClick={() => void apagarMusica()}>
                Apagar
              </button>
            </>
          )}
          <label className={btnSecundario + ' cursor-pointer'}>
            {enviando === 'musica' ? 'Enviando…' : '+ Enviar música'}
            <input
              type="file"
              accept="audio/*,video/mp4,video/quicktime"
              className="hidden"
              disabled={enviando !== null}
              onChange={(e) => {
                void enviarMusica(e.target.files?.[0])
                e.target.value = ''
              }}
            />
          </label>
        </div>
        <p className="text-[11px] text-[#9A928B]">Use só música que o mercado pode usar: o Instagram pode silenciar música com direito autoral.</p>
      </div>

      <div className="flex flex-col gap-1.5">
        <span className="text-sm font-bold text-[#2A2622]">Fundo</span>
        <div className="flex gap-2 overflow-x-auto pb-1">
          <button type="button" className={quadro(!prefs.fundoId) + ' text-[10px] font-semibold text-[#6B645D]'} onClick={() => mudar({ fundoId: '' })}>
            Do estilo
          </button>
          <label className={quadro(false) + ' flex cursor-pointer items-center justify-center text-center text-[10px] font-semibold text-[#6B645D]'}>
            {enviando === 'fundo' ? '…' : '+ Enviar'}
            <input
              type="file"
              accept="image/*"
              className="hidden"
              disabled={enviando !== null}
              onChange={(e) => {
                void enviarFundo(e.target.files?.[0])
                e.target.value = ''
              }}
            />
          </label>
          {(fundos ?? []).map((f) => (
            <button
              key={f.id}
              type="button"
              title={f.nome}
              aria-label={f.nome || 'Fundo salvo'}
              className={quadro(prefs.fundoId === f.id)}
              style={{ background: `center/cover no-repeat url(${f.miniatura})` }}
              onClick={() => mudar({ fundoId: f.id })}
            />
          ))}
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <span className="text-sm font-bold text-[#2A2622]">Volume</span>
        <Volume rotulo="Música" valor={prefs.volumes.musica} max={100} onMudar={volume('musica')} />
        {comVoz && <Volume rotulo="Locutor" valor={prefs.volumes.voz} max={150} onMudar={volume('voz')} />}
        <Volume rotulo="Efeito (ding)" valor={prefs.volumes.efeitos} max={100} onMudar={volume('efeitos')} />
      </div>
    </div>
  )
}
