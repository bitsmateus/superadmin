import * as React from 'react'
import { toast } from 'sonner'
import { fotoDoProduto, lerImagem, tabloideApi, type ProdutoCatalogo } from '@/api/mercadoNunesTabloide'

/** Fundo xadrez — deixa ver que a foto ficou recortada (transparente). */
export const XADREZ: React.CSSProperties = {
  backgroundColor: '#fff',
  backgroundImage:
    'linear-gradient(45deg,#eee 25%,transparent 25%),linear-gradient(-45deg,#eee 25%,transparent 25%),linear-gradient(45deg,transparent 75%,#eee 75%),linear-gradient(-45deg,transparent 75%,#eee 75%)',
  backgroundSize: '16px 16px',
  backgroundPosition: '0 0,0 8px,8px -8px,-8px 0',
}

export function Modal({ titulo, onFechar, children, largura = 720 }: { titulo: string; onFechar: () => void; children: React.ReactNode; largura?: number }) {
  React.useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && onFechar()
    window.addEventListener('keydown', esc)
    return () => window.removeEventListener('keydown', esc)
  }, [onFechar])
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 p-3 sm:p-8" onMouseDown={onFechar}>
      <div
        className="w-full rounded-xl bg-white shadow-2xl"
        style={{ maxWidth: largura }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-[#E7E1D9] px-4 py-3">
          <h3 className="text-base font-extrabold text-[#2A2622]">{titulo}</h3>
          <button onClick={onFechar} className="rounded px-2 text-xl leading-none text-[#7A716A] hover:bg-[#F4F1EC]" aria-label="Fechar">
            ×
          </button>
        </div>
        <div className="p-4">{children}</div>
      </div>
    </div>
  )
}

export const inputCls =
  'w-full rounded-lg border border-[#E7E1D9] bg-white px-3 py-2 text-sm text-[#2A2622] outline-none focus:border-[#C1503F] focus:ring-2 focus:ring-[#C1503F]/15'
export const btnPrimario =
  'inline-flex items-center justify-center gap-1.5 rounded-lg bg-[#C1503F] px-3.5 py-2 text-sm font-bold text-white hover:bg-[#A9412F] disabled:opacity-50'
export const btnSecundario =
  'inline-flex items-center justify-center gap-1.5 rounded-lg border border-[#E7E1D9] bg-white px-3.5 py-2 text-sm font-semibold text-[#2A2622] hover:bg-[#F4F1EC] disabled:opacity-50'

export function MiniFoto({ produto, tamanho = 56 }: { produto: ProdutoCatalogo | null; tamanho?: number }) {
  const url = produto ? fotoDoProduto(produto) : null
  return (
    <div className="flex flex-none items-center justify-center overflow-hidden rounded-md border border-[#E7E1D9]" style={{ ...XADREZ, width: tamanho, height: tamanho }}>
      {url ? <img src={url} alt="" className="max-h-full max-w-full object-contain" /> : <span className="text-[10px] text-[#B0A79F]">sem foto</span>}
    </div>
  )
}

/**
 * Cadastro rápido de produto com foto (do celular, do computador ou pelo código de barras).
 * Usado no catálogo e no "Pôr foto" de um item do tabloide.
 */
export function NovoProduto({
  inicial,
  onCriado,
}: {
  inicial?: { nome?: string; detalhe?: string; ean?: string }
  onCriado: (p: ProdutoCatalogo) => void
}) {
  const [nome, setNome] = React.useState(inicial?.nome ?? '')
  const [detalhe, setDetalhe] = React.useState(inicial?.detalhe ?? '')
  const [marca, setMarca] = React.useState('')
  const [ean, setEan] = React.useState(inicial?.ean ?? '')
  const [foto, setFoto] = React.useState<string | null>(null)
  const [enviando, setEnviando] = React.useState(false)
  const [buscandoEan, setBuscandoEan] = React.useState(false)

  const escolher = async (arquivo: File | undefined) => {
    if (!arquivo) return
    try {
      setFoto(await lerImagem(arquivo))
    } catch (e) {
      toast.error((e as Error).message)
    }
  }

  const peloCodigo = async () => {
    const codigo = ean.replace(/\D/g, '')
    if (!codigo) return toast.error('Digite o código de barras.')
    setBuscandoEan(true)
    try {
      const r = await tabloideApi.porEan(codigo, nome.trim() || undefined, detalhe.trim() || undefined)
      if (r.aviso) toast.warning(r.aviso)
      else toast.success(r.fonte === 'catalogo' ? 'Já estava no catálogo.' : 'Produto e foto encontrados.')
      onCriado(r.produto)
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setBuscandoEan(false)
    }
  }

  const salvar = async () => {
    if (!nome.trim()) return toast.error('Dê um nome pro produto.')
    setEnviando(true)
    try {
      const r = await tabloideApi.criarProduto({ nome: nome.trim(), detalhe: detalhe.trim(), marca: marca.trim(), ean: ean.replace(/\D/g, ''), foto: foto ?? undefined })
      if (r.aviso) toast.warning(r.aviso, { duration: 8000 })
      else toast.success(foto ? 'Produto salvo com a foto recortada.' : 'Produto salvo.')
      onCriado(r.produto)
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setEnviando(false)
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="rounded-lg border border-[#E7E1D9] bg-[#FBF9F6] p-3">
        <div className="mb-1 text-xs font-bold uppercase tracking-wide text-[#7A716A]">Pelo código de barras</div>
        <div className="flex gap-2">
          <input value={ean} onChange={(e) => setEan(e.target.value)} placeholder="7894900027013" inputMode="numeric" className={inputCls} />
          <button type="button" onClick={peloCodigo} disabled={buscandoEan} className={btnSecundario}>
            {buscandoEan ? 'Buscando…' : 'Buscar foto'}
          </button>
        </div>
        <p className="mt-1 text-[11px] text-[#9A928B]">Busca nome e foto nas bases de produtos. Se não achar, cadastre com foto abaixo.</p>
      </div>

      <div className="grid gap-3 sm:grid-cols-[1fr_160px]">
        <div className="flex flex-col gap-2">
          <label className="text-xs font-semibold text-[#7A716A]">
            Nome
            <input value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Arroz Tio João" className={inputCls} />
          </label>
          <div className="grid grid-cols-2 gap-2">
            <label className="text-xs font-semibold text-[#7A716A]">
              Peso / medida
              <input value={detalhe} onChange={(e) => setDetalhe(e.target.value)} placeholder="5KG" className={inputCls} />
            </label>
            <label className="text-xs font-semibold text-[#7A716A]">
              Marca
              <input value={marca} onChange={(e) => setMarca(e.target.value)} placeholder="Tio João" className={inputCls} />
            </label>
          </div>
        </div>
        <label className="flex cursor-pointer flex-col items-center justify-center gap-1 rounded-lg border-2 border-dashed border-[#E7E1D9] p-2 text-center text-xs text-[#7A716A] hover:border-[#C1503F]" style={foto ? XADREZ : undefined}>
          {foto ? <img src={foto} alt="" className="max-h-28 max-w-full object-contain" /> : <><span className="text-2xl">📷</span>Tirar ou escolher foto</>}
          <input type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => void escolher(e.target.files?.[0])} />
        </label>
      </div>
      <p className="text-[11px] text-[#9A928B]">
        Dica: fotografe o produto de frente, em cima de uma folha branca e com boa luz. O fundo sai sozinho.
      </p>
      <div className="flex justify-end">
        <button type="button" onClick={salvar} disabled={enviando} className={btnPrimario}>
          {enviando ? 'Recortando a foto…' : 'Salvar produto'}
        </button>
      </div>
    </div>
  )
}

/** Escolher a foto de um item do tabloide: busca no catálogo ou cadastra na hora. */
export function EscolherFoto({
  nome,
  detalhe,
  onEscolher,
  onFechar,
}: {
  nome: string
  detalhe: string
  onEscolher: (p: ProdutoCatalogo | null) => void
  onFechar: () => void
}) {
  const [aba, setAba] = React.useState<'buscar' | 'novo'>('buscar')
  const [q, setQ] = React.useState(nome)
  const [produtos, setProdutos] = React.useState<ProdutoCatalogo[] | null>(null)

  React.useEffect(() => {
    const t = setTimeout(() => {
      tabloideApi
        .produtos(q)
        .then((r) => setProdutos(r.produtos))
        .catch((e: Error) => toast.error(e.message))
    }, 250)
    return () => clearTimeout(t)
  }, [q])

  return (
    <Modal titulo={`Foto de "${nome || 'produto'}"`} onFechar={onFechar}>
      <div className="mb-3 flex gap-1 rounded-lg bg-[#F4F1EC] p-1 text-sm font-semibold">
        {(['buscar', 'novo'] as const).map((a) => (
          <button key={a} onClick={() => setAba(a)} className={`flex-1 rounded-md px-3 py-1.5 ${aba === a ? 'bg-white text-[#C1503F] shadow' : 'text-[#7A716A]'}`}>
            {a === 'buscar' ? 'Do catálogo' : 'Cadastrar com foto'}
          </button>
        ))}
      </div>
      {aba === 'buscar' ? (
        <>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar produto…" className={inputCls} autoFocus />
          <div className="mt-3 grid max-h-[55vh] grid-cols-2 gap-2 overflow-y-auto sm:grid-cols-4">
            {produtos === null && <p className="col-span-full p-4 text-center text-sm text-[#9A928B]">Carregando…</p>}
            {produtos?.length === 0 && (
              <div className="col-span-full p-4 text-center text-sm text-[#9A928B]">
                Nada no catálogo com esse nome.{' '}
                <button className="font-bold text-[#C1503F] underline" onClick={() => setAba('novo')}>
                  Cadastrar com foto
                </button>
              </div>
            )}
            {produtos?.map((p) => (
              <button
                key={p.id}
                onClick={() => onEscolher(p)}
                className="flex flex-col items-center gap-1 rounded-lg border border-[#E7E1D9] p-2 text-center hover:border-[#C1503F] hover:shadow"
              >
                <MiniFoto produto={p} tamanho={96} />
                <span className="line-clamp-2 text-xs font-bold text-[#2A2622]">{p.nome}</span>
                <span className="text-[11px] text-[#9A928B]">{p.detalhe || p.marca}</span>
              </button>
            ))}
          </div>
          <div className="mt-3 flex justify-between">
            <button className={btnSecundario} onClick={() => onEscolher(null)}>
              Tirar a foto do item
            </button>
          </div>
        </>
      ) : (
        <NovoProduto inicial={{ nome, detalhe }} onCriado={onEscolher} />
      )}
    </Modal>
  )
}
