import * as React from 'react'
import { useParams } from 'react-router-dom'
import {
  ArrowLeft,
  ArrowRight,
  BatteryFull,
  Check,
  ChevronDown,
  Clock,
  Globe,
  HelpCircle,
  Lightbulb,
  MessageSquare,
  MoreVertical,
  Pencil,
  Phone,
  Plus,
  Send,
  SignalHigh,
  Sparkles,
  StickyNote,
  Trash2,
  Users,
  Video,
  Wifi,
  X,
  Zap,
} from 'lucide-react'
import { toast } from 'sonner'
import { api } from '@/services/api'
import {
  fetchPublicBriefingTemplate,
  type BriefingCustomQuestion,
  type BriefingFieldOverride,
} from '@/services/briefingTemplate'
import { asText, cn, initials } from '@/lib/utils'
import type {
  BriefingData,
  BriefingConfig,
  BriefingChannel,
  BriefingStatus,
  BriefingUser,
  BriefingUserRole,
  AiTone,
} from '@/types/client'

const DAYS = ['Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado', 'Domingo']

// Quantidade de "caixinhas" pra números de WhatsApp — configurável por cliente
// (briefingConfig.maxWhatsappNumbers, default 6). Caixinhas vazias não entram no envio.
const DEFAULT_WHATSAPP_NUMBER_SLOTS = 6
function padWhatsappNumbers(numbers: string[], slots: number = DEFAULT_WHATSAPP_NUMBER_SLOTS): string[] {
  const padded = numbers.slice(0, slots)
  while (padded.length < slots) padded.push('')
  return padded
}

const NUMBER_EMOJIS = ['1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣', '6️⃣', '7️⃣', '8️⃣', '9️⃣', '🔟']
function numberEmoji(i: number): string {
  return NUMBER_EMOJIS[i] ?? `${i + 1}.`
}

/** Valida e-mail: um @, sem espaços, com domínio. */
function isValidEmail(email: string): boolean {
  const e = email.trim()
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)
}

/**
 * Canais que exigem credenciais de acesso (e-mail/usuário + senha) do cliente.
 * Só aparecem no briefing quando habilitados na config do cliente.
 */
const CREDENTIAL_CHANNELS: { key: BriefingChannel; label: string }[] = [
  { key: 'instagram', label: 'Instagram' },
  { key: 'messenger', label: 'Facebook / Messenger' },
  { key: 'olx', label: 'OLX' },
  { key: 'mercadolivre', label: 'Mercado Livre' },
]

/** Remove canais sem nenhum dado preenchido antes de enviar. */
function cleanChannelAccess(
  raw: Record<string, { email?: string; password?: string; notes?: string }>,
): Record<string, { email?: string; password?: string; notes?: string }> | undefined {
  const out: Record<string, { email?: string; password?: string; notes?: string }> = {}
  for (const [key, v] of Object.entries(raw)) {
    const email = v.email?.trim()
    const password = v.password?.trim()
    const notes = v.notes?.trim()
    if (email || password || notes) {
      out[key] = {
        ...(email ? { email } : {}),
        ...(password ? { password } : {}),
        ...(notes ? { notes } : {}),
      }
    }
  }
  return Object.keys(out).length > 0 ? out : undefined
}

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

/** Um campo obrigatório faltando/ inválido: em qual seção, a chave do campo e a mensagem. */
interface BriefingFieldError {
  section: SectionKey
  key: string
  message: string
}

/**
 * Valida o briefing inteiro respeitando as seções condicionais da config.
 * Retorna os erros na ordem das seções (o primeiro é o mais "acima" no fluxo).
 * Só exige campos de seções que se aplicam àquele cliente.
 */
function validateBriefing(
  state: BriefingFormState,
  cfg: BriefingConfig | null,
  sections: SectionKey[],
): BriefingFieldError[] {
  const errs: BriefingFieldError[] = []
  const isIA = sections.includes('ia')
  const isAdvancedAI = Boolean(cfg?.automationTypes.includes('ia_avancada'))
  const isApiOficial = Boolean(cfg?.connectionTypes.includes('api_oficial'))

  // ── Sempre: setores ──
  if (state.sectors.length === 0) {
    errs.push({
      section: 'usuarios',
      key: 'sectors',
      message: 'Crie ao menos um setor — mesmo que seja só um time cuidando de tudo.',
    })
  }

  // ── Sempre: usuários ──
  // Qualquer linha com algum dado preenchido precisa de e-mail válido.
  const badEmail = state.users.find(
    (u) => (u.name.trim() || u.email.trim()) && !isValidEmail(u.email),
  )
  // Pelo menos 1 usuário completo: nome + e-mail válido + ao menos 1 setor.
  const completeUsers = state.users.filter(
    (u) => u.name.trim() && isValidEmail(u.email) && (u.sectors?.length ?? 0) > 0,
  )
  // E-mail não pode se repetir entre usuários (cada usuário = um login único).
  const emailCounts = new Map<string, number>()
  for (const u of state.users) {
    const e = u.email.trim().toLowerCase()
    if (e) emailCounts.set(e, (emailCounts.get(e) ?? 0) + 1)
  }
  const dupEmail = [...emailCounts.entries()].find(([, n]) => n > 1)?.[0]
  if (badEmail) {
    errs.push({
      section: 'usuarios',
      key: 'users',
      message: 'Há um e-mail de usuário inválido — use o formato nome@empresa.com (sem espaços).',
    })
  } else if (dupEmail) {
    errs.push({
      section: 'usuarios',
      key: 'users',
      message: `O e-mail "${dupEmail}" está repetido em mais de um usuário. Cada usuário precisa de um e-mail diferente.`,
    })
  } else if (completeUsers.length === 0) {
    errs.push({
      section: 'usuarios',
      key: 'users',
      message: 'Cadastre ao menos 1 usuário com nome, e-mail válido e setor.',
    })
  }

  // ── Sempre: horários ──
  if (!state.schedule.some((s) => s.active)) {
    errs.push({
      section: 'horarios',
      key: 'schedule',
      message: 'Marque ao menos um dia de atendimento.',
    })
  }

  // ── Condicional: API Oficial exige acesso ao Facebook/Meta + dados da Meta ──
  if (isApiOficial) {
    if (!state.facebookEmail.trim())
      errs.push({ section: 'integracoes', key: 'facebookEmail', message: 'Informe o e-mail do Facebook/Meta.' })
    if (!state.facebookPassword.trim())
      errs.push({ section: 'integracoes', key: 'facebookPassword', message: 'Informe a senha do Facebook/Meta.' })
  }

  // ── Condicional: IA (básica ou avançada) ──
  if (isIA) {
    if (!state.aiAgentName.trim())
      errs.push({ section: 'ia', key: 'aiAgentName', message: 'Dê um nome ao agente de IA.' })
    if (!state.aiCompanyDescription.trim())
      errs.push({ section: 'ia', key: 'aiCompanyDescription', message: 'Descreva o que a empresa faz.' })
    if (!state.aiServices.trim())
      errs.push({ section: 'ia', key: 'aiServices', message: 'Liste os principais serviços/produtos.' })
    if (!state.aiAttendanceFlow.trim())
      errs.push({ section: 'ia', key: 'aiAttendanceFlow', message: 'Explique como a IA deve conduzir a conversa.' })
    if (!state.aiTransferConditions.trim())
      errs.push({ section: 'ia', key: 'aiTransferConditions', message: 'Diga quando a IA deve transferir para um humano.' })
    // IA avançada consulta um sistema externo — precisa saber o que consultar.
    if (isAdvancedAI && !state.aiExternalWhatToQuery.trim())
      errs.push({ section: 'ia', key: 'aiExternalWhatToQuery', message: 'Informe o que a IA precisa consultar no sistema externo.' })
  }

  // ── Condicional: automação externa ──
  if (sections.includes('automacao_externa') && !state.externalAutomationInfo.trim()) {
    errs.push({
      section: 'automacao_externa',
      key: 'externalAutomationInfo',
      message: 'Descreva as informações necessárias para a automação externa.',
    })
  }

  // ── Condicional: chatbot (roteiro) ──
  if (sections.includes('chatbot') && state.chatbotFlowMode !== 'none') {
    if (!state.chatbotDescription.trim())
      errs.push({ section: 'chatbot', key: 'chatbotDescription', message: 'Descreva como o atendimento do chatbot deve funcionar.' })
    if (state.chatbotFlowMode === 'menu') {
      const hasMenu = state.chatbotMenus.some(
        (m) => m.question.trim() && m.options.split('\n').some((o) => o.trim()),
      )
      if (!hasMenu)
        errs.push({ section: 'chatbot', key: 'chatbotMenus', message: 'Adicione ao menos 1 menu com pergunta e opções.' })
    } else if (!state.chatbotMenus[0]?.question.trim()) {
      errs.push({ section: 'chatbot', key: 'chatbotMenus', message: 'Escreva a mensagem de boas-vindas.' })
    }
  }

  return errs
}

function buildGreeting(company: string, sectors: string[]): string {
  const menuItems = sectors.length > 0
    ? sectors.map((s, i) => `${numberEmoji(i)} ${s}`).join('\n')
    : '1️⃣ Comercial\n2️⃣ Suporte Técnico\n3️⃣ Financeiro'

  return `Olá! Seja muito bem-vindo(a) à ${company || 'nossa empresa'}! ✨

É um prazer ter você aqui. Para que eu possa te direcionar para o atendimento ideal, por favor, escolha uma das opções abaixo:

${menuItems}

Clique em uma opção ou digite o número correspondente para continuar.`
}

/** Resumo dos dias/horários ativos, pro corpo da mensagem de fora do horário. */
function scheduleSummary(schedule: { day: string; active: boolean; start: string; end: string }[]): string {
  const active = schedule.filter((s) => s.active)
  if (active.length === 0) return 'No momento não temos atendimento configurado.'

  const dayIndexes = active.map((s) => DAYS.indexOf(s.day))
  const isContiguous = dayIndexes.every((idx, i) => i === 0 || idx === dayIndexes[i - 1] + 1)

  // Dias abertos não formam um intervalo seguido (ex.: Segunda, Quarta e Sexta) —
  // um "de X a Y" sugeriria dias fechados como abertos, então lista um a um.
  if (!isContiguous) {
    const lines = active.map((s) => `${s.day}: ${s.start} às ${s.end}`).join('\n')
    return `Nosso atendimento acontece nos seguintes horários:\n${lines}`
  }

  const dayLabel = active.length > 1 ? `${active[0].day} a ${active[active.length - 1].day}` : active[0].day

  // Horário mais comum dentro do intervalo — quem foge disso vira "exceto" em vez de
  // quebrar o intervalo (ex.: "de Segunda a Sexta, das 08:00 às 18:00, exceto terça-feira").
  const counts = new Map<string, number>()
  for (const s of active) {
    const key = `${s.start}|${s.end}`
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  const [modeKey] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]
  const [modeStart, modeEnd] = modeKey.split('|')
  const exceptions = active.filter((s) => `${s.start}|${s.end}` !== modeKey)

  const base = `Nosso atendimento acontece de ${dayLabel}, das ${modeStart} às ${modeEnd}`
  if (exceptions.length === 0) return `${base}.`

  const exceptionText = exceptions.map((s) => `${s.day} (${s.start} às ${s.end})`).join(', ')
  return `${base}, exceto ${exceptionText}.`
}

function buildOffHours(
  company: string,
  schedule: { day: string; active: boolean; start: string; end: string }[],
): string {
  return `Olá! Obrigado por entrar em contato com a ${company || 'nossa empresa'}! ✨

No momento, nossa equipe está fora do horário de expediente. ${scheduleSummary(schedule)}

Assim que nossa equipe retornar, entraremos em contato com você com total prioridade! 🗓️👋`
}

interface BriefingFormState {
  site: string
  sectors: string[]
  newSectorInput: string
  users: BriefingUser[]
  schedule: { day: string; active: boolean; start: string; end: string }[]
  timezone: string
  // Sempre 6 posições fixas (caixinha por número) — vazias = não preenchidas.
  whatsappNumbers: string[]
  facebookEmail: string
  facebookPassword: string
  wavoipInfo: string
  emailConfig: string
  channelAccess: Record<string, { email?: string; password?: string; notes?: string }>
  greetingMessage: string
  offHoursMessage: string
  offHoursEnabled: boolean
  // true depois que o cliente edita a mensagem manualmente — nesse ponto ela para de
  // se regenerar sozinha quando os dias/horários da Seção 2 mudam.
  offHoursCustomized: boolean
  greetingEditing: boolean
  greetingGenerated: boolean
  // Roteiro do chatbot (base da geração automática do fluxo)
  chatbotDescription: string
  // Como o primeiro contato funciona: menu de opções, só uma mensagem de boas-vindas
  // (sem opções), ou nenhuma mensagem automática.
  chatbotFlowMode: 'menu' | 'greeting_only' | 'none'
  // Preferência de interação do menu: opções digitadas por número, ou botões clicáveis.
  chatbotMenuStyle: 'numbered' | 'buttons'
  chatbotMenus: { question: string; options: string; parentOption?: string }[] // options: uma por linha
  chatbotCollect: string // uma por linha
  chatbotTransfers: { option: string; department: string }[]
  chatbotClosing: string
  useAI: boolean
  aiTone: AiTone
  aiAgentName: string
  aiCompanyDescription: string
  aiServices: string
  aiHasPrices: boolean
  aiPrices: string
  aiLocation: string
  aiSocialMedia: string
  aiAttendanceFlow: string
  aiTransferConditions: string
  aiRestrictions: string
  // IA — perguntas complementares (todas opcionais)
  aiAddress: string
  aiSlogan: string
  aiMostSought: string
  aiPartnerships: string
  aiPaymentMethods: string
  aiPromotions: string
  aiFirstMessage: string
  aiSchedulingData: string
  aiPostDataMessage: string
  aiExistingClient: string
  aiWhenUnknown: string
  aiFaq: string
  // IA Avançada
  aiExternalSystem: string
  aiExternalApiUrl: string
  aiExternalWhatToQuery: string
  aiExternalAuth: string
  aiExternalExamples: string
  externalAutomationInfo: string
  extraNotes: string
  // Respostas das perguntas de texto livre novas, adicionadas pelo admin (ver
  // src/services/briefingTemplate.ts). Chave = fieldKey de briefing_custom_questions.
  customAnswers: Record<string, string>
}

function initialFormState(
  company: string,
  whatsappNumberSlots: number = DEFAULT_WHATSAPP_NUMBER_SLOTS,
): BriefingFormState {
  const defaultSchedule = DAYS.map((day) => ({
    day,
    active: day !== 'Sábado' && day !== 'Domingo',
    start: '08:00',
    end: '18:00',
  }))
  return {
    site: '',
    sectors: [],
    newSectorInput: '',
    users: [{ name: '', email: '', sectors: [], role: 'atendente' }],
    schedule: defaultSchedule,
    timezone: 'America/Sao_Paulo',
    whatsappNumbers: padWhatsappNumbers([], whatsappNumberSlots),
    facebookEmail: '',
    facebookPassword: '',
    wavoipInfo: '',
    emailConfig: '',
    channelAccess: {},
    greetingMessage: buildGreeting(company, []),
    offHoursMessage: buildOffHours(company, defaultSchedule),
    offHoursEnabled: true,
    offHoursCustomized: false,
    greetingEditing: false,
    greetingGenerated: false,
    chatbotDescription: '',
    chatbotFlowMode: 'menu',
    chatbotMenuStyle: 'numbered',
    chatbotMenus: [{ question: '', options: '' }],
    chatbotCollect: '',
    chatbotTransfers: [],
    chatbotClosing: '',
    useAI: false,
    aiTone: 'casual',
    aiAgentName: '',
    aiCompanyDescription: '',
    aiServices: '',
    aiHasPrices: false,
    aiPrices: '',
    aiLocation: '',
    aiSocialMedia: '',
    aiAttendanceFlow: '',
    aiTransferConditions: '',
    aiRestrictions: '',
    aiAddress: '',
    aiSlogan: '',
    aiMostSought: '',
    aiPartnerships: '',
    aiPaymentMethods: '',
    aiPromotions: '',
    aiFirstMessage: '',
    aiSchedulingData: '',
    aiPostDataMessage: '',
    aiExistingClient: '',
    aiWhenUnknown: '',
    aiFaq: '',
    aiExternalSystem: '',
    aiExternalApiUrl: '',
    aiExternalWhatToQuery: '',
    aiExternalAuth: '',
    aiExternalExamples: '',
    externalAutomationInfo: '',
    extraNotes: '',
    customAnswers: {},
  }
}

interface PublicClient {
  id: string
  name: string
  company: string
  briefing_status: BriefingStatus | null
  briefing_revision_note: string | null
  briefing_config: BriefingConfig | null
  briefing_data?: BriefingData | null
}

// ── Rascunho automático (autosave) ────────────────────────────────────────────
function draftKey(token: string): string {
  return `briefing_draft_${token}`
}
function loadDraft(token: string): BriefingFormState | null {
  try {
    const raw = window.localStorage.getItem(draftKey(token))
    return raw ? (JSON.parse(raw) as BriefingFormState) : null
  } catch {
    return null
  }
}
function saveDraft(token: string, state: BriefingFormState): void {
  try {
    window.localStorage.setItem(draftKey(token), JSON.stringify(state))
  } catch {
    /* quota — ignora */
  }
}
function clearDraft(token: string): void {
  try {
    window.localStorage.removeItem(draftKey(token))
  } catch {
    /* ignora */
  }
}

/** Reconstrói o estado do formulário a partir de um briefing já enviado (revisão). */
function formStateFromBriefing(bd: BriefingData, base: BriefingFormState): BriefingFormState {
  return {
    ...base,
    site: bd.site ?? base.site,
    sectors: bd.departments ?? base.sectors,
    users:
      (bd.users ?? []).length > 0
        ? bd.users.map((u) => ({
            name: u.name,
            email: u.email,
            sectors: u.sectors ?? (u.sector ? [u.sector] : []),
            role: u.role,
          }))
        : base.users,
    schedule:
      bd.schedule && bd.schedule.length > 0
        ? bd.schedule.map((s) => ({ day: s.day, active: s.active, start: s.start, end: s.end }))
        : base.schedule,
    timezone: bd.timezone ?? base.timezone,
    whatsappNumbers: bd.whatsappNumbers?.length
      ? padWhatsappNumbers(bd.whatsappNumbers, base.whatsappNumbers.length)
      : base.whatsappNumbers,
    facebookEmail: bd.facebookEmail ?? base.facebookEmail,
    facebookPassword: bd.facebookPassword ?? base.facebookPassword,
    wavoipInfo: bd.wavoipInfo ?? base.wavoipInfo,
    emailConfig: bd.emailConfig ?? base.emailConfig,
    channelAccess: bd.channelAccess ?? base.channelAccess,
    greetingMessage: bd.greetingMessage || base.greetingMessage,
    offHoursMessage: bd.offHoursMessage || base.offHoursMessage,
    offHoursEnabled: bd.offHoursEnabled ?? base.offHoursEnabled,
    offHoursCustomized: Boolean(bd.offHoursMessage) || base.offHoursCustomized,
    chatbotDescription: bd.chatbotFlow?.description ?? base.chatbotDescription,
    chatbotFlowMode: bd.chatbotFlow?.mode ?? base.chatbotFlowMode,
    chatbotMenuStyle: bd.chatbotFlow?.menuStyle ?? base.chatbotMenuStyle,
    chatbotMenus:
      bd.chatbotFlow?.menus && bd.chatbotFlow.menus.length > 0
        ? bd.chatbotFlow.menus.map((m) => ({
            question: m.question,
            options: (m.options ?? []).join('\n'),
            parentOption: m.parentOption,
          }))
        : base.chatbotMenus,
    chatbotCollect: (bd.chatbotFlow?.collectFields ?? []).join('\n') || base.chatbotCollect,
    chatbotTransfers: bd.chatbotFlow?.transfers ?? base.chatbotTransfers,
    chatbotClosing: bd.chatbotFlow?.closingMessage ?? base.chatbotClosing,
    useAI: bd.useAI ?? base.useAI,
    aiTone: bd.aiTone ?? base.aiTone,
    aiAgentName: bd.aiAgentName ?? base.aiAgentName,
    aiCompanyDescription: bd.aiCompanyDescription ?? base.aiCompanyDescription,
    aiServices: bd.aiServices ?? base.aiServices,
    aiHasPrices: bd.aiHasPrices ?? base.aiHasPrices,
    aiPrices: bd.aiPrices ?? base.aiPrices,
    aiLocation: bd.aiLocation ?? base.aiLocation,
    aiSocialMedia: bd.aiSocialMedia ?? base.aiSocialMedia,
    aiAttendanceFlow: bd.aiAttendanceFlow ?? base.aiAttendanceFlow,
    aiTransferConditions: bd.aiTransferConditions ?? base.aiTransferConditions,
    aiRestrictions: bd.aiRestrictions ?? base.aiRestrictions,
    aiAddress: bd.aiAddress ?? base.aiAddress,
    aiSlogan: bd.aiSlogan ?? base.aiSlogan,
    aiMostSought: bd.aiMostSought ?? base.aiMostSought,
    aiPartnerships: bd.aiPartnerships ?? base.aiPartnerships,
    aiPaymentMethods: bd.aiPaymentMethods ?? base.aiPaymentMethods,
    aiPromotions: bd.aiPromotions ?? base.aiPromotions,
    aiFirstMessage: bd.aiFirstMessage ?? base.aiFirstMessage,
    aiSchedulingData: bd.aiSchedulingData ?? base.aiSchedulingData,
    aiPostDataMessage: bd.aiPostDataMessage ?? base.aiPostDataMessage,
    aiExistingClient: bd.aiExistingClient ?? base.aiExistingClient,
    aiWhenUnknown: bd.aiWhenUnknown ?? base.aiWhenUnknown,
    aiFaq: bd.aiFaq ?? base.aiFaq,
    aiExternalSystem: bd.aiExternalSystem ?? base.aiExternalSystem,
    aiExternalApiUrl: bd.aiExternalApiUrl ?? base.aiExternalApiUrl,
    aiExternalWhatToQuery: bd.aiExternalWhatToQuery ?? base.aiExternalWhatToQuery,
    aiExternalAuth: bd.aiExternalAuth ?? base.aiExternalAuth,
    aiExternalExamples: bd.aiExternalExamples ?? base.aiExternalExamples,
    externalAutomationInfo: bd.externalAutomationInfo ?? base.externalAutomationInfo,
    extraNotes: bd.extraNotes ?? base.extraNotes,
    customAnswers: bd.customAnswers ?? base.customAnswers,
  }
}

export function BriefingPublicPage() {
  const { token } = useParams<{ token: string }>()
  const [client, setClient] = React.useState<PublicClient | null | undefined>(undefined)
  const [state, setState] = React.useState<BriefingFormState>(initialFormState(''))
  // Perguntas de texto livre novas, adicionadas pelo admin — renderizadas ao final da
  // seção "Observações" (ver src/services/briefingTemplate.ts).
  const [customQuestions, setCustomQuestions] = React.useState<BriefingCustomQuestion[]>([])
  // Overrides de rótulo dos campos já existentes — chave = texto ORIGINAL do rótulo
  // (não um id artificial), pra não precisar manter uma lista de "field keys" separada.
  const [fieldOverrides, setFieldOverrides] = React.useState<BriefingFieldOverride[]>([])
  const overridesByText = React.useMemo(() => {
    const map: Record<string, string> = {}
    for (const o of fieldOverrides) if (o.label) map[o.fieldKey] = o.label
    return map
  }, [fieldOverrides])
  const L = React.useCallback((text: string) => overridesByText[text] ?? text, [overridesByText])
  const [section, setSection] = React.useState(0)
  const [submittedData, setSubmittedData] = React.useState<{ greeting: string; offHours: string } | null>(null)
  const [submitting, setSubmitting] = React.useState(false)
  const [chatbotConfirmOpen, setChatbotConfirmOpen] = React.useState(false)
  // Erros de validação por campo (chave -> mensagem). Preenchido ao avançar/enviar.
  const [errors, setErrors] = React.useState<Record<string, string>>({})
  const clearError = React.useCallback((key: string) => {
    setErrors((e) => {
      if (!(key in e)) return e
      const next = { ...e }
      delete next[key]
      return next
    })
  }, [])

  // `ready` libera o autosave só depois que o estado inicial foi hidratado,
  // pra não sobrescrever um rascunho salvo com o formulário em branco.
  const [ready, setReady] = React.useState(false)

  React.useEffect(() => {
    if (!token) { setClient(null); return }
    let cancelled = false
    setReady(false)
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
        // 1) Rascunho local (autosave) tem prioridade — sobrevive a refresh/
        //    fechar a aba. 2) Em revisão, pré-preenche com o que já foi enviado.
        //    3) Senão, começa em branco.
        const whatsappSlots = row.briefing_config?.maxWhatsappNumbers ?? DEFAULT_WHATSAPP_NUMBER_SLOTS
        const base = initialFormState(row.company, whatsappSlots)
        const draft = loadDraft(token)
        if (draft) {
          // Rascunhos salvos antes da mudança pra "caixinhas" guardavam
          // whatsappNumbers como texto único — normaliza pro formato em array.
          const draftNumbers = draft.whatsappNumbers as unknown
          const whatsappNumbers = Array.isArray(draftNumbers)
            ? padWhatsappNumbers(draftNumbers, whatsappSlots)
            : padWhatsappNumbers(
                typeof draftNumbers === 'string'
                  ? draftNumbers.split(/[\n,;]+/).map((s) => s.trim()).filter(Boolean)
                  : [],
                whatsappSlots,
              )
          setState({ ...base, ...draft, whatsappNumbers })
        } else if (row.briefing_status === 'revision' && row.briefing_data) {
          setState(formStateFromBriefing(row.briefing_data, base))
        } else {
          setState(base)
        }
        setReady(true)
      } catch {
        if (cancelled) return
        setClient(null)
      }
    })()
    return () => { cancelled = true }
  }, [token])

  React.useEffect(() => {
    let cancelled = false
    fetchPublicBriefingTemplate()
      .then(({ overrides, customQuestions }) => {
        if (cancelled) return
        setFieldOverrides(overrides)
        setCustomQuestions(customQuestions)
      })
      .catch(() => {})
    return () => { cancelled = true }
  }, [])

  // Autosave do rascunho a cada mudança (depois de hidratado).
  React.useEffect(() => {
    if (!ready || !token) return
    saveDraft(token, state)
  }, [state, ready, token])

  // Regenerate greeting when sectors change (if not being edited)
  React.useEffect(() => {
    if (!state.greetingEditing && !state.greetingGenerated && client?.company) {
      setState((s) => ({
        ...s,
        greetingMessage: buildGreeting(client.company, s.sectors),
      }))
    }
  }, [state.sectors, state.greetingEditing, state.greetingGenerated, client?.company])

  // Regenera a mensagem de fora do horário quando dias/horários mudam — só enquanto
  // o cliente não tiver personalizado o texto manualmente.
  React.useEffect(() => {
    if (!state.offHoursCustomized && client?.company) {
      setState((s) => ({
        ...s,
        offHoursMessage: buildOffHours(client.company, s.schedule),
      }))
    }
  }, [state.schedule, state.offHoursCustomized, client?.company])

  const cfg = client?.briefing_config ?? null
  const sections = React.useMemo(() => buildSections(cfg), [cfg])
  const totalSections = sections.length
  const currentKey = sections[section]

  const needsSite =
    !cfg ||
    cfg.connectionTypes.includes('api_oficial') ||
    cfg.automationTypes.some((t) => t === 'ia_basica' || t === 'ia_avancada')

  // Preenche um menu (principal ou submenu) com um exemplo pronto — dá uma base
  // pro cliente entender o formato e ajustar em cima, sem depender de IA. No menu
  // principal, usa os setores já cadastrados na Seção 1 como opções (se houver).
  const fillMenuExample = (i: number) => {
    const example =
      i === 0
        ? {
            question: 'Olá! 👋 Como podemos te ajudar hoje?',
            options: state.sectors.length > 0 ? state.sectors.join('\n') : 'Comercial\nSuporte\nFinanceiro',
          }
        : {
            question: 'Sobre qual assunto você precisa de ajuda?',
            options: 'Problema técnico\nDúvida sobre cobrança\nFalar com atendente',
          }
    setState((current) => {
      const menus = [...current.chatbotMenus]
      menus[i] = { ...menus[i], question: example.question, options: example.options }
      return { ...current, chatbotMenus: menus }
    })
    clearError('chatbotMenus')
  }

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

  // Leva o usuário até a seção do primeiro erro, marca os campos e avisa.
  const focusErrors = (problems: BriefingFieldError[]) => {
    const map: Record<string, string> = {}
    for (const p of problems) map[p.key] = p.message
    setErrors(map)
    const firstIdx = sections.indexOf(problems[0].section)
    if (firstIdx >= 0 && firstIdx !== section) setSection(firstIdx)
    window.scrollTo({ top: 0, behavior: 'smooth' })
    toast.error(
      problems.length === 1
        ? problems[0].message
        : `Faltam ${problems.length} campos obrigatórios — veja o resumo no topo.`,
    )
  }

  const submit = async () => {
    // Trava final: valida o briefing inteiro (respeitando as seções da config).
    const problems = validateBriefing(state, cfg, sections)
    if (problems.length > 0) {
      focusErrors(problems)
      return
    }
    setErrors({})
    // A seção de IA só entra em `sections` quando o cliente contratou IA
    // (básica ou avançada). Se ela foi exibida, as respostas de IA valem —
    // não existe toggle "usar IA" no formulário público.
    const aiEnabled = sections.includes('ia')
    const isAdvancedAI = Boolean(cfg?.automationTypes.includes('ia_avancada'))
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
          sectors: u.sectors.map((s) => s.trim()).filter(Boolean),
          role: u.role,
        })),
      schedule: state.schedule,
      timezone: state.timezone,
      whatsappNumbers: state.whatsappNumbers.map((s) => s.trim()).filter(Boolean),
      whatsappType: 'baileys',
      useFacebook: Boolean(state.facebookEmail.trim()),
      facebookEmail: state.facebookEmail.trim() || undefined,
      facebookPassword: state.facebookPassword.trim() || undefined,
      mainFlow: '',
      chatbotFlow: sections.includes('chatbot')
        ? {
            description: state.chatbotDescription.trim(),
            mode: state.chatbotFlowMode,
            menuStyle: state.chatbotMenuStyle,
            menus:
              state.chatbotFlowMode === 'none'
                ? []
                : state.chatbotFlowMode === 'greeting_only'
                  ? [{ question: state.chatbotMenus[0]?.question.trim() ?? '', options: [] as string[] }].filter(
                      (m) => m.question,
                    )
                  : state.chatbotMenus
                      .map((m) => ({
                        question: m.question.trim(),
                        parentOption: m.parentOption?.trim() || undefined,
                        options: m.options
                          .split('\n')
                          .map((o) => o.trim())
                          .filter(Boolean),
                      }))
                      .filter((m) => m.question || m.options.length > 0),
            collectFields: state.chatbotCollect
              .split('\n')
              .map((s) => s.trim())
              .filter(Boolean),
            transfers: state.chatbotTransfers
              .map((t) => ({ option: t.option.trim(), department: t.department.trim() }))
              .filter((t) => t.option && t.department),
            closingMessage: state.chatbotClosing.trim(),
          }
        : undefined,
      greetingMessage: state.greetingMessage.trim(),
      offHoursMessage: state.offHoursEnabled ? state.offHoursMessage.trim() : '',
      offHoursEnabled: state.offHoursEnabled,
      departments: state.sectors,
      useAI: aiEnabled,
      aiTone: aiEnabled ? state.aiTone : undefined,
      aiAgentName: aiEnabled ? state.aiAgentName.trim() || undefined : undefined,
      aiCompanyDescription: aiEnabled ? state.aiCompanyDescription.trim() || undefined : undefined,
      aiServices: aiEnabled ? state.aiServices.trim() || undefined : undefined,
      aiHasPrices: aiEnabled ? state.aiHasPrices : undefined,
      aiPrices: aiEnabled && state.aiHasPrices ? state.aiPrices.trim() || undefined : undefined,
      aiLocation: aiEnabled ? state.aiLocation.trim() || undefined : undefined,
      aiSocialMedia: aiEnabled ? state.aiSocialMedia.trim() || undefined : undefined,
      aiAttendanceFlow: aiEnabled ? state.aiAttendanceFlow.trim() || undefined : undefined,
      aiTransferConditions: aiEnabled ? state.aiTransferConditions.trim() || undefined : undefined,
      aiRestrictions: aiEnabled ? state.aiRestrictions.trim() || undefined : undefined,
      aiAddress: aiEnabled ? state.aiAddress.trim() || undefined : undefined,
      aiSlogan: aiEnabled ? state.aiSlogan.trim() || undefined : undefined,
      aiMostSought: aiEnabled ? state.aiMostSought.trim() || undefined : undefined,
      aiPartnerships: aiEnabled ? state.aiPartnerships.trim() || undefined : undefined,
      aiPaymentMethods: aiEnabled ? state.aiPaymentMethods.trim() || undefined : undefined,
      aiPromotions: aiEnabled ? state.aiPromotions.trim() || undefined : undefined,
      aiFirstMessage: aiEnabled ? state.aiFirstMessage.trim() || undefined : undefined,
      aiSchedulingData: aiEnabled ? state.aiSchedulingData.trim() || undefined : undefined,
      aiPostDataMessage: aiEnabled ? state.aiPostDataMessage.trim() || undefined : undefined,
      aiExistingClient: aiEnabled ? state.aiExistingClient.trim() || undefined : undefined,
      aiWhenUnknown: aiEnabled ? state.aiWhenUnknown.trim() || undefined : undefined,
      aiFaq: aiEnabled ? state.aiFaq.trim() || undefined : undefined,
      aiExternalSystem:
        aiEnabled && isAdvancedAI ? state.aiExternalSystem.trim() || undefined : undefined,
      aiExternalApiUrl:
        aiEnabled && isAdvancedAI ? state.aiExternalApiUrl.trim() || undefined : undefined,
      aiExternalWhatToQuery:
        aiEnabled && isAdvancedAI ? state.aiExternalWhatToQuery.trim() || undefined : undefined,
      aiExternalAuth:
        aiEnabled && isAdvancedAI ? state.aiExternalAuth.trim() || undefined : undefined,
      aiExternalExamples:
        aiEnabled && isAdvancedAI ? state.aiExternalExamples.trim() || undefined : undefined,
      aiInstructions: undefined,
      wavoipInfo: state.wavoipInfo.trim() || undefined,
      emailConfig: state.emailConfig.trim() || undefined,
      channelAccess: cleanChannelAccess(state.channelAccess),
      externalAutomationInfo: state.externalAutomationInfo.trim() || undefined,
      extraNotes: state.extraNotes.trim() || undefined,
      customAnswers:
        Object.keys(state.customAnswers).length > 0 ? state.customAnswers : undefined,
      submittedAt: new Date().toISOString(),
    }
    setSubmitting(true)
    try {
      await api.post(`/api/public/briefing/${token}`, { data })
      if (token) clearDraft(token)
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

  const advanceSection = () => {
    if (section < totalSections - 1) {
      setSection(section + 1)
      window.scrollTo({ top: 0, behavior: 'smooth' })
    } else {
      void submit()
    }
  }

  const next = () => {
    // Ao avançar, valida os obrigatórios da seção atual (mesma regra do envio),
    // para o cliente corrigir na hora em vez de só barrar no fim.
    const sectionErrs = validateBriefing(state, cfg, sections).filter(
      (e) => e.section === currentKey,
    )
    if (sectionErrs.length > 0) {
      focusErrors(sectionErrs)
      return
    }
    // On chatbot section show confirmation before advancing
    if (currentKey === 'chatbot') {
      setChatbotConfirmOpen(true)
      return
    }
    advanceSection()
  }
  const prev = () => {
    if (section > 0) {
      setSection(section - 1)
      window.scrollTo({ top: 0, behavior: 'smooth' })
    }
  }

  const maxUsers = cfg?.maxUsers ?? 0

  const addSector = () => {
    const parts = state.newSectorInput
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
    if (!parts.length) return
    setState((prev) => {
      const next = [...prev.sectors]
      for (const p of parts) {
        if (!next.includes(p)) next.push(p)
      }
      return { ...prev, sectors: next, newSectorInput: '' }
    })
    clearError('sectors')
  }

  const removeSector = (idx: number) => {
    setState((prev) => ({ ...prev, sectors: prev.sectors.filter((_, i) => i !== idx) }))
  }

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <BriefingHeader companyName={client.company} />

      <main className="mx-auto max-w-5xl px-4 pb-32 pt-8 sm:px-6">
        {client.briefing_revision_note && (
          <div className="mb-6 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
            <strong>Solicitação de revisão:</strong>{' '}
            {client.briefing_revision_note}
          </div>
        )}

        {/* Resumo dos campos obrigatórios que faltam (barra no topo). */}
        {Object.keys(errors).length > 0 && (
          <div className="mb-6 rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">
            <strong>
              Faltam {Object.keys(errors).length} campo(s) obrigatório(s):
            </strong>
            <ul className="mt-2 list-disc space-y-1 pl-5">
              {Object.values(errors).map((msg, i) => (
                <li key={i}>{msg}</li>
              ))}
            </ul>
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
                  <Field label={L('Site da empresa')}>
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
                  <SectorInfoPopover />
                </div>
                <p className="mb-3 text-xs text-slate-500">
                  Adicione os departamentos que terão filas de atendimento (ex: Comercial, Suporte, Financeiro). Crie ao menos um.
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
                    onChange={(v) => {
                      // Auto-add when user types a comma followed by content
                      if (v.endsWith(',')) {
                        const parts = v.split(',').map((s) => s.trim()).filter(Boolean)
                        if (parts.length) {
                          setState((prev) => {
                            const next = [...prev.sectors]
                            for (const p of parts) if (!next.includes(p)) next.push(p)
                            return { ...prev, sectors: next, newSectorInput: '' }
                          })
                          clearError('sectors')
                          return
                        }
                      }
                      setState({ ...state, newSectorInput: v })
                    }}
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
                {errors.sectors && (
                  <p className="mt-1 text-xs font-medium text-rose-600">{errors.sectors}</p>
                )}
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
                          <Field label={L('Nome')}>
                            <PlainInput
                              value={u.name}
                              onChange={(v) => {
                                const users = [...state.users]
                                users[i] = { ...users[i], name: v }
                                setState({ ...state, users })
                                clearError('users')
                              }}
                              placeholder="João Silva"
                            />
                          </Field>
                        </div>
                        <div className="sm:col-span-4">
                          <Field label={L('E-mail')}>
                            <PlainInput
                              type="email"
                              value={u.email}
                              onChange={(v) => {
                                const users = [...state.users]
                                // Sempre minúsculo e sem espaços nas pontas.
                                users[i] = { ...users[i], email: v.toLowerCase().trimStart() }
                                setState({ ...state, users })
                                clearError('users')
                              }}
                              placeholder="joao@empresa.com"
                            />
                            {u.email.trim() !== '' && !isValidEmail(u.email) && (
                              <p className="mt-1 text-xs text-rose-500">
                                E-mail inválido — use o formato nome@empresa.com (sem espaços).
                              </p>
                            )}
                            {u.email.trim() !== '' &&
                              isValidEmail(u.email) &&
                              state.users.filter(
                                (x) => x.email.trim().toLowerCase() === u.email.trim().toLowerCase(),
                              ).length > 1 && (
                                <p className="mt-1 text-xs text-rose-500">
                                  Este e-mail já está sendo usado por outro usuário.
                                </p>
                              )}
                          </Field>
                        </div>
                        <div className="sm:col-span-3">
                          <Field label={L('Setor(es)')}>
                            {state.sectors.length > 0 ? (
                              <MultiSelectBar
                                options={state.sectors}
                                selected={u.sectors ?? []}
                                onChange={(next) => {
                                  const users = [...state.users]
                                  users[i] = { ...users[i], sectors: next }
                                  setState({ ...state, users })
                                  clearError('users')
                                }}
                                placeholder="Selecione os setores"
                              />
                            ) : (
                              <PlainInput
                                value={(u.sectors ?? []).join(', ')}
                                onChange={(v) => {
                                  const users = [...state.users]
                                  users[i] = {
                                    ...users[i],
                                    sectors: v
                                      .split(',')
                                      .map((x) => x.trim())
                                      .filter(Boolean),
                                  }
                                  setState({ ...state, users })
                                  clearError('users')
                                }}
                                placeholder="Crie setores acima ou separe por vírgula"
                              />
                            )}
                          </Field>
                        </div>
                        <div className="sm:col-span-2">
                          <Field label={L('Perfil')}>
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
                            { name: '', email: '', sectors: [], role: 'atendente' },
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
                  {errors.users && (
                    <p className="mt-1 text-xs font-medium text-rose-600">{errors.users}</p>
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
            <div className="grid grid-cols-1 gap-6 lg:grid-cols-2 lg:items-start">
              {/* Coluna esquerda: prévia ao vivo da mensagem de fora do horário — atualiza
                  em tempo real conforme os dias/horários à direita mudam, até o cliente
                  personalizar o texto manualmente (ver useEffect que chama buildOffHours). */}
              <div className="lg:sticky lg:top-4">
                {state.offHoursEnabled ? (
                  <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                    <WhatsAppMockup contactName={asText(client.company, 'Sua empresa')}>
                      <WaBubbleIn>{state.offHoursMessage}</WaBubbleIn>
                    </WhatsAppMockup>
                    <PersonalizavelBadge />
                  </div>
                ) : (
                  <div className="mx-auto flex aspect-[9/19.5] max-w-[280px] items-center justify-center rounded-[2.25rem] border-2 border-dashed border-slate-300 bg-slate-50 px-6 text-center text-xs text-slate-400">
                    Nenhuma mensagem automática será enviada fora do horário.
                  </div>
                )}
                <label className="mt-3 flex items-start gap-2 text-xs text-slate-600">
                  <input
                    type="checkbox"
                    checked={!state.offHoursEnabled}
                    onChange={(e) => setState({ ...state, offHoursEnabled: !e.target.checked })}
                    className="mt-0.5 h-4 w-4 shrink-0 accent-[#4F8EF7]"
                  />
                  Não quero que meus clientes recebam uma mensagem automática fora do horário de
                  atendimento.
                </label>
              </div>

              {/* Coluna direita: dias/horas + edição da mensagem de fora do horário */}
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
                          clearError('schedule')
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
                {errors.schedule && (
                  <p className="mt-1 text-xs font-medium text-rose-600">{errors.schedule}</p>
                )}
                <div className="mt-2">
                  <Field label={L('Fuso horário')}>
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

                {state.offHoursEnabled && (
                  <div className="mt-4">
                    <div className="mb-2 flex items-center justify-between">
                      <label className="text-xs font-medium text-slate-600">
                        Mensagem automática fora do horário
                      </label>
                      <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-700">
                        Demonstrativo
                      </span>
                    </div>
                    <PlainTextarea
                      value={state.offHoursMessage}
                      onChange={(v) => setState({ ...state, offHoursMessage: v, offHoursCustomized: true })}
                      rows={6}
                    />
                    <button
                      type="button"
                      onClick={() =>
                        setState({
                          ...state,
                          offHoursMessage: buildOffHours(client.company, state.schedule),
                          offHoursCustomized: false,
                        })
                      }
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
              {/* WhatsApp — escondido quando o admin configura 0 caixinhas */}
              {state.whatsappNumbers.length > 0 && (
                <div className="rounded-xl border border-slate-200 bg-white p-4">
                  <div className="mb-3 flex items-center gap-2">
                    <h3 className="text-sm font-semibold text-slate-800">WhatsApp</h3>
                    <WhatsappNumbersInfoPopover />
                  </div>
                  <Field label={L('Número(s) que vamos conectar')}>
                    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                      {state.whatsappNumbers.map((num, i) => (
                        <PlainInput
                          key={i}
                          value={num}
                          onChange={(v) => {
                            const next = state.whatsappNumbers.slice()
                            next[i] = v
                            setState({ ...state, whatsappNumbers: next })
                          }}
                          placeholder="(11) 99999-9999"
                        />
                      ))}
                    </div>
                    <p className="mt-1 text-xs text-slate-400">
                      Preencha uma caixinha por número. Inclua o DDD.
                    </p>
                  </Field>
                </div>
              )}

              {/* Facebook — obrigatório para API Oficial */}
              {cfg?.connectionTypes.includes('api_oficial') && (
                <div className="rounded-xl border border-blue-200 bg-blue-50 p-4">
                  <div className="mb-2 flex items-center gap-2">
                    <h3 className="text-sm font-semibold text-slate-800">
                      Acesso ao Facebook (Meta) — para conectar a API Oficial
                    </h3>
                    <span className="rounded-full bg-blue-100 px-2 py-0.5 text-[10px] font-medium text-blue-700">
                      Obrigatório
                    </span>
                  </div>
                  <p className="mb-3 text-xs text-slate-600">
                    Seu atendimento será conectado pela <strong>API Oficial do WhatsApp</strong>, que
                    funciona vinculada à sua conta do <strong>Facebook / Meta Business</strong>. Para
                    fazer essa conexão, <strong>precisamos do acesso ao seu Facebook</strong>. Por
                    favor, preencha abaixo o <strong>e-mail e a senha</strong> da conta que administra
                    a página/WhatsApp da empresa.
                  </p>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <Field label={L('E-mail do Facebook / Meta *')}>
                      <PlainInput
                        type="email"
                        value={state.facebookEmail}
                        onChange={(v) => { setState({ ...state, facebookEmail: v }); clearError('facebookEmail') }}
                        placeholder="email@dofacebook.com"
                      />
                      {errors.facebookEmail && (
                        <p className="mt-1 text-xs font-medium text-rose-600">{errors.facebookEmail}</p>
                      )}
                    </Field>
                    <Field label={L('Senha do Facebook / Meta *')}>
                      <PlainInput
                        type="password"
                        value={state.facebookPassword}
                        onChange={(v) => { setState({ ...state, facebookPassword: v }); clearError('facebookPassword') }}
                        placeholder="••••••••"
                      />
                      {errors.facebookPassword && (
                        <p className="mt-1 text-xs font-medium text-rose-600">{errors.facebookPassword}</p>
                      )}
                    </Field>
                  </div>
                  <p className="mt-2 text-[11px] text-slate-400">
                    🔒 Seus dados são transmitidos com segurança e usados <strong>somente</strong> para
                    conectar a API Oficial. Você pode trocar a senha depois que a conexão estiver pronta.
                  </p>

                  <div className="mt-4 border-t border-blue-100 pt-3">
                    <p className="text-xs text-slate-600">
                      Nossa equipe vai acessar seu computador remotamente pelo{' '}
                      <strong>TeamViewer</strong> pra fazer toda a configuração por lá. Por isso é
                      importante preencher certinho o e-mail e a senha acima — assim, na hora de
                      entrarmos, já temos tudo em mãos e não perdemos tempo esperando você lembrar ou
                      buscar a senha, o que atrasa bastante o processo. Se preferir, você também pode
                      nos dar acesso <strong>compartilhando o seu Business Manager</strong> (partner
                      access) — basta adicionar nossa agência como parceira nas configurações do BM.
                    </p>
                  </div>
                </div>
              )}

              {/* WaVoip */}
              {cfg?.channels.includes('wavoip') && (
                <div className="rounded-xl border border-slate-200 bg-white p-4">
                  <h3 className="mb-3 text-sm font-semibold text-slate-800">WaVoip</h3>
                  <Field label={L('Informações da conta WaVoip')}>
                    <PlainTextarea
                      value={state.wavoipInfo}
                      onChange={(v) => setState({ ...state, wavoipInfo: v })}
                      placeholder="Usuário, token ou demais dados de acesso WaVoip"
                      rows={3}
                    />
                  </Field>
                </div>
              )}

              {/* Canais com credenciais de acesso (Instagram, Facebook, OLX, Mercado Livre) */}
              {CREDENTIAL_CHANNELS.filter((ch) => cfg?.channels.includes(ch.key)).map((ch) => {
                const acc = state.channelAccess[ch.key] ?? {}
                const setAcc = (patch: { email?: string; password?: string; notes?: string }) =>
                  setState({
                    ...state,
                    channelAccess: {
                      ...state.channelAccess,
                      [ch.key]: { ...acc, ...patch },
                    },
                  })
                return (
                  <div key={ch.key} className="rounded-xl border border-slate-200 bg-white p-4">
                    <h3 className="mb-3 text-sm font-semibold text-slate-800">{ch.label}</h3>
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                      <Field label={L('E-mail / usuário de acesso')}>
                        <PlainInput
                          value={acc.email ?? ''}
                          onChange={(v) => setAcc({ email: v })}
                          placeholder="login@exemplo.com"
                        />
                      </Field>
                      <Field label={L('Senha de acesso')}>
                        <PlainInput
                          type="password"
                          value={acc.password ?? ''}
                          onChange={(v) => setAcc({ password: v })}
                          placeholder="••••••••"
                        />
                      </Field>
                    </div>
                    <p className="mt-2 text-[11px] text-slate-400">
                      🔒 Usamos suas credenciais apenas para configurar a integração.
                    </p>
                  </div>
                )
              })}

              {/* E-mail */}
              {cfg?.channels.includes('email') && (
                <div className="rounded-xl border border-slate-200 bg-white p-4">
                  <h3 className="mb-3 text-sm font-semibold text-slate-800">E-mail</h3>
                  <Field label={L('Configurações de e-mail')}>
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
              {/* Roteiro do chatbot (base da geração automática) */}
              <div className="rounded-xl border border-slate-200 bg-white p-4">
                <div className="mb-1 flex items-center gap-2">
                  <h3 className="text-sm font-semibold text-slate-800">Monte o fluxo do chatbot</h3>
                  <ChatbotFlowInfoPopover />
                </div>
                <p className="mb-3 text-xs text-slate-500">
                  Comece pelo menu principal. Se uma opção precisar abrir novas escolhas, adicione um submenu.
                </p>
                <div className="space-y-4">
                  <Field label={L('Resumo do atendimento *')}>
                    <PlainTextarea
                      value={state.chatbotDescription}
                      onChange={(v) => {
                        setState({ ...state, chatbotDescription: v })
                        clearError('chatbotDescription')
                      }}
                      rows={3}
                      placeholder="Ex: Um único número para Comercial, Suporte e Financeiro. Depois da escolha, o cliente é direcionado ao setor responsável."
                    />
                    {errors.chatbotDescription && (
                      <p className="mt-1 text-xs font-medium text-rose-600">{errors.chatbotDescription}</p>
                    )}
                  </Field>

                  {/* Menus dinâmicos */}
                  <div>
                    <label className="mb-1 block text-xs font-medium text-slate-600">
                      Menu de atendimento *
                    </label>
                    <p className="mb-3 text-xs text-slate-500">
                      Escolha como o primeiro contato funciona: um menu com opções, só uma mensagem
                      de boas-vindas, ou nenhuma mensagem automática.
                    </p>

                    <div className="mb-4 inline-flex flex-wrap rounded-lg border border-slate-200 bg-white p-1 text-xs font-medium">
                      {(
                        [
                          { v: 'menu', l: 'Menu de opções' },
                          { v: 'greeting_only', l: 'Só boas-vindas' },
                          { v: 'none', l: 'Nenhuma mensagem' },
                        ] as const
                      ).map(({ v, l }) => (
                        <button
                          key={v}
                          type="button"
                          onClick={() => setState({ ...state, chatbotFlowMode: v })}
                          className={cn(
                            'rounded-md px-3 py-1.5 transition',
                            state.chatbotFlowMode === v
                              ? 'bg-[#4F8EF7] text-white'
                              : 'text-slate-500 hover:text-slate-700',
                          )}
                        >
                          {l}
                        </button>
                      ))}
                    </div>

                    {state.chatbotFlowMode === 'none' && (
                      <p className="rounded-xl border border-dashed border-slate-300 bg-white px-4 py-3 text-xs text-slate-500">
                        Ok — nenhuma mensagem automática será enviada. O cliente será atendido
                        diretamente por um atendente assim que entrar em contato.
                      </p>
                    )}

                    {state.chatbotFlowMode === 'greeting_only' && (
                      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[280px_1fr] lg:items-start">
                        <div className="lg:sticky lg:top-4">
                          <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                            <WhatsAppMockup contactName={asText(client.company, 'Sua empresa')}>
                              <WaBubbleIn>
                                {state.chatbotMenus[0]?.question.trim() || 'Olá! Como podemos te ajudar hoje?'}
                              </WaBubbleIn>
                            </WhatsAppMockup>
                            <PersonalizavelBadge />
                          </div>
                        </div>
                        <div>
                          <label className="mb-1 block text-xs font-medium text-slate-600">
                            Mensagem de boas-vindas
                          </label>
                          <p className="mb-2 text-xs text-slate-500">
                            Sem menu de opções — o cliente cai direto na conversa com um atendente
                            depois dessa mensagem.
                          </p>
                          <PlainInput
                            value={state.chatbotMenus[0]?.question ?? ''}
                            onChange={(v) => {
                              const menus = [...state.chatbotMenus]
                              menus[0] = { ...(menus[0] ?? { options: '' }), question: v }
                              setState({ ...state, chatbotMenus: menus })
                              clearError('chatbotMenus')
                            }}
                            placeholder="Ex: Olá! Seja bem-vindo(a). Em instantes um atendente vai continuar por aqui."
                          />
                          {errors.chatbotMenus && (
                            <p className="mt-1 text-xs font-medium text-rose-600">{errors.chatbotMenus}</p>
                          )}
                        </div>
                      </div>
                    )}

                    {state.chatbotFlowMode === 'menu' && (
                    <>
                    <p className="mb-3 text-xs text-slate-500">
                      Escreva a mensagem que o cliente verá e coloque uma opção em cada linha. Os números serão
                      adicionados no fluxo. Ao escolher uma opção do menu, o cliente é transferido direto para o
                      setor responsável.
                    </p>
                    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[280px_1fr] lg:items-start">
                      {/* Coluna esquerda: prévia ao vivo do menu principal, atualiza
                          conforme o cliente digita ou usa "Usar exemplo". */}
                      <div className="lg:sticky lg:top-4">
                        <div className="mb-3 inline-flex rounded-lg border border-slate-200 bg-white p-1 text-xs font-medium">
                          <button
                            type="button"
                            onClick={() => setState({ ...state, chatbotMenuStyle: 'numbered' })}
                            className={cn(
                              'rounded-md px-3 py-1.5 transition',
                              state.chatbotMenuStyle === 'numbered'
                                ? 'bg-[#4F8EF7] text-white'
                                : 'text-slate-500 hover:text-slate-700',
                            )}
                          >
                            Numerado
                          </button>
                          <button
                            type="button"
                            onClick={() => setState({ ...state, chatbotMenuStyle: 'buttons' })}
                            className={cn(
                              'rounded-md px-3 py-1.5 transition',
                              state.chatbotMenuStyle === 'buttons'
                                ? 'bg-[#4F8EF7] text-white'
                                : 'text-slate-500 hover:text-slate-700',
                            )}
                          >
                            Botões
                          </button>
                        </div>
                        <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                          <WhatsAppMockup contactName={asText(client.company, 'Sua empresa')}>
                            <ChatbotMenuPreview
                              menu={state.chatbotMenus[0] ?? { question: '', options: '' }}
                              style={state.chatbotMenuStyle}
                            />
                          </WhatsAppMockup>
                          <PersonalizavelBadge />
                        </div>
                        <p className="mt-2 text-[11px] text-slate-400">
                          {state.chatbotMenuStyle === 'numbered'
                            ? 'Cliente digita o número da opção desejada.'
                            : 'Cliente toca no botão da opção. O WhatsApp permite até 3 botões por mensagem — com mais opções, vira uma lista deslizante.'}
                        </p>
                      </div>

                      {/* Coluna direita: edição do menu principal e submenus */}
                      <div>
                        <div className="space-y-3">
                          {state.chatbotMenus.map((m, i) => (
                            <div key={i} className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                              <div className="mb-3 flex items-start justify-between gap-3">
                                <div>
                                  <p className="text-sm font-semibold text-slate-800">
                                    {i === 0 ? 'Menu principal' : `Submenu ${i}`}
                                  </p>
                                  <p className="text-xs text-slate-500">
                                    {i === 0
                                      ? 'Primeira mensagem que o cliente recebe. As opções devem bater com os setores cadastrados na Seção 1.'
                                      : 'Só aparece depois que o cliente clica em uma das opções de outro menu (o principal ou outro submenu) — é um segundo nível de escolha antes de transferir para o setor responsável.'}
                                  </p>
                                </div>
                                <div className="flex shrink-0 items-center gap-2">
                                  <button
                                    type="button"
                                    onClick={() => fillMenuExample(i)}
                                    className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 px-3 py-2 text-xs font-medium text-slate-600 transition hover:border-[#4F8EF7] hover:text-[#4F8EF7]"
                                  >
                                    <Lightbulb className="h-3.5 w-3.5" />
                                    Usar exemplo
                                  </button>
                                  {i > 0 && (
                                    <button
                                      type="button"
                                      onClick={() =>
                                        setState({ ...state, chatbotMenus: state.chatbotMenus.filter((_, x) => x !== i) })
                                      }
                                      className="inline-flex items-center gap-1 text-xs text-rose-500 hover:underline"
                                    >
                                      <Trash2 className="h-3 w-3" /> Remover
                                    </button>
                                  )}
                                </div>
                              </div>
                              {i > 0 && (
                                <div className="mb-2">
                                  <label className="mb-1 block text-xs font-medium text-slate-600">
                                    Qual opção abre este submenu?
                                  </label>
                                  <PlainInput
                                    value={m.parentOption ?? ''}
                                    onChange={(v) => {
                                      const menus = [...state.chatbotMenus]
                                      menus[i] = { ...menus[i], parentOption: v }
                                      setState({ ...state, chatbotMenus: menus })
                                    }}
                                    placeholder="Ex: Suporte"
                                  />
                                </div>
                              )}
                              <label className="mb-1 block text-xs font-medium text-slate-600">
                                Mensagem exibida
                              </label>
                              <PlainInput
                                value={m.question}
                                onChange={(v) => {
                                  const menus = [...state.chatbotMenus]
                                  menus[i] = { ...menus[i], question: v }
                                  setState({ ...state, chatbotMenus: menus })
                                  clearError('chatbotMenus')
                                }}
                                placeholder={i === 0 ? 'Ex: Olá! Como podemos ajudar?' : 'Ex: Sobre qual assunto você precisa de suporte?'}
                              />
                              <div className="mt-2">
                                <label className="mb-1 block text-xs font-medium text-slate-600">
                                  Opções (uma por linha)
                                </label>
                                <PlainTextarea
                                  value={m.options}
                                  onChange={(v) => {
                                    const menus = [...state.chatbotMenus]
                                    menus[i] = { ...menus[i], options: v }
                                    setState({ ...state, chatbotMenus: menus })
                                    clearError('chatbotMenus')
                                  }}
                                  rows={3}
                                  placeholder={i === 0 ? 'Comercial\nSuporte\nFinanceiro' : 'Problema técnico\nDúvida sobre acesso\nFalar com atendente'}
                                />
                              </div>
                            </div>
                          ))}
                        </div>
                        <button
                          type="button"
                          onClick={() =>
                            setState({ ...state, chatbotMenus: [...state.chatbotMenus, { question: '', options: '', parentOption: '' }] })
                          }
                          className="mt-2 inline-flex items-center gap-2 rounded-lg border border-dashed border-slate-300 px-3 py-2 text-sm text-slate-500 hover:border-[#4F8EF7] hover:text-[#4F8EF7]"
                        >
                          <Plus className="h-4 w-4" /> Adicionar submenu
                        </button>
                        {errors.chatbotMenus && (
                          <p className="mt-1 text-xs font-medium text-rose-600">{errors.chatbotMenus}</p>
                        )}
                      </div>
                    </div>
                    </>
                    )}
                  </div>

                  <Field label={L('Dados que o bot deve coletar antes de transferir (um por linha)')}>
                    <PlainTextarea
                      value={state.chatbotCollect}
                      onChange={(v) => setState({ ...state, chatbotCollect: v })}
                      rows={3}
                      placeholder={'Ex: Nome\nCNPJ/CPF\nProduto e quantidade'}
                    />
                  </Field>

                  {/* Transferências dinâmicas */}
                  <div>
                    <label className="mb-1 block text-xs font-medium text-slate-600">
                      Transferências (opção → setor que atende)
                    </label>
                    <div className="space-y-2">
                      {state.chatbotTransfers.map((t, i) => (
                        <div key={i} className="flex items-center gap-2">
                          <PlainInput
                            value={t.option}
                            onChange={(v) => {
                              const arr = [...state.chatbotTransfers]
                              arr[i] = { ...arr[i], option: v }
                              setState({ ...state, chatbotTransfers: arr })
                            }}
                            placeholder="Opção (ex: Falar com atendente)"
                            className="flex-1"
                          />
                          <span className="text-slate-400">→</span>
                          <PlainInput
                            value={t.department}
                            onChange={(v) => {
                              const arr = [...state.chatbotTransfers]
                              arr[i] = { ...arr[i], department: v }
                              setState({ ...state, chatbotTransfers: arr })
                            }}
                            placeholder="Setor (ex: Comercial)"
                            className="flex-1"
                          />
                          <button
                            type="button"
                            onClick={() =>
                              setState({ ...state, chatbotTransfers: state.chatbotTransfers.filter((_, x) => x !== i) })
                            }
                            className="rounded p-1 text-rose-500 hover:bg-rose-50"
                            aria-label="Remover"
                          >
                            <X className="h-4 w-4" />
                          </button>
                        </div>
                      ))}
                    </div>
                    <button
                      type="button"
                      onClick={() =>
                        setState({ ...state, chatbotTransfers: [...state.chatbotTransfers, { option: '', department: '' }] })
                      }
                      className="mt-2 inline-flex items-center gap-2 rounded-lg border border-dashed border-slate-300 px-3 py-2 text-sm text-slate-500 hover:border-[#4F8EF7] hover:text-[#4F8EF7]"
                    >
                      <Plus className="h-4 w-4" /> Adicionar transferência
                    </button>
                  </div>

                  <Field label={L('Mensagem de encerramento')}>
                    <PlainTextarea
                      value={state.chatbotClosing}
                      onChange={(v) => setState({ ...state, chatbotClosing: v })}
                      rows={2}
                      placeholder="Ex: Obrigado! Em instantes um atendente falará com você."
                    />
                  </Field>
                </div>
              </div>

            </div>
          </SectionBlock>
        )}

        {/* ── Seção: IA ── */}
        {currentKey === 'ia' && (
          <SectionBlock
            number={section + 1}
            total={totalSections}
            title={cfg?.automationTypes.includes('ia_avancada') ? 'Inteligência Artificial Avançada' : 'Inteligência Artificial'}
            icon={<Sparkles className="h-5 w-5 text-[#4F8EF7]" />}
            description="Preencha as informações abaixo para configurarmos a IA do seu atendimento."
          >
            <div className="space-y-5">

              {/* Identidade da IA */}
              <div className="rounded-xl border border-slate-200 bg-white p-4">
                <h3 className="mb-3 text-sm font-semibold text-slate-800">Identidade da IA</h3>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <Field label={L('Nome da IA (ex: Ana, Max, Bia) *')}>
                    <PlainInput
                      value={state.aiAgentName}
                      onChange={(v) => { setState({ ...state, aiAgentName: v }); clearError('aiAgentName') }}
                      placeholder="Ex: Ana"
                    />
                    {errors.aiAgentName && (
                      <p className="mt-1 text-xs font-medium text-rose-600">{errors.aiAgentName}</p>
                    )}
                  </Field>
                  <Field label={L('Tom de comunicação')}>
                    <PlainSelect
                      value={state.aiTone}
                      onChange={(v) => setState({ ...state, aiTone: v as AiTone })}
                      options={[
                        { value: 'formal', label: 'Formal — linguagem profissional e respeitosa' },
                        { value: 'casual', label: 'Casual — amigável e descontraído' },
                        { value: 'tecnico', label: 'Técnico — objetivo e preciso' },
                      ]}
                    />
                  </Field>
                </div>
              </div>

              {/* Sobre a empresa */}
              <div className="rounded-xl border border-slate-200 bg-white p-4">
                <h3 className="mb-3 text-sm font-semibold text-slate-800">Sobre a empresa</h3>
                <div className="space-y-3">
                  <Field label={L('Descreva o que a empresa faz e para quem atende *')}>
                    <PlainTextarea
                      value={state.aiCompanyDescription}
                      onChange={(v) => { setState({ ...state, aiCompanyDescription: v }); clearError('aiCompanyDescription') }}
                      rows={3}
                      placeholder="Ex: Somos uma clínica de estética que atende mulheres entre 25 e 50 anos, oferecendo tratamentos faciais e corporais…"
                    />
                    {errors.aiCompanyDescription && (
                      <p className="mt-1 text-xs font-medium text-rose-600">{errors.aiCompanyDescription}</p>
                    )}
                  </Field>
                  <Field label={L('Localização (cidade, estado ou região de atendimento)')}>
                    <PlainInput
                      value={state.aiLocation}
                      onChange={(v) => setState({ ...state, aiLocation: v })}
                      placeholder="Ex: São Paulo, SP — ou atendimento nacional"
                    />
                  </Field>
                  <Field label={L('Redes sociais (Instagram, Facebook, TikTok…)')}>
                    <PlainInput
                      value={state.aiSocialMedia}
                      onChange={(v) => setState({ ...state, aiSocialMedia: v })}
                      placeholder="Ex: Instagram @suaempresa · Facebook /suaempresa"
                    />
                  </Field>
                </div>
              </div>

              {/* Serviços e valores */}
              <div className="rounded-xl border border-slate-200 bg-white p-4">
                <h3 className="mb-3 text-sm font-semibold text-slate-800">Serviços e valores</h3>
                <div className="space-y-3">
                  <Field label={L('Liste os principais serviços/produtos *')}>
                    <PlainTextarea
                      value={state.aiServices}
                      onChange={(v) => { setState({ ...state, aiServices: v }); clearError('aiServices') }}
                      rows={4}
                      placeholder={'Ex:\n- Limpeza de pele: procedimento de 1h\n- Botox: tratamento para rugas\n- Depilação a laser: pacotes de 6 sessões'}
                    />
                    {errors.aiServices && (
                      <p className="mt-1 text-xs font-medium text-rose-600">{errors.aiServices}</p>
                    )}
                  </Field>
                  <div>
                    <span className="mb-1.5 block text-xs font-medium text-slate-600">
                      A IA pode informar os preços dos serviços?
                    </span>
                    <div className="flex items-center gap-3">
                      {[{ v: true, l: 'Sim, pode informar' }, { v: false, l: 'Não, enviar para atendente' }].map(({ v, l }) => (
                        <label key={String(v)} className="inline-flex items-center gap-1.5 cursor-pointer text-sm">
                          <input
                            type="radio"
                            checked={state.aiHasPrices === v}
                            onChange={() => setState({ ...state, aiHasPrices: v })}
                            className="h-4 w-4 accent-[#4F8EF7]"
                          />
                          {l}
                        </label>
                      ))}
                    </div>
                  </div>
                  {state.aiHasPrices && (
                    <Field label={L('Informe a tabela de preços')}>
                      <PlainTextarea
                        value={state.aiPrices}
                        onChange={(v) => setState({ ...state, aiPrices: v })}
                        rows={4}
                        placeholder={'Ex:\n- Limpeza de pele: R$ 180\n- Botox (por área): R$ 450\n- Depilação laser (axila): R$ 120/sessão'}
                      />
                    </Field>
                  )}
                </div>
              </div>

              {/* Fluxo de atendimento */}
              <div className="rounded-xl border border-slate-200 bg-white p-4">
                <h3 className="mb-3 text-sm font-semibold text-slate-800">Fluxo de atendimento</h3>
                <div className="space-y-3">
                  <Field label={L('Como a IA deve conduzir a conversa? *')}>
                    <PlainTextarea
                      value={state.aiAttendanceFlow}
                      onChange={(v) => { setState({ ...state, aiAttendanceFlow: v }); clearError('aiAttendanceFlow') }}
                      rows={4}
                      placeholder={'Ex: 1. Saudar o cliente pelo nome\n2. Perguntar o que está procurando\n3. Apresentar os serviços relacionados\n4. Oferecer agendamento\n5. Se o cliente tiver dúvidas complexas, transferir para atendente'}
                    />
                    {errors.aiAttendanceFlow && (
                      <p className="mt-1 text-xs font-medium text-rose-600">{errors.aiAttendanceFlow}</p>
                    )}
                  </Field>
                  <Field label={L('Quando a IA deve transferir para um atendente humano? *')}>
                    <PlainTextarea
                      value={state.aiTransferConditions}
                      onChange={(v) => { setState({ ...state, aiTransferConditions: v }); clearError('aiTransferConditions') }}
                      rows={3}
                      placeholder={'Ex:\n- Quando o cliente reclamar de um serviço\n- Quando pedir falar com um responsável\n- Quando a pergunta não tiver resposta clara\n- Fora do horário comercial'}
                    />
                    {errors.aiTransferConditions && (
                      <p className="mt-1 text-xs font-medium text-rose-600">{errors.aiTransferConditions}</p>
                    )}
                  </Field>
                  <Field label={L('O que a IA NÃO deve fazer ou dizer?')}>
                    <PlainTextarea
                      value={state.aiRestrictions}
                      onChange={(v) => setState({ ...state, aiRestrictions: v })}
                      rows={3}
                      placeholder={'Ex:\n- Não citar concorrentes\n- Não dar desconto sem autorização\n- Não confirmar agendamentos sem verificar disponibilidade'}
                    />
                  </Field>
                  <Field label={L('O que a IA responde quando NÃO souber algo?')}>
                    <PlainTextarea
                      value={state.aiWhenUnknown}
                      onChange={(v) => setState({ ...state, aiWhenUnknown: v })}
                      rows={2}
                      placeholder="Ex: “Não tenho essa informação agora, vou chamar um atendente pra te ajudar.”"
                    />
                  </Field>
                </div>
              </div>

              {/* Mais informações (opcional) — perguntas do briefing de IA */}
              <div className="rounded-xl border border-slate-200 bg-white p-4">
                <h3 className="mb-1 text-sm font-semibold text-slate-800">
                  Mais sobre o atendimento
                </h3>
                <p className="mb-3 text-xs text-slate-500">
                  Quanto mais completo, melhor a IA atende. Tudo aqui é opcional.
                </p>
                <div className="space-y-3">
                  <Field label={L('Endereço de cada unidade (com ponto de referência)')}>
                    <PlainTextarea
                      value={state.aiAddress}
                      onChange={(v) => setState({ ...state, aiAddress: v })}
                      rows={2}
                      placeholder="Ex: Rua X, 123 — ao lado do mercado Y (Centro)"
                    />
                  </Field>
                  <Field label={L('Frase ou bordão da empresa que a IA deva usar')}>
                    <PlainInput
                      value={state.aiSlogan}
                      onChange={(v) => setState({ ...state, aiSlogan: v })}
                      placeholder="Ex: “Seu sorriso é a nossa marca!”"
                    />
                  </Field>
                  <Field label={L('Serviços/produtos mais procurados')}>
                    <PlainTextarea
                      value={state.aiMostSought}
                      onChange={(v) => setState({ ...state, aiMostSought: v })}
                      rows={2}
                      placeholder="Ex: Limpeza de pele, clareamento, botox"
                    />
                  </Field>
                  <Field label={L('Convênios, planos ou parcerias (e o que cobrem)')}>
                    <PlainTextarea
                      value={state.aiPartnerships}
                      onChange={(v) => setState({ ...state, aiPartnerships: v })}
                      rows={2}
                      placeholder="Ex: Convênio Z — cobre consultas e limpeza"
                    />
                  </Field>
                  <Field label={L('Formas de pagamento (dinheiro, PIX, cartão, parcelamento)')}>
                    <PlainTextarea
                      value={state.aiPaymentMethods}
                      onChange={(v) => setState({ ...state, aiPaymentMethods: v })}
                      rows={2}
                      placeholder="Ex: PIX, dinheiro, cartão em até 6x sem juros"
                    />
                  </Field>
                  <Field label={L('Promoções ou condições especiais')}>
                    <PlainTextarea
                      value={state.aiPromotions}
                      onChange={(v) => setState({ ...state, aiPromotions: v })}
                      rows={2}
                      placeholder="Ex: 1ª avaliação gratuita"
                    />
                  </Field>
                  <Field label={L('Mensagem que a IA manda no PRIMEIRO contato')}>
                    <PlainTextarea
                      value={state.aiFirstMessage}
                      onChange={(v) => setState({ ...state, aiFirstMessage: v })}
                      rows={2}
                      placeholder="Ex: “Olá! Seja bem-vindo(a) à Clínica X 😊 Como posso te ajudar?”"
                    />
                  </Field>
                  <Field label={L('Quais dados a IA deve pedir para agendar?')}>
                    <PlainTextarea
                      value={state.aiSchedulingData}
                      onChange={(v) => setState({ ...state, aiSchedulingData: v })}
                      rows={2}
                      placeholder="Ex: nome, telefone, unidade, dia e horário"
                    />
                  </Field>
                  <Field label={L('Mensagem depois que o cliente passa os dados')}>
                    <PlainTextarea
                      value={state.aiPostDataMessage}
                      onChange={(v) => setState({ ...state, aiPostDataMessage: v })}
                      rows={2}
                      placeholder="Ex: “Perfeito! Seu horário está reservado. Qualquer coisa, é só chamar.”"
                    />
                  </Field>
                  <Field label={L('O que a IA faz quando é um cliente que já é atendido por vocês?')}>
                    <PlainTextarea
                      value={state.aiExistingClient}
                      onChange={(v) => setState({ ...state, aiExistingClient: v })}
                      rows={2}
                      placeholder="Ex: Cumprimentar pelo nome, puxar histórico, oferecer retorno"
                    />
                  </Field>
                  <Field label={L('Perguntas frequentes dos clientes (pergunta + resposta certa)')}>
                    <PlainTextarea
                      value={state.aiFaq}
                      onChange={(v) => setState({ ...state, aiFaq: v })}
                      rows={5}
                      placeholder={'Ex:\nP: Vocês atendem no sábado?\nR: Sim, das 8h às 12h.\n\nP: Precisa de agendamento?\nR: Sim, pelo WhatsApp.'}
                    />
                  </Field>
                </div>
              </div>

              {/* IA Avançada — integração externa */}
              {cfg?.automationTypes.includes('ia_avancada') && (
                <div className="rounded-xl border border-purple-200 bg-purple-50 p-4">
                  <h3 className="mb-1 text-sm font-semibold text-purple-900">
                    Integração com sistema externo
                  </h3>
                  <p className="mb-3 text-xs text-purple-700">
                    A IA avançada pode consultar seu sistema interno (CRM, ERP, plataforma própria) em tempo real. Preencha os dados abaixo.
                  </p>
                  <div className="space-y-3">
                    <Field label={L('Qual sistema será integrado? (nome do sistema)')}>
                      <PlainInput
                        value={state.aiExternalSystem}
                        onChange={(v) => setState({ ...state, aiExternalSystem: v })}
                        placeholder="Ex: Protheus, Sales Force, sistema próprio, plataforma da loja…"
                      />
                    </Field>
                    <Field label={L('O que a IA precisa consultar neste sistema? *')}>
                      <PlainTextarea
                        value={state.aiExternalWhatToQuery}
                        onChange={(v) => { setState({ ...state, aiExternalWhatToQuery: v }); clearError('aiExternalWhatToQuery') }}
                        rows={3}
                        placeholder={'Ex:\n- Verificar status de pedido pelo CPF\n- Consultar estoque de produto\n- Ver histórico de compras do cliente\n- Confirmar agendamento'}
                      />
                      {errors.aiExternalWhatToQuery && (
                        <p className="mt-1 text-xs font-medium text-rose-600">{errors.aiExternalWhatToQuery}</p>
                      )}
                    </Field>
                    <Field label={L('URL da API ou webhook (se já tiver)')}>
                      <PlainInput
                        value={state.aiExternalApiUrl}
                        onChange={(v) => setState({ ...state, aiExternalApiUrl: v })}
                        placeholder="https://api.suaempresa.com.br/v1/..."
                      />
                    </Field>
                    <Field label={L('Como autenticar na API? (token, usuário/senha, chave…)')}>
                      <PlainTextarea
                        value={state.aiExternalAuth}
                        onChange={(v) => setState({ ...state, aiExternalAuth: v })}
                        rows={2}
                        placeholder="Ex: Bearer token no header Authorization, ou usuário admin + senha…"
                      />
                    </Field>
                    <Field label={L('Descreva exemplos de situações em que a IA consultaria o sistema')}>
                      <PlainTextarea
                        value={state.aiExternalExamples}
                        onChange={(v) => setState({ ...state, aiExternalExamples: v })}
                        rows={3}
                        placeholder={'Ex:\nCliente pergunta "Meu pedido já saiu?" → IA consulta API com CPF → retorna status\nCliente quer saber estoque → IA consulta catálogo → responde disponibilidade'}
                      />
                    </Field>
                  </div>
                </div>
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
            <Field label={L('Informações necessárias para a automação *')}>
              <PlainTextarea
                value={state.externalAutomationInfo}
                onChange={(v) => { setState({ ...state, externalAutomationInfo: v }); clearError('externalAutomationInfo') }}
                rows={6}
                placeholder="Descreva as integrações, credenciais ou dados que serão necessários…"
              />
              {errors.externalAutomationInfo && (
                <p className="mt-1 text-xs font-medium text-rose-600">{errors.externalAutomationInfo}</p>
              )}
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
            <Field label={L('Algo mais que devemos saber?')}>
              <PlainTextarea
                value={state.extraNotes}
                onChange={(v) => setState({ ...state, extraNotes: v })}
                rows={6}
                placeholder="Informações adicionais, preferências, dúvidas…"
              />
            </Field>
            {customQuestions.map((q) => (
              <div key={q.id} className="mt-4">
                <Field label={q.label}>
                  {q.type === 'textarea' ? (
                    <PlainTextarea
                      value={state.customAnswers[q.fieldKey] ?? ''}
                      onChange={(v) =>
                        setState({ ...state, customAnswers: { ...state.customAnswers, [q.fieldKey]: v } })
                      }
                      rows={4}
                      placeholder={q.placeholder ?? undefined}
                    />
                  ) : (
                    <PlainInput
                      value={state.customAnswers[q.fieldKey] ?? ''}
                      onChange={(v) =>
                        setState({ ...state, customAnswers: { ...state.customAnswers, [q.fieldKey]: v } })
                      }
                      placeholder={q.placeholder ?? undefined}
                    />
                  )}
                </Field>
              </div>
            ))}
          </SectionBlock>
        )}
      </main>

      {/* ── Modal de confirmação das mensagens do chatbot ── */}
      {chatbotConfirmOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-lg rounded-2xl bg-white shadow-2xl">
            <div className="border-b border-slate-200 px-6 py-4">
              <h2 className="text-base font-semibold text-slate-900">
                Confirmar mensagens do chatbot
              </h2>
              <p className="mt-1 text-xs text-slate-500">
                Revise as mensagens abaixo. Elas serão configuradas exatamente como estão.
              </p>
            </div>

            <div className="space-y-4 px-6 py-4 max-h-[60vh] overflow-y-auto">
              <div>
                <p className="mb-1.5 text-xs font-medium uppercase tracking-wider text-slate-400">
                  Saudação
                </p>
                <div className="rounded-xl border border-[#4F8EF7]/20 bg-[#4F8EF7]/5 p-3">
                  <pre className="whitespace-pre-wrap font-sans text-sm text-slate-700 leading-relaxed">
                    {state.greetingMessage}
                  </pre>
                </div>
              </div>
              <div>
                <p className="mb-1.5 text-xs font-medium uppercase tracking-wider text-slate-400">
                  Fora do horário
                </p>
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                  <pre className="whitespace-pre-wrap font-sans text-sm text-slate-700 leading-relaxed">
                    {state.offHoursMessage}
                  </pre>
                </div>
              </div>

              <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-800">
                ⚠️ <strong>Atenção:</strong> essas mensagens serão instaladas no seu sistema exatamente como exibidas acima. Você poderá solicitar ajustes futuramente ao nosso time.
              </div>
            </div>

            <div className="flex justify-end gap-2 border-t border-slate-200 px-6 py-4">
              <button
                type="button"
                onClick={() => setChatbotConfirmOpen(false)}
                className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                Voltar e editar
              </button>
              <button
                type="button"
                onClick={() => {
                  setChatbotConfirmOpen(false)
                  advanceSection()
                }}
                className="inline-flex items-center gap-2 rounded-lg bg-[#4F8EF7] px-5 py-2 text-sm font-medium text-white hover:bg-[#6BA0F9]"
              >
                <Check className="h-4 w-4" /> Confirmar e continuar
              </button>
            </div>
          </div>
        </div>
      )}

      <footer className="fixed inset-x-0 bottom-0 z-30 border-t border-slate-200 bg-white/95 backdrop-blur">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-3 px-4 py-3 sm:px-6">
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

/** Selo bem visível deixando claro que a prévia é só uma ideia — o texto final é
 * ajustado com o cliente numa reunião, não precisa "acertar" aqui. */
function PersonalizavelBadge() {
  return (
    <div className="mt-3 text-center">
      <span className="inline-flex items-center gap-1.5 rounded-full bg-rose-600 px-3 py-1 text-xs font-bold text-white shadow-sm">
        <Pencil className="h-3.5 w-3.5" />
        100% Personalizável
      </span>
      <p className="mt-1.5 text-[11px] text-slate-500">
        Isso é só uma ideia — você ajusta tudo em reunião com a nossa equipe.
      </p>
    </div>
  )
}

// ── Mockup de iPhone simulando o WhatsApp, pra prévia de "Mensagem de saudação"/
// "Fora do horário" ficar mais próxima do que o cliente final vai realmente ver. ──
function WhatsAppMockup({ contactName, children }: { contactName: string; children: React.ReactNode }) {
  return (
    <div className="mx-auto w-full max-w-[280px]">
      <div className="relative rounded-[2.25rem] bg-slate-900 p-[6px] shadow-xl">
        <div className="absolute left-1/2 top-[6px] z-10 h-5 w-24 -translate-x-1/2 rounded-b-2xl bg-slate-900" />
        {/* Proporção de tela de iPhone (9:19.5) — a mensagem rola dentro da área de
            conversa, o "aparelho" não estica com mensagens mais longas. */}
        <div className="flex aspect-[9/19.5] flex-col overflow-hidden rounded-[1.85rem] bg-[#ECE5DD]">
          {/* Barra de status */}
          <div className="flex shrink-0 items-center justify-between bg-[#075E54] px-4 pb-1 pt-2 text-white">
            <span className="text-[10px] font-medium">9:41</span>
            <div className="flex items-center gap-1">
              <SignalHigh className="h-3 w-3" />
              <Wifi className="h-3 w-3" />
              <BatteryFull className="h-3.5 w-3.5" />
            </div>
          </div>
          {/* Cabeçalho do contato (WhatsApp) */}
          <div className="flex shrink-0 items-center gap-2 bg-[#075E54] px-3 pb-2 pt-1 text-white">
            <ArrowLeft className="h-4 w-4 shrink-0" />
            <div className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-white/20 text-[10px] font-semibold">
              {initials(contactName)}
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-xs font-semibold leading-tight">{contactName}</p>
              <p className="text-[9px] text-white/70">online</p>
            </div>
            <Video className="h-4 w-4 shrink-0" />
            <Phone className="h-3.5 w-3.5 shrink-0" />
            <MoreVertical className="h-4 w-4 shrink-0" />
          </div>
          {/* Área de conversa */}
          <div
            className="flex-1 space-y-2 overflow-y-auto px-3 py-3"
            style={{
              backgroundImage:
                'radial-gradient(rgba(0,0,0,0.035) 1px, transparent 1px), radial-gradient(rgba(0,0,0,0.035) 1px, transparent 1px)',
              backgroundSize: '18px 18px',
              backgroundPosition: '0 0, 9px 9px',
            }}
          >
            {children}
          </div>
          {/* Barra de digitação */}
          <div className="flex shrink-0 items-center gap-2 bg-[#F0F0F0] px-3 py-2">
            <div className="flex-1 truncate rounded-full bg-white px-3 py-1.5 text-[10px] text-slate-400">
              Mensagem
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

/** Balão de mensagem RECEBIDA (do negócio/bot) no mockup do WhatsApp. */
function WaBubbleIn({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative max-w-[88%] rounded-lg rounded-tl-none bg-white px-2.5 py-2 shadow-sm">
      <p className="whitespace-pre-wrap text-[11px] leading-relaxed text-slate-800">{children}</p>
      <p className="mt-1 text-right text-[9px] text-slate-400">9:41</p>
    </div>
  )
}

/** Balão de mensagem ENVIADA (pelo cliente final) no mockup do WhatsApp. */
function WaBubbleOut({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative ml-auto max-w-[88%] rounded-lg rounded-tr-none bg-[#DCF8C6] px-2.5 py-2 shadow-sm">
      <p className="whitespace-pre-wrap text-[11px] leading-relaxed text-slate-800">{children}</p>
      <p className="mt-1 text-right text-[9px] text-slate-400">9:41</p>
    </div>
  )
}

/** Opções como botões clicáveis (estilo "reply buttons" do WhatsApp), pro mockup. */
function WaButtonOptions({ options }: { options: string[] }) {
  return (
    <div className="max-w-[88%] space-y-1">
      {options.map((o, i) => (
        <div
          key={i}
          className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-center text-[11px] font-medium text-[#128C7E] shadow-sm"
        >
          {o}
        </div>
      ))}
    </div>
  )
}

/**
 * Simula, no mockup do WhatsApp, como o menu principal do chatbot vai se comportar —
 * atualiza ao vivo conforme o cliente digita a mensagem/opções ou clica em "Usar
 * exemplo", nos dois estilos possíveis (numerado ou botões) pra ele comparar e escolher.
 */
function ChatbotMenuPreview({
  menu,
  style,
}: {
  menu: { question: string; options: string }
  style: 'numbered' | 'buttons'
}) {
  const typedOptions = menu.options.split('\n').map((o) => o.trim()).filter(Boolean)
  const options = typedOptions.length > 0 ? typedOptions : ['Comercial', 'Suporte', 'Financeiro']
  const question = menu.question.trim() || 'Olá! Como podemos te ajudar hoje?'
  const first = options[0]
  const confirmation = `Perfeito! Já estou te transferindo para o time de ${first}. Um atendente vai continuar por aqui. 👍`

  if (style === 'buttons') {
    return (
      <>
        <WaBubbleOut>Bom dia! 👋</WaBubbleOut>
        <WaBubbleIn>{question}</WaBubbleIn>
        <WaButtonOptions options={options} />
        <WaBubbleOut>{first}</WaBubbleOut>
        <WaBubbleIn>{confirmation}</WaBubbleIn>
      </>
    )
  }

  const numbered = options.map((o, i) => `${numberEmoji(i)} ${o}`).join('\n')
  return (
    <>
      <WaBubbleOut>Bom dia! 👋</WaBubbleOut>
      <WaBubbleIn>{`${question}\n\n${numbered}\n\nDigite o número da opção desejada.`}</WaBubbleIn>
      <WaBubbleOut>1</WaBubbleOut>
      <WaBubbleIn>{confirmation}</WaBubbleIn>
    </>
  )
}

// ── Popover genérico "Saiba mais aqui", reaproveitado em vários campos do
// formulário público pra explicar conceitos sem poluir a tela com texto fixo. ──
function InfoPopover({ title, children }: { title: string; children: React.ReactNode }) {
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
        className="inline-flex items-center gap-1 text-xs font-medium text-[#4F8EF7] hover:text-[#3B7AE0] hover:underline"
      >
        <HelpCircle className="h-3.5 w-3.5" />
        Saiba mais aqui
      </button>
      {open && (
        <div className="absolute left-0 top-7 z-50 w-80 rounded-xl border border-slate-200 bg-white p-4 shadow-xl text-xs text-slate-700 space-y-3">
          <p className="font-semibold text-slate-900 text-sm">{title}</p>
          {children}
        </div>
      )}
    </div>
  )
}

function RoleInfoPopover() {
  return (
    <InfoPopover title="Sobre os campos">
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
    </InfoPopover>
  )
}

function SectorInfoPopover() {
  return (
    <InfoPopover title="Sobre os setores">
      <p>
        Setor é uma <strong>fila de atendimento</strong> — cada usuário cadastrado é vinculado a um
        ou mais setores, e só enxerga as conversas daquele setor. É assim que dividimos o que cada
        pessoa tem acesso a ver e responder.
      </p>
      <p>
        <strong>Empresa com vários departamentos</strong> (ex: Comercial, Suporte, Financeiro)? Crie
        um setor pra cada um.
      </p>
      <p>
        <strong>Empresa sem departamentos separados</strong>, um time só cuidando de tudo? Crie
        mesmo assim pelo menos um setor (ex: "Atendimento" ou o nome da empresa) — é obrigatório
        pra representar o time, mesmo que seja um só.
      </p>
    </InfoPopover>
  )
}

function ChatbotFlowInfoPopover() {
  return (
    <InfoPopover title="Sobre o fluxo do chatbot">
      <p>
        É o <strong>menu que o cliente vê</strong> assim que manda mensagem no WhatsApp — um resumo
        de como o atendimento se divide, que vira as opções do bot automaticamente.
      </p>
      <p>
        Comece pelo <strong>menu principal</strong> (ex: "1. Comercial, 2. Suporte, 3. Financeiro").
        Se uma opção precisar abrir novas escolhas dentro dela, adicione um <strong>submenu</strong>.
      </p>
      <p>
        Depois que o cliente escolhe uma opção, ele é direcionado ao setor responsável — por isso
        os setores da Seção 1 e as opções do menu aqui costumam conversar entre si.
      </p>
    </InfoPopover>
  )
}

function WhatsappNumbersInfoPopover() {
  return (
    <InfoPopover title="Sobre os números">
      <p>
        Esses serão os <strong>números conectados na plataforma</strong>. A partir da conexão, as
        conversas que chegarem nesses WhatsApps vão passar a aparecer direto na <strong>NX</strong>,
        pra seu time atender por lá.
      </p>
    </InfoPopover>
  )
}

function BriefingHeader({ companyName }: { companyName: string }) {
  return (
    <header className="border-b border-slate-200 bg-white shadow-sm">
      <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-4 sm:px-6">
        <div className="flex items-center gap-2">
          <div className="grid h-9 w-9 place-items-center rounded-lg bg-[#4F8EF7] text-[11px] font-extrabold text-white">
            NX
          </div>
          <div className="leading-tight">
            <p className="text-sm font-semibold text-slate-900">Grupo NX Digital</p>
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

/**
 * Barra de seleção múltipla (dropdown com checkboxes). Substitui a lista de
 * botões empilhados — fica compacta mesmo com muitos setores.
 */
function MultiSelectBar({
  selected,
  options,
  onChange,
  placeholder = 'Selecione…',
}: {
  selected: string[]
  options: string[]
  onChange: (next: string[]) => void
  placeholder?: string
}) {
  const [open, setOpen] = React.useState(false)
  const ref = React.useRef<HTMLDivElement>(null)

  React.useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const toggle = (opt: string) => {
    onChange(
      selected.includes(opt)
        ? selected.filter((s) => s !== opt)
        : [...selected, opt],
    )
  }

  return (
    <div className="relative" ref={ref}>
      <div
        role="button"
        tabIndex={0}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            setOpen((o) => !o)
          }
        }}
        className={cn(
          'flex min-h-[38px] w-full cursor-pointer items-center justify-between gap-2 rounded-lg border bg-white px-2.5 py-1.5 text-sm',
          open
            ? 'border-[#4F8EF7] ring-4 ring-[#4F8EF7]/15'
            : 'border-slate-300',
        )}
      >
        {selected.length > 0 ? (
          <span className="flex flex-wrap gap-1">
            {selected.map((s) => (
              <span
                key={s}
                className="inline-flex items-center gap-1 rounded-full bg-[#4F8EF7]/10 px-2 py-0.5 text-xs font-medium text-[#4F8EF7]"
              >
                {s}
                <span
                  role="button"
                  tabIndex={-1}
                  onClick={(e) => {
                    e.stopPropagation()
                    toggle(s)
                  }}
                  className="grid h-3.5 w-3.5 place-items-center rounded-full hover:bg-[#4F8EF7]/20"
                >
                  <X className="h-2.5 w-2.5" />
                </span>
              </span>
            ))}
          </span>
        ) : (
          <span className="text-slate-400">{placeholder}</span>
        )}
        <ChevronDown
          className={cn(
            'h-4 w-4 shrink-0 text-slate-400 transition-transform',
            open && 'rotate-180',
          )}
        />
      </div>

      {open && (
        <div className="absolute z-50 mt-1 max-h-56 w-full overflow-y-auto rounded-lg border border-slate-200 bg-white py-1 shadow-xl">
          {options.map((opt) => {
            const active = selected.includes(opt)
            return (
              <button
                key={opt}
                type="button"
                onClick={() => toggle(opt)}
                className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm text-slate-700 hover:bg-slate-50"
              >
                <span
                  className={cn(
                    'grid h-4 w-4 shrink-0 place-items-center rounded border',
                    active
                      ? 'border-[#4F8EF7] bg-[#4F8EF7] text-white'
                      : 'border-slate-300',
                  )}
                >
                  {active && <Check className="h-3 w-3" />}
                </span>
                <span className="truncate">{opt}</span>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

// Unused-import safety net
export const _globe = Globe
export const _chevronDown = ChevronDown
