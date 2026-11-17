/** "Bom dia" até 11:59, "Boa tarde" até 17:59 e "Boa noite" depois — pela hora de quem está copiando (a equipe é do Brasil). */
export function saudacaoDoDia(agora: Date = new Date()): string {
  const h = agora.getHours()
  if (h < 12) return 'Bom dia'
  if (h < 18) return 'Boa tarde'
  return 'Boa noite'
}

/** A mensagem pronta pra colar no WhatsApp junto do link de assinatura do contrato. */
export function mensagemDoContrato(link: string, agora: Date = new Date()): string {
  return [
    `${saudacaoDoDia(agora)}, tudo certo? Sejam bem vindos! `,
    '',
    'Segue contrato no link abaixo para analise e assinatura',
    '',
    link.trim(),
    '',
    'Fico a disposição, qualquer dúvida pode comentar 😊',
  ].join('\n')
}
