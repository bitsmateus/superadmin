/**
 * Como cada pessoa aparece nos painéis do Comercial.
 *
 * O campo "SDR" do lead guarda só o primeiro nome, e as telas escreviam "SDR Fulano" pra todo
 * mundo — mas nem todo mundo é SDR. Luis e Arthur são; Jean e João são do Suporte e vendem como
 * consequência do atendimento; os demais (Mateus, Ian e quem entrar depois) aparecem só pelo nome.
 *
 * É uma lista curta e explícita de propósito: função de pessoa muda com o tempo e com conversa,
 * não com regra automática. Quem não está aqui aparece pelo nome, que nunca fica errado.
 */
const FUNCAO_POR_NOME: Record<string, string> = {
  luis: 'SDR',
  arthur: 'SDR',
  jean: 'Suporte',
  joao: 'Suporte',
  joão: 'Suporte',
}

/** "Luis" -> "SDR Luis" · "Jean" -> "Suporte Jean" · "Mateus" -> "Mateus". */
export function nomeComFuncao(nome: string): string {
  if (!nome || nome === 'Sem SDR') return nome || 'Sem SDR'
  const funcao = FUNCAO_POR_NOME[nome.trim().toLowerCase()]
  return funcao ? `${funcao} ${nome}` : nome
}
