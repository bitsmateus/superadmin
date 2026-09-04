import * as React from 'react'

/**
 * Gerador de cartazes de oferta A4 do Mercado Nunes (/mercadonunes) — página pública, sem login e
 * fora do CRM: o mercado só digita produto/preço/peso e imprime a folha, que é o que eles fazem
 * todo dia. Nada disso passa pelo tenant; usa só a estrutura do app (rota pública, igual
 * /laundry/:token e /briefing/:token).
 *
 * O cartaz é montado em HTML com medidas de A4 de verdade (210x297mm) e impresso pelo próprio
 * navegador (@page size A4) — sem biblioteca de PDF: o que aparece na prévia é exatamente o que
 * sai na impressora, e "Salvar como PDF" do navegador já resolve quando eles querem o arquivo.
 */

// A4 a 96dpi — o cartaz é montado nessas medidas em px e o container fica em mm, então a prévia na
// tela e a folha impressa batem exatamente.
const A4_W = 794
const A4_H = 1123

const LOGO_SRC = '/assets/mercadonunes-logo.jpg'

interface Tema {
  id: string
  nome: string
  faixaBg: string
  faixaTexto: string
  borda: string
  preco: string
  destaque: string
}

const TEMAS: Tema[] = [
  { id: 'vermelho', nome: 'Vermelho', faixaBg: '#ED1C24', faixaTexto: '#FFD200', borda: '#ED1C24', preco: '#ED1C24', destaque: '#FFD200' },
  { id: 'amarelo', nome: 'Amarelo', faixaBg: '#FFD200', faixaTexto: '#ED1C24', borda: '#FFD200', preco: '#ED1C24', destaque: '#ED1C24' },
  { id: 'azul', nome: 'Azul', faixaBg: '#0B5FBF', faixaTexto: '#FFD200', borda: '#0B5FBF', preco: '#0B5FBF', destaque: '#FFD200' },
  { id: 'verde', nome: 'Verde', faixaBg: '#1B8A3A', faixaTexto: '#FFD200', borda: '#1B8A3A', preco: '#1B8A3A', destaque: '#FFD200' },
  { id: 'preto', nome: 'Preto', faixaBg: '#111111', faixaTexto: '#FFD200', borda: '#111111', preco: '#111111', destaque: '#FFD200' },
]

// A família "TT Masters" completa é paga (licença comercial da TypeType). Mas "Masters Black" é o
// corte que a própria TypeType libera de graça (licença SIL OFL 1.1, uso comercial liberado) — é
// esse arquivo que está em public/fonts/, self-hosted, sem depender de CDN nenhum. É a fonte de
// verdade, não uma aproximação.
const FONTES = [
  { id: "'MastersBlack', system-ui", nome: 'Masters Black (fonte oficial, grátis)' },
  { id: "'Titan One', system-ui", nome: 'Titan One' },
  { id: "'Baloo 2', system-ui", nome: 'Baloo 2' },
  { id: "'Luckiest Guy', system-ui", nome: 'Luckiest Guy' },
  { id: "'Bowlby One SC', system-ui", nome: 'Bowlby One SC' },
  { id: "'Anton', system-ui", nome: 'Anton (mais estreita)' },
  { id: "'Archivo Black', system-ui", nome: 'Archivo Black' },
]

interface Cartaz {
  id: string
  produto: string
  peso: string
  preco: string
  precoDe: string
  unidade: string
  textoFaixa: string
  mostrarFaixa: boolean
  mostrarDePor: boolean
  mostrarLogo: boolean
  temaId: string
  fonte: string
  // Afinação manual de tamanho (-3 a +3) de cada peça do cartaz — o nome já encolhe sozinho
  // conforme o texto cresce, mas dá pra ajustar tudo na mão também.
  ajusteNome: number
  ajusteFaixa: number
  ajustePreco: number
  ajustePeso: number
}

const CARTAZ_PADRAO: Cartaz = {
  id: '',
  produto: 'GRANOLA SHAMBALA TRADICIONAL',
  peso: '800 G',
  preco: '22,99',
  precoDe: '27,80',
  unidade: '',
  textoFaixa: 'OFERTA',
  mostrarFaixa: true,
  mostrarDePor: true,
  mostrarLogo: true,
  temaId: 'vermelho',
  fonte: FONTES[0].id,
  ajusteNome: 0,
  ajusteFaixa: 0,
  ajustePreco: 0,
  ajustePeso: 0,
}

interface Modelo {
  nome: string
  descricao: string
  patch: Partial<Cartaz>
}

const MODELOS: Modelo[] = [
  {
    nome: 'Oferta de/por',
    descricao: 'Faixa OFERTA + preço antigo riscado',
    patch: { mostrarFaixa: true, textoFaixa: 'OFERTA', mostrarDePor: true, temaId: 'vermelho' },
  },
  {
    nome: 'Oferta simples',
    descricao: 'Faixa OFERTA, só o preço novo',
    patch: { mostrarFaixa: true, textoFaixa: 'OFERTA', mostrarDePor: false, temaId: 'vermelho' },
  },
  {
    nome: 'Sem faixa',
    descricao: 'Só produto e preço, bem limpo',
    patch: { mostrarFaixa: false, mostrarDePor: false, temaId: 'vermelho' },
  },
  {
    nome: 'Super oferta',
    descricao: 'Faixa amarela chamativa com de/por',
    patch: { mostrarFaixa: true, textoFaixa: 'SUPER OFERTA', mostrarDePor: true, temaId: 'amarelo' },
  },
]

/** Quebra o preço em "22" + "99" — o cartaz mostra os centavos menores, em cima. */
function partesDoPreco(preco: string): { inteiro: string; centavos: string } {
  const limpo = (preco || '').replace(/[^\d.,]/g, '').replace(/\./g, ',')
  const [inteiro = '0', centavos = ''] = limpo.split(',')
  return { inteiro: inteiro || '0', centavos: centavos.padEnd(2, '0').slice(0, 2) }
}

/** Tamanho do nome do produto: encolhe conforme o texto cresce, pra nunca estourar a folha. */
function tamanhoNome(texto: string, ajuste: number): number {
  const linhas = texto.split('\n')
  const maiorLinha = Math.max(1, ...linhas.map((l) => l.trim().length))
  const totalLinhas = Math.max(1, linhas.length, Math.ceil(texto.length / Math.max(1, maiorLinha)))
  let base = 108
  if (maiorLinha > 10) base = 96
  if (maiorLinha > 13) base = 84
  if (maiorLinha > 16) base = 72
  if (maiorLinha > 20) base = 60
  if (maiorLinha > 26) base = 50
  if (totalLinhas >= 4) base *= 0.82
  return Math.round(base * (1 + ajuste * 0.08))
}

/** Aplica um ajuste manual (-3 a +3) a um tamanho base — cada passo é 10%. */
function escalar(basePx: number, ajuste: number): number {
  return Math.round(basePx * (1 + ajuste * 0.1))
}

// ── O cartaz A4 ─────────────────────────────────────────────────────────────

export function CartazA4({ dados }: { dados: Cartaz }) {
  const tema = TEMAS.find((t) => t.id === dados.temaId) ?? TEMAS[0]
  const { inteiro, centavos } = partesDoPreco(dados.preco)
  const sombra = (px: number) => `${px}px ${px}px 0 #000`
  const fonteNome = tamanhoNome(dados.produto, dados.ajusteNome)
  const fonteFaixa = escalar(dados.textoFaixa.length > 8 ? 78 : 116, dados.ajusteFaixa)
  const fontePeso = escalar(64, dados.ajustePeso)
  const fontePrecoInteiro = escalar(250, dados.ajustePreco)
  const fontePrecoCentavos = escalar(150, dados.ajustePreco)

  return (
    <div
      className="cartaz-a4"
      style={{
        width: `${A4_W}px`,
        height: `${A4_H}px`,
        background: '#fff',
        boxSizing: 'border-box',
        padding: '26px',
        display: 'flex',
        flexDirection: 'column',
        gap: '18px',
        fontFamily: dados.fonte,
        overflow: 'hidden',
      }}
    >
      {dados.mostrarFaixa && (
        <div
          style={{
            background: tema.faixaBg,
            borderRadius: '30px',
            height: '158px',
            flexShrink: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <span
            style={{
              color: tema.faixaTexto,
              fontSize: `${fonteFaixa}px`,
              lineHeight: 1,
              letterSpacing: '2px',
              textTransform: 'uppercase',
              textShadow: sombra(7),
              padding: '0 24px',
              textAlign: 'center',
            }}
          >
            {dados.textoFaixa}
          </span>
        </div>
      )}

      <div
        style={{
          flex: 1,
          border: `4px solid ${tema.borda}`,
          borderRadius: '10px',
          padding: '30px 34px',
          display: 'flex',
          flexDirection: 'column',
          minHeight: 0,
        }}
      >
        {/* Nome do produto */}
        <div
          style={{
            fontSize: `${fonteNome}px`,
            lineHeight: 0.94,
            color: '#000',
            textTransform: 'uppercase',
            textAlign: 'center',
            textShadow: '4px 4px 0 rgba(0,0,0,0.25)',
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
            paddingTop: '6px',
          }}
        >
          {dados.produto}
        </div>

        {/* Linha de/por + peso */}
        <div
          style={{
            display: 'flex',
            alignItems: 'flex-end',
            justifyContent: 'space-between',
            gap: '16px',
            marginTop: '26px',
            minHeight: '96px',
          }}
        >
          <div style={{ color: '#000', fontSize: '46px', lineHeight: 1.05, textTransform: 'uppercase' }}>
            {dados.mostrarDePor && dados.precoDe.trim() && (
              <>
                <div>
                  DE: <span style={{ textDecoration: 'line-through' }}>{dados.precoDe}</span>
                </div>
                <div>POR:</div>
              </>
            )}
          </div>
          {dados.peso.trim() && (
            <div
              style={{
                color: tema.destaque,
                fontSize: `${fontePeso}px`,
                lineHeight: 1,
                textTransform: 'uppercase',
                textShadow: sombra(5),
                whiteSpace: 'nowrap',
              }}
            >
              {dados.peso}
            </div>
          )}
        </div>

        {/* Preço gigante */}
        <div
          style={{
            flex: 1,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            minHeight: 0,
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'flex-start',
              color: tema.preco,
              textShadow: sombra(9),
              lineHeight: 0.86,
            }}
          >
            <span style={{ fontSize: `${fontePrecoInteiro}px` }}>{inteiro}</span>
            <span style={{ fontSize: `${fontePrecoInteiro}px`, alignSelf: 'flex-end', margin: '0 -6px 0 -10px' }}>,</span>
            <span style={{ fontSize: `${fontePrecoCentavos}px`, marginTop: '10px' }}>{centavos}</span>
          </div>
        </div>

        {/* Unidade (ex.: CADA / KG / UN) */}
        {dados.unidade.trim() && (
          <div
            style={{
              textAlign: 'center',
              color: '#000',
              fontSize: '48px',
              textTransform: 'uppercase',
              marginTop: '-10px',
            }}
          >
            {dados.unidade}
          </div>
        )}

        {dados.mostrarLogo && (
          <div style={{ display: 'flex', justifyContent: 'center', marginTop: 'auto', paddingTop: '14px' }}>
            <img
              src={LOGO_SRC}
              alt="Nunes Supermercado"
              style={{ height: '86px', objectFit: 'contain' }}
              onError={(e) => {
                ;(e.currentTarget as HTMLImageElement).style.display = 'none'
              }}
            />
          </div>
        )}
      </div>
    </div>
  )
}

// ── Página ──────────────────────────────────────────────────────────────────

const STORAGE_KEY = 'mercadonunes.fila.v1'

export function MercadoNunesPage() {
  const [cartaz, setCartaz] = React.useState<Cartaz>({ ...CARTAZ_PADRAO, id: 'atual' })
  const [fila, setFila] = React.useState<Cartaz[]>(() => {
    try {
      const cru = localStorage.getItem(STORAGE_KEY)
      return cru ? (JSON.parse(cru) as Cartaz[]) : []
    } catch {
      return []
    }
  })
  const [paraImprimir, setParaImprimir] = React.useState<Cartaz[]>([])
  const [escala, setEscala] = React.useState(0.55)

  // Fontes do Google só nesta página (não pesam o resto do app).
  React.useEffect(() => {
    const link = document.createElement('link')
    link.rel = 'stylesheet'
    link.href =
      'https://fonts.googleapis.com/css2?family=Titan+One&family=Baloo+2:wght@800&family=Luckiest+Guy&family=Bowlby+One+SC&family=Anton&family=Archivo+Black&display=swap'
    document.head.appendChild(link)
    return () => {
      document.head.removeChild(link)
    }
  }, [])

  React.useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(fila))
    } catch {
      /* modo anônimo / storage cheio — a fila só não persiste */
    }
  }, [fila])

  // Prévia sempre cabendo na coluna, em qualquer tela.
  React.useEffect(() => {
    const ajustar = () => {
      const largura = Math.min(window.innerWidth - 48, 620)
      setEscala(Math.min(0.62, Math.max(0.28, largura / A4_W)))
    }
    ajustar()
    window.addEventListener('resize', ajustar)
    return () => window.removeEventListener('resize', ajustar)
  }, [])

  // Impressão: monta a área escondida, manda imprimir e limpa quando termina.
  React.useEffect(() => {
    if (!paraImprimir.length) return
    const limpar = () => setParaImprimir([])
    window.addEventListener('afterprint', limpar, { once: true })
    const t = setTimeout(() => window.print(), 250) // dá tempo das fontes/logo entrarem
    return () => {
      clearTimeout(t)
      window.removeEventListener('afterprint', limpar)
    }
  }, [paraImprimir])

  const set = <K extends keyof Cartaz>(campo: K, valor: Cartaz[K]) =>
    setCartaz((c) => ({ ...c, [campo]: valor }))

  const aplicarModelo = (m: Modelo) => setCartaz((c) => ({ ...c, ...m.patch }))

  const adicionarNaFila = () => {
    setFila((f) => [...f, { ...cartaz, id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}` }])
  }

  return (
    <div style={{ minHeight: '100vh', background: '#F4F1EC', color: '#2A2622' }} className="mercadonunes">
      <style>{estiloFontesLocais}</style>
      <style>{estiloImpressao}</style>

      {/* Cabeçalho com a logo */}
      <header
        className="tela"
        style={{ background: '#fff', borderBottom: '3px solid #C1503F', padding: '14px 20px' }}
      >
        <div style={{ maxWidth: 1180, margin: '0 auto', display: 'flex', alignItems: 'center', gap: 14 }}>
          <img
            src={LOGO_SRC}
            alt="Nunes Supermercado"
            style={{ height: 54, objectFit: 'contain' }}
            onError={(e) => {
              ;(e.currentTarget as HTMLImageElement).style.display = 'none'
            }}
          />
          <div>
            <h1 style={{ fontSize: 20, fontWeight: 800, color: '#C1503F', margin: 0 }}>Cartazes de oferta</h1>
            <p style={{ fontSize: 13, color: '#7A716A', margin: 0 }}>
              Preencha, veja a prévia e imprima em folha A4.
            </p>
          </div>
        </div>
      </header>

      <main
        className="tela"
        style={{
          maxWidth: 1180,
          margin: '0 auto',
          padding: '20px',
          display: 'grid',
          gap: 20,
          gridTemplateColumns: 'minmax(300px, 400px) 1fr',
          alignItems: 'start',
        }}
      >
        {/* ── Coluna de edição ── */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <Card titulo="Modelos prontos">
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              {MODELOS.map((m) => (
                <button
                  key={m.nome}
                  type="button"
                  onClick={() => aplicarModelo(m)}
                  style={{
                    textAlign: 'left',
                    border: '1px solid #DED8D0',
                    borderRadius: 10,
                    background: '#fff',
                    padding: '10px 12px',
                    cursor: 'pointer',
                  }}
                >
                  <div style={{ fontSize: 13, fontWeight: 700, color: '#2A2622' }}>{m.nome}</div>
                  <div style={{ fontSize: 11, color: '#7A716A', lineHeight: 1.25 }}>{m.descricao}</div>
                </button>
              ))}
            </div>
          </Card>

          <Card titulo="Produto">
            <Campo label="Nome do produto" dica="Enter quebra linha. Já sai em maiúsculas.">
              <textarea
                value={cartaz.produto}
                onChange={(e) => set('produto', e.target.value)}
                rows={3}
                style={{ ...inputEstilo, resize: 'vertical', lineHeight: 1.3 }}
              />
            </Campo>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <Campo label="Peso / tamanho">
                <input value={cartaz.peso} onChange={(e) => set('peso', e.target.value)} placeholder="800 G" style={inputEstilo} />
              </Campo>
              <Campo label="Unidade (opcional)" dica="Ex.: CADA, KG, UN">
                <input value={cartaz.unidade} onChange={(e) => set('unidade', e.target.value)} placeholder="CADA" style={inputEstilo} />
              </Campo>
            </div>
          </Card>

          <Card titulo="Tamanho das escritas" dica="Ajusta cada peça do cartaz na mão, além do que já encolhe sozinho.">
            <SliderAjuste label="Nome do produto" valor={cartaz.ajusteNome} onChange={(v) => set('ajusteNome', v)} />
            <SliderAjuste label="Faixa (topo)" valor={cartaz.ajusteFaixa} onChange={(v) => set('ajusteFaixa', v)} />
            <SliderAjuste label="Peso / tamanho" valor={cartaz.ajustePeso} onChange={(v) => set('ajustePeso', v)} />
            <SliderAjuste label="Preço" valor={cartaz.ajustePreco} onChange={(v) => set('ajustePreco', v)} />
          </Card>

          <Card titulo="Preço">
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <Campo label="Preço (por)">
                <input value={cartaz.preco} onChange={(e) => set('preco', e.target.value)} placeholder="22,99" style={inputEstilo} />
              </Campo>
              <Campo label="Preço antigo (de)">
                <input
                  value={cartaz.precoDe}
                  onChange={(e) => set('precoDe', e.target.value)}
                  placeholder="27,80"
                  disabled={!cartaz.mostrarDePor}
                  style={{ ...inputEstilo, opacity: cartaz.mostrarDePor ? 1 : 0.5 }}
                />
              </Campo>
            </div>
            <Checkbox
              checked={cartaz.mostrarDePor}
              onChange={(v) => set('mostrarDePor', v)}
              label='Mostrar "DE / POR" (preço antigo riscado)'
            />
          </Card>

          <Card titulo="Aparência">
            <Checkbox checked={cartaz.mostrarFaixa} onChange={(v) => set('mostrarFaixa', v)} label="Mostrar faixa no topo" />
            <Campo label="Texto da faixa">
              <input
                value={cartaz.textoFaixa}
                onChange={(e) => set('textoFaixa', e.target.value)}
                placeholder="OFERTA"
                disabled={!cartaz.mostrarFaixa}
                style={{ ...inputEstilo, opacity: cartaz.mostrarFaixa ? 1 : 0.5 }}
              />
            </Campo>
            <Campo label="Cor">
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {TEMAS.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    title={t.nome}
                    onClick={() => set('temaId', t.id)}
                    style={{
                      width: 38,
                      height: 38,
                      borderRadius: 9,
                      cursor: 'pointer',
                      background: t.faixaBg,
                      border: cartaz.temaId === t.id ? '3px solid #2A2622' : '1px solid #DED8D0',
                    }}
                  />
                ))}
              </div>
            </Campo>
            <Campo label="Fonte" dica="Escolha a que ficar igual à do Canva.">
              <select value={cartaz.fonte} onChange={(e) => set('fonte', e.target.value)} style={inputEstilo}>
                {FONTES.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.nome}
                  </option>
                ))}
              </select>
            </Campo>
            <Checkbox checked={cartaz.mostrarLogo} onChange={(v) => set('mostrarLogo', v)} label="Mostrar a logo no cartaz" />
          </Card>

          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <button type="button" onClick={() => setParaImprimir([cartaz])} style={botaoPrimario}>
              Imprimir este cartaz
            </button>
            <button type="button" onClick={adicionarNaFila} style={botaoSecundario}>
              + Adicionar à fila
            </button>
          </div>

          {fila.length > 0 && (
            <Card titulo={`Fila de impressão (${fila.length})`}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 220, overflowY: 'auto' }}>
                {fila.map((c) => (
                  <div
                    key={c.id}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                      border: '1px solid #EDE7DF',
                      borderRadius: 8,
                      padding: '6px 8px',
                    }}
                  >
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 12, fontWeight: 700, color: '#2A2622', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {c.produto.replace(/\n/g, ' ')}
                      </div>
                      <div style={{ fontSize: 11, color: '#7A716A' }}>
                        R$ {c.preco} {c.peso ? `· ${c.peso}` : ''}
                      </div>
                    </div>
                    <button type="button" onClick={() => setCartaz({ ...c, id: 'atual' })} style={botaoMini}>
                      Editar
                    </button>
                    <button
                      type="button"
                      onClick={() => setFila((f) => f.filter((x) => x.id !== c.id))}
                      style={{ ...botaoMini, color: '#C0392B', borderColor: '#F0C9C4' }}
                    >
                      Remover
                    </button>
                  </div>
                ))}
              </div>
              <div style={{ display: 'flex', gap: 10, marginTop: 12, flexWrap: 'wrap' }}>
                <button type="button" onClick={() => setParaImprimir(fila)} style={botaoPrimario}>
                  Imprimir fila ({fila.length} folhas)
                </button>
                <button type="button" onClick={() => setFila([])} style={botaoSecundario}>
                  Limpar fila
                </button>
              </div>
            </Card>
          )}
        </div>

        {/* ── Prévia ── */}
        <div>
          <p style={{ fontSize: 12, color: '#7A716A', marginBottom: 8 }}>
            Prévia — folha A4 (210 × 297 mm)
          </p>
          <div
            style={{
              width: A4_W * escala,
              height: A4_H * escala,
              overflow: 'hidden',
              borderRadius: 6,
              boxShadow: '0 8px 30px rgba(0,0,0,0.18)',
              background: '#fff',
            }}
          >
            <div style={{ transform: `scale(${escala})`, transformOrigin: 'top left' }}>
              <CartazA4 dados={cartaz} />
            </div>
          </div>
        </div>
      </main>

      {/* Área de impressão — some da tela, aparece só no papel (uma folha por cartaz) */}
      <div className="area-impressao">
        {paraImprimir.map((c) => (
          <CartazA4 key={c.id || 'atual'} dados={c} />
        ))}
      </div>
    </div>
  )
}

// ── Estilos ─────────────────────────────────────────────────────────────────

// Fontes self-hosted (public/fonts/) — cortes gratuitos da TypeType (licença SIL OFL 1.1, ver
// public/fonts/LICENSE-masters.txt), sem depender de CDN externo.
const estiloFontesLocais = `
@font-face { font-family: 'MastersBlack'; src: url('/fonts/masters-black.otf') format('opentype'); font-display: swap; }
@font-face { font-family: 'MastersBirds'; src: url('/fonts/masters-birds.otf') format('opentype'); font-display: swap; }
@font-face { font-family: 'MastersRoughThin'; src: url('/fonts/masters-rough-thin.otf') format('opentype'); font-display: swap; }
`

const estiloImpressao = `
.mercadonunes .area-impressao { display: none; }
.mercadonunes * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
@media print {
  @page { size: A4 portrait; margin: 0; }
  body > *:not(#root) { display: none !important; }
  .mercadonunes .tela { display: none !important; }
  .mercadonunes .area-impressao { display: block !important; }
  .mercadonunes .cartaz-a4 { page-break-after: always; break-after: page; }
  .mercadonunes .cartaz-a4:last-child { page-break-after: auto; break-after: auto; }
}
`

const inputEstilo: React.CSSProperties = {
  width: '100%',
  boxSizing: 'border-box',
  border: '1px solid #DED8D0',
  borderRadius: 8,
  padding: '9px 10px',
  fontSize: 14,
  color: '#2A2622',
  background: '#fff',
  outline: 'none',
  fontFamily: 'inherit',
}

const botaoPrimario: React.CSSProperties = {
  background: '#C1503F',
  color: '#fff',
  border: 'none',
  borderRadius: 10,
  padding: '12px 18px',
  fontSize: 14,
  fontWeight: 700,
  cursor: 'pointer',
}

const botaoSecundario: React.CSSProperties = {
  background: '#fff',
  color: '#2A2622',
  border: '1px solid #DED8D0',
  borderRadius: 10,
  padding: '12px 18px',
  fontSize: 14,
  fontWeight: 600,
  cursor: 'pointer',
}

const botaoMini: React.CSSProperties = {
  background: '#fff',
  color: '#5B534D',
  border: '1px solid #DED8D0',
  borderRadius: 6,
  padding: '4px 8px',
  fontSize: 11,
  cursor: 'pointer',
}

function Card({ titulo, dica, children }: { titulo: string; dica?: string; children: React.ReactNode }) {
  return (
    <section style={{ background: '#fff', border: '1px solid #E7E1D9', borderRadius: 12, padding: 14 }}>
      <h2 style={{ fontSize: 12, fontWeight: 800, textTransform: 'uppercase', letterSpacing: 0.6, color: '#C1503F', margin: '0 0 4px' }}>
        {titulo}
      </h2>
      {dica && <p style={{ fontSize: 11, color: '#9A928B', margin: '0 0 10px' }}>{dica}</p>}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: dica ? 0 : 10 }}>{children}</div>
    </section>
  )
}

function SliderAjuste({ label, valor, onChange }: { label: string; valor: number; onChange: (v: number) => void }) {
  return (
    <label style={{ display: 'block' }}>
      <span style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#5B534D', marginBottom: 4 }}>{label}</span>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <input
          type="range"
          min={-3}
          max={3}
          step={1}
          value={valor}
          onChange={(e) => onChange(Number(e.target.value))}
          style={{ flex: 1 }}
        />
        <span style={{ fontSize: 12, color: '#7A716A', width: 32, textAlign: 'right' }}>
          {valor > 0 ? `+${valor}` : valor}
        </span>
      </div>
    </label>
  )
}

function Campo({ label, dica, children }: { label: string; dica?: string; children: React.ReactNode }) {
  return (
    <label style={{ display: 'block' }}>
      <span style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#5B534D', marginBottom: 4 }}>{label}</span>
      {dica && <span style={{ display: 'block', fontSize: 11, color: '#9A928B', marginBottom: 4 }}>{dica}</span>}
      {children}
    </label>
  )
}

function Checkbox({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: '#2A2622', cursor: 'pointer' }}>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      {label}
    </label>
  )
}
