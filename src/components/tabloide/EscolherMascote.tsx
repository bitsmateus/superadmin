import * as React from 'react'
import { toast } from 'sonner'
import { tabloideApi, urlDoMascote, type Mascote } from '@/api/mercadoNunesTabloide'

/**
 * Escolher o mascote do Nunes (ou nenhum), o lado e o tamanho — usado no tabloide e nas plaquinhas.
 * Os mascotes ficam numa biblioteca no sistema: sobe o PNG já sem fundo uma vez e reusa sempre.
 *
 * Feito só com estilo inline: funciona igual nas telas em Tailwind (tabloide) e nas de estilo inline (plaquinhas).
 */

export interface ValorMascote {
  mascoteId?: string
  mascoteLado?: 'esquerda' | 'direita'
  mascoteTamanho?: number
  /** Centro do mascote em % da arte (0–100). -1/vazio = automático (canto de baixo, pelo lado). */
  mascoteX?: number
  mascoteY?: number
}

const XADREZ: React.CSSProperties = {
  backgroundColor: '#fff',
  backgroundImage:
    'linear-gradient(45deg,#eee 25%,transparent 25%),linear-gradient(-45deg,#eee 25%,transparent 25%),linear-gradient(45deg,transparent 75%,#eee 75%),linear-gradient(-45deg,transparent 75%,#eee 75%)',
  backgroundSize: '14px 14px',
  backgroundPosition: '0 0,0 7px,7px -7px,-7px 0',
}

const lerComoDataUrl = (f: File) =>
  new Promise<string>((resolve, reject) => {
    const r = new FileReader()
    r.onerror = () => reject(new Error('Não consegui ler o arquivo.'))
    r.onload = () => resolve(String(r.result))
    r.readAsDataURL(f)
  })

// A lista é a mesma em todas as telas: carrega uma vez e compartilha.
let cache: Mascote[] | null = null
const ouvintes = new Set<(l: Mascote[]) => void>()
const avisar = (l: Mascote[]) => {
  cache = l
  ouvintes.forEach((f) => f(l))
}
async function recarregar() {
  avisar((await tabloideApi.mascotes()).mascotes)
}

export function useMascotes(): Mascote[] | null {
  const [lista, setLista] = React.useState<Mascote[] | null>(cache)
  React.useEffect(() => {
    ouvintes.add(setLista)
    // Se falhar (sem internet), mostra vazio só nesta tela e não guarda: a próxima tela tenta de novo.
    if (!cache) recarregar().catch(() => setLista([]))
    return () => {
      ouvintes.delete(setLista)
    }
  }, [])
  return lista
}

export function EscolherMascote({
  valor,
  onMuda,
  semEscolha,
}: {
  valor: ValorMascote
  onMuda: (v: ValorMascote) => void
  /** Editor em massa: mostra também "Manter" (não mexer no mascote de cada uma). */
  semEscolha?: { ativo: boolean; onManter: () => void }
}) {
  const lista = useMascotes()
  const [enviando, setEnviando] = React.useState(false)
  const lado = valor.mascoteLado ?? 'direita'
  const tamanho = valor.mascoteTamanho ?? 0
  const manter = !!semEscolha?.ativo
  const livre = (valor.mascoteX ?? -1) >= 0 && (valor.mascoteY ?? -1) >= 0
  // Ponto de partida dos controles quando ainda está no automático: o canto de baixo do lado escolhido.
  const x = livre ? (valor.mascoteX as number) : lado === 'esquerda' ? 14 : 86
  const y = livre ? (valor.mascoteY as number) : 80
  const posicionar = (nx: number, ny: number) => onMuda({ ...valor, mascoteX: Math.round(nx), mascoteY: Math.round(ny) })
  const PRESETS: { rotulo: string; x: number; y: number }[] = [
    { rotulo: '↖ Cima esq.', x: 14, y: 16 },
    { rotulo: '↗ Cima dir.', x: 86, y: 16 },
    { rotulo: '● Meio', x: 50, y: 50 },
    { rotulo: '↙ Baixo esq.', x: 14, y: 80 },
    { rotulo: '↘ Baixo dir.', x: 86, y: 80 },
  ]

  const enviar = async (arquivos: FileList | null) => {
    if (!arquivos?.length) return
    setEnviando(true)
    try {
      let ultimo: Mascote | null = null
      for (const f of Array.from(arquivos)) {
        if (!/^image\/(png|webp|jpeg)$/.test(f.type)) {
          toast.error(`${f.name}: envie PNG (sem fundo).`)
          continue
        }
        if (f.type === 'image/jpeg') toast.warning(`${f.name}: JPG não tem transparência — o fundo vai aparecer. Prefira PNG sem fundo.`)
        ultimo = await tabloideApi.enviarMascote(await lerComoDataUrl(f), f.name.replace(/\.[a-z0-9]+$/i, ''))
      }
      await recarregar()
      if (ultimo) {
        onMuda({ ...valor, mascoteId: ultimo.id })
        toast.success('Mascote salvo. Ele fica guardado pra usar de novo.')
      }
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setEnviando(false)
    }
  }

  const remover = async (m: Mascote) => {
    if (!window.confirm(`Apagar o mascote "${m.nome || 'sem nome'}" da biblioteca? Tabloides e plaquinhas que usam ele ficam sem mascote.`)) return
    try {
      await tabloideApi.removerMascote(m.id)
      if (valor.mascoteId === m.id) onMuda({ ...valor, mascoteId: '' })
      await recarregar()
    } catch (e) {
      toast.error((e as Error).message)
    }
  }

  const quadro = (ativo: boolean): React.CSSProperties => ({
    position: 'relative',
    width: 72,
    height: 72,
    borderRadius: 12,
    border: ativo ? '2px solid #C1503F' : '1px solid #E7E1D9',
    boxShadow: ativo ? '0 6px 16px -10px rgba(193,80,63,.7)' : 'none',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    padding: 4,
    flexShrink: 0,
  })

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        {semEscolha && (
          <button type="button" onClick={semEscolha.onManter} style={{ ...quadro(manter), background: '#fff', fontSize: 11, fontWeight: 700, color: '#7A716A', fontFamily: 'inherit' }}>
            Manter
          </button>
        )}
        <button
          type="button"
          onClick={() => onMuda({ ...valor, mascoteId: '' })}
          style={{ ...quadro(!manter && !valor.mascoteId), background: '#fff', fontSize: 11, fontWeight: 700, color: '#7A716A', fontFamily: 'inherit' }}
        >
          Sem mascote
        </button>
        {(lista ?? []).map((m) => (
          <div key={m.id} style={{ position: 'relative' }}>
            <button
              type="button"
              title={m.nome}
              onClick={() => onMuda({ ...valor, mascoteId: m.id })}
              style={{ ...quadro(!manter && valor.mascoteId === m.id), ...XADREZ }}
            >
              <img src={urlDoMascote(m.id)} alt={m.nome} style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }} />
            </button>
            <button
              type="button"
              title="Apagar da biblioteca"
              onClick={() => void remover(m)}
              style={{ position: 'absolute', top: -6, right: -6, width: 20, height: 20, borderRadius: 999, border: '1px solid #E7E1D9', background: '#fff', color: '#B42318', fontSize: 11, lineHeight: '18px', cursor: 'pointer', padding: 0 }}
            >
              ✕
            </button>
          </div>
        ))}
        <label
          title="Subir mascote (PNG sem fundo)"
          style={{ ...quadro(false), borderStyle: 'dashed', background: '#fff', flexDirection: 'column', fontSize: 11, fontWeight: 700, color: '#C1503F', textAlign: 'center', cursor: enviando ? 'wait' : 'pointer' }}
        >
          <span style={{ fontSize: 20, lineHeight: 1 }}>{enviando ? '…' : '+'}</span>
          {enviando ? 'Enviando' : 'Subir PNG'}
          <input type="file" accept="image/png,image/webp,image/jpeg" multiple hidden disabled={enviando} onChange={(e) => { void enviar(e.target.files); e.target.value = '' }} />
        </label>
      </div>
      {lista && !lista.length && (
        <p style={{ fontSize: 11, color: '#9A928B', margin: 0 }}>Nenhum mascote ainda. Suba os PNGs já sem fundo — dá pra mandar vários de uma vez.</p>
      )}
      {!manter && !!valor.mascoteId && (
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 12 }}>
          <span style={{ display: 'inline-flex', borderRadius: 999, padding: 2, background: 'rgba(42,38,34,.06)' }}>
            {(['esquerda', 'direita'] as const).map((l) => (
              <button
                key={l}
                type="button"
                onClick={() => onMuda({ ...valor, mascoteLado: l, mascoteX: -1, mascoteY: -1 })}
                style={{
                  border: 'none',
                  borderRadius: 999,
                  padding: '5px 12px',
                  fontSize: 12,
                  fontWeight: 700,
                  cursor: 'pointer',
                  fontFamily: 'inherit',
                  background: !livre && lado === l ? '#fff' : 'transparent',
                  color: !livre && lado === l ? '#C1503F' : '#7A716A',
                  boxShadow: !livre && lado === l ? '0 1px 3px rgba(0,0,0,.12)' : 'none',
                }}
              >
                {l === 'esquerda' ? '◀ Esquerda' : 'Direita ▶'}
              </button>
            ))}
          </span>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, fontWeight: 600, color: '#5B534D', flex: 1, minWidth: 180 }}>
            Tamanho
            <input type="range" min={-6} max={8} step={1} value={tamanho} onChange={(e) => onMuda({ ...valor, mascoteTamanho: Number(e.target.value) })} style={{ flex: 1, accentColor: '#C1503F' }} />
            <span style={{ width: 26, textAlign: 'right' }}>{tamanho > 0 ? `+${tamanho}` : tamanho}</span>
          </label>
          <div style={{ flexBasis: '100%', display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {PRESETS.map((p) => {
                const ativo = livre && x === p.x && y === p.y
                return (
                  <button
                    key={p.rotulo}
                    type="button"
                    onClick={() => posicionar(p.x, p.y)}
                    style={{ border: ativo ? '1px solid #C1503F' : '1px solid #E7E1D9', background: ativo ? '#FDF1EE' : '#fff', color: ativo ? '#C1503F' : '#5B534D', borderRadius: 999, padding: '4px 10px', fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}
                  >
                    {p.rotulo}
                  </button>
                )
              })}
              {livre && (
                <button type="button" onClick={() => onMuda({ ...valor, mascoteX: -1, mascoteY: -1 })} style={{ border: 'none', background: 'transparent', color: '#9A928B', fontSize: 12, fontWeight: 700, cursor: 'pointer', textDecoration: 'underline', fontFamily: 'inherit' }}>
                  Voltar ao automático
                </button>
              )}
            </div>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, fontWeight: 600, color: '#5B534D' }}>
              <span style={{ width: 78 }}>Horizontal</span>
              <input type="range" min={0} max={100} step={1} value={x} onChange={(e) => posicionar(Number(e.target.value), y)} style={{ flex: 1, accentColor: '#C1503F' }} />
              <span style={{ width: 34, textAlign: 'right' }}>{Math.round(x)}%</span>
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, fontWeight: 600, color: '#5B534D' }}>
              <span style={{ width: 78 }}>Vertical</span>
              <input type="range" min={0} max={100} step={1} value={y} onChange={(e) => posicionar(x, Number(e.target.value))} style={{ flex: 1, accentColor: '#C1503F' }} />
              <span style={{ width: 34, textAlign: 'right' }}>{Math.round(y)}%</span>
            </label>
          </div>
        </div>
      )}
    </div>
  )
}
