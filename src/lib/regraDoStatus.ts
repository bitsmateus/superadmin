/**
 * Regra dos CRMs do Arthur e do Luis (inclui o Closer): pra MUDAR o lead pra "Reunião agendada" é obrigatório ter
 * data e horário do agendamento, e pra "Proposta enviada" é obrigatório ter data e horário em "Retornar". O
 * servidor aplica a mesma regra (ver faltaDadoDoStatus em server/src/routes/leadBoards.ts).
 */
export type CampoExigido = 'agendamento' | 'retornar' | 'motivoDesqualificacao'

/** Mesma lista do servidor (server/src/lib/trafegoNicho.ts, MOTIVOS_DESQUALIFICACAO). */
export const MOTIVOS_DESQUALIFICACAO = [
  'Fora do perfil / segmento errado',
  'Sem orçamento',
  'Só curioso / sem interesse',
  'Já tem solução',
  'Não atende / telefone inválido',
  'Concorrente / fornecedor',
  'Outro',
] as const

/** "Outro" é salvo junto com o que foi escrito: "Outro: <motivo>". */
export const PREFIXO_OUTRO = 'Outro: '
export const MINIMO_OUTRO = 5

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

/** Status que fecham o lead sem venda: Disparo em massa, Perdidos, Desqualificado. */
export function statusExigeMotivo(statusOuQuadro: string): boolean {
  const n = normaliza(statusOuQuadro)
  return n.includes('disparoemmassa') || n.includes('perdido') || n.includes('desqualificad')
}

/** Motivo preenchido de verdade: um da lista, ou "Outro: " com pelo menos 5 letras escritas. */
export function motivoValido(valor: string | null | undefined): boolean {
  const v = (valor ?? '').trim()
  if (!v || v === 'Outro') return false
  if (v.startsWith('Outro')) return v.replace(/^Outro:?/, '').trim().length >= MINIMO_OUTRO
  return true
}

function normaliza(s: string): string {
  return (s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '')
}

export function abaComRegraDeStatus(nomeDaAba: string, idDaAba = ''): boolean {
  return /(arthur|lu[ií]s)/i.test(nomeDaAba) || /(arthur|luis)/i.test(idDaAba)
}

/** O campo que o status (ou o nome do quadro) exige nos CRMs do Arthur/Luis, ou null. */
export function campoExigidoPeloStatus(statusOuQuadro: string): 'agendamento' | 'retornar' | null {
  const n = normaliza(statusOuQuadro)
  if (n.includes('reuniaoagendada')) return 'agendamento'
  if (n.includes('propostaenviada')) return 'retornar'
  return null
}

export function mesmoStatus(a: string, b: string): boolean {
  return normaliza(a) === normaliza(b)
}

/** Data E horário preenchidos (formato salvo: AAAA-MM-DDTHH:MM). */
export function temDataEHora(valor: string | null | undefined): boolean {
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(valor ?? '')
}
