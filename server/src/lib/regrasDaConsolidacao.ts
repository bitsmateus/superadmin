/**
 * Regras que mudam com a consolidação dos CRMs (CRM LUIS e CRM LUIS CLOSER dentro do `crm-arthur`, que passa a se
 * chamar CRM LUIS ATUALIZADO). Funções puras: quem sabe se já consolidou é lib/crmConsolidado.ts.
 */
import { primeiroNome } from './reuniaoResultado.js';
import { normalizaNome } from './normalizaNome.js';

export const PAGINA_UNIFICADA = 'crm-arthur';
export const PAGINA_CLOSER_ANTIGA = 'crm-luis-closer';

/** Onde o closer trabalha: o CRM LUIS CLOSER até a consolidação; depois, o CRM unificado. */
export const paginaDoCloserQuando = (consolidado: boolean): string => (consolidado ? PAGINA_UNIFICADA : PAGINA_CLOSER_ANTIGA);

/**
 * Cópia de "Reunião agendada" pro closer. Antes: saem do CRM ARTHUR, IA LUIZA e TUBARAO pro CRM LUIS CLOSER. Depois: o
 * próprio CRM unificado é o do closer (não copia pra si mesmo); IA LUIZA e TUBARAO copiam pra ele.
 */
export function espelhoQuando(consolidado: boolean): { origens: string[]; destino: string } {
  return consolidado
    ? { origens: ['crm-ia-luiza', 'crm-outbound'], destino: PAGINA_UNIFICADA }
    : { origens: [PAGINA_UNIFICADA, 'crm-ia-luiza', 'crm-outbound'], destino: PAGINA_CLOSER_ANTIGA };
}

/**
 * Venda nova no funil: o Luis ganha "Fechamento closer"? E o SDR ganha a comissão dele?
 *  - closer = Luis quando a lead passou pro closer (tinha cópia) ou, depois da consolidação, quando é do CRM unificado
 *    e o SDR é outra pessoa;
 *  - SDR Arthur com o Luis fechando: não se lança comissão de SDR pro Arthur (pedido de 27/11).
 */
export function comissoesDaVenda(v: { sdr: string; temCopiaNoCloser: boolean; consolidado: boolean; pagina: string }): { closerLuis: boolean; sdr: boolean } {
  const sdr = primeiroNome(v.sdr);
  const closerLuis = v.temCopiaNoCloser || (v.consolidado && v.pagina === PAGINA_UNIFICADA && !!sdr && sdr !== 'luis');
  return { closerLuis, sdr: !(closerLuis && sdr === 'arthur') };
}

/** Etapa que é do closer ("Reunião agendada" em diante), pelo nome do status ou do quadro. */
export const etapaDoCloser = (nome: string | null | undefined): boolean =>
  /^(reuniaoagendada|reuniaonaocomparecida|propostaenviada|followup.*proposta|followpropostas|vendido)/.test(normalizaNome(nome ?? ''));

/** A pessoa (pelo primeiro nome) está suspensa? Só quando há um usuário suspenso com esse nome e nenhum ativo. */
export function nomeSuspenso(nome: string, perfis: { name: string | null; suspensa: boolean }[]): boolean {
  const p = primeiroNome(nome);
  if (!p) return false;
  const doNome = perfis.filter((x) => primeiroNome(x.name) === p);
  return doNome.some((x) => x.suspensa) && !doNome.some((x) => !x.suspensa);
}
