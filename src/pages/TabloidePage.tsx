import * as React from 'react'
import { Link } from 'react-router-dom'
import { toast } from 'sonner'
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import { SortableContext, arrayMove, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { acougueApi, acougueToken, AcougueSemSessao, type AcougueUsuario } from '@/api/acougue'
import {
  baixarArquivo,
  fotoDoProduto,
  tabloideApi,
  type ConfigTabloide,
  type ProdutoCatalogo,
  type TabloideSalvo,
} from '@/api/mercadoNunesTabloide'
import { Moldura, TelaLogin } from '@/pages/AcouguePage'
import { PreviaTabloide } from '@/components/tabloide/Previa'
import { EscolherFoto, XADREZ, btnPrimario, btnSecundario, inputCls } from '@/components/tabloide/EscolherFoto'
import { CatalogoProdutos } from '@/components/tabloide/CatalogoProdutos'
import { ModalLegenda, ModalPublicar, ModalVideo, type VideoPronto } from '@/components/tabloide/Saidas'
import {
  DADOS_VAZIOS,
  FORMATOS,
  MODELOS,
  lerLista,
  modeloPorId,
  paginar,
  type DadosTabloide,
  type FormatoTabloide,
  type ItemTabloide,
} from '../../server/src/lib/tabloide/layout'

/**
 * Tabloide automático do Mercado Nunes — /mercadonunes/tabloide.
 *
 * O mercado cola a lista de ofertas do jeito que manda no WhatsApp; cada produto acha sozinho a foto
 * no catálogo; escolhe modelo e formato; baixa PNG/PDF, gera o vídeo do Reels ou publica direto no
 * Instagram. Mesmo login do açougue (acesso do pessoal do mercado, separado do painel).
 */

const TITULO = 'Tabloide automático'
const SUBTITULO = 'Cole a lista de ofertas e o tabloide sai pronto, com as fotos dos produtos.'
const RASCUNHO = 'mercadonunes.tabloide.rascunho.v1'

const novoId = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`

const lerRascunho = (): { dados: DadosTabloide; idSalvo: string | null } | null => {
  try {
    const r = localStorage.getItem(RASCUNHO)
    if (!r) return null
    const p = JSON.parse(r) as { dados: DadosTabloide; idSalvo: string | null }
    return p?.dados?.itens ? { dados: { ...DADOS_VAZIOS(), ...p.dados }, idSalvo: p.idSalvo ?? null } : null
  } catch {
    return null
  }
}

export function TabloidePage() {
  const [usuario, setUsuario] = React.useState<AcougueUsuario | null>(null)
  const [carregando, setCarregando] = React.useState(true)

  React.useEffect(() => {
    if (!acougueToken.get()) {
      setCarregando(false)
      return
    }
    acougueApi
      .me()
      .then(setUsuario)
      .catch(() => acougueToken.clear())
      .finally(() => setCarregando(false))
  }, [])

  if (carregando) {
    return (
      <Moldura titulo={TITULO} subtitulo={SUBTITULO}>
        <p style={{ color: '#7A716A', textAlign: 'center', padding: 40 }}>Carregando…</p>
      </Moldura>
    )
  }
  if (!usuario) return <TelaLogin onEntrar={setUsuario} titulo={TITULO} subtitulo={SUBTITULO} />
  return (
    <Editor
      usuario={usuario}
      onSair={() => {
        acougueToken.clear()
        setUsuario(null)
      }}
    />
  )
}

type Aba = 'montar' | 'catalogo' | 'historico'

/** As fontes do tabloide também na página (miniaturas dos modelos), não só dentro da prévia. */
function useFontesDoTabloide() {
  React.useEffect(() => {
    if (document.getElementById('fontes-tabloide')) return
    const l = document.createElement('link')
    l.id = 'fontes-tabloide'
    l.rel = 'stylesheet'
    l.href = 'https://fonts.googleapis.com/css2?family=Anton&display=swap'
    document.head.appendChild(l)
  }, [])
}

function Editor({ usuario, onSair }: { usuario: AcougueUsuario; onSair: () => void }) {
  useFontesDoTabloide()
  const inicial = React.useMemo(lerRascunho, [])
  const [aba, setAba] = React.useState<Aba>('montar')
  const [dados, setDados] = React.useState<DadosTabloide>(inicial?.dados ?? DADOS_VAZIOS())
  const [idSalvo, setIdSalvo] = React.useState<string | null>(inicial?.idSalvo ?? null)
  const [config, setConfig] = React.useState<ConfigTabloide | null>(null)
  const [video, setVideo] = React.useState<VideoPronto | null>(null)
  const [modal, setModal] = React.useState<null | 'video' | 'publicar' | 'legenda'>(null)
  const [formatoPublicar, setFormatoPublicar] = React.useState<'feed' | 'story' | 'reels'>('feed')
  const [ocupado, setOcupado] = React.useState<string | null>(null)

  const sessaoCaiu = React.useCallback(
    (e: unknown) => {
      if (e instanceof AcougueSemSessao) {
        toast.error(e.message)
        onSair()
        return true
      }
      return false
    },
    [onSair],
  )

  React.useEffect(() => {
    tabloideApi
      .config()
      .then((c) => {
        setConfig(c)
        // Rodapé vazio no rascunho = usa o padrão salvo do mercado.
        setDados((d) => ({
          ...d,
          endereco: d.endereco || c.endereco,
          whatsapp: d.whatsapp || c.whatsapp,
          aviso: d.aviso || c.aviso,
        }))
      })
      .catch((e) => sessaoCaiu(e) || toast.error((e as Error).message))
  }, [sessaoCaiu])

  React.useEffect(() => {
    try {
      localStorage.setItem(RASCUNHO, JSON.stringify({ dados, idSalvo }))
    } catch {
      /* navegador sem armazenamento: só não guarda o rascunho */
    }
  }, [dados, idSalvo])

  // "Chave" do conteúdo: muda quando algo que aparece no vídeo muda (pra saber se o vídeo ficou velho).
  const chave = React.useMemo(() => JSON.stringify({ ...dados, formato: 'story' }), [dados])

  const muda = (patch: Partial<DadosTabloide>) => setDados((d) => ({ ...d, ...patch }))

  const salvar = async (silencioso = false): Promise<void> => {
    const titulo = `${dados.titulo || modeloPorId(dados.modeloId).tituloPadrao}${dados.validade ? ` — ${dados.validade}` : ''}`
    try {
      if (idSalvo) await tabloideApi.salvarTabloide(idSalvo, titulo, dados)
      else setIdSalvo((await tabloideApi.criarTabloide(titulo, dados)).id)
      if (!silencioso) toast.success('Tabloide salvo no histórico.')
    } catch (e) {
      if (!sessaoCaiu(e)) toast.error((e as Error).message)
    }
  }

  const exportar = async (tipo: 'png' | 'pdf') => {
    if (!dados.itens.length) return toast.error('Coloque pelo menos um produto.')
    setOcupado(tipo)
    try {
      void salvar(true)
      const base = (dados.titulo || modeloPorId(dados.modeloId).tituloPadrao).toLowerCase().replace(/\s+/g, '-')
      if (tipo === 'pdf') {
        baixarArquivo(await tabloideApi.exportarPdf(dados), `${base}.pdf`)
      } else {
        const { arquivos } = await tabloideApi.exportarPng(dados)
        for (const a of arquivos) {
          baixarArquivo(a.dataUrl, a.nome)
          await new Promise((r) => setTimeout(r, 350))
        }
        toast.success(arquivos.length > 1 ? `${arquivos.length} imagens baixadas.` : 'Imagem baixada.')
      }
    } catch (e) {
      if (!sessaoCaiu(e)) toast.error((e as Error).message)
    } finally {
      setOcupado(null)
    }
  }

  const novo = () => {
    if (dados.itens.length && !window.confirm('Começar um tabloide novo? O atual continua no histórico se você salvou.')) return
    setDados({ ...DADOS_VAZIOS(), endereco: config?.endereco ?? '', whatsapp: config?.whatsapp ?? '', aviso: config?.aviso ?? DADOS_VAZIOS().aviso })
    setIdSalvo(null)
    setVideo(null)
  }

  const abrir = (t: TabloideSalvo, copia: boolean) => {
    setDados({ ...DADOS_VAZIOS(), ...t.dados })
    setIdSalvo(copia ? null : t.id)
    setVideo(null)
    setAba('montar')
    toast.success(copia ? 'Cópia aberta. Troque os preços e salve.' : 'Tabloide aberto.')
  }

  return (
    <Moldura
      titulo={TITULO}
      subtitulo={SUBTITULO}
      largura={1320}
      direita={
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <Link to="/mercadonunes" className={btnSecundario}>
            Plaquinhas
          </Link>
          <span className="hidden text-[#7A716A] sm:inline">{usuario.nome || usuario.email}</span>
          <button onClick={onSair} className={btnSecundario}>
            Sair
          </button>
        </div>
      }
    >
      <div className="mb-4 flex gap-1 overflow-x-auto rounded-xl bg-white p-1 text-sm font-bold shadow-sm">
        {(
          [
            ['montar', 'Montar tabloide'],
            ['catalogo', 'Catálogo de produtos'],
            ['historico', 'Histórico'],
          ] as const
        ).map(([id, nome]) => (
          <button
            key={id}
            onClick={() => setAba(id)}
            className={`whitespace-nowrap rounded-lg px-4 py-2 ${aba === id ? 'bg-[#C1503F] text-white' : 'text-[#7A716A] hover:bg-[#F4F1EC]'}`}
          >
            {nome}
          </button>
        ))}
      </div>

      {aba === 'catalogo' && <CatalogoProdutos removeBg={!!config?.removeBg} />}
      {aba === 'historico' && <Historico onAbrir={abrir} sessaoCaiu={sessaoCaiu} />}
      {aba === 'montar' && (
        <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_440px]">
          <div className="flex min-w-0 flex-col gap-4">
            <ListaDeOfertas dados={dados} setDados={setDados} sessaoCaiu={sessaoCaiu} />
            <ModeloEFormato dados={dados} muda={muda} />
            <Textos dados={dados} muda={muda} config={config} setConfig={setConfig} />
          </div>

          <div className="flex flex-col gap-3 lg:sticky lg:top-4">
            <div className="rounded-xl bg-white p-3 shadow-sm">
              <div className="grid grid-cols-2 gap-2">
                <button className={btnPrimario} disabled={!!ocupado} onClick={() => void exportar('png')}>
                  {ocupado === 'png' ? 'Gerando…' : '⬇ Baixar imagem'}
                </button>
                <button className={btnPrimario} disabled={!!ocupado} onClick={() => void exportar('pdf')}>
                  {ocupado === 'pdf' ? 'Gerando…' : '⬇ Baixar PDF'}
                </button>
                <button
                  className={btnSecundario}
                  onClick={() => (dados.itens.length ? setModal('video') : toast.error('Coloque pelo menos um produto.'))}
                >
                  🎬 Vídeo Reels
                </button>
                <button
                  className={btnSecundario}
                  onClick={() => {
                    if (!dados.itens.length) return toast.error('Coloque pelo menos um produto.')
                    setFormatoPublicar(dados.formato === 'story' ? 'story' : 'feed')
                    setModal('publicar')
                  }}
                >
                  📲 Publicar
                </button>
                {config?.ia && (
                  <button className={btnSecundario} onClick={() => (dados.itens.length ? setModal('legenda') : toast.error('Coloque pelo menos um produto.'))}>
                    ✨ Legenda com IA
                  </button>
                )}
                <button className={btnSecundario} onClick={() => void salvar()}>
                  💾 {idSalvo ? 'Salvar' : 'Salvar no histórico'}
                </button>
              </div>
              <button className="mt-2 w-full text-center text-xs font-semibold text-[#7A716A] hover:underline" onClick={novo}>
                Começar um tabloide novo
              </button>
            </div>
            <LarguraDisponivel>{(w) => <PreviaTabloide dados={dados} largura={Math.min(w, 440)} />}</LarguraDisponivel>
          </div>
        </div>
      )}

      {modal === 'video' && (
        <ModalVideo
          dados={dados}
          chave={chave}
          video={video}
          onPronto={setVideo}
          onFechar={() => setModal(null)}
          onPublicar={() => {
            setFormatoPublicar('reels')
            setModal('publicar')
          }}
        />
      )}
      {modal === 'publicar' && (
        <ModalPublicar
          dados={dados}
          video={video}
          chave={chave}
          formatoInicial={formatoPublicar}
          iaDisponivel={!!config?.ia}
          onGerarVideo={() => setModal('video')}
          onFechar={() => setModal(null)}
        />
      )}
      {modal === 'legenda' && <ModalLegenda dados={dados} onFechar={() => setModal(null)} />}
    </Moldura>
  )
}

function LarguraDisponivel({ children }: { children: (w: number) => React.ReactNode }) {
  const ref = React.useRef<HTMLDivElement>(null)
  const [w, setW] = React.useState(0)
  React.useLayoutEffect(() => {
    if (!ref.current) return
    const ro = new ResizeObserver(([e]) => setW(Math.floor(e.contentRect.width)))
    ro.observe(ref.current)
    return () => ro.disconnect()
  }, [])
  return <div ref={ref}>{w > 0 && children(w)}</div>
}

function Bloco({ titulo, dica, children, direita }: { titulo: string; dica?: string; children: React.ReactNode; direita?: React.ReactNode }) {
  return (
    <section className="rounded-xl bg-white p-4 shadow-sm">
      <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="text-base font-extrabold text-[#2A2622]">{titulo}</h2>
          {dica && <p className="text-xs text-[#9A928B]">{dica}</p>}
        </div>
        {direita}
      </div>
      {children}
    </section>
  )
}

// ── 1. Lista de ofertas ─────────────────────────────────────────────────────

function ListaDeOfertas({
  dados,
  setDados,
  sessaoCaiu,
}: {
  dados: DadosTabloide
  setDados: React.Dispatch<React.SetStateAction<DadosTabloide>>
  sessaoCaiu: (e: unknown) => boolean
}) {
  const [texto, setTexto] = React.useState('')
  const [lendo, setLendo] = React.useState(false)
  const [escolhendo, setEscolhendo] = React.useState<ItemTabloide | null>(null)
  const [ean, setEan] = React.useState('')
  const itens = dados.itens
  const setItens = (fn: (i: ItemTabloide[]) => ItemTabloide[]) => setDados((d) => ({ ...d, itens: fn(d.itens) }))
  const mudaItem = (id: string, patch: Partial<ItemTabloide>) => setItens((l) => l.map((i) => (i.id === id ? { ...i, ...patch } : i)))
  const comFoto = (p: ProdutoCatalogo | null): { produtoId: string | null; fotoUrl: string | null } => ({ produtoId: p?.id ?? null, fotoUrl: p ? fotoDoProduto(p) : null })

  const ler = async () => {
    const linhas = lerLista(texto)
    if (!linhas.length) return toast.error('Cole a lista: um produto por linha, com o preço.')
    setLendo(true)
    try {
      const { resultados } = await tabloideApi.combinar(linhas.map((l) => ({ nome: l.nome, detalhe: l.detalhe, ean: l.ean })))
      const novos: ItemTabloide[] = []
      for (const [n, l] of linhas.entries()) {
        let produto = resultados[n]?.produto ?? null
        // Código de barras que ainda não está no catálogo: busca nas bases e cadastra.
        if (!produto && l.ean) produto = await tabloideApi.porEan(l.ean, l.nome || undefined, l.detalhe || undefined).then((r) => r.produto).catch(() => null)
        novos.push({
          id: novoId(),
          nome: l.nome || produto?.nome || '',
          detalhe: l.detalhe || produto?.detalhe || '',
          preco: l.preco,
          precoDe: l.precoDe,
          unidade: l.unidade,
          destaque: false,
          ...comFoto(produto?.tem_foto ? produto : null),
        })
      }
      setItens((l) => [...l, ...novos])
      setTexto('')
      const semFoto = novos.filter((i) => !i.produtoId).length
      const semPreco = novos.filter((i) => !i.preco).length
      toast.success(
        `${novos.length} produto${novos.length > 1 ? 's' : ''} lido${novos.length > 1 ? 's' : ''}.` +
          (semFoto ? ` ${semFoto} sem foto (em amarelo).` : ' Todos com foto!') +
          (semPreco ? ` ${semPreco} sem preço.` : ''),
        { duration: 6000 },
      )
    } catch (e) {
      if (!sessaoCaiu(e)) toast.error((e as Error).message)
    } finally {
      setLendo(false)
    }
  }

  const porCodigo = async () => {
    const codigo = ean.replace(/\D/g, '')
    if (!codigo) return
    try {
      const r = await tabloideApi.porEan(codigo)
      if (r.aviso) toast.warning(r.aviso)
      setItens((l) => [
        ...l,
        { id: novoId(), nome: r.produto.nome, detalhe: r.produto.detalhe, preco: '', precoDe: '', unidade: '', destaque: false, ...comFoto(r.produto.tem_foto ? r.produto : null) },
      ])
      setEan('')
    } catch (e) {
      if (!sessaoCaiu(e)) toast.error((e as Error).message)
    }
  }

  const sensores = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }))
  const soltou = (e: DragEndEvent) => {
    if (!e.over || e.active.id === e.over.id) return
    setItens((l) => arrayMove(l, l.findIndex((i) => i.id === e.active.id), l.findIndex((i) => i.id === e.over!.id)))
  }

  const semFoto = itens.filter((i) => !i.produtoId).length
  const paginas = paginar(itens, dados.formato, dados.porPagina).length

  return (
    <Bloco
      titulo="1. Lista de ofertas"
      dica="Cole do jeito que você manda no WhatsApp: um produto por linha, com o preço."
      direita={
        itens.length > 0 && (
          <button className="text-xs font-semibold text-red-600 hover:underline" onClick={() => window.confirm('Tirar todos os produtos da lista?') && setItens(() => [])}>
            Limpar lista
          </button>
        )
      }
    >
      <textarea
        value={texto}
        onChange={(e) => setTexto(e.target.value)}
        rows={itens.length ? 3 : 7}
        className={`${inputCls} font-mono`}
        placeholder={'Arroz Tio João 5kg 27,90\nCoca-Cola 2L 9,99 de 11,49\nPicanha kg 69,90\n7894900011517 Leite Moça 395g 6,49'}
      />
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <button className={btnPrimario} onClick={() => void ler()} disabled={lendo || !texto.trim()}>
          {lendo ? 'Lendo e buscando fotos…' : itens.length ? 'Adicionar à lista' : 'Ler lista'}
        </button>
        <span className="text-xs text-[#9A928B]">ou pelo código de barras:</span>
        <input
          value={ean}
          onChange={(e) => setEan(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && void porCodigo()}
          placeholder="EAN"
          inputMode="numeric"
          className={inputCls} style={{ width: 160 }}
        />
        <button className={btnSecundario} onClick={() => void porCodigo()} disabled={!ean.trim()}>
          Adicionar
        </button>
      </div>

      {itens.length > 0 && (
        <>
          <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-[#7A716A]">
            <span>
              <b>{itens.length}</b> produto{itens.length > 1 ? 's' : ''} · {paginas} página{paginas > 1 ? 's' : ''}
            </span>
            {semFoto > 0 && <span className="font-semibold text-amber-700">{semFoto} sem foto: clique no quadradinho amarelo</span>}
            <span>Arraste pela alça ⠿ para mudar a ordem · ★ = destaque (bloco grande)</span>
          </div>
          <DndContext sensors={sensores} collisionDetection={closestCenter} onDragEnd={soltou}>
            <SortableContext items={itens.map((i) => i.id)} strategy={verticalListSortingStrategy}>
              <div className="mt-2 flex flex-col gap-1.5">
                {itens.map((item) => (
                  <LinhaItem
                    key={item.id}
                    item={item}
                    onMuda={(p) => mudaItem(item.id, p)}
                    onRemove={() => setItens((l) => l.filter((i) => i.id !== item.id))}
                    onFoto={() => setEscolhendo(item)}
                  />
                ))}
              </div>
            </SortableContext>
          </DndContext>
          <button
            className="mt-2 text-sm font-semibold text-[#C1503F] hover:underline"
            onClick={() => setItens((l) => [...l, { id: novoId(), nome: '', detalhe: '', preco: '', precoDe: '', unidade: '', destaque: false, produtoId: null, fotoUrl: null }])}
          >
            + Adicionar produto à mão
          </button>
        </>
      )}

      {escolhendo && (
        <EscolherFoto
          nome={escolhendo.nome}
          detalhe={escolhendo.detalhe}
          onFechar={() => setEscolhendo(null)}
          onEscolher={(p) => {
            mudaItem(escolhendo.id, {
              ...comFoto(p?.tem_foto ? p : null),
              ...(p && !escolhendo.nome ? { nome: p.nome } : {}),
              ...(p && !escolhendo.detalhe ? { detalhe: p.detalhe } : {}),
            })
            if (p && !p.tem_foto) toast.warning('Esse produto ainda não tem foto. Ponha a foto no catálogo.')
            setEscolhendo(null)
          }}
        />
      )}
    </Bloco>
  )
}

const UNIDADES = [
  ['', '—'],
  ['kg', '/kg'],
  ['un', '/un'],
  ['100g', '/100g'],
  ['cada', 'cada'],
  ['bandeja', '/bandeja'],
  ['dz', '/dúzia'],
] as const

function LinhaItem({ item, onMuda, onRemove, onFoto }: { item: ItemTabloide; onMuda: (p: Partial<ItemTabloide>) => void; onRemove: () => void; onFoto: () => void }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: item.id })
  const campo = 'rounded-md border border-[#E7E1D9] bg-white px-2 py-1.5 text-sm outline-none focus:border-[#C1503F]'
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition, zIndex: isDragging ? 10 : undefined }}
      className={`flex flex-wrap items-center gap-1.5 rounded-lg border p-1.5 sm:flex-nowrap ${item.destaque ? 'border-[#C1503F] bg-[#FCEFEC]' : 'border-[#E7E1D9] bg-[#FBF9F6]'} ${isDragging ? 'shadow-lg' : ''}`}
    >
      <button {...attributes} {...listeners} className="cursor-grab touch-none px-1 text-lg text-[#B0A79F]" aria-label="Arrastar">
        ⠿
      </button>
      <button
        onClick={onFoto}
        title={item.produtoId ? 'Trocar foto' : 'Pôr foto'}
        className={`flex h-11 w-11 flex-none items-center justify-center overflow-hidden rounded-md border ${item.fotoUrl ? 'border-[#E7E1D9]' : 'border-amber-400 bg-amber-100 text-[10px] font-bold text-amber-800'}`}
        style={item.fotoUrl ? XADREZ : undefined}
      >
        {item.fotoUrl ? <img src={item.fotoUrl} alt="" className="max-h-full max-w-full object-contain" /> : 'FOTO'}
      </button>
      <input value={item.nome} onChange={(e) => onMuda({ nome: e.target.value })} placeholder="Produto" className={`${campo} min-w-0 flex-[3_1_140px]`} />
      <input value={item.detalhe} onChange={(e) => onMuda({ detalhe: e.target.value })} placeholder="Peso" className={`${campo} w-20 flex-none`} />
      <input
        value={item.preco}
        onChange={(e) => onMuda({ preco: e.target.value })}
        placeholder="Preço"
        inputMode="decimal"
        className={`${campo} w-20 flex-none font-bold ${item.preco ? '' : 'border-amber-400'}`}
      />
      <input value={item.precoDe} onChange={(e) => onMuda({ precoDe: e.target.value })} placeholder="De" inputMode="decimal" className={`${campo} w-[4.5rem] flex-none text-[#7A716A]`} title="Preço antigo (riscado)" />
      <select value={item.unidade} onChange={(e) => onMuda({ unidade: e.target.value })} className={`${campo} w-[5.5rem] flex-none`}>
        {UNIDADES.map(([v, n]) => (
          <option key={v} value={v}>
            {n}
          </option>
        ))}
      </select>
      <button
        onClick={() => onMuda({ destaque: !item.destaque })}
        title="Destaque (bloco grande)"
        className={`flex-none rounded-md px-1.5 text-xl ${item.destaque ? 'text-[#C1503F]' : 'text-[#D6CFC7] hover:text-[#C1503F]'}`}
      >
        ★
      </button>
      <button onClick={onRemove} title="Tirar da lista" className="flex-none rounded-md px-1.5 text-xl text-[#B0A79F] hover:text-red-600">
        ×
      </button>
    </div>
  )
}

// ── 2. Modelo e formato ─────────────────────────────────────────────────────

function ModeloEFormato({ dados, muda }: { dados: DadosTabloide; muda: (p: Partial<DadosTabloide>) => void }) {
  const grupo = (g: 'dia' | 'sazonal') => (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-4">
      {MODELOS.filter((m) => m.grupo === g).map((m) => (
        <button
          key={m.id}
          onClick={() => muda({ modeloId: m.id })}
          className={`overflow-hidden rounded-lg border-2 text-left ${dados.modeloId === m.id ? 'border-[#C1503F] ring-2 ring-[#C1503F]/20' : 'border-transparent'}`}
        >
          <div className="flex h-12 items-center justify-center px-1" style={{ background: m.fundo }}>
            <span style={{ color: m.titulo, fontFamily: 'Anton, Impact, sans-serif', fontSize: 13, textShadow: `0 1px 0 ${m.tituloSombra}` }} className="truncate">
              {m.tituloPadrao}
            </span>
          </div>
          <div className="flex items-center gap-1 bg-white px-2 py-1">
            <span className="h-3 w-3 rounded-full" style={{ background: m.precoBg, border: '1px solid #0001' }} />
            <span className="truncate text-xs font-semibold text-[#2A2622]">{m.nome}</span>
          </div>
        </button>
      ))}
    </div>
  )
  return (
    <Bloco titulo="2. Modelo e formato">
      <div className="mb-1 text-xs font-bold uppercase tracking-wide text-[#7A716A]">Dia a dia</div>
      {grupo('dia')}
      <div className="mb-1 mt-3 text-xs font-bold uppercase tracking-wide text-[#7A716A]">Datas especiais</div>
      {grupo('sazonal')}

      <div className="mt-4 grid gap-3 sm:grid-cols-[1fr_auto]">
        <div>
          <div className="mb-1 text-xs font-bold uppercase tracking-wide text-[#7A716A]">Formato</div>
          <div className="grid grid-cols-3 gap-2">
            {(Object.keys(FORMATOS) as FormatoTabloide[]).map((f) => (
              <button
                key={f}
                onClick={() => muda({ formato: f })}
                className={`rounded-lg border p-2 text-left ${dados.formato === f ? 'border-[#C1503F] bg-[#FCEFEC]' : 'border-[#E7E1D9] bg-white'}`}
              >
                <div className="text-sm font-bold text-[#2A2622]">{FORMATOS[f].nome}</div>
                <div className="text-[11px] leading-tight text-[#9A928B]">{FORMATOS[f].dica}</div>
              </button>
            ))}
          </div>
        </div>
        <label className="text-xs font-bold uppercase tracking-wide text-[#7A716A]">
          Produtos por página
          <select value={dados.porPagina} onChange={(e) => muda({ porPagina: Number(e.target.value) })} className={`${inputCls} mt-1 font-normal normal-case`}>
            <option value={0}>Automático</option>
            {[4, 6, 9, 12, 16, 20].map((n) => (
              <option key={n} value={n}>
                Até {n}
              </option>
            ))}
          </select>
        </label>
      </div>
    </Bloco>
  )
}

// ── 3. Textos ───────────────────────────────────────────────────────────────

const dataCurta = (iso: string) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}` : '')

function Textos({
  dados,
  muda,
  config,
  setConfig,
}: {
  dados: DadosTabloide
  muda: (p: Partial<DadosTabloide>) => void
  config: ConfigTabloide | null
  setConfig: (c: ConfigTabloide) => void
}) {
  const [de, setDe] = React.useState('')
  const [ate, setAte] = React.useState('')
  const modelo = modeloPorId(dados.modeloId)

  const aplicarDatas = (d: string, a: string) => {
    setDe(d)
    setAte(a)
    if (d && a) muda({ validade: d === a ? `Válido só ${dataCurta(d)}` : `Válido de ${dataCurta(d)} a ${dataCurta(a)}` })
    else if (d) muda({ validade: `Válido a partir de ${dataCurta(d)}` })
  }

  const salvarPadrao = async () => {
    try {
      const c = await tabloideApi.salvarConfig({ endereco: dados.endereco, whatsapp: dados.whatsapp, aviso: dados.aviso })
      if (config) setConfig({ ...config, ...c })
      toast.success('Rodapé salvo como padrão.')
    } catch (e) {
      toast.error((e as Error).message)
    }
  }

  const rotulo = 'text-xs font-semibold text-[#7A716A]'
  return (
    <Bloco titulo="3. Textos">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className={rotulo}>
          Título
          <input value={dados.titulo} onChange={(e) => muda({ titulo: e.target.value })} placeholder={modelo.tituloPadrao} maxLength={60} className={inputCls} />
        </label>
        <label className={rotulo}>
          Chamada (opcional)
          <input value={dados.subtitulo} onChange={(e) => muda({ subtitulo: e.target.value })} placeholder="Só nesta quinta!" maxLength={80} className={inputCls} />
        </label>
        <div className="sm:col-span-2">
          <div className={rotulo}>Validade</div>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <input type="date" value={de} onChange={(e) => aplicarDatas(e.target.value, ate)} className={inputCls} style={{ width: 160 }} />
            <span className="text-xs text-[#9A928B]">até</span>
            <input type="date" value={ate} onChange={(e) => aplicarDatas(de, e.target.value)} className={inputCls} style={{ width: 160 }} />
            <input value={dados.validade} onChange={(e) => muda({ validade: e.target.value })} placeholder="Válido de 06/11 a 09/11" maxLength={80} className={`${inputCls} min-w-[200px] flex-1`} />
          </div>
        </div>
        <label className={rotulo}>
          Endereço
          <input value={dados.endereco} onChange={(e) => muda({ endereco: e.target.value })} placeholder="Rua..., 123 - Centro" maxLength={120} className={inputCls} />
        </label>
        <label className={rotulo}>
          WhatsApp
          <input value={dados.whatsapp} onChange={(e) => muda({ whatsapp: e.target.value })} placeholder="(00) 90000-0000" maxLength={40} className={inputCls} />
        </label>
        <label className={`${rotulo} sm:col-span-2`}>
          Aviso no rodapé
          <input value={dados.aviso} onChange={(e) => muda({ aviso: e.target.value })} maxLength={160} className={inputCls} />
        </label>
      </div>
      <button className="mt-2 text-xs font-semibold text-[#C1503F] hover:underline" onClick={() => void salvarPadrao()}>
        Usar este endereço, WhatsApp e aviso como padrão
      </button>
    </Bloco>
  )
}

// ── Histórico ───────────────────────────────────────────────────────────────

function Historico({ onAbrir, sessaoCaiu }: { onAbrir: (t: TabloideSalvo, copia: boolean) => void; sessaoCaiu: (e: unknown) => boolean }) {
  const [lista, setLista] = React.useState<TabloideSalvo[] | null>(null)
  const carregar = React.useCallback(() => {
    tabloideApi
      .tabloides()
      .then((r) => setLista(r.tabloides))
      .catch((e) => sessaoCaiu(e) || toast.error((e as Error).message))
  }, [sessaoCaiu])
  React.useEffect(carregar, [carregar])

  const remover = async (t: TabloideSalvo) => {
    if (!window.confirm(`Excluir "${t.titulo}" do histórico?`)) return
    await tabloideApi.removerTabloide(t.id).catch((e: Error) => toast.error(e.message))
    carregar()
  }

  if (lista === null) return <p className="p-6 text-center text-sm text-[#9A928B]">Carregando…</p>
  if (!lista.length) return <p className="rounded-xl bg-white p-8 text-center text-sm text-[#7A716A]">Nenhum tabloide salvo ainda. Eles aparecem aqui quando você salva ou baixa.</p>
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {lista.map((t) => {
        const m = modeloPorId(t.dados?.modeloId ?? '')
        const n = t.dados?.itens?.length ?? 0
        return (
          <div key={t.id} className="flex flex-col overflow-hidden rounded-xl bg-white shadow-sm">
            <div className="flex h-16 items-center justify-center px-2" style={{ background: m.fundo }}>
              <span className="truncate" style={{ color: m.titulo, fontFamily: 'Anton, Impact, sans-serif', fontSize: 18, textShadow: `0 2px 0 ${m.tituloSombra}` }}>
                {t.dados?.titulo || m.tituloPadrao}
              </span>
            </div>
            <div className="flex flex-1 flex-col gap-1 p-3">
              <div className="text-sm font-bold text-[#2A2622]">{t.titulo}</div>
              <div className="text-xs text-[#7A716A]">
                {n} produto{n !== 1 ? 's' : ''} · {FORMATOS[t.dados?.formato ?? 'feed']?.nome} · {m.nome}
              </div>
              <div className="text-[11px] text-[#9A928B]">
                {new Date(t.updated_at).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}
                {t.criado_por ? ` · ${t.criado_por}` : ''}
              </div>
              <div className="mt-2 flex flex-wrap gap-2">
                <button className={btnSecundario} onClick={() => onAbrir(t, false)}>
                  Abrir
                </button>
                <button className={btnPrimario} onClick={() => onAbrir(t, true)} title="Abre uma cópia pra trocar os preços">
                  Duplicar
                </button>
                <button className="ml-auto text-xs font-semibold text-red-600 hover:underline" onClick={() => void remover(t)}>
                  Excluir
                </button>
              </div>
            </div>
          </div>
        )
      })}
    </div>
  )
}
