import * as React from 'react'
import { useSearchParams } from 'react-router-dom'
import {
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  Building2,
  CheckCircle2,
  Clock,
  ExternalLink,
  HelpCircle,
  Mail,
  MessageCircle,
  Phone,
  PlayCircle,
  Search,
  Send,
  Sparkles,
  ThumbsDown,
  ThumbsUp,
} from 'lucide-react'
import { toast } from 'sonner'
import { api } from '@/services/api'
import { publicSupport } from '@/services/tickets'
import { cn } from '@/lib/utils'
import type {
  KbArticle,
  TicketCategory,
  TicketTriageStep,
  TriagePathEntry,
} from '@/types/ticket'
import {
  TICKET_STATUS_LABEL,
  TICKET_STATUS_TONE,
} from '@/types/ticket'

/**
 * Portal público de suporte — acessível em /suporte (link fixo). Cliente
 * passa por 4 etapas:
 *   1. Identificação (e-mail; se não achar, pede CNPJ)
 *   2. Escolha de categoria
 *   3. Triagem em árvore + sugestões KB (vídeos/artigos)
 *   4. Abertura do ticket OU acompanhamento (?t=token)
 */

type Step = 'identify' | 'category' | 'triage' | 'compose' | 'created' | 'track'
type IdentifySubStep = 'email' | 'fallback' | 'confirm'

interface Identification {
  email: string
  name?: string
  cnpj?: string
  phone?: string
  company?: string
  clientId?: string | null
  matched: boolean
}

function validateCnpj(v: string): boolean {
  const d = v.replace(/\D/g, '')
  return d.length === 14
}

function formatCnpj(v: string): string {
  const d = v.replace(/\D/g, '').slice(0, 14)
  if (d.length <= 2) return d
  if (d.length <= 5) return `${d.slice(0,2)}.${d.slice(2)}`
  if (d.length <= 8) return `${d.slice(0,2)}.${d.slice(2,5)}.${d.slice(5)}`
  if (d.length <= 12) return `${d.slice(0,2)}.${d.slice(2,5)}.${d.slice(5,8)}/${d.slice(8)}`
  return `${d.slice(0,2)}.${d.slice(2,5)}.${d.slice(5,8)}/${d.slice(8,12)}-${d.slice(12)}`
}

export function SupportPublicPage() {
  const [searchParams] = useSearchParams()
  const incomingToken = searchParams.get('t')

  const [step, setStep] = React.useState<Step>(incomingToken ? 'track' : 'identify')
  const [trackToken, setTrackToken] = React.useState<string>(incomingToken ?? '')
  const [identity, setIdentity] = React.useState<Identification | null>(null)
  const [identifySubStep, setIdentifySubStep] = React.useState<IdentifySubStep>('email')
  const [category, setCategory] = React.useState<TicketCategory | null>(null)
  const [triagePath, setTriagePath] = React.useState<TriagePathEntry[]>([])

  return (
    <div className="min-h-screen bg-bg text-foreground">
      <Header />

      <main className="mx-auto max-w-3xl px-4 py-8 sm:px-6">
        {step === 'identify' && (
          <IdentifyStep
            initialSubStep={identifySubStep}
            onSubStepChange={setIdentifySubStep}
            onDone={(ident) => {
              setIdentity(ident)
              setStep('category')
            }}
            onTrackInstead={(token) => {
              setTrackToken(token)
              setStep('track')
            }}
          />
        )}

        {step === 'category' && identity && (
          <CategoryStep
            identity={identity}
            onPick={(c) => {
              setCategory(c)
              setTriagePath([])
              setStep('triage')
            }}
            onBack={() => setStep('identify')}
          />
        )}

        {step === 'triage' && identity && category && (
          <TriageStep
            identity={identity}
            category={category}
            path={triagePath}
            onPathChange={setTriagePath}
            onResolved={() => setStep('created')}
            onEscalate={() => setStep('compose')}
            onBack={() => setStep('category')}
          />
        )}

        {step === 'compose' && identity && category && (
          <ComposeStep
            identity={identity}
            category={category}
            triagePath={triagePath}
            onCreated={(token) => {
              setTrackToken(token)
              setStep('created')
            }}
            onBack={() => setStep('triage')}
          />
        )}

        {step === 'created' && (
          <CreatedStep
            token={trackToken}
            onTrack={() => setStep('track')}
            onNewTicket={() => {
              setStep('category')
              setCategory(null)
              setTriagePath([])
            }}
          />
        )}

        {step === 'track' && (
          <TrackStep
            initialToken={trackToken}
            onBackHome={() => setStep('identify')}
          />
        )}
      </main>
    </div>
  )
}

function Header() {
  return (
    <header className="border-b border-line bg-card/40 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-3xl items-center justify-between px-4 sm:px-6">
        <div className="flex items-center gap-2">
          <div className="grid h-8 w-8 place-items-center rounded-lg bg-accent/15 ring-1 ring-accent/30">
            <MessageCircle className="h-4 w-4 text-accent" />
          </div>
          <div className="leading-tight">
            <div className="text-sm font-semibold text-foreground">Central de Suporte</div>
            <div className="text-[10px] uppercase tracking-wider text-foreground/40">
              Atendimento NX
            </div>
          </div>
        </div>
        <a
          href="/"
          className="inline-flex items-center gap-1.5 rounded-lg border border-line px-3 py-1.5 text-xs text-foreground/55 hover:bg-elevate/[0.04] hover:text-foreground transition-colors"
        >
          ← Sair
        </a>
      </div>
    </header>
  )
}

// =====================================================================
// Etapa 1 — Identificação
// =====================================================================

function IdentifyStep({
  initialSubStep,
  onSubStepChange,
  onDone,
  onTrackInstead,
}: {
  initialSubStep: IdentifySubStep
  onSubStepChange: (s: IdentifySubStep) => void
  onDone: (i: Identification) => void
  onTrackInstead: (token: string) => void
}) {
  const [email, setEmail] = React.useState('')
  const [name, setName] = React.useState('')
  const [phone, setPhone] = React.useState('')
  const [company, setCompany] = React.useState('')
  const [cnpj, setCnpj] = React.useState('')
  const [step, setStepLocalRaw] = React.useState<IdentifySubStep>(initialSubStep)
  const setStepLocal = (s: IdentifySubStep) => { setStepLocalRaw(s); onSubStepChange(s) }
  const [matched, setMatched] = React.useState<{
    clientId: string
    clientName?: string
    clientCompany?: string
    openTickets?: number
  } | null>(null)
  const [looking, setLooking] = React.useState(false)
  const [trackToken, setTrackToken] = React.useState('')

  const lookup = async () => {
    if (!email.trim() || !/\S+@\S+\.\S+/.test(email)) {
      toast.error('Informe um e-mail válido.')
      return
    }
    setLooking(true)
    try {
      const r = await publicSupport.lookupByEmail(email.trim())
      if (r.clientId) {
        setMatched({
          clientId: r.clientId,
          clientName: r.clientName,
          clientCompany: r.clientCompany,
          openTickets: r.openTickets,
        })
        setCompany(r.clientCompany ?? '')
        setName(r.clientName ?? '')
        setStepLocal('confirm')
      } else {
        // não achou: pede dados manuais
        setStepLocal('fallback')
      }
    } catch (err) {
      toast.error('Erro: ' + (err instanceof Error ? err.message : String(err)))
    } finally {
      setLooking(false)
    }
  }

  const confirmAndProceed = () => {
    // Validações para o sub-step 'fallback'
    if (step === 'fallback') {
      const words = name.trim().split(/\s+/).filter(Boolean)
      if (words.length < 2) { toast.error('Informe seu nome completo (nome e sobrenome).'); return }
      if (!cnpj.trim() || !validateCnpj(cnpj)) { toast.error('Informe o CNPJ da empresa no formato correto.'); return }
      if (company.trim().length < 3) { toast.error('Nome da empresa deve ter ao menos 3 caracteres.'); return }
    }
    onDone({
      email: email.trim(),
      name: name.trim() || undefined,
      phone: phone.trim() || undefined,
      company: company.trim() || matched?.clientCompany,
      cnpj: cnpj.trim() || undefined,
      clientId: matched?.clientId,
      matched: Boolean(matched),
    })
  }

  return (
    <div className="space-y-6">
      <Hero />

      <Card>
        {step === 'email' && (
          <div className="space-y-4">
            <FieldLabel>Seu e-mail cadastrado</FieldLabel>
            <div className="flex gap-2">
              <input
                type="email"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="ex.: voce@empresa.com.br"
                className={inputCls}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void lookup()
                }}
              />
              <button
                onClick={lookup}
                disabled={looking}
                className={cn(btnPrimary, 'shrink-0')}
              >
                {looking ? 'Buscando…' : 'Continuar'}
              </button>
            </div>
            <p className="text-xs text-foreground/45">
              Usamos seu e-mail pra identificar sua empresa e agilizar o
              atendimento.
            </p>

            <hr className="border-line" />

            <div className="flex items-center justify-between gap-3 text-xs">
              <div className="text-foreground/55">
                Já tem um ticket aberto? Acompanhe pelo número/código:
              </div>
              <div className="flex items-center gap-2">
                <input
                  value={trackToken}
                  onChange={(e) => setTrackToken(e.target.value)}
                  placeholder="código do ticket"
                  className={cn(inputCls, 'h-8 text-xs w-40')}
                />
                <button
                  onClick={() => trackToken.trim() && onTrackInstead(trackToken.trim())}
                  className={btnSecondary}
                >
                  Ver
                </button>
              </div>
            </div>
          </div>
        )}

        {step === 'fallback' && (
          <div className="space-y-4">
            <div className="flex items-start gap-2 rounded-lg border border-warning/30 bg-warning/[0.08] px-3 py-2.5 text-sm text-warning">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>
                Não encontramos esse e-mail. Sem problema — preencha os dados
                abaixo e nosso suporte vai vincular sua empresa.
              </span>
            </div>
            <Grid2>
              <Field label="Seu nome completo *">
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Nome e sobrenome"
                  className={inputCls}
                />
              </Field>
              <Field label="E-mail">
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className={inputCls}
                />
              </Field>
              <Field label="CNPJ da empresa *">
                <input
                  value={cnpj}
                  onChange={(e) => setCnpj(formatCnpj(e.target.value))}
                  placeholder="00.000.000/0000-00"
                  className={inputCls}
                  maxLength={18}
                />
                {cnpj.trim() && !validateCnpj(cnpj) && (
                  <p className="mt-1 text-xs text-danger">CNPJ inválido — 14 dígitos</p>
                )}
              </Field>
              <Field label="Nome da empresa *">
                <input
                  value={company}
                  onChange={(e) => setCompany(e.target.value)}
                  placeholder="Razão social ou fantasia"
                  className={inputCls}
                />
                {company.trim().length > 0 && company.trim().length < 3 && (
                  <p className="mt-1 text-xs text-danger">Mínimo 3 caracteres</p>
                )}
              </Field>
              <Field label="Telefone (WhatsApp)">
                <input
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="(48) 99999-9999"
                  className={inputCls}
                />
              </Field>
            </Grid2>
            <div className="flex justify-between">
              <button onClick={() => setStepLocal('email')} className={btnGhost}>
                ← Voltar
              </button>
              <button
                onClick={confirmAndProceed}
                disabled={
                  !email.trim() ||
                  name.trim().split(/\s+/).filter(Boolean).length < 2 ||
                  !validateCnpj(cnpj) ||
                  company.trim().length < 3
                }
                className={btnPrimary}
              >
                Continuar
              </button>
            </div>
          </div>
        )}

        {step === 'confirm' && matched && (
          <div className="space-y-4">
            <div className="flex items-start gap-3 rounded-lg border border-success/30 bg-success/[0.05] px-4 py-3">
              <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-success" />
              <div>
                <div className="text-sm font-medium text-foreground">
                  Identificamos você
                </div>
                <div className="mt-0.5 text-xs text-foreground/60">
                  Empresa: <strong className="text-foreground">{matched.clientCompany ?? '—'}</strong>
                  {matched.openTickets !== undefined && matched.openTickets > 0 && (
                    <>
                      {' · '}
                      <span className="text-warning">
                        {matched.openTickets} ticket(s) em aberto
                      </span>
                    </>
                  )}
                </div>
              </div>
            </div>

            <Field label="Telefone (WhatsApp) — opcional">
              <input
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="(48) 99999-9999"
                className={inputCls}
              />
            </Field>

            <div className="flex justify-between">
              <button onClick={() => setStepLocal('email')} className={btnGhost}>
                ← Trocar e-mail
              </button>
              <button onClick={confirmAndProceed} className={btnPrimary}>
                Continuar
              </button>
            </div>
          </div>
        )}
      </Card>
    </div>
  )
}

function Hero() {
  return (
    <div className="text-center space-y-2 pt-2">
      <h1 className="text-2xl font-semibold tracking-tight">
        Como podemos ajudar?
      </h1>
      <p className="text-sm text-foreground/55">
        Conte o que aconteceu — sugerimos um vídeo/artigo na hora. Se não
        resolver, abrimos um ticket pra você.
      </p>
    </div>
  )
}

// =====================================================================
// Etapa 2 — Escolha de categoria
// =====================================================================

function CategoryStep({
  identity,
  onPick,
  onBack,
}: {
  identity: Identification
  onPick: (c: TicketCategory) => void
  onBack: () => void
}) {
  // Carrega categorias direto (sem auth — RLS permite anon)
  const [categories, setCategories] = React.useState<TicketCategory[]>([])
  const [loading, setLoading] = React.useState(true)

  React.useEffect(() => {
    void (async () => {
      try {
        const data = await api.get<Array<Record<string, unknown>>>('/api/public/ticket-categories')
        setCategories(
          (data ?? []).map((r) => ({
            id: r.id as string,
            name: r.name as string,
            description: (r.description as string) ?? undefined,
            icon: (r.icon as string) ?? 'HelpCircle',
            color: (r.color as string) ?? 'info',
            position: (r.position as number) ?? 0,
            active: r.active as boolean,
            defaultSlaHours: (r.default_sla_hours as number) ?? 24,
            defaultPriority: r.default_priority as TicketCategory['defaultPriority'],
            createdAt: r.created_at as string,
          })),
        )
      } catch (err) {
        toast.error('Falha ao carregar categorias: ' + (err instanceof Error ? err.message : 'Erro'))
      } finally {
        setLoading(false)
      }
    })()
  }, [])

  return (
    <div className="space-y-5">
      <StepHeader
        onBack={onBack}
        title={`Olá${identity.name ? `, ${identity.name.split(' ')[0]}` : ''}!`}
        subtitle="Em qual área você precisa de ajuda?"
      />

      {loading ? (
        <div className="text-sm text-foreground/55">Carregando…</div>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {categories.map((c) => (
            <button
              key={c.id}
              onClick={() => onPick(c)}
              className="group flex items-start gap-3 rounded-xl border border-line bg-card p-4 text-left transition-colors hover:border-accent/40 hover:bg-accent/[0.04]"
            >
              <div
                className={cn(
                  'grid h-9 w-9 shrink-0 place-items-center rounded-lg ring-1',
                  categoryColorCls(c.color),
                )}
              >
                <HelpCircle className="h-4 w-4" />
              </div>
              <div className="min-w-0">
                <div className="text-sm font-medium text-foreground">{c.name}</div>
                {c.description && (
                  <div className="mt-0.5 text-xs text-foreground/55">
                    {c.description}
                  </div>
                )}
              </div>
              <ArrowRight className="ml-auto mt-1 h-4 w-4 text-foreground/30 group-hover:text-accent" />
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// Mapeia o nome de cor salvo no banco pra classes Tailwind estáticas. Sem
// isso, classes interpoladas (`bg-${c.color}/10`) não são incluídas no purge
// e ficam invisíveis.
function categoryColorCls(color: string): string {
  switch (color) {
    case 'success':
      return 'bg-success/10 text-success ring-success/20'
    case 'danger':
      return 'bg-danger/10 text-danger ring-danger/20'
    case 'warning':
      return 'bg-warning/10 text-warning ring-warning/20'
    case 'info':
      return 'bg-accent/10 text-accent ring-accent/20'
    case 'neutral':
    default:
      return 'bg-elevate/[0.04] text-foreground/70 ring-elevate/10'
  }
}

// =====================================================================
// Etapa 3 — Triagem em árvore + KB sugerido
// =====================================================================

function TriageStep({
  category,
  path,
  onPathChange,
  onResolved,
  onEscalate,
  onBack,
}: {
  identity: Identification
  category: TicketCategory
  path: TriagePathEntry[]
  onPathChange: (p: TriagePathEntry[]) => void
  onResolved: () => void
  onEscalate: () => void
  onBack: () => void
}) {
  const [steps, setSteps] = React.useState<TicketTriageStep[]>([])
  const [articles, setArticles] = React.useState<KbArticle[]>([])
  const [currentStep, setCurrentStep] = React.useState<TicketTriageStep | null>(null)
  const [suggestedArticle, setSuggestedArticle] = React.useState<KbArticle | null>(null)
  const [loading, setLoading] = React.useState(true)

  React.useEffect(() => {
    void (async () => {
      const [stRows, kbRows] = await Promise.all([
        api.get<Record<string, unknown>[]>(`/api/public/triage-steps?category_id=${category.id}`).catch(() => []),
        api.get<Record<string, unknown>[]>(`/api/public/kb-articles?category_id=${category.id}`).catch(() => []),
      ])
      const mappedSteps = stRows.map((r): TicketTriageStep => ({
        id: r.id as string,
        categoryId: r.category_id as string,
        parentId: (r.parent_id as string) ?? null,
        question: r.question as string,
        options: (r.options as TicketTriageStep['options']) ?? [],
        position: (r.position as number) ?? 0,
      }))
      setSteps(mappedSteps)
      setArticles(kbRows.map(mapKbRow))

      const root = mappedSteps
        .filter((s) => !s.parentId)
        .sort((a, b) => a.position - b.position)[0]
      setCurrentStep(root ?? null)
      setLoading(false)
    })()
  }, [category.id])

  const chooseOption = (label: string) => {
    if (!currentStep) return
    const opt = currentStep.options.find((o) => o.label === label)
    if (!opt) return

    const entry: TriagePathEntry = {
      question: currentStep.question,
      answer: label,
      kbArticleId: opt.kbArticleId ?? undefined,
    }
    const newPath = [...path, entry]
    onPathChange(newPath)

    if (opt.kbArticleId) {
      const art = articles.find((a) => a.id === opt.kbArticleId)
      setSuggestedArticle(art ?? null)
      setCurrentStep(null)
      return
    }
    if (opt.nextStepId) {
      const next = steps.find((s) => s.id === opt.nextStepId)
      setCurrentStep(next ?? null)
      return
    }
    // Sem next step nem KB — escalata pro suporte
    onEscalate()
  }

  const markResolved = async () => {
    if (suggestedArticle) {
      await api.post('/api/public/kb-helpful', { article_id: suggestedArticle.id, helpful: true }).catch(() => {})
    }
    onResolved()
  }

  const markNotResolved = async () => {
    if (suggestedArticle) {
      await api.post('/api/public/kb-helpful', { article_id: suggestedArticle.id, helpful: false }).catch(() => {})
    }
    onEscalate()
  }

  if (loading) {
    return (
      <div className="text-sm text-foreground/55 py-8 text-center">
        Carregando triagem…
      </div>
    )
  }

  // Sem triagem configurada → abre direto
  if (!currentStep && !suggestedArticle && steps.length === 0) {
    return (
      <div className="space-y-4">
        <StepHeader onBack={onBack} title={category.name} />
        <Card>
          <p className="text-sm text-foreground/65">
            Ainda não temos perguntas pré-configuradas pra essa área. Vamos
            direto pra abertura do ticket.
          </p>
          <div className="mt-4 flex justify-end">
            <button onClick={onEscalate} className={btnPrimary}>
              Abrir ticket →
            </button>
          </div>
        </Card>
      </div>
    )
  }

  return (
    <div className="space-y-5">
      <StepHeader
        onBack={onBack}
        title={category.name}
        subtitle="Algumas perguntas pra entender melhor sua situação"
      />

      {/* Trilha das respostas anteriores */}
      {path.length > 0 && (
        <div className="space-y-1.5">
          {path.map((p, i) => (
            <div
              key={i}
              className="rounded-lg border border-line bg-elevate/[0.02] px-3 py-2 text-xs"
            >
              <div className="text-foreground/45">{p.question}</div>
              <div className="mt-0.5 text-foreground">→ {p.answer}</div>
            </div>
          ))}
        </div>
      )}

      {currentStep && (
        <Card>
          <h3 className="text-base font-medium text-foreground">{currentStep.question}</h3>
          <div className="mt-4 grid grid-cols-1 gap-2">
            {currentStep.options.map((opt, i) => (
              <button
                key={i}
                onClick={() => chooseOption(opt.label)}
                className="flex items-center justify-between rounded-lg border border-line bg-elevate/[0.02] px-4 py-3 text-sm text-foreground hover:border-accent/40 hover:bg-accent/[0.04] transition-colors"
              >
                <span>{opt.label}</span>
                <ArrowRight className="h-4 w-4 text-foreground/40" />
              </button>
            ))}
            <button
              onClick={onEscalate}
              className="mt-2 text-xs text-foreground/45 hover:text-foreground/70 underline-offset-2 hover:underline self-start"
            >
              Nenhuma dessas opções · abrir ticket direto
            </button>
          </div>
        </Card>
      )}

      {suggestedArticle && (
        <KbResolutionCard
          article={suggestedArticle}
          onResolved={markResolved}
          onNotResolved={markNotResolved}
        />
      )}
    </div>
  )
}

function KbResolutionCard({
  article,
  onResolved,
  onNotResolved,
}: {
  article: KbArticle
  onResolved: () => void
  onNotResolved: () => void
}) {
  const embed = article.videoUrl ? extractEmbedUrl(article.videoUrl) : null

  return (
    <Card>
      <div className="space-y-4">
        <div className="flex items-start gap-3">
          <div className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-accent/15 text-accent ring-1 ring-accent/30">
            <Sparkles className="h-4 w-4" />
          </div>
          <div>
            <h3 className="text-base font-semibold text-foreground">{article.title}</h3>
            {article.summary && (
              <p className="mt-0.5 text-sm text-foreground/65">{article.summary}</p>
            )}
          </div>
        </div>

        {embed && (
          <div className="aspect-video overflow-hidden rounded-lg border border-line">
            <iframe
              src={embed}
              title={article.title}
              className="h-full w-full"
              allow="accelerometer; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
              allowFullScreen
            />
          </div>
        )}

        {article.bodyMarkdown && (
          <div className="prose prose-sm prose-invert max-w-none whitespace-pre-wrap rounded-lg border border-line bg-elevate/[0.02] p-4 text-sm text-foreground/85">
            {article.bodyMarkdown}
          </div>
        )}

        {article.videoUrl && !embed && (
          <a
            href={article.videoUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1.5 text-sm text-accent hover:underline"
          >
            <PlayCircle className="h-4 w-4" />
            Assistir ao vídeo
            <ExternalLink className="h-3 w-3" />
          </a>
        )}

        <div className="flex flex-col items-stretch gap-2 border-t border-line pt-4 sm:flex-row sm:items-center sm:justify-between">
          <span className="text-sm text-foreground/65">Isso resolveu sua dúvida?</span>
          <div className="flex gap-2">
            <button onClick={onNotResolved} className={cn(btnSecondary, 'gap-1.5')}>
              <ThumbsDown className="h-3.5 w-3.5" />
              Não · abrir ticket
            </button>
            <button onClick={onResolved} className={cn(btnPrimary, 'gap-1.5')}>
              <ThumbsUp className="h-3.5 w-3.5" />
              Sim, resolveu!
            </button>
          </div>
        </div>
      </div>
    </Card>
  )
}

function extractEmbedUrl(url: string): string | null {
  // YouTube
  const yt = url.match(
    /(?:youtube\.com\/(?:watch\?v=|embed\/|v\/)|youtu\.be\/)([\w-]{11})/,
  )
  if (yt) return `https://www.youtube.com/embed/${yt[1]}`
  // Loom
  const loom = url.match(/loom\.com\/share\/([a-f0-9-]+)/)
  if (loom) return `https://www.loom.com/embed/${loom[1]}`
  // Vimeo
  const vimeo = url.match(/vimeo\.com\/(\d+)/)
  if (vimeo) return `https://player.vimeo.com/video/${vimeo[1]}`
  return null
}

// =====================================================================
// Etapa 4 — Compor ticket
// =====================================================================

function ComposeStep({
  identity,
  category,
  triagePath,
  onCreated,
  onBack,
}: {
  identity: Identification
  category: TicketCategory
  triagePath: TriagePathEntry[]
  onCreated: (token: string) => void
  onBack: () => void
}) {
  const [subject, setSubject] = React.useState('')
  const [description, setDescription] = React.useState('')
  const [submitting, setSubmitting] = React.useState(false)

  // Sugere assunto baseado na última resposta da triagem
  React.useEffect(() => {
    if (triagePath.length > 0) {
      const last = triagePath[triagePath.length - 1]
      setSubject(`${category.name}: ${last.answer}`)
    } else {
      setSubject(category.name)
    }
  }, [category.name, triagePath])

  const submit = async () => {
    if (!subject.trim()) {
      toast.error('Informe um assunto.')
      return
    }
    if (!description.trim() || description.trim().length < 10) {
      toast.error('Descreva sua situação com mais detalhes (mínimo 10 caracteres).')
      return
    }
    setSubmitting(true)
    try {
      const r = await publicSupport.createTicket({
        email: identity.email,
        name: identity.name,
        cnpj: identity.cnpj,
        phone: identity.phone,
        company: identity.company,
        categoryId: category.id,
        subject: subject.trim(),
        description: description.trim(),
        triagePath,
      })
      onCreated(r.publicToken)
    } catch (err) {
      toast.error('Falha ao abrir ticket: ' + (err instanceof Error ? err.message : String(err)))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="space-y-5">
      <StepHeader
        onBack={onBack}
        title="Conta os detalhes pro nosso suporte"
        subtitle="Quanto mais contexto, mais rápido a gente resolve."
      />

      <Card>
        <div className="space-y-4">
          <Field label="Assunto">
            <input
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              className={inputCls}
              maxLength={200}
            />
          </Field>
          <Field label="Descrição">
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={6}
              maxLength={5000}
              placeholder="Conta o que aconteceu, quando começou, o que você já tentou. Se tiver print, descreva."
              className={textareaCls}
            />
            <div className="mt-1 text-[11px] text-foreground/35 text-right">
              {description.length}/5000
            </div>
          </Field>

          {triagePath.length > 0 && (
            <div className="rounded-lg border border-line bg-elevate/[0.02] px-3 py-2">
              <div className="text-[10px] uppercase tracking-wider text-foreground/40">
                Triagem feita
              </div>
              <ul className="mt-1.5 space-y-0.5 text-xs text-foreground/65">
                {triagePath.map((p, i) => (
                  <li key={i}>
                    <span className="text-foreground/45">{p.question}</span> →{' '}
                    <strong className="text-foreground/85">{p.answer}</strong>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="flex justify-end">
            <button onClick={submit} disabled={submitting} className={btnPrimary}>
              {submitting ? 'Enviando…' : 'Enviar ticket'}
            </button>
          </div>
        </div>
      </Card>

      <Card>
        <div className="flex items-center justify-between gap-3 text-xs">
          <div className="text-foreground/55">Identificação</div>
          <div className="flex flex-wrap gap-x-3 gap-y-1 text-foreground/75">
            <span className="inline-flex items-center gap-1">
              <Mail className="h-3 w-3" /> {identity.email}
            </span>
            {identity.company && (
              <span className="inline-flex items-center gap-1">
                <Building2 className="h-3 w-3" /> {identity.company}
              </span>
            )}
            {identity.phone && (
              <span className="inline-flex items-center gap-1">
                <Phone className="h-3 w-3" /> {identity.phone}
              </span>
            )}
          </div>
        </div>
      </Card>
    </div>
  )
}

// =====================================================================
// Etapa 5 — Confirmação após criação
// =====================================================================

function CreatedStep({
  token,
  onTrack,
  onNewTicket,
}: {
  token: string
  onTrack: () => void
  onNewTicket: () => void
}) {
  const url = `${window.location.origin}/suporte?t=${token}`
  return (
    <div className="grid place-items-center pt-10 text-center">
      <CheckCircle2 className="h-12 w-12 text-success" />
      <h2 className="mt-4 text-xl font-semibold text-foreground">Ticket criado!</h2>
      <p className="mt-2 max-w-md text-sm text-foreground/65">
        Nosso suporte foi notificado e vai te responder em breve. Salve o link
        abaixo pra acompanhar a conversa:
      </p>
      <div className="mt-4 w-full max-w-md rounded-lg border border-line bg-card px-3 py-2 text-xs text-foreground/75 break-all">
        {url}
      </div>
      <div className="mt-5 flex gap-2">
        <button
          onClick={() => {
            navigator.clipboard?.writeText(url)
            toast.success('Link copiado')
          }}
          className={btnSecondary}
        >
          Copiar link
        </button>
        <button onClick={onTrack} className={btnPrimary}>
          Acompanhar agora
        </button>
      </div>
      <button
        onClick={onNewTicket}
        className="mt-6 text-xs text-foreground/45 hover:text-foreground/70"
      >
        Abrir outro ticket
      </button>
    </div>
  )
}

// =====================================================================
// Etapa 6 — Acompanhamento do ticket (cliente)
// =====================================================================

function TrackStep({
  initialToken,
  onBackHome,
}: {
  initialToken: string
  onBackHome: () => void
}) {
  const [token, setToken] = React.useState(initialToken)
  const [ticket, setTicket] = React.useState<Awaited<ReturnType<typeof publicSupport.getTicketByToken>>>(null)
  const [loading, setLoading] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [reply, setReply] = React.useState('')
  const [posting, setPosting] = React.useState(false)

  const load = React.useCallback(
    async (opts: { silent?: boolean } = {}) => {
      if (!token.trim()) return
      if (!opts.silent) {
        setLoading(true)
        setError(null)
        setTicket(null)
      }
      try {
        const t = await publicSupport.getTicketByToken(token.trim())
        if (!t && !opts.silent) {
          setError('Ticket não encontrado. Verifique o código.')
        }
        setTicket(t)
      } catch (err) {
        if (!opts.silent) {
          setError('Erro: ' + (err instanceof Error ? err.message : String(err)))
        }
      } finally {
        if (!opts.silent) setLoading(false)
      }
    },
    [token],
  )

  React.useEffect(() => {
    if (initialToken) void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialToken])

  // Auto-refresh discreto a cada 15s pra cliente ver respostas do agente
  // sem F5. Para quando o ticket fica resolved/closed.
  React.useEffect(() => {
    if (!ticket) return
    if (ticket.status === 'resolved' || ticket.status === 'closed') return
    const id = window.setInterval(() => {
      void load({ silent: true })
    }, 15_000)
    return () => window.clearInterval(id)
  }, [ticket, load])

  const post = async () => {
    if (!reply.trim() || !ticket) return
    setPosting(true)
    try {
      await publicSupport.postMessage(token, ticket.customerName ?? 'Cliente', reply.trim())
      setReply('')
      await load()
      toast.success('Mensagem enviada')
    } catch (err) {
      toast.error('Falha: ' + (err instanceof Error ? err.message : String(err)))
    } finally {
      setPosting(false)
    }
  }

  return (
    <div className="space-y-5">
      <StepHeader
        onBack={onBackHome}
        title="Acompanhar ticket"
        subtitle="Cole o código do seu ticket e veja as mensagens."
      />

      {!ticket && (
        <Card>
          <div className="flex gap-2">
            <input
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder="código do ticket"
              className={inputCls}
              onKeyDown={(e) => e.key === 'Enter' && load()}
            />
            <button onClick={() => load()} disabled={loading} className={btnPrimary}>
              {loading ? 'Buscando…' : 'Ver'}
            </button>
          </div>
          {error && (
            <p className="mt-3 text-sm text-danger">{error}</p>
          )}
        </Card>
      )}

      {ticket && (
        <>
          <Card>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="text-[10px] uppercase tracking-wider text-foreground/40">
                  Ticket #{ticket.number}
                </div>
                <h2 className="mt-1 text-base font-semibold text-foreground">
                  {ticket.subject}
                </h2>
                <div className="mt-1 text-xs text-foreground/45 inline-flex items-center gap-1.5">
                  <Clock className="h-3 w-3" />
                  Aberto em {new Date(ticket.openedAt).toLocaleString('pt-BR')}
                </div>
              </div>
              <div
                className={cn(
                  'rounded-md border px-2 py-0.5 text-[11px] font-medium',
                  toneCls(TICKET_STATUS_TONE[ticket.status]),
                )}
              >
                {TICKET_STATUS_LABEL[ticket.status]}
              </div>
            </div>
          </Card>

          <Card>
            <div className="space-y-3 max-h-[60vh] overflow-y-auto pr-2">
              {ticket.messages.length === 0 && (
                <div className="text-sm text-foreground/45">Sem mensagens ainda.</div>
              )}
              {ticket.messages.map((m) => {
                const isCustomer = m.authorType === 'customer'
                return (
                  <div
                    key={m.id}
                    className={cn(
                      'flex',
                      isCustomer ? 'justify-end' : 'justify-start',
                    )}
                  >
                    <div
                      className={cn(
                        'max-w-[80%] rounded-2xl px-3.5 py-2.5 text-sm',
                        isCustomer
                          ? 'bg-accent/15 text-foreground border border-accent/30'
                          : 'bg-elevate/[0.04] text-foreground/90 border border-line',
                      )}
                    >
                      <div className="mb-0.5 text-[10px] uppercase tracking-wider opacity-70">
                        {isCustomer
                          ? 'Você'
                          : m.authorName ?? 'Suporte NX'}
                      </div>
                      <div className="whitespace-pre-wrap leading-relaxed">{m.content}</div>
                      <div className="mt-1 text-[10px] opacity-50">
                        {new Date(m.createdAt).toLocaleString('pt-BR')}
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>

            {ticket.status !== 'resolved' && ticket.status !== 'closed' && (
              <div className="mt-4 border-t border-line pt-3 flex items-start gap-2">
                <textarea
                  value={reply}
                  onChange={(e) => setReply(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault()
                      void post()
                    }
                  }}
                  rows={2}
                  placeholder="Responder… (Enter envia · Shift+Enter quebra linha)"
                  className={cn(textareaCls, 'flex-1 min-h-[44px]')}
                  maxLength={5000}
                />
                <button
                  onClick={post}
                  disabled={!reply.trim() || posting}
                  className={cn(btnPrimary, 'shrink-0 gap-1.5')}
                >
                  <Send className="h-3.5 w-3.5" />
                  Enviar
                </button>
              </div>
            )}
            {(ticket.status === 'resolved' || ticket.status === 'closed') && (
              <div className="mt-4 rounded-lg border border-success/20 bg-success/[0.05] px-3 py-2 text-xs text-success">
                Este ticket foi {ticket.status === 'resolved' ? 'resolvido' : 'fechado'}.
                Pra qualquer dúvida nova, abra um novo ticket.
              </div>
            )}
          </Card>

          <div className="text-center">
            <button onClick={onBackHome} className="text-xs text-foreground/45 hover:text-foreground/70">
              ← Abrir novo ticket
            </button>
          </div>
        </>
      )}
    </div>
  )
}

// =====================================================================
// Helpers visuais
// =====================================================================

function StepHeader({
  title,
  subtitle,
  onBack,
}: {
  title: string
  subtitle?: string
  onBack?: () => void
}) {
  return (
    <div className="flex items-start gap-3">
      {onBack && (
        <button
          onClick={onBack}
          className="grid h-8 w-8 place-items-center rounded-lg border border-line text-foreground/55 hover:bg-elevate/[0.04] hover:text-foreground"
          aria-label="Voltar"
        >
          <ArrowLeft className="h-4 w-4" />
        </button>
      )}
      <div className="min-w-0">
        <h2 className="text-lg font-semibold text-foreground">{title}</h2>
        {subtitle && <p className="mt-0.5 text-sm text-foreground/55">{subtitle}</p>}
      </div>
    </div>
  )
}

function Card({ children }: { children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-line bg-card p-5">
      {children}
    </section>
  )
}

function Field({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <div>
      <FieldLabel>{label}</FieldLabel>
      <div className="mt-1.5">{children}</div>
    </div>
  )
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-[11px] uppercase tracking-wider text-foreground/45">
      {children}
    </div>
  )
}

function Grid2({ children }: { children: React.ReactNode }) {
  return <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">{children}</div>
}

function mapKbRow(r: Record<string, unknown>): KbArticle {
  return {
    id: r.id as string,
    slug: r.slug as string,
    title: r.title as string,
    summary: (r.summary as string) ?? undefined,
    bodyMarkdown: (r.body_markdown as string) ?? undefined,
    videoUrl: (r.video_url as string) ?? undefined,
    categoryId: (r.category_id as string) ?? null,
    tags: (r.tags as string[]) ?? [],
    viewsCount: (r.views_count as number) ?? 0,
    helpfulCount: (r.helpful_count as number) ?? 0,
    notHelpfulCount: (r.not_helpful_count as number) ?? 0,
    published: r.published as boolean,
    createdAt: r.created_at as string,
    updatedAt: r.updated_at as string,
  }
}

function toneCls(tone: 'success' | 'danger' | 'warning' | 'info' | 'neutral'): string {
  switch (tone) {
    case 'success':
      return 'bg-success/10 text-success border-success/20'
    case 'danger':
      return 'bg-danger/10 text-danger border-danger/20'
    case 'warning':
      return 'bg-warning/10 text-warning border-warning/20'
    case 'info':
      return 'bg-accent/10 text-accent border-accent/20'
    default:
      return 'bg-elevate/[0.04] text-foreground/70 border-elevate/10'
  }
}

const inputCls =
  'h-10 w-full rounded-lg bg-surface px-3 text-sm text-foreground border border-elevate/10 placeholder:text-foreground/30 focus:outline-none focus:border-accent focus:ring-4 focus:ring-accent/15 transition-colors'

const textareaCls =
  'w-full rounded-lg bg-surface px-3 py-2 text-sm text-foreground border border-elevate/10 placeholder:text-foreground/30 focus:outline-none focus:border-accent focus:ring-4 focus:ring-accent/15 transition-colors resize-y'

const btnPrimary =
  'inline-flex items-center justify-center h-10 px-4 rounded-lg bg-accent text-white font-medium text-sm hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed transition-opacity'

const btnSecondary =
  'inline-flex items-center justify-center h-10 px-4 rounded-lg bg-elevate/[0.06] text-foreground font-medium text-sm hover:bg-elevate/[0.10] border border-elevate/10 transition-colors'

const btnGhost =
  'inline-flex items-center justify-center h-10 px-3 rounded-lg text-foreground/55 hover:text-foreground hover:bg-elevate/[0.04] text-sm transition-colors'
