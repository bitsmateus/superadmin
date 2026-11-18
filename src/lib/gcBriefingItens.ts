import { BRIEFING_MODELO } from './gcBriefingModelo'

/**
 * O que o link do briefing pergunta ao cliente (pedido de 17/11): às vezes a equipe já tem parte das informações ou não precisa
 * delas, então cada link pode pedir só alguns itens. `null` = o briefing completo (o padrão de sempre).
 *
 * Cada item tem uma chave: os campos soltos têm nome próprio ('site', 'instagram'…) e cada uma das perguntas do modelo é 'p:<posição>'.
 * Instagram, Facebook e CRM levam junto o login/senha deles.
 */

export type ItensDoBriefing = string[] | null

export const ITENS_EMPRESA: { chave: string; rotulo: string }[] = [
  { chave: 'logo', rotulo: 'Logo da empresa' },
  { chave: 'site', rotulo: 'Site' },
  { chave: 'whatsapp_leads', rotulo: 'WhatsApp que recebe os leads' },
]

export const ITENS_ACESSOS: { chave: string; rotulo: string }[] = [
  { chave: 'instagram', rotulo: 'Instagram (usuário e senha)' },
  { chave: 'facebook', rotulo: 'Facebook (login ou página e senha)' },
  { chave: 'crm', rotulo: 'CRM (qual, e-mail e senha)' },
]

export const ITENS_CONTAS: { chave: string; rotulo: string }[] = [
  { chave: 'pagamento_anuncios', rotulo: 'Forma de pagamento na conta de anúncios' },
  { chave: 'google_ads', rotulo: 'Google Ads' },
  { chave: 'meu_negocio', rotulo: 'Google Meu Negócio' },
]

export const ITEM_MATERIAIS = { chave: 'materiais', rotulo: 'Fotos, vídeos e materiais' }

export const chaveDaPergunta = (indice: number) => `p:${indice}`

/** Todas as chaves do briefing completo. */
export const TODAS_AS_CHAVES: string[] = [
  ...ITENS_EMPRESA.map((i) => i.chave),
  ...ITENS_ACESSOS.map((i) => i.chave),
  ...ITENS_CONTAS.map((i) => i.chave),
  ITEM_MATERIAIS.chave,
  ...BRIEFING_MODELO.map((_, i) => chaveDaPergunta(i)),
]

/** Esse item entra no briefing? (`null` = tudo.) */
export function itemPedido(itens: ItensDoBriefing | undefined, chave: string): boolean {
  return !itens || itens.includes(chave)
}

/** Aceita só chaves conhecidas, sem repetir. Lista vazia ou chaves de fora → null (volta pro completo). */
export function normalizarItens(bruto: unknown): ItensDoBriefing {
  if (!Array.isArray(bruto)) return null
  const validas = new Set(TODAS_AS_CHAVES)
  const itens = TODAS_AS_CHAVES.filter((c) => bruto.includes(c) && validas.has(c))
  if (itens.length === 0 || itens.length === TODAS_AS_CHAVES.length) return null
  return itens
}

const comecaCom = (texto: string) => BRIEFING_MODELO.map((p, i) => ({ p, i })).filter(({ p }) => p.pergunta.startsWith(texto)).map(({ i }) => chaveDaPergunta(i))
const doBloco = (prefixo: string) => BRIEFING_MODELO.map((p, i) => ({ p, i })).filter(({ p }) => p.bloco.startsWith(prefixo)).map(({ i }) => chaveDaPergunta(i))

/** Modelos prontos pra começar (dá pra ajustar item por item depois). */
export const MODELOS_DO_BRIEFING: { id: string; nome: string; descricao: string; itens: ItensDoBriefing }[] = [
  { id: 'completo', nome: 'Completo', descricao: 'Tudo: empresa, acessos, contas, as 27 perguntas e materiais.', itens: null },
  {
    id: 'acessos',
    nome: 'Curto: só acessos',
    descricao: 'Site, WhatsApp, Instagram e Facebook, com as senhas.',
    itens: ['site', 'whatsapp_leads', 'instagram', 'facebook'],
  },
  {
    id: 'trafego',
    nome: 'Tráfego pago',
    descricao: 'Acessos, contas de anúncio e as perguntas de verba, atendimento, CRM e histórico de tráfego.',
    itens: [
      'logo', 'site', 'whatsapp_leads', 'instagram', 'facebook', 'crm',
      'pagamento_anuncios', 'google_ads', 'meu_negocio',
      ...comecaCom('O que você vende'),
      ...comecaCom('Qual verba de mídia'),
      ...comecaCom('Por onde chegam os contatos'),
      ...doBloco('Bloco 5'),
      ...doBloco('Bloco 6'),
    ],
  },
]

export type EtapaDoBriefing =
  | { tipo: 'empresa' }
  | { tipo: 'acessos' }
  | { tipo: 'contas' }
  | { tipo: 'perguntas'; bloco: string }
  | { tipo: 'materiais' }
  | { tipo: 'revisao' }

/** As etapas que o cliente vai ver: só as que têm algum item pedido. A revisão fica sempre por último. */
export function etapasDoBriefing(itens: ItensDoBriefing | undefined): EtapaDoBriefing[] {
  const pede = (lista: { chave: string }[]) => lista.some((i) => itemPedido(itens, i.chave))
  const etapas: EtapaDoBriefing[] = []
  if (pede(ITENS_EMPRESA)) etapas.push({ tipo: 'empresa' })
  if (pede(ITENS_ACESSOS)) etapas.push({ tipo: 'acessos' })
  if (pede(ITENS_CONTAS)) etapas.push({ tipo: 'contas' })
  const blocos = Array.from(new Set(BRIEFING_MODELO.map((p) => p.bloco)))
  for (const bloco of blocos) {
    if (BRIEFING_MODELO.some((p, i) => p.bloco === bloco && itemPedido(itens, chaveDaPergunta(i)))) etapas.push({ tipo: 'perguntas', bloco })
  }
  if (itemPedido(itens, ITEM_MATERIAIS.chave)) etapas.push({ tipo: 'materiais' })
  etapas.push({ tipo: 'revisao' })
  return etapas
}

/** Resumo curto pra mostrar na tela da equipe. */
export function resumoDosItens(itens: ItensDoBriefing | undefined): string {
  if (!itens) return 'Briefing completo'
  const perguntas = itens.filter((c) => c.startsWith('p:')).length
  const soltos = itens.length - perguntas
  const partes = [soltos ? `${soltos} ${soltos === 1 ? 'campo' : 'campos'}` : '', perguntas ? `${perguntas} ${perguntas === 1 ? 'pergunta' : 'perguntas'}` : ''].filter(Boolean)
  return `Personalizado: ${partes.join(' e ')}`
}

/** "Não sei" / "Não sabe" não conta como resposta: as perguntas do briefing são obrigatórias e o cliente precisa escrever algo. */
export function respostaValida(resposta: string | null | undefined): boolean {
  const r = String(resposta ?? '').trim()
  if (!r) return false
  return !/^n[aã]o\s+(sei|sabe)\.?$/i.test(r)
}
