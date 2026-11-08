import { textoDeVerdade } from '@/lib/textoDeVerdade'

/**
 * Regra dos CRMs do Arthur e do Luis (inclui o Closer): pra MUDAR o lead pra "Reunião agendada" é obrigatório ter
 * data e horário do agendamento, e pra "Proposta enviada" é obrigatório ter data e horário em "Retornar". O
 * servidor aplica a mesma regra (ver faltaDadoDoStatus em server/src/routes/leadBoards.ts).
 */
/** Mesma lista do servidor (server/src/lib/trafegoNicho.ts, MOTIVOS_DESQUALIFICACAO). */
export const MOTIVOS_DESQUALIFICACAO = [
  'Fora do perfil',
  'Segmento errado',
  'Sem orçamento',
  'Sem interesse',
  'Telefone inválido',
  'Fechou com outro',
  'Não é o momento',
  'Outros',
] as const

/** Todo motivo vai com um detalhe escrito, salvo como "<Motivo>: <detalhe>". */
export const MINIMO_DETALHE_MOTIVO = 10
/** Mínimo de letras da origem "Outros". */
export const MINIMO_OUTRO = 5

/** Separa o que está salvo em motivo + detalhe. Aceita o formato antigo ("Outro: …" ou só o motivo). */
export function separarMotivo(valor: string | null | undefined): { motivo: string; detalhe: string } {
  const v = (valor ?? '').trim()
  if (!v) return { motivo: '', detalhe: '' }
  const i = v.indexOf(':')
  const motivo = (i >= 0 ? v.slice(0, i) : v).trim()
  const detalhe = i >= 0 ? v.slice(i + 1).trim() : ''
  return { motivo: motivo === 'Outro' ? 'Outros' : motivo, detalhe }
}
export function juntarMotivo(motivo: string, detalhe: string): string {
  return motivo ? `${motivo}: ${detalhe.trim()}` : ''
}

/** A partir de quando o motivo é cobrado: leads que entraram de 01/10/2026 (horário de Brasília) em diante — do
 * anúncio ou cadastrados à mão. Os mais antigos não são cobrados. */
export const INICIO_DA_REGRA_DO_MOTIVO = '2026-10-01T03:00:00.000Z'
export function leadCobraMotivo(criadoEm: string | null | undefined): boolean {
  const t = new Date(criadoEm ?? '').getTime()
  return Number.isFinite(t) && t >= new Date(INICIO_DA_REGRA_DO_MOTIVO).getTime()
}

/** De onde o lead veio. "meta" também vale sozinho pra quem chegou pelo anúncio (tem campanha/anúncio ligado). */
export const ORIGENS_DO_LEAD: { valor: string; rotulo: string }[] = [
  { valor: 'meta', rotulo: 'Anúncio (Meta)' },
  { valor: 'social_selling', rotulo: 'Social Selling' },
  { valor: 'bio', rotulo: 'Link na bio do Instagram' },
  { valor: 'site', rotulo: 'Site' },
  { valor: 'indicacao', rotulo: 'Indicação' },
  { valor: 'outros', rotulo: 'Outros' },
]

/** Rótulo amigável de cada origem — as da tela e as que a automação da Luiza manda (mesmos do servidor, em
 * server/src/lib/integracaoCards.ts). Origens com o mesmo rótulo contam juntas no filtro. */
export const ROTULOS_ORIGEM: Record<string, string> = {
  meta: 'Anúncio Meta', anuncio_meta: 'Anúncio Meta', social_selling: 'Social Selling',
  bio: 'Link da bio', bio_instagram: 'Link da bio',
  site: 'Site', lp_teste: 'Link da bio',
  formulario_organizar: 'Formulário do site', formulario_falar: 'Formulário do site',
  formulario_profissionalizar: 'Formulário do site', formulario_suporte: 'Formulário do site',
  indicacao: 'Indicação', indique_ganhe: 'Indique e ganhe',
  disparo_em_massa: 'Disparo em massa', whatsapp_direto: 'WhatsApp direto',
}
/** "Formulário do site (organizar)" etc.: o rótulo com o detalhe que o código traz. */
export function rotuloDaOrigem(valor: string | null | undefined): string {
  const v = (valor ?? '').trim()
  if (!v) return ''
  if (origemEhOutros(v)) return textoDaOrigemOutros(v) ? `Outros (${textoDaOrigemOutros(v)})` : 'Outros'
  const base = ROTULOS_ORIGEM[v.toLowerCase()]
  if (!base) return v
  const form = v.match(/^formulario_(.+)$/i)
  return form ? `${base} (${form[1].replace(/_/g, ' ')})` : base
}
/** Grupo da origem no filtro (sem o detalhe): todos os formulários juntos, "Outros" junto. */
export function grupoDaOrigem(valor: string | null | undefined): string {
  const v = (valor ?? '').trim()
  if (!v) return ''
  if (origemEhOutros(v)) return 'Outros'
  return ROTULOS_ORIGEM[v.toLowerCase()] ?? v
}
/** Selo de origem no card: todas menos "meta", que é o anúncio padrão (milhares de leads; a ficha já mostra o anúncio). */
export function origemMostraSelo(valor: string | null | undefined): boolean {
  const v = (valor ?? '').trim().toLowerCase()
  return !!v && v !== 'meta'
}

/** Origem "Outros" é salva junto com o que foi escrito: "outros: <de onde veio>". */
export const PREFIXO_ORIGEM_OUTROS = 'outros: '
export function origemEhOutros(valor: string | null | undefined): boolean {
  return (valor ?? '').trim().toLowerCase().startsWith('outros')
}
export function textoDaOrigemOutros(valor: string | null | undefined): string {
  return (valor ?? '').trim().replace(/^outros:?/i, '').trim()
}
/** Origem preenchida de verdade: uma da lista, ou "Outros" com pelo menos 5 letras escritas. */
export function origemValida(valor: string | null | undefined): boolean {
  const v = (valor ?? '').trim()
  if (!v) return false
  return origemEhOutros(v) ? textoDaOrigemOutros(v).length >= MINIMO_OUTRO : true
}

/** Status que fecham o lead sem venda: Disparo em massa, Perdidos, Desqualificado. */
export function statusExigeMotivo(statusOuQuadro: string): boolean {
  const n = normaliza(statusOuQuadro)
  return n.includes('disparoemmassa') || n.includes('perdido') || n.includes('desqualificad')
}

/** Motivo preenchido de verdade: um da lista E o detalhe escrito com palavras (mínimo 10 letras, ver textoDeVerdade). */
export function motivoValido(valor: string | null | undefined): boolean {
  const { motivo, detalhe } = separarMotivo(valor)
  return (MOTIVOS_DESQUALIFICACAO as readonly string[]).includes(motivo) && textoDeVerdade(detalhe, MINIMO_DETALHE_MOTIVO)
}

function normaliza(s: string): string {
  return (s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '')
}

export function abaComRegraDeStatus(nomeDaAba: string, idDaAba = ''): boolean {
  return /(arthur|lu[ií]s|luiza)/i.test(nomeDaAba) || /(arthur|luis|luiza)/i.test(idDaAba)
}


/** A IA Luiza é SDR das leads que ela agendou — inclusive das que ficam no CRM de outro SDR. */
export const SDR_IA = 'IA Luiza'
export function ehSdrDaIa(sdr: string | null | undefined): boolean {
  return /luiza/i.test(sdr ?? '')
}
/** Marcando "Reunião agendada" no CRM de um SDR (fora o da própria IA e o do closer), o popup pergunta se foi a IA
 * Luiza que agendou: aí a lead conta pra ela, não pro SDR, e ganha uma cópia no CRM IA LUIZA. */
export function ofereceAgendadoPelaIa(statusNovo: string, nomeDaAba: string, idDaAba = ''): boolean {
  const aba = `${nomeDaAba} ${idDaAba}`
  return normaliza(statusNovo).includes('reuniaoagendada') && !/luiza/i.test(aba) && !/closer/i.test(aba)
}

/**
 * O quadro da aba que corresponde a um status: mesmo nome ignorando acento, traço e maiúscula ("Follow-up Propostas" =
 * "Follow up Propostas") ou, sem isso, o quadro cujo nome começa com o status ("Follow-up Propostas" →
 * "FOLLOW UP PROPOSTAS (APÓS 3 TENTATIVAS)"). Mesma regra do servidor (quadroDoStatus em leadBoards.ts).
 */
export function quadroDoStatus<T extends { name: string; page: string }>(quadros: T[], page: string, status: string): T | undefined {
  const alvo = normaliza(status)
  if (!alvo) return undefined
  const daAba = quadros.filter((b) => b.page === page)
  return daAba.find((b) => normaliza(b.name) === alvo) ?? daAba.find((b) => normaliza(b.name).startsWith(alvo))
}

export function mesmoStatus(a: string, b: string): boolean {
  return normaliza(a) === normaliza(b)
}

/** A coluna "Disparo em massa" (em qualquer CRM) ordena pela entrada na coluna, não pela criação do card. */
export function ehColunaDeDisparo(nome: string): boolean {
  return mesmoStatus(nome, 'Disparo em massa')
}

/**
 * Ordem do "Disparo em massa": quem entrou na coluna há mais tempo em cima, quem acabou de entrar no fim. Card sem
 * entrouColunaEm (os antigos, de antes do campo) vem antes de todos, pela data de criação. Sair e voltar pra coluna
 * grava uma entrada nova, então o card volta pro fim.
 */
export function compararPorEntradaNaColuna(
  a: { entrouColunaEm: string | null; createdAt: string }, b: { entrouColunaEm: string | null; createdAt: string },
): number {
  if (!a.entrouColunaEm !== !b.entrouColunaEm) return a.entrouColunaEm ? 1 : -1
  // Como data, não como texto: a carga da tela traz "…Z" e o tempo real traz com o fuso ("…-03:00").
  return (instante(a.entrouColunaEm) - instante(b.entrouColunaEm)) || (instante(a.createdAt) - instante(b.createdAt))
}

function instante(iso: string | null): number {
  const n = iso ? Date.parse(iso) : NaN
  return Number.isNaN(n) ? 0 : n
}

/** Data E horário preenchidos (formato salvo: AAAA-MM-DDTHH:MM). */
export function temDataEHora(valor: string | null | undefined): boolean {
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(valor ?? '')
}

/** Campos que o popup sabe pedir. */
export type CampoDoPopup = 'agendamento' | 'agendadoPor' | 'retornar' | 'origem' | 'valorMrr' | 'valorImplementacao' | 'motivoDesqualificacao'

/** Por onde a reunião foi agendada (campo "Agendado por" da ficha). */
export const CANAIS_DE_AGENDAMENTO = ['WhatsApp Business SDR', 'WhatsApp Comercial', 'Ligação', 'Social Selling', 'Outbound', 'Outro'] as const
/** "Outro" é salvo com o que foi escrito: "Outro: <por onde>". */
export const PREFIXO_AGENDADO_OUTRO = 'Outro: '
export function agendadoEhOutro(valor: string | null | undefined): boolean {
  return /^outro\b/i.test((valor ?? '').trim())
}
export function textoDoAgendadoOutro(valor: string | null | undefined): string {
  return (valor ?? '').trim().replace(/^outro:?/i, '').trim()
}

/** O campo está preenchido do jeito que a regra pede? (Valor em R$: precisa ter sido digitado — R$ 0,00 conta.) */
export function campoOk(campo: CampoDoPopup, valor: string | null | undefined): boolean {
  const v = (valor ?? '').trim()
  if (campo === 'agendamento' || campo === 'retornar') return temDataEHora(v)
  if (campo === 'motivoDesqualificacao') return motivoValido(v)
  if (campo === 'valorMrr' || campo === 'valorImplementacao') return /\d/.test(v)
  if (campo === 'origem') return origemValida(v)
  if (campo === 'agendadoPor') return !!v && (!agendadoEhOutro(v) || textoDoAgendadoOutro(v).length >= MINIMO_OUTRO)
  return !!v
}

/**
 * O que cada status exige nos CRMs do Arthur e do Luis. "sempre": é perguntado toda vez que o lead entra no status
 * (vem preenchido se já houver). "seFaltar": só é perguntado se estiver vazio.
 */
export function exigenciasDoStatus(statusOuQuadro: string): { sempre: CampoDoPopup[]; seFaltar: CampoDoPopup[] } | null {
  const n = normaliza(statusOuQuadro)
  if (n.includes('reuniaoagendada')) return { sempre: ['agendamento', 'agendadoPor'], seFaltar: ['origem'] }
  if (n.includes('propostaenviada')) return { sempre: [], seFaltar: ['retornar', 'valorMrr', 'valorImplementacao'] }
  if (n.startsWith('vendido')) return { sempre: [], seFaltar: ['valorMrr', 'valorImplementacao', 'origem'] }
  return null
}
