import * as React from 'react'
import { useParams } from 'react-router-dom'
import {
  ArrowLeft, ArrowRight, Building2, Check, CheckCircle2, CreditCard, Eye, EyeOff, FileText, ImagePlus, KeyRound, Loader2,
  MessageCircleQuestion, Send, Upload, X,
} from 'lucide-react'
import { gestaoClientes, type GcBriefingPublico } from '@/services/gestaoClientes'
import { BRIEFING_MODELO } from '@/lib/gcBriefingModelo'
import logoNx from '@/assets/logo-nx.jpg'

/** Mesmo fundo do briefing do Suporte e da ficha de cadastro. */
const FUNDO = 'linear-gradient(135deg, #1E1B6B 0%, #2B2FB5 55%, #2F5BFF 100%)'
const MAX_BYTES = 5 * 1024 * 1024

// ---------------------------------------------------------------------------------------------------
// As etapas do formulário
// ---------------------------------------------------------------------------------------------------

/** Os blocos de perguntas, na ordem do modelo: cada bloco vira uma página. */
const BLOCOS = Array.from(new Set(BRIEFING_MODELO.map((p) => p.bloco)))

type Etapa =
  | { tipo: 'empresa' }
  | { tipo: 'acessos' }
  | { tipo: 'contas' }
  | { tipo: 'perguntas'; bloco: string }
  | { tipo: 'materiais' }
  | { tipo: 'revisao' }

const ETAPAS: Etapa[] = [
  { tipo: 'empresa' },
  { tipo: 'acessos' },
  { tipo: 'contas' },
  ...BLOCOS.map((bloco) => ({ tipo: 'perguntas' as const, bloco })),
  { tipo: 'materiais' },
  { tipo: 'revisao' },
]

/** "Bloco 1 — Negócio e oferta" → "Negócio e oferta". */
const tituloDoBloco = (bloco: string) => bloco.replace(/^Bloco\s+\d+\s+—\s+/, '')

function tituloDaEtapa(e: Etapa): string {
  switch (e.tipo) {
    case 'empresa': return 'Sua empresa'
    case 'acessos': return 'Acessos'
    case 'contas': return 'Contas e pagamento'
    case 'perguntas': return tituloDoBloco(e.bloco)
    case 'materiais': return 'Fotos, vídeos e materiais'
    case 'revisao': return 'Revisar e enviar'
  }
}

const CHECKLIST: { chave: string; obs: string; pergunta: string; dica: string }[] = [
  { chave: 'pagamento_anuncios', obs: 'pagamento_obs', pergunta: 'Você tem uma forma de pagamento válida na conta de anúncios?', dica: 'Ex.: cartão final 1234, boleto, pix…' },
  { chave: 'google_ads', obs: 'google_ads_obs', pergunta: 'Você tem conta no Google Ads?', dica: 'ID da conta ou e-mail de acesso' },
  { chave: 'analytics', obs: 'analytics_obs', pergunta: 'Você tem Google Analytics?', dica: 'ID da propriedade ou e-mail de acesso' },
  { chave: 'tag_manager', obs: 'tag_manager_obs', pergunta: 'Você tem Google Tag Manager?', dica: 'ID do contêiner (GTM-…) ou e-mail de acesso' },
  { chave: 'meu_negocio', obs: 'meu_negocio_obs', pergunta: 'Sua empresa está no Google Meu Negócio?', dica: 'Link do perfil ou e-mail de acesso' },
]

const RESPOSTAS = [
  { valor: 'sim', rotulo: 'Sim', cor: 'border-emerald-500 bg-emerald-50 text-emerald-700' },
  { valor: 'nao', rotulo: 'Não', cor: 'border-rose-500 bg-rose-50 text-rose-700' },
  { valor: 'nao_sei', rotulo: 'Não sei', cor: 'border-amber-500 bg-amber-50 text-amber-700' },
]

// ---------------------------------------------------------------------------------------------------
// Peças do formulário (visual claro, sobre o cartão branco)
// ---------------------------------------------------------------------------------------------------

function Campo({ rotulo, ajuda, children }: { rotulo: string; ajuda?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-sm font-medium text-slate-700">{rotulo}</span>
      {children}
      {ajuda && <span className="mt-1 block text-xs text-slate-500">{ajuda}</span>}
    </label>
  )
}

const CLASSE_INPUT =
  'h-11 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-800 outline-none placeholder:text-slate-400 focus:border-[#2F5BFF] focus:ring-2 focus:ring-[#2F5BFF]/20'

function Texto({ value, onChange, placeholder, inputMode }: { value: string; onChange: (v: string) => void; placeholder?: string; inputMode?: 'tel' | 'email' | 'url' }) {
  return <input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} inputMode={inputMode} className={CLASSE_INPUT} />
}

function Senha({ value, onChange, temSalva }: { value: string; onChange: (v: string) => void; temSalva: boolean }) {
  const [visivel, setVisivel] = React.useState(false)
  return (
    <span className="relative block">
      <input
        type={visivel ? 'text' : 'password'}
        autoComplete="new-password"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={temSalva ? 'Já enviada — deixe em branco pra manter' : ''}
        className={CLASSE_INPUT + ' pr-11'}
      />
      <button
        type="button"
        onClick={() => setVisivel((v) => !v)}
        className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1.5 text-slate-400 hover:text-slate-700"
        aria-label={visivel ? 'Esconder a senha' : 'Mostrar a senha'}
      >
        {visivel ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
      </button>
    </span>
  )
}

function lerArquivo(arquivo: File): Promise<{ id: string; name: string; type: string; size: number; dataUrl: string }> {
  return new Promise((resolve, reject) => {
    const leitor = new FileReader()
    leitor.onload = () =>
      resolve({ id: crypto.randomUUID(), name: arquivo.name || 'arquivo', type: arquivo.type, size: arquivo.size, dataUrl: leitor.result as string })
    leitor.onerror = reject
    leitor.readAsDataURL(arquivo)
  })
}

function tamanho(bytes: number | null): string {
  if (!bytes) return ''
  return bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

// ---------------------------------------------------------------------------------------------------
// Página
// ---------------------------------------------------------------------------------------------------

type Senhas = { instagram_senha: string; facebook_senha: string; crm_senha: string }

/**
 * Briefing do cliente NX DIGITAL, preenchido PELO CLIENTE num link público. Em etapas: empresa, acessos,
 * contas e pagamento, as 27 perguntas (um bloco por página), materiais e revisão. Cada etapa salva ao avançar,
 * então dá pra parar e continuar depois pelo mesmo link.
 */
export function BriefingNxPublicPage() {
  const { token = '' } = useParams<{ token: string }>()
  const [dados, setDados] = React.useState<GcBriefingPublico | null>(null)
  const [erro, setErro] = React.useState('')
  const [tela, setTela] = React.useState<'boas-vindas' | 'form' | 'enviado'>('boas-vindas')
  const [passo, setPasso] = React.useState(0)
  const [campos, setCampos] = React.useState<Record<string, string>>({})
  const [senhas, setSenhas] = React.useState<Senhas>({ instagram_senha: '', facebook_senha: '', crm_senha: '' })
  const [respostas, setRespostas] = React.useState<Record<string, string>>({})
  const [linkMateriais, setLinkMateriais] = React.useState('')
  const [arquivos, setArquivos] = React.useState<GcBriefingPublico['arquivos']>([])
  const [logo, setLogo] = React.useState<string | null>(null)
  const [salvando, setSalvando] = React.useState(false)
  const [enviandoArquivo, setEnviandoArquivo] = React.useState(false)
  const [aviso, setAviso] = React.useState('')
  const inputArquivos = React.useRef<HTMLInputElement>(null)
  const inputLogo = React.useRef<HTMLInputElement>(null)

  React.useEffect(() => {
    gestaoClientes
      .briefingPublico(token)
      .then((d) => {
        setDados(d)
        setCampos(d.campos)
        setRespostas(Object.fromEntries(d.perguntas.map((p) => [p.pergunta, p.resposta])))
        setLinkMateriais(d.link_materiais)
        setArquivos(d.arquivos)
        setLogo(d.cliente.logo_url)
      })
      .catch((e: Error) => setErro(e.message || 'Link inválido'))
  }, [token])

  const mudar = (chave: string, valor: string) => setCampos((c) => ({ ...c, [chave]: valor }))

  /** Salva tudo que está na tela (as senhas só vão se foram digitadas). */
  const salvar = async (): Promise<boolean> => {
    setSalvando(true)
    setAviso('')
    try {
      await gestaoClientes.salvarBriefingPublico(token, {
        campos: { ...campos, ...senhas },
        perguntas: BRIEFING_MODELO.map((p) => ({ pergunta: p.pergunta, resposta: respostas[p.pergunta] ?? '' })),
        link_materiais: linkMateriais,
      })
      return true
    } catch (e) {
      setAviso('Não consegui salvar: ' + (e as Error).message)
      return false
    } finally {
      setSalvando(false)
    }
  }

  const ir = async (novo: number) => {
    if (!(await salvar())) return
    setPasso(Math.max(0, Math.min(ETAPAS.length - 1, novo)))
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const enviar = async () => {
    if (!(await salvar())) return
    setSalvando(true)
    try {
      await gestaoClientes.enviarBriefingPublico(token)
      setTela('enviado')
      window.scrollTo({ top: 0 })
    } catch (e) {
      setAviso('Não consegui enviar: ' + (e as Error).message)
    } finally {
      setSalvando(false)
    }
  }

  const subirArquivos = async (lista: File[]) => {
    if (!lista.length) return
    setEnviandoArquivo(true)
    setAviso('')
    try {
      for (const arquivo of lista) {
        if (arquivo.size > MAX_BYTES) {
          setAviso(`"${arquivo.name}" passa de 5MB. Arquivos grandes: coloque numa pasta do Drive e cole o link abaixo.`)
          continue
        }
        const criado = await gestaoClientes.enviarArquivoBriefing(token, await lerArquivo(arquivo))
        setArquivos((a) => [...a, criado])
      }
    } catch (e) {
      setAviso('Não consegui enviar o arquivo: ' + (e as Error).message)
    } finally {
      setEnviandoArquivo(false)
    }
  }

  const subirLogo = async (arquivo: File | undefined) => {
    if (!arquivo) return
    if (!arquivo.type.startsWith('image/')) return setAviso('A logo precisa ser uma imagem (PNG ou JPG).')
    if (arquivo.size > MAX_BYTES) return setAviso('A logo passa de 5MB.')
    setEnviandoArquivo(true)
    setAviso('')
    try {
      const r = await gestaoClientes.enviarLogoBriefing(token, await lerArquivo(arquivo))
      setLogo(r.logo_url)
    } catch (e) {
      setAviso('Não consegui enviar a logo: ' + (e as Error).message)
    } finally {
      setEnviandoArquivo(false)
    }
  }

  // ------------------------------------------------------------------ telas de borda
  if (erro) {
    return (
      <div className="grid min-h-screen place-items-center p-6 text-center" style={{ background: FUNDO }}>
        <div className="max-w-md rounded-2xl bg-white p-8 shadow-xl">
          <h1 className="text-xl font-bold text-slate-800">Link indisponível</h1>
          <p className="mt-2 text-sm text-slate-500">Esse endereço não está mais válido. Fale com a equipe da NX pra receber um link novo.</p>
        </div>
      </div>
    )
  }
  if (!dados) {
    return (
      <div className="grid min-h-screen place-items-center text-sm text-white" style={{ background: FUNDO }}>
        <span className="inline-flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin" /> Carregando…</span>
      </div>
    )
  }

  if (tela === 'boas-vindas') {
    return (
      <div className="min-h-screen w-full px-4 py-10" style={{ background: FUNDO }}>
        <div className="mx-auto max-w-2xl">
          <div className="rounded-2xl bg-white p-6 shadow-xl sm:p-8">
            <img src={logoNx} alt="Grupo NX Digital" className="mb-4 h-14 w-14 rounded-2xl object-cover shadow-sm" />
            <h1 className="text-2xl font-bold text-slate-800 sm:text-3xl">Briefing de boas-vindas</h1>
            <p className="mt-1 text-sm font-medium text-[#2F5BFF]">{dados.cliente.nome_empresa}</p>
            {dados.enviado_em && (
              <p className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
                Você já enviou este briefing em {new Date(dados.enviado_em).toLocaleDateString('pt-BR')}. Pode abrir de novo pra completar ou corrigir.
              </p>
            )}
            <p className="mt-4 text-sm font-semibold text-slate-700">Leva em média de 15 a 20 minutos. 🕐</p>
            <p className="mt-3 text-sm leading-relaxed text-slate-500">
              São {ETAPAS.length} etapas curtas. Suas respostas são salvas a cada etapa: se precisar parar, é só voltar neste mesmo link e continuar de onde parou.
            </p>
            <p className="mt-3 text-sm leading-relaxed text-slate-500">
              É com essas informações que vamos montar a estratégia e as campanhas da sua empresa. Quanto mais completo, melhor o resultado — e se não souber alguma resposta, tudo bem: marque “Não sei”, isso também nos ajuda.
            </p>
            <button
              type="button"
              onClick={() => setTela('form')}
              className="mt-6 inline-flex items-center gap-2 rounded-lg bg-[#2F5BFF] px-5 py-3 text-sm font-semibold uppercase tracking-wide text-white hover:bg-[#2348d8]"
            >
              {dados.enviado_em ? 'Abrir o briefing' : 'Começar'} <ArrowRight className="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>
    )
  }

  if (tela === 'enviado') {
    return (
      <div className="min-h-screen w-full px-4 py-10" style={{ background: FUNDO }}>
        <div className="mx-auto max-w-2xl">
          <div className="rounded-2xl bg-white p-8 text-center shadow-xl sm:p-10">
            <div className="mx-auto mb-4 grid h-14 w-14 place-items-center rounded-full bg-emerald-100 text-emerald-600">
              <CheckCircle2 className="h-8 w-8" />
            </div>
            <h1 className="text-2xl font-bold text-slate-800">Briefing enviado!</h1>
            <p className="mt-3 text-sm leading-relaxed text-slate-500">
              Recebemos suas respostas, {dados.cliente.nome_empresa}. Nossa equipe vai analisar e entrar em contato pra dar os próximos passos.
            </p>
            <p className="mt-3 text-sm text-slate-500">Lembrou de algo? É só abrir este mesmo link e atualizar.</p>
            <button
              type="button"
              onClick={() => { setPasso(0); setTela('form') }}
              className="mt-6 rounded-lg border border-slate-300 px-5 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50"
            >
              Rever minhas respostas
            </button>
          </div>
        </div>
      </div>
    )
  }

  // ------------------------------------------------------------------ o formulário
  const etapa = ETAPAS[passo]
  const ultimo = passo === ETAPAS.length - 1
  const respondidas = BRIEFING_MODELO.filter((p) => (respostas[p.pergunta] ?? '').trim()).length

  return (
    <div className="min-h-screen text-slate-900" style={{ background: FUNDO }}>
      <header className="mx-auto flex max-w-3xl items-center gap-3 px-4 pt-6 sm:px-6">
        <img src={logoNx} alt="" className="h-10 w-10 rounded-xl object-cover shadow-sm" />
        <div className="min-w-0">
          <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-white/70">Grupo NX Digital · Briefing</p>
          <p className="truncate text-lg font-bold text-white">{dados.cliente.nome_empresa}</p>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-4 pb-32 pt-5 sm:px-6">
        {/* progresso */}
        <div className="mb-4">
          <div className="mb-1.5 flex items-center justify-between text-xs text-white/80">
            <span>Etapa {passo + 1} de {ETAPAS.length}</span>
            <span>{Math.round(((passo + 1) / ETAPAS.length) * 100)}%</span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-white/20">
            <div className="h-full rounded-full bg-white transition-all" style={{ width: `${((passo + 1) / ETAPAS.length) * 100}%` }} />
          </div>
        </div>

        <section className="rounded-2xl bg-white p-5 shadow-xl sm:p-7">
          <h1 className="flex items-center gap-2.5 text-xl font-bold text-slate-800">
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-[#2F5BFF]/10 text-[#2F5BFF]">
              {etapa.tipo === 'empresa' && <Building2 className="h-5 w-5" />}
              {etapa.tipo === 'acessos' && <KeyRound className="h-5 w-5" />}
              {etapa.tipo === 'contas' && <CreditCard className="h-5 w-5" />}
              {etapa.tipo === 'perguntas' && <MessageCircleQuestion className="h-5 w-5" />}
              {etapa.tipo === 'materiais' && <ImagePlus className="h-5 w-5" />}
              {etapa.tipo === 'revisao' && <Send className="h-5 w-5" />}
            </span>
            {tituloDaEtapa(etapa)}
          </h1>

          {/* ---------------- 1. empresa ---------------- */}
          {etapa.tipo === 'empresa' && (
            <div className="mt-5 space-y-5">
              <div>
                <span className="mb-1.5 block text-sm font-medium text-slate-700">Logo da empresa</span>
                <div className="flex items-center gap-4">
                  {logo ? (
                    <img src={logo} alt="" className="h-16 w-16 rounded-2xl border border-slate-200 bg-white object-contain p-1" />
                  ) : (
                    <span className="grid h-16 w-16 place-items-center rounded-2xl border border-dashed border-slate-300 text-slate-400">
                      <ImagePlus className="h-6 w-6" />
                    </span>
                  )}
                  <div>
                    <button
                      type="button"
                      onClick={() => inputLogo.current?.click()}
                      disabled={enviandoArquivo}
                      className="inline-flex items-center gap-2 rounded-lg border border-slate-300 px-3.5 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60"
                    >
                      {enviandoArquivo ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                      {logo ? 'Trocar a logo' : 'Enviar a logo'}
                    </button>
                    <p className="mt-1 text-xs text-slate-500">PNG ou JPG, de preferência com fundo transparente.</p>
                  </div>
                  <input ref={inputLogo} type="file" accept="image/*" className="hidden" onChange={(e) => { void subirLogo(e.target.files?.[0]); e.target.value = '' }} />
                </div>
              </div>
              <Campo rotulo="Site da empresa" ajuda="Se não tiver site, deixe em branco.">
                <Texto value={campos.site ?? ''} onChange={(v) => mudar('site', v)} placeholder="www.suaempresa.com.br" inputMode="url" />
              </Campo>
              <Campo rotulo="WhatsApp que vai receber os leads" ajuda="É pra esse número que os contatos dos anúncios vão chegar.">
                <Texto value={campos.whatsapp_leads ?? ''} onChange={(v) => mudar('whatsapp_leads', v)} placeholder="(00) 00000-0000" inputMode="tel" />
              </Campo>
            </div>
          )}

          {/* ---------------- 2. acessos ---------------- */}
          {etapa.tipo === 'acessos' && (
            <div className="mt-5 space-y-5">
              <p className="rounded-lg border border-blue-100 bg-blue-50 px-3 py-2.5 text-sm text-blue-900">
                Precisamos desses acessos pra configurar e rodar as campanhas. Só a equipe da NX vê essas informações. Se preferir passar as senhas por outro canal, deixe em branco e nos avise.
              </p>
              <div className="grid gap-4 sm:grid-cols-2">
                <Campo rotulo="Instagram da empresa">
                  <Texto value={campos.instagram ?? ''} onChange={(v) => mudar('instagram', v)} placeholder="@suaempresa" />
                </Campo>
                <Campo rotulo="Senha do Instagram">
                  <Senha value={senhas.instagram_senha} onChange={(v) => setSenhas((s) => ({ ...s, instagram_senha: v }))} temSalva={!!dados.tem_senha.instagram_senha} />
                </Campo>
                <Campo rotulo="Facebook (login ou link da página)">
                  <Texto value={campos.facebook ?? ''} onChange={(v) => mudar('facebook', v)} placeholder="e-mail de login ou facebook.com/suapagina" />
                </Campo>
                <Campo rotulo="Senha do Facebook">
                  <Senha value={senhas.facebook_senha} onChange={(v) => setSenhas((s) => ({ ...s, facebook_senha: v }))} temSalva={!!dados.tem_senha.facebook_senha} />
                </Campo>
              </div>
              <div className="border-t border-slate-200 pt-4">
                <p className="mb-3 text-sm font-semibold text-slate-800">CRM ou sistema de vendas</p>
                <div className="grid gap-4 sm:grid-cols-3">
                  <Campo rotulo="Qual CRM você usa?" ajuda="Se não usa nenhum, escreva “não uso”.">
                    <Texto value={campos.crm ?? ''} onChange={(v) => mudar('crm', v)} />
                  </Campo>
                  <Campo rotulo="E-mail de acesso">
                    <Texto value={campos.crm_email ?? ''} onChange={(v) => mudar('crm_email', v)} placeholder="login@empresa.com" inputMode="email" />
                  </Campo>
                  <Campo rotulo="Senha">
                    <Senha value={senhas.crm_senha} onChange={(v) => setSenhas((s) => ({ ...s, crm_senha: v }))} temSalva={!!dados.tem_senha.crm_senha} />
                  </Campo>
                </div>
              </div>
            </div>
          )}

          {/* ---------------- 3. contas e pagamento ---------------- */}
          {etapa.tipo === 'contas' && (
            <div className="mt-5 space-y-3">
              <p className="text-sm text-slate-500">Marque o que você já tem. Se quiser, anote ao lado o ID da conta ou o e-mail de acesso.</p>
              {CHECKLIST.map((item) => (
                <div key={item.chave} className="rounded-xl border border-slate-200 p-4">
                  <p className="text-sm font-medium text-slate-800">{item.pergunta}</p>
                  <div className="mt-2.5 flex flex-wrap gap-2" role="group" aria-label={item.pergunta}>
                    {RESPOSTAS.map((x) => (
                      <button
                        key={x.valor}
                        type="button"
                        aria-pressed={campos[item.chave] === x.valor}
                        onClick={() => mudar(item.chave, campos[item.chave] === x.valor ? '' : x.valor)}
                        className={
                          'rounded-full border px-4 py-1.5 text-sm font-medium transition-colors ' +
                          (campos[item.chave] === x.valor ? x.cor : 'border-slate-300 text-slate-600 hover:border-slate-400')
                        }
                      >
                        {x.rotulo}
                      </button>
                    ))}
                  </div>
                  <input
                    value={campos[item.obs] ?? ''}
                    onChange={(e) => mudar(item.obs, e.target.value)}
                    placeholder={item.dica}
                    aria-label={`Observação: ${item.pergunta}`}
                    className={CLASSE_INPUT + ' mt-2.5'}
                  />
                </div>
              ))}
            </div>
          )}

          {/* ---------------- 4–10. perguntas ---------------- */}
          {etapa.tipo === 'perguntas' && (
            <div className="mt-5 space-y-5">
              <p className="text-sm text-slate-500">
                Onde aparecer <strong className="text-amber-600">indicador</strong>, tente responder com número (R$, %, quantidade ou prazo). Não sabe? Marque “Não sei”.
              </p>
              {BRIEFING_MODELO.map((p, i) => ({ p, i })).filter(({ p }) => p.bloco === etapa.bloco).map(({ p, i }) => (
                <div key={p.pergunta}>
                  <p className="text-sm font-semibold text-slate-800">
                    <span className="mr-1.5 text-[#2F5BFF]">{i + 1}.</span>
                    {p.pergunta}
                  </p>
                  {p.indicador && (
                    <p className="mt-0.5 text-xs">
                      <span className="font-semibold text-amber-600">Indicador:</span> <span className="text-slate-500">{p.indicador}</span>
                    </p>
                  )}
                  <textarea
                    value={respostas[p.pergunta] ?? ''}
                    onChange={(e) => setRespostas((r) => ({ ...r, [p.pergunta]: e.target.value }))}
                    rows={3}
                    placeholder="Sua resposta"
                    aria-label={`Resposta da pergunta ${i + 1}`}
                    className="mt-2 w-full resize-y rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 outline-none placeholder:text-slate-400 focus:border-[#2F5BFF] focus:ring-2 focus:ring-[#2F5BFF]/20"
                  />
                  <button
                    type="button"
                    onClick={() => setRespostas((r) => ({ ...r, [p.pergunta]: 'Não sei' }))}
                    className="mt-1.5 rounded-full border border-slate-300 px-3 py-1 text-xs text-slate-600 hover:border-amber-400 hover:text-amber-700"
                  >
                    Não sei
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* ---------------- 11. materiais ---------------- */}
          {etapa.tipo === 'materiais' && (
            <div className="mt-5 space-y-5">
              <p className="text-sm text-slate-500">Envie fotos, vídeos, depoimentos e o que mais puder virar anúncio. Cada arquivo com até 5MB.</p>
              <div>
                <button
                  type="button"
                  onClick={() => inputArquivos.current?.click()}
                  disabled={enviandoArquivo}
                  className="flex w-full flex-col items-center gap-2 rounded-xl border-2 border-dashed border-slate-300 px-4 py-8 text-sm text-slate-600 transition-colors hover:border-[#2F5BFF] hover:text-[#2F5BFF] disabled:opacity-60"
                >
                  {enviandoArquivo ? <Loader2 className="h-6 w-6 animate-spin" /> : <Upload className="h-6 w-6" />}
                  <span className="font-medium">{enviandoArquivo ? 'Enviando…' : 'Toque pra escolher fotos, vídeos ou arquivos'}</span>
                </button>
                <input
                  ref={inputArquivos}
                  type="file"
                  multiple
                  accept="image/*,video/*,.pdf,.doc,.docx,.xls,.xlsx,.zip"
                  className="hidden"
                  onChange={(e) => { void subirArquivos(Array.from(e.target.files ?? [])); e.target.value = '' }}
                />
              </div>
              {arquivos.length > 0 && (
                <ul className="divide-y divide-slate-200 rounded-xl border border-slate-200">
                  {arquivos.map((a) => (
                    <li key={a.id} className="flex items-center gap-3 px-3 py-2.5">
                      <FileText className="h-4 w-4 shrink-0 text-slate-400" />
                      <span className="min-w-0 flex-1 truncate text-sm text-slate-700">{a.titulo}</span>
                      <span className="shrink-0 text-xs text-slate-400">{tamanho(a.tamanho)}</span>
                      <button
                        type="button"
                        onClick={() => {
                          void gestaoClientes.excluirArquivoBriefing(token, a.id).then(() => setArquivos((l) => l.filter((x) => x.id !== a.id)))
                        }}
                        className="shrink-0 rounded-md p-1 text-slate-400 hover:text-rose-600"
                        aria-label={`Remover ${a.titulo}`}
                      >
                        <X className="h-4 w-4" />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              <Campo rotulo="Link de uma pasta com materiais (Google Drive, Dropbox…)" ajuda="Pra vídeos e arquivos grandes: coloque numa pasta e cole o link aqui. Lembre de liberar o acesso.">
                <Texto value={linkMateriais} onChange={setLinkMateriais} placeholder="https://drive.google.com/…" inputMode="url" />
              </Campo>
            </div>
          )}

          {/* ---------------- 12. revisão ---------------- */}
          {etapa.tipo === 'revisao' && (
            <div className="mt-5 space-y-4">
              <p className="text-sm text-slate-500">Confira o resumo. Dá pra voltar em qualquer etapa antes de enviar — e também depois, por este mesmo link.</p>
              <ul className="divide-y divide-slate-200 rounded-xl border border-slate-200 text-sm">
                {[
                  { rotulo: 'Logo', ok: !!logo, texto: logo ? 'enviada' : 'não enviada', ir: 0 },
                  { rotulo: 'Site', ok: !!campos.site, texto: campos.site || 'em branco', ir: 0 },
                  { rotulo: 'WhatsApp dos leads', ok: !!campos.whatsapp_leads, texto: campos.whatsapp_leads || 'em branco', ir: 0 },
                  { rotulo: 'Instagram', ok: !!campos.instagram, texto: campos.instagram || 'em branco', ir: 1 },
                  { rotulo: 'Facebook', ok: !!campos.facebook, texto: campos.facebook || 'em branco', ir: 1 },
                  { rotulo: 'CRM', ok: !!campos.crm, texto: campos.crm || 'em branco', ir: 1 },
                  {
                    rotulo: 'Contas e pagamento',
                    ok: CHECKLIST.every((c) => campos[c.chave]),
                    texto: `${CHECKLIST.filter((c) => campos[c.chave]).length} de ${CHECKLIST.length} respondidas`,
                    ir: 2,
                  },
                  { rotulo: 'Perguntas', ok: respondidas === BRIEFING_MODELO.length, texto: `${respondidas} de ${BRIEFING_MODELO.length} respondidas`, ir: 3 },
                  { rotulo: 'Materiais', ok: arquivos.length > 0 || !!linkMateriais, texto: `${arquivos.length} arquivo(s)${linkMateriais ? ' + link da pasta' : ''}`, ir: ETAPAS.length - 2 },
                ].map((l) => (
                  <li key={l.rotulo} className="flex items-center gap-3 px-3 py-2.5">
                    <span className={'grid h-5 w-5 shrink-0 place-items-center rounded-full ' + (l.ok ? 'bg-emerald-100 text-emerald-600' : 'bg-slate-100 text-slate-400')}>
                      <Check className="h-3 w-3" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block font-medium text-slate-700">{l.rotulo}</span>
                      <span className="block truncate text-xs text-slate-500">{l.texto}</span>
                    </span>
                    <button type="button" onClick={() => void ir(l.ir)} className="shrink-0 text-xs font-medium text-[#2F5BFF] hover:underline">
                      editar
                    </button>
                  </li>
                ))}
              </ul>
              <p className="text-xs text-slate-500">Não precisa estar tudo preenchido pra enviar: o que faltar a gente combina depois.</p>
            </div>
          )}

          {aviso && <p className="mt-4 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">{aviso}</p>}
        </section>
      </main>

      {/* rodapé fixo com a navegação */}
      <div className="fixed inset-x-0 bottom-0 border-t border-slate-200 bg-white/95 px-4 py-3 backdrop-blur">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-3 sm:px-2">
          <button
            type="button"
            onClick={() => (passo === 0 ? setTela('boas-vindas') : void ir(passo - 1))}
            disabled={salvando}
            className="inline-flex items-center gap-1.5 rounded-lg px-3 py-2.5 text-sm font-medium text-slate-600 hover:bg-slate-100 disabled:opacity-50"
          >
            <ArrowLeft className="h-4 w-4" /> Voltar
          </button>
          <span className="hidden text-xs text-slate-400 sm:block">{salvando ? 'Salvando…' : 'Suas respostas são salvas a cada etapa'}</span>
          {ultimo ? (
            <button
              type="button"
              onClick={() => void enviar()}
              disabled={salvando}
              className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-60"
            >
              {salvando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />} Enviar briefing
            </button>
          ) : (
            <button
              type="button"
              onClick={() => void ir(passo + 1)}
              disabled={salvando}
              className="inline-flex items-center gap-2 rounded-lg bg-[#2F5BFF] px-5 py-2.5 text-sm font-semibold text-white hover:bg-[#2348d8] disabled:opacity-60"
            >
              {salvando ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Continuar <ArrowRight className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
