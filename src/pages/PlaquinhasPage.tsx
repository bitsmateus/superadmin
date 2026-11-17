import * as React from 'react'
import { toast } from 'sonner'
import { api } from '@/services/api'
import {
  A4_H,
  A4_W,
  CARTAZ_PADRAO,
  CartazA4,
  FONTES,
  MODELOS,
  TEMAS,
  botaoMini,
  botaoPrimario,
  botaoSecundario,
  estiloFontesLocais,
  inputEstilo,
  type Cartaz,
} from '@/pages/MercadoNunesPage'

/**
 * Plaquinhas em massa do Mercado Nunes — /mercadonunes/plaquinhas (página pública, igual ao gerador de cartazes).
 *
 * Sobe o PDF de promoções do ERP → uma plaquinha por produto → ajusta tudo de uma vez (modelo, tema, fonte) →
 * manda pra fila → imprime 1, 2 ou 4 por folha A4. Tudo fica salvo no servidor: imprimir só marca a data.
 */

const BASE = '/api/public/mercadonunes/plaquinhas'

interface Placa {
  id: string
  produto_id: string | null
  grupo: string
  nome_original: string
  inicio: string
  fim: string
  dados: Partial<Cartaz>
  na_fila: boolean
  impressa_em: string | null
  impressoes: number
  origem: string
}

interface ResultadoImportacao {
  lidos: number
  criadas: number
  atualizadas: number
  inativos: number
  vencidos: number
  repetidos: number
  // Servidores antigos não mandam — por isso opcionais.
  idsCriadas?: string[]
  idsAtualizadas?: string[]
}

type PorFolha = 1 | 2 | 4
type Estado = 'todas' | 'fila' | 'fora' | 'novas' | 'impressas'

// Preço já sai um pouco maior nas plaquinhas em massa (cada passo = +10%). Vale pra toda plaquinha que ainda
// não teve o tamanho do preço mexido; quem já ajustou na mão continua com o valor dela.
const AJUSTE_PRECO_PADRAO = 3

// Plaquinha importada nunca herda o texto de exemplo do cartaz padrão (subtítulo "TRADICIONAL").
const cartazDe = (p: Placa): Cartaz => ({ ...CARTAZ_PADRAO, subtitulo: '', ajustePreco: AJUSTE_PRECO_PADRAO, ...p.dados, id: p.id })

// Tamanhos que dá pra ajustar (mesmos do gerador avulso).
type ChaveTamanho = 'ajusteNome' | 'ajusteSubtitulo' | 'ajusteFaixa' | 'ajustePeso' | 'ajustePreco'
const TAMANHOS: { chave: ChaveTamanho; rotulo: string; max: number }[] = [
  { chave: 'ajusteNome', rotulo: 'Título', max: 6 },
  { chave: 'ajusteSubtitulo', rotulo: 'Subtítulo', max: 6 },
  { chave: 'ajusteFaixa', rotulo: 'Faixa (topo)', max: 6 },
  { chave: 'ajustePeso', rotulo: 'Peso / tamanho', max: 6 },
  { chave: 'ajustePreco', rotulo: 'Preço', max: 15 },
]

// Liga/desliga que dá pra mudar em massa.
type ChaveOpcao = 'mostrarBolinhaPreco' | 'mostrarLogo' | 'logoEsquerda' | 'mostrarFaixa' | 'mostrarDePor' | 'mostrarPrecoAvulsoCaixa'
const OPCOES: { chave: ChaveOpcao; rotulo: string }[] = [
  { chave: 'mostrarBolinhaPreco', rotulo: 'Círculo amarelo atrás do preço' },
  { chave: 'mostrarFaixa', rotulo: 'Faixa no topo' },
  { chave: 'mostrarDePor', rotulo: '“De / por” (preço riscado)' },
  { chave: 'mostrarLogo', rotulo: 'Logo no cartaz' },
  { chave: 'logoEsquerda', rotulo: 'Logo à esquerda' },
  { chave: 'mostrarPrecoAvulsoCaixa', rotulo: 'Bloco avulso / caixa' },
]
const dataCurta = (iso: string) => new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })
const pedacos = <T,>(lista: T[], n: number): T[][] => {
  const out: T[][] = []
  for (let i = 0; i < lista.length; i += n) out.push(lista.slice(i, i + n))
  return out
}
const lerComoDataUrl = (f: File) =>
  new Promise<string>((resolve, reject) => {
    const r = new FileReader()
    r.onerror = () => reject(new Error('Não consegui ler o arquivo.'))
    r.onload = () => resolve(String(r.result))
    r.readAsDataURL(f)
  })

// ── Miniatura (só desenha quando aparece na tela: são dezenas de cartazes) ──

function Miniatura({ cartaz, largura }: { cartaz: Cartaz; largura: number }) {
  const ref = React.useRef<HTMLDivElement>(null)
  const [visivel, setVisivel] = React.useState(false)
  React.useEffect(() => {
    const el = ref.current
    if (!el || visivel) return
    const io = new IntersectionObserver(
      (e) => {
        if (e[0].isIntersecting) {
          setVisivel(true)
          io.disconnect()
        }
      },
      { rootMargin: '300px' },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [visivel])
  const escala = largura / A4_W
  return (
    <div ref={ref} style={{ width: largura, height: A4_H * escala, background: '#eee', overflow: 'hidden', borderRadius: 4, boxShadow: '0 1px 4px rgba(0,0,0,.25)' }}>
      {visivel && (
        <div style={{ width: A4_W, height: A4_H, transform: `scale(${escala})`, transformOrigin: 'top left', pointerEvents: 'none' }}>
          <CartazA4 dados={cartaz} />
        </div>
      )}
    </div>
  )
}

// ── Folhas de impressão (1, 2 ou 4 plaquinhas por A4) ───────────────────────

function Folhas({ cartazes, porFolha, corte }: { cartazes: Cartaz[]; porFolha: PorFolha; corte: boolean }) {
  // 1 = A4 em pé; 4 = A4 em pé com 4 A6; 2 = A4 deitado com 2 A5 em pé. Mesma proporção do cartaz, só encolhe.
  const escala = porFolha === 1 ? 1 : porFolha === 2 ? Math.SQRT1_2 : 0.5
  const celW = A4_W * escala
  const celH = A4_H * escala
  const folhaW = porFolha === 2 ? A4_H : A4_W
  const folhaH = porFolha === 2 ? A4_W : A4_H
  const colunas = porFolha === 1 ? 1 : 2
  return (
    <>
      {pedacos(cartazes, porFolha).map((grupo, i) => (
        <div
          key={i}
          className="folha"
          style={{ width: folhaW, height: folhaH - 1, overflow: 'hidden', display: 'grid', gridTemplateColumns: `repeat(${colunas}, ${celW}px)`, gridAutoRows: celH, background: '#fff' }}
        >
          {grupo.map((c) => (
            <div key={c.id} style={{ width: celW, height: celH, position: 'relative', overflow: 'hidden' }}>
              <div style={{ width: A4_W, height: A4_H, transform: `scale(${escala})`, transformOrigin: 'top left' }}>
                <CartazA4 dados={c} />
              </div>
              {corte && porFolha > 1 && <div style={{ position: 'absolute', inset: 0, border: '1px dashed #aaa', pointerEvents: 'none' }} />}
            </div>
          ))}
        </div>
      ))}
    </>
  )
}

// ── Página ──────────────────────────────────────────────────────────────────

export function PlaquinhasPage() {
  const [lista, setLista] = React.useState<Placa[] | null>(null)
  const [selecionadas, setSelecionadas] = React.useState<Set<string>>(new Set())
  const [busca, setBusca] = React.useState('')
  const [grupo, setGrupo] = React.useState('')
  const [estado, setEstado] = React.useState<Estado>('todas')
  const [importando, setImportando] = React.useState(false)
  const [resultado, setResultado] = React.useState<ResultadoImportacao | null>(null)
  const [modeloInicial, setModeloInicial] = React.useState(0)
  const [vendoId, setVendoId] = React.useState<string | null>(null)
  const [ocupado, setOcupado] = React.useState(false)
  // Edição em massa
  const [temaMassa, setTemaMassa] = React.useState('')
  const [fonteMassa, setFonteMassa] = React.useState('')
  const [faixaMassa, setFaixaMassa] = React.useState('')
  // Sempre tem um modelo escolhido (começa no primeiro, "Oferta de/por"); null = manter o de cada uma.
  const [modeloMassa, setModeloMassa] = React.useState<number | null>(0)
  // Qual plaquinha aparece na prévia do editor em massa (posição dentro das selecionadas / da lista).
  const [amostra, setAmostra] = React.useState(0)
  // null = "não mexer" (só vai no patch o que a pessoa tocou)
  const [tamanhosMassa, setTamanhosMassa] = React.useState<Partial<Record<ChaveTamanho, number>>>({})
  const [opcoesMassa, setOpcoesMassa] = React.useState<Partial<Record<ChaveOpcao, boolean>>>({})
  // Impressão
  const [porFolha, setPorFolha] = React.useState<PorFolha>(4)
  const [corte, setCorte] = React.useState(true)
  const [paraImprimir, setParaImprimir] = React.useState<Placa[]>([])
  const [aposImprimir, setAposImprimir] = React.useState<string[] | null>(null)

  // Mesmas fontes do gerador de cartazes (Google + as locais da TypeType).
  React.useEffect(() => {
    const link = document.createElement('link')
    link.rel = 'stylesheet'
    link.href = 'https://fonts.googleapis.com/css2?family=Titan+One&family=Baloo+2:wght@800&family=Luckiest+Guy&family=Bowlby+One+SC&family=Anton&family=Archivo+Black&display=swap'
    document.head.appendChild(link)
    return () => {
      document.head.removeChild(link)
    }
  }, [])

  const carregar = React.useCallback(async () => {
    try {
      setLista((await api.get<{ plaquinhas: Placa[] }>(BASE)).plaquinhas)
    } catch (e) {
      toast.error((e as Error).message)
      setLista((l) => l ?? [])
    }
  }, [])
  React.useEffect(() => {
    void carregar()
  }, [carregar])

  const grupos = React.useMemo(() => [...new Set((lista ?? []).map((p) => p.grupo).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'pt-BR')), [lista])
  const visiveis = React.useMemo(() => {
    const q = busca.trim().toLowerCase()
    return (lista ?? []).filter((p) => {
      if (grupo && p.grupo !== grupo) return false
      if (estado === 'fila' && !p.na_fila) return false
      if (estado === 'fora' && p.na_fila) return false
      if (estado === 'novas' && p.impressa_em) return false
      if (estado === 'impressas' && !p.impressa_em) return false
      if (!q) return true
      return `${p.dados.produto ?? ''} ${p.nome_original} ${p.grupo}`.toLowerCase().includes(q)
    })
  }, [lista, busca, grupo, estado])
  const naFila = React.useMemo(() => (lista ?? []).filter((p) => p.na_fila), [lista])
  const escolhidas = React.useMemo(() => (lista ?? []).filter((p) => selecionadas.has(p.id)), [lista, selecionadas])
  const todasMarcadas = visiveis.length > 0 && visiveis.every((p) => selecionadas.has(p.id))
  const vendo = vendoId ? visiveis.find((p) => p.id === vendoId) ?? (lista ?? []).find((p) => p.id === vendoId) ?? null : null

  const alternar = (id: string) =>
    setSelecionadas((s) => {
      const n = new Set(s)
      if (n.has(id)) n.delete(id)
      else n.add(id)
      return n
    })

  // ── Importar ──
  const importar = async (f: File | undefined) => {
    if (!f) return
    if (!/\.pdf$/i.test(f.name) && f.type !== 'application/pdf') return toast.error('Escolha um arquivo PDF.')
    setImportando(true)
    setResultado(null)
    try {
      const pdf = await lerComoDataUrl(f)
      const r = await api.post<ResultadoImportacao>(`${BASE}/importar`, { nome: f.name, pdf, padrao: { ajustePreco: AJUSTE_PRECO_PADRAO, ...MODELOS[modeloInicial].patch } })
      setResultado(r)
      await carregar()
      toast.success(`${r.criadas} plaquinha(s) nova(s)${r.atualizadas ? ` e ${r.atualizadas} atualizada(s)` : ''}.`)
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setImportando(false)
    }
  }

  // ── Ações em lote ──
  const lote = async (ids: string[], acao: string, patch?: Partial<Cartaz>, msg?: string) => {
    if (!ids.length) return toast.error('Escolha pelo menos uma plaquinha.')
    setOcupado(true)
    try {
      await api.post(`${BASE}/lote`, { ids, acao, patch })
      await carregar()
      if (msg) toast.success(msg)
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setOcupado(false)
    }
  }
  const idsAlvo = () => (escolhidas.length ? escolhidas : []).map((p) => p.id)

  // ── Impressão ──
  const imprimir = (placas: Placa[]) => {
    if (!placas.length) return toast.error('Não tem plaquinha pra imprimir.')
    setParaImprimir(placas)
  }
  React.useEffect(() => {
    if (!paraImprimir.length) return
    const ids = paraImprimir.map((p) => p.id)
    const terminou = () => {
      setParaImprimir([])
      setAposImprimir(ids)
    }
    window.addEventListener('afterprint', terminou, { once: true })
    const t = setTimeout(() => window.print(), 900) // dá tempo das fontes, da logo e do ajuste do preço
    return () => {
      clearTimeout(t)
      window.removeEventListener('afterprint', terminou)
    }
  }, [paraImprimir])

  // ── Salvar edição individual ──
  const salvarUma = async (id: string, dados: Partial<Cartaz>) => {
    try {
      await api.patch(`${BASE}/${id}`, { dados })
      await carregar()
      toast.success('Plaquinha salva.')
    } catch (e) {
      toast.error((e as Error).message)
    }
  }
  const excluir = async (ids: string[]) => {
    if (!ids.length) return
    if (!window.confirm(`Excluir ${ids.length} plaquinha(s)? Isso apaga de vez.`)) return
    await lote(ids, 'excluir', undefined, 'Excluídas.')
    setSelecionadas(new Set())
    setVendoId(null)
  }

  const idx = vendo ? visiveis.findIndex((p) => p.id === vendo.id) : -1
  // Barra de baixo: a seleção manda; sem seleção, "fila" usa a lista e "imprimir" usa a fila.
  const alvoFila = escolhidas.length ? escolhidas : visiveis
  const alvoImpressao = escolhidas.length ? escolhidas : naFila
  const folhas = Math.ceil(alvoImpressao.length / porFolha)

  return (
    <div className="mn-plaq nunes-app" style={{ paddingBottom: 90 }}>
      <style>{estiloFontesLocais}</style>
      <style>{estilo}</style>
      <style>{`@media print { @page { size: A4 ${porFolha === 2 ? 'landscape' : 'portrait'}; margin: 0; } }`}</style>

      <header className="tela nunes-header" style={{ padding: '14px 20px', display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <img src="/assets/mercadonunes-logo.jpg" alt="Nunes" style={{ height: 44, objectFit: 'contain' }} />
        <div style={{ flex: 1, minWidth: 220 }}>
          <h1 style={{ fontSize: 20, margin: 0, color: '#C1503F' }}>Plaquinhas em massa</h1>
          <p style={{ fontSize: 13, color: '#7A716A', margin: 0 }}>Suba o relatório de promoções (PDF) e imprima todas de uma vez.</p>
        </div>
        <a href="/mercadonunes" style={{ ...botaoSecundario, textDecoration: 'none', whiteSpace: 'nowrap' }}>← Plaquinha avulsa</a>
      </header>

      <main className="tela" style={{ maxWidth: 1280, margin: '0 auto', padding: 20, display: 'flex', flexDirection: 'column', gap: 16 }}>
        {/* 1. Importar */}
        <section style={cartao}>
          <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', alignItems: 'center' }}>
            <label
              style={{ ...botaoPrimario, cursor: importando ? 'wait' : 'pointer', display: 'inline-flex', alignItems: 'center', gap: 8, opacity: importando ? 0.7 : 1 }}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault()
                void importar(e.dataTransfer.files?.[0])
              }}
            >
              📄 {importando ? 'Lendo o relatório…' : 'Subir relatório de promoções (PDF)'}
              <input type="file" accept="application/pdf,.pdf" hidden disabled={importando} onChange={(e) => { void importar(e.target.files?.[0]); e.target.value = '' }} />
            </label>
            <label style={{ fontSize: 13, color: '#5B534D', display: 'flex', alignItems: 'center', gap: 8 }}>
              Modelo das novas:
              <select value={modeloInicial} onChange={(e) => setModeloInicial(Number(e.target.value))} style={{ ...inputEstilo, width: 'auto', padding: '8px 10px', fontSize: 14 }}>
                {MODELOS.map((m, i) => (
                  <option key={m.nome} value={i}>{m.nome}</option>
                ))}
              </select>
            </label>
            <span style={{ fontSize: 12, color: '#9A928B' }}>Aceita "Itens em Promoção" e "Promoção de Produto". Mesmo produto em outro relatório = continua uma plaquinha só (o preço novo entra por cima).</span>
          </div>
          {resultado && (
            <div style={{ marginTop: 12, background: '#EEF7EE', border: '1px solid #BFE0BF', borderRadius: 8, padding: '10px 12px', fontSize: 13, color: '#245B24' }}>
              ✅ {resultado.lidos} produto(s) lido(s): <b>{resultado.criadas} novas</b>
              {resultado.atualizadas > 0 && <>, <b>{resultado.atualizadas} atualizadas</b> (já existiam)</>}.
              {resultado.inativos > 0 && <> {resultado.inativos} inativo(s) ignorado(s).</>}
              {resultado.vencidos > 0 && <> {resultado.vencidos} promoção(ões) vencida(s) ignorada(s).</>}
              {resultado.repetidos > 0 && <> {resultado.repetidos} repetido(s) no arquivo.</>}
              {(() => {
                // Só as que ainda existem (alguma pode já ter sido excluída depois).
                const existe = new Set((lista ?? []).map((p) => p.id))
                const novas = (resultado.idsCriadas ?? []).filter((id) => existe.has(id))
                const todas = [...novas, ...(resultado.idsAtualizadas ?? []).filter((id) => existe.has(id))]
                if (!todas.length) return null
                return (
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 10 }}>
                    <button style={botaoMini} onClick={() => setSelecionadas(new Set(todas))}>
                      ☑ Selecionar {todas.length > 1 ? `as ${todas.length}` : 'a 1'} desta importação
                    </button>
                    {novas.length > 0 && (
                      <button style={botaoExcluir} disabled={ocupado} onClick={() => void excluir(novas)}>
                        🗑 Excluir {novas.length > 1 ? `as ${novas.length} novas` : 'a 1 nova'} desta importação
                      </button>
                    )}
                  </div>
                )
              })()}
            </div>
          )}
        </section>

        {/* 2. Filtros */}
        <section style={{ ...cartao, display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
          <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar produto…" style={{ ...inputEstilo, width: 220 }} />
          <select value={grupo} onChange={(e) => setGrupo(e.target.value)} style={{ ...inputEstilo, width: 'auto' }}>
            <option value="">Todos os grupos</option>
            {grupos.map((g) => (
              <option key={g} value={g}>{g}</option>
            ))}
          </select>
          <select value={estado} onChange={(e) => setEstado(e.target.value as Estado)} style={{ ...inputEstilo, width: 'auto' }}>
            <option value="todas">Todas</option>
            <option value="fila">Na fila de impressão</option>
            <option value="fora">Fora da fila</option>
            <option value="novas">Ainda não impressas</option>
            <option value="impressas">Já impressas</option>
          </select>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 14, fontWeight: 600 }}>
            <input type="checkbox" checked={todasMarcadas} onChange={(e) => setSelecionadas(e.target.checked ? new Set(visiveis.map((p) => p.id)) : new Set())} />
            Selecionar todas ({visiveis.length})
          </label>
          <span style={{ fontSize: 13, color: '#7A716A' }}>
            {escolhidas.length ? `${escolhidas.length} selecionada(s) · ` : ''}{lista?.length ?? 0} no total
          </span>
          {escolhidas.length > 0 && (
            <>
              <button style={botaoMini} onClick={() => setSelecionadas(new Set())}>Limpar seleção</button>
              <button style={{ ...botaoExcluir, marginLeft: 'auto' }} disabled={ocupado} onClick={() => void excluir(idsAlvo())}>
                🗑 Excluir {escolhidas.length} selecionada{escolhidas.length > 1 ? 's' : ''}
              </button>
            </>
          )}
        </section>

        {/* 3. Editor em massa — prévia ao vivo à esquerda, opções à direita, um botão pra aplicar em todas */}
        {(() => {
          const alvo = escolhidas.length ? escolhidas : visiveis
          const patch: Partial<Cartaz> = {
            ...(modeloMassa !== null ? MODELOS[modeloMassa].patch : {}),
            ...(temaMassa ? { temaId: temaMassa } : {}),
            ...(fonteMassa ? { fonte: fonteMassa } : {}),
            ...(faixaMassa ? { textoFaixa: faixaMassa, mostrarFaixa: true } : {}),
            ...tamanhosMassa,
            ...opcoesMassa,
          }
          const mudancas = Object.keys(patch).length
          const posAmostra = Math.min(amostra, Math.max(0, alvo.length - 1))
          const placaAmostra = alvo[posAmostra] ?? null
          const base: Cartaz = placaAmostra ? cartazDe(placaAmostra) : { ...CARTAZ_PADRAO, subtitulo: '', ajustePreco: AJUSTE_PRECO_PADRAO }
          // Mesma regra do servidor: "de / por" só liga onde existe preço antigo.
          const previa: Cartaz = {
            ...base,
            ...patch,
            ...(patch.mostrarDePor !== undefined ? { mostrarDePor: patch.mostrarDePor && Boolean(base.precoDe.trim()) } : {}),
          }
          const desfazer = () => {
            setModeloMassa(0)
            setTemaMassa('')
            setFonteMassa('')
            setFaixaMassa('')
            setTamanhosMassa({})
            setOpcoesMassa({})
          }
          return (
            <section style={cartao}>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap', marginBottom: 12 }}>
                <h2 style={{ fontSize: 18, fontWeight: 800, margin: 0 }}>✏️ Editar em massa</h2>
                <span style={{ fontSize: 13, color: '#7A716A' }}>
                  {escolhidas.length
                    ? `vai mudar as ${escolhidas.length} selecionadas`
                    : `nenhuma selecionada — vai mudar as ${visiveis.length} da lista`}
                </span>
              </div>

              <div className="plaq-editor">
                {/* Prévia ao vivo */}
                <div className="plaq-editor-previa">
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6, marginBottom: 8 }}>
                    <button style={botaoMini} disabled={posAmostra <= 0} onClick={() => setAmostra(posAmostra - 1)} title="Ver outra plaquinha">◀</button>
                    <span style={{ fontSize: 12, color: '#7A716A', textAlign: 'center' }}>Prévia {alvo.length ? `${posAmostra + 1} de ${alvo.length}` : ''}</span>
                    <button style={botaoMini} disabled={posAmostra >= alvo.length - 1} onClick={() => setAmostra(posAmostra + 1)} title="Ver outra plaquinha">▶</button>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'center' }}>
                    <Miniatura cartaz={previa} largura={260} />
                  </div>
                  <div style={{ fontSize: 12, fontWeight: 700, textAlign: 'center', marginTop: 8, lineHeight: 1.25 }}>
                    {placaAmostra ? placaAmostra.dados.produto || placaAmostra.nome_original : 'Exemplo'}
                  </div>
                  <p style={{ fontSize: 11, color: '#9A928B', textAlign: 'center', margin: '4px 0 0' }}>
                    Muda na hora conforme você edita. Só grava quando clicar em aplicar.
                  </p>
                </div>

                {/* Opções */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12, minWidth: 0 }}>
                  <div style={subcartao}>
                    <div style={subtitulo}>Modelo</div>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 8 }}>
                      {MODELOS.map((m, i) => (
                        <button key={m.nome} type="button" onClick={() => setModeloMassa(i)} className={`plaq-modelo${modeloMassa === i ? ' on' : ''}`}>
                          <b>{m.nome}</b>
                          <span>{m.descricao}</span>
                        </button>
                      ))}
                      <button type="button" onClick={() => setModeloMassa(null)} className={`plaq-modelo${modeloMassa === null ? ' on' : ''}`}>
                        <b>Manter o de cada uma</b>
                        <span>Não troca o modelo, só o que mexer abaixo</span>
                      </button>
                    </div>
                  </div>

                  <div style={subcartao}>
                    <div style={subtitulo}>Cor, fonte e faixa</div>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 8 }}>
                      <select value={temaMassa} onChange={(e) => setTemaMassa(e.target.value)} style={inputEstilo}>
                        <option value="">Cor: manter</option>
                        {TEMAS.map((t) => (
                          <option key={t.id} value={t.id}>{t.nome}</option>
                        ))}
                      </select>
                      <select value={fonteMassa} onChange={(e) => setFonteMassa(e.target.value)} style={inputEstilo}>
                        <option value="">Fonte: manter</option>
                        {FONTES.map((f) => (
                          <option key={f.id} value={f.id}>{f.nome}</option>
                        ))}
                      </select>
                      <input value={faixaMassa} onChange={(e) => setFaixaMassa(e.target.value.toUpperCase())} placeholder="Texto da faixa: manter" style={inputEstilo} />
                    </div>
                  </div>

                  <div className="plaq-massa-grid" style={{ marginTop: 0 }}>
                    <div style={subcartao}>
                      <div style={subtitulo}>Tamanho das escritas</div>
                      <p style={{ fontSize: 11, color: '#9A928B', margin: '0 0 8px' }}>Cinza = mantém o de cada uma. ↺ volta a manter.</p>
                      {TAMANHOS.map((t) => {
                        const v = tamanhosMassa[t.chave]
                        const mexido = v !== undefined
                        const mostrado = v ?? previa[t.chave]
                        const cor = mexido ? '#2A2622' : '#9A928B'
                        return (
                          <div key={t.chave} style={{ display: 'grid', gridTemplateColumns: '100px 1fr 58px', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                            <span style={{ fontSize: 12, fontWeight: 600, color: cor }}>{t.rotulo}</span>
                            <input
                              type="range"
                              min={-6}
                              max={t.max}
                              step={1}
                              value={mostrado}
                              onChange={(e) => setTamanhosMassa((s) => ({ ...s, [t.chave]: Number(e.target.value) }))}
                              style={{ opacity: mexido ? 1 : 0.4 }}
                            />
                            <span style={{ fontSize: 12, display: 'flex', alignItems: 'center', gap: 4, justifyContent: 'flex-end', color: cor }}>
                              <b>{mostrado > 0 ? `+${mostrado}` : mostrado}</b>
                              {mexido && (
                                <button
                                  type="button"
                                  title="Manter o tamanho de cada uma"
                                  onClick={() => setTamanhosMassa((s) => { const n = { ...s }; delete n[t.chave]; return n })}
                                  style={{ ...botaoMini, padding: '0 6px' }}
                                >
                                  ↺
                                </button>
                              )}
                            </span>
                          </div>
                        )
                      })}
                    </div>

                    <div style={subcartao}>
                      <div style={subtitulo}>Mostrar no cartaz</div>
                      <p style={{ fontSize: 11, color: '#9A928B', margin: '0 0 8px' }}>“De / por” só liga nas que têm preço antigo.</p>
                      {OPCOES.map((o) => {
                        const v = opcoesMassa[o.chave]
                        return (
                          <div key={o.chave} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 6, flexWrap: 'wrap' }}>
                            <span style={{ fontSize: 12, fontWeight: 600, color: v === undefined ? '#7A716A' : '#2A2622' }}>{o.rotulo}</span>
                            <span className="plaq-tri">
                              {([
                                [undefined, 'Manter'],
                                [true, 'Ligar'],
                                [false, 'Desligar'],
                              ] as const).map(([valor, rot]) => (
                                <button
                                  key={rot}
                                  type="button"
                                  className={v === valor ? 'on' : ''}
                                  onClick={() =>
                                    setOpcoesMassa((s) => {
                                      const n = { ...s }
                                      if (valor === undefined) delete n[o.chave]
                                      else n[o.chave] = valor
                                      return n
                                    })
                                  }
                                >
                                  {rot}
                                </button>
                              ))}
                            </span>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                </div>
              </div>

              <div className="plaq-editor-acoes">
                <button
                  style={{ ...botaoPrimario, padding: '13px 22px', fontSize: 15, opacity: alvo.length && mudancas ? 1 : 0.5 }}
                  disabled={ocupado || !alvo.length || !mudancas}
                  onClick={() => {
                    if (!escolhidas.length && !window.confirm(`Nenhuma plaquinha selecionada. Aplicar em todas as ${alvo.length} da lista?`)) return
                    void lote(alvo.map((p) => p.id), 'aplicar', patch, `Aplicado em ${alvo.length} plaquinha(s).`)
                  }}
                >
                  ✓ Aplicar em todas as {alvo.length} {escolhidas.length ? 'selecionadas' : 'da lista'}
                </button>
                <button style={botaoMini} onClick={desfazer}>Desfazer escolhas</button>
                <span style={{ flex: 1 }} />
                {escolhidas.length > 0 && (
                  <button style={botaoExcluir} disabled={ocupado} onClick={() => void excluir(idsAlvo())}>
                    🗑 Excluir as {escolhidas.length} selecionadas
                  </button>
                )}
              </div>
            </section>
          )
        })()}

        {/* 4. Grade */}
        {lista === null ? (
          <p style={{ textAlign: 'center', color: '#9A928B' }}>Carregando…</p>
        ) : !visiveis.length ? (
          <p style={{ ...cartao, textAlign: 'center', color: '#7A716A' }}>
            {lista.length ? 'Nenhuma plaquinha com esse filtro.' : 'Nenhuma plaquinha ainda. Suba o PDF de promoções acima e elas aparecem aqui.'}
          </p>
        ) : (
          <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fill, minmax(190px, 1fr))' }}>
            {visiveis.map((p) => (
              <div key={p.id} style={{ ...cartao, padding: 10, display: 'flex', flexDirection: 'column', gap: 6, outline: selecionadas.has(p.id) ? '2px solid #C1503F' : 'none' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6 }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 700 }}>
                    <input type="checkbox" checked={selecionadas.has(p.id)} onChange={() => alternar(p.id)} />
                    Selecionar
                  </label>
                  <span style={{ display: 'flex', gap: 4 }}>
                    {p.na_fila && <span style={selo('#FCEFEC', '#C1503F')}>na fila</span>}
                    {p.impressa_em && <span style={selo('#EEF7EE', '#245B24')}>impressa {dataCurta(p.impressa_em)}</span>}
                  </span>
                </div>
                <button type="button" onClick={() => setVendoId(p.id)} title="Ver e editar" style={{ border: 'none', background: 'none', padding: 0, cursor: 'zoom-in', display: 'flex', justifyContent: 'center' }}>
                  <Miniatura cartaz={cartazDe(p)} largura={160} />
                </button>
                <div style={{ fontSize: 12, fontWeight: 700, lineHeight: 1.25 }}>{p.dados.produto || p.nome_original}</div>
                <div style={{ fontSize: 11, color: '#7A716A' }}>
                  R$ {p.dados.preco}{p.dados.precoDe ? ` (de ${p.dados.precoDe})` : ''}{p.dados.minUnidades ? ` · a partir de ${p.dados.minUnidades} un` : ''}
                </div>
                <div style={{ display: 'flex', gap: 6, marginTop: 'auto' }}>
                  <button style={{ ...botaoMini, flex: 1 }} onClick={() => setVendoId(p.id)}>👁 Ver / editar</button>
                  <button style={{ ...botaoMini, flex: 1 }} disabled={ocupado} onClick={() => void lote([p.id], p.na_fila ? 'tirar_fila' : 'fila')}>
                    {p.na_fila ? '− Fila' : '+ Fila'}
                  </button>
                  <button style={{ ...botaoMini, color: '#B42318' }} disabled={ocupado} title="Excluir esta plaquinha" onClick={() => void excluir([p.id])}>
                    🗑
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </main>

      {/* Barra fixa: fila + impressão */}
      <div className="tela" style={{ position: 'fixed', left: 0, right: 0, bottom: 0, background: '#2A2622', color: '#fff', padding: '10px 16px', display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', zIndex: 20 }}>
        <b style={{ fontSize: 14 }}>🖨 Fila: {naFila.length}</b>
        {/* Um botão só: com seleção, põe as selecionadas; sem seleção, põe todas as da lista. */}
        <button
          style={barraBtn}
          disabled={ocupado || !alvoFila.length}
          onClick={() => void lote(alvoFila.map((p) => p.id), 'fila', undefined, `${alvoFila.length} adicionada(s) à fila.`)}
        >
          + Pôr na fila {escolhidas.length ? `as ${escolhidas.length} selecionadas` : `as ${visiveis.length} da lista`}
        </button>
        <button style={barraBtn} disabled={ocupado || !naFila.length} onClick={() => void lote(naFila.map((p) => p.id), 'tirar_fila', undefined, 'Fila limpa (as plaquinhas continuam salvas).')}>Limpar fila</button>
        <span style={{ flex: 1 }} />
        <label style={{ fontSize: 13, display: 'flex', alignItems: 'center', gap: 6 }}>
          Por folha:
          <select value={porFolha} onChange={(e) => setPorFolha(Number(e.target.value) as PorFolha)} style={{ ...inputEstilo, width: 'auto', padding: '6px 8px', fontSize: 14 }}>
            <option value={1}>1 (A4 inteira)</option>
            <option value={2}>2 por folha</option>
            <option value={4}>4 por folha</option>
          </select>
        </label>
        {porFolha > 1 && (
          <label style={{ fontSize: 13, display: 'flex', alignItems: 'center', gap: 4 }}>
            <input type="checkbox" checked={corte} onChange={(e) => setCorte(e.target.checked)} /> linhas de corte
          </label>
        )}
        {/* Um botão só: com seleção, imprime as selecionadas; sem seleção, imprime a fila. */}
        <button style={{ ...botaoPrimario, padding: '9px 16px' }} disabled={!alvoImpressao.length} onClick={() => imprimir(alvoImpressao)}>
          🖨 Imprimir {escolhidas.length ? `as ${escolhidas.length} selecionadas` : `a fila (${naFila.length})`} → {folhas} folha{folhas !== 1 ? 's' : ''}
        </button>
      </div>

      {/* Visualizador / edição de uma */}
      {vendo && (
        <Visualizador
          key={vendo.id}
          placa={vendo}
          posicao={idx >= 0 ? `${idx + 1} de ${visiveis.length}` : ''}
          onAnterior={idx > 0 ? () => setVendoId(visiveis[idx - 1].id) : undefined}
          onProxima={idx >= 0 && idx < visiveis.length - 1 ? () => setVendoId(visiveis[idx + 1].id) : undefined}
          onFechar={() => setVendoId(null)}
          onSalvar={(d) => salvarUma(vendo.id, d)}
          onFila={() => void lote([vendo.id], vendo.na_fila ? 'tirar_fila' : 'fila')}
          onExcluir={() => void excluir([vendo.id])}
        />
      )}

      {/* Depois de imprimir: perguntar se deu certo (o navegador não diz se imprimiu ou cancelou) */}
      {aposImprimir && (
        <div className="tela" style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.5)', zIndex: 60, display: 'grid', placeItems: 'center', padding: 16 }}>
          <div style={{ ...cartao, maxWidth: 440 }}>
            <h3 style={{ margin: '0 0 6px' }}>Imprimiu tudo certo?</h3>
            <p style={{ fontSize: 14, color: '#5B534D', margin: '0 0 14px' }}>
              Marcando como impressas, as {aposImprimir.length} plaquinhas saem da fila e ficam salvas com a data de hoje — você pode reimprimir quando quiser.
            </p>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
              <button style={botaoSecundario} onClick={() => setAposImprimir(null)}>Não, manter na fila</button>
              <button
                style={botaoPrimario}
                onClick={() => {
                  const ids = aposImprimir
                  setAposImprimir(null)
                  void lote(ids, 'imprimida', undefined, 'Marcadas como impressas.')
                }}
              >
                Sim, marcar como impressas
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Área de impressão — fora da tela, aparece só no papel */}
      <div className="area-impressao">
        {paraImprimir.length > 0 && <Folhas cartazes={paraImprimir.map(cartazDe)} porFolha={porFolha} corte={corte} />}
      </div>
    </div>
  )
}

// ── Visualizador com edição ─────────────────────────────────────────────────

function Visualizador({
  placa,
  posicao,
  onAnterior,
  onProxima,
  onFechar,
  onSalvar,
  onFila,
  onExcluir,
}: {
  placa: Placa
  posicao: string
  onAnterior?: () => void
  onProxima?: () => void
  onFechar: () => void
  onSalvar: (d: Partial<Cartaz>) => Promise<void>
  onFila: () => void
  onExcluir: () => void
}) {
  const [c, setC] = React.useState<Cartaz>(() => cartazDe(placa))
  const [salvando, setSalvando] = React.useState(false)
  React.useEffect(() => setC(cartazDe(placa)), [placa])
  React.useEffect(() => {
    const tecla = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === 'INPUT' || (e.target as HTMLElement)?.tagName === 'SELECT') return
      if (e.key === 'Escape') onFechar()
      if (e.key === 'ArrowLeft') onAnterior?.()
      if (e.key === 'ArrowRight') onProxima?.()
    }
    window.addEventListener('keydown', tecla)
    return () => window.removeEventListener('keydown', tecla)
  }, [onAnterior, onProxima, onFechar])

  const set = <K extends keyof Cartaz>(k: K, v: Cartaz[K]) => setC((x) => ({ ...x, [k]: v }))
  const sujo = JSON.stringify(cartazDe(placa)) !== JSON.stringify(c)
  const salvar = async () => {
    setSalvando(true)
    const { id: _id, ...dados } = c
    void _id
    await onSalvar(dados)
    setSalvando(false)
  }
  const escala = Math.min(0.62, (window.innerHeight - 140) / A4_H)

  return (
    <div className="tela" style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.6)', zIndex: 50, overflowY: 'auto', padding: 16 }} onMouseDown={onFechar}>
      <div style={{ ...cartao, maxWidth: 940, margin: '0 auto', display: 'flex', gap: 18, flexWrap: 'wrap', alignItems: 'flex-start' }} onMouseDown={(e) => e.stopPropagation()}>
        <div style={{ width: A4_W * escala, height: A4_H * escala, overflow: 'hidden', borderRadius: 6, boxShadow: '0 2px 10px rgba(0,0,0,.3)', flexShrink: 0 }}>
          <div style={{ width: A4_W, height: A4_H, transform: `scale(${escala})`, transformOrigin: 'top left' }}>
            <CartazA4 dados={c} />
          </div>
        </div>
        <div style={{ flex: 1, minWidth: 260, display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <button style={botaoMini} disabled={!onAnterior} onClick={onAnterior}>◀</button>
            <span style={{ fontSize: 12, color: '#7A716A' }}>{posicao}</span>
            <button style={botaoMini} disabled={!onProxima} onClick={onProxima}>▶</button>
            <button style={{ ...botaoMini, marginLeft: 'auto' }} onClick={onFechar}>✕ Fechar</button>
          </div>
          <div style={{ fontSize: 11, color: '#9A928B' }}>Original no relatório: {placa.nome_original}{placa.grupo ? ` · ${placa.grupo}` : ''}</div>
          <Campo rotulo="Produto"><input value={c.produto} onChange={(e) => set('produto', e.target.value.toUpperCase())} style={inputEstilo} /></Campo>
          <Campo rotulo="Subtítulo (opcional)"><input value={c.subtitulo} onChange={(e) => set('subtitulo', e.target.value.toUpperCase())} style={inputEstilo} placeholder="ex.: a marca" /></Campo>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            <Campo rotulo="Peso"><input value={c.peso} onChange={(e) => set('peso', e.target.value.toUpperCase())} style={inputEstilo} /></Campo>
            <Campo rotulo="A partir de (un)"><input value={c.minUnidades} onChange={(e) => set('minUnidades', e.target.value)} style={inputEstilo} placeholder="vazio = não mostra" /></Campo>
            <Campo rotulo="Preço (R$)"><input value={c.preco} onChange={(e) => set('preco', e.target.value)} style={inputEstilo} /></Campo>
            <Campo rotulo="Preço de (riscado)"><input value={c.precoDe} onChange={(e) => set('precoDe', e.target.value)} style={inputEstilo} /></Campo>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            <Campo rotulo="Faixa"><input value={c.textoFaixa} onChange={(e) => set('textoFaixa', e.target.value.toUpperCase())} style={inputEstilo} /></Campo>
            <Campo rotulo="Cor">
              <select value={c.temaId} onChange={(e) => set('temaId', e.target.value)} style={inputEstilo}>
                {TEMAS.map((t) => (
                  <option key={t.id} value={t.id}>{t.nome}</option>
                ))}
              </select>
            </Campo>
          </div>
          <Campo rotulo="Fonte">
            <select value={c.fonte} onChange={(e) => set('fonte', e.target.value)} style={inputEstilo}>
              {FONTES.map((f) => (
                <option key={f.id} value={f.id}>{f.nome}</option>
              ))}
            </select>
          </Campo>
          <div style={subcartao}>
            <div style={subtitulo}>Mostrar no cartaz</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(190px, 1fr))', gap: '2px 10px' }}>
              {OPCOES.map((o) => (
                <label key={o.chave} style={{ fontSize: 13, display: 'flex', alignItems: 'center', gap: 6, padding: '3px 0', cursor: 'pointer' }}>
                  <input type="checkbox" checked={Boolean(c[o.chave])} onChange={(e) => set(o.chave, e.target.checked)} /> {o.rotulo}
                </label>
              ))}
            </div>
          </div>
          <div style={subcartao}>
            <div style={subtitulo}>Tamanho das escritas</div>
            {TAMANHOS.map((t) => (
              <div key={t.chave} style={{ display: 'grid', gridTemplateColumns: '110px 1fr 34px', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 12, fontWeight: 600, color: '#5B534D' }}>{t.rotulo}</span>
                <input type="range" min={-6} max={t.max} step={1} value={c[t.chave]} onChange={(e) => set(t.chave, Number(e.target.value))} />
                <span style={{ fontSize: 12, textAlign: 'right' }}>{c[t.chave] > 0 ? `+${c[t.chave]}` : c[t.chave]}</span>
              </div>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {MODELOS.map((m) => (
              <button key={m.nome} style={botaoMini} onClick={() => setC((x) => ({ ...x, ...m.patch, mostrarDePor: Boolean(m.patch.mostrarDePor) && Boolean(x.precoDe.trim()) }))}>{m.nome}</button>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 4 }}>
            <button style={{ ...botaoPrimario, opacity: sujo ? 1 : 0.5 }} disabled={!sujo || salvando} onClick={() => void salvar()}>
              {salvando ? 'Salvando…' : 'Salvar alterações'}
            </button>
            <button style={botaoSecundario} onClick={onFila}>{placa.na_fila ? '− Tirar da fila' : '+ Adicionar à fila'}</button>
            <button style={{ ...botaoSecundario, color: '#B42318' }} onClick={onExcluir}>Excluir</button>
          </div>
          <div style={{ fontSize: 11, color: '#9A928B' }}>
            {placa.impressa_em ? `Impressa ${placa.impressoes}× · última em ${new Date(placa.impressa_em).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}` : 'Ainda não impressa'}
          </div>
        </div>
      </div>
    </div>
  )
}

function Campo({ rotulo, children }: { rotulo: string; children: React.ReactNode }) {
  return (
    <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#5B534D' }}>
      <span style={{ display: 'block', marginBottom: 3 }}>{rotulo}</span>
      {children}
    </label>
  )
}

// Cartão de vidro, igual ao das outras telas do Nunes (ver styles/mercadoNunes.css).
const cartao: React.CSSProperties = {
  background: 'rgba(255,255,255,0.78)',
  WebkitBackdropFilter: 'blur(22px) saturate(150%)',
  backdropFilter: 'blur(22px) saturate(150%)',
  border: '1px solid rgba(255,255,255,0.8)',
  borderRadius: 22,
  padding: 16,
  boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.8), 0 24px 50px -32px rgba(60,40,25,0.4)',
}
const barraBtn: React.CSSProperties = { background: '#4A433D', color: '#fff', border: 'none', borderRadius: 999, padding: '8px 12px', fontSize: 13, fontWeight: 600, cursor: 'pointer' }
const botaoExcluir: React.CSSProperties = {
  background: '#fff',
  color: '#B42318',
  border: '1px solid #F2C4BE',
  borderRadius: 999,
  padding: '7px 14px',
  fontSize: 13,
  fontWeight: 700,
  cursor: 'pointer',
}
const subcartao: React.CSSProperties = { border: '1px solid #E7E1D9', borderRadius: 16, padding: 12, background: 'rgba(255,255,255,0.6)' }
const subtitulo: React.CSSProperties = { fontSize: 12, fontWeight: 800, textTransform: 'uppercase', letterSpacing: 0.6, color: '#C1503F', marginBottom: 4 }
const selo = (bg: string, cor: string): React.CSSProperties => ({ background: bg, color: cor, borderRadius: 6, padding: '2px 6px', fontSize: 10, fontWeight: 700 })

const estilo = `
.mn-plaq * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
.mn-plaq .area-impressao { position: fixed; left: -10000px; top: 0; visibility: hidden; pointer-events: none; }
.mn-plaq button:disabled { cursor: not-allowed; }
.mn-plaq .plaq-editor { display: grid; grid-template-columns: 300px minmax(0, 1fr); gap: 16px; align-items: start; }
.mn-plaq .plaq-editor-previa { position: sticky; top: 16px; border: 1px solid #E7E1D9; border-radius: 18px; padding: 12px; background: rgba(255, 255, 255, 0.7); }
@media (max-width: 860px) {
  .mn-plaq .plaq-editor { grid-template-columns: minmax(0, 1fr); }
  .mn-plaq .plaq-editor-previa { position: static; }
}
.mn-plaq .plaq-editor-acoes { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; margin-top: 14px; padding-top: 14px; border-top: 1px solid #E7E1D9; }
.mn-plaq .plaq-modelo { text-align: left; border: 1px solid #DED8D0; border-radius: 14px; background: #fff; padding: 9px 12px; cursor: pointer; font-family: inherit; display: flex; flex-direction: column; gap: 2px; transition: border-color 150ms ease, box-shadow 150ms ease; }
.mn-plaq .plaq-modelo b { font-size: 13px; color: #2A2622; }
.mn-plaq .plaq-modelo span { font-size: 11px; color: #7A716A; line-height: 1.25; }
.mn-plaq .plaq-modelo:hover { border-color: rgba(193, 80, 63, 0.5); }
.mn-plaq .plaq-modelo.on { border: 2px solid #C1503F; padding: 8px 11px; background: #FCEFEC; box-shadow: 0 6px 16px -10px rgba(193, 80, 63, 0.6); }
.mn-plaq .plaq-massa-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; margin-top: 12px; }
@media (max-width: 760px) { .mn-plaq .plaq-massa-grid { grid-template-columns: minmax(0, 1fr); } }
.mn-plaq .plaq-tri { display: inline-flex; flex-shrink: 0; border-radius: 999px; padding: 2px; background: rgba(42, 38, 34, 0.06); }
.mn-plaq .plaq-tri button { border: none; background: none; border-radius: 999px; padding: 4px 10px; font-size: 12px; font-weight: 600; color: #7A716A; cursor: pointer; font-family: inherit; }
.mn-plaq .plaq-tri button.on { background: #fff; color: #2A2622; box-shadow: 0 1px 3px rgba(0, 0, 0, 0.12); }
.mn-plaq .plaq-tri button.on:last-child { color: #B42318; }
.mn-plaq .plaq-tri button.on:nth-child(2) { color: #C1503F; }
@media print {
  body > *:not(#root) { display: none !important; }
  .mn-plaq .tela { display: none !important; }
  .mn-plaq { background: #fff !important; padding: 0 !important; }
  .mn-plaq .area-impressao { position: static !important; visibility: visible !important; display: block !important; }
  .mn-plaq .folha { page-break-after: always; break-after: page; }
  .mn-plaq .folha:last-child { page-break-after: auto; break-after: auto; }
}
`
