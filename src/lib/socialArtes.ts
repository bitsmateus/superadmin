import type { GcSocialAnexo, GcSocialProducao, GcSocialStatus } from '@/services/gestaoClientes'

/** As 6 etapas do fluxo de criação, na ordem do quadro. */
export const ETAPAS_ARTE: { valor: GcSocialStatus; titulo: string; ajuda: string; cor: string }[] = [
  { valor: 'para_producao', titulo: 'Pedido', ajuda: 'A social media pediu; esperando a designer pegar', cor: 'bg-warning' },
  { valor: 'em_producao', titulo: 'Em criação', ajuda: 'A designer está criando (ou corrigindo um ajuste)', cor: 'bg-accent' },
  { valor: 'revisao', titulo: 'Revisão interna', ajuda: 'Arte pronta: a social media confere antes do cliente', cor: 'bg-violet-500' },
  { valor: 'com_cliente', titulo: 'Com o cliente', ajuda: 'Enviada pro cliente aprovar (PDF ou portal)', cor: 'bg-orange-500' },
  { valor: 'aprovado', titulo: 'Aprovado', ajuda: 'O cliente aprovou: pronta pro tráfego', cor: 'bg-success' },
  { valor: 'trafego', titulo: 'No tráfego', ajuda: 'O gestor já usou no anúncio (ou foi postada)', cor: 'bg-emerald-700' },
]
export const nomeDaEtapa = (s: GcSocialStatus) => ETAPAS_ARTE.find((e) => e.valor === s)?.titulo ?? s

export const ehFinal = (a: GcSocialAnexo) => a.papel !== 'referencia'
export const artesFinais = (p: Pick<GcSocialProducao, 'anexos'>) => (p.anexos ?? []).filter(ehFinal)
export const imagensFinais = (p: Pick<GcSocialProducao, 'anexos'>) => artesFinais(p).filter((a) => a.type.startsWith('image/'))
export const midiasFinais = (p: Pick<GcSocialProducao, 'anexos'>) => artesFinais(p).filter((a) => /^(image|video)\//.test(a.type))

/** Mês (YYYY-MM) de hoje, no fuso de quem vê. */
export function mesDeHoje(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}
export function somarMes(mes: string, n: number): string {
  const [a, m] = mes.split('-').map(Number)
  const d = new Date(a, m - 1 + n, 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}
export function nomeDoMes(mes: string, curto = false): string {
  const [a, m] = mes.split('-').map(Number)
  if (!a || !m) return mes
  const n = new Date(a, m - 1, 1).toLocaleDateString('pt-BR', curto ? { month: 'short', year: '2-digit' } : { month: 'long', year: 'numeric' })
  return n[0].toUpperCase() + n.slice(1).replace(' de ', ' ')
}
/** Os meses pra escolher num select: 6 pra trás e 3 pra frente, mais o que já estiver em uso. */
export function opcoesDeMes(extra: string[] = []): { value: string; label: string }[] {
  const hoje = mesDeHoje()
  const lista = new Set<string>([...Array.from({ length: 10 }, (_, i) => somarMes(hoje, i - 6)), ...extra.filter(Boolean)])
  return [...lista].sort().reverse().map((m) => ({ value: m, label: nomeDoMes(m) }))
}

export const MAX_BYTES = 5 * 1024 * 1024

export function lerArquivo(arquivo: File): Promise<{ id: string; name: string; type: string; size: number; dataUrl: string }> {
  return new Promise((resolve, reject) => {
    const leitor = new FileReader()
    leitor.onload = () =>
      resolve({
        id: crypto.randomUUID(),
        name: arquivo.name || (arquivo.type.startsWith('image/') ? 'imagem.png' : 'arquivo'),
        type: arquivo.type,
        size: arquivo.size,
        dataUrl: leitor.result as string,
      })
    leitor.onerror = reject
    leitor.readAsDataURL(arquivo)
  })
}

export const enderecoDoPortal = (token: string, aba?: string) => `${window.location.origin}/cliente/${token}${aba ? `?aba=${aba}` : ''}`

export async function copiar(texto: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(texto)
    return true
  } catch {
    return false
  }
}
