import * as React from 'react'
import { toast } from 'sonner'
import { fotoDoProduto, tabloideApi, type ConfigTabloide, type ProdutoCatalogo, type SecaoPromocao } from '@/api/mercadoNunesTabloide'
import { DADOS_VAZIOS, FORMATOS, modeloPorId, type FormatoTabloide, type ItemTabloide } from '../../../server/src/lib/tabloide/layout'
import { Modal, btnPrimario, btnSecundario } from './EscolherFoto'

/**
 * Importar o PDF de promoções do ERP (o mesmo das plaquinhas em massa) e criar UM TABLOIDE POR SEÇÃO (tipo de
 * produto). Variações do mesmo produto com o mesmo preço (Coca-Cola + Coca-Cola Zero) já vêm juntas do servidor
 * e viram um card só com as fotos lado a lado.
 */

const novoId = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`

const lerComoDataUrl = (f: File) =>
  new Promise<string>((resolve, reject) => {
    const r = new FileReader()
    r.onerror = () => reject(new Error('Não consegui ler o arquivo.'))
    r.onload = () => resolve(String(r.result))
    r.readAsDataURL(f)
  })

/** "PRODUTOS LIMPEZA" → "Produtos limpeza" (vai como chamada embaixo do título da arte). */
const frase = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1).toLowerCase() : '')

/** Roda `fn` em todos os itens, `n` por vez (pra não abrir 100 buscas de foto de uma vez). */
async function emLotes<T>(lista: T[], n: number, fn: (x: T) => Promise<void>) {
  let i = 0
  const trabalhador = async () => {
    while (i < lista.length) await fn(lista[i++])
  }
  await Promise.all(Array.from({ length: Math.min(n, lista.length) }, trabalhador))
}

export function ImportarPromocao({ config, onCriados }: { config: ConfigTabloide | null; onCriados: () => void }) {
  const [lendo, setLendo] = React.useState(false)
  const [secoes, setSecoes] = React.useState<SecaoPromocao[] | null>(null)
  const [ignorados, setIgnorados] = React.useState('')
  const [formato, setFormato] = React.useState<FormatoTabloide>('feed')
  const [progresso, setProgresso] = React.useState<string | null>(null)

  const ler = async (f: File | undefined) => {
    if (!f) return
    if (!/\.pdf$/i.test(f.name) && f.type !== 'application/pdf') return toast.error('Escolha um arquivo PDF.')
    setLendo(true)
    try {
      const r = await tabloideApi.lerPromocao(await lerComoDataUrl(f))
      setSecoes(r.secoes)
      setIgnorados(
        [
          r.inativos ? `${r.inativos} inativo(s)` : '',
          r.vencidos ? `${r.vencidos} vencido(s)` : '',
          r.repetidos ? `${r.repetidos} repetido(s)` : '',
        ]
          .filter(Boolean)
          .join(', '),
      )
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setLendo(false)
    }
  }

  const criar = async () => {
    if (!secoes) return
    try {
      // 1. Acha a foto de cada variação: no catálogo (código de barras ou nome) e, se não tiver, nas bases pelo código.
      const variacoes = secoes.flatMap((s) => s.itens.flatMap((i) => i.variacoes.map((v) => ({ ...v, detalhe: i.detalhe }))))
      const achados = new Map<string, ProdutoCatalogo | null>() // chave: ean || nome
      const chave = (v: { nome: string; ean: string }) => v.ean || v.nome
      for (let n = 0; n < variacoes.length; n += 120) {
        setProgresso(`Procurando as fotos no catálogo… ${Math.min(n + 120, variacoes.length)}/${variacoes.length}`)
        const lote = variacoes.slice(n, n + 120)
        const { resultados } = await tabloideApi.combinar(lote.map((v) => ({ nome: v.nome, detalhe: v.detalhe, ean: v.ean })))
        lote.forEach((v, k) => achados.set(chave(v), resultados[k]?.produto ?? null))
      }
      const faltando = variacoes.filter((v) => v.ean && !achados.get(chave(v))?.tem_foto)
      let feitos = 0
      await emLotes(faltando, 4, async (v) => {
        const p = await tabloideApi.porEan(v.ean, v.nome, v.detalhe).then((r) => r.produto).catch(() => null)
        if (p) achados.set(chave(v), p)
        setProgresso(`Buscando fotos que faltam pelo código de barras… ${++feitos}/${faltando.length}`)
      })

      // 2. Um tabloide por seção, salvo no histórico.
      let semFoto = 0
      for (const [n, s] of secoes.entries()) {
        setProgresso(`Criando os tabloides… ${n + 1}/${secoes.length}`)
        const itens: ItemTabloide[] = s.itens.map((i) => {
          const comFoto = i.variacoes
            .map((v) => achados.get(chave(v)) ?? null)
            .filter((p): p is ProdutoCatalogo => !!p?.tem_foto)
          // Produto repetido no catálogo (dois códigos, mesma foto) não aparece duas vezes.
          const unicos = comFoto.filter((p, k) => comFoto.findIndex((x) => x.id === p.id) === k)
          if (!unicos.length) semFoto++
          const [primeira, ...resto] = unicos
          return {
            id: novoId(),
            nome: i.nome,
            detalhe: [i.detalhe, i.minUnidades ? `a partir de ${i.minUnidades} un` : ''].filter(Boolean).join(' · ').slice(0, 40),
            preco: i.preco,
            precoDe: i.precoDe,
            unidade: '',
            destaque: false,
            produtoId: primeira?.id ?? null,
            fotoUrl: primeira ? fotoDoProduto(primeira) : null,
            extras: resto.map((p) => ({ produtoId: p.id, fotoUrl: fotoDoProduto(p) })),
          }
        })
        const dados = {
          ...DADOS_VAZIOS(),
          modeloId: s.modeloId,
          formato,
          subtitulo: frase(s.secao),
          validade: s.validade,
          itens,
          endereco: config?.endereco ?? '',
          whatsapp: config?.whatsapp ?? '',
          endereco2: config?.endereco2 ?? '',
          whatsapp2: config?.whatsapp2 ?? '',
          aviso: config?.aviso || DADOS_VAZIOS().aviso,
        }
        await tabloideApi.criarTabloide(`${s.secao}${s.validade ? ` — ${s.validade}` : ''}`, dados)
      }
      toast.success(
        `${secoes.length} tabloide${secoes.length > 1 ? 's' : ''} criado${secoes.length > 1 ? 's' : ''} no Histórico.` +
          (semFoto ? ` ${semFoto} produto(s) sem foto — abra o tabloide e ponha a foto.` : ''),
        { duration: 8000 },
      )
      setSecoes(null)
      onCriados()
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setProgresso(null)
    }
  }

  const totalItens = secoes?.reduce((t, s) => t + s.itens.length, 0) ?? 0
  const juntos = secoes?.reduce((t, s) => t + s.itens.filter((i) => i.variacoes.length > 1).length, 0) ?? 0

  return (
    <>
      <div className="nunes-card mb-4 flex flex-wrap items-center gap-3 p-4">
        <label
          className={`${btnPrimario} cursor-pointer ${lendo ? 'opacity-60' : ''}`}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault()
            void ler(e.dataTransfer.files?.[0])
          }}
        >
          📄 {lendo ? 'Lendo o relatório…' : 'Importar PDF de promoções'}
          <input
            type="file"
            accept="application/pdf,.pdf"
            hidden
            disabled={lendo}
            onChange={(e) => {
              void ler(e.target.files?.[0])
              e.target.value = ''
            }}
          />
        </label>
        <span className="text-xs text-[#7A716A]">
          O mesmo relatório das plaquinhas ("Itens em Promoção" ou "Promoção de Produto"). Cria <b>um tabloide por tipo de produto</b>, e o
          mesmo produto com o mesmo preço (ex.: Coca-Cola e Coca-Cola Zero) sai num card só, com as fotos juntas.
        </span>
      </div>

      {secoes && (
        <Modal titulo="Tabloides do relatório" onFechar={progresso ? () => {} : () => setSecoes(null)} largura={620}>
          <div className="flex flex-col gap-4">
            <p className="text-sm text-[#5B534D]">
              <b>{secoes.length}</b> tipo{secoes.length > 1 ? 's' : ''} de produto, <b>{totalItens}</b> card{totalItens !== 1 ? 's' : ''}
              {juntos > 0 && <> ({juntos} com variações juntas)</>}.{ignorados && <span className="text-[#9A928B]"> Ignorados: {ignorados}.</span>}
            </p>
            <div className="grid max-h-[46vh] gap-2 overflow-y-auto pr-1">
              {secoes.map((s) => (
                <div key={s.secao} className="rounded-xl border border-[#E7E1D9] bg-white p-3">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <b className="text-[#2A2622]">{s.secao}</b>
                    <span className="text-xs text-[#7A716A]">
                      {s.itens.length} card{s.itens.length !== 1 ? 's' : ''} · modelo {modeloPorId(s.modeloId).nome}
                      {s.validade ? ` · ${s.validade}` : ''}
                    </span>
                  </div>
                  <div className="mt-1 truncate text-[11px] text-[#9A928B]">
                    {s.itens.map((i) => (i.variacoes.length > 1 ? `${i.nome} (${i.variacoes.length} juntos)` : i.nome)).join(', ')}
                  </div>
                </div>
              ))}
            </div>
            <label className="flex items-center gap-2 text-sm font-semibold text-[#5B534D]">
              Formato:
              <select value={formato} onChange={(e) => setFormato(e.target.value as FormatoTabloide)} className="rounded-lg border border-[#E7E1D9] bg-white px-2 py-1.5">
                {(Object.keys(FORMATOS) as FormatoTabloide[]).map((f) => (
                  <option key={f} value={f}>
                    {FORMATOS[f].nome}
                  </option>
                ))}
              </select>
            </label>
            <div className="flex flex-wrap items-center justify-end gap-2">
              {progresso && <span className="mr-auto text-sm text-[#7A716A]">{progresso}</span>}
              <button className={btnSecundario} onClick={() => setSecoes(null)} disabled={!!progresso}>
                Cancelar
              </button>
              <button className={btnPrimario} onClick={() => void criar()} disabled={!!progresso}>
                {progresso ? 'Criando…' : `Criar ${secoes.length} tabloide${secoes.length > 1 ? 's' : ''}`}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </>
  )
}
