import * as React from 'react'
import { toast } from 'sonner'
import { tabloideApi, type ConfigTabloide, type TabloideSalvo } from '@/api/mercadoNunesTabloide'
import { DADOS_VAZIOS, type DadosTabloide } from '../../../server/src/lib/tabloide/layout'
import { inputCls } from './EscolherFoto'
import { ModalPublicar, PainelVideo, type VideoPronto } from './Saidas'

const ATUAL = 'atual'

/** Aba "Vídeo": escolhe um tabloide (o que está em montagem ou um salvo) e monta o vídeo dele. */
export function AbaVideo({ atual, config }: { atual: DadosTabloide; config: ConfigTabloide | null }) {
  const [salvos, setSalvos] = React.useState<TabloideSalvo[] | null>(null)
  const [escolhido, setEscolhido] = React.useState(atual.itens.length ? ATUAL : '')
  const [video, setVideo] = React.useState<VideoPronto | null>(null)
  const [publicando, setPublicando] = React.useState(false)

  React.useEffect(() => {
    tabloideApi
      .tabloides()
      .then((r) => setSalvos(r.tabloides))
      .catch((e: Error) => toast.error(e.message))
  }, [])

  const dados = React.useMemo<DadosTabloide | null>(() => {
    if (escolhido === ATUAL) return atual
    const t = salvos?.find((x) => x.id === escolhido)
    return t ? { ...DADOS_VAZIOS(), ...t.dados } : null
  }, [escolhido, salvos, atual])
  const chave = React.useMemo(() => (dados ? JSON.stringify({ ...dados, formato: 'story' }) : ''), [dados])

  return (
    <div className="mx-auto flex w-full max-w-[560px] flex-col gap-3 rounded-2xl border border-[#E6E1DA] bg-white p-4">
      <label className="flex flex-col gap-1 text-sm font-bold text-[#2A2622]">
        Tabloide do vídeo
        <select className={inputCls + ' font-normal'} value={escolhido} onChange={(e) => setEscolhido(e.target.value)}>
          <option value="">{salvos === null ? 'Carregando…' : 'Escolha o tabloide'}</option>
          {atual.itens.length > 0 && <option value={ATUAL}>Em montagem agora ({atual.itens.length} produtos)</option>}
          {(salvos ?? []).map((t) => (
            <option key={t.id} value={t.id}>
              {t.titulo}
            </option>
          ))}
        </select>
      </label>

      {dados && !dados.itens.length && <p className="text-sm text-[#9A928B]">Esse tabloide não tem produtos.</p>}
      {dados && dados.itens.length > 0 && (
        <PainelVideo
          key={escolhido}
          dados={dados}
          chave={chave}
          video={video?.chave === chave ? video : null}
          vozOk={!!config?.voz}
          onPronto={setVideo}
          onPublicar={() => setPublicando(true)}
        />
      )}

      {publicando && dados && (
        <ModalPublicar
          dados={dados}
          video={video}
          chave={chave}
          formatoInicial="reels"
          iaDisponivel={!!config?.ia}
          onGerarVideo={() => setPublicando(false)}
          onFechar={() => setPublicando(false)}
        />
      )}
    </div>
  )
}
