/**
 * Linha do tempo do cliente (aba "Notas internas"): dos registros automáticos do cliente (client.logs), fica só o que conta a história
 * dele — briefing gerado/enviado/preenchido, mudança de etapa, reunião, entrega, contrato, follow-up. Edição de campo (nome, e-mail,
 * token do tenant…) e as próprias notas ficam de fora: seriam ruído na linha do tempo.
 */

export interface RegistroDoCliente {
  id: string
  action: string
  detail?: string
  createdAt: string
}

const MARCOS = /briefing|etapa|entreg|reuni[aã]o|contrato|configura[cç][aã]o|pronto para|follow-up|acessos enviados|pend[eê]ncias|tenant vinculado|aprovad/i

const RUIDO = /nota interna|nota (registrada|editada|exclu[ií]da)|atualizad[oa]$|editado manualmente|mensagem do follow-up|checklist atualizado|handoff atualizado|reuni[aã]o de treinamento atualizada/i

/** Esse registro entra na linha do tempo? */
export function ehMarcoDoCliente(registro: Pick<RegistroDoCliente, 'action'>): boolean {
  const a = String(registro.action ?? '').trim()
  if (!a) return false
  if (RUIDO.test(a)) return false
  return MARCOS.test(a)
}

/** Os marcos do cliente, do mais novo pro mais antigo. */
export function marcosDoCliente(logs: RegistroDoCliente[] | undefined | null): RegistroDoCliente[] {
  return (logs ?? [])
    .filter((l) => l && l.createdAt && ehMarcoDoCliente(l))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
}
