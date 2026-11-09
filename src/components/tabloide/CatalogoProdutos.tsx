import * as React from 'react'
import { toast } from 'sonner'
import { fotoDoProduto, lerImagem, tabloideApi, type ModoRecorte, type ProdutoCatalogo } from '@/api/mercadoNunesTabloide'
import { BiparEmMassa } from './BiparEmMassa'
import { Modal, MiniFoto, NovoProduto, XADREZ, btnPrimario, btnSecundario, inputCls } from './EscolherFoto'

/**
 * Catálogo de produtos do mercado: cada produto ganha foto uma vez e entra sozinho em todo tabloide.
 */
export function CatalogoProdutos({ removeBg }: { removeBg: boolean }) {
  const [q, setQ] = React.useState('')
  const [produtos, setProdutos] = React.useState<ProdutoCatalogo[] | null>(null)
  const [novo, setNovo] = React.useState(false)
  const [bipando, setBipando] = React.useState(false)
  const [editando, setEditando] = React.useState<ProdutoCatalogo | null>(null)

  const carregar = React.useCallback(() => {
    tabloideApi
      .produtos(q)
      .then((r) => setProdutos(r.produtos))
      .catch((e: Error) => toast.error(e.message))
  }, [q])

  React.useEffect(() => {
    const t = setTimeout(carregar, 250)
    return () => clearTimeout(t)
  }, [carregar])

  const semFoto = produtos?.filter((p) => !p.tem_foto).length ?? 0

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar por nome ou código de barras…" className={`${inputCls} max-w-md flex-1`} />
        <button className={btnSecundario} onClick={() => setBipando(true)}>
          Bipar em massa
        </button>
        <button className={btnPrimario} onClick={() => setNovo(true)}>
          + Novo produto
        </button>
      </div>
      {semFoto > 0 && (
        <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
          {semFoto} produto{semFoto > 1 ? 's' : ''} sem foto nesta lista. Clique neles para pôr a foto.
        </p>
      )}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
        {produtos === null && <p className="col-span-full p-6 text-center text-sm text-[#9A928B]">Carregando…</p>}
        {produtos?.length === 0 && (
          <p className="col-span-full rounded-xl bg-white p-8 text-center text-sm text-[#7A716A]">
            {q ? 'Nenhum produto com esse nome.' : 'O catálogo está vazio. Cadastre os produtos com foto, ou cole a lista no tabloide e ponha as fotos por lá.'}
          </p>
        )}
        {produtos?.map((p) => (
          <button
            key={p.id}
            onClick={() => setEditando(p)}
            className={`flex flex-col items-center gap-1.5 rounded-xl border bg-white p-2.5 text-center hover:shadow-md ${p.tem_foto ? 'border-[#E7E1D9]' : 'border-amber-300 bg-amber-50'}`}
          >
            <MiniFoto produto={p} tamanho={110} />
            <span className="line-clamp-2 text-xs font-bold text-[#2A2622]">{p.nome}</span>
            <span className="text-[11px] text-[#9A928B]">{[p.detalhe, p.marca].filter(Boolean).join(' · ') || '—'}</span>
            {p.tem_foto && !p.fundo_removido && <span className="text-[10px] font-semibold text-amber-700">com fundo</span>}
          </button>
        ))}
      </div>

      {novo && (
        <Modal titulo="Novo produto" onFechar={() => setNovo(false)}>
          <NovoProduto
            onCriado={() => {
              setNovo(false)
              carregar()
            }}
          />
        </Modal>
      )}
      {bipando && (
        <BiparEmMassa
          onFechar={() => {
            setBipando(false)
            carregar()
          }}
        />
      )}
      {editando && (
        <EditarProduto
          produto={editando}
          removeBg={removeBg}
          onFechar={() => setEditando(null)}
          onMudou={(p) => {
            setEditando(p)
            carregar()
          }}
          onRemovido={() => {
            setEditando(null)
            carregar()
          }}
        />
      )}
    </div>
  )
}

function EditarProduto({
  produto,
  removeBg,
  onFechar,
  onMudou,
  onRemovido,
}: {
  produto: ProdutoCatalogo
  removeBg: boolean
  onFechar: () => void
  onMudou: (p: ProdutoCatalogo) => void
  onRemovido: () => void
}) {
  const [nome, setNome] = React.useState(produto.nome)
  const [detalhe, setDetalhe] = React.useState(produto.detalhe)
  const [marca, setMarca] = React.useState(produto.marca)
  const [ean, setEan] = React.useState(produto.ean ?? '')
  const [ocupado, setOcupado] = React.useState<string | null>(null)

  const salvar = async () => {
    setOcupado('salvar')
    try {
      onMudou(await tabloideApi.editarProduto(produto.id, { nome, detalhe, marca, ean: ean.replace(/\D/g, '') || null }))
      toast.success('Produto salvo.')
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setOcupado(null)
    }
  }

  const foto = async (arquivo: File | null, modo: ModoRecorte) => {
    setOcupado(modo)
    try {
      const dataUrl = arquivo ? await lerImagem(arquivo) : null
      const r = await tabloideApi.fotoDoProduto(produto.id, dataUrl, modo)
      if (r.aviso) toast.warning(r.aviso, { duration: 8000 })
      else toast.success(modo === 'sem' ? 'Foto inteira, sem recorte.' : 'Foto recortada.')
      onMudou(r.produto)
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setOcupado(null)
    }
  }

  const remover = async () => {
    if (!window.confirm(`Excluir "${produto.nome}" do catálogo?`)) return
    try {
      await tabloideApi.removerProduto(produto.id)
      toast.success('Produto excluído.')
      onRemovido()
    } catch (e) {
      toast.error((e as Error).message)
    }
  }

  const url = fotoDoProduto(produto)
  return (
    <Modal titulo="Produto do catálogo" onFechar={onFechar}>
      <div className="grid gap-4 sm:grid-cols-[220px_1fr]">
        <div className="flex flex-col gap-2">
          <div className="flex h-[220px] items-center justify-center overflow-hidden rounded-lg border border-[#E7E1D9]" style={XADREZ}>
            {url ? <img src={url} alt="" className="max-h-full max-w-full object-contain" /> : <span className="text-sm text-[#B0A79F]">sem foto</span>}
          </div>
          <label className={`${btnPrimario} cursor-pointer`}>
            {ocupado === 'auto' ? 'Recortando…' : url ? 'Trocar foto' : 'Pôr foto'}
            <input type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => e.target.files?.[0] && void foto(e.target.files[0], 'auto')} />
          </label>
          {produto.tem_foto && (
            <div className="flex flex-col gap-1 text-xs">
              <span className="font-semibold text-[#7A716A]">Refazer o recorte desta foto:</span>
              <div className="flex flex-wrap gap-1">
                <button className={btnSecundario} disabled={!!ocupado} onClick={() => void foto(null, 'auto')}>
                  Automático
                </button>
                <button className={btnSecundario} disabled={!!ocupado} onClick={() => void foto(null, 'sem')}>
                  Sem recorte
                </button>
                {removeBg && (
                  <button className={btnSecundario} disabled={!!ocupado} onClick={() => void foto(null, 'removebg')}>
                    Avançado
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
        <div className="flex flex-col gap-2">
          <label className="text-xs font-semibold text-[#7A716A]">
            Nome
            <input value={nome} onChange={(e) => setNome(e.target.value)} className={inputCls} />
          </label>
          <div className="grid grid-cols-2 gap-2">
            <label className="text-xs font-semibold text-[#7A716A]">
              Peso / medida
              <input value={detalhe} onChange={(e) => setDetalhe(e.target.value)} className={inputCls} />
            </label>
            <label className="text-xs font-semibold text-[#7A716A]">
              Marca
              <input value={marca} onChange={(e) => setMarca(e.target.value)} className={inputCls} />
            </label>
          </div>
          <label className="text-xs font-semibold text-[#7A716A]">
            Código de barras
            <input value={ean} onChange={(e) => setEan(e.target.value)} inputMode="numeric" className={inputCls} />
          </label>
          <div className="mt-auto flex justify-between gap-2 pt-2">
            <button className="text-sm font-semibold text-red-600 hover:underline" onClick={remover}>
              Excluir
            </button>
            <button className={btnPrimario} onClick={salvar} disabled={ocupado === 'salvar'}>
              Salvar
            </button>
          </div>
        </div>
      </div>
    </Modal>
  )
}
