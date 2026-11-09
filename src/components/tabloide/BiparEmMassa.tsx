import * as React from 'react'
import { toast } from 'sonner'
import { lerImagem, tabloideApi, type ProdutoCatalogo } from '@/api/mercadoNunesTabloide'
import { MiniFoto, Modal, NovoProduto, btnPrimario, btnSecundario, inputCls } from './EscolherFoto'

type Status = 'fila' | 'buscando' | 'ok' | 'catalogo' | 'semfoto' | 'naoachou' | 'erro'

interface Bipado {
  ean: string
  status: Status
  produto: ProdutoCatalogo | null
  msg: string
}

/** Bipe curto pra quem está com os olhos no produto: agudo = deu certo, grave = precisa de atenção. */
let audio: AudioContext | null = null
function bipe(ok: boolean) {
  try {
    audio ??= new AudioContext()
    const osc = audio.createOscillator()
    const vol = audio.createGain()
    osc.frequency.value = ok ? 1400 : 330
    vol.gain.value = 0.08
    osc.connect(vol).connect(audio.destination)
    osc.start()
    osc.stop(audio.currentTime + (ok ? 0.09 : 0.3))
  } catch {
    /* sem som, segue o jogo */
  }
}

const ROTULO: Record<Status, { texto: string; cor: string }> = {
  fila: { texto: 'na fila', cor: 'bg-[#F4F1EC] text-[#7A716A]' },
  buscando: { texto: 'buscando…', cor: 'bg-blue-50 text-blue-700' },
  ok: { texto: 'cadastrado', cor: 'bg-emerald-50 text-emerald-700' },
  catalogo: { texto: 'já tinha', cor: 'bg-emerald-50 text-emerald-700' },
  semfoto: { texto: 'sem foto', cor: 'bg-amber-50 text-amber-800' },
  naoachou: { texto: 'não achado', cor: 'bg-red-50 text-red-700' },
  erro: { texto: 'erro', cor: 'bg-red-50 text-red-700' },
}

/**
 * Cadastro em massa pelo leitor de código de barras: vai bipando e cada código vira produto
 * com nome e foto (das bases de produtos). O que não tiver foto fica marcado pra completar.
 */
export function BiparEmMassa({ onFechar }: { onFechar: () => void }) {
  const [codigo, setCodigo] = React.useState('')
  const [lista, setLista] = React.useState<Bipado[]>([])
  const [cadastrando, setCadastrando] = React.useState<string | null>(null)
  const input = React.useRef<HTMLInputElement>(null)
  const rodando = React.useRef(false)

  const mudar = (ean: string, m: Partial<Bipado>) => setLista((l) => l.map((b) => (b.ean === ean ? { ...b, ...m } : b)))

  // Processa a fila um código por vez (o leitor é mais rápido que a busca).
  React.useEffect(() => {
    if (rodando.current) return
    const proximo = [...lista].reverse().find((b) => b.status === 'fila')
    if (!proximo) return
    rodando.current = true
    mudar(proximo.ean, { status: 'buscando' })
    tabloideApi
      .porEan(proximo.ean)
      .then((r) => {
        const status: Status = !r.produto?.tem_foto ? 'semfoto' : r.fonte === 'catalogo' ? 'catalogo' : 'ok'
        bipe(status !== 'semfoto')
        mudar(proximo.ean, { status, produto: r.produto, msg: status === 'semfoto' ? r.aviso ?? '' : r.produto?.nome ?? '' })
      })
      .catch((e: Error) => {
        bipe(false)
        const naoAchou = /não achei/i.test(e.message)
        const msg = /failed to fetch|networkerror|load failed/i.test(e.message) ? 'sem conexão com o servidor' : e.message
        mudar(proximo.ean, { status: naoAchou ? 'naoachou' : 'erro', msg })
      })
      .finally(() => {
        rodando.current = false
        setLista((l) => [...l]) // acorda o efeito pro próximo da fila
      })
  }, [lista])

  const bipar = () => {
    const ean = codigo.replace(/\D/g, '')
    setCodigo('')
    if (!ean) return
    if (!/^\d{8}$|^\d{12,14}$/.test(ean)) {
      bipe(false)
      return toast.error(`"${codigo.trim()}" não parece um código de barras.`)
    }
    if (lista.some((b) => b.ean === ean)) {
      bipe(false)
      return toast.info('Esse código já foi bipado agora.')
    }
    setLista((l) => [{ ean, status: 'fila', produto: null, msg: '' }, ...l])
  }

  const porFoto = async (b: Bipado, arquivo: File | undefined) => {
    if (!arquivo || !b.produto) return
    mudar(b.ean, { status: 'buscando' })
    try {
      const r = await tabloideApi.fotoDoProduto(b.produto.id, await lerImagem(arquivo), 'auto')
      if (r.aviso) toast.warning(r.aviso, { duration: 8000 })
      mudar(b.ean, { status: 'ok', produto: r.produto, msg: r.produto.nome })
    } catch (e) {
      toast.error((e as Error).message)
      mudar(b.ean, { status: 'semfoto' })
    }
  }

  const tentarDeNovo = (ean: string) => mudar(ean, { status: 'fila', msg: '' })

  const conta = (...s: Status[]) => lista.filter((b) => s.includes(b.status)).length
  const pendentes = conta('fila', 'buscando')
  const pendencias = conta('semfoto', 'naoachou')
  const erros = conta('erro')

  if (cadastrando) {
    return (
      <Modal titulo={`Cadastrar ${cadastrando}`} onFechar={() => setCadastrando(null)}>
        <NovoProduto
          inicial={{ ean: cadastrando }}
          onCriado={(p) => {
            mudar(cadastrando, { status: p.tem_foto ? 'ok' : 'semfoto', produto: p, msg: p.nome })
            setCadastrando(null)
          }}
        />
        <button className={`${btnSecundario} mt-3`} onClick={() => setCadastrando(null)}>
          ← Voltar pra bipagem
        </button>
      </Modal>
    )
  }

  return (
    <Modal titulo="Bipar produtos em massa" onFechar={onFechar} largura={820}>
      <div className="flex flex-col gap-3">
        <p className="text-sm text-[#7A716A]">
          Clique no campo e vá passando os produtos no leitor. Cada código vira produto com nome e foto, sozinho. Pode bipar rápido: os códigos entram na fila.
        </p>
        <form
          onSubmit={(e) => {
            e.preventDefault()
            bipar()
          }}
          className="flex gap-2"
        >
          <input
            ref={input}
            value={codigo}
            onChange={(e) => setCodigo(e.target.value)}
            onBlur={() => setTimeout(() => !cadastrando && input.current?.focus(), 150)}
            placeholder="Bipe o código de barras aqui…"
            inputMode="numeric"
            autoFocus
            autoComplete="off"
            className={`${inputCls} text-lg tracking-wider`}
          />
          <button type="submit" className={btnPrimario}>
            Adicionar
          </button>
        </form>

        {lista.length > 0 && (
          <div className="flex flex-wrap gap-2 text-xs font-semibold">
            <span className="rounded-full bg-[#F4F1EC] px-2.5 py-1 text-[#2A2622]">{lista.length} bipados</span>
            <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-emerald-700">{conta('ok', 'catalogo')} com foto</span>
            {pendentes > 0 && <span className="rounded-full bg-blue-50 px-2.5 py-1 text-blue-700">{pendentes} buscando</span>}
            {pendencias > 0 && <span className="rounded-full bg-amber-50 px-2.5 py-1 text-amber-800">{pendencias} precisam de foto</span>}
            {erros > 0 && <span className="rounded-full bg-red-50 px-2.5 py-1 text-red-700">{erros} com erro</span>}
          </div>
        )}

        <div className="flex max-h-[55vh] flex-col gap-1.5 overflow-y-auto">
          {lista.length === 0 && (
            <div className="rounded-lg border-2 border-dashed border-[#E7E1D9] p-8 text-center text-sm text-[#9A928B]">
              <div className="mb-1 text-3xl">📦</div>
              Nenhum código bipado ainda.
            </div>
          )}
          {lista.map((b) => (
            <div key={b.ean} className="flex items-center gap-3 rounded-lg border border-[#E7E1D9] bg-white p-2">
              <MiniFoto produto={b.produto} tamanho={52} />
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-bold text-[#2A2622]">{b.produto?.nome || b.ean}</div>
                <div className="truncate text-[11px] text-[#9A928B]">
                  {b.ean}
                  {b.produto?.detalhe ? ` · ${b.produto.detalhe}` : ''}
                  {(b.status === 'naoachou' || b.status === 'erro' || b.status === 'semfoto') && b.msg ? ` · ${b.msg}` : ''}
                </div>
              </div>
              <span className={`whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-bold ${ROTULO[b.status].cor}`}>{ROTULO[b.status].texto}</span>
              {b.status === 'semfoto' && (
                <label className={`${btnSecundario} cursor-pointer px-2.5 py-1 text-xs`}>
                  📷 Pôr foto
                  <input type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => void porFoto(b, e.target.files?.[0])} />
                </label>
              )}
              {b.status === 'naoachou' && (
                <button className={`${btnSecundario} px-2.5 py-1 text-xs`} onClick={() => setCadastrando(b.ean)}>
                  Cadastrar
                </button>
              )}
              {b.status === 'erro' && (
                <button className={`${btnSecundario} px-2.5 py-1 text-xs`} onClick={() => tentarDeNovo(b.ean)}>
                  Tentar de novo
                </button>
              )}
            </div>
          ))}
        </div>

        <div className="flex justify-end">
          <button className={btnPrimario} onClick={onFechar} disabled={pendentes > 0}>
            {pendentes > 0 ? `Aguarde… (${pendentes})` : 'Concluir'}
          </button>
        </div>
      </div>
    </Modal>
  )
}
