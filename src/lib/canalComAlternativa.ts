/**
 * Criar o canal de WhatsApp no tenant: cada servidor da NX aceita um tipo diferente (o App recusa "evo" com
 * ERR_CHANNEL_LIB_NOT_CONFIGURED; o Web recusa "uazapi" com ERR_UAZAPI_HOST_NOT_FOUND). Quando o servidor recusa o tipo por
 * não ter a biblioteca/host configurado, tenta o outro tipo antes de desistir. Qualquer outro erro sobe como está.
 */
export type TipoDeCanal = 'uazapi' | 'evo'

const SERVIDOR_SEM_ESSE_TIPO = /ERR_UAZAPI_HOST_NOT_FOUND|ERR_CHANNEL_LIB_NOT_CONFIGURED/i

export const servidorNaoTemEsseTipo = (mensagem: string) => SERVIDOR_SEM_ESSE_TIPO.test(mensagem)

export async function criarCanalComAlternativa<T>(
  criar: (tipo: TipoDeCanal) => Promise<T>,
  preferido: TipoDeCanal,
  mensagemDe: (erro: unknown) => string,
): Promise<{ resultado: T; tipo: TipoDeCanal }> {
  try {
    return { resultado: await criar(preferido), tipo: preferido }
  } catch (erro) {
    const primeira = mensagemDe(erro)
    if (!servidorNaoTemEsseTipo(primeira)) throw erro
    const outro: TipoDeCanal = preferido === 'uazapi' ? 'evo' : 'uazapi'
    try {
      return { resultado: await criar(outro), tipo: outro }
    } catch (segundoErro) {
      throw new Error(
        `O servidor não conseguiu criar o canal: como ${preferido} deu ${primeira}; como ${outro} deu ${mensagemDe(segundoErro)}. ` +
          'Configure o WhatsApp nesse servidor da NX ou escolha outro servidor.',
      )
    }
  }
}
