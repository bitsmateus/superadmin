import * as React from 'react'
import { Link } from 'react-router-dom'
import { toast } from 'sonner'
import {
  AcougueSemSessao,
  acougueApi,
  acougueToken,
  type AcougueBase,
  type AcougueHistorico,
  type AcougueUsuario,
} from '@/api/acougue'
import {
  KG_POR_ARROBA,
  calcularRateio,
  custoPorKg,
  derivarIndices,
  type Arredondamento,
  type Corte,
  type Unidade,
} from '@/lib/acougueRateio'

/**
 * Rateio do boi — /mercadonunes/acougue.
 *
 * O mercado compra a carcaça e vende em cortes. Quando o preço da compra muda, em vez de refazer
 * corte por corte na mão, aqui basta digitar o novo custo: o sistema distribui o valor entre os
 * cortes (peso × índice) de um jeito que o boi inteiro fecha a margem pedida.
 *
 * Login próprio (e-mail + senha só desta ferramenta) porque a tela mostra custo e margem.
 */

const LOGO_SRC = '/mercadonunes/logo.png'
const brl = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
const num = (v: string) => Number(String(v).replace(/\./g, '').replace(',', '.')) || 0
/** Mostra número pro operador sem casas sobrando (2,5 e não 2,5000). */
const txt = (v: number | undefined | null, casas = 2) =>
  v === undefined || v === null || !Number.isFinite(v) ? '' : String(Number(v.toFixed(casas))).replace('.', ',')

const UNIDADES: { id: Unidade; label: string; dica: string }[] = [
  { id: 'arroba', label: 'Arroba', dica: `1 arroba = ${KG_POR_ARROBA} kg` },
  { id: 'kg', label: 'Quilo', dica: 'preço por kg da carcaça' },
  { id: 'peca', label: 'Peça inteira', dica: 'valor pago + peso da peça' },
]

const ARREDONDAMENTOS: { id: Arredondamento; label: string }[] = [
  { id: 'nenhum', label: 'Sem arredondar' },
  { id: 'centavo90', label: 'Terminar em ,90' },
  { id: 'centavo99', label: 'Terminar em ,99' },
  { id: 'centavo50', label: 'Terminar em ,50' },
  { id: 'inteiro', label: 'Valor inteiro' },
]

const novoCorte = (): Corte => ({
  id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
  nome: '',
  codigo: '',
  participacao: 0,
  indice: 1,
  quebra: 0,
  precoAtual: 0,
  ativo: true,
})

// Lista de cortes bovinos + % de participação + preço praticado hoje — vem direto da tela
// "Simulação do Açougue" do sistema antigo (Max Work) do Mercado Nunes: 28 cortes, %Rat. soma
// exatamente 100% (é o rateio de verdade que eles já usam, não uma estimativa de uma pesagem só).
// "codigo" é o número de produto (coluna "Prod.") de lá — só referência, não entra em nenhuma conta
// aqui. Como já veio com o preço praticado de cada corte, também preenche "Preço hoje" — falta só
// abrir "Calcular índices pelos preços de hoje" pra terminar de configurar.
const CORTES_BOVINOS_PADRAO: { nome: string; codigo: string; participacao: number; precoAtual: number }[] = [
  { nome: 'Agulha bovina', codigo: '75', participacao: 6.00, precoAtual: 33.75 },
  { nome: 'Alcatra bovina', codigo: '62', participacao: 4.00, precoAtual: 66.90 },
  { nome: 'Capa coxão mole bovino', codigo: '148', participacao: 0.90, precoAtual: 43.25 },
  { nome: 'Carne bovina recorte moída', codigo: '160', participacao: 2.50, precoAtual: 18.25 },
  { nome: 'Charque bovino', codigo: '251', participacao: 0.10, precoAtual: 52.90 },
  { nome: 'Contrafilé bovino', codigo: '67', participacao: 9.00, precoAtual: 67.95 },
  { nome: 'Costela bovina minga', codigo: '110', participacao: 5.40, precoAtual: 21.75 },
  { nome: 'Costela bovina ripa', codigo: '188', participacao: 6.32, precoAtual: 31.75 },
  { nome: 'Costilhar bovino', codigo: '82', participacao: 0.77, precoAtual: 42.75 },
  { nome: 'Coxão fora bovino', codigo: '69', participacao: 3.60, precoAtual: 47.95 },
  { nome: 'Coxão mole bovino', codigo: '60', participacao: 5.85, precoAtual: 57.90 },
  { nome: 'Filé mignon bovino', codigo: '65', participacao: 1.40, precoAtual: 99.90 },
  { nome: 'Granito bovino', codigo: '83', participacao: 3.90, precoAtual: 43.75 },
  { nome: 'Lombo bovino', codigo: '61', participacao: 5.00, precoAtual: 54.85 },
  { nome: 'Maminha bovina', codigo: '68', participacao: 2.50, precoAtual: 69.75 },
  { nome: 'Músculo dianteiro bovino moído', codigo: '71', participacao: 7.00, precoAtual: 24.45 },
  { nome: 'Músculo traseiro bovino', codigo: '132', participacao: 3.50, precoAtual: 37.75 },
  { nome: 'Paleta grossa bovina', codigo: '73', participacao: 6.80, precoAtual: 47.25 },
  { nome: 'Patinho bovino', codigo: '145', participacao: 7.60, precoAtual: 53.75 },
  { nome: 'Picanha bovina', codigo: '63', participacao: 1.24, precoAtual: 119.00 },
  { nome: 'Tatu bovino', codigo: '70', participacao: 1.50, precoAtual: 47.90 },
  { nome: 'Vazio bovino', codigo: '66', participacao: 2.00, precoAtual: 57.85 },
  { nome: 'Retalho bovino', codigo: '338', participacao: 6.50, precoAtual: 1.95 },
  { nome: 'Acém bovino', codigo: '74', participacao: 6.00, precoAtual: 44.95 },
  { nome: 'Frescal bovino', codigo: '225', participacao: 0.40, precoAtual: 56.90 },
  { nome: 'Entranha bovina', codigo: '375', participacao: 0.20, precoAtual: 59.95 },
  { nome: 'Cordão de filé mignon bovino', codigo: '376', participacao: 0.01, precoAtual: 46.75 },
  { nome: 'Costela bovina resfriada', codigo: '379', participacao: 0.01, precoAtual: 54.90 },
]

export function AcouguePage() {
  const [usuario, setUsuario] = React.useState<AcougueUsuario | null>(null)
  const [carregandoSessao, setCarregandoSessao] = React.useState(true)

  React.useEffect(() => {
    if (!acougueToken.get()) {
      setCarregandoSessao(false)
      return
    }
    acougueApi
      .me()
      .then(setUsuario)
      .catch(() => acougueToken.clear())
      .finally(() => setCarregandoSessao(false))
  }, [])

  if (carregandoSessao) {
    return (
      <Moldura>
        <p style={{ color: '#7A716A', textAlign: 'center', padding: 40 }}>Carregando…</p>
      </Moldura>
    )
  }

  if (!usuario) return <TelaLogin onEntrar={setUsuario} />

  return (
    <Rateio
      usuario={usuario}
      onSair={() => {
        acougueToken.clear()
        setUsuario(null)
      }}
    />
  )
}

// ── Moldura comum (cabeçalho com a logo) ──────────────────────────────────────

function Moldura({ children, direita }: { children: React.ReactNode; direita?: React.ReactNode }) {
  return (
    <div style={{ minHeight: '100vh', background: '#F4F1EC', color: '#2A2622' }}>
      <header style={{ background: '#fff', borderBottom: '3px solid #C1503F', padding: '14px 20px' }}>
        <div style={{ maxWidth: 1180, margin: '0 auto', display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
          <img
            src={LOGO_SRC}
            alt="Nunes Supermercado"
            style={{ height: 48, objectFit: 'contain' }}
            onError={(e) => {
              ;(e.currentTarget as HTMLImageElement).style.display = 'none'
            }}
          />
          <div style={{ flex: 1, minWidth: 180 }}>
            <h1 style={{ fontSize: 20, fontWeight: 800, color: '#C1503F', margin: 0 }}>Açougue — rateio do boi</h1>
            <p style={{ fontSize: 13, color: '#7A716A', margin: 0 }}>
              Quanto cada corte custa de verdade depois da desossa — e por quanto vender.
            </p>
          </div>
          {direita}
        </div>
      </header>
      <main style={{ maxWidth: 1180, margin: '0 auto', padding: 20 }}>{children}</main>
    </div>
  )
}

// ── Login ─────────────────────────────────────────────────────────────────────

function TelaLogin({ onEntrar }: { onEntrar: (u: AcougueUsuario) => void }) {
  const [temUsuario, setTemUsuario] = React.useState<boolean | null>(null)
  const [email, setEmail] = React.useState('')
  const [nome, setNome] = React.useState('')
  const [senha, setSenha] = React.useState('')
  const [enviando, setEnviando] = React.useState(false)

  React.useEffect(() => {
    acougueApi
      .status()
      .then((s) => setTemUsuario(s.temUsuario))
      .catch(() => setTemUsuario(true))
  }, [])

  const primeiroAcesso = temUsuario === false

  const enviar = async (e: React.FormEvent) => {
    e.preventDefault()
    setEnviando(true)
    try {
      const r = primeiroAcesso
        ? await acougueApi.primeiroAcesso(email.trim(), nome.trim(), senha)
        : await acougueApi.login(email.trim(), senha)
      acougueToken.set(r.token)
      onEntrar(r.usuario)
    } catch (err) {
      toast.error((err as Error).message)
    } finally {
      setEnviando(false)
    }
  }

  return (
    <Moldura>
      <form
        onSubmit={enviar}
        style={{
          maxWidth: 380,
          margin: '40px auto',
          background: '#fff',
          border: '1px solid #E7E1D9',
          borderRadius: 12,
          padding: 20,
          display: 'flex',
          flexDirection: 'column',
          gap: 12,
        }}
      >
        <h2 style={{ fontSize: 16, fontWeight: 800, margin: 0 }}>
          {primeiroAcesso ? 'Criar o primeiro acesso' : 'Entrar'}
        </h2>
        <p style={{ fontSize: 12, color: '#9A928B', margin: 0 }}>
          {primeiroAcesso
            ? 'Ninguém tem acesso ainda. Crie o primeiro e-mail e senha desta ferramenta.'
            : 'Use o e-mail e a senha do açougue (não é o login do painel).'}
        </p>
        {primeiroAcesso && (
          <Campo label="Seu nome">
            <input value={nome} onChange={(e) => setNome(e.target.value)} style={inputEstilo} autoComplete="name" />
          </Campo>
        )}
        <Campo label="E-mail">
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            style={inputEstilo}
            autoComplete="username"
            required
          />
        </Campo>
        <Campo label="Senha">
          <input
            type="password"
            value={senha}
            onChange={(e) => setSenha(e.target.value)}
            style={inputEstilo}
            autoComplete={primeiroAcesso ? 'new-password' : 'current-password'}
            required
          />
        </Campo>
        <button type="submit" disabled={enviando} style={{ ...botaoPrimario, opacity: enviando ? 0.6 : 1 }}>
          {enviando ? 'Entrando…' : primeiroAcesso ? 'Criar acesso' : 'Entrar'}
        </button>
        <Link to="/mercadonunes" style={{ fontSize: 12, color: '#7A716A', textAlign: 'center' }}>
          ← Voltar para as plaquinhas
        </Link>
      </form>
    </Moldura>
  )
}

// ── Tela principal (3 etapas: compra → o que saiu da peça → resultado) ─────────

type Etapa = 1 | 2 | 3

/** Corte que entra na conta: ativo e que não seja a linha antiga de "sebo / quebra geral" (quebra 100%). */
const vendavel = (c: Corte) => c.ativo !== false && (Number(c.quebra) || 0) < 100

/** Recalcula o índice (valor relativo) de cada corte a partir do preço que vende hoje. O índice só
 *  depende da proporção entre os preços, então o custo usado aqui é irrelevante. */
function comIndices(cortes: Corte[]): Corte[] {
  const r = derivarIndices({ unidade: 'kg', custo: 1, margem: 0 }, cortes)
  return r.erro ? cortes : r.cortes
}

function Rateio({ usuario, onSair }: { usuario: AcougueUsuario; onSair: () => void }) {
  const [bases, setBases] = React.useState<AcougueBase[]>([])
  const [baseId, setBaseId] = React.useState<string | null>(null)
  const [carregando, setCarregando] = React.useState(true)
  const [salvando, setSalvando] = React.useState(false)
  const [historico, setHistorico] = React.useState<AcougueHistorico[] | null>(null)
  const [painelAcessos, setPainelAcessos] = React.useState(false)
  const [etapa, setEtapa] = React.useState<Etapa>(1)
  /** Preço que o dono pretende cobrar em cada corte (só nesta sessão): troca o sugerido pra conferir a margem. */
  const [precoPraticado, setPrecoPraticado] = React.useState<Record<string, number>>({})
  const [sujo, setSujo] = React.useState(false)

  const base = bases.find((b) => b.id === baseId) ?? null

  const semSessao = (err: unknown) => {
    if (err instanceof AcougueSemSessao) {
      toast.error(err.message)
      onSair()
      return true
    }
    return false
  }

  const carregar = React.useCallback(async () => {
    try {
      const lista = await acougueApi.bases()
      setBases(lista)
      setBaseId((atual) => atual ?? lista[0]?.id ?? null)
    } catch (err) {
      if (!semSessao(err)) toast.error((err as Error).message)
    } finally {
      setCarregando(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  React.useEffect(() => {
    void carregar()
  }, [carregar])

  /** Mexe na base em memória — o salvar vai pro banco (com debounce no efeito abaixo). */
  const patch = (dados: Partial<AcougueBase>) => {
    if (!base) return
    setBases((lista) => lista.map((b) => (b.id === base.id ? { ...b, ...dados } : b)))
    setSujo(true)
  }

  // Mudou o custo, a margem ou a base: os preços "que vou cobrar" digitados antes não valem mais.
  React.useEffect(() => {
    setPrecoPraticado({})
  }, [baseId, base?.custo, base?.margem, base?.unidade, base?.pesoPeca, base?.arredondamento])

  /** Acrescenta os cortes bovinos padrão (nome + código + participação + preço de hoje, vindos da
   *  planilha do sistema antigo) — quem ainda não existe na base entra novo; quem já existe mas
   *  está com participação/código/preço vazio ganha o valor do modelo nesse campo específico. Campo
   *  que já tem valor não é tocado — não sobrescreve o que foi ajustado à mão. Compara nome sem
   *  acento/maiúscula. */
  const adicionarCortesPadrao = () => {
    if (!base) return
    const normaliza = (s: string) =>
      s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim()
    const porNome = new Map(base.cortes.map((c) => [normaliza(c.nome), c]))

    let novos = 0
    let atualizados = 0
    const cortesAtualizados = base.cortes.map((c) => {
      const modelo = CORTES_BOVINOS_PADRAO.find((m) => normaliza(m.nome) === normaliza(c.nome))
      if (!modelo) return c
      const ajustes: Partial<Corte> = {}
      if ((c.participacao ?? 0) === 0) ajustes.participacao = modelo.participacao
      if (!c.codigo?.trim()) ajustes.codigo = modelo.codigo
      if ((c.precoAtual ?? 0) === 0) ajustes.precoAtual = modelo.precoAtual
      if (Object.keys(ajustes).length === 0) return c
      atualizados++
      return { ...c, ...ajustes }
    })
    const paraAdicionar = CORTES_BOVINOS_PADRAO.filter((m) => !porNome.has(normaliza(m.nome)))
    novos = paraAdicionar.length

    if (novos === 0 && atualizados === 0) {
      toast.message('Todos esses cortes já estão cadastrados e preenchidos')
      return
    }
    patch({
      cortes: comIndices([
        ...cortesAtualizados,
        ...paraAdicionar.map((m) => ({
          ...novoCorte(),
          nome: m.nome,
          codigo: m.codigo,
          participacao: m.participacao,
          precoAtual: m.precoAtual,
        })),
      ]),
    })
    const partes = [
      novos > 0 && `${novos} corte(s) adicionado(s)`,
      atualizados > 0 && `${atualizados} atualizado(s)`,
    ].filter(Boolean)
    toast.success(partes.join(' · '))
  }

  /** Trava/destrava o preço de todos os cortes de uma vez — útil quando a maioria já tem preço
   *  certo e só alguns poucos precisam recalcular. */
  const travarTodos = (valor: boolean) => {
    if (!base) return
    patch({ cortes: base.cortes.map((c) => ({ ...c, travado: valor })) })
    toast.success(valor ? 'Todos os preços mantidos' : 'Todos os preços liberados pra recalcular')
  }

  // Salva sozinho 1,2s depois da última tecla — ninguém no açougue vai lembrar de clicar "salvar".
  React.useEffect(() => {
    if (!sujo || !base) return
    const t = setTimeout(async () => {
      setSalvando(true)
      try {
        await acougueApi.salvarBase(base.id, {
          nome: base.nome,
          unidade: base.unidade,
          custo: base.custo,
          pesoPeca: base.pesoPeca,
          margem: base.margem,
          arredondamento: base.arredondamento,
          cortes: base.cortes,
        })
        setSujo(false)
      } catch (err) {
        if (!semSessao(err)) toast.error('Não consegui salvar: ' + (err as Error).message)
      } finally {
        setSalvando(false)
      }
    }, 1200)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sujo, base?.id, base?.nome, base?.unidade, base?.custo, base?.pesoPeca, base?.margem, base?.arredondamento, base?.cortes])

  const peso = base?.pesoPeca ?? 0

  /** Cortes que entram na conta. Base antiga que nunca teve os índices calculados (todos = 1) ganha
   *  os índices a partir dos preços de hoje — sem isso todos os cortes sairiam com o mesmo preço. */
  const cortesBase = React.useMemo(() => {
    if (!base) return []
    const lista = base.cortes.filter(vendavel)
    const comPreco = lista.filter((c) => (c.participacao ?? 0) > 0 && (c.precoAtual ?? 0) > 0)
    const nuncaCalculou = comPreco.length > 1 && comPreco.every((c) => Math.abs((c.indice ?? 1) - 1) < 1e-9)
    return nuncaCalculou ? comIndices(lista) : lista
  }, [base])

  const calc = React.useMemo(() => {
    if (!base) return null
    const baseCalc = {
      unidade: base.unidade,
      custo: base.custo,
      pesoPeca: base.pesoPeca ?? undefined,
      margem: base.margem,
      arredondamento: base.arredondamento,
    }
    const custoKg = custoPorKg(baseCalc)
    // Custo de cada corte = o mesmo rateio, mas com margem zero e sem arredondar (o boi só "se paga").
    const custos = calcularRateio(
      { ...baseCalc, margem: 0, arredondamento: 'nenhum' },
      cortesBase.map((c) => ({ ...c, travado: false })),
    )
    const sug = calcularRateio(baseCalc, cortesBase)
    const linhas = sug.cortes.map((c) => {
      const kg = (c.pesoVendavel * peso) / 100
      const custo = custos.cortes.find((x) => x.id === c.id)?.precoExato ?? 0
      const sugerido = c.precoNovo
      const usado = precoPraticado[c.id] ?? sugerido
      const lucro = usado - custo
      return {
        corte: c,
        kg,
        custo,
        sugerido,
        usado,
        lucro,
        margem: custo > 0 ? (lucro / custo) * 100 : 0,
        variacao: c.precoAtual && c.precoAtual > 0 ? usado - c.precoAtual : null,
      }
    })
    const kgTotal = linhas.reduce((s, l) => s + l.kg, 0)
    const investimento = custoKg * peso
    const faturamento = linhas.reduce((s, l) => s + l.kg * l.usado, 0)
    const lucroBruto = faturamento - investimento
    const avisos = sug.avisos.filter((a) => !a.startsWith('As participações'))
    if (peso > 0 && kgTotal > peso * 1.0005) {
      avisos.push(`Os cortes somam ${txt(kgTotal, 2)} kg, mais do que os ${txt(peso, 2)} kg que você comprou — confira os pesos.`)
    }
    return {
      custoKg,
      linhas,
      kgTotal,
      investimento,
      faturamento,
      lucroBruto,
      margemGeral: investimento > 0 ? (lucroBruto / investimento) * 100 : 0,
      custoReal: kgTotal > 0 ? investimento / kgTotal : 0,
      perdaKg: Math.max(0, peso - kgTotal),
      avisos,
    }
  }, [base, cortesBase, peso, precoPraticado])

  const criarBase = async () => {
    const nome = window.prompt('Nome da base (ex.: Boi desossado, Boi campo, Suíno)')?.trim()
    if (!nome) return
    try {
      const nova = await acougueApi.criarBase(nome)
      setBases((l) => [...l, nova].sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR')))
      setBaseId(nova.id)
      setEtapa(1)
    } catch (err) {
      if (!semSessao(err)) toast.error((err as Error).message)
    }
  }

  const removerBase = async () => {
    if (!base) return
    if (!window.confirm(`Excluir a base "${base.nome}" e todos os cortes dela?`)) return
    try {
      await acougueApi.removerBase(base.id)
      setBases((l) => l.filter((b) => b.id !== base.id))
      setBaseId(null)
      toast.success('Base excluída')
    } catch (err) {
      if (!semSessao(err)) toast.error((err as Error).message)
    }
  }

  const aplicar = async () => {
    if (!base || !calc) return
    const cortes = base.cortes.map((c) => {
      const l = calc.linhas.find((x) => x.corte.id === c.id)
      return l ? { ...c, indice: l.corte.indice, precoAtual: l.usado } : c
    })
    try {
      await acougueApi.aplicar(base.id, cortes, calc.custoKg, base.margem)
      setBases((l) => l.map((b) => (b.id === base.id ? { ...b, cortes } : b)))
      setSujo(false)
      setPrecoPraticado({})
      toast.success('Preços aplicados — agora eles são os preços de hoje')
    } catch (err) {
      if (!semSessao(err)) toast.error((err as Error).message)
    }
  }

  const exportarCsv = () => {
    if (!base || !calc) return
    const linhas = [
      'codigo;produto;preco_novo;preco_anterior;kg;custo_kg;participacao_pct;indice',
      ...calc.linhas.map((l) =>
        [
          l.corte.codigo ?? '',
          l.corte.nome,
          txt(l.usado),
          txt(l.corte.precoAtual ?? 0),
          txt(l.kg, 3),
          txt(l.custo),
          txt(l.corte.participacao),
          txt(l.corte.indice, 4),
        ].join(';'),
      ),
    ]
    const blob = new Blob(['﻿' + linhas.join('\n')], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `precos-${base.nome.toLowerCase().replace(/\s+/g, '-')}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  const abrirHistorico = async () => {
    if (!base) return
    try {
      setHistorico(await acougueApi.historico(base.id))
    } catch (err) {
      if (!semSessao(err)) toast.error((err as Error).message)
    }
  }

  const setCorte = (id: string, dados: Partial<Corte>) =>
    patch({ cortes: (base?.cortes ?? []).map((c) => (c.id === id ? { ...c, ...dados } : c)) })

  /** O operador digita kg; por baixo continua gravando a participação (% da peça) e zera a quebra. */
  const setKg = (id: string, kg: number) => {
    if (peso <= 0) return
    patch({
      cortes: comIndices(
        (base?.cortes ?? []).map((c) => (c.id === id ? { ...c, participacao: (kg / peso) * 100, quebra: 0 } : c)),
      ),
    })
  }

  const setPrecoHoje = (id: string, preco: number) =>
    patch({ cortes: comIndices((base?.cortes ?? []).map((c) => (c.id === id ? { ...c, precoAtual: preco } : c))) })

  const custoOk = Boolean(base && calc && calc.custoKg > 0 && peso > 0)
  const temCortes = Boolean(calc && calc.kgTotal > 0)

  const irParaEtapa = (e: Etapa) => {
    if (e >= 2 && !custoOk) {
      toast.error('Preencha o peso e o valor pago na compra primeiro.')
      setEtapa(1)
      return
    }
    if (e === 3 && !temCortes) {
      toast.error('Informe quantos kg saíram de pelo menos um corte.')
      setEtapa(2)
      return
    }
    setEtapa(e)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const ETAPAS: { n: Etapa; label: string }[] = [
    { n: 1, label: 'Compra' },
    { n: 2, label: 'Cortes' },
    { n: 3, label: 'Resultado' },
  ]

  return (
    <Moldura
      direita={
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 12, color: '#9A928B' }}>{usuario.nome || usuario.email}</span>
          <button type="button" onClick={() => setPainelAcessos(true)} style={botaoMini}>
            Acessos
          </button>
          <Link to="/mercadonunes" style={{ ...botaoSecundario, textDecoration: 'none', padding: '8px 12px' }}>
            🏷️ Plaquinhas
          </Link>
          <button type="button" onClick={onSair} style={botaoMini}>
            Sair
          </button>
        </div>
      }
    >
      {carregando ? (
        <p style={{ color: '#7A716A' }}>Carregando…</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {/* Seleção da base */}
          <Card>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
              <select
                value={baseId ?? ''}
                onChange={(e) => {
                  setBaseId(e.target.value || null)
                  setHistorico(null)
                  setEtapa(1)
                }}
                style={{ ...inputEstilo, width: 'auto', minWidth: 220, flex: '0 1 auto' }}
              >
                <option value="">— escolha a base —</option>
                {bases.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.nome}
                  </option>
                ))}
              </select>
              <button type="button" onClick={criarBase} style={botaoSecundario}>
                + Nova base
              </button>
              {base && (
                <button type="button" onClick={removerBase} style={{ ...botaoMini, color: '#C1503F' }}>
                  Excluir base
                </button>
              )}
              <span style={{ marginLeft: 'auto', fontSize: 12, color: salvando ? '#C1503F' : '#9A928B' }}>
                {salvando ? 'Salvando…' : sujo ? 'Alterações pendentes' : 'Tudo salvo'}
              </span>
            </div>
            {bases.length === 0 && (
              <p style={{ fontSize: 13, color: '#7A716A', margin: '10px 0 0' }}>
                Crie a primeira base (ex.: <strong>Boi desossado</strong>) e siga os 3 passos: o que você comprou, o que
                saiu da peça e o resultado com o preço de cada corte.
              </p>
            )}
          </Card>

          {base && calc && (
            <>
              {/* Etapas */}
              <div style={{ display: 'flex', gap: 8 }}>
                {ETAPAS.map((e) => {
                  const ativa = etapa === e.n
                  return (
                    <button
                      key={e.n}
                      type="button"
                      onClick={() => irParaEtapa(e.n)}
                      style={{
                        flex: 1,
                        border: 'none',
                        borderRadius: 999,
                        padding: '10px 8px',
                        fontSize: 14,
                        fontWeight: 800,
                        cursor: 'pointer',
                        background: ativa ? '#C1503F' : '#fff',
                        color: ativa ? '#fff' : '#7A716A',
                        boxShadow: ativa ? 'none' : 'inset 0 0 0 1px #DED8D0',
                      }}
                    >
                      {e.n} · {e.label}
                    </button>
                  )
                })}
              </div>

              {etapa === 1 && (
                <Card titulo="Etapa 1 de 3 · O que você comprou">
                  <p style={{ fontSize: 13, color: '#7A716A', margin: '0 0 12px' }}>
                    Informe como pagou e o peso da carcaça (ou da peça) que chegou.
                  </p>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    {UNIDADES.map((u) => (
                      <button
                        key={u.id}
                        type="button"
                        onClick={() => patch({ unidade: u.id })}
                        style={{
                          ...botaoSecundario,
                          padding: '8px 14px',
                          borderColor: base.unidade === u.id ? '#C1503F' : '#DED8D0',
                          color: base.unidade === u.id ? '#C1503F' : '#2A2622',
                          fontWeight: base.unidade === u.id ? 800 : 600,
                        }}
                        title={u.dica}
                      >
                        {u.label}
                      </button>
                    ))}
                  </div>
                  <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 12 }}>
                    <Campo label="Peso da carcaça / peça (kg)">
                      <CampoDecimal
                        valor={base.pesoPeca ?? 0}
                        onCommit={(novoPeso) => {
                          // Peça inteira grava o TOTAL pago em `custo`; mexer no peso mantém o preço por kg.
                          if (base.unidade === 'peca' && (base.pesoPeca ?? 0) > 0 && novoPeso > 0) {
                            const porKg = base.custo / (base.pesoPeca ?? 1)
                            patch({ pesoPeca: novoPeso, custo: Math.round(porKg * novoPeso * 100) / 100 })
                          } else {
                            patch({ pesoPeca: novoPeso > 0 ? novoPeso : null })
                          }
                        }}
                        style={{ ...inputEstilo, width: 160 }}
                      />
                    </Campo>
                    {base.unidade === 'peca' ? (
                      <Campo label="R$ pago por kg">
                        <CampoDecimal
                          valor={peso > 0 ? base.custo / peso : 0}
                          onCommit={(precoPorKg) => patch({ custo: Math.round(precoPorKg * peso * 100) / 100 })}
                          style={{ ...inputEstilo, width: 140 }}
                        />
                      </Campo>
                    ) : (
                      <Campo label={base.unidade === 'arroba' ? 'R$ pago por arroba' : 'R$ pago por kg'}>
                        <CampoDecimal valor={base.custo} onCommit={(n) => patch({ custo: n })} style={{ ...inputEstilo, width: 140 }} />
                      </Campo>
                    )}
                    <Campo label="Margem sobre o custo (%)">
                      <CampoDecimal valor={base.margem} onCommit={(n) => patch({ margem: n })} style={{ ...inputEstilo, width: 120 }} />
                    </Campo>
                    <Campo label="Arredondar preços">
                      <select
                        value={base.arredondamento}
                        onChange={(e) => patch({ arredondamento: e.target.value as Arredondamento })}
                        style={{ ...inputEstilo, width: 'auto' }}
                      >
                        {ARREDONDAMENTOS.map((a) => (
                          <option key={a.id} value={a.id}>
                            {a.label}
                          </option>
                        ))}
                      </select>
                    </Campo>
                  </div>
                  {base.unidade === 'peca' && (
                    <p style={{ margin: '8px 0 0', fontSize: 12, color: '#9A928B' }}>
                      Preencha o peso primeiro, depois o preço por kg — o total pago é calculado sozinho.
                    </p>
                  )}
                  <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginTop: 14, paddingTop: 12, borderTop: '1px solid #EFE9E1' }}>
                    <Numero titulo="Investimento na compra" valor={brl(calc.investimento)} />
                    <Numero titulo="Custo por kg comprado" valor={brl(calc.custoKg)} />
                  </div>
                  <div style={{ marginTop: 14 }}>
                    <button
                      type="button"
                      onClick={() => irParaEtapa(2)}
                      style={{ ...botaoPrimario, width: '100%', opacity: custoOk ? 1 : 0.5 }}
                    >
                      Continuar →
                    </button>
                  </div>
                </Card>
              )}

              {etapa === 2 && (
                <Card titulo="Etapa 2 de 3 · O que saiu da peça">
                  <p style={{ fontSize: 13, color: '#7A716A', margin: '0 0 12px' }}>
                    Depois da desossa, digite quantos <strong>kg</strong> saíram de cada corte. Deixe em branco o que não saiu. O sebo e o
                    osso (a perda) são calculados sozinhos.
                  </p>
                  {peso <= 0 ? (
                    <p style={{ fontSize: 13, color: '#B25E1B', margin: '0 0 12px' }}>
                      Falta o peso da carcaça. Volte na etapa 1 e informe quantos kg você comprou.
                    </p>
                  ) : (
                    <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginBottom: 12 }}>
                      <Numero titulo="Comprado" valor={`${txt(peso, 2)} kg`} />
                      <Numero
                        titulo="Saiu em cortes"
                        valor={`${txt(calc.kgTotal, 2)} kg`}
                        alerta={calc.kgTotal > peso * 1.0005}
                      />
                      <Numero
                        titulo="Perda (osso e sebo)"
                        valor={
                          calc.kgTotal > peso * 1.0005
                            ? 'confira os pesos'
                            : `${txt(calc.perdaKg, 2)} kg · ${txt(peso > 0 ? (calc.perdaKg / peso) * 100 : 0, 1)}%`
                        }
                        alerta={calc.kgTotal > peso * 1.0005}
                      />
                    </div>
                  )}

                  <div style={{ overflowX: 'auto' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, minWidth: 460 }}>
                      <thead>
                        <tr style={{ textAlign: 'left', color: '#9A928B', fontSize: 11, textTransform: 'uppercase' }}>
                          <th style={th}>Corte</th>
                          <th style={{ ...th, textAlign: 'right' }}>Kg que saiu</th>
                          <th style={{ ...th, textAlign: 'right' }}>Vende hoje (R$/kg)</th>
                          <th style={th} />
                        </tr>
                      </thead>
                      <tbody>
                        {base.cortes.filter(vendavel).map((c) => {
                          const kg = (pesoVendavelCorte(c) * peso) / 100
                          return (
                            <tr key={c.id} style={{ borderTop: '1px solid #EFE9E1' }}>
                              <td style={td}>
                                <input
                                  value={c.nome}
                                  onChange={(e) => setCorte(c.id, { nome: e.target.value })}
                                  placeholder="Ex.: Coxão mole"
                                  style={{ ...inputCelula, minWidth: 170 }}
                                />
                              </td>
                              <td style={tdNum}>
                                <CampoDecimal
                                  valor={kg}
                                  casas={3}
                                  onCommit={(n) => setKg(c.id, n)}
                                  style={{ ...inputCelula, width: 84, textAlign: 'right', opacity: peso > 0 ? 1 : 0.5 }}
                                />
                              </td>
                              <td style={tdNum}>
                                <CampoDecimal
                                  valor={c.precoAtual ?? 0}
                                  onCommit={(n) => setPrecoHoje(c.id, n)}
                                  style={{
                                    ...inputCelula,
                                    width: 90,
                                    textAlign: 'right',
                                    borderColor: kg > 0 && !(c.precoAtual && c.precoAtual > 0) ? '#E0A030' : '#DED8D0',
                                  }}
                                />
                              </td>
                              <td style={td}>
                                <button
                                  type="button"
                                  onClick={() => patch({ cortes: base.cortes.filter((x) => x.id !== c.id) })}
                                  style={{ ...botaoMini, color: '#C1503F' }}
                                  title="Remover corte"
                                >
                                  ✕
                                </button>
                              </td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                  <p style={{ fontSize: 11, color: '#9A928B', margin: '8px 0 0' }}>
                    "Vende hoje" é o preço que o corte tem na bandeja agora — é ele que mostra o quanto cada corte vale em relação aos
                    outros na hora de dividir o custo.
                  </p>
                  <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
                    <button type="button" onClick={() => patch({ cortes: [...base.cortes, novoCorte()] })} style={botaoSecundario}>
                      + Adicionar corte
                    </button>
                    <button
                      type="button"
                      onClick={adicionarCortesPadrao}
                      style={botaoSecundario}
                      title="Acrescenta os 28 cortes do rateio oficial de vocês (código, peso proporcional e preço de hoje)"
                    >
                      + Cortes padrão (rateio oficial)
                    </button>
                  </div>
                  <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
                    <button type="button" onClick={() => irParaEtapa(1)} style={botaoSecundario}>
                      ← Voltar
                    </button>
                    <button
                      type="button"
                      onClick={() => irParaEtapa(3)}
                      style={{ ...botaoPrimario, flex: 1, opacity: temCortes ? 1 : 0.5 }}
                    >
                      Ver resultado →
                    </button>
                  </div>
                </Card>
              )}

              {etapa === 3 && (
                <>
                  <Card titulo="Etapa 3 de 3 · Resultado da sua precificação">
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 10 }}>
                      <CartaoResultado titulo="Investimento na compra" valor={brl(calc.investimento)} sub={`${txt(peso, 2)} kg a ${brl(calc.custoKg)}/kg`} />
                      <CartaoResultado
                        destaque
                        titulo="Faturamento previsto"
                        valor={brl(calc.faturamento)}
                        sub={`vendendo ${txt(calc.kgTotal, 2)} kg`}
                      />
                      <CartaoResultado
                        titulo="Lucro bruto"
                        valor={brl(calc.lucroBruto)}
                        sub={`${txt(calc.margemGeral, 1)}% sobre o custo`}
                        verde={calc.lucroBruto >= 0}
                        vermelho={calc.lucroBruto < 0}
                      />
                    </div>

                    <div
                      style={{
                        marginTop: 12,
                        padding: 12,
                        borderRadius: 10,
                        background: '#F4F1EC',
                        display: 'flex',
                        alignItems: 'center',
                        gap: 14,
                        flexWrap: 'wrap',
                      }}
                    >
                      <div>
                        <div style={{ fontSize: 11, color: '#9A928B', textTransform: 'uppercase' }}>Carne na compra</div>
                        <div style={{ fontSize: 20, fontWeight: 800 }}>{brl(calc.custoKg)}/kg</div>
                      </div>
                      <div style={{ fontSize: 22, color: '#C1503F' }}>→</div>
                      <div>
                        <div style={{ fontSize: 11, color: '#C1503F', textTransform: 'uppercase', fontWeight: 700 }}>
                          Custo real depois da desossa
                        </div>
                        <div style={{ fontSize: 24, fontWeight: 800, color: '#C1503F' }}>{brl(calc.custoReal)}/kg</div>
                      </div>
                      <p style={{ flex: '1 1 220px', margin: 0, fontSize: 12, color: '#7A716A' }}>
                        De {txt(peso, 2)} kg comprados sobraram {txt(calc.kgTotal, 2)} kg vendáveis ({txt(calc.perdaKg, 2)} kg de
                        osso e sebo). Por isso o kg que você vende custa mais do que você pagou.
                      </p>
                    </div>

                    {calc.linhas.some((l) => l.corte.travado) && (
                      <div
                        style={{
                          marginTop: 12,
                          padding: 12,
                          borderRadius: 10,
                          background: '#FFF4E5',
                          border: '1px solid #F0C98F',
                          display: 'flex',
                          alignItems: 'center',
                          gap: 10,
                          flexWrap: 'wrap',
                        }}
                      >
                        <p style={{ flex: '1 1 260px', margin: 0, fontSize: 13, color: '#8A4B0F' }}>
                          <strong>
                            {calc.linhas.filter((l) => l.corte.travado).length} de {calc.linhas.length} cortes estão com o preço mantido
                          </strong>{' '}
                          (coluna “Manter”): eles ficam no preço de hoje e não recalculam com o novo custo.
                        </p>
                        <button type="button" onClick={() => travarTodos(false)} style={botaoPrimario}>
                          Liberar todos e recalcular
                        </button>
                      </div>
                    )}

                    {calc.avisos.length > 0 && (
                      <ul style={{ margin: '10px 0 0', paddingLeft: 18, fontSize: 12, color: '#B25E1B' }}>
                        {calc.avisos.map((a) => (
                          <li key={a}>{a}</li>
                        ))}
                      </ul>
                    )}
                  </Card>

                  <Card
                    titulo="Resultado por produto"
                    dica="O preço sugerido já divide o custo conforme o valor de cada corte e fecha a margem pedida. Digite em “Vou cobrar” o preço que você pretende praticar pra ver o lucro e a margem."
                  >
                    <div style={{ overflowX: 'auto' }}>
                      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, minWidth: 760 }}>
                        <thead>
                          <tr style={{ textAlign: 'left', color: '#9A928B', fontSize: 11, textTransform: 'uppercase' }}>
                            <th style={th}>Corte</th>
                            <th style={{ ...th, textAlign: 'right' }}>Custo/kg</th>
                            <th style={{ ...th, textAlign: 'right' }}>Preço sugerido</th>
                            <th style={{ ...th, textAlign: 'right' }}>Vou cobrar</th>
                            <th style={{ ...th, textAlign: 'right' }}>Lucro/kg</th>
                            <th style={{ ...th, textAlign: 'right' }}>Margem</th>
                            <th style={{ ...th, textAlign: 'right' }}>Hoje</th>
                            <th style={{ ...th, textAlign: 'center' }} title="Marque pra não recalcular esse preço">
                              Manter
                            </th>
                            <th style={th} />
                          </tr>
                        </thead>
                        <tbody>
                          {calc.linhas.map((l) => {
                            const c = l.corte
                            const sobe = (l.variacao ?? 0) > 0
                            const mudou = precoPraticado[c.id] !== undefined
                            return (
                              <tr key={c.id} style={{ borderTop: '1px solid #EFE9E1' }}>
                                <td style={td}>
                                  <div style={{ fontWeight: 700 }}>{c.nome}</div>
                                  <div style={{ fontSize: 11, color: '#9A928B' }}>
                                    {txt(l.kg, 3)} kg{c.codigo ? ` · cód. ${c.codigo}` : ''}
                                  </div>
                                  {!(c.precoAtual && c.precoAtual > 0) && !c.travado && (
                                    <div style={{ fontSize: 11, color: '#B25E1B' }}>sem preço de hoje: usei o valor médio do boi</div>
                                  )}
                                </td>
                                <td style={tdNum}>{brl(l.custo)}</td>
                                <td style={{ ...tdNum, fontWeight: 800 }}>{brl(l.sugerido)}</td>
                                <td style={tdNum}>
                                  <CampoDecimal
                                    valor={l.usado}
                                    onCommit={(n) => setPrecoPraticado((p) => ({ ...p, [c.id]: n }))}
                                    style={{
                                      ...inputCelula,
                                      width: 88,
                                      textAlign: 'right',
                                      fontWeight: 800,
                                      borderColor: mudou ? '#C1503F' : '#DED8D0',
                                    }}
                                  />
                                </td>
                                <td style={{ ...tdNum, color: l.lucro >= 0 ? '#1F7A43' : '#C1503F', fontWeight: 700 }}>{brl(l.lucro)}</td>
                                <td style={{ ...tdNum, color: l.margem >= base.margem - 0.5 ? '#1F7A43' : '#B25E1B', fontWeight: 700 }}>
                                  {txt(l.margem, 1)}%
                                </td>
                                <td style={{ ...tdNum, color: l.variacao == null ? '#9A928B' : sobe ? '#1F7A43' : '#C1503F' }}>
                                  {c.precoAtual ? brl(c.precoAtual) : '—'}
                                  {l.variacao != null && l.variacao !== 0 && (
                                    <div style={{ fontSize: 11 }}>
                                      {sobe ? '+' : ''}
                                      {txt(l.variacao)}
                                    </div>
                                  )}
                                </td>
                                <td style={{ ...td, textAlign: 'center' }}>
                                  <input
                                    type="checkbox"
                                    checked={Boolean(c.travado)}
                                    onChange={(e) => setCorte(c.id, { travado: e.target.checked })}
                                    title="Preço fixo: não recalcula e os outros cortes compensam"
                                  />
                                </td>
                                <td style={td}>
                                  <Link
                                    to={`/mercadonunes?produto=${encodeURIComponent(c.nome)}&preco=${txt(l.usado)}`}
                                    style={{ ...botaoMini, textDecoration: 'none' }}
                                    title="Gerar plaquinha com esse preço"
                                  >
                                    🏷️
                                  </Link>
                                </td>
                              </tr>
                            )
                          })}
                        </tbody>
                      </table>
                    </div>
                    <p style={{ fontSize: 11, color: '#9A928B', margin: '8px 0 0' }}>
                      Margem = lucro ÷ custo do corte. A margem pedida na etapa 1 é de {txt(base.margem, 1)}%.
                    </p>
                    <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
                      <button type="button" onClick={() => travarTodos(true)} style={botaoSecundario} title="Mantém o preço de hoje em todos os cortes (nenhum é recalculado)">
                        🔒 Manter todos
                      </button>
                      <button type="button" onClick={() => travarTodos(false)} style={botaoSecundario} title="Libera todos os cortes pra recalcular">
                        🔓 Liberar todos
                      </button>
                      {Object.keys(precoPraticado).length > 0 && (
                        <button type="button" onClick={() => setPrecoPraticado({})} style={botaoSecundario}>
                          ↺ Voltar aos preços sugeridos
                        </button>
                      )}
                    </div>
                  </Card>

                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    <button type="button" onClick={() => irParaEtapa(2)} style={botaoSecundario}>
                      ← Ajustar cortes
                    </button>
                    <button type="button" onClick={aplicar} style={botaoPrimario}>
                      ✅ Aplicar preços
                    </button>
                    <button type="button" onClick={exportarCsv} style={botaoSecundario}>
                      ⬇️ Exportar CSV
                    </button>
                    <button type="button" onClick={historico ? () => setHistorico(null) : abrirHistorico} style={botaoSecundario}>
                      🕘 {historico ? 'Fechar histórico' : 'Histórico'}
                    </button>
                  </div>

                  {historico && (
                    <Card titulo="Histórico de aplicações">
                      {historico.length === 0 ? (
                        <p style={{ fontSize: 13, color: '#7A716A', margin: 0 }}>Nenhuma aplicação ainda.</p>
                      ) : (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                          {historico.map((h) => (
                            <div key={h.id} style={{ fontSize: 13, color: '#5B534D' }}>
                              <strong>{new Date(h.createdAt).toLocaleString('pt-BR')}</strong> · custo {brl(h.custoKg)}/kg ·
                              margem {txt(h.margem, 1)}% · {h.cortes.length} corte(s)
                              {h.usuario ? ` · ${h.usuario}` : ''}
                            </div>
                          ))}
                        </div>
                      )}
                    </Card>
                  )}
                </>
              )}
            </>
          )}
        </div>
      )}

      {painelAcessos && <PainelAcessos usuarioId={usuario.id} onFechar={() => setPainelAcessos(false)} />}
    </Moldura>
  )
}

/** Peso vendável de um corte em 100 kg de carcaça (participação menos a quebra) — espelha o motor de cálculo. */
function pesoVendavelCorte(c: Corte): number {
  const q = Math.min(95, Math.max(0, Number(c.quebra) || 0))
  return (Number(c.participacao) || 0) * (1 - q / 100)
}

function CartaoResultado({
  titulo,
  valor,
  sub,
  destaque,
  verde,
  vermelho,
}: {
  titulo: string
  valor: string
  sub?: string
  destaque?: boolean
  verde?: boolean
  vermelho?: boolean
}) {
  return (
    <div
      style={{
        borderRadius: 12,
        padding: 14,
        background: destaque ? '#C1503F' : '#F4F1EC',
        color: destaque ? '#fff' : '#2A2622',
      }}
    >
      <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.4, opacity: destaque ? 0.85 : 0.6 }}>{titulo}</div>
      <div style={{ fontSize: 24, fontWeight: 800, color: destaque ? '#fff' : verde ? '#1F7A43' : vermelho ? '#C1503F' : '#2A2622' }}>
        {valor}
      </div>
      {sub && <div style={{ fontSize: 12, opacity: destaque ? 0.85 : 0.6 }}>{sub}</div>}
    </div>
  )
}

// ── Acessos (quem pode entrar) ────────────────────────────────────────────────

function PainelAcessos({ usuarioId, onFechar }: { usuarioId: string; onFechar: () => void }) {
  const [lista, setLista] = React.useState<AcougueUsuario[]>([])
  const [email, setEmail] = React.useState('')
  const [nome, setNome] = React.useState('')
  const [senha, setSenha] = React.useState('')

  const recarregar = () => acougueApi.usuarios().then(setLista).catch(() => setLista([]))
  React.useEffect(() => {
    void recarregar()
  }, [])

  const criar = async (e: React.FormEvent) => {
    e.preventDefault()
    try {
      await acougueApi.criarUsuario(email.trim(), nome.trim(), senha)
      setEmail('')
      setNome('')
      setSenha('')
      await recarregar()
      toast.success('Acesso criado')
    } catch (err) {
      toast.error((err as Error).message)
    }
  }

  return (
    <div
      role="dialog"
      aria-modal
      onClick={onFechar}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.35)',
        display: 'grid',
        placeItems: 'center',
        padding: 16,
        zIndex: 50,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ background: '#fff', borderRadius: 12, padding: 18, width: 'min(460px, 100%)', maxHeight: '86vh', overflowY: 'auto' }}
      >
        <div style={{ display: 'flex', alignItems: 'center', marginBottom: 10 }}>
          <h2 style={{ fontSize: 15, fontWeight: 800, margin: 0, flex: 1 }}>Quem pode entrar</h2>
          <button type="button" onClick={onFechar} style={botaoMini}>
            Fechar
          </button>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 14 }}>
          {lista.map((u) => (
            <div key={u.id} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
              <span style={{ flex: 1 }}>
                {u.nome ? `${u.nome} · ` : ''}
                {u.email}
              </span>
              {u.id !== usuarioId && (
                <button
                  type="button"
                  onClick={async () => {
                    if (!window.confirm(`Remover o acesso de ${u.email}?`)) return
                    try {
                      await acougueApi.removerUsuario(u.id)
                      await recarregar()
                    } catch (err) {
                      toast.error((err as Error).message)
                    }
                  }}
                  style={{ ...botaoMini, color: '#C1503F' }}
                >
                  Remover
                </button>
              )}
            </div>
          ))}
        </div>
        <form onSubmit={criar} style={{ display: 'flex', flexDirection: 'column', gap: 8, borderTop: '1px solid #EFE9E1', paddingTop: 12 }}>
          <strong style={{ fontSize: 13 }}>Novo acesso</strong>
          <input value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Nome" style={inputEstilo} />
          <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="E-mail" type="email" style={inputEstilo} required />
          <input
            value={senha}
            onChange={(e) => setSenha(e.target.value)}
            placeholder="Senha (mín. 6)"
            type="password"
            style={inputEstilo}
            required
          />
          <button type="submit" style={botaoPrimario}>
            Criar acesso
          </button>
        </form>
      </div>
    </div>
  )
}

// ── Pecinhas ──────────────────────────────────────────────────────────────────

function Card({ titulo, dica, children }: { titulo?: string; dica?: string; children: React.ReactNode }) {
  return (
    <section style={{ background: '#fff', border: '1px solid #E7E1D9', borderRadius: 12, padding: 14 }}>
      {titulo && (
        <h2 style={{ fontSize: 12, fontWeight: 800, textTransform: 'uppercase', letterSpacing: 0.6, color: '#C1503F', margin: '0 0 4px' }}>
          {titulo}
        </h2>
      )}
      {dica && <p style={{ fontSize: 11, color: '#9A928B', margin: '0 0 10px' }}>{dica}</p>}
      {children}
    </section>
  )
}

function Campo({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: 'block' }}>
      <span style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#5B534D', marginBottom: 4 }}>{label}</span>
      {children}
    </label>
  )
}

function Numero({ titulo, valor, alerta }: { titulo: string; valor: string; alerta?: boolean }) {
  return (
    <div>
      <div style={{ fontSize: 11, color: '#9A928B', textTransform: 'uppercase', letterSpacing: 0.4 }}>{titulo}</div>
      <div style={{ fontSize: 17, fontWeight: 800, color: alerta ? '#B25E1B' : '#2A2622' }}>{valor}</div>
    </div>
  )
}

/**
 * Campo numérico com vírgula decimal (participação, quebra, índice, preço hoje). Tem estado próprio
 * do texto digitado — antes o valor exibido vinha direto de `txt(numero)`, recalculado a cada tecla;
 * ao digitar a vírgula, `num("43,")` virava 0 e o campo "voltava" pra "0" na hora, sem deixar
 * terminar de digitar a casa decimal. Enquanto o campo está em foco, mostra exatamente o que a
 * pessoa digitou; só reformata (2 casas, vírgula) ao sair do campo.
 */
function CampoDecimal({ valor, onCommit, casas = 2, style }: {
  valor: number
  onCommit: (n: number) => void
  casas?: number
  style?: React.CSSProperties
}) {
  const [raw, setRaw] = React.useState(() => txt(valor, casas))
  const focado = React.useRef(false)

  React.useEffect(() => {
    if (!focado.current) setRaw(txt(valor, casas))
  }, [valor, casas])

  return (
    <input
      inputMode="decimal"
      value={raw}
      onFocus={() => { focado.current = true }}
      onChange={(e) => {
        const v = e.target.value.replace(/[^0-9,.-]/g, '')
        setRaw(v)
        onCommit(num(v))
      }}
      onBlur={() => {
        focado.current = false
        setRaw(txt(num(raw), casas))
      }}
      style={style}
    />
  )
}

const th: React.CSSProperties = { padding: '6px 6px', fontWeight: 700 }
const td: React.CSSProperties = { padding: '6px 6px', verticalAlign: 'middle' }
const tdNum: React.CSSProperties = { ...td, textAlign: 'right', whiteSpace: 'nowrap' }

const inputEstilo: React.CSSProperties = {
  width: '100%',
  boxSizing: 'border-box',
  border: '1px solid #DED8D0',
  borderRadius: 8,
  padding: '10px',
  fontSize: 16,
  color: '#2A2622',
  background: '#fff',
}

const inputCelula: React.CSSProperties = {
  ...inputEstilo,
  padding: '6px 8px',
  fontSize: 14,
  borderRadius: 6,
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
  padding: '6px 10px',
  fontSize: 12,
  fontWeight: 600,
  cursor: 'pointer',
}
