export type PipelineStage =
  | 'lead'
  | 'welcome'
  | 'contract'
  | 'briefing'
  | 'setup_start'
  | 'setup'
  | 'setup_done'
  | 'delivery'
  | 'delivered'
  | 'active'
  | 'churned'

export interface NoteEntry {
  id: string
  text: string
  author: string
  createdAt: string
  /** Quando true, nota só é visível pra time interno (não aparece em portais públicos). */
  internal?: boolean
}

export interface LogEntry {
  id: string
  action: string
  detail?: string
  createdAt: string
}

export interface FollowUp {
  id: string
  scheduledFor: string
  dayNumber: number
  message: string
  sentAt?: string
  responded?: boolean
}

export interface ChecklistItem {
  id: string
  label: string
  checked: boolean
  checkedAt?: string
  checkedBy?: string
  children?: ChecklistItem[]
}

/**
 * Papel dentro do tenant criado (não confundir com `UserRole` do painel
 * em services/supabase.ts, que é admin/supervisor/suporte).
 */
export type BriefingUserRole = 'atendente' | 'supervisor' | 'admin'

export interface BriefingUser {
  name: string
  email: string
  /** @deprecated mantido só pra ler briefings antigos — use `sectors`. */
  sector?: string
  /** Um usuário pode pertencer a mais de um setor. */
  sectors: string[]
  role: BriefingUserRole
}

export interface BriefingScheduleSlot {
  day: string
  active: boolean
  start: string
  end: string
}

export type WhatsAppType =
  | 'baileys'
  | 'evolution'
  | 'uazapi'
  | 'zapi'
  | 'meow'
  | 'evo'

export type AiTone = 'formal' | 'casual' | 'tecnico'

export interface BriefingData {
  razaoSocial: string
  nomeFantasia: string
  cnpj: string
  site?: string

  users: BriefingUser[]

  schedule: BriefingScheduleSlot[]
  timezone: string

  whatsappNumbers: string[]
  whatsappType: WhatsAppType | string
  useFacebook: boolean
  facebookToken?: string
  /** Credenciais da conta Meta/Facebook para API Oficial */
  facebookEmail?: string
  facebookPassword?: string

  /** @deprecated legado — use chatbotFlow. Mantido p/ briefings antigos. */
  mainFlow: string
  /** Roteiro do chatbot preenchido pelo cliente (base p/ geração do fluxo). */
  chatbotFlow?: ChatbotFlowBriefing
  greetingMessage: string
  offHoursMessage: string
  /** false = cliente optou por NÃO enviar mensagem automática fora do horário. Default true. */
  offHoursEnabled?: boolean
  departments: string[]

  useAI: boolean
  aiTone?: AiTone
  aiInstructions?: string
  aiRestrictions?: string

  // IA Básica — campos estruturados para geração de prompt
  aiAgentName?: string
  aiCompanyDescription?: string
  aiServices?: string
  aiHasPrices?: boolean
  aiPrices?: string
  aiLocation?: string
  aiSocialMedia?: string
  aiAttendanceFlow?: string
  aiTransferConditions?: string
  // IA — perguntas complementares do briefing de IA (todas opcionais)
  aiAddress?: string          // endereço de cada unidade (com referência)
  aiSlogan?: string           // frase/bordão da empresa
  aiMostSought?: string       // serviços/produtos mais procurados
  aiPartnerships?: string     // convênios, planos, parcerias e o que cobrem
  aiPaymentMethods?: string   // formas de pagamento / parcelamento
  aiPromotions?: string       // promoções / condições especiais
  aiFirstMessage?: string     // mensagem no 1º contato
  aiSchedulingData?: string   // dados que a IA pede para agendar
  aiPostDataMessage?: string  // mensagem depois que o cliente passa os dados
  aiExistingClient?: string   // o que fazer quando já é cliente
  aiWhenUnknown?: string      // o que responde quando não sabe
  aiFaq?: string              // perguntas frequentes + respostas certas

  // IA Avançada — integração com sistema externo
  aiExternalSystem?: string
  aiExternalApiUrl?: string
  aiExternalWhatToQuery?: string
  aiExternalAuth?: string
  aiExternalExamples?: string

  extraNotes?: string

  /** Respostas de perguntas de texto livre novas adicionadas pelo admin (ver
   * src/services/briefingTemplate.ts) — chave = fieldKey de briefing_custom_questions. */
  customAnswers?: Record<string, string>

  // Channel-specific info (populated when client submits the public form)
  wavoipInfo?: string
  olxInfo?: string
  mercadolivreInfo?: string
  emailConfig?: string
  externalAutomationInfo?: string

  /**
   * Credenciais de acesso por canal (instagram, messenger, olx, mercadolivre…).
   * Solicitadas no briefing somente quando o canal está habilitado na config.
   */
  channelAccess?: Record<string, { email?: string; password?: string; notes?: string }>

  /** Acesso estruturado da API Oficial (Meta). Coletado quando a config inclui
   *  'api_oficial'. Preferimos partner access (compartilhar BM) a senha/AnyDesk. */
  officialApi?: OfficialApiAccess

  submittedAt: string
}

export type MetaVerificationStatus = 'nao_iniciada' | 'em_analise' | 'aprovada'
export type PartnerAccessStatus = 'pendente' | 'concedido'

/** Dados estruturados de acesso à API Oficial do WhatsApp (Meta/Cloud API). */
export interface OfficialApiAccess {
  /** Nome do portfólio empresarial (Meta) — opcional; o cliente pode não saber. */
  businessPortfolioName?: string
  numeroDedicado?: string
  /** Nome que aparecerá para os clientes no WhatsApp (display name). */
  displayNamePretendido?: string
  verificacaoNegocioStatus?: MetaVerificationStatus
  partnerAccessStatus?: PartnerAccessStatus
}

/** Roteiro do chatbot que o cliente descreve no briefing. Vira base para a
 *  geração automática do fluxo (FlowSpec → JSON) no painel. */
export interface ChatbotFlowBriefing {
  /** Descrição livre de como o atendimento deve funcionar. */
  description: string
  /** Menu principal e submenus. `parentOption` informa qual opção abre o submenu. */
  menus: { question: string; options: string[]; parentOption?: string }[]
  /** Dados que o bot deve coletar antes de passar pro time. */
  collectFields: string[]
  /** Opção → setor que recebe (nome do setor; a fila é resolvida depois). */
  transfers: { option: string; department: string }[]
  /** Mensagem de encerramento desejada. */
  closingMessage: string
}

export type ConnectionType = 'api_oficial' | 'api_comum'
export type AutomationType = 'chatbot' | 'ia_basica' | 'ia_avancada'
export type BriefingChannel = 'whatsapp' | 'instagram' | 'messenger' | 'wavoip' | 'olx' | 'mercadolivre' | 'email'

export interface BriefingConfig {
  connectionTypes: ConnectionType[]
  automationTypes: AutomationType[]
  channels: BriefingChannel[]
  maxUsers: number
  hasExternalAutomation: boolean
  externalAutomationNotes?: string
}

/** Ficha de cadastro preenchida pelo cliente no formulário público. */
export interface FichaCadastro {
  cnpj?: string
  cpfResponsavel?: string
  /** Melhor dia de pagamento (ex.: '10' | '20'). */
  paymentDay?: string
  needsNF?: boolean
  /** Número para envio de NF+Boleto. */
  nfNumber?: string
  /** E-mail para envio de NF+Boleto. */
  nfEmail?: string
  /** Endereço completo (rua, número, bairro, cidade, estado). */
  address?: string
  submittedAt?: string
}

export type ContractStatus = 'not_sent' | 'sent' | 'signed'
export type BriefingStatus =
  | 'not_sent'
  | 'sent'
  | 'filled'
  | 'approved'
  | 'revision'
export type PaymentStatus = 'pending' | 'paid' | 'overdue'

export type PaymentType = 'implementation' | 'monthly' | 'other'
export type PaymentMethod = 'pix' | 'boleto' | 'card' | 'transfer' | 'asaas' | 'other'

export interface Payment {
  id: string
  type: PaymentType
  value: number
  dueDate?: string
  paidAt?: string
  method?: PaymentMethod
  /** Texto livre indicando onde/como foi pago (ex.: "Infinity Tape", "Sicredi"). */
  paidVia?: string
  reference?: string
  note?: string
  source?: 'manual' | 'asaas'
  /** ID externo (ex.: payment id no Asaas) — usado pra dedup no import. */
  externalId?: string
  createdAt: string
}

export interface ExtraLink {
  id: string
  label: string
  url: string
}

export interface ClientAccess {
  id: string
  name: string
  emailOrPhone?: string
  password?: string
  url?: string
}

export interface Client {
  id: string
  name: string
  email: string
  phone: string
  company: string
  tenantId?: string
  tenantServerId?: string
  tenantApiId?: string
  /** Token da API criada dentro do tenant — autentica chamadas /v2/api/external. */
  tenantApiToken?: string
  tenantName?: string
  supportEmail?: string
  supportPassword?: string
  stage: PipelineStage
  /** @deprecated mantido para dados antigos — use responsavelComercial/Entrega. */
  responsavel?: string
  /** Responsável comercial (nome/e-mail de um usuário da equipe). */
  responsavelComercial?: string
  /** Responsável pela entrega (nome/e-mail de um usuário da equipe). */
  responsavelEntrega?: string
  /** Liga/desliga aviso de queda de canais para este tenant. */
  channelNotifyEnabled?: boolean
  /** Número que recebe o aviso de canais (default: telefone do cliente). */
  channelNotifyNumber?: string
  createdAt: string
  stageUpdatedAt?: string

  // ── Fila de configuração ───────────────────────────────────────────────────
  /**
   * Prioridade manual na fila de configuração. Menor passa na frente; vazio =
   * ordem de chegada (data de aprovação do briefing). Usado pra furar fila com
   * justificativa, sem bagunçar a ordem natural.
   */
  queuePriority?: number
  /**
   * Quando a configuração começou de fato. Preenchido ao "puxar" o cliente da
   * fila. Separa quem está *fazendo agora* de quem só está na etapa aguardando
   * a vez — e é o que conta para o limite de simultâneos (WIP).
   */
  setupStartedAt?: string

  // Etapa 2 — Contrato & Financeiro
  contractUrl?: string
  contractSentAt?: string
  contractSignedAt?: string
  /** Data URL (base64) ou URL externa do arquivo do contrato. */
  contractFile?: string
  /** Nome do arquivo do contrato. */
  contractFileName?: string
  asaasCustomerId?: string
  asaasPaymentId?: string
  asaasSubscriptionId?: string
  implementationValue?: number
  monthlyValue?: number
  dueDay?: number
  paymentStatus?: PaymentStatus
  lastPaymentCheck?: string

  // Plataformas onde o cliente usa o sistema
  platformApp?: boolean
  platformWeb?: boolean
  platformChat?: boolean

  // Acessos (redes sociais, painéis externos, etc.)
  accesses?: ClientAccess[]

  // Financeiro — registros manuais
  payments?: Payment[]
  extraLinks?: ExtraLink[]
  financeNotes?: string

  // Ficha de cadastro (formulário público de boas-vindas)
  fichaCadastro?: FichaCadastro
  /** Número pessoal do cliente p/ envio do briefing e cobranças (55+DDD+número). */
  briefingNumber?: string

  // Etapa 3 — Briefing
  briefingToken?: string
  briefingStatus?: BriefingStatus
  briefingSentAt?: string
  briefingData?: BriefingData
  briefingApprovedAt?: string
  briefingRevisionNote?: string
  briefingConfig?: BriefingConfig

  // Etapa 4 — Entrega
  deliveryChecklist: ChecklistItem[]
  /** Roteiro da sessão de ativação com o cliente (só o que exige a presença
   *  dele: QR code, aprovações na Meta, treinamento). */
  sessionChecklist?: ChecklistItem[]
  deliveryHandoffChecklist?: ChecklistItem[]
  deliveryDate?: string
  deliveryNotes?: string
  deliveryCompletedAt?: string

  // Tipo de implementação (marcado pelo time interno). Aparece nos
  // painéis correspondentes do Dashboard.
  hasApiOficial?: boolean
  hasIa?: boolean
  hasAutomacaoExterna?: boolean

  // Estado da configuração de API Oficial e de IA (checklist com estado, não
  // binário). Cada passo tem feito/pendente + timestamp de quando foi marcado.
  configProgress?: ConfigProgress

  // Etapa 6 — Follow-up
  followUpActive: boolean
  followUps: FollowUp[]

  // Arquivamento (soft-delete). Quando preenchido, o cliente sai do pipeline e
  // da lista ativa, indo para "Arquivados" — de onde pode ser restaurado ou
  // excluído permanentemente.
  archivedAt?: string

  // Geral
  notes: NoteEntry[]
  logs: LogEntry[]
}

/** Estado de um passo de configuração: feito/pendente + quando foi marcado. */
export interface ConfigStepState {
  done: boolean
  at?: string | null
}

/** Progresso de configuração por área (chaves em src/constants/configProgress). */
export interface ConfigProgress {
  api?: Record<string, ConfigStepState>
  ia?: Record<string, ConfigStepState>
}

export interface AppSettings {
  asaasApiKey?: string
  asaasEnvironment?: 'sandbox' | 'production'
  /** Intervalo (minutos) do auto-sync de pagamentos Asaas. 0 desliga. */
  asaasSyncIntervalMin?: number
  /** Senha padrão usada na criação de tenant/usuários (não hardcoded no código). */
  defaultTenantPassword?: string
  /** Senha padrão para acessos enviados no PDF de handoff. */
  defaultAccessPassword?: string
  /** Número de suporte impresso no PDF de acessos. */
  supportPhone?: string
  followUpsEnabled?: boolean
  followUpTemplates?: {
    day3?: string
    day7?: string
    day15?: string
    day30?: string
  }
  /** Dias após delivery_completed_at pra disparar NPS automático. */
  npsDelayDays?: number
  /** Liga/desliga criação automática de NPS. */
  npsEnabled?: boolean
  /** URL da Edge Function notify-ticket (notificação por e-mail). */
  notifyEdgeFunctionUrl?: string
  /** Liga/desliga notificação por e-mail. */
  notifyEnabled?: boolean
  /** Meta de novos clientes no mês (clientes que viraram active no período). */
  goalNewClientsMonthly?: number
  /** Meta de MRR (R$) no mês. */
  goalMrrMonthly?: number
  /** Meta de NPS médio do mês. */
  goalNpsMonthly?: number
  /** Liga exibição de metas no dashboard / centro de comando. */
  goalsEnabled?: boolean
  /** Último backup feito (ISO). Usado pra avisar quando passar de N dias. */
  lastBackupAt?: string
  /** Quantos dias sem backup antes de mostrar aviso. Default 7. */
  backupRemindDays?: number
  /** Grupo de WhatsApp para alertas do suporte (token fica só no backend). */
  supportGroup?: SupportGroupConfig
  /** Credenciais da Evolution API para criar instâncias de canais. */
  evolution?: EvolutionConfig
  /** Servidores UAZAPI para reconciliar o status real dos canais. */
  uazapi?: UazapiServer[]
  /** SLA (em dias) por etapa do pipeline. Sobrescreve os defaults de
   *  STAGE_SLA_DAYS. Etapas ausentes usam o default. */
  slaByStage?: Partial<Record<PipelineStage, number>>
  /** Quantas configurações simultâneas cada responsável de entrega pode ter
   *  em "fazendo agora". Default DEFAULT_SETUP_WIP_LIMIT (2). */
  setupWipLimit?: number
}

export interface EvolutionConfig {
  /** Base da API (ex.: https://evo.controlemaisia.com.br). */
  baseUrl?: string
  /** apiKey — só vai pro backend; no front vem vazia. */
  apiKey?: string
  /** Indica que há apiKey salva (preenchido pelo GET). */
  apiKeySet?: boolean
}

export interface UazapiServer {
  /** Base da API (ex.: https://nxdigital.uazapi.com). */
  url: string
  /** admintoken — só vai pro backend; no front vem vazio. */
  token?: string
  /** Indica que há token salvo (preenchido pelo GET). */
  tokenSet?: boolean
}

export interface SupportGroupConfig {
  /** Base da API (default https://appapi.nxsystems.com.br). */
  baseUrl?: string
  /** ApiID que vai na URL /v2/api/external/{apiId}/group. */
  apiId?: string
  /** Token Bearer — só vai pro backend; no front vem vazio. */
  token?: string
  /** ID/number do grupo de WhatsApp. */
  groupId?: string
  /** Indica que há token salvo (preenchido pelo GET). */
  tokenSet?: boolean
  /** Hora (0–23, fuso São Paulo) do envio automático do resumo. Default 7. */
  digestHour?: number
  /** Liga/desliga o envio automático diário. Default ligado. */
  digestEnabled?: boolean
}

export interface StageHistoryEntry {
  id: string
  clientId: string
  fromStage: PipelineStage | null
  toStage: PipelineStage
  at: string
}

export interface AuditEntry {
  id: string
  actorId?: string
  actorEmail?: string
  actorName?: string
  entityType: string
  entityId?: string
  action: string
  summary?: string
  changes?: Record<string, unknown>
  at: string
}
