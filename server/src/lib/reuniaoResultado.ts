import { normalizaNome } from './normalizaNome.js';
import { MINIMO_DETALHE_MOTIVO, MOTIVOS_DESQUALIFICACAO } from './trafegoNicho.js';

/**
 * Resultado da reunião (popup obrigatório). Funções puras: o "Agendamento" do card é texto local de Brasília
 * ("YYYY-MM-DDTHH:MM", sem fuso — o mesmo que a ficha grava), e o Brasil não tem horário de verão: -03:00 fixo.
 */

export const RESULTADOS_REUNIAO = ['compareceu', 'nao_compareceu', 'remarcada'] as const;
export type ResultadoReuniao = (typeof RESULTADOS_REUNIAO)[number];

/** Pra onde o card vai quando o lead compareceu (nome do status; o quadro sai de quadroDoStatus). */
export const ETAPAS_COMPARECEU = ['Proposta enviada', 'Follow up Propostas', 'Vendido', 'Perdido', 'Desqualificado'] as const;

export const MOTIVOS_NAO_COMPARECEU = [
  'Lead não entrou na reunião e não respondeu',
  'Lead sumiu / sem retorno',
  'Lead avisou que não podia',
  'Lead pediu pra cancelar',
  'Problema técnico (link, conexão)',
  'Outro',
] as const;

export const MINIMO_RESUMO = 20;
/** Uma hora depois do horário marcado, a reunião sem resultado vira pendência. */
export const ESPERA_MS = 60 * 60 * 1000;

const LOCAL = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/;
const OFFSET_MS = 3 * 60 * 60 * 1000;

/** "2026-10-27T09:00" (Brasília) -> Date. Null se não for data+hora válida. */
export function agendamentoParaDate(local: string | null | undefined): Date | null {
  const m = LOCAL.exec((local ?? '').trim());
  if (!m) return null;
  const d = new Date(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:00-03:00`);
  if (Number.isNaN(d.getTime())) return null;
  // Date aceita "2026-02-30" e rola pro mês seguinte: volta a conferir os números.
  return dateParaAgendamento(d) === `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}` ? d : null;
}

/** Date -> "YYYY-MM-DDTHH:MM" no horário de Brasília (o formato do campo Agendamento). */
export function dateParaAgendamento(d: Date): string {
  return new Date(d.getTime() - OFFSET_MS).toISOString().slice(0, 16);
}

/** "2026-10-27T09:00" -> "2026-10-27T09:00:00-03:00" (o formato da API e do webhook). Vazio/inválido = null. */
export function agendamentoParaIso(local: string | null | undefined): string | null {
  return agendamentoParaDate(local) ? `${(local ?? '').trim().slice(0, 16)}:00-03:00` : null;
}

/**
 * Agendamento que chega pela API (n8n): ISO com fuso ("2026-10-27T09:00:00-03:00", "...Z") ou já no formato local
 * ("2026-10-27T09:00"). Grava sempre no formato local de Brasília. null/"" limpa.
 */
export function agendamentoDaIntegracao(raw: unknown): { valor: string } | { erro: string } {
  if (raw === null || raw === '') return { valor: '' };
  const erro = '"agendamento" deve ser data e hora ISO, ex.: "2026-10-27T09:00:00-03:00".';
  if (typeof raw !== 'string') return { erro };
  const v = raw.trim();
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?$/.test(v)) {
    return agendamentoParaDate(v) ? { valor: v.slice(0, 16) } : { erro };
  }
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(v)) return { erro };
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? { erro } : { valor: dateParaAgendamento(d) };
}

/** "27/10/2026 09:00" pra Atualização. */
export function agendamentoLegivel(local: string): string {
  const m = LOCAL.exec(local ?? '');
  return m ? `${m[3]}/${m[2]}/${m[1]} ${m[4]}:${m[5]}` : local || '—';
}

/** Primeiro nome, sem acento e minúsculo ("Luís Henrique" -> "luis"). */
export function primeiroNome(s: string | null | undefined): string {
  return normalizaNome((s ?? '').trim().split(/\s+/)[0] ?? '');
}

/** O responsável (nome do SDR, ex.: "Luis") é a pessoa logada? Casa pelo primeiro nome. "IA Luiza" não casa com ninguém. */
export function ehAPessoa(responsavel: string, nomeDoUsuario: string): boolean {
  const r = primeiroNome(responsavel);
  return !!r && r !== 'ia' && r === primeiroNome(nomeDoUsuario);
}

/** É gente (não a IA)? "IA Luiza" não responde popup. */
export function ehHumano(nome: string | null | undefined): boolean {
  const p = primeiroNome(nome);
  return !!p && p !== 'ia';
}

/** Dono de uma aba pelo nome dela (mesma regra do sdrDaAba): o SDR humano contido no nome ("CRM LUIS CLOSER" -> "Luis"). */
export function donoDaAba(nomeDaAba: string, sdrs: string[]): string {
  const aba = (nomeDaAba ?? '').toLowerCase();
  return sdrs.find((s) => ehHumano(s) && aba.includes(s.toLowerCase())) ?? '';
}

/** Depois de quanto tempo sem resposta do closer a reunião também vai pro SDR da lead original. */
export const ESCALAR_MS = 2 * 60 * 60 * 1000;

export interface CandidatoReuniao {
  id: string;
  familia: string; // id da lead original (a cópia do closer/da IA aponta pra ela)
  ehCopiaCloser: boolean;
  agendamento: string;
  board_id: string;
}

export interface ReuniaoPendente<T extends CandidatoReuniao> {
  familia: string;
  agendamento: string;
  quando: Date;
  /** As linhas da lead em "Reunião agendada" (a original e/ou as cópias). */
  linhas: T[];
}

/**
 * Das linhas em "Reunião agendada", as reuniões pendentes: uma por lead (a original e as cópias contam uma vez só),
 * com o horário passado há 1h ou mais, a partir de `desde`, e sem resultado pra esse mesmo horário (remarcar muda o
 * horário, então ela volta a ser cobrada no novo). A mais antiga primeiro.
 */
export function reunioesPendentes<T extends CandidatoReuniao>(
  candidatos: T[], jaRespondidas: Set<string>, agora: Date, desde: Date,
): ReuniaoPendente<T>[] {
  const porFamilia = new Map<string, ReuniaoPendente<T>>();
  for (const c of candidatos) {
    const quando = agendamentoParaDate(c.agendamento);
    if (!quando || quando < desde || agora.getTime() - quando.getTime() < ESPERA_MS) continue;
    if (jaRespondidas.has(chaveDaReuniao(c.familia, c.agendamento))) continue;
    const r = porFamilia.get(c.familia);
    // O horário que vale é o do card do closer (é quem faz a reunião); as cópias andam juntas, então em geral é o mesmo.
    if (!r) porFamilia.set(c.familia, { familia: c.familia, agendamento: c.agendamento.slice(0, 16), quando, linhas: [c] });
    else {
      r.linhas.push(c);
      if (c.ehCopiaCloser) { r.agendamento = c.agendamento.slice(0, 16); r.quando = quando; }
    }
  }
  return [...porFamilia.values()].sort((a, b) => a.agendamento.localeCompare(b.agendamento));
}

export interface OrigemDaReuniao {
  /** SDR da lead original e o nome da aba dela. */
  sdr: string;
  nomeDaPagina: string;
  /** Aba que mostra a da lead por dentro (CRM IA LUIZA dentro do CRM ARTHUR), se houver. */
  nomeDaAbaDeFora?: string;
}

/**
 * Quem responde: primeiro o closer (dono do CRM do closer, quando a lead tem a cópia lá); se ele não responder em
 * ESCALAR_MS, também o SDR da lead original. Sem cópia no closer, o SDR da original é o primeiro. Lead da IA Luiza
 * (SDR que não é gente) cai no dono da aba onde ela aparece (o CRM IA LUIZA fica dentro do CRM ARTHUR -> Arthur).
 * Admin não entra: o popup é só de quem faz a reunião.
 */
export function responsaveisDaReuniao<T extends CandidatoReuniao>(
  r: ReuniaoPendente<T>, origem: OrigemDaReuniao | undefined, nomeDaAbaDoCard: (c: T) => string, sdrs: string[],
): { primario: string; secundario: string } {
  const sdrDaOriginal = origem
    ? (ehHumano(origem.sdr) ? origem.sdr : '') ||
      donoDaAba(origem.nomeDaAbaDeFora ?? '', sdrs) || donoDaAba(origem.nomeDaPagina, sdrs)
    : '';
  const copia = r.linhas.find((l) => l.ehCopiaCloser);
  const closer = copia ? donoDaAba(nomeDaAbaDoCard(copia), sdrs) : '';
  if (!closer) return { primario: sdrDaOriginal, secundario: '' };
  return { primario: closer, secundario: primeiroNome(sdrDaOriginal) === primeiroNome(closer) ? '' : sdrDaOriginal };
}

/**
 * O card dessa reunião que ESTA pessoa resolve, ou null se ela não precisa ver (ainda). O closer trabalha a cópia do
 * CRM dele; o SDR da original, a original. Só entra card de quadro que a pessoa enxerga.
 */
export function cardDaPessoa<T extends CandidatoReuniao>(
  r: ReuniaoPendente<T>, resp: { primario: string; secundario: string }, nomeDoUsuario: string,
  podeVer: (boardId: string) => boolean, agora: Date,
): T | null {
  const visiveis = r.linhas.filter((l) => podeVer(l.board_id));
  const copia = visiveis.find((l) => l.ehCopiaCloser);
  const original = visiveis.find((l) => l.id === l.familia);
  if (ehAPessoa(resp.primario, nomeDoUsuario)) return copia ?? original ?? visiveis[0] ?? null;
  const escalou = agora.getTime() - r.quando.getTime() >= ESPERA_MS + ESCALAR_MS;
  if (resp.secundario && escalou && ehAPessoa(resp.secundario, nomeDoUsuario)) return original ?? visiveis[0] ?? null;
  return null;
}

export function chaveDaReuniao(familia: string, agendamento: string): string {
  return `${familia}|${(agendamento ?? '').slice(0, 16)}`;
}

export interface CamposDoCard {
  numero_atendentes: string;
  valor_mrr: string;
  valor_implementacao: string;
  retornar: string;
  motivo_desqualificacao: string;
}

export interface ResultadoValidado {
  resultado: ResultadoReuniao;
  resumo: string;
  proximaEtapa: string | null;
  motivo: string | null;
  agendamentoNovo: string | null;
}

const temDigito = (v: string) => /\d/.test(v ?? '');

function motivoDeDesqualificacaoValido(v: string): boolean {
  const i = (v ?? '').indexOf(':');
  const nome = (i >= 0 ? v.slice(0, i) : v).trim();
  const detalhe = i >= 0 ? v.slice(i + 1).trim() : '';
  return (MOTIVOS_DESQUALIFICACAO as readonly string[]).includes(nome) && detalhe.length >= MINIMO_DETALHE_MOTIVO;
}

/** Valida o pedido do popup contra o que o card tem agora no banco. Devolve o erro (texto) ou os dados. */
export function validarResultado(
  body: unknown, card: CamposDoCard, agora: Date,
): { erro: string } | { ok: ResultadoValidado } {
  if (!body || typeof body !== 'object') return { erro: 'Corpo inválido.' };
  const b = body as Record<string, unknown>;
  const texto = (k: string) => (typeof b[k] === 'string' ? (b[k] as string).trim() : '');
  const resultado = texto('resultado') as ResultadoReuniao;
  if (!(RESULTADOS_REUNIAO as readonly string[]).includes(resultado)) {
    return { erro: `"resultado" deve ser ${RESULTADOS_REUNIAO.join(', ')}.` };
  }

  if (resultado === 'compareceu') {
    const resumo = texto('resumo');
    const etapa = ETAPAS_COMPARECEU.find((e) => normalizaNome(e) === normalizaNome(texto('proxima_etapa')));
    const falta: string[] = [];
    if (resumo.length < MINIMO_RESUMO) falta.push(`resumo da reunião (mínimo ${MINIMO_RESUMO} caracteres)`);
    if (!card.numero_atendentes?.trim()) falta.push('nº de atendentes');
    if (!temDigito(card.valor_implementacao)) falta.push('valor de implementação');
    if (!temDigito(card.valor_mrr)) falta.push('valor MRR');
    if (!etapa) falta.push('próxima etapa');
    if (etapa && /proposta/i.test(etapa) && !agendamentoParaDate(card.retornar)) falta.push('data de retorno ("Retornar")');
    if (etapa && /perdido|desqualificado/i.test(etapa) && !motivoDeDesqualificacaoValido(card.motivo_desqualificacao)) {
      falta.push(`motivo (da lista, com detalhe de ${MINIMO_DETALHE_MOTIVO}+ caracteres)`);
    }
    if (falta.length) return { erro: `Falta preencher: ${falta.join(', ')}.` };
    const motivo = /perdido|desqualificado/i.test(etapa!) ? card.motivo_desqualificacao.trim() : null;
    return { ok: { resultado, resumo, proximaEtapa: etapa!, motivo, agendamentoNovo: null } };
  }

  if (resultado === 'nao_compareceu') {
    const escolhido = MOTIVOS_NAO_COMPARECEU.find((m) => m === texto('motivo'));
    if (!escolhido) return { erro: 'Escolha o motivo do não comparecimento.' };
    let motivo: string = escolhido;
    if (escolhido === 'Outro') {
      const outro = texto('motivo_outro');
      if (outro.length < 5) return { erro: 'Em "Outro", escreva o motivo (mínimo 5 caracteres).' };
      motivo = `Outro: ${outro}`;
    }
    return { ok: { resultado, resumo: texto('resumo'), proximaEtapa: 'Reunião não comparecida', motivo, agendamentoNovo: null } };
  }

  const novo = texto('agendamento_novo').slice(0, 16);
  const quando = agendamentoParaDate(novo);
  if (!quando) return { erro: 'Informe a nova data e a nova hora.' };
  if (quando.getTime() <= agora.getTime()) return { erro: 'O novo horário tem que ser no futuro.' };
  return { ok: { resultado, resumo: texto('resumo'), proximaEtapa: null, motivo: texto('motivo') || null, agendamentoNovo: novo } };
}

const reais = (centavos: string) => {
  const d = (centavos ?? '').replace(/\D/g, '');
  return d ? (parseInt(d, 10) / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }) : '—';
};

/** Texto da Atualização que fica no card. */
export function textoDaNotaDeResultado(r: ResultadoValidado, agendamento: string, card: CamposDoCard): string {
  const linhas: string[] = [];
  if (r.resultado === 'compareceu') {
    linhas.push(`Reunião realizada: o lead COMPARECEU (agendada pra ${agendamentoLegivel(agendamento)}).`);
    linhas.push(`Próxima etapa: ${r.proximaEtapa}`);
    if (/proposta/i.test(r.proximaEtapa ?? '')) linhas.push(`Retornar: ${agendamentoLegivel(card.retornar)}`);
    if (r.motivo) linhas.push(`Motivo: ${r.motivo}`);
    linhas.push(`Nº de atendentes: ${card.numero_atendentes}`);
    linhas.push(`Valor MRR: ${reais(card.valor_mrr)}`);
    linhas.push(`Valor de implementação: ${reais(card.valor_implementacao)}`);
    linhas.push('', 'Resumo da reunião:', r.resumo);
  } else if (r.resultado === 'nao_compareceu') {
    linhas.push(`Reunião de ${agendamentoLegivel(agendamento)}: o lead NÃO COMPARECEU.`);
    linhas.push(`Motivo: ${r.motivo}`);
    if (r.resumo) linhas.push('', r.resumo);
  } else {
    linhas.push(`Reunião REMARCADA: de ${agendamentoLegivel(agendamento)} para ${agendamentoLegivel(r.agendamentoNovo ?? '')}.`);
    if (r.motivo) linhas.push(`Motivo: ${r.motivo}`);
    if (r.resumo) linhas.push('', r.resumo);
  }
  return linhas.join('\n');
}

/** O que vai na Linha do tempo (to_value do evento "reuniao"). */
export function rotuloDoEvento(r: ResultadoValidado): string {
  if (r.resultado === 'compareceu') return `Compareceu · ${r.proximaEtapa}`;
  if (r.resultado === 'nao_compareceu') return 'Não compareceu';
  return `Remarcada pra ${agendamentoLegivel(r.agendamentoNovo ?? '')}`;
}

/** Primeiro link de reunião (Meet, Zoom, Teams) num texto (Atualizações/observações). */
export function linkDeReuniao(...textos: (string | null | undefined)[]): string | null {
  for (const t of textos) {
    const m = /https?:\/\/(?:meet\.google\.com|[\w.-]*zoom\.us|teams\.microsoft\.com|teams\.live\.com)\/[^\s"'<>]+/i.exec(t ?? '');
    if (m) return m[0].replace(/[).,;]+$/, '');
  }
  return null;
}
