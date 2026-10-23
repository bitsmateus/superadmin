/**
 * Abas do Comercial que aparecem juntas na mesma tela: o CRM IA LUIZA é uma aba dentro do CRM ARTHUR
 * (/comercial/crm-arthur?quadro=crm-ia-luiza). Quem acessa a de fora vê e opera as de dentro (o servidor libera,
 * ver server/src/lib/abasJuntas.ts), e entre elas não há cópia de card.
 */
export const ABAS_JUNTAS: Record<string, string[]> = {
  'crm-arthur': ['crm-ia-luiza'],
}

/** A aba de fora que mostra esta, ou undefined se ela não está dentro de nenhuma. */
export function abaDeFora(pageId: string): string | undefined {
  return Object.keys(ABAS_JUNTAS).find((fora) => ABAS_JUNTAS[fora].includes(pageId))
}

/** true se as duas abas são a mesma tela (uma dentro da outra). */
export function saoAbasJuntas(a: string, b: string): boolean {
  return (ABAS_JUNTAS[a] ?? []).includes(b) || (ABAS_JUNTAS[b] ?? []).includes(a)
}
