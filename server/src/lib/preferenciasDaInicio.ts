/**
 * Tela inicial (src/pages/InicioPage.tsx): o que cada pessoa escolheu pra ver lá. Guardado em profiles.home_prefs.
 * São só CAMINHOS de tela ("/clients", "/comercial/crm-arthur"…): o que a pessoa pode abrir quem decide é a tela
 * (as permissões dela), então um caminho que ela perdeu acesso simplesmente não aparece.
 */
export interface PreferenciasDaInicio {
  atalhos: string[];
  acessoRapido: string[];
}

export const MAXIMO_ATALHOS = 3;
export const MAXIMO_ACESSO_RAPIDO = 8;

const caminhoValido = (v: unknown): v is string =>
  typeof v === 'string' && v.length <= 200 && /^\/[A-Za-z0-9/_\-.]*$/.test(v);

function lista(v: unknown, maximo: number): string[] | null {
  if (v === undefined) return [];
  if (!Array.isArray(v) || v.length > maximo || !v.every(caminhoValido)) return null;
  return [...new Set(v)];
}

/** Confere e normaliza o que veio do front. null = inválido (a rota responde 400). */
export function limparPreferenciasDaInicio(v: unknown): PreferenciasDaInicio | null {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
  const o = v as Record<string, unknown>;
  const atalhos = lista(o.atalhos, MAXIMO_ATALHOS);
  const acessoRapido = lista(o.acessoRapido, MAXIMO_ACESSO_RAPIDO);
  if (!atalhos || !acessoRapido) return null;
  return { atalhos, acessoRapido };
}
