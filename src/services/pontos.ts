import { api } from '@/services/api'

/** Financeiro > Pontos — chamadas da API (todas só pra quem vê o Financeiro; ver server/src/pontos/rotas.ts). */

export type DestinoExtra = 'banco' | 'pagamento'
export type TipoAjuste =
  | 'abonar_manha' | 'abonar_tarde' | 'abonar_falta' | 'abonar_atraso' | 'justificar' | 'folga' | 'compensacao'
  | 'feriado' | 'perdoar_desconto' | 'descontar_saldo' | 'extra_banco' | 'extra_pagamento' | 'corrigir_batidas' | 'atestado' | 'descontar_horas'
/** Desconto manual de horas: sai do banco de horas ou vira R$ na folha. */
export type DestinoDesconto = 'banco' | 'dinheiro'
export type StatusDia =
  | 'normal' | 'atraso' | 'extra' | 'manha_sem_batida' | 'tarde_sem_batida' | 'em_andamento' | 'incompleto'
  | 'falta' | 'justificada' | 'feriado' | 'folga' | 'fora_controle' | 'abonado' | 'sem_registro'
export type PapelColuna = 'ignorar' | 'nome' | 'data' | 'datahora' | 'hora' | 'batida' | 'batidas_texto'

export interface Colaborador {
  id: string
  nome: string
  apelidos: string[]
  ativo: boolean
  diasSemana: number[]
  minutosDia: number
  minutosSabado: number
  minutosDomingo: number
  entradaPrevista: string
  saidaPrevista: string
  intervaloMinutos: number
  /** Início do almoço ("12:00"); divide o dia em manhã e tarde. */
  intervaloInicio: string | null
  toleranciaMinutos: number
  salarioBaseCentavos: number
  divisorMensal: number
  valorHoraCentavos: number | null
  valorHoraCalculadoCentavos: number
  pctExtraUtil: number
  pctExtraDomingoFeriado: number
  destinoExtra: DestinoExtra
  bancoSaldoInicialMinutos: number
  bancoInicio: string | null
  /** Início do controle de ponto: antes dessa data nada conta. */
  inicioControle: string | null
}

export interface DiaPonto {
  data: string
  diaSemana: number
  batidasOriginais: string[]
  batidas: string[]
  previstoMinutos: number
  trabalhadoMinutos: number
  atrasoMinutos: number
  saidaAntecipadaMinutos: number
  /** trabalhado − previsto (com abonos), antes da tolerância. */
  saldoBrutoMinutos: number
  /** Efeito no banco de horas. */
  bancoMinutos: number
  faltaMinutos: number
  extraMinutos: number
  extraDestino: DestinoExtra
  pctExtra: number
  saldoMinutos: number
  /** Desconto das horas. O DSR vem em dsrCentavos (só no primeiro dia com falta da semana). */
  descontoCentavos: number
  dsrDias: number
  dsrCentavos: number
  valorExtraCentavos: number
  feriado: string | null
  justificativa: string | null
  status: StatusDia
  avisos: string[]
  ajustes: TipoAjuste[]
}

export interface ResumoPonto {
  trabalhadoMinutos: number
  previstoMinutos: number
  extraMinutos: number
  extraBancoMinutos: number
  extraPagamentoMinutos: number
  atrasoMinutos: number
  saidaAntecipadaMinutos: number
  faltaMinutos: number
  faltas: number
  justificadas: number
  manhasSemBatida: number
  emAndamento: number
  saldoMinutos: number
  bancoMinutos: number
  /** Desconto total: horas faltadas + DSR. */
  descontoCentavos: number
  /** Parte do desconto que é DSR. */
  descontoDsrCentavos: number
  dsrSemanas: number
  valorExtraCentavos: number
}

export interface AjustePonto {
  id: string
  data: string
  tipo: TipoAjuste
  motivo: string
  batidas: string[] | null
  /** descontar_horas: quantos minutos e de onde sai. */
  minutos?: number | null
  destino?: DestinoDesconto | null
  autor: string
  criadoEm: string
}

export interface PeriodoDoColaborador {
  colaborador: Colaborador
  dias: DiaPonto[]
  resumo: ResumoPonto
  ajustes: AjustePonto[]
  bancoAcumuladoMinutos: number
}

export interface Feriado { id: string; data: string; nome: string; abrangencia: 'nacional' | 'estadual' | 'municipal' }

export interface Mapeamento { linhaCabecalho: number; colunas: Record<string, PapelColuna> }

export interface PedidoDeImportacao {
  arquivoNome: string
  arquivoBase64: string
  modo: 'mes' | 'periodo'
  mes?: string
  de?: string
  ate?: string
  mapeamentos?: Record<string, Mapeamento>
  associacoes?: Record<string, string>
  decisoes?: Record<string, 'manter' | 'substituir'>
}

export interface ConferenciaDoRelogio {
  nome: string
  nomeNaPlanilha: string
  relogio: Record<string, string>
  nosso: { faltas: number; atrasoBruto: string; horasExtras: string; trabalhadas: string; banco: string; justificadas: number; emAndamento: number }
  divergencias: string[]
}

export interface PreviaDeImportacao {
  arquivoNome: string
  modo: 'mes' | 'periodo'
  formato: 'relogio' | 'colunas'
  periodoLido: { inicio: string; fim: string } | null
  turnos: { total: number; justificadas: number }
  conferencia: ConferenciaDoRelogio[]
  mesDetectado: string | null
  periodoDoArquivo: { inicio: string; fim: string } | null
  periodo: { inicio: string; fim: string } | null
  abas: { nome: string; cabecalhos: string[]; amostra: string[][]; mapeamento: Mapeamento | null; precisaMapeamento: boolean; nomeDaAba: string }[]
  nomesDaPlanilha: { nome: string; colaboradorId: string | null }[]
  naoReconhecidos: string[]
  colaboradores: { colaboradorId: string; nome: string; dias: number; batidas: number }[]
  invalidas: { aba: string; linha: number; motivo: string }[]
  totalInvalidas: number
  avisos: string[]
  conflitos: { colaboradorId: string; nome: string; data: string; atuais: string[]; novas: string[]; chave: string }[]
  contagens: { novos: number; atualizados: number; ignorados: number; foraDoPeriodo: number }
}

export interface Importacao {
  id: string
  arquivo_nome: string
  modo: 'mes' | 'periodo'
  periodo_inicio: string
  periodo_fim: string
  novos: number
  atualizados: number
  ignorados: number
  avisos: string[]
  importado_por_nome: string
  criado_em: string
  desfeita_em: string | null
  desfeita_por_nome: string | null
  batidas_atuais: number
}

export const pontosService = {
  colaboradores: () => api.get<Colaborador[]>('/api/pontos/colaboradores'),
  criarColaborador: (c: Partial<Colaborador>) => api.post<Colaborador>('/api/pontos/colaboradores', c),
  salvarColaborador: (id: string, c: Partial<Colaborador>) => api.patch<Colaborador>(`/api/pontos/colaboradores/${id}`, c),
  feriados: () => api.get<Feriado[]>('/api/pontos/feriados'),
  salvarFeriado: (f: { data: string; nome: string; abrangencia: Feriado['abrangencia'] }) => api.post<Feriado>('/api/pontos/feriados', f),
  removerFeriado: (id: string) => api.delete(`/api/pontos/feriados/${id}`),
  periodo: (de: string, ate: string) => api.get<{ de: string; ate: string; colaboradores: PeriodoDoColaborador[] }>(`/api/pontos/periodo?de=${de}&ate=${ate}`),
  criarAjuste: (a: { colaboradorId: string; data: string; tipo: TipoAjuste; motivo: string; batidas?: string[]; minutos?: number; destino?: DestinoDesconto }) => api.post<{ id: string }>('/api/pontos/ajustes', a),
  removerAjuste: (id: string) => api.delete(`/api/pontos/ajustes/${id}`),
  previa: (p: PedidoDeImportacao) => api.post<PreviaDeImportacao>('/api/pontos/importacoes/previa', p),
  importar: (p: PedidoDeImportacao) => api.post<{ id: string; novos: number; atualizados: number; ignorados: number }>('/api/pontos/importacoes', p),
  importacoes: () => api.get<Importacao[]>('/api/pontos/importacoes'),
  desfazerImportacao: (id: string) => api.post<{ ok: true; removidas: number; devolvidas: number }>(`/api/pontos/importacoes/${id}/desfazer`),
  relatorio: (p: { colaboradorId: string; de: string; ate: string; formato: 'csv' | 'pdf' }) => api.postForBlob('/api/pontos/relatorio', p),
}

// ───────────── formatação ─────────────

export const DIAS_CURTOS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb']

/** 90 -> "1h30"; -45 -> "-0h45". */
export function horas(min: number): string {
  const sinal = min < 0 ? '-' : ''
  const a = Math.abs(Math.round(min))
  return `${sinal}${Math.floor(a / 60)}h${String(a % 60).padStart(2, '0')}`
}

export const brl = (centavos: number) => (centavos / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
export const dataBr = (d: string) => d.split('-').reverse().join('/')

export const ROTULO_STATUS: Record<StatusDia, string> = {
  normal: 'Normal', atraso: 'Atraso', extra: 'Extra', manha_sem_batida: 'Manhã sem batida', tarde_sem_batida: 'Tarde sem batida',
  em_andamento: 'Em andamento', incompleto: 'Sem saída', falta: 'Falta', justificada: 'Justificada', feriado: 'Feriado',
  folga: 'Folga', fora_controle: 'Fora do controle', abonado: 'Abonado', sem_registro: 'Sem registro',
}

export const ROTULO_AJUSTE: Record<TipoAjuste, string> = {
  abonar_manha: 'Abonar manhã',
  abonar_tarde: 'Abonar tarde',
  abonar_falta: 'Abonar dia (falta ou saldo negativo)',
  abonar_atraso: 'Abonar atraso (saldo negativo do dia)',
  justificar: 'Justificar ausência (não desconta)',
  folga: 'Marcar folga',
  compensacao: 'Compensação (folga paga com o banco)',
  feriado: 'Marcar feriado',
  perdoar_desconto: 'Falta sem desconto em R$ (vai pro banco)',
  descontar_saldo: 'Converter saldo negativo em desconto (R$)',
  extra_banco: 'Converter em hora extra: banco',
  extra_pagamento: 'Converter em hora extra: pagamento',
  corrigir_batidas: 'Corrigir batidas',
  atestado: 'Atestado (abona a falta)',
  descontar_horas: 'Descontar horas',
}

/** Arquivo -> base64 (sem o prefixo data:). */
export function arquivoParaBase64(f: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(String(r.result).replace(/^data:[^,]*,/, ''))
    r.onerror = () => reject(new Error('Não deu pra ler o arquivo.'))
    r.readAsDataURL(f)
  })
}

export function baixarBlob(blob: Blob, nome: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = nome
  document.body.appendChild(a)
  a.click()
  a.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}
