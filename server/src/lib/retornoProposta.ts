import { normalizaNome } from './normalizaNome.js';
import { MINIMO_DETALHE_MOTIVO, MOTIVOS_DESQUALIFICACAO } from './trafegoNicho.js';
import { agendamentoLegivel, agendamentoParaDate, dateParaAgendamento } from './reuniaoResultado.js';

/**
 * Retorno da proposta (popup obrigatório do closer). Card do CRM LUIS CLOSER em "Proposta enviada" ou "Follow-up
 * Propostas" com o "Retornar" já vencido e sem "retornado" vira pendência do dono do CRM do closer. Nada de campo
 * novo no card: o que ele responde vai pras Atualizações e pra Linha do tempo (evento "retorno"), e é da Linha do
 * tempo que saem as contas de tentativas sem resposta e de adiamentos. Funções puras.
 */

export const PAGINA_DO_CLOSER = 'crm-luis-closer';
export const RESULTADOS_RETORNO = ['retornou', 'sem_resposta', 'adiar'] as const;
export type ResultadoRetorno = (typeof RESULTADOS_RETORNO)[number];
export const DESFECHOS = ['fechou', 'negociando', 'perdeu'] as const;
export type Desfecho = (typeof DESFECHOS)[number];

export const MINIMO_OBSERVACAO_RETORNO = 20;
export const MINIMO_OBSERVACAO_TENTATIVA = 10;
export const MINIMO_MOTIVO_ADIAR = 10;
export const MAXIMO_ADIAMENTOS = 2;
/** Na 3ª tentativa sem resposta, sugere mandar pro Follow-up Propostas (a régua do n8n assume). */
export const TENTATIVAS_PRA_FOLLOW_UP = 3;

/** O quadro do card é de proposta? ("Proposta enviada" / "Proposta Enviada", "Follow-up Propostas" / "FOLLOW UP…"). */
export function ehQuadroDeProposta(nomeDoQuadro: string): boolean {
  const n = normalizaNome(nomeDoQuadro);
  return n.startsWith('propostaenviada') || n.startsWith('followuppropostas') || n.startsWith('followuproposta');
}

/** Rótulo do evento "retorno" na Linha do tempo — é por ele que as tentativas e os adiamentos são contados. */
export const ROTULO_RETORNOU = 'Retornou';
export const ROTULO_SEM_RESPOSTA = 'Sem resposta';
export const ROTULO_ADIADO = 'Adiado';
export const ROTULO_EM_REUNIAO = 'Em reunião';

/** "Estou em reunião": tira o popup por 1h, no máximo 2 vezes por retorno (zera quando ele registra o retorno). */
export const MAXIMO_EM_REUNIAO = 2;
export const SONECA_EM_REUNIAO_MS = 60 * 60_000;

/**
 * Conta, nos eventos "retorno" da lead (mais novo primeiro): os adiamentos seguidos desde o último retorno de verdade,
 * e as tentativas sem resposta desde a última vez que ele falou com o cliente.
 */
export function contarHistorico(eventosMaisNovoPrimeiro: string[]): { adiamentos: number; tentativas: number } {
  let adiamentos = 0;
  for (const e of eventosMaisNovoPrimeiro) {
    if (e.startsWith(ROTULO_EM_REUNIAO)) continue;
    if (e.startsWith(ROTULO_ADIADO)) adiamentos++;
    else break;
  }
  let tentativas = 0;
  for (const e of eventosMaisNovoPrimeiro) {
    if (e.startsWith(ROTULO_RETORNOU)) break;
    if (e.startsWith(ROTULO_SEM_RESPOSTA)) tentativas++;
  }
  return { adiamentos, tentativas };
}

export interface RetornoValidado {
  resultado: ResultadoRetorno;
  observacao: string;
  desfecho: Desfecho | null;
  /** Novo "Retornar" (formato da ficha), quando a opção pede. */
  retornarNovo: string | null;
  /** "<Motivo>: <detalhe>" do Perdido. */
  motivoPerda: string | null;
  /** Só no Fechou: os valores que vão pro card (o Vendido exige). */
  valorMrr: string | null;
  valorImplementacao: string | null;
  origem: string | null;
  /** Sem resposta na 3ª tentativa: manda pro Follow-up Propostas. */
  moverProFollowUp: boolean;
}

const texto = (b: Record<string, unknown>, k: string) => (typeof b[k] === 'string' ? (b[k] as string).trim() : '');

function novoRetorno(b: Record<string, unknown>, agora: Date): { valor: string } | { erro: string } {
  const v = texto(b, 'retornar_novo').slice(0, 16);
  const d = agendamentoParaDate(v);
  if (!d) return { erro: 'Informe a nova data e hora de retorno.' };
  if (d.getTime() <= agora.getTime()) return { erro: 'O novo retorno tem que ser no futuro.' };
  return { valor: v };
}

/** Valida o pedido do popup. `historico` vem da Linha do tempo da lead (contarHistorico). */
export function validarRetorno(
  body: unknown, agora: Date, historico: { adiamentos: number; tentativas: number },
): { erro: string } | { ok: RetornoValidado } {
  if (!body || typeof body !== 'object') return { erro: 'Corpo inválido.' };
  const b = body as Record<string, unknown>;
  const resultado = texto(b, 'resultado') as ResultadoRetorno;
  if (!(RESULTADOS_RETORNO as readonly string[]).includes(resultado)) {
    return { erro: `"resultado" deve ser ${RESULTADOS_RETORNO.join(', ')}.` };
  }
  const observacao = texto(b, 'observacao');
  const base: RetornoValidado = {
    resultado, observacao, desfecho: null, retornarNovo: null, motivoPerda: null,
    valorMrr: null, valorImplementacao: null, origem: null, moverProFollowUp: false,
  };

  if (resultado === 'retornou') {
    if (observacao.length < MINIMO_OBSERVACAO_RETORNO) {
      return { erro: `Escreva o que foi conversado (mínimo ${MINIMO_OBSERVACAO_RETORNO} caracteres).` };
    }
    const desfecho = texto(b, 'desfecho') as Desfecho;
    if (!(DESFECHOS as readonly string[]).includes(desfecho)) return { erro: 'Escolha como ficou: fechou, ainda negociando ou perdeu.' };
    if (desfecho === 'negociando') {
      const n = novoRetorno(b, agora);
      if ('erro' in n) return n;
      return { ok: { ...base, desfecho, retornarNovo: n.valor } };
    }
    if (desfecho === 'perdeu') {
      const motivo = texto(b, 'motivo');
      const detalhe = texto(b, 'motivo_detalhe');
      if (!(MOTIVOS_DESQUALIFICACAO as readonly string[]).includes(motivo)) return { erro: 'Escolha o motivo da perda.' };
      if (detalhe.length < MINIMO_DETALHE_MOTIVO) return { erro: `Detalhe o motivo (mínimo ${MINIMO_DETALHE_MOTIVO} caracteres).` };
      return { ok: { ...base, desfecho, motivoPerda: `${motivo}: ${detalhe}` } };
    }
    // Fechou: o Vendido exige MRR, implementação e origem — vêm do popup (preenchidos com o que o card já tem).
    const mrr = texto(b, 'valor_mrr');
    const impl = texto(b, 'valor_implementacao');
    const origem = texto(b, 'origem');
    if (!/\d/.test(mrr)) return { erro: 'Informe o valor MRR fechado.' };
    if (!/\d/.test(impl)) return { erro: 'Informe o valor de implementação fechado (R$ 0,00 também vale).' };
    if (!origem) return { erro: 'Informe a origem do lead.' };
    return { ok: { ...base, desfecho, valorMrr: mrr, valorImplementacao: impl, origem } };
  }

  if (resultado === 'sem_resposta') {
    if (observacao.length < MINIMO_OBSERVACAO_TENTATIVA) {
      return { erro: `Diga por onde tentou (mínimo ${MINIMO_OBSERVACAO_TENTATIVA} caracteres).` };
    }
    const n = novoRetorno(b, agora);
    if ('erro' in n) return n;
    const ehAUltima = historico.tentativas + 1 >= TENTATIVAS_PRA_FOLLOW_UP;
    return { ok: { ...base, retornarNovo: n.valor, moverProFollowUp: ehAUltima && b.mover_follow_up === true } };
  }

  // Adiar.
  if (historico.adiamentos >= MAXIMO_ADIAMENTOS) {
    return { erro: `Esse retorno já foi adiado ${MAXIMO_ADIAMENTOS} vezes: agora é retornar ou registrar a tentativa.` };
  }
  if (observacao.length < MINIMO_MOTIVO_ADIAR) return { erro: `Diga por que vai adiar (mínimo ${MINIMO_MOTIVO_ADIAR} caracteres).` };
  const n = novoRetorno(b, agora);
  if ('erro' in n) return n;
  return { ok: { ...base, retornarNovo: n.valor } };
}

const DESFECHO_LEGIVEL: Record<Desfecho, string> = { fechou: 'FECHOU', negociando: 'ainda negociando', perdeu: 'PERDEU' };

/** Texto da Atualização do card (fica tudo aqui, sem campo novo). */
export function textoDaNotaDeRetorno(r: RetornoValidado, retornarAntigo: string, tentativaDeAgora: number): string {
  const previsto = agendamentoLegivel(retornarAntigo);
  const linhas: string[] = [];
  if (r.resultado === 'retornou') {
    linhas.push(`Retorno da proposta (previsto pra ${previsto}): falei com o cliente, ${DESFECHO_LEGIVEL[r.desfecho!]}.`);
    if (r.desfecho === 'negociando') linhas.push(`Próximo retorno: ${agendamentoLegivel(r.retornarNovo!)}`);
    if (r.desfecho === 'perdeu') linhas.push(`Motivo: ${r.motivoPerda}`);
    if (r.desfecho === 'fechou') linhas.push(`Valor MRR: ${r.valorMrr}`, `Valor de implementação: ${r.valorImplementacao}`);
    linhas.push('', 'O que foi conversado:', r.observacao);
  } else if (r.resultado === 'sem_resposta') {
    linhas.push(`Retorno da proposta (previsto pra ${previsto}): tentei, o cliente NÃO RESPONDEU (${tentativaDeAgora}ª tentativa).`);
    linhas.push(`Por onde tentei: ${r.observacao}`);
    linhas.push(`Próximo retorno: ${agendamentoLegivel(r.retornarNovo!)}`);
    if (r.moverProFollowUp) linhas.push('Foi pro Follow-up Propostas (a régua de follow-up assume).');
  } else {
    linhas.push(`Retorno da proposta ADIADO: de ${previsto} para ${agendamentoLegivel(r.retornarNovo!)}.`);
    linhas.push(`Motivo: ${r.observacao}`);
  }
  return linhas.join('\n');
}

/** O que vai na Linha do tempo (evento "retorno") — começa com o rótulo que contarHistorico lê. */
export function rotuloDoEventoDeRetorno(r: RetornoValidado, tentativaDeAgora: number): string {
  if (r.resultado === 'retornou') return `${ROTULO_RETORNOU} · ${DESFECHO_LEGIVEL[r.desfecho!]}`;
  if (r.resultado === 'sem_resposta') return `${ROTULO_SEM_RESPOSTA} · ${tentativaDeAgora}ª tentativa`;
  return `${ROTULO_ADIADO} pra ${agendamentoLegivel(r.retornarNovo!)}`;
}

/**
 * Os "Estou em reunião" do retorno de agora (mais novo primeiro): os seguidos desde o último registro de verdade, e até
 * quando o popup fica escondido (1h depois do último).
 */
export function estadoEmReuniao(
  eventosMaisNovoPrimeiro: { to_value: string; created_at: Date }[], agora: Date,
): { usados: number; escondidoAte: Date | null } {
  let usados = 0;
  for (const e of eventosMaisNovoPrimeiro) {
    if (e.to_value.startsWith(ROTULO_EM_REUNIAO)) usados++;
    else break;
  }
  if (!usados) return { usados, escondidoAte: null };
  const ate = new Date(new Date(eventosMaisNovoPrimeiro[0].created_at).getTime() + SONECA_EM_REUNIAO_MS);
  return { usados, escondidoAte: ate.getTime() > agora.getTime() ? ate : null };
}

/** Evento da Linha do tempo do "Estou em reunião" — começa com o rótulo que estadoEmReuniao lê. */
export function rotuloDoEventoEmReuniao(vez: number, voltaAs: Date): string {
  return `${ROTULO_EM_REUNIAO} · ${vez}ª vez, volta às ${dateParaAgendamento(voltaAs).slice(11, 16)}`;
}
