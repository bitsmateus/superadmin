/** Chamadas à API do Demo Studio com o token pessoal (Configurações → Extensão no painel). */

export interface Conta {
  servidor: string
  token: string
}

export async function lerConta(): Promise<Conta | null> {
  const { conta } = await chrome.storage.local.get('conta')
  return conta?.servidor && conta?.token ? (conta as Conta) : null
}

export function origemDe(url: string): string | null {
  try {
    const u = new URL(url)
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.origin : null
  } catch {
    return null
  }
}

export async function chamar<T>(conta: Conta, caminho: string, opcoes: { method?: string; body?: unknown } = {}): Promise<T> {
  const res = await fetch(conta.servidor.replace(/\/+$/, '') + caminho, {
    method: opcoes.method ?? 'GET',
    headers: {
      Authorization: `Bearer ${conta.token}`,
      ...(opcoes.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
    },
    body: opcoes.body !== undefined ? JSON.stringify(opcoes.body) : undefined,
  })
  const corpo = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error((corpo as { message?: string }).message || `Erro ${res.status} no servidor`)
  return corpo as T
}
