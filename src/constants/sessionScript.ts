import type { BriefingConfig, BriefingData, ChecklistItem, Client } from '@/types/client'

/**
 * Roteiro da sessão de configuração.
 *
 * A ideia é parar de fazer tudo ao vivo no AnyDesk. O trabalho se divide em:
 *
 *  • ANTES (assíncrono, sem o cliente) — tenant, usuários, filas, chatbot, IA.
 *    É a maior parte e não precisa de ninguém do outro lado.
 *  • NA SESSÃO (com o cliente) — só o que exige a mão dele: leitura de QR
 *    code, aprovações na Meta, login das redes sociais e o treinamento.
 *
 * Ordem importa: quando há API Oficial, ela vem ANTES de chatbot e IA — sem o
 * número aprovado na Meta não há canal para conectar a automação.
 */

export type SessionPhase = 'api' | 'canais' | 'automacao' | 'treinamento' | 'entrega'

export const SESSION_PHASE_LABELS: Record<SessionPhase, string> = {
  api: '1. API Oficial (Meta)',
  canais: '2. Canais',
  automacao: '3. Chatbot e IA',
  treinamento: '4. Treinamento',
  entrega: '5. Entrega',
}

export interface SessionStep {
  id: string
  label: string
  phase: SessionPhase
  /** Contexto pro time — por que o passo existe / o que observar. */
  detail?: string
  /** Texto pronto para falar/pedir ao cliente durante a sessão. */
  say?: string
}

/** Passos que o time faz sozinho antes de chamar o cliente. */
export interface PreSessionStep {
  id: string
  label: string
  detail?: string
}

function hasIa(cfg: BriefingConfig | null): boolean {
  return Boolean(cfg?.automationTypes.some((t) => t === 'ia_basica' || t === 'ia_avancada'))
}

/**
 * O que deve estar pronto ANTES da reunião. Deriva da config contratada e
 * espelha os itens do checklist de entrega — é a lista que responde
 * "posso chamar o cliente?".
 */
export function buildPreSessionSteps(
  cfg: BriefingConfig | null,
  briefing: BriefingData | null,
): PreSessionStep[] {
  const steps: PreSessionStep[] = [
    { id: 'tenant_created', label: 'Tenant criado no sistema' },
    { id: 'users_created', label: 'Usuários criados' },
    { id: 'queues_created', label: 'Filas criadas' },
  ]

  if (cfg?.connectionTypes.includes('api_oficial')) {
    steps.push({
      id: 'api_oficial',
      label: 'API Oficial iniciada na Meta',
      detail:
        'Número cadastrado, display name submetido e partner access recebido. Sem isso, não adianta marcar a sessão.',
    })
  }

  const phones = briefing?.whatsappNumbers ?? []
  steps.push({
    id: 'channels_created',
    label:
      phones.length > 0
        ? `Canais criados (${phones.length} número${phones.length === 1 ? '' : 's'})`
        : 'Canais criados',
  })

  if (!cfg || cfg.automationTypes.includes('chatbot')) {
    steps.push({
      id: 'chatbot_configured',
      label: 'ChatBot configurado (saudação, condições, gerais)',
      detail: 'Depende do canal existir — em API Oficial, só depois do número aprovado.',
    })
  }
  if (hasIa(cfg)) {
    steps.push({
      id: 'ia_configured',
      label: 'IA configurada (prompt + base de conhecimento)',
      detail: 'Testar em conversa simulada antes de mostrar ao cliente.',
    })
  }

  steps.push(
    { id: 'schedule_configured', label: 'Horário de atendimento configurado' },
    { id: 'users_assigned', label: 'Filas e canais atribuídos aos usuários' },
    { id: 'general_settings', label: 'Configurações gerais revisadas' },
  )
  return steps
}

/**
 * Roteiro da reunião — só o que exige o cliente presente, na ordem em que
 * deve acontecer.
 */
export function buildSessionSteps(
  cfg: BriefingConfig | null,
  briefing: BriefingData | null,
): SessionStep[] {
  const steps: SessionStep[] = []
  const isOfficial = Boolean(cfg?.connectionTypes.includes('api_oficial'))

  // ── 1. API Oficial — sempre primeiro quando existe ────────────────────────
  if (isOfficial) {
    steps.push({
      id: 'api_partner_access',
      label: 'Confirmar partner access concedido',
      phase: 'api',
      detail: 'Sem o acesso de parceiro não conseguimos administrar o número.',
      say: 'Preciso que você entre no Gerenciador de Negócios da Meta → Configurações do Negócio → Parceiros → Adicionar parceiro, e cole o ID que enviamos. Pode compartilhar a tela?',
    })
    steps.push({
      id: 'api_verificacao',
      label: 'Verificação do negócio concluída',
      phase: 'api',
      detail:
        'Se ainda estiver em análise, a sessão continua, mas o envio ativo fica limitado.',
      say: 'Vamos conferir a verificação do seu negócio na Central de Segurança. Se estiver pendente, te mostro os documentos que a Meta pede.',
    })
    steps.push({
      id: 'api_numero_codigo',
      label: 'Número cadastrado e código de verificação recebido',
      phase: 'api',
      detail:
        'O número precisa estar SEM WhatsApp ativo. Se estiver, apagar a conta antes — leva alguns minutos.',
      say: 'Vou disparar o código de verificação para o número dedicado. Você tem acesso a ele agora para me passar o código?',
    })
    steps.push({
      id: 'api_display_name',
      label: 'Display name aprovado',
      phase: 'api',
      detail: 'Se a Meta recusar, alinhar um nome alternativo com o cliente na hora.',
      say: 'O nome que vai aparecer para os seus clientes é o que combinamos. Se a Meta recusar, escolhemos outro juntos agora.',
    })
  }

  // ── 2. Canais ─────────────────────────────────────────────────────────────
  const phones = briefing?.whatsappNumbers ?? []
  if (!isOfficial) {
    if (phones.length > 0) {
      phones.forEach((phone, i) => {
        steps.push({
          id: `qrcode_${i}`,
          label: `Conectar WhatsApp ${i + 1}${phone ? ` (${phone})` : ''}`,
          phase: 'canais',
          detail: 'Precisa do celular em mãos — a leitura expira rápido.',
          say: `Abra o WhatsApp do número ${phone || 'que vamos conectar'} → Aparelhos conectados → Conectar aparelho, e aponte para o QR code que vou mostrar na tela.`,
        })
      })
    } else {
      steps.push({
        id: 'qrcode_0',
        label: 'Conectar WhatsApp (QR code)',
        phase: 'canais',
        say: 'Abra o WhatsApp → Aparelhos conectados → Conectar aparelho e leia o QR code da tela.',
      })
    }
  }

  for (const key of ['instagram', 'messenger'] as const) {
    if (!cfg?.channels.includes(key)) continue
    const label = key === 'instagram' ? 'Instagram' : 'Facebook / Messenger'
    steps.push({
      id: `channel_${key}`,
      label: `Conectar ${label}`,
      phase: 'canais',
      detail: 'Login feito pelo cliente na hora — evita guardar senha.',
      say: `Vamos conectar o ${label}. Você faz o login na sua conta e aprova a permissão que vai aparecer — não precisa nos passar a senha.`,
    })
  }

  // ── 3. Chatbot e IA — depois do canal existir ─────────────────────────────
  if (!cfg || cfg.automationTypes.includes('chatbot')) {
    steps.push({
      id: 'chatbot_review',
      label: 'Validar chatbot com o cliente',
      phase: 'automacao',
      detail: 'Mostrar saudação, menu e transferências. Ajustes de texto são rápidos.',
      say: 'Vou te mostrar como ficou o atendimento automático. Me diga se a saudação e as opções do menu estão do jeito que você quer.',
    })
  }
  if (hasIa(cfg)) {
    steps.push({
      id: 'ia_demo',
      label: 'Demonstrar a IA em conversa real',
      phase: 'automacao',
      detail: 'Fazer 2–3 perguntas típicas do negócio. Anotar o que a IA errou.',
      say: 'Manda uma pergunta que seus clientes costumam fazer — quero te mostrar como a IA responde e ajustar junto com você.',
    })
  }

  // ── 4. Treinamento ────────────────────────────────────────────────────────
  steps.push(
    {
      id: 'training_login',
      label: 'Cliente logando no sistema',
      phase: 'treinamento',
      say: 'Vou te enviar seu acesso agora. Faça o login comigo na linha para garantir que está tudo certo.',
    },
    {
      id: 'training_flow',
      label: 'Atendimento de ponta a ponta (receber, responder, transferir, finalizar)',
      phase: 'treinamento',
      detail: 'Fazer um atendimento de teste real, com o cliente operando.',
      say: 'Vamos simular um atendimento: eu mando uma mensagem e você responde, transfere para um setor e finaliza.',
    },
    {
      id: 'training_team',
      label: 'Equipe do cliente treinada',
      phase: 'treinamento',
      detail: 'Confirmar que quem vai atender no dia a dia participou.',
    },
  )

  // ── 5. Entrega ────────────────────────────────────────────────────────────
  steps.push(
    {
      id: 'handoff_access',
      label: 'Acessos entregues',
      phase: 'entrega',
      say: 'Estou te enviando o documento com todos os acessos e o número do suporte.',
    },
    {
      id: 'handoff_support',
      label: 'Canal de suporte apresentado',
      phase: 'entrega',
      say: 'Qualquer dúvida depois daqui, fale com a gente nesse número — respondemos em horário comercial.',
    },
    {
      id: 'handoff_pending',
      label: 'Pendências da sessão anotadas',
      phase: 'entrega',
      detail: 'O que ficou para depois (ajuste de prompt, canal extra) vira nota no cliente.',
    },
  )

  return steps
}

/** Converte o roteiro em itens de checklist, preservando o que já foi marcado. */
export function buildSessionChecklist(
  current: ChecklistItem[] | undefined,
  cfg: BriefingConfig | null,
  briefing: BriefingData | null,
): ChecklistItem[] {
  const existing = new Map((current ?? []).map((i) => [i.id, i]))
  return buildSessionSteps(cfg, briefing).map((step) => {
    const prev = existing.get(step.id)
    return {
      id: step.id,
      label: step.label,
      checked: prev?.checked ?? false,
      checkedAt: prev?.checkedAt,
      checkedBy: prev?.checkedBy,
    }
  })
}

/**
 * Convite da sessão — o que o cliente precisa ter em mãos. Enviado antes da
 * reunião para não descobrir na hora que falta o celular ou o acesso à Meta.
 */
export function buildSessionInvite(
  client: Pick<Client, 'name' | 'company' | 'briefingConfig' | 'briefingData'>,
  when?: string | null,
): string {
  const first = (client.name || '').trim().split(/\s+/)[0] || 'tudo bem'
  const cfg = client.briefingConfig ?? null
  const isOfficial = Boolean(cfg?.connectionTypes.includes('api_oficial'))

  const needs: string[] = []
  if (isOfficial) {
    needs.push('Acesso ao Gerenciador de Negócios da Meta (business.facebook.com)')
    needs.push('O número dedicado da API em mãos, para receber o código de verificação')
  } else {
    needs.push('O celular com o WhatsApp que será conectado (vamos ler um QR code)')
  }
  if (cfg?.channels.includes('instagram')) {
    needs.push('Login do Instagram da empresa')
  }
  if (cfg?.channels.includes('messenger')) {
    needs.push('Login do Facebook da empresa')
  }
  needs.push('De preferência, a equipe que vai atender no dia a dia junto')

  const dateLine = when
    ? `Nossa reunião de ativação está marcada para ${new Date(when).toLocaleString('pt-BR', {
        dateStyle: 'short',
        timeStyle: 'short',
      })}.`
    : 'Vamos marcar a reunião de ativação.'

  return [
    `Olá, ${first}! Tudo bem?`,
    '',
    dateLine,
    '',
    'Para a sessão render, tenha em mãos:',
    '',
    needs.map((n, i) => `${i + 1}. ${n}`).join('\n'),
    '',
    'A configuração do sistema já estará pronta — na reunião fazemos as conexões, os testes e o treinamento da equipe. Deve levar cerca de 1 hora.',
  ].join('\n')
}
