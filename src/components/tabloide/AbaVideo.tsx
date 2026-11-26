import * as React from 'react'
import { toast } from 'sonner'
import { tabloideApi, type ConfigTabloide, type TabloideSalvo } from '@/api/mercadoNunesTabloide'
import { DADOS_VAZIOS, type DadosTabloide } from '../../../server/src/lib/tabloide/layout'
import { btnPrimario, btnSecundario, inputCls } from './EscolherFoto'
import { MiniaturaTabloide } from './Previa'
import { ModalPublicar, PainelVideo, type VideoPronto } from './Saidas'

const ATUAL = 'atual'
const POR_VEZ = 12

interface Opcao {
  id: string
  titulo: string
  detalhe: string
  dados: DadosTabloide
}

const produtos = (n: number) => `${n} produto${n !== 1 ? 's' : ''}`

function Cartao({ opcao, onEscolher }: { opcao: Opcao; onEscolher: () => void }) {
  return (
    <button type="button" onClick={onEscolher} className="nunes-card flex flex-col overflow-hidden text-left hover:ring-2 hover:ring-[#C1503F]/50">
      <span className="flex justify-center bg-[#EDE8E1] p-3">
        <MiniaturaTabloide dados={opcao.dados} largura={150} />
      </span>
      <span className="flex flex-col gap-0.5 p-3">
        <span className="text-sm font-bold text-[#2A2622]">{opcao.titulo}</span>
        <span className="text-[11px] text-[#9A928B]">{opcao.detalhe}</span>
      </span>
    </button>
  )
}

/** Aba "Vídeo": escolhe um tabloide pela miniatura (os mais recentes primeiro) e monta o vídeo dele. */
export function AbaVideo({ atual, config, inicial }: { atual: DadosTabloide; config: ConfigTabloide | null; inicial?: string | null }) {
  const [salvos, setSalvos] = React.useState<TabloideSalvo[] | null>(null)
  const [escolhido, setEscolhido] = React.useState(inicial ?? '')
  const [busca, setBusca] = React.useState('')
  const [quantos, setQuantos] = React.useState(POR_VEZ)
  const [video, setVideo] = React.useState<VideoPronto | null>(null)
  const [publicando, setPublicando] = React.useState(false)

  React.useEffect(() => {
    tabloideApi
      .tabloides()
      .then((r) => setSalvos([...r.tabloides].sort((a, b) => b.updated_at.localeCompare(a.updated_at))))
      .catch((e: Error) => {
        setSalvos([])
        toast.error(e.message)
      })
  }, [])

  const opcoes = React.useMemo<Opcao[]>(() => {
    const lista = (salvos ?? []).map((t) => ({
      id: t.id,
      titulo: t.titulo,
      detalhe: [
        new Date(t.updated_at).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }),
        produtos(t.dados?.itens?.length ?? 0),
        t.pasta ? `📁 ${t.pasta}` : '',
      ]
        .filter(Boolean)
        .join(' · '),
      dados: { ...DADOS_VAZIOS(), ...t.dados },
    }))
    if (!atual.itens.length) return lista
    return [{ id: ATUAL, titulo: 'Em montagem agora', detalhe: produtos(atual.itens.length), dados: atual }, ...lista]
  }, [salvos, atual])

  const aberto = opcoes.find((o) => o.id === escolhido)
  const dados = aberto?.dados ?? null
  const chave = React.useMemo(() => (dados ? JSON.stringify({ ...dados, formato: 'story' }) : ''), [dados])

  if (!aberto) {
    const termo = busca.trim().toLowerCase()
    const filtradas = termo ? opcoes.filter((o) => `${o.titulo} ${o.detalhe}`.toLowerCase().includes(termo)) : opcoes
    return (
      <div className="flex flex-col gap-3">
        <div className="nunes-card flex flex-wrap items-center gap-3 p-3">
          <span className="text-sm font-bold text-[#2A2622]">Escolha o tabloide do vídeo</span>
          <input
            className={inputCls + ' ml-auto max-w-[280px]'}
            placeholder="Buscar pelo nome"
            value={busca}
            onChange={(e) => {
              setBusca(e.target.value)
              setQuantos(POR_VEZ)
            }}
          />
        </div>
        {salvos === null && <p className="p-4 text-center text-sm text-[#9A928B]">Carregando…</p>}
        {salvos !== null && !filtradas.length && <p className="nunes-card p-8 text-center text-sm text-[#7A716A]">Nenhum tabloide encontrado.</p>}
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4">
          {filtradas.slice(0, quantos).map((o) => (
            <Cartao key={o.id} opcao={o} onEscolher={() => setEscolhido(o.id)} />
          ))}
        </div>
        {filtradas.length > quantos && (
          <button className={btnSecundario + ' self-center'} onClick={() => setQuantos((q) => q + POR_VEZ)}>
            Ver mais ({filtradas.length - quantos})
          </button>
        )}
      </div>
    )
  }

  return (
    <div className="mx-auto flex w-full max-w-[560px] flex-col gap-3 rounded-2xl border border-[#E6E1DA] bg-white p-4">
      <div className="flex items-center gap-3">
        <span className="flex-none overflow-hidden rounded-md bg-[#EDE8E1]">
          <MiniaturaTabloide dados={aberto.dados} largura={56} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-bold text-[#2A2622]">{aberto.titulo}</span>
          <span className="block text-[11px] text-[#9A928B]">{aberto.detalhe}</span>
        </span>
        <button className={btnSecundario} onClick={() => setEscolhido('')}>
          Trocar
        </button>
      </div>

      {aberto.dados.itens.length ? (
        <PainelVideo
          key={escolhido}
          dados={aberto.dados}
          chave={chave}
          video={video?.chave === chave ? video : null}
          vozOk={!!config?.voz}
          onPronto={setVideo}
          onPublicar={() => setPublicando(true)}
        />
      ) : (
        <div className="flex flex-col items-center gap-2 py-4">
          <p className="text-sm text-[#9A928B]">Esse tabloide não tem produtos.</p>
          <button className={btnPrimario} onClick={() => setEscolhido('')}>
            Escolher outro
          </button>
        </div>
      )}

      {publicando && (
        <ModalPublicar
          dados={aberto.dados}
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
