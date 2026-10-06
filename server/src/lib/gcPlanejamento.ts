/**
 * Planejamento do cliente (módulo "Clientes NX Digital") — lado servidor.
 *
 * Aqui só o que o servidor precisa: o ponto de partida de cada métrica (pra preencher a base das
 * metas novas) e o diff de uma alteração (pro histórico). A projeção mês a mês e a validação de
 * realismo moram no front (src/lib/gcPlanejamento.ts), onde são exibidas.
 */

export const CHAVES_PLANEJAMENTO = ['leads', 'cpl', 'vendas', 'roas', 'receita', 'investimento'] as const;
export type ChavePlanejamento = (typeof CHAVES_PLANEJAMENTO)[number];
/**
 * As quatro metas que se DIGITAM na grade de 6 e 12 meses. CPL e ROAS são calculados (investimento ÷
 * leads, faturamento ÷ investimento) e não se guardam: guardar duplicaria o número e abriria a porta
 * pra os três divergirem.
 */
export const CHAVES_DIGITADAS = ['leads', 'vendas', 'investimento', 'receita'] as const;
export const HORIZONTES_PLANEJAMENTO = ['6_meses', '12_meses'] as const;
export type HorizontePlanejamento = (typeof HORIZONTES_PLANEJAMENTO)[number];

/** Os 4 números do ponto A. Ticket médio e conversão saem daqui (ver `derivadosDoPontoA`). */
export interface PontoA {
  leads_mes: number | null;
  investimento_mes: number | null;
  vendas_mes: number | null;
  faturamento_mensal: number | null;
}

/** Ticket médio (faturamento ÷ vendas) e conversão em % (vendas ÷ leads); null sem os dois números. */
export function derivadosDoPontoA(a: PontoA): { ticket_medio: number | null; taxa_conversao: number | null } {
  const arredonda = (n: number) => Math.round(n * 100) / 100;
  return {
    ticket_medio:
      a.faturamento_mensal !== null && a.vendas_mes ? arredonda(a.faturamento_mensal / a.vendas_mes) : null,
    taxa_conversao:
      a.vendas_mes !== null && a.leads_mes ? arredonda((a.vendas_mes / a.leads_mes) * 100) : null,
  };
}

/**
 * O valor de cada métrica no ponto A. CPL, vendas e ROAS são DERIVADOS dos números fixos — quem
 * preenche o diagnóstico informa leads, investimento, conversão e faturamento, não os quatro mais
 * as três contas feitas à mão.
 */
export function baseDoPontoA(a: PontoA): Partial<Record<ChavePlanejamento, number>> {
  const base: Partial<Record<ChavePlanejamento, number>> = {};
  if (a.leads_mes !== null) base.leads = a.leads_mes;
  if (a.investimento_mes !== null) base.investimento = a.investimento_mes;
  if (a.faturamento_mensal !== null) base.receita = a.faturamento_mensal;
  if (a.leads_mes && a.investimento_mes !== null) base.cpl = a.investimento_mes / a.leads_mes;
  if (a.vendas_mes !== null) base.vendas = a.vendas_mes;
  if (a.investimento_mes && a.faturamento_mensal !== null) {
    base.roas = a.faturamento_mensal / a.investimento_mes;
  }
  return base;
}

/** Soma `meses` a uma data 'YYYY-MM-DD' (o dia é preservado, ou o último do mês se não existir). */
export function somarMesesNaData(data: string, meses: number): string {
  const [ano, mes, dia] = data.slice(0, 10).split('-').map(Number);
  const alvo = new Date(Date.UTC(ano, mes - 1 + meses, 1));
  const ultimo = new Date(Date.UTC(alvo.getUTCFullYear(), alvo.getUTCMonth() + 1, 0)).getUTCDate();
  alvo.setUTCDate(Math.min(dia, ultimo));
  return alvo.toISOString().slice(0, 10);
}

export const ROTULOS_PLANEJAMENTO: Record<string, string> = {
  situacao_atual: 'Situação de hoje',
  vendas_mes: 'Vendas/mês (ponto A)',
  aguardando_cliente: 'Aguardando o cliente',
  lembrar_em: 'Lembrar de completar em',
  leads_mes: 'Leads/mês (ponto A)',
  investimento_mes: 'Investimento/mês (ponto A)',
  ticket_medio: 'Ticket médio (ponto A)',
  taxa_conversao: 'Taxa de conversão (ponto A)',
  faturamento_mensal: 'Faturamento mensal (ponto A)',
  data_diagnostico: 'Data do diagnóstico',
  origem_leads_mes: 'Origem de leads/mês',
  origem_investimento_mes: 'Origem de investimento/mês',
  origem_vendas_mes: 'Origem de vendas/mês',
  origem_faturamento_mensal: 'Origem de faturamento mensal',
  curva: 'Curva de crescimento',
  portal_ativo: 'Mostrar "Nossa jornada" no portal',
  portal_mostrar_situacao: 'Portal: mostrar a situação de hoje',
  portal_mostrar_objetivo: 'Portal: mostrar "onde quer chegar"',
  onde_quer_chegar: 'Onde quer chegar',
  estrategia: 'Estratégia e premissas',
  leads: 'Meta de leads',
  cpl: 'Meta de CPL',
  vendas: 'Meta de vendas',
  roas: 'Meta de ROAS',
  receita: 'Meta de faturamento',
  investimento: 'Meta de investimento',
};

export interface Mudanca {
  /** 'atual', '6_meses' ou '12_meses' — a parte do planejamento que mudou. */
  escopo: string;
  campo: string;
  rotulo: string;
  antes: string | number | boolean | null;
  depois: string | number | boolean | null;
}

type Valor = string | number | boolean | null;

/** Dois valores são "o mesmo" pro histórico? Texto compara aparado; número, como número. */
function iguais(a: Valor, b: Valor): boolean {
  if (a === b) return true;
  if (a === null || b === null) return (a ?? '') === '' && (b ?? '') === '';
  if (typeof a === 'number' || typeof b === 'number') return Number(a) === Number(b);
  return String(a).trim() === String(b).trim();
}

/** Lista só o que MUDOU entre dois pacotes de campos do mesmo escopo. */
export function diffDeCampos(
  escopo: string,
  antes: Record<string, Valor>,
  depois: Record<string, Valor>
): Mudanca[] {
  const mudancas: Mudanca[] = [];
  for (const campo of Object.keys(depois)) {
    const a = antes[campo] ?? null;
    const d = depois[campo] ?? null;
    if (iguais(a, d)) continue;
    mudancas.push({ escopo, campo, rotulo: ROTULOS_PLANEJAMENTO[campo] ?? campo, antes: a, depois: d });
  }
  return mudancas;
}

export const CAMPOS_COM_ORIGEM = ['leads_mes', 'investimento_mes', 'vendas_mes', 'faturamento_mensal'] as const;

export interface OrigemDoCampo {
  origem: 'calculado' | 'informado';
  /** Meses ('YYYY-MM') cuja média gerou o número, quando calculado. */
  meses?: string[];
}

/** Aceita só o formato conhecido: o que vem da tela não pode gravar lixo arbitrário no JSON. */
export function sanearOrigens(bruto: unknown): Record<string, OrigemDoCampo> {
  const saida: Record<string, OrigemDoCampo> = {};
  if (!bruto || typeof bruto !== 'object') return saida;
  for (const campo of CAMPOS_COM_ORIGEM) {
    const o = (bruto as Record<string, unknown>)[campo];
    if (!o || typeof o !== 'object') continue;
    const origem = (o as { origem?: unknown }).origem;
    if (origem !== 'calculado' && origem !== 'informado') continue;
    const meses = (o as { meses?: unknown }).meses;
    saida[campo] = {
      origem,
      ...(origem === 'calculado' && Array.isArray(meses)
        ? { meses: meses.filter((m): m is string => typeof m === 'string' && /^\d{4}-\d{2}$/.test(m)).slice(0, 12) }
        : {}),
    };
  }
  return saida;
}
