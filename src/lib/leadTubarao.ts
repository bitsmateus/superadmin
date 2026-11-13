/**
 * Lead "de Tubarão" (pedido de 13/11) — vai só pro CRM TUBARAO (aba de id `crm-outbound`):
 *  - o Tipo começa com "tubarao", sem ligar pra acento e maiúscula ("Tubarão - anúncio", "tubarao lp"…); ou
 *  - o telefone é do DDD 48, com ou sem o 55 na frente ("55 48 9…", "48 9…").
 */
export const PAGINA_TUBARAO = 'crm-outbound'

const semAcento = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim()

/** DDD do telefone: com o 55 (12 ou 13 dígitos) tira o país; sem ele (10 ou 11), são os 2 primeiros. */
export function dddDoTelefone(telefone: string | null | undefined): string {
  const d = String(telefone ?? '').replace(/\D/g, '')
  if ((d.length === 12 || d.length === 13) && d.startsWith('55')) return d.slice(2, 4)
  if (d.length === 10 || d.length === 11) return d.slice(0, 2)
  return ''
}

export function isLeadTubarao(lead: { tipo?: string | null; telefone?: string | null }): boolean {
  if (semAcento(String(lead.tipo ?? '')).startsWith('tubarao')) return true
  return dddDoTelefone(lead.telefone) === '48'
}
