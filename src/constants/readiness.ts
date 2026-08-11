import type { BriefingChannel, Client } from '@/types/client'

/**
 * Prontidão para configurar.
 *
 * Cruza o que o cliente CONTRATOU (briefingConfig) com o que ele RESPONDEU
 * (briefingData) e devolve o que ainda falta. Serve pra duas coisas:
 *
 * 1. Separar, na fila de configuração, quem está pronto de quem está
 *    bloqueado aguardando o cliente — em vez de descobrir que falta número
 *    só com o AnyDesk aberto.
 * 2. Montar a mensagem de cobrança já com a lista exata do que pedir.
 *
 * `blocker` impede começar a configuração. `warning` não impede, mas o time
 * precisa saber (ex.: pagamento vencido).
 */

export type ReadinessSeverity = 'blocker' | 'warning'

export interface ReadinessItem {
  id: string
  /** Rótulo curto, pro time (aparece no pipeline e no drawer). */
  label: string
  /** Texto que vai pro cliente na mensagem de cobrança. */
  ask: string
  severity: ReadinessSeverity
}

/**
 * Só o que a conta de prontidão precisa. Um `Client` completo satisfaz isso —
 * e o portal público, que recebe apenas parte do registro, também.
 */
export type ReadinessInput = Pick<
  Client,
  'briefingConfig' | 'briefingData' | 'briefingStatus' | 'contractSignedAt' | 'paymentStatus'
>

export interface Readiness {
  items: ReadinessItem[]
  blockers: ReadinessItem[]
  warnings: ReadinessItem[]
  /** true quando não há nenhum bloqueio — pode entrar na fila. */
  ready: boolean
}

const CREDENTIAL_CHANNELS: { key: BriefingChannel; label: string }[] = [
  { key: 'instagram', label: 'Instagram' },
  { key: 'messenger', label: 'Facebook / Messenger' },
  { key: 'olx', label: 'OLX' },
  { key: 'mercadolivre', label: 'Mercado Livre' },
]

/** Alguma resposta de IA foi preenchida? (mesma regra do viewer do briefing) */
function hasAiAnswers(c: ReadinessInput): boolean {
  const d = c.briefingData
  if (!d) return false
  return Boolean(
    d.aiCompanyDescription ||
      d.aiServices ||
      d.aiAttendanceFlow ||
      d.aiAgentName ||
      d.aiTransferConditions ||
      d.aiRestrictions,
  )
}

export function computeReadiness(c: ReadinessInput): Readiness {
  const items: ReadinessItem[] = []
  const cfg = c.briefingConfig ?? null
  const bd = c.briefingData ?? null

  const add = (
    id: string,
    label: string,
    ask: string,
    severity: ReadinessSeverity = 'blocker',
  ) => {
    items.push({ id, label, ask, severity })
  }

  // ── Briefing ──────────────────────────────────────────────────────────────
  if (!bd) {
    add(
      'briefing_missing',
      'Briefing não preenchido',
      'Preencher o briefing no link que enviamos.',
    )
  } else if (c.briefingStatus === 'sent' || c.briefingStatus === 'revision') {
    add(
      'briefing_pending',
      'Briefing aguardando o cliente',
      'Finalizar o preenchimento do briefing no link que enviamos.',
    )
  }

  // ── Número de WhatsApp ────────────────────────────────────────────────────
  const numbers = bd?.whatsappNumbers ?? []
  if (numbers.length === 0) {
    add(
      'whatsapp_number',
      'Sem número de WhatsApp',
      'Informar o(s) número(s) de WhatsApp que serão conectados ao sistema (com DDD).',
    )
  }

  // ── Site ──────────────────────────────────────────────────────────────────
  // Só cobramos de quem o briefing perguntou: API Oficial (a Meta exige site
  // na verificação) e IA (o site alimenta a base de conhecimento). No briefing
  // o campo é opcional de propósito — a cobrança acontece aqui.
  const needsSite =
    Boolean(cfg?.connectionTypes.includes('api_oficial')) ||
    Boolean(cfg?.automationTypes.some((t) => t === 'ia_basica' || t === 'ia_avancada'))
  if (needsSite && !bd?.site?.trim()) {
    add(
      'site',
      'Sem site informado',
      'Informar o site da empresa — se não tiver, é só marcar a opção "não temos site".',
    )
  }

  // ── Usuários ──────────────────────────────────────────────────────────────
  if ((bd?.users ?? []).length === 0) {
    add(
      'users_missing',
      'Sem usuários cadastrados',
      'Informar nome, e-mail e setor de cada pessoa que vai usar o sistema.',
    )
  }

  // ── API Oficial (Meta) ────────────────────────────────────────────────────
  if (cfg?.connectionTypes.includes('api_oficial')) {
    const oa = bd?.officialApi
    if (!oa?.numeroDedicado) {
      add(
        'api_numero_dedicado',
        'API Oficial: sem número dedicado',
        'Informar o número exclusivo para a API Oficial — precisa estar sem WhatsApp/WhatsApp Business ativo.',
      )
    }
    if (!oa?.displayNamePretendido) {
      add(
        'api_display_name',
        'API Oficial: sem display name',
        'Informar o nome que aparecerá para os clientes no WhatsApp (display name).',
      )
    }
    if (oa?.verificacaoNegocioStatus !== 'aprovada') {
      add(
        'api_verificacao',
        'API Oficial: negócio não verificado',
        'Concluir a verificação do negócio no Gerenciador de Negócios da Meta (Business Manager).',
      )
    }
    if (oa?.partnerAccessStatus !== 'concedido') {
      add(
        'api_partner_access',
        'API Oficial: partner access pendente',
        'Conceder o acesso de parceiro (partner access) do seu Portfólio Empresarial para a nossa equipe.',
      )
    }
  }

  // ── Canais que exigem login/senha ─────────────────────────────────────────
  for (const { key, label } of CREDENTIAL_CHANNELS) {
    if (!cfg?.channels.includes(key)) continue
    const acc = bd?.channelAccess?.[key]
    const hasLegacyFacebook =
      key === 'messenger' && Boolean(bd?.facebookEmail && bd?.facebookPassword)
    if (!hasLegacyFacebook && !(acc?.email && acc?.password)) {
      add(
        `channel_${key}`,
        `${label}: sem acesso`,
        `Enviar o login e a senha do ${label} para conectarmos o canal.`,
      )
    }
  }

  // ── IA ────────────────────────────────────────────────────────────────────
  const hasIa = cfg?.automationTypes.some((t) => t === 'ia_basica' || t === 'ia_avancada')
  if (hasIa && !hasAiAnswers(c)) {
    add(
      'ia_answers',
      'IA: respostas não preenchidas',
      'Preencher a etapa de IA do briefing (o que a empresa faz, serviços e como a IA deve atender).',
    )
  }
  if (cfg?.automationTypes.includes('ia_avancada') && !bd?.aiExternalWhatToQuery) {
    add(
      'ia_integration',
      'IA Avançada: integração não descrita',
      'Descrever o que a IA precisa consultar no sistema de vocês e como acessar a API.',
    )
  }

  // ── Automação externa ─────────────────────────────────────────────────────
  if (cfg?.hasExternalAutomation && !bd?.externalAutomationInfo) {
    add(
      'external_automation',
      'Automação externa sem informações',
      'Enviar os dados necessários para a automação externa (integrações, credenciais).',
    )
  }

  // ── Avisos (não bloqueiam) ────────────────────────────────────────────────
  if (!c.contractSignedAt) {
    add(
      'contract_unsigned',
      'Contrato sem assinatura registrada',
      'Assinar o contrato enviado.',
      'warning',
    )
  }
  if (c.paymentStatus === 'overdue') {
    add(
      'payment_overdue',
      'Pagamento vencido',
      'Regularizar o pagamento em aberto.',
      'warning',
    )
  }

  const blockers = items.filter((i) => i.severity === 'blocker')
  const warnings = items.filter((i) => i.severity === 'warning')
  return { items, blockers, warnings, ready: blockers.length === 0 }
}

/**
 * Mensagem de cobrança pronta pro WhatsApp, listando só o que falta.
 * O time revisa e edita antes de enviar.
 */
export function buildPendingMessage(
  client: Pick<Client, 'name' | 'company'>,
  items: ReadinessItem[],
  pendingLink?: string | null,
): string {
  const first = (client.name || '').trim().split(/\s+/)[0] || 'tudo bem'
  const lines = items.map((it, i) => `${i + 1}. ${it.ask}`)
  const parts = [
    `Olá, ${first}! Tudo bem?`,
    '',
    `Estamos preparando a configuração da ${client.company || 'sua empresa'} e ainda faltam alguns pontos para começarmos:`,
    '',
    lines.join('\n'),
    '',
  ]
  if (pendingLink) {
    parts.push(
      'Você pode enviar tudo por aqui, em poucos minutos:',
      pendingLink,
      '',
    )
  }
  parts.push(
    'Assim que recebermos, entramos na fila de configuração e agendamos a ativação. 🙌',
  )
  return parts.join('\n')
}
