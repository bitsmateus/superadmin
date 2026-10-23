/**
 * Abas do Comercial que aparecem juntas na mesma tela: o CRM IA LUIZA é uma aba dentro do CRM ARTHUR
 * (/comercial/crm-arthur?quadro=crm-ia-luiza). Quem tem acesso à aba de fora vê e opera as de dentro,
 * sem precisar marcar cada uma na Equipe. Espelho do front em src/lib/abasJuntas.ts.
 */
export const ABAS_JUNTAS: Record<string, string[]> = {
  'crm-arthur': ['crm-ia-luiza'],
};

/** A allowlist de abas com as abas de dentro das que já estão liberadas (sem repetir). */
export function comAbasJuntas(pageIds: string[]): string[] {
  const out = new Set(pageIds);
  for (const id of pageIds) for (const junta of ABAS_JUNTAS[id] ?? []) out.add(junta);
  return [...out];
}

/** true se as duas abas são a mesma tela (uma dentro da outra): entre elas não há cópia de card. */
export function saoAbasJuntas(a: string, b: string): boolean {
  return (ABAS_JUNTAS[a] ?? []).includes(b) || (ABAS_JUNTAS[b] ?? []).includes(a);
}
