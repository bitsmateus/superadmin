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
              Digite o preço da carcaça e os cortes se ajustam sozinhos.
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

// ── Tela principal ────────────────────────────────────────────────────────────

function Rateio({ usuario, onSair }: { usuario: AcougueUsuario; onSair: () => void }) {
  const [bases, setBases] = React.useState<AcougueBase[]>([])
  const [baseId, setBaseId] = React.useState<string | null>(null)
  const [carregando, setCarregando] = React.useState(true)
  const [salvando, setSalvando] = React.useState(false)
  const [historico, setHistorico] = React.useState<AcougueHistorico[] | null>(null)
  const [painelAcessos, setPainelAcessos] = React.useState(false)

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
  const [sujo, setSujo] = React.useState(false)

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

  const resultado = React.useMemo(
    () =>
      base
        ? calcularRateio(
            {
              unidade: base.unidade,
              custo: base.custo,
              pesoPeca: base.pesoPeca ?? undefined,
              margem: base.margem,
              arredondamento: base.arredondamento,
            },
            base.cortes,
          )
        : null,
    [base],
  )

  const criarBase = async () => {
    const nome = window.prompt('Nome da base (ex.: Boi desossado, Boi campo, Suíno)')?.trim()
    if (!nome) return
    try {
      const nova = await acougueApi.criarBase(nome)
      setBases((l) => [...l, nova].sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR')))
      setBaseId(nova.id)
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

  const calcularIndices = () => {
    if (!base) return
    const r = derivarIndices(
      { unidade: base.unidade, custo: base.custo, pesoPeca: base.pesoPeca ?? undefined, margem: base.margem },
      base.cortes,
    )
    if (r.erro) {
      toast.error(r.erro)
      return
    }
    patch({ cortes: r.cortes, margem: r.margem })
    toast.success(`Índices calculados · margem praticada hoje: ${txt(r.margem, 1)}%`)
  }

  const aplicar = async () => {
    if (!base || !resultado) return
    const cortes = base.cortes.map((c) => {
      const calc = resultado.cortes.find((x) => x.id === c.id)
      return calc ? { ...c, precoAtual: calc.precoNovo } : c
    })
    try {
      await acougueApi.aplicar(base.id, cortes, resultado.custoKg, base.margem)
      setBases((l) => l.map((b) => (b.id === base.id ? { ...b, cortes } : b)))
      setSujo(false)
      toast.success('Preços aplicados — agora eles são os preços atuais')
    } catch (err) {
      if (!semSessao(err)) toast.error((err as Error).message)
    }
  }

  const exportarCsv = () => {
    if (!base || !resultado) return
    const linhas = [
      'codigo;produto;preco_novo;preco_anterior;participacao_pct;indice',
      ...resultado.cortes.map((c) =>
        [
          c.codigo ?? '',
          c.nome,
          txt(c.precoNovo),
          txt(c.precoAtual ?? 0),
          txt(c.participacao),
          txt(c.indice, 4),
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
                Crie a primeira base (ex.: <strong>Boi desossado</strong>), cadastre os cortes com os preços que você já
                pratica e clique em <strong>Calcular índices pelos preços de hoje</strong>. Depois é só mudar o preço do
                boi.
              </p>
            )}
          </Card>

          {base && resultado && (
            <>
              {/* Custo da carcaça */}
              <Card titulo="Preço da carcaça">
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
                <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 10 }}>
                  <Campo label={base.unidade === 'arroba' ? 'R$ por arroba' : base.unidade === 'peca' ? 'R$ pago na peça' : 'R$ por kg'}>
                    <input
                      inputMode="decimal"
                      value={txt(base.custo)}
                      onChange={(e) => patch({ custo: num(e.target.value) })}
                      style={{ ...inputEstilo, width: 140 }}
                    />
                  </Campo>
                  {base.unidade === 'peca' && (
                    <Campo label="Peso da peça (kg)">
                      <input
                        inputMode="decimal"
                        value={txt(base.pesoPeca ?? 0)}
                        onChange={(e) => patch({ pesoPeca: num(e.target.value) })}
                        style={{ ...inputEstilo, width: 120 }}
                      />
                    </Campo>
                  )}
                  <Campo label="Margem sobre o custo (%)">
                    <input
                      inputMode="decimal"
                      value={txt(base.margem)}
                      onChange={(e) => patch({ margem: num(e.target.value) })}
                      style={{ ...inputEstilo, width: 110 }}
                    />
                  </Campo>
                  <Campo label="Arredondar">
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

                <div
                  style={{
                    display: 'flex',
                    gap: 16,
                    flexWrap: 'wrap',
                    marginTop: 12,
                    paddingTop: 12,
                    borderTop: '1px solid #EFE9E1',
                  }}
                >
                  <Numero titulo="Custo por kg" valor={brl(resultado.custoKg)} />
                  <Numero titulo="Preço médio do kg" valor={brl(resultado.precoMedio)} />
                  <Numero titulo="Receita do boi (100 kg)" valor={brl(resultado.receitaReal)} />
                  <Numero
                    titulo="Margem real"
                    valor={`${txt(resultado.margemReal, 1)}%`}
                    alerta={Math.abs(resultado.margemReal - base.margem) > 1.5}
                  />
                  <Numero
                    titulo="Peso dos cortes"
                    valor={`${txt(resultado.participacaoTotal, 1)}%`}
                    alerta={resultado.participacaoTotal > 100.5 || resultado.participacaoTotal < 80}
                  />
                </div>

                {resultado.avisos.length > 0 && (
                  <ul style={{ margin: '10px 0 0', paddingLeft: 18, fontSize: 12, color: '#B25E1B' }}>
                    {resultado.avisos.map((a) => (
                      <li key={a}>{a}</li>
                    ))}
                  </ul>
                )}
              </Card>

              {/* Ações */}
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <button type="button" onClick={calcularIndices} style={botaoSecundario}>
                  📐 Calcular índices pelos preços de hoje
                </button>
                <button type="button" onClick={aplicar} style={botaoPrimario}>
                  ✅ Aplicar preços novos
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

              {/* Cortes */}
              <Card
                titulo="Cortes"
                dica="Participação = quanto o corte representa do peso da carcaça. Índice = quanto ele vale em relação à média (1 = na média)."
              >
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, minWidth: 900 }}>
                    <thead>
                      <tr style={{ textAlign: 'left', color: '#9A928B', fontSize: 11, textTransform: 'uppercase' }}>
                        <th style={th}>Corte</th>
                        <th style={th}>Código</th>
                        <th style={{ ...th, textAlign: 'right' }}>Part. %</th>
                        <th style={{ ...th, textAlign: 'right' }}>Quebra %</th>
                        <th style={{ ...th, textAlign: 'right' }}>Índice</th>
                        <th style={{ ...th, textAlign: 'right' }}>Preço hoje</th>
                        <th style={{ ...th, textAlign: 'center' }}>Travar</th>
                        <th style={{ ...th, textAlign: 'right' }}>Preço novo</th>
                        <th style={{ ...th, textAlign: 'right' }}>Variação</th>
                        <th style={th} />
                      </tr>
                    </thead>
                    <tbody>
                      {base.cortes.map((c) => {
                        const calc = resultado.cortes.find((x) => x.id === c.id)
                        const sobe = (calc?.variacao ?? 0) > 0
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
                            <td style={td}>
                              <input
                                value={c.codigo ?? ''}
                                onChange={(e) => setCorte(c.id, { codigo: e.target.value })}
                                placeholder="110261"
                                style={{ ...inputCelula, width: 90 }}
                              />
                            </td>
                            <td style={tdNum}>
                              <input
                                inputMode="decimal"
                                value={txt(c.participacao)}
                                onChange={(e) => setCorte(c.id, { participacao: num(e.target.value) })}
                                style={{ ...inputCelula, width: 70, textAlign: 'right' }}
                              />
                            </td>
                            <td style={tdNum}>
                              <input
                                inputMode="decimal"
                                value={txt(c.quebra ?? 0)}
                                onChange={(e) => setCorte(c.id, { quebra: num(e.target.value) })}
                                style={{ ...inputCelula, width: 62, textAlign: 'right' }}
                              />
                            </td>
                            <td style={tdNum}>
                              <input
                                inputMode="decimal"
                                value={txt(c.indice, 4)}
                                onChange={(e) => setCorte(c.id, { indice: num(e.target.value) })}
                                style={{ ...inputCelula, width: 70, textAlign: 'right' }}
                              />
                            </td>
                            <td style={tdNum}>
                              <input
                                inputMode="decimal"
                                value={txt(c.precoAtual ?? 0)}
                                onChange={(e) => setCorte(c.id, { precoAtual: num(e.target.value) })}
                                style={{ ...inputCelula, width: 84, textAlign: 'right' }}
                              />
                            </td>
                            <td style={{ ...td, textAlign: 'center' }}>
                              <input
                                type="checkbox"
                                checked={Boolean(c.travado)}
                                onChange={(e) => setCorte(c.id, { travado: e.target.checked })}
                                title="Preço fixo: não recalcula e o resto compensa"
                              />
                            </td>
                            <td style={{ ...tdNum, fontWeight: 800, fontSize: 15 }}>{brl(calc?.precoNovo ?? 0)}</td>
                            <td style={{ ...tdNum, color: calc?.variacao == null ? '#9A928B' : sobe ? '#1F7A43' : '#C1503F' }}>
                              {calc?.variacao == null
                                ? '—'
                                : `${sobe ? '+' : ''}${txt(calc.variacao)} (${sobe ? '+' : ''}${txt(calc.variacaoPct ?? 0, 1)}%)`}
                            </td>
                            <td style={td}>
                              <div style={{ display: 'flex', gap: 4 }}>
                                <Link
                                  to={`/mercadonunes?produto=${encodeURIComponent(c.nome)}&preco=${txt(calc?.precoNovo ?? 0)}`}
                                  style={{ ...botaoMini, textDecoration: 'none' }}
                                  title="Gerar plaquinha com esse preço"
                                >
                                  🏷️
                                </Link>
                                <button
                                  type="button"
                                  onClick={() => patch({ cortes: base.cortes.filter((x) => x.id !== c.id) })}
                                  style={{ ...botaoMini, color: '#C1503F' }}
                                  title="Remover corte"
                                >
                                  ✕
                                </button>
                              </div>
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
                <button
                  type="button"
                  onClick={() => patch({ cortes: [...base.cortes, novoCorte()] })}
                  style={{ ...botaoSecundario, marginTop: 10, alignSelf: 'flex-start' }}
                >
                  + Adicionar corte
                </button>
              </Card>
            </>
          )}
        </div>
      )}

      {painelAcessos && <PainelAcessos usuarioId={usuario.id} onFechar={() => setPainelAcessos(false)} />}
    </Moldura>
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
