import * as React from 'react'
import { useParams } from 'react-router-dom'
import {
  ArrowRight,
  Building2,
  Check,
  Clock,
  Globe,
  MessageSquare,
  Phone,
  Plus,
  Send,
  Sparkles,
  StickyNote,
  Trash2,
  Users,
} from 'lucide-react'
import { toast } from 'sonner'
import { supabase } from '@/services/supabase'
import { asText, cn } from '@/lib/utils'
import type {
  BriefingData,
  BriefingStatus,
  BriefingUser,
  BriefingUserRole,
} from '@/types/client'

const DAYS = [
  'Segunda',
  'Terça',
  'Quarta',
  'Quinta',
  'Sexta',
  'Sábado',
  'Domingo',
]

interface BriefingFormState {
  razaoSocial: string
  nomeFantasia: string
  cnpj: string
  site: string

  users: BriefingUser[]

  schedule: { day: string; active: boolean; start: string; end: string }[]
  timezone: string

  whatsappNumbers: string
  whatsappType: string
  useFacebook: boolean
  facebookToken: string

  mainFlow: string
  greetingMessage: string
  offHoursMessage: string
  departments: string

  useAI: boolean
  aiTone: 'formal' | 'casual' | 'tecnico'
  aiInstructions: string
  aiRestrictions: string

  extraNotes: string
}

const initialState: BriefingFormState = {
  razaoSocial: '',
  nomeFantasia: '',
  cnpj: '',
  site: '',
  users: [{ name: '', email: '', sector: '', role: 'atendente' }],
  schedule: DAYS.map((day) => ({
    day,
    active: day !== 'Sábado' && day !== 'Domingo',
    start: '08:00',
    end: '18:00',
  })),
  timezone: 'America/Sao_Paulo',
  whatsappNumbers: '',
  whatsappType: 'baileys',
  useFacebook: false,
  facebookToken: '',
  mainFlow: '',
  greetingMessage: '',
  offHoursMessage: '',
  departments: '',
  useAI: false,
  aiTone: 'casual',
  aiInstructions: '',
  aiRestrictions: '',
  extraNotes: '',
}

interface PublicClient {
  id: string
  name: string
  company: string
  briefing_status: BriefingStatus | null
  briefing_revision_note: string | null
}

export function BriefingPublicPage() {
  const { token } = useParams<{ token: string }>()
  const [client, setClient] = React.useState<PublicClient | null | undefined>(
    undefined,
  )

  const [state, setState] = React.useState<BriefingFormState>(initialState)
  const [section, setSection] = React.useState(0)
  const [submitted, setSubmitted] = React.useState(false)
  const [submitting, setSubmitting] = React.useState(false)

  React.useEffect(() => {
    if (!token) {
      setClient(null)
      return
    }
    let cancelled = false
    ;(async () => {
      const { data, error } = await supabase.rpc(
        'get_client_by_briefing_token',
        { token_in: token },
      )
      if (cancelled) return
      if (error || !data || (Array.isArray(data) && data.length === 0)) {
        setClient(null)
        return
      }
      const row = Array.isArray(data) ? data[0] : data
      setClient({
        id: row.id,
        name: row.name,
        company: row.company,
        briefing_status: row.briefing_status ?? null,
        briefing_revision_note: row.briefing_revision_note ?? null,
      })
    })()
    return () => {
      cancelled = true
    }
  }, [token])

  if (client === undefined) {
    return (
      <div className="grid min-h-screen place-items-center bg-slate-50 text-sm text-slate-500">
        Carregando…
      </div>
    )
  }

  if (!token || !client) {
    return <BriefingErrorPage />
  }

  if (submitted) {
    return <BriefingSuccessPage company={client.company} />
  }

  const submit = async () => {
    const data: BriefingData = {
      razaoSocial: state.razaoSocial.trim(),
      nomeFantasia: state.nomeFantasia.trim(),
      cnpj: state.cnpj.trim(),
      site: state.site.trim() || undefined,
      users: state.users
        .filter((u) => u.name.trim() && u.email.trim())
        .map((u) => ({
          name: u.name.trim(),
          email: u.email.trim(),
          sector: u.sector.trim(),
          role: u.role,
        })),
      schedule: state.schedule,
      timezone: state.timezone,
      whatsappNumbers: state.whatsappNumbers
        .split(/[\s,;]+/)
        .map((s) => s.trim())
        .filter(Boolean),
      whatsappType: state.whatsappType,
      useFacebook: state.useFacebook,
      facebookToken: state.useFacebook
        ? state.facebookToken.trim() || undefined
        : undefined,
      mainFlow: state.mainFlow.trim(),
      greetingMessage: state.greetingMessage.trim(),
      offHoursMessage: state.offHoursMessage.trim(),
      departments: state.departments
        .split(/[\n,;]+/)
        .map((s) => s.trim())
        .filter(Boolean),
      useAI: state.useAI,
      aiTone: state.useAI ? state.aiTone : undefined,
      aiInstructions: state.useAI
        ? state.aiInstructions.trim() || undefined
        : undefined,
      aiRestrictions: state.useAI
        ? state.aiRestrictions.trim() || undefined
        : undefined,
      extraNotes: state.extraNotes.trim() || undefined,
      submittedAt: new Date().toISOString(),
    }
    setSubmitting(true)
    const { error } = await supabase.rpc('submit_briefing', {
      token_in: token,
      data_in: data,
    })
    setSubmitting(false)
    if (error) {
      toast.error('Falha ao enviar: ' + error.message)
      return
    }
    setSubmitted(true)
  }

  const totalSections = 7

  const next = () => {
    if (section < totalSections - 1) {
      setSection(section + 1)
      window.scrollTo({ top: 0, behavior: 'smooth' })
    } else {
      void submit()
    }
  }
  const prev = () => {
    if (section > 0) {
      setSection(section - 1)
      window.scrollTo({ top: 0, behavior: 'smooth' })
    }
  }

  return (
    <div className="min-h-screen bg-white text-slate-900">
      <BriefingHeader companyName={client.company} />

      <main className="mx-auto max-w-3xl px-4 pb-32 pt-8 sm:px-6">
        {client.briefing_revision_note && (
          <div className="mb-6 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
            <strong>Solicitação de revisão:</strong>{' '}
            {client.briefing_revision_note}
          </div>
        )}

        {section === 0 && (
          <SectionBlock
            number={1}
            total={totalSections}
            title="Dados da empresa"
            icon={<Building2 className="h-5 w-5 text-[#4F8EF7]" />}
          >
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label="Razão social *">
                <PlainInput
                  value={state.razaoSocial}
                  onChange={(v) => setState({ ...state, razaoSocial: v })}
                />
              </Field>
              <Field label="Nome fantasia *">
                <PlainInput
                  value={state.nomeFantasia}
                  onChange={(v) => setState({ ...state, nomeFantasia: v })}
                />
              </Field>
              <Field label="CNPJ *">
                <PlainInput
                  value={state.cnpj}
                  onChange={(v) => setState({ ...state, cnpj: v })}
                  placeholder="00.000.000/0000-00"
                />
              </Field>
              <Field label="Site">
                <PlainInput
                  value={state.site}
                  onChange={(v) => setState({ ...state, site: v })}
                  placeholder="https://"
                />
              </Field>
            </div>
          </SectionBlock>
        )}

        {section === 1 && (
          <SectionBlock
            number={2}
            total={totalSections}
            title="Usuários e setores"
            icon={<Users className="h-5 w-5 text-[#4F8EF7]" />}
            description="Quem vai usar o sistema? Adicione um por linha."
          >
            <div className="space-y-3">
              {state.users.map((u, i) => (
                <div
                  key={i}
                  className="rounded-xl border border-slate-200 bg-slate-50 p-3"
                >
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-12">
                    <div className="sm:col-span-3">
                      <Field label="Nome">
                        <PlainInput
                          value={u.name}
                          onChange={(v) => {
                            const users = [...state.users]
                            users[i] = { ...users[i], name: v }
                            setState({ ...state, users })
                          }}
                        />
                      </Field>
                    </div>
                    <div className="sm:col-span-4">
                      <Field label="E-mail">
                        <PlainInput
                          type="email"
                          value={u.email}
                          onChange={(v) => {
                            const users = [...state.users]
                            users[i] = { ...users[i], email: v }
                            setState({ ...state, users })
                          }}
                        />
                      </Field>
                    </div>
                    <div className="sm:col-span-3">
                      <Field label="Setor">
                        <PlainInput
                          value={u.sector}
                          onChange={(v) => {
                            const users = [...state.users]
                            users[i] = { ...users[i], sector: v }
                            setState({ ...state, users })
                          }}
                        />
                      </Field>
                    </div>
                    <div className="sm:col-span-2">
                      <Field label="Tipo">
                        <PlainSelect
                          value={u.role}
                          onChange={(v) => {
                            const users = [...state.users]
                            users[i] = { ...users[i], role: v as BriefingUserRole }
                            setState({ ...state, users })
                          }}
                          options={[
                            { value: 'atendente', label: 'Atendente' },
                            { value: 'supervisor', label: 'Supervisor' },
                            { value: 'admin', label: 'Admin' },
                          ]}
                        />
                      </Field>
                    </div>
                  </div>
                  {state.users.length > 1 && (
                    <button
                      type="button"
                      className="mt-2 inline-flex items-center gap-1 text-xs text-rose-600 hover:underline"
                      onClick={() =>
                        setState({
                          ...state,
                          users: state.users.filter((_, x) => x !== i),
                        })
                      }
                    >
                      <Trash2 className="h-3 w-3" /> Remover
                    </button>
                  )}
                </div>
              ))}
              <button
                type="button"
                onClick={() =>
                  setState({
                    ...state,
                    users: [
                      ...state.users,
                      { name: '', email: '', sector: '', role: 'atendente' },
                    ],
                  })
                }
                className="inline-flex items-center gap-2 rounded-lg border border-dashed border-slate-300 px-3 py-2 text-sm text-slate-600 hover:border-[#4F8EF7] hover:text-[#4F8EF7]"
              >
                <Plus className="h-4 w-4" /> Adicionar usuário
              </button>
            </div>
          </SectionBlock>
        )}

        {section === 2 && (
          <SectionBlock
            number={3}
            total={totalSections}
            title="Horários de atendimento"
            icon={<Clock className="h-5 w-5 text-[#4F8EF7]" />}
          >
            <div className="space-y-2">
              {state.schedule.map((s, i) => (
                <div
                  key={s.day}
                  className="flex flex-wrap items-center gap-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5"
                >
                  <label className="inline-flex w-32 items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={s.active}
                      onChange={(e) => {
                        const sched = [...state.schedule]
                        sched[i] = { ...sched[i], active: e.target.checked }
                        setState({ ...state, schedule: sched })
                      }}
                      className="h-4 w-4 accent-[#4F8EF7]"
                    />
                    <span className="font-medium">{s.day}</span>
                  </label>
                  {s.active ? (
                    <div className="flex items-center gap-2 text-sm">
                      <PlainInput
                        type="time"
                        value={s.start}
                        onChange={(v) => {
                          const sched = [...state.schedule]
                          sched[i] = { ...sched[i], start: v }
                          setState({ ...state, schedule: sched })
                        }}
                        className="w-28"
                      />
                      <span className="text-slate-400">—</span>
                      <PlainInput
                        type="time"
                        value={s.end}
                        onChange={(v) => {
                          const sched = [...state.schedule]
                          sched[i] = { ...sched[i], end: v }
                          setState({ ...state, schedule: sched })
                        }}
                        className="w-28"
                      />
                    </div>
                  ) : (
                    <span className="text-xs text-slate-400">Fechado</span>
                  )}
                </div>
              ))}
              <div>
                <Field label="Fuso horário">
                  <PlainSelect
                    value={state.timezone}
                    onChange={(v) => setState({ ...state, timezone: v })}
                    options={[
                      { value: 'America/Sao_Paulo', label: 'São Paulo (GMT-3)' },
                      { value: 'America/Manaus', label: 'Manaus (GMT-4)' },
                      { value: 'America/Rio_Branco', label: 'Rio Branco (GMT-5)' },
                      { value: 'America/Noronha', label: 'Fernando de Noronha (GMT-2)' },
                    ]}
                  />
                </Field>
              </div>
            </div>
          </SectionBlock>
        )}

        {section === 3 && (
          <SectionBlock
            number={4}
            total={totalSections}
            title="WhatsApp e integrações"
            icon={<Phone className="h-5 w-5 text-[#4F8EF7]" />}
          >
            <div className="space-y-4">
              <Field label="Número(s) do WhatsApp">
                <PlainTextarea
                  value={state.whatsappNumbers}
                  onChange={(v) => setState({ ...state, whatsappNumbers: v })}
                  placeholder="11999999999, 1133334444"
                  rows={2}
                />
                <p className="mt-1 text-xs text-slate-400">
                  Separe múltiplos por vírgula ou linha.
                </p>
              </Field>
              <Field label="Tipo de conexão">
                <PlainSelect
                  value={state.whatsappType}
                  onChange={(v) => setState({ ...state, whatsappType: v })}
                  options={[
                    { value: 'baileys', label: 'Baileys' },
                    { value: 'evolution', label: 'Evolution' },
                    { value: 'uazapi', label: 'Uazapi' },
                    { value: 'zapi', label: 'Z-API' },
                    { value: 'meow', label: 'Meow' },
                    { value: 'evo', label: 'Evo' },
                  ]}
                />
              </Field>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={state.useFacebook}
                  onChange={(e) =>
                    setState({ ...state, useFacebook: e.target.checked })
                  }
                  className="h-4 w-4 accent-[#4F8EF7]"
                />
                Vamos integrar Facebook/Instagram
              </label>
              {state.useFacebook && (
                <Field label="Token do Meta">
                  <PlainInput
                    value={state.facebookToken}
                    onChange={(v) => setState({ ...state, facebookToken: v })}
                    placeholder="EAA…"
                  />
                </Field>
              )}
            </div>
          </SectionBlock>
        )}

        {section === 4 && (
          <SectionBlock
            number={5}
            total={totalSections}
            title="Chatbot"
            icon={<MessageSquare className="h-5 w-5 text-[#4F8EF7]" />}
          >
            <div className="space-y-4">
              <Field label="Como será o fluxo principal de atendimento?">
                <PlainTextarea
                  value={state.mainFlow}
                  onChange={(v) => setState({ ...state, mainFlow: v })}
                  rows={5}
                  placeholder="Ex.: Saudação → menu de opções (Vendas, Suporte, Financeiro) → encaminhamento ao setor"
                />
              </Field>
              <Field label="Mensagem de saudação inicial">
                <PlainTextarea
                  value={state.greetingMessage}
                  onChange={(v) =>
                    setState({ ...state, greetingMessage: v })
                  }
                  rows={3}
                />
              </Field>
              <Field label="Mensagem fora do horário">
                <PlainTextarea
                  value={state.offHoursMessage}
                  onChange={(v) =>
                    setState({ ...state, offHoursMessage: v })
                  }
                  rows={3}
                />
              </Field>
              <Field label="Departamentos / categorias">
                <PlainTextarea
                  value={state.departments}
                  onChange={(v) => setState({ ...state, departments: v })}
                  rows={2}
                  placeholder="Vendas, Suporte, Financeiro…"
                />
              </Field>
            </div>
          </SectionBlock>
        )}

        {section === 5 && (
          <SectionBlock
            number={6}
            total={totalSections}
            title="Inteligência Artificial"
            icon={<Sparkles className="h-5 w-5 text-[#4F8EF7]" />}
          >
            <div className="space-y-4">
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={state.useAI}
                  onChange={(e) =>
                    setState({ ...state, useAI: e.target.checked })
                  }
                  className="h-4 w-4 accent-[#4F8EF7]"
                />
                Desejo usar IA no atendimento
              </label>
              {state.useAI && (
                <>
                  <Field label="Tom da IA">
                    <PlainSelect
                      value={state.aiTone}
                      onChange={(v) =>
                        setState({
                          ...state,
                          aiTone: v as BriefingFormState['aiTone'],
                        })
                      }
                      options={[
                        { value: 'formal', label: 'Formal' },
                        { value: 'casual', label: 'Casual' },
                        { value: 'tecnico', label: 'Técnico' },
                      ]}
                    />
                  </Field>
                  <Field label="Instruções principais">
                    <PlainTextarea
                      value={state.aiInstructions}
                      onChange={(v) =>
                        setState({ ...state, aiInstructions: v })
                      }
                      rows={4}
                    />
                  </Field>
                  <Field label="O que a IA NÃO deve fazer">
                    <PlainTextarea
                      value={state.aiRestrictions}
                      onChange={(v) =>
                        setState({ ...state, aiRestrictions: v })
                      }
                      rows={3}
                    />
                  </Field>
                </>
              )}
            </div>
          </SectionBlock>
        )}

        {section === 6 && (
          <SectionBlock
            number={7}
            total={totalSections}
            title="Observações finais"
            icon={<StickyNote className="h-5 w-5 text-[#4F8EF7]" />}
          >
            <Field label="Algo mais que devemos saber?">
              <PlainTextarea
                value={state.extraNotes}
                onChange={(v) => setState({ ...state, extraNotes: v })}
                rows={6}
              />
            </Field>
          </SectionBlock>
        )}
      </main>

      <footer className="fixed inset-x-0 bottom-0 z-30 border-t border-slate-200 bg-elevate/95 backdrop-blur">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-3 px-4 py-3 sm:px-6">
          <div className="flex flex-col">
            <span className="text-xs uppercase tracking-wider text-slate-400">
              Briefing
            </span>
            <span className="text-sm font-medium text-slate-900">
              Seção {section + 1} de {totalSections}
            </span>
            <div className="mt-1 h-1 w-32 overflow-hidden rounded-full bg-slate-200">
              <div
                className="h-full bg-[#4F8EF7] transition-all"
                style={{
                  width: `${((section + 1) / totalSections) * 100}%`,
                }}
              />
            </div>
          </div>
          <div className="flex items-center gap-2">
            {section > 0 && (
              <button
                type="button"
                onClick={prev}
                className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                Voltar
              </button>
            )}
            <button
              type="button"
              onClick={next}
              disabled={submitting}
              className="inline-flex items-center gap-2 rounded-lg bg-[#4F8EF7] px-4 py-2 text-sm font-medium text-foreground shadow-sm hover:bg-[#6BA0F9] disabled:cursor-not-allowed disabled:opacity-60"
            >
              {section === totalSections - 1 ? (
                <>
                  <Send className="h-4 w-4" /> {submitting ? 'Enviando…' : 'Enviar'}
                </>
              ) : (
                <>
                  Próxima <ArrowRight className="h-4 w-4" />
                </>
              )}
            </button>
          </div>
        </div>
      </footer>
    </div>
  )
}

function BriefingHeader({ companyName }: { companyName: string }) {
  return (
    <header className="border-b border-slate-200 bg-white">
      <div className="mx-auto flex max-w-3xl items-center justify-between px-4 py-4 sm:px-6">
        <div className="flex items-center gap-2">
          <div className="grid h-9 w-9 place-items-center rounded-lg bg-[#4F8EF7] text-foreground font-bold">
            T
          </div>
          <div className="leading-tight">
            <p className="text-sm font-semibold text-slate-900">TenantHub</p>
            <p className="text-xs text-slate-400">Briefing de onboarding</p>
          </div>
        </div>
        <div className="text-right text-xs text-slate-500">
          {asText(companyName, '—')}
        </div>
      </div>
    </header>
  )
}

function BriefingErrorPage() {
  return (
    <div className="grid min-h-screen place-items-center bg-slate-50 p-6 text-center">
      <div className="max-w-md rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
        <div className="mx-auto mb-3 grid h-12 w-12 place-items-center rounded-xl bg-rose-50 text-rose-500">
          <Trash2 className="h-6 w-6" />
        </div>
        <h1 className="text-lg font-semibold text-slate-900">
          Link inválido ou expirado
        </h1>
        <p className="mt-2 text-sm text-slate-500">
          Este link de briefing não existe mais. Entre em contato com o
          responsável pelo seu onboarding para receber um novo.
        </p>
      </div>
    </div>
  )
}

function BriefingSuccessPage({ company }: { company: string }) {
  return (
    <div className="grid min-h-screen place-items-center bg-slate-50 p-6 text-center">
      <div className="max-w-md rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
        <div className="mx-auto mb-3 grid h-14 w-14 place-items-center rounded-2xl bg-green-50 text-green-500">
          <Check className="h-7 w-7" />
        </div>
        <h1 className="text-lg font-semibold text-slate-900">
          Recebemos suas informações!
        </h1>
        <p className="mt-2 text-sm text-slate-500">
          Obrigado por preencher o briefing, {company || 'cliente'}. Nossa
          equipe revisará tudo e entrará em contato em breve.
        </p>
      </div>
    </div>
  )
}

function SectionBlock({
  number,
  total,
  title,
  description,
  icon,
  children,
}: {
  number: number
  total: number
  title: string
  description?: string
  icon: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
      <header className="mb-5 flex items-center gap-3">
        <div className="grid h-10 w-10 place-items-center rounded-lg bg-[#4F8EF7]/10 text-[#4F8EF7]">
          {icon}
        </div>
        <div>
          <p className="text-xs uppercase tracking-wider text-slate-400">
            Seção {number} de {total}
          </p>
          <h2 className="text-lg font-semibold text-slate-900">{title}</h2>
          {description && (
            <p className="text-sm text-slate-500">{description}</p>
          )}
        </div>
      </header>
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
    <label className="block">
      <span className="mb-1.5 block text-xs font-medium text-slate-600">
        {label}
      </span>
      {children}
    </label>
  )
}

function PlainInput({
  type = 'text',
  value,
  onChange,
  placeholder,
  className,
}: {
  type?: string
  value: string
  onChange: (v: string) => void
  placeholder?: string
  className?: string
}) {
  return (
    <input
      type={type}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className={cn(
        'block w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400',
        'focus:border-[#4F8EF7] focus:outline-none focus:ring-4 focus:ring-[#4F8EF7]/15',
        className,
      )}
    />
  )
}

function PlainTextarea({
  value,
  onChange,
  placeholder,
  rows = 3,
}: {
  value: string
  onChange: (v: string) => void
  placeholder?: string
  rows?: number
}) {
  return (
    <textarea
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      rows={rows}
      className="block w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-[#4F8EF7] focus:outline-none focus:ring-4 focus:ring-[#4F8EF7]/15"
    />
  )
}

function PlainSelect({
  value,
  onChange,
  options,
}: {
  value: string
  onChange: (v: string) => void
  options: { value: string; label: string }[]
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="block w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-[#4F8EF7] focus:outline-none focus:ring-4 focus:ring-[#4F8EF7]/15"
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  )
}

// Unused-import safety net
export const _globe = Globe
