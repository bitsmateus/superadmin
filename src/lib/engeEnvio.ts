import type { EngeEnvio, EngeGarantia, EnvioNovo, EtapaRegua } from '@/api/engeEnvio'

/** Regras de data e status do Enge Envio (/engeenvio). Datas de calendário em "YYYY-MM-DD". */

const TZ = 'America/Sao_Paulo'

/** Garantias que todo empreendimento novo costuma ter — a tela deixa marcar/desmarcar e editar. */
export const MODELO_GARANTIAS: { item: string; meses: number }[] = [
  { item: 'Louças e metais sanitários (aparência)', meses: 3 },
  { item: 'Revestimento cerâmico (aparência)', meses: 3 },
  { item: 'Esquadrias de alumínio (vedação)', meses: 12 },
  { item: 'Portas, ferragens e fechaduras', meses: 12 },
  { item: 'Elevadores', meses: 12 },
  { item: 'Pintura interna e externa', meses: 24 },
  { item: 'Instalações elétricas', meses: 24 },
  { item: 'Instalações hidráulicas (tubulações)', meses: 36 },
  { item: 'Impermeabilização', meses: 36 },
  { item: 'Fachada e revestimento externo', meses: 60 },
  { item: 'Estrutura e fundações', meses: 60 },
]

export const prazoTexto = (meses: number) =>
  meses === 12 ? '1 ano' : meses % 12 === 0 ? `${meses / 12} anos` : `${meses} meses`

export function hoje(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
}

const utc = (iso: string) => new Date(`${iso.slice(0, 10)}T00:00:00Z`)
const iso = (d: Date) => d.toISOString().slice(0, 10)

export function somarMeses(data: string, meses: number): string {
  const d = utc(data)
  const dia = d.getUTCDate()
  d.setUTCDate(1)
  d.setUTCMonth(d.getUTCMonth() + meses)
  // 31/01 + 1 mês = 28/02 (não 03/03).
  const ultimo = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate()
  d.setUTCDate(Math.min(dia, ultimo))
  return iso(d)
}

export const somarDias = (data: string, dias: number) => iso(new Date(utc(data).getTime() + dias * 86_400_000))

export const diasAte = (data: string, desde = hoje()) => Math.round((utc(data).getTime() - utc(desde).getTime()) / 86_400_000)

export const dataBr = (data: string | null | undefined) => (data ? data.slice(0, 10).split('-').reverse().join('/') : '—')

/** Timestamp do banco → "YYYY-MM-DDTHH:mm" em Brasília (valor de <input type="datetime-local">). */
export function paraCampo(ts: string): string {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone: TZ,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    })
      .formatToParts(new Date(ts))
      .map((x) => [x.type, x.value]),
  )
  return `${p.year}-${p.month}-${p.day}T${p.hour === '24' ? '00' : p.hour}:${p.minute}`
}

export function dataHoraBr(ts: string | null | undefined): string {
  if (!ts) return '—'
  const [d, h] = paraCampo(ts).split('T')
  return `${dataBr(d)} ${h}`
}

/**
 * Dias de aviso sugeridos pra uma garantia: N dias antes do vencimento, no horário escolhido.
 * Os que já passaram ficam de fora (não dá pra avisar no passado); se todos passaram e a garantia
 * ainda não venceu, sobra um aviso pra amanhã.
 */
export function sugerirEnvios(vencimento: string, antecedencias: number[], hora: string): string[] {
  const amanha = somarDias(hoje(), 1)
  const datas = [...new Set(antecedencias)]
    .sort((a, b) => b - a)
    .map((n) => somarDias(vencimento, -n))
    .filter((d) => d > hoje())
  if (!datas.length && vencimento >= amanha) datas.push(amanha)
  return datas.map((d) => `${d}T${hora}`)
}

export type Tom = 'success' | 'danger' | 'warning' | 'info' | 'neutral'

export function statusGarantia(g: EngeGarantia): { label: string; tom: Tom; chave: string } {
  const dias = diasAte(g.vencimento)
  if (g.chamadoEm) return { label: 'Chamado aberto', tom: 'info', chave: 'chamado' }
  if (dias < -60) return { label: 'Encerrada', tom: 'neutral', chave: 'encerrada' }
  if (dias < 0) return { label: 'Vencida', tom: 'danger', chave: 'vencida' }
  if (dias <= 30) return { label: 'Vence em breve', tom: 'warning', chave: 'breve' }
  return { label: 'Em garantia', tom: 'success', chave: 'coberta' }
}

export function statusEnvio(e: EngeEnvio): { label: string; tom: Tom } {
  if (e.status === 'enviado') return e.cienteEm ? { label: 'Ciente confirmado', tom: 'success' } : { label: 'Enviado', tom: 'info' }
  if (e.status === 'erro') return { label: 'Erro no envio', tom: 'danger' }
  if (e.status === 'cancelado') return { label: 'Cancelado', tom: 'neutral' }
  return { label: 'Agendado', tom: 'warning' }
}

export function textoDias(dias: number): string {
  if (dias === 0) return 'vence hoje'
  if (dias > 0) return dias === 1 ? 'em 1 dia' : `em ${dias} dias`
  return dias === -1 ? 'venceu há 1 dia' : `venceu há ${-dias} dias`
}

/** Etapa nova da régua (30 dias antes, às 9h, modelo padrão, e-mail + WhatsApp se houver). */
export function novaEtapa(whatsapp: boolean): EtapaRegua {
  return {
    id: `e${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
    momento: 'antes',
    dias: 30,
    hora: '09:00',
    modeloId: null,
    email: true,
    whatsapp,
    repetir: false,
    aCada: 7,
    vezes: 1,
  }
}

/** Dias da etapa em relação ao vencimento (negativo = antes). */
const deslocamento = (e: EtapaRegua) => (e.momento === 'dia' ? 0 : e.momento === 'antes' ? -e.dias : e.dias)

/** Todas as datas (YYYY-MM-DD) que uma etapa gera pra um vencimento, já com as repetições. */
export function datasDaEtapa(e: EtapaRegua, vencimento: string): string[] {
  const primeira = somarDias(vencimento, deslocamento(e))
  const datas = [primeira]
  if (e.repetir) for (let k = 1; k <= e.vezes; k++) datas.push(somarDias(primeira, k * e.aCada))
  return datas
}

/**
 * Régua → avisos de uma garantia. Fica só o que ainda vai acontecer (não dá pra avisar no
 * passado); duas etapas no mesmo dia e hora com o mesmo modelo viram um aviso só. Sem a NX
 * configurada, o WhatsApp das etapas é desligado (senão todo aviso ficaria com erro nesse canal).
 */
export function expandirRegua(etapas: EtapaRegua[], vencimento: string, opcoes: { whatsappDisponivel: boolean }): EnvioNovo[] {
  const agora = hoje()
  const vistos = new Set<string>()
  const out: EnvioNovo[] = []
  for (const e of etapas) {
    const email = e.email
    const whatsapp = e.whatsapp && opcoes.whatsappDisponivel
    if (!email && !whatsapp) continue
    for (const d of datasDaEtapa(e, vencimento)) {
      if (d <= agora) continue
      const enviarEm = `${d}T${e.hora || '09:00'}`
      const chave = `${enviarEm}|${e.modeloId ?? ''}`
      if (vistos.has(chave)) continue
      vistos.add(chave)
      out.push({ enviarEm, modeloId: e.modeloId, email, whatsapp })
    }
  }
  return out.sort((a, b) => a.enviarEm.localeCompare(b.enviarEm))
}

/** "30 dias antes do vencimento, às 09:00 · repete a cada 15 dias, 3 vezes" */
export function descreverEtapa(e: EtapaRegua): string {
  const quando =
    e.momento === 'dia'
      ? 'No dia do vencimento'
      : `${e.dias} ${e.dias === 1 ? 'dia' : 'dias'} ${e.momento === 'antes' ? 'antes' : 'depois'} do vencimento`
  const rep = e.repetir ? ` · repete a cada ${e.aCada} ${e.aCada === 1 ? 'dia' : 'dias'}, ${e.vezes} ${e.vezes === 1 ? 'vez' : 'vezes'}` : ''
  return `${quando}, às ${e.hora}${rep}`
}
