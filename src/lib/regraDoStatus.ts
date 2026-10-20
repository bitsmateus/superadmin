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
  { valor: 'bio', rotulo: 'Link na bio do Instagram' },
  { valor: 'site', rotulo: 'Site' },
  { valor: 'indicacao', rotulo: 'Indicação' },
  { valor: 'outros', rotulo: 'Outros' },
]

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

/** Motivo preenchido de verdade: um da lista E o detalhe escrito (mínimo 10 letras). */
export function motivoValido(valor: string | null | undefined): boolean {
  const { motivo, detalhe } = separarMotivo(valor)
  return (MOTIVOS_DESQUALIFICACAO as readonly string[]).includes(motivo) && detalhe.length >= MINIMO_DETALHE_MOTIVO
}

function normaliza(s: string): string {
  return (s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '')
}

export function abaComRegraDeStatus(nomeDaAba: string, idDaAba = ''): boolean {
  return /(arthur|lu[ií]s)/i.test(nomeDaAba) || /(arthur|luis)/i.test(idDaAba)
}


export function mesmoStatus(a: string, b: string): boolean {
  return normaliza(a) === normaliza(b)
}

/** Data E horário preenchidos (formato salvo: AAAA-MM-DDTHH:MM). */
export function temDataEHora(valor: string | null | undefined): boolean {
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(valor ?? '')
}

/** Campos que o popup sabe pedir. */
export type CampoDoPopup = 'agendamento' | 'agendadoPor' | 'retornar' | 'origem' | 'valorMrr' | 'valorImplementacao' | 'motivoDesqualificacao'

/** Por onde a reunião foi agendada (campo "Agendado por" da ficha). */
export const CANAIS_DE_AGENDAMENTO = ['WhatsApp Business SDR', 'WhatsApp Comercial', 'Ligação', 'Social Selling', 'Outbound'] as const

/** O campo está preenchido do jeito que a regra pede? (Valor em R$: precisa ter sido digitado — R$ 0,00 conta.) */
export function campoOk(campo: CampoDoPopup, valor: string | null | undefined): boolean {
  const v = (valor ?? '').trim()
  if (campo === 'agendamento' || campo === 'retornar') return temDataEHora(v)
  if (campo === 'motivoDesqualificacao') return motivoValido(v)
  if (campo === 'valorMrr' || campo === 'valorImplementacao') return /\d/.test(v)
  if (campo === 'origem') return origemValida(v)
  return !!v
}

/**
 * O que cada status exige nos CRMs do Arthur e do Luis. "sempre": é perguntado toda vez que o lead entra no status
 * (vem preenchido se já houver). "seFaltar": só é perguntado se estiver vazio.
 */
export function exigenciasDoStatus(statusOuQuadro: string): { sempre: CampoDoPopup[]; seFaltar: CampoDoPopup[] } | null {
  const n = normaliza(statusOuQuadro)
  if (n.includes('reuniaoagendada')) return { sempre: ['agendamento', 'agendadoPor'], seFaltar: ['origem'] }
  if (n.includes('propostaenviada')) return { sempre: ['retornar'], seFaltar: ['valorMrr', 'valorImplementacao'] }
  if (n.startsWith('vendido')) return { sempre: [], seFaltar: ['valorMrr', 'valorImplementacao', 'origem'] }
  return null
}
