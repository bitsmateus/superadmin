/**
 * "Dia de contato" curto pra lead de Social Selling (pedido de 17/11): a coluna é padrão até o Dia 7, mas a lead cujo Tipo é
 * LEAD SOCIAL SELLING (frio, novos, curtiu ou seguidor) só trabalha até o Dia 3 — pra ela a lista de dias mostra só os 3 primeiros.
 */
export const LIMITE_DIAS_SOCIAL_SELLING = 3

const semAcento = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

/** Tipo "LEAD SOCIAL SELLING - FRIO / NOVOS / CURTIU / SEGUIDOR" (sem ligar pra maiúscula, acento, traço ou singular/plural). */
export function ehTipoSocialSelling(tipo: string | null | undefined): boolean {
  const t = semAcento(String(tipo ?? '')).replace(/[^a-z0-9]+/g, ' ').trim()
  if (!t.includes('social selling')) return false
  return /\b(frio|novo|novos|curtiu|seguidor|seguidores)\b/.test(t)
}

/** Quantos dias de contato essa lead pode escolher (undefined = todos, o normal). */
export function limiteDeDiasDoTipo(tipo: string | null | undefined): number | undefined {
  return ehTipoSocialSelling(tipo) ? LIMITE_DIAS_SOCIAL_SELLING : undefined
}
