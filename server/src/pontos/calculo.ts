/**
 * Regras de cálculo do ponto (Financeiro > Pontos). Funções puras: recebem batidas, configuração do colaborador,
 * feriados e ajustes, e devolvem o dia a dia e o resumo. Nada aqui lê ou grava no banco (testes: calculo.test.ts).
 *
 * Convenções:
 *  - horário em minutos desde 00:00 do dia de trabalho; batida depois da meia-noite que fecha o turno vira 24h+ (ex.:
 *    "26:10" = 02:10 do dia seguinte, ainda do mesmo dia de trabalho);
 *  - datas "AAAA-MM-DD"; dia da semana 0 = domingo … 6 = sábado;
 *  - dinheiro em centavos.
 */

export type DestinoExtra = 'banco' | 'pagamento';

export type TipoAjuste =
  | 'abonar_atraso' | 'abonar_falta' | 'justificar' | 'folga' | 'compensacao' | 'feriado'
  | 'perdoar_desconto' | 'extra_banco' | 'extra_pagamento' | 'corrigir_batidas';

export const TIPOS_DE_AJUSTE: TipoAjuste[] = [
  'abonar_atraso', 'abonar_falta', 'justificar', 'folga', 'compensacao', 'feriado',
  'perdoar_desconto', 'extra_banco', 'extra_pagamento', 'corrigir_batidas',
];

export interface ConfigColaborador {
  diasSemana: number[];
  minutosDia: number;
  minutosSabado: number;
  minutosDomingo: number;
  entradaPrevista: string;
  saidaPrevista: string;
  intervaloMinutos: number;
  toleranciaMinutos: number;
  salarioBaseCentavos: number;
  divisorMensal: number;
  valorHoraCentavos: number | null;
  pctExtraUtil: number;
  pctExtraDomingoFeriado: number;
  destinoExtra: DestinoExtra;
}

export interface AjusteDoDia {
  tipo: TipoAjuste;
  /** corrigir_batidas: horários que valem no lugar das batidas originais. */
  batidas?: string[] | null;
}

export type StatusDia = 'normal' | 'falta' | 'atraso' | 'extra' | 'folga' | 'abonado' | 'feriado' | 'incompleto' | 'sem_registro';

export interface DiaCalculado {
  data: string;
  diaSemana: number;
  /** Batidas originais da planilha (já com a virada da meia-noite resolvida). */
  batidasOriginais: string[];
  /** As que valem no cálculo (as originais, ou as da correção manual). */
  batidas: string[];
  previstoMinutos: number;
  trabalhadoMinutos: number;
  atrasoMinutos: number;
  saidaAntecipadaMinutos: number;
  faltaMinutos: number;
  extraMinutos: number;
  extraDestino: DestinoExtra;
  pctExtra: number;
  /** Efeito do dia no banco de horas (minutos; negativo = deve). */
  saldoMinutos: number;
  descontoCentavos: number;
  valorExtraCentavos: number;
  feriado: string | null;
  status: StatusDia;
  avisos: string[];
  ajustes: TipoAjuste[];
}

export interface ResumoPeriodo {
  trabalhadoMinutos: number;
  previstoMinutos: number;
  extraMinutos: number;
  extraBancoMinutos: number;
  extraPagamentoMinutos: number;
  atrasoMinutos: number;
  saidaAntecipadaMinutos: number;
  faltaMinutos: number;
  faltas: number;
  saldoMinutos: number;
  descontoCentavos: number;
  valorExtraCentavos: number;
}

// ───────────────────────────── horários e datas ─────────────────────────────

/** "08:05" -> 485; "26:10" -> 1570. Inválido -> null. */
export function paraMinutos(hora: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(hora ?? '').trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (min > 59 || h > 47) return null;
  return h * 60 + min;
}

/** 485 -> "08:05"; 1570 -> "26:10". */
export function paraHora(minutos: number): string {
  const h = Math.floor(minutos / 60);
  const m = minutos % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

export function diaDaSemana(data: string): number {
  return new Date(`${data}T12:00:00Z`).getUTCDay();
}

export function somarDias(data: string, n: number): string {
  const d = new Date(`${data}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function datasEntre(inicio: string, fim: string): string[] {
  const out: string[] = [];
  for (let d = inicio; d <= fim; d = somarDias(d, 1)) out.push(d);
  return out;
}

/** Valor da hora em centavos: o informado direto, ou salário ÷ divisor mensal. */
export function valorHora(cfg: ConfigColaborador): number {
  if (cfg.valorHoraCentavos != null && cfg.valorHoraCentavos > 0) return cfg.valorHoraCentavos;
  if (!cfg.divisorMensal || cfg.divisorMensal <= 0) return 0;
  return Math.round(cfg.salarioBaseCentavos / cfg.divisorMensal);
}

/**
 * Virada da meia-noite: a batida da madrugada (antes das 06:00) que FECHA um turno aberto do dia anterior (que ficou
 * com número ímpar de batidas) passa a ser do dia anterior, como 24h+ (02:10 -> "26:10"). Recebe e devolve
 * data -> horários.
 */
export const LIMITE_MADRUGADA = 6 * 60;
export function resolverViradaDeDia(porData: Map<string, string[]>): Map<string, string[]> {
  const datas = [...porData.keys()].sort();
  const out = new Map<string, number[]>();
  for (const d of datas) {
    out.set(d, (porData.get(d) ?? []).map(paraMinutos).filter((m): m is number => m !== null).sort((a, b) => a - b));
  }
  for (const d of datas) {
    const hoje = out.get(d)!;
    const amanhaData = somarDias(d, 1);
    const amanha = out.get(amanhaData);
    if (!amanha || !amanha.length || hoje.length % 2 === 0) continue;
    const primeira = amanha[0];
    if (primeira < LIMITE_MADRUGADA && hoje[hoje.length - 1] > primeira) {
      hoje.push(primeira + 24 * 60);
      amanha.shift();
    }
  }
  const final = new Map<string, string[]>();
  for (const [d, mins] of out) final.set(d, mins.map(paraHora));
  return final;
}

// ───────────────────────────── um dia ─────────────────────────────

export interface EntradaDoDia {
  data: string;
  batidas: string[];
  cfg: ConfigColaborador;
  /** Nome do feriado (tabela de feriados), se for. */
  feriado?: string | null;
  ajustes?: AjusteDoDia[];
  /** O dia está dentro de um período que alguma planilha importou? Fora disso, dia sem batida não é falta. */
  coberto: boolean;
  /** "Hoje" (AAAA-MM-DD): dia futuro nunca é falta. */
  hoje?: string;
}

function previstoDoDia(cfg: ConfigColaborador, dow: number): number {
  if (!cfg.diasSemana.includes(dow)) return 0;
  if (dow === 6) return cfg.minutosSabado;
  if (dow === 0) return cfg.minutosDomingo || cfg.minutosDia;
  return cfg.minutosDia;
}

export function calcularDia(e: EntradaDoDia): DiaCalculado {
  const { cfg } = e;
  const ajustes = e.ajustes ?? [];
  const tem = (t: TipoAjuste) => ajustes.some((a) => a.tipo === t);
  const correcao = [...ajustes].reverse().find((a) => a.tipo === 'corrigir_batidas' && Array.isArray(a.batidas));
  const dow = diaDaSemana(e.data);
  const tol = Math.max(0, cfg.toleranciaMinutos);
  const avisos: string[] = [];

  const originais = [...e.batidas];
  const efetivas = (correcao ? (correcao.batidas ?? []) : originais)
    .map(paraMinutos).filter((m): m is number => m !== null).sort((a, b) => a - b);

  const feriadoNome = e.feriado ?? (tem('feriado') ? 'Feriado (ajuste)' : null);
  const folga = tem('folga');
  const compensacao = tem('compensacao');
  const naoTrabalha = !!feriadoNome || folga;
  const previsto = naoTrabalha ? 0 : previstoDoDia(cfg, dow);

  // Horas trabalhadas: pares entrada/saída. Batida sobrando (ímpar) fica fora da conta.
  let trabalhado = 0;
  for (let i = 0; i + 1 < efetivas.length; i += 2) trabalhado += efetivas[i + 1] - efetivas[i];
  const incompleto = efetivas.length % 2 === 1;
  if (incompleto) avisos.push('Dia sem saída (número ímpar de batidas): a última batida ficou fora da conta.');
  // Só entrada e saída, sem a batida do almoço, numa jornada de mais de 6h: desconta o intervalo previsto (senão o
  // almoço vira hora trabalhada).
  if (efetivas.length === 2 && trabalhado > 6 * 60 && cfg.intervaloMinutos > 0) {
    trabalhado -= cfg.intervaloMinutos;
    avisos.push(`Sem batida de almoço: descontado o intervalo previsto (${cfg.intervaloMinutos} min).`);
  }

  // Atraso e saída antecipada: só em dia previsto, com batidas. Passou da tolerância = conta o atraso inteiro.
  const entradaPrev = paraMinutos(cfg.entradaPrevista) ?? 0;
  const saidaPrev = dow === 6 || dow === 0 ? entradaPrev + previsto : (paraMinutos(cfg.saidaPrevista) ?? entradaPrev + previsto);
  let atraso = 0;
  let saidaAntecipada = 0;
  if (previsto > 0 && efetivas.length > 0 && !compensacao) {
    const d = efetivas[0] - entradaPrev;
    if (d > tol) atraso = d;
    if (!incompleto && efetivas.length >= 2) {
      const s = saidaPrev - efetivas[efetivas.length - 1];
      if (s > tol) saidaAntecipada = s;
    }
  }
  if (tem('abonar_atraso')) { atraso = 0; saidaAntecipada = 0; }

  // Falta: dia previsto, sem nenhuma batida, coberto por importação, que já passou.
  const passou = !e.hoje || e.data <= e.hoje;
  let falta = previsto > 0 && efetivas.length === 0 && e.coberto && passou && !compensacao ? previsto : 0;
  if (tem('abonar_falta')) falta = 0;

  // Hora extra: o que passou da jornada (acima da tolerância). Dia sem jornada prevista: tudo o que trabalhou.
  const domingoOuFeriado = dow === 0 || !!feriadoNome;
  const pctExtra = domingoOuFeriado ? cfg.pctExtraDomingoFeriado : cfg.pctExtraUtil;
  const excedente = trabalhado - previsto;
  const extra = previsto === 0 ? trabalhado : (excedente > tol ? excedente : 0);
  const destino: DestinoExtra = tem('extra_pagamento') ? 'pagamento' : tem('extra_banco') ? 'banco' : cfg.destinoExtra;

  // Banco de horas do dia: extra que vai pro banco (+) menos atraso, saída antecipada e falta (−). Compensação: o dia
  // de folga sai do banco.
  let saldo = (destino === 'banco' ? extra : 0) - atraso - saidaAntecipada - falta;
  if (compensacao) saldo -= previstoDoDia(cfg, dow);

  const vh = valorHora(cfg);
  const descontoBase = Math.round(((atraso + saidaAntecipada + falta) * vh) / 60);
  const desconto = tem('perdoar_desconto') ? 0 : descontoBase;
  const valorExtra = destino === 'pagamento' ? Math.round(((extra * vh) / 60) * (1 + pctExtra / 100)) : 0;

  const abonado = tem('abonar_atraso') || tem('abonar_falta');
  let status: StatusDia;
  if (feriadoNome && efetivas.length === 0) status = 'feriado';
  else if ((folga || compensacao) && efetivas.length === 0) status = 'folga';
  else if (falta > 0) status = 'falta';
  else if (abonado && efetivas.length === 0) status = 'abonado';
  else if (atraso > 0 || saidaAntecipada > 0) status = 'atraso';
  else if (extra > 0) status = 'extra';
  else if (abonado) status = 'abonado';
  else if (incompleto) status = 'incompleto';
  else if (efetivas.length === 0 && previsto === 0) status = 'folga';
  else if (efetivas.length === 0) status = 'sem_registro';
  else status = 'normal';

  return {
    data: e.data,
    diaSemana: dow,
    batidasOriginais: originais,
    batidas: efetivas.map(paraHora),
    previstoMinutos: previsto,
    trabalhadoMinutos: trabalhado,
    atrasoMinutos: atraso,
    saidaAntecipadaMinutos: saidaAntecipada,
    faltaMinutos: falta,
    extraMinutos: extra,
    extraDestino: destino,
    pctExtra,
    saldoMinutos: saldo,
    descontoCentavos: desconto,
    valorExtraCentavos: valorExtra,
    feriado: feriadoNome,
    status,
    avisos,
    ajustes: ajustes.map((a) => a.tipo),
  };
}

// ───────────────────────────── período ─────────────────────────────

export interface EntradaDoPeriodo {
  inicio: string;
  fim: string;
  cfg: ConfigColaborador;
  /** data -> horários (como vieram da planilha; a virada da meia-noite é resolvida aqui). */
  batidas: Map<string, string[]>;
  feriados: Map<string, string>;
  ajustes: Map<string, AjusteDoDia[]>;
  /** Dias cobertos por alguma importação (Set de datas). */
  cobertos: Set<string>;
  hoje?: string;
}

export function calcularPeriodo(e: EntradaDoPeriodo): { dias: DiaCalculado[]; resumo: ResumoPeriodo } {
  // Resolve a virada com um dia de folga dos dois lados (a madrugada do dia seguinte ao fim fecha o último turno).
  const ampliado = new Map<string, string[]>();
  for (const [d, hs] of e.batidas) if (d >= somarDias(e.inicio, -1) && d <= somarDias(e.fim, 1)) ampliado.set(d, hs);
  const resolvido = resolverViradaDeDia(ampliado);
  const dias = datasEntre(e.inicio, e.fim).map((data) => calcularDia({
    data,
    batidas: resolvido.get(data) ?? [],
    cfg: e.cfg,
    feriado: e.feriados.get(data) ?? null,
    ajustes: e.ajustes.get(data) ?? [],
    coberto: e.cobertos.has(data),
    hoje: e.hoje,
  }));
  return { dias, resumo: resumir(dias) };
}

export function resumir(dias: DiaCalculado[]): ResumoPeriodo {
  const r: ResumoPeriodo = {
    trabalhadoMinutos: 0, previstoMinutos: 0, extraMinutos: 0, extraBancoMinutos: 0, extraPagamentoMinutos: 0,
    atrasoMinutos: 0, saidaAntecipadaMinutos: 0, faltaMinutos: 0, faltas: 0, saldoMinutos: 0, descontoCentavos: 0,
    valorExtraCentavos: 0,
  };
  for (const d of dias) {
    r.trabalhadoMinutos += d.trabalhadoMinutos;
    r.previstoMinutos += d.previstoMinutos;
    r.extraMinutos += d.extraMinutos;
    if (d.extraDestino === 'banco') r.extraBancoMinutos += d.extraMinutos;
    else r.extraPagamentoMinutos += d.extraMinutos;
    r.atrasoMinutos += d.atrasoMinutos;
    r.saidaAntecipadaMinutos += d.saidaAntecipadaMinutos;
    r.faltaMinutos += d.faltaMinutos;
    if (d.faltaMinutos > 0) r.faltas += 1;
    r.saldoMinutos += d.saldoMinutos;
    r.descontoCentavos += d.descontoCentavos;
    r.valorExtraCentavos += d.valorExtraCentavos;
  }
  return r;
}

/** "-90" -> "-1h30"; 45 -> "0h45". */
export function formatarMinutos(min: number): string {
  const sinal = min < 0 ? '-' : '';
  const a = Math.abs(Math.round(min));
  return `${sinal}${Math.floor(a / 60)}h${String(a % 60).padStart(2, '0')}`;
}
