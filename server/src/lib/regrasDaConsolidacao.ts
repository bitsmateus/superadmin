/**
 * Regras que mudam com a consolidação dos CRMs (CRM LUIS e CRM LUIS CLOSER dentro do `crm-arthur`, que passa a se
 * chamar CRM LUIS ATUALIZADO). Funções puras: quem sabe se já consolidou é lib/crmConsolidado.ts.
 */
import { primeiroNome } from './reuniaoResultado.js';
import { normalizaNome } from './normalizaNome.js';

export const PAGINA_UNIFICADA = 'crm-arthur';
export const PAGINA_CLOSER_ANTIGA = 'crm-luis-closer';
/** As abas que foram pro CRM unificado (CRM LUIS e CRM LUIS CLOSER): depois de consolidar, só ficam de histórico. */
export const ABAS_SUBSTITUIDAS = ['crm-luis-2', PAGINA_CLOSER_ANTIGA];
/** delete_reason dos cards juntados na consolidação (seguido do id do card que ficou). */
export const MOTIVO_DA_CONSOLIDACAO = 'Consolidação dos CRMs: juntado no card';

/**
 * SQL: o card (alias `r`) está congelado — arquivado pela consolidação, ou numa aba arquivada. Fica só de histórico:
 * nenhuma automação (cópia do closer, propagação de edição, contagem de notas, excluir/restaurar em família) escreve nele.
 */
export const sqlCardCongelado = (r: string): string =>
  `(COALESCE(${r}.delete_reason, '') LIKE '${MOTIVO_DA_CONSOLIDACAO}%'
    OR EXISTS (SELECT 1 FROM lead_boards cb JOIN lead_pages cp ON cp.id = cb.page
               WHERE cb.id = ${r}.board_id AND cp.archived_at IS NOT NULL))`;

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
