import * as React from 'react'
import { useParams } from 'react-router-dom'
import {
  ArrowRight,
  Check,
  ChevronDown,
  Clock,
  Globe,
  HelpCircle,
  MessageSquare,
  Phone,
  Plus,
  Send,
  Sparkles,
  StickyNote,
  Trash2,
  Users,
  X,
  Zap,
} from 'lucide-react'
import { toast } from 'sonner'
import { api } from '@/services/api'
import { asText, cn } from '@/lib/utils'
import type {
  BriefingData,
  BriefingConfig,
  BriefingStatus,
  BriefingUser,
  BriefingUserRole,
  AiTone,
} from '@/types/client'

const DAYS = ['Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado', 'Domingo']

const SECTOR_EMOJIS = ['📈', '🛠️', '💰', '🎯', '📞', '💡', '🔧', '📋', '🎨', '🚀']

type SectionKey =
  | 'usuarios'
  | 'horarios'
  | 'integracoes'
  | 'chatbot'
  | 'ia'
  | 'automacao_externa'
  | 'observacoes'

function buildSections(cfg: BriefingConfig | null): SectionKey[] {
  const sections: SectionKey[] = ['usuarios', 'horarios', 'integracoes']
  if (!cfg) {
    sections.push('chatbot', 'ia', 'observacoes')
    return sections
  }
  if (cfg.automationTypes.includes('chatbot')) sections.push('chatbot')
  if (cfg.automationTypes.some((t) => t === 'ia_basica' || t === 'ia_avancada'))
    sections.push('ia')
  if (cfg.hasExternalAutomation) sections.push('automacao_externa')
  sections.push('observacoes')
  return sections
}

function buildGreeting(company: string, sectors: string[]): string {
  const menuItems = sectors.length > 0
    ? sectors
        .map((s, i) => `👉 ${i + 1} - ${s} ${SECTOR_EMOJIS[i] ?? '📌'}`)
        .join('\n')
    : '👉 1 - Comercial 📈\n👉 2 - Suporte Técnico 🛠️\n👉 3 - Financeiro 💰'

  return `Olá! Seja muito bem-vindo(a) à ${company || 'nossa empresa'}! ✨

É um prazer ter você aqui. Para que eu possa te direcionar para o atendimento ideal, por favor, escolha uma das opções abaixo:

${menuItems}

Clique em uma opção ou digite o número correspondente para continuar.`
}

function buildOffHours(company: string): string {
  return `Olá! Obrigado por entrar em contato com a ${company || 'nossa empresa'}! ✨

No momento, nossa equipe está fora do horário de expediente. Nosso atendimento acontece de Segunda a Sexta, das 08h às 18h.

Assim que nossa equipe retornar, entraremos em contato com você com total prioridade! 🗓️👋`
}

interface BriefingFormState {
  site: string
  sectors: string[]
  newSectorInput: string
  users: BriefingUser[]
  schedule: { day: string; active: boolean; start: string; end: string }[]
  timezone: string
  whatsappNumbers: string
  wavoipInfo: string
  olxInfo: string
  mercadolivreInfo: string
  emailConfig: string
  greetingMessage: string
  offHoursMessage: string
  greetingEditing: boolean
  offHoursEditing: boolean
  useAI: boolean
  aiTone: AiTone
  aiInstructions: string
  aiRestrictions: string
  externalAutomationInfo: string
  extraNotes: string
}

function initialFormState(company: string): BriefingFormState {
  return {
    site: '',
    sectors: [],
    newSectorInput: '',
    users: [{ name: '', email: '', sector: '', role: 'atendente' }],
    schedule: DAYS.map((day) => ({
      day,
      active: day !== 'Sábado' && day !== 'Domingo',
      start: '08:00',
      end: '18:00',
    })),
    timezone: 'America/Sao_Paulo',
    whatsappNumbers: '',
    wavoipInfo: '',
    olxInfo: '',
    mercadolivreInfo: '',
    emailConfig: '',
    greetingMessage: buildGreeting(company, []),
    offHoursMessage: buildOffHours(company),
    greetingEditing: false,
    offHoursEditing: false,
    useAI: false,
    aiTone: 'casual',
    aiInstructions: '',
    aiRestrictions: '',
    externalAutomationInfo: '',
    extraNotes: '',
  }
}

interface PublicClient {
  id: string
  name: string
  company: string
  briefing_status: BriefingStatus | null
  briefing_revision_note: string | null
  briefing_config: BriefingConfig | null
}

export function BriefingPublicPage() {
  const { token } = useParams<{ token: string }>()
  const [client, setClient] = React.useState<PublicClient | null | undefined>(undefined)
  const [state, setState] = React.useState<BriefingFormState>(initialFormState(''))
  const [section, setSection] = React.useState(0)
  const [submittedData, setSubmittedData] = React.useState<{ greeting: string; offHours: string } | null>(null)
  const [submitting, setSubmitting] = React.useState(false)

  React.useEffect(() => {
    if (!token) { setClient(null); return }
    let cancelled = false
    ;(async () => {
      try {
        const row = await api.get<PublicClient>(`/api/public/briefing/${token}`)
        if (cancelled) return
        setClient({
          id: row.id,
          name: row.name,
          company: row.company,
          briefing_status: row.briefing_status ?? null,
          briefing_revision_note: row.briefing_revision_note ?? null,
          briefing_config: row.briefing_config ?? null,
        })
        setState(initialFormState(row.company))
      } catch {
        if (cancelled) return
        setClient(null)
      }
    })()
    return () => { cancelled = true }
  }, [token])

  // Regenerate greeting when sectors change (if not being edited)
  React.useEffect(() => {
    if (!state.greetingEditing && client?.company) {
      setState((s) => ({
        ...s,
        greetingMessage: buildGreeting(client.company, s.sectors),
      }))
    }
  }, [state.sectors, state.greetingEditing, client?.company])

  const cfg = client?.briefing_config ?? null
  const sections = React.useMemo(() => buildSections(cfg), [cfg])
  const totalSections = sections.length
  const currentKey = sections[section]

  const needsSite =
    !cfg ||
    cfg.connectionTypes.includes('api_oficial') ||
    cfg.automationTypes.some((t) => t === 'ia_basica' || t === 'ia_avancada')

  if (client === undefined) {
    return (
      <div className="grid min-h-screen place-items-center bg-slate-50 text-sm text-slate-500">
        Carregando…
      </div>
    )
  }

  if (!token || !client) return <BriefingErrorPage />
  if (submittedData) return (
    <BriefingSuccessPage
      company={client.company}
      greeting={submittedData.greeting}
      offHours={submittedData.offHours}
    />
  )

  const submit = async () => {
    const data: BriefingData = {
      razaoSocial: client.company,
      nomeFantasia: client.company,
      cnpj: '',
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
      whatsappType: 'baileys',
      useFacebook: false,
      mainFlow: '',
      greetingMessage: state.greetingMessage.trim(),
      offHoursMessage: state.offHoursMessage.trim(),
      departments: state.sectors,
      useAI: state.useAI,
      aiTone: state.useAI ? state.aiTone : undefined,
      aiInstructions: state.useAI ? state.aiInstructions.trim() || undefined : undefined,
      aiRestrictions: state.useAI ? state.aiRestrictions.trim() || undefined : undefined,
      wavoipInfo: state.wavoipInfo.trim() || undefined,
      olxInfo: state.olxInfo.trim() || undefined,
      mercadolivreInfo: state.mercadolivreInfo.trim() || undefined,
      emailConfig: state.emailConfig.trim() || undefined,
      externalAutomationInfo: state.externalAutomationInfo.trim() || undefined,
      extraNotes: state.extraNotes.trim() || undefined,
      submittedAt: new Date().toISOString(),
    }
    setSubmitting(true)
    try {
      await api.post(`/api/public/briefing/${token}`, { data })
      setSubmittedData({
        greeting: state.greetingMessage,
        offHours: state.offHoursMessage,
      })
    } catch (err) {
      toast.error('Falha ao enviar: ' + (err instanceof Error ? err.message : 'Erro'))
    } finally {
      setSubmitting(false)
    }
  }

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

  const maxUsers = cfg?.maxUsers ?? 0

  const addSector = () => {
    const s = state.newSectorInput.trim()
    if (!s) return
    if (state.sectors.includes(s)) return
    setState((prev) => ({ ...prev, sectors: [...prev.sectors, s], newSectorInput: '' }))
  }

  const removeSector = (idx: number) => {
    setState((prev) => ({ ...prev, sectors: prev.sectors.filter((_, i) => i !== idx) }))
  }

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <BriefingHeader companyName={client.company} />

      <main className="mx-auto max-w-3xl px-4 pb-32 pt-8 sm:px-6">
        {client.briefing_revision_note && (
          <div className="mb-6 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
            <strong>Solicitação de revisão:</strong>{' '}
            {client.briefing_revision_note}
          </div>
        )}

        {/* ── Seção 1: Usuários e setores ── */}
        {currentKey === 'usuarios' && (
          <SectionBlock
            number={section + 1}
            total={totalSections}
            title="Usuários e setores"
            icon={<Users className="h-5 w-5 text-[#4F8EF7]" />}
            description="Primeiro crie os setores da sua empresa, depois cadastre quem vai usar o sistema."
          >
            <div className="space-y-6">
              {/* Site — only for API Oficial or IA */}
              {needsSite && (
                <div className="rounded-xl border border-blue-100 bg-blue-50 p-4">
                  <Field label="Site da empresa">
                    <PlainInput
                      value={state.site}
                      onChange={(v) => setState({ ...state, site: v })}
                      placeholder="https://www.suaempresa.com.br"
                    />
                  </Field>
                </div>
              )}

              {/* Setores */}
              <div>
                <div className="mb-3 flex items-center gap-2">
                  <h3 className="text-sm font-semibold text-slate-800">
                    1. Setores da empresa
                  </h3>
                  <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-500">
                    {state.sectors.length} criado(s)
                  </span>
                </div>
                <p className="mb-3 text-xs text-slate-500">
                  Adicione os departamentos que terão filas de atendimento (ex: Comercial, Suporte, Financeiro).
                </p>
                <div className="flex flex-wrap gap-2 mb-3">
                  {state.sectors.map((s, i) => (
                    <span
                      key={i}
                      className="inline-flex items-center gap-1.5 rounded-full bg-[#4F8EF7]/10 px-3 py-1 text-sm font-medium text-[#4F8EF7]"
                    >
                      {s}
                      <button
                        type="button"
                        onClick={() => removeSector(i)}
                        className="ml-0.5 rounded-full p-0.5 hover:bg-[#4F8EF7]/20"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </span>
                  ))}
                </div>
                <div className="flex gap-2">
                  <PlainInput
                    value={state.newSectorInput}
                    onChange={(v) => setState({ ...state, newSectorInput: v })}
                    placeholder="Ex: Comercial, Suporte, Financeiro…"
                    className="flex-1"
                    onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addSector() } }}
                  />
                  <button
                    type="button"
                    onClick={addSector}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-[#4F8EF7] px-3 py-2 text-sm font-medium text-white hover:bg-[#6BA0F9]"
                  >
                    <Plus className="h-4 w-4" /> Adicionar
                  </button>
                </div>
              </div>

              {/* Usuários */}
              <div>
                <div className="mb-3 flex items-center gap-2">
                  <h3 className="text-sm font-semibold text-slate-800">
                    2. Usuários do sistema
                  </h3>
                  {maxUsers > 0 && (
                    <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-500">
                      {state.users.length}/{maxUsers}
                    </span>
                  )}
                  <RoleInfoPopover />
                </div>

                <div className="space-y-3">
                  {state.users.map((u, i) => (
                    <div
                      key={i}
                      className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm"
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
                              placeholder="João Silva"
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
                              placeholder="joao@empresa.com"
                            />
                          </Field>
                        </div>
                        <div className="sm:col-span-3">
                          <Field label="Setor">
                            {state.sectors.length > 0 ? (
                              <PlainSelect
                                value={u.sector}
                                onChange={(v) => {
                                  const users = [...state.users]
                                  users[i] = { ...users[i], sector: v }
                                  setState({ ...state, users })
                                }}
                                options={[
                                  { value: '', label: 'Selecionar…' },
                                  ...state.sectors.map((s) => ({ value: s, label: s })),
                                ]}
                              />
                            ) : (
                              <PlainInput
                                value={u.sector}
                                onChange={(v) => {
                                  const users = [...state.users]
                                  users[i] = { ...users[i], sector: v }
                                  setState({ ...state, users })
                                }}
                                placeholder="Crie setores acima"
                              />
                            )}
                          </Field>
                        </div>
                        <div className="sm:col-span-2">
                          <Field label="Perfil">
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
                          className="mt-3 inline-flex items-center gap-1 text-xs text-rose-500 hover:underline"
                          onClick={() =>
                            setState({
                              ...state,
                              users: state.users.filter((_, x) => x !== i),
                            })
                          }
                        >
                          <Trash2 className="h-3 w-3" /> Remover usuário
                        </button>
                      )}
                    </div>
                  ))}

                  {(maxUsers === 0 || state.users.length < maxUsers) && (
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
                      className="inline-flex items-center gap-2 rounded-lg border border-dashed border-slate-300 px-4 py-2.5 text-sm text-slate-500 hover:border-[#4F8EF7] hover:text-[#4F8EF7]"
                    >
                      <Plus className="h-4 w-4" /> Adicionar usuário
                    </button>
                  )}
                  {maxUsers > 0 && state.users.length >= maxUsers && (
                    <p className="text-xs text-slate-400">
                      Limite de {maxUsers} usuário(s) atingido.
                    </p>
                  )}
                </div>
              </div>
            </div>
          </SectionBlock>
        )}

        {/* ── Seção: Horários ── */}
        {currentKey === 'horarios' && (
          <SectionBlock
            number={section + 1}
            total={totalSections}
            title="Horários de atendimento"
            icon={<Clock className="h-5 w-5 text-[#4F8EF7]" />}
          >
            <div className="space-y-2">
              {state.schedule.map((s, i) => (
                <div
                  key={s.day}
                  className="flex flex-wrap items-center gap-3 rounded-lg border border-slate-200 bg-white px-3 py-2.5"
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
              <div className="mt-2">
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

        {/* ── Seção: Canais ── */}
        {currentKey === 'integracoes' && (
          <SectionBlock
            number={section + 1}
            total={totalSections}
            title="Números e canais"
            icon={<Phone className="h-5 w-5 text-[#4F8EF7]" />}
            description="Informe quais números de WhatsApp vamos conectar ao sistema."
          >
            <div className="space-y-4">
              {/* WhatsApp */}
              <div className="rounded-xl border border-slate-200 bg-white p-4">
                <h3 className="mb-3 text-sm font-semibold text-slate-800">WhatsApp</h3>
                <Field label="Número(s) que vamos conectar">
                  <PlainTextarea
                    value={state.whatsappNumbers}
                    onChange={(v) => setState({ ...state, whatsappNumbers: v })}
                    placeholder={'(11) 99999-9999\n(11) 3333-4444'}
                    rows={3}
                  />
                  <p className="mt-1 text-xs text-slate-400">
                    Um número por linha ou separados por vírgula. Inclua o DDD.
                  </p>
                </Field>
              </div>

              {/* WaVoip */}
              {cfg?.channels.includes('wavoip') && (
                <div className="rounded-xl border border-slate-200 bg-white p-4">
                  <h3 className="mb-3 text-sm font-semibold text-slate-800">WaVoip</h3>
                  <Field label="Informações da conta WaVoip">
                    <PlainTextarea
                      value={state.wavoipInfo}
                      onChange={(v) => setState({ ...state, wavoipInfo: v })}
                      placeholder="Usuário, token ou demais dados de acesso WaVoip"
                      rows={3}
                    />
                  </Field>
                </div>
              )}

              {/* OLX */}
              {cfg?.channels.includes('olx') && (
                <div className="rounded-xl border border-slate-200 bg-white p-4">
                  <h3 className="mb-3 text-sm font-semibold text-slate-800">OLX</h3>
                  <Field label="Informações da conta OLX">
                    <PlainTextarea
                      value={state.olxInfo}
                      onChange={(v) => setState({ ...state, olxInfo: v })}
                      placeholder="E-mail, token ou dados de acesso OLX"
                      rows={3}
                    />
                  </Field>
                </div>
              )}

              {/* Mercado Livre */}
              {cfg?.channels.includes('mercadolivre') && (
                <div className="rounded-xl border border-slate-200 bg-white p-4">
                  <h3 className="mb-3 text-sm font-semibold text-slate-800">Mercado Livre</h3>
                  <Field label="Informações da conta Mercado Livre">
                    <PlainTextarea
                      value={state.mercadolivreInfo}
                      onChange={(v) => setState({ ...state, mercadolivreInfo: v })}
                      placeholder="Usuário, token ou dados de acesso Mercado Livre"
                      rows={3}
                    />
                  </Field>
                </div>
              )}

              {/* E-mail */}
              {cfg?.channels.includes('email') && (
                <div className="rounded-xl border border-slate-200 bg-white p-4">
                  <h3 className="mb-3 text-sm font-semibold text-slate-800">E-mail</h3>
                  <Field label="Configurações de e-mail">
                    <PlainTextarea
                      value={state.emailConfig}
                      onChange={(v) => setState({ ...state, emailConfig: v })}
                      placeholder="Endereço, servidor SMTP, credenciais…"
                      rows={3}
                    />
                  </Field>
                </div>
              )}
            </div>
          </SectionBlock>
        )}

        {/* ── Seção: Chatbot ── */}
        {currentKey === 'chatbot' && (
          <SectionBlock
            number={section + 1}
            total={totalSections}
            title="Chatbot"
            icon={<MessageSquare className="h-5 w-5 text-[#4F8EF7]" />}
            description="Configuração das mensagens automáticas do chatbot."
          >
            <div className="space-y-6">
              {/* Mensagem de saudação */}
              <div>
                <div className="mb-2 flex items-center justify-between">
                  <label className="text-xs font-medium text-slate-600">
                    Mensagem de saudação
                  </label>
                  <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-700">
                    Demonstrativo — será configurado pelo nosso time
                  </span>
                </div>

                {!state.greetingEditing ? (
                  <div className="relative rounded-xl border border-[#4F8EF7]/20 bg-[#4F8EF7]/5 p-4">
                    <pre className="whitespace-pre-wrap font-sans text-sm text-slate-700 leading-relaxed">
                      {state.greetingMessage}
                    </pre>
                    <button
                      type="button"
                      onClick={() => setState({ ...state, greetingEditing: true })}
                      className="mt-3 inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50"
                    >
                      Personalizar mensagem
                    </button>
                  </div>
                ) : (
                  <div>
                    <PlainTextarea
                      value={state.greetingMessage}
                      onChange={(v) => setState({ ...state, greetingMessage: v })}
                      rows={8}
                    />
                    <button
                      type="button"
                      onClick={() => {
                        setState({
                          ...state,
                          greetingEditing: false,
                          greetingMessage: buildGreeting(client.company, state.sectors),
                        })
                      }}
                      className="mt-2 text-xs text-[#4F8EF7] hover:underline"
                    >
                      Restaurar mensagem padrão
                    </button>
                  </div>
                )}
              </div>

              {/* Mensagem fora do horário */}
              <div>
                <div className="mb-2 flex items-center justify-between">
                  <label className="text-xs font-medium text-slate-600">
                    Mensagem fora do horário de atendimento
                  </label>
                  <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-700">
                    Demonstrativo
                  </span>
                </div>

                {!state.offHoursEditing ? (
                  <div className="relative rounded-xl border border-slate-200 bg-slate-50 p-4">
                    <pre className="whitespace-pre-wrap font-sans text-sm text-slate-700 leading-relaxed">
                      {state.offHoursMessage}
                    </pre>
                    <button
                      type="button"
                      onClick={() => setState({ ...state, offHoursEditing: true })}
                      className="mt-3 inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50"
                    >
                      Personalizar mensagem
                    </button>
                  </div>
                ) : (
                  <div>
                    <PlainTextarea
                      value={state.offHoursMessage}
                      onChange={(v) => setState({ ...state, offHoursMessage: v })}
                      rows={6}
                    />
                    <button
                      type="button"
                      onClick={() => {
                        setState({
                          ...state,
                          offHoursEditing: false,
                          offHoursMessage: buildOffHours(client.company),
                        })
                      }}
                      className="mt-2 text-xs text-[#4F8EF7] hover:underline"
                    >
                      Restaurar mensagem padrão
                    </button>
                  </div>
                )}
              </div>
            </div>
          </SectionBlock>
        )}

        {/* ── Seção: IA ── */}
        {currentKey === 'ia' && (
          <SectionBlock
            number={section + 1}
            total={totalSections}
            title="Inteligência Artificial"
            icon={<Sparkles className="h-5 w-5 text-[#4F8EF7]" />}
            description={
              cfg?.automationTypes.includes('ia_avancada')
                ? 'Configuração de IA avançada para atendimento autônomo.'
                : 'Configuração de IA para apoiar o atendimento.'
            }
          >
            <div className="space-y-4">
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={state.useAI}
                  onChange={(e) => setState({ ...state, useAI: e.target.checked })}
                  className="h-4 w-4 accent-[#4F8EF7]"
                />
                Desejo usar IA no atendimento
              </label>
              {state.useAI && (
                <>
                  <Field label="Tom da IA">
                    <PlainSelect
                      value={state.aiTone}
                      onChange={(v) => setState({ ...state, aiTone: v as AiTone })}
                      options={[
                        { value: 'formal', label: 'Formal' },
                        { value: 'casual', label: 'Casual' },
                        { value: 'tecnico', label: 'Técnico' },
                      ]}
                    />
                  </Field>
                  <Field label="Instruções principais para a IA">
                    <PlainTextarea
                      value={state.aiInstructions}
                      onChange={(v) => setState({ ...state, aiInstructions: v })}
                      rows={4}
                      placeholder="Descreva o que a IA deve fazer, o perfil da empresa, produtos/serviços…"
                    />
                  </Field>
                  <Field label="O que a IA NÃO deve fazer">
                    <PlainTextarea
                      value={state.aiRestrictions}
                      onChange={(v) => setState({ ...state, aiRestrictions: v })}
                      rows={3}
                      placeholder="Ex.: Não citar concorrentes, não dar preços sem consultar um atendente…"
                    />
                  </Field>
                </>
              )}
            </div>
          </SectionBlock>
        )}

        {/* ── Seção: Automação externa ── */}
        {currentKey === 'automacao_externa' && (
          <SectionBlock
            number={section + 1}
            total={totalSections}
            title="Automação externa"
            icon={<Zap className="h-5 w-5 text-[#4F8EF7]" />}
            description={
              cfg?.externalAutomationNotes ??
              'Precisamos de algumas informações sobre a automação externa que será integrada.'
            }
          >
            <Field label="Informações necessárias para a automação">
              <PlainTextarea
                value={state.externalAutomationInfo}
                onChange={(v) => setState({ ...state, externalAutomationInfo: v })}
                rows={6}
                placeholder="Descreva as integrações, credenciais ou dados que serão necessários…"
              />
            </Field>
          </SectionBlock>
        )}

        {/* ── Seção: Observações ── */}
        {currentKey === 'observacoes' && (
          <SectionBlock
            number={section + 1}
            total={totalSections}
            title="Observações finais"
            icon={<StickyNote className="h-5 w-5 text-[#4F8EF7]" />}
          >
            <Field label="Algo mais que devemos saber?">
              <PlainTextarea
                value={state.extraNotes}
                onChange={(v) => setState({ ...state, extraNotes: v })}
                rows={6}
                placeholder="Informações adicionais, preferências, dúvidas…"
              />
            </Field>
          </SectionBlock>
        )}
      </main>

      <footer className="fixed inset-x-0 bottom-0 z-30 border-t border-slate-200 bg-white/95 backdrop-blur">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-3 px-4 py-3 sm:px-6">
          <div className="flex flex-col">
            <span className="text-xs uppercase tracking-wider text-slate-400">Briefing</span>
            <span className="text-sm font-medium text-slate-900">
              Seção {section + 1} de {totalSections}
            </span>
            <div className="mt-1 h-1 w-32 overflow-hidden rounded-full bg-slate-200">
              <div
                className="h-full bg-[#4F8EF7] transition-all"
                style={{ width: `${((section + 1) / totalSections) * 100}%` }}
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
              className="inline-flex items-center gap-2 rounded-lg bg-[#4F8EF7] px-5 py-2 text-sm font-medium text-white shadow-sm hover:bg-[#6BA0F9] disabled:cursor-not-allowed disabled:opacity-60"
            >
              {section === totalSections - 1 ? (
                <>
                  <Send className="h-4 w-4" /> {submitting ? 'Enviando…' : 'Enviar briefing'}
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

// ── Info popover para perfis de usuário ──
function RoleInfoPopover() {
  const [open, setOpen] = React.useState(false)
  const ref = React.useRef<HTMLDivElement>(null)

  React.useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="grid h-5 w-5 place-items-center rounded-full border border-slate-300 text-slate-400 hover:border-[#4F8EF7] hover:text-[#4F8EF7]"
      >
        <HelpCircle className="h-3.5 w-3.5" />
      </button>
      {open && (
        <div className="absolute left-0 top-7 z-50 w-80 rounded-xl border border-slate-200 bg-white p-4 shadow-xl text-xs text-slate-700 space-y-3">
          <p className="font-semibold text-slate-900 text-sm">Sobre os campos</p>
          <div className="space-y-1.5">
            <p><strong>Nome:</strong> nome do usuário que vai utilizar a ferramenta</p>
            <p><strong>E-mail:</strong> e-mail de acesso ao sistema</p>
            <p><strong>Senha:</strong> será definida pela nossa equipe — o usuário poderá alterar após o primeiro acesso</p>
            <p><strong>Setor:</strong> qual fila de atendimento o usuário terá acesso</p>
          </div>
          <hr className="border-slate-100" />
          <div className="space-y-2">
            <p className="font-semibold text-slate-900">Perfis de acesso</p>
            <div>
              <span className="font-medium text-slate-800">Atendente —</span>{' '}
              acesso somente aos próprios atendimentos do setor. Acesso restrito a configurações.
            </div>
            <div>
              <span className="font-medium text-slate-800">Supervisor —</span>{' '}
              acesso geral a conversas e relatórios, mas não pode gerenciar usuários nem alterar configurações gerais.
            </div>
            <div>
              <span className="font-medium text-slate-800">Administrador —</span>{' '}
              acesso total: todas as conversas, números, configurações e usuários.
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function BriefingHeader({ companyName }: { companyName: string }) {
  return (
    <header className="border-b border-slate-200 bg-white shadow-sm">
      <div className="mx-auto flex max-w-3xl items-center justify-between px-4 py-4 sm:px-6">
        <div className="flex items-center gap-2">
          <div className="grid h-9 w-9 place-items-center rounded-lg bg-[#4F8EF7] font-bold text-white">
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
        <h1 className="text-lg font-semibold text-slate-900">Link inválido ou expirado</h1>
        <p className="mt-2 text-sm text-slate-500">
          Este link de briefing não existe mais. Entre em contato com o responsável pelo
          seu onboarding para receber um novo.
        </p>
      </div>
    </div>
  )
}

function BriefingSuccessPage({
  company,
  greeting,
  offHours,
}: {
  company: string
  greeting: string
  offHours: string
}) {
  return (
    <div className="min-h-screen bg-slate-50 p-6">
      <div className="mx-auto max-w-2xl space-y-6">
        {/* Confirmação */}
        <div className="rounded-2xl border border-slate-200 bg-white p-8 shadow-sm text-center">
          <div className="mx-auto mb-3 grid h-14 w-14 place-items-center rounded-2xl bg-green-50 text-green-500">
            <Check className="h-7 w-7" />
          </div>
          <h1 className="text-lg font-semibold text-slate-900">Recebemos suas informações!</h1>
          <p className="mt-2 text-sm text-slate-500">
            Obrigado por preencher o briefing, {company || 'cliente'}. Nossa equipe revisará
            tudo e entrará em contato em breve.
          </p>
        </div>

        {/* Mensagens enviadas */}
        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm space-y-5">
          <h2 className="text-sm font-semibold text-slate-800 flex items-center gap-2">
            <MessageSquare className="h-4 w-4 text-[#4F8EF7]" />
            Mensagens configuradas
          </h2>

          <div>
            <p className="mb-2 text-xs font-medium text-slate-500 uppercase tracking-wider">
              Saudação
            </p>
            <div className="rounded-xl border border-[#4F8EF7]/20 bg-[#4F8EF7]/5 p-4">
              <pre className="whitespace-pre-wrap font-sans text-sm text-slate-700 leading-relaxed">
                {greeting}
              </pre>
            </div>
          </div>

          <div>
            <p className="mb-2 text-xs font-medium text-slate-500 uppercase tracking-wider">
              Fora do horário de atendimento
            </p>
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
              <pre className="whitespace-pre-wrap font-sans text-sm text-slate-700 leading-relaxed">
                {offHours}
              </pre>
            </div>
          </div>

          <p className="text-xs text-slate-400">
            Essas mensagens serão configuradas pelo nosso time durante a implementação. Você poderá personalizá-las depois.
          </p>
        </div>
      </div>
    </div>
  )
}

function SectionBlock({
  number, total, title, description, icon, children,
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
        <div className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-[#4F8EF7]/10 text-[#4F8EF7]">
          {icon}
        </div>
        <div>
          <p className="text-xs uppercase tracking-wider text-slate-400">
            Seção {number} de {total}
          </p>
          <h2 className="text-lg font-semibold text-slate-900">{title}</h2>
          {description && <p className="text-sm text-slate-500">{description}</p>}
        </div>
      </header>
      {children}
    </section>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-medium text-slate-600">{label}</span>
      {children}
    </label>
  )
}

function PlainInput({
  type = 'text', value, onChange, placeholder, className, onKeyDown,
}: {
  type?: string
  value: string
  onChange: (v: string) => void
  placeholder?: string
  className?: string
  onKeyDown?: (e: React.KeyboardEvent<HTMLInputElement>) => void
}) {
  return (
    <input
      type={type}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      onKeyDown={onKeyDown}
      className={cn(
        'block w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400',
        'focus:border-[#4F8EF7] focus:outline-none focus:ring-4 focus:ring-[#4F8EF7]/15',
        className,
      )}
    />
  )
}

function PlainTextarea({
  value, onChange, placeholder, rows = 3,
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
  value, onChange, options,
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
        <option key={o.value} value={o.value}>{o.label}</option>
      ))}
    </select>
  )
}

// Unused-import safety net
export const _globe = Globe
export const _chevronDown = ChevronDown
