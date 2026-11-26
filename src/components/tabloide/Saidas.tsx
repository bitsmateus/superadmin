import * as React from 'react'
import { toast } from 'sonner'
import { baixarArquivo, tabloideApi, type EstiloVideo, type VozLocutor } from '@/api/mercadoNunesTabloide'
import type { DadosTabloide } from '../../../server/src/lib/tabloide/layout'
import { Modal, btnPrimario, btnSecundario, inputCls } from './EscolherFoto'
import { PreviaTabloide } from './Previa'
import { EscolherPaginas } from './EmMassa'
import { SomEFundo, usePrefsVideo } from './SomEFundo'
import { paginar } from '../../../server/src/lib/tabloide/layout'

export interface VideoPronto {
  id: string
  url: string
  chave: string // conteúdo do tabloide quando o vídeo foi gerado (pra saber se ficou velho)
  estilo: EstiloVideo
}

interface PropsVideo {
  dados: DadosTabloide
  chave: string
  video: VideoPronto | null
  /** Locutor configurado no servidor (ElevenLabs). */
  vozOk: boolean
  onPronto: (v: VideoPronto) => void
  onPublicar: () => void
}

export function ModalVideo({ onFechar, ...props }: PropsVideo & { onFechar: () => void }) {
  return (
    <Modal titulo="Vídeo para Reels / Story" onFechar={onFechar} largura={520}>
      <PainelVideo {...props} />
    </Modal>
  )
}

/** Gera o vídeo do Reels/Story no servidor e acompanha o progresso (janela e aba "Vídeo"). */
export function PainelVideo({ dados, chave, video, vozOk, onPronto, onPublicar }: PropsVideo) {
  const atualizado = video?.chave === chave
  const [progresso, setProgresso] = React.useState<number | null>(atualizado ? 1 : null)
  const [erro, setErro] = React.useState<string | null>(null)
  const paginas = React.useRef(0)
  // Antes de gerar: escolher se leva locutor e ajustar o que ele vai falar.
  const [opcoes, setOpcoes] = React.useState(!atualizado)
  const [comLocutor, setComLocutor] = React.useState(vozOk)
  const [prefs, mudarPrefs] = usePrefsVideo()
  // Tabloide de Black Friday já abre no estilo Black Friday.
  const [estilo, setEstilo] = React.useState<EstiloVideo>(
    () => video?.estilo ?? (/black/i.test(`${dados.titulo} ${dados.subtitulo}`) ? 'black' : 'tabloide'),
  )
  const [refazendo, setRefazendo] = React.useState(false)
  const [roteiro, setRoteiro] = React.useState<string[] | null>(null)
  const [aviso, setAviso] = React.useState<string | null>(null)
  const [vozes, setVozes] = React.useState<VozLocutor[]>([])
  const [voz, setVoz] = React.useState(() => {
    try {
      return localStorage.getItem('mn-voz') ?? ''
    } catch {
      return ''
    }
  })
  const vozEscolhida = vozes.find((v) => v.id === voz) ?? vozes[0]
  const amostra = React.useRef<HTMLAudioElement | null>(null)

  React.useEffect(() => {
    if (!vozOk) return
    // Sem a lista o vídeo ainda sai, com a voz padrão do servidor.
    tabloideApi.vozes().then((r) => setVozes(r.vozes)).catch(() => undefined)
    return () => amostra.current?.pause()
  }, [vozOk])

  const escolherVoz = (id: string) => {
    amostra.current?.pause()
    setVoz(id)
    try {
      localStorage.setItem('mn-voz', id)
    } catch {
      /* sem armazenamento: só não lembra */
    }
  }

  const ouvirVoz = () => {
    if (!vozEscolhida?.amostra) return
    amostra.current?.pause()
    amostra.current = new Audio(vozEscolhida.amostra)
    void amostra.current.play().catch(() => toast.error('Não consegui tocar a amostra.'))
  }

  const gerar = React.useCallback(async () => {
    setErro(null)
    setProgresso(0)
    setOpcoes(false)
    try {
      amostra.current?.pause()
      const { id, paginasNoVideo } = await tabloideApi.gerarVideo(dados, {
        roteiro: comLocutor && roteiro ? roteiro : undefined,
        voz: vozEscolhida?.id,
        estilo,
        musicaId: prefs.musicaId || undefined,
        fundoId: prefs.fundoId || undefined,
        volumes: prefs.volumes,
      })
      paginas.current = paginasNoVideo
      for (;;) {
        await new Promise((r) => setTimeout(r, 1500))
        const s = await tabloideApi.statusVideo(id)
        if (s.status === 'erro') throw new Error(s.erro ?? 'Não consegui gerar o vídeo.')
        setProgresso(s.progresso)
        if (s.aviso) setAviso(s.aviso)
        if (s.status === 'pronto') {
          const blob = await tabloideApi.baixarVideo(id)
          onPronto({ id, url: URL.createObjectURL(blob), chave, estilo })
          setProgresso(1)
          return
        }
      }
    } catch (e) {
      setErro((e as Error).message)
      setProgresso(null)
    }
    setRefazendo(false)
  }, [dados, chave, onPronto, comLocutor, roteiro, estilo, vozEscolhida?.id, prefs])

  // O roteiro muda com o estilo (o Black Friday fala uma vez por produto).
  React.useEffect(() => {
    if (!vozOk || !opcoes) return
    let vivo = true
    setRoteiro(null)
    tabloideApi
      .roteiroVideo(dados, estilo)
      .then((r) => vivo && setRoteiro(r.textos))
      .catch((e: Error) => {
        if (!vivo) return
        setErro(e.message)
        setOpcoes(false)
      })
    return () => {
      vivo = false
    }
    // dados só vale na abertura da etapa
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [estilo, opcoes])

  return (
    <>
      {atualizado && video && !refazendo && progresso === 1 ? (
        <div className="flex flex-col items-center gap-3">
          <video src={video.url} controls autoPlay loop muted playsInline className="max-h-[60vh] rounded-lg bg-black" />
          <p className="text-center text-xs text-[#9A928B]">
            Estilo {video.estilo === 'black' ? 'Black Friday' : 'Tabloide'} · vídeo vertical 1080×1920{comLocutor && vozOk ? ', com locutor' : ''}{prefs.musicaId ? ', com música' : ''}.
          </p>
          {aviso && <p className="text-center text-xs text-amber-700">{aviso}</p>}
          <div className="flex flex-wrap justify-center gap-2">
            <button className={btnSecundario} onClick={() => baixarArquivo(video.url, 'tabloide-reels.mp4')}>
              Baixar vídeo
            </button>
            <button className={btnPrimario} onClick={onPublicar}>
              Publicar como Reels
            </button>
            <button
              className={btnSecundario}
              onClick={() => {
                setRefazendo(true)
                setOpcoes(true)
                setProgresso(null)
              }}
            >
              Fazer outro vídeo
            </button>
          </div>
        </div>
      ) : opcoes ? (
        <div className="flex flex-col gap-3">
          <div className="grid grid-cols-2 gap-2">
            {([['tabloide', 'Tabloide', 'Várias ofertas por tela'], ['black', 'Black Friday', 'Um produto por vez, com estrela de preço']] as const).map(([id, nome, desc]) => (
              <button
                key={id}
                type="button"
                onClick={() => setEstilo(id)}
                className={`rounded-xl border-2 p-3 text-left transition ${estilo === id ? 'border-[#C1503F] bg-[#FBEFEC]' : 'border-[#E6E1DA] bg-white hover:border-[#C1503F]/50'}`}
              >
                <span className="block text-sm font-bold text-[#2A2622]">{nome}</span>
                <span className="block text-[11px] text-[#9A928B]">{desc}</span>
              </button>
            ))}
          </div>
          {estilo === 'black' && (
            <p className="text-[11px] text-[#9A928B]">
              Abertura com a logo 3D Black Friday Nunes, até 8 produtos (um por vez, na ordem da lista) e fechamento.
            </p>
          )}
          <SomEFundo prefs={prefs} mudar={mudarPrefs} comVoz={vozOk && comLocutor} />
          {estilo === 'black' && prefs.fundoId && (
            <p className="text-[11px] text-[#9A928B]">A abertura 3D tem o fundo dela; o seu fundo entra a partir dos produtos.</p>
          )}
          {vozOk ? (
            <label className="flex items-center gap-2 text-sm font-semibold text-[#2A2622]">
              <input type="checkbox" checked={comLocutor} onChange={(e) => setComLocutor(e.target.checked)} />
              Com locutor (voz falando os produtos e preços)
            </label>
          ) : (
            <p className="text-xs text-[#9A928B]">Locutor indisponível: falta configurar a chave do ElevenLabs no servidor.</p>
          )}
          {vozOk && comLocutor && (
            <div className="flex flex-col gap-2">
              {vozes.length > 0 && (
                <div className="flex items-end gap-2">
                  <label className="flex flex-1 flex-col gap-1 text-xs font-semibold text-[#6B645D]">
                    Voz do locutor
                    <select className={inputCls + ' font-normal'} value={vozEscolhida?.id ?? ''} onChange={(e) => escolherVoz(e.target.value)}>
                      {vozes.map((v) => (
                        <option key={v.id} value={v.id}>
                          {v.nome}
                        </option>
                      ))}
                    </select>
                  </label>
                  {vozEscolhida?.amostra && (
                    <button type="button" className={btnSecundario} onClick={ouvirVoz}>
                      ▶ Ouvir
                    </button>
                  )}
                </div>
              )}
              <p className="text-xs text-[#9A928B]">O que o locutor vai falar em cada página do vídeo. Pode editar à vontade.</p>
              {roteiro === null ? (
                <p className="py-4 text-center text-xs text-[#9A928B]">Montando o roteiro…</p>
              ) : (
                roteiro.map((t, i) => (
                  <label key={i} className="flex flex-col gap-1 text-xs font-semibold text-[#6B645D]">
                    Página {i + 1}
                    <textarea
                      className={inputCls + ' min-h-[88px] font-normal'}
                      value={t}
                      onChange={(e) => setRoteiro((r) => (r ? r.map((x, j) => (j === i ? e.target.value : x)) : r))}
                    />
                  </label>
                ))
              )}
            </div>
          )}
          <button className={btnPrimario} disabled={vozOk && comLocutor && roteiro === null} onClick={() => void gerar()}>
            Gerar vídeo
          </button>
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
          <p className="text-sm font-semibold text-[#2A2622]">Montando o vídeo… pode levar alguns minutos.</p>
          <div className="h-3 overflow-hidden rounded-full bg-[#F4F1EC]">
            <div className="h-full rounded-full bg-[#C1503F] transition-all" style={{ width: `${Math.round((progresso ?? 0) * 100)}%` }} />
          </div>
          <p className="text-xs text-[#9A928B]">
            {estilo === 'black' ? 'Um produto por vez, até 8.' : 'O vídeo usa o formato Story e mostra até 4 páginas.'} Fique nesta tela até terminar.
          </p>
        </div>
      )}
    </>
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
  const [etapa, setEtapa] = React.useState<'editar' | 'revisar'>('editar')
  const [teste, setTeste] = React.useState<Teste | null | 'testando'>(null)
  // Tabloide com mais de uma página: escolhe quais vão no post (padrão: todas).
  const formatoPaginas = formato === 'story' ? 'story' : 'feed'
  const totalPaginas = paginar(dados.itens, formatoPaginas, dados.porPagina).length
  const [paginasSel, setPaginasSel] = React.useState<number[] | null>(null)
  const paginasValidas = (paginasSel ?? Array.from({ length: totalPaginas }, (_, i) => i)).filter((i) => i < totalPaginas)
  const escolhePaginas = formato !== 'reels' && totalPaginas > 1

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

  const testar = async () => {
    setTeste('testando')
    try {
      setTeste(await tabloideApi.testarConexao())
    } catch (e) {
      setTeste({ itens: [{ nome: 'Servidor', status: 'erro', detalhe: (e as Error).message }], podePublicar: false })
    }
  }

  const irRevisar = () => {
    if (formato === 'reels' && !videoOk) return toast.error('Gere o vídeo antes de publicar o Reels.')
    if (escolhePaginas && !paginasValidas.length) return toast.error('Marque pelo menos uma página para postar.')
    if (quando === 'agendar' && new Date(dataHora).getTime() < Date.now() + 60_000) return toast.error('Escolha um horário pelo menos 1 minuto à frente.')
    setEtapa('revisar')
  }
  const publicar = async () => {
    if (formato === 'reels' && !videoOk) return toast.error('Gere o vídeo antes de publicar o Reels.')
    setEnviando(true)
    try {
      const r = await tabloideApi.publicar({
        dados,
        formato,
        legenda,
        paginas: escolhePaginas ? paginasValidas : undefined,
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
      ) : etapa === 'revisar' ? (
        <div className="flex flex-col gap-4">
          <p className="rounded-lg bg-[#FCEFEC] px-3 py-2 text-sm text-[#2A2622]">
            Confira como vai ficar. Nada foi publicado ainda.
          </p>
          <div className="grid gap-4 sm:grid-cols-[220px_1fr]">
            <div className="max-h-[52vh] overflow-y-auto rounded-lg bg-[#EDE8E1] p-2">
              {formato === 'reels' && video ? (
                <video src={video.url} controls muted playsInline className="w-full rounded-md bg-black" />
              ) : (
                <PreviaTabloide dados={{ ...dados, formato: formato === 'story' ? 'story' : 'feed' }} largura={200} />
              )}
            </div>
            <div className="flex flex-col gap-3 text-sm">
              <ResumoLinha rotulo="Onde">
                Instagram @{conta?.username}
                {formato !== 'story' && facebook ? ' + página do Facebook' : ''}
              </ResumoLinha>
              <ResumoLinha rotulo="Como">
                {formato === 'feed' ? 'Post no feed (carrossel se tiver mais de uma página)' : formato === 'story' ? 'Story (uma por página)' : 'Reels (vídeo)'}
              </ResumoLinha>
              {escolhePaginas && (
                <ResumoLinha rotulo="Páginas">
                  {paginasValidas.length === totalPaginas ? `Todas (${totalPaginas})` : paginasValidas.map((i) => i + 1).join(', ')}
                </ResumoLinha>
              )}
              <ResumoLinha rotulo="Quando">
                {quando === 'agora' ? 'Agora (sai em até 1 minuto)' : new Date(dataHora).toLocaleString('pt-BR', { dateStyle: 'full', timeStyle: 'short' })}
              </ResumoLinha>
              {formato !== 'story' && (
                <ResumoLinha rotulo="Legenda">
                  {legenda.trim() ? (
                    <span className="whitespace-pre-wrap">{legenda}</span>
                  ) : (
                    <span className="text-amber-700">Sem legenda. Volte se quiser escrever uma.</span>
                  )}
                </ResumoLinha>
              )}
            </div>
          </div>
          <div className="flex justify-between gap-2">
            <button className={btnSecundario} onClick={() => setEtapa('editar')} disabled={enviando}>
              ← Voltar e editar
            </button>
            <button className={btnPrimario} disabled={enviando} onClick={publicar}>
              {enviando ? 'Enviando…' : quando === 'agendar' ? '✅ Confirmar agendamento' : '✅ Postar agora'}
            </button>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[#E7E1D9] bg-[#FBF9F6] px-3 py-2">
            {conta === null ? (
              <span className="text-sm text-[#9A928B]">Conferindo o Instagram do mercado…</span>
            ) : conta.ok ? (
              <span className="text-sm text-green-800">
                Publica em <b>@{conta.username}</b>
              </span>
            ) : (
              <span className="text-sm text-amber-800">{conta.motivo}</span>
            )}
            <button className={btnSecundario} onClick={() => void testar()} disabled={teste === 'testando'}>
              {teste === 'testando' ? 'Testando…' : '🔌 Testar conexão'}
            </button>
          </div>
          {teste && teste !== 'testando' && <ResultadoTeste teste={teste} />}

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

          {escolhePaginas && <EscolherPaginas dados={dados} formato={formatoPaginas} value={paginasValidas} onChange={setPaginasSel} />}

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
            <button className={btnPrimario} disabled={!conta?.ok} onClick={irRevisar}>
              Revisar e postar →
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

type Teste = { itens: { nome: string; status: 'ok' | 'aviso' | 'erro'; detalhe: string }[]; podePublicar: boolean }

function ResultadoTeste({ teste }: { teste: Teste }) {
  const icone = { ok: '✅', aviso: '⚠️', erro: '❌' } as const
  return (
    <div className={`rounded-lg border px-3 py-2 ${teste.podePublicar ? 'border-green-200 bg-green-50' : 'border-red-200 bg-red-50'}`}>
      <div className={`mb-1 text-sm font-bold ${teste.podePublicar ? 'text-green-800' : 'text-red-700'}`}>
        {teste.podePublicar ? 'Conexão ok: dá pra publicar.' : 'Tem coisa impedindo a publicação:'}
      </div>
      <ul className="flex flex-col gap-0.5 text-xs">
        {teste.itens.map((i) => (
          <li key={i.nome} className="flex gap-1.5">
            <span>{icone[i.status]}</span>
            <span>
              <b className="text-[#2A2622]">{i.nome}:</b> <span className="text-[#5A524B]">{i.detalhe}</span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}

function ResumoLinha({ rotulo, children }: { rotulo: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-xs font-bold uppercase tracking-wide text-[#7A716A]">{rotulo}</div>
      <div className="text-[#2A2622]">{children}</div>
    </div>
  )
}
