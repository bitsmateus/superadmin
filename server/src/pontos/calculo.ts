/**
 * Regras de cálculo do ponto (Financeiro > Pontos). Funções puras: recebem batidas, configuração do colaborador,
 * feriados, turnos e ajustes, e devolvem o dia a dia e o resumo. Nada aqui lê ou grava no banco (testes: calculo.test.ts).
 *
 * Regras (resumo):
 *  - saldo do dia = trabalhado − previsto; o almoço (12:00 às 13:30) não conta como trabalho nem como extra;
 *    tolerância de 10 min POR PERÍODO (manhã e tarde) pra atraso e saída antecipada: passou de 10 conta inteiro;
 *    hora extra: de manhã a partir de 10 min antes do horário (07:50; antes disso não conta) e à tarde tudo o que
 *    passar das 18:00
 *    (sem o desenho manhã/tarde, a tolerância vale sobre o saldo do dia, pros dois lados);
 *  - banco de horas = soma dos saldos líquidos (atraso/saída antecipada são só informação, não entram de novo);
 *  - falta (dia útil com turno, sem batida, dentro do controle, coberto pela importação) vai pra desconto em R$ e NÃO
 *    entra no banco (senão desconta duas vezes); "não descontar em R$" manda ela pro banco;
 *  - fim de semana, feriado e dia sem turno: nunca previsto nem falta; batida neles só gera aviso (vira extra só se
 *    alguém lançar "converter em hora extra");
 *  - antes do início do controle de ponto: nada conta;
 *  - número ímpar de batidas no último dia lido (ou hoje): "em andamento", sem falta, atraso nem extra.
 *
 * Convenções: horário em minutos desde 00:00 do dia de trabalho (batida depois da meia-noite que fecha o turno vira
 * 24h+, "26:10"); datas "AAAA-MM-DD"; dia da semana 0 = domingo … 6 = sábado; dinheiro em centavos.
 */

export type DestinoExtra = 'banco' | 'pagamento';

export type TipoAjuste =
  | 'abonar_manha' | 'abonar_tarde' | 'abonar_falta' | 'abonar_atraso' | 'justificar' | 'folga' | 'compensacao'
  | 'feriado' | 'perdoar_desconto' | 'descontar_saldo' | 'extra_banco' | 'extra_pagamento' | 'corrigir_batidas';

export const TIPOS_DE_AJUSTE: TipoAjuste[] = [
  'abonar_manha', 'abonar_tarde', 'abonar_falta', 'abonar_atraso', 'justificar', 'folga', 'compensacao',
  'feriado', 'perdoar_desconto', 'descontar_saldo', 'extra_banco', 'extra_pagamento', 'corrigir_batidas',
];

export interface ConfigColaborador {
  diasSemana: number[];
  minutosDia: number;
  minutosSabado: number;
  minutosDomingo: number;
  entradaPrevista: string;
  saidaPrevista: string;
  intervaloMinutos: number;
  /** Início do almoço ("12:00"). Com ele o dia tem manhã e tarde; vazio = um período só. */
  intervaloInicio?: string | null;
  toleranciaMinutos: number;
  salarioBaseCentavos: number;
  divisorMensal: number;
  valorHoraCentavos: number | null;
  pctExtraUtil: number;
  pctExtraDomingoFeriado: number;
  destinoExtra: DestinoExtra;
  /** Início do controle de ponto (AAAA-MM-DD). Antes dele nada conta. */
  inicioControle?: string | null;
}

export interface AjusteDoDia {
  tipo: TipoAjuste;
  /** corrigir_batidas: horários que valem no lugar das batidas originais. */
  batidas?: string[] | null;
}

/** Turno do dia vindo da planilha (aba "Turnos"). Sem isso, vale o cadastro (dias da semana). */
export interface TurnoDoDia {
  tipo: 'turno' | 'sem_turno' | 'justificada';
  /** Código do relógio (25 = licença, 26 = viagem, "férias"…), quando justificada. */
  codigo?: string | null;
}

export type StatusDia =
  | 'normal' | 'atraso' | 'extra' | 'manha_sem_batida' | 'tarde_sem_batida' | 'em_andamento' | 'incompleto'
  | 'falta' | 'justificada' | 'feriado' | 'folga' | 'fora_controle' | 'abonado' | 'sem_registro';

export interface DiaCalculado {
  data: string;
  diaSemana: number;
  /** Batidas originais da planilha (já com a virada da meia-noite resolvida). */
  batidasOriginais: string[];
  /** As que valem no cálculo (as originais, ou as da correção manual). */
  batidas: string[];
  previstoMinutos: number;
  trabalhadoMinutos: number;
  /** Informação bruta (não entra de novo no banco): chegada depois da entrada + volta do almoço depois do fim do almoço. */
  atrasoMinutos: number;
  /** Informação bruta: saída antes da prevista + saída pro almoço antes do início do almoço. */
  saidaAntecipadaMinutos: number;
  /** trabalhado − previsto (com os abonos), antes da tolerância. */
  saldoBrutoMinutos: number;
  /** Saldo do dia depois da tolerância (o que vale). */
  saldoMinutos: number;
  /** Efeito no banco de horas (o saldo menos o que foi pra R$: falta descontada, extra paga, saldo convertido). */
  bancoMinutos: number;
  faltaMinutos: number;
  extraMinutos: number;
  extraDestino: DestinoExtra;
  pctExtra: number;
  /** Desconto em R$ pelas horas (falta, manhã/tarde perdida ou saldo convertido). O DSR vem em dsrCentavos. */
  descontoCentavos: number;
  /** DSR descontado por causa da falta: 1 dia até 15/12/2026, 2 dias (sábado e domingo) de 16/12/2026 em diante. Só no primeiro dia com falta da semana. */
  dsrDias: number;
  dsrCentavos: number;
  valorExtraCentavos: number;
  feriado: string | null;
  /** Ausência justificada (licença, viagem, férias, ou justificativa lançada). */
  justificativa: string | null;
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
  justificadas: number;
  manhasSemBatida: number;
  emAndamento: number;
  /** Soma dos saldos do dia (depois da tolerância). */
  saldoMinutos: number;
  /** Soma do efeito no banco de horas. */
  bancoMinutos: number;
  /** Desconto total em R$: horas faltadas + DSR. */
  descontoCentavos: number;
  /** Parte do desconto que é DSR (já está dentro de descontoCentavos). */
  descontoDsrCentavos: number;
  /** Semanas com DSR descontado. */
  dsrSemanas: number;
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
 * DSR (descanso semanal remunerado) perdido por falta. Regra da contabilidade:
 *  - até 15/12/2026: falta de meio período, dia todo ou mais de um dia desconta as horas faltadas + 1 DSR (o domingo);
 *  - a partir de 16/12/2026 (escala 5x2): as horas faltadas + 2 DSR (sábado e domingo).
 * Vale 1 vez por semana (segunda a domingo), mesmo com mais de uma falta nela. Falta justificada, abonada ou perdoada não conta.
 */
export const DATA_ESCALA_5X2 = '2026-12-16';

export function dsrDiasDaFalta(data: string): number {
  return data >= DATA_ESCALA_5X2 ? 2 : 1;
}

/** Valor de 1 DSR: um dia de salário (salário ÷ 30). Sem salário cadastrado, um dia de jornada no valor da hora. */
export function valorDsr(cfg: ConfigColaborador): number {
  if (cfg.salarioBaseCentavos > 0) return Math.round(cfg.salarioBaseCentavos / 30);
  return Math.round((valorHora(cfg) * cfg.minutosDia) / 60);
}

/** Falta que gera desconto em R$ (dia todo ou meio período). Atraso e saldo convertido de atraso não geram DSR. */
function faltaComDesconto(d: DiaCalculado): boolean {
  return d.descontoCentavos > 0 && (d.status === 'falta' || d.status === 'manha_sem_batida' || d.status === 'tarde_sem_batida');
}

/** Rótulo da justificativa pelo código do relógio. */
export function rotuloJustificativa(codigo: string | null | undefined): string {
  const c = String(codigo ?? '').trim().toLowerCase();
  if (c === '25') return 'Licença';
  if (c === '26') return 'Viagem';
  if (c.startsWith('f')) return 'Férias';
  return c ? `Justificada (${codigo})` : 'Justificada';
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
    const amanha = out.get(somarDias(d, 1));
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

/**
 * Períodos de trabalho do dia ([início, fim] em minutos). Com o início do almoço: manhã (entrada → almoço) e tarde
 * (fim do almoço → saída); sem ele (ou se o dia acaba antes do almoço, ex.: sábado meio período): um período só.
 */
export function periodosDoDia(cfg: ConfigColaborador, entrada: number, saida: number): [number, number][] {
  const ini = cfg.intervaloInicio ? paraMinutos(cfg.intervaloInicio) : null;
  if (ini == null || cfg.intervaloMinutos <= 0) return saida > entrada ? [[entrada, saida]] : [];
  const fim = ini + cfg.intervaloMinutos;
  const out: [number, number][] = [];
  if (Math.min(ini, saida) > entrada) out.push([entrada, Math.min(ini, saida)]);
  if (saida > Math.max(fim, entrada)) out.push([Math.max(fim, entrada), saida]);
  return out;
}

// ───────────────────────────── um dia ─────────────────────────────

export interface EntradaDoDia {
  data: string;
  batidas: string[];
  cfg: ConfigColaborador;
  /** Nome do feriado (tabela de feriados), se for. */
  feriado?: string | null;
  ajustes?: AjusteDoDia[];
  /** O dia está dentro de um período que alguma planilha importou (pra este colaborador)? Fora disso, não é falta. */
  coberto: boolean;
  /** "Hoje" (AAAA-MM-DD): dia de hoje ou futuro nunca é falta; hoje com batida ímpar está em andamento. */
  hoje?: string;
  /** Último dia que a importação trouxe pra este colaborador: batida ímpar nele = em andamento. */
  ultimoDiaLido?: string | null;
  /** Turno do dia pela planilha (aba Turnos). */
  turno?: TurnoDoDia | null;
}

function jornadaDoDia(cfg: ConfigColaborador, dow: number): number {
  if (dow === 6) return cfg.minutosSabado;
  if (dow === 0) return cfg.minutosDomingo || cfg.minutosDia;
  return cfg.minutosDia;
}

const ABONOS: TipoAjuste[] = ['abonar_manha', 'abonar_tarde', 'abonar_falta', 'abonar_atraso'];

export function calcularDia(e: EntradaDoDia): DiaCalculado {
  const { cfg } = e;
  const ajustes = e.ajustes ?? [];
  const tem = (t: TipoAjuste) => ajustes.some((a) => a.tipo === t);
  const correcao = [...ajustes].reverse().find((a) => a.tipo === 'corrigir_batidas' && Array.isArray(a.batidas));
  const dow = diaDaSemana(e.data);
  const tol = Math.max(0, cfg.toleranciaMinutos);
  const vh = valorHora(cfg);
  const avisos: string[] = [];

  const originais = [...e.batidas];
  const efetivas = (correcao ? (correcao.batidas ?? []) : originais)
    .map(paraMinutos).filter((m): m is number => m !== null).sort((a, b) => a - b);
  const n = efetivas.length;

  // Horas trabalhadas: pares entrada/saída em ordem; batida sobrando (ímpar) fica fora.
  let trabalhado = 0;
  for (let i = 0; i + 1 < n; i += 2) trabalhado += efetivas[i + 1] - efetivas[i];
  // Só entrada e saída, sem o almoço, com mais de 6h entre elas: desconta o almoço previsto.
  if (n === 2 && trabalhado > 6 * 60 && cfg.intervaloMinutos > 0) {
    trabalhado -= cfg.intervaloMinutos;
    avisos.push(`Sem batida de almoço: descontado o almoço previsto (${cfg.intervaloMinutos} min).`);
  }

  const feriadoNome = e.feriado ?? (tem('feriado') ? 'Feriado (ajuste)' : null);
  const destinoAjuste: DestinoExtra | null = tem('extra_pagamento') ? 'pagamento' : tem('extra_banco') ? 'banco' : null;
  const pctExtra = dow === 0 || feriadoNome ? cfg.pctExtraDomingoFeriado : cfg.pctExtraUtil;
  const extraDestino = destinoAjuste ?? cfg.destinoExtra;

  const base: Omit<DiaCalculado, 'status'> = {
    data: e.data, diaSemana: dow, batidasOriginais: originais, batidas: efetivas.map(paraHora),
    previstoMinutos: 0, trabalhadoMinutos: trabalhado, atrasoMinutos: 0, saidaAntecipadaMinutos: 0,
    saldoBrutoMinutos: 0, saldoMinutos: 0, bancoMinutos: 0, faltaMinutos: 0, extraMinutos: 0,
    extraDestino, pctExtra, descontoCentavos: 0, dsrDias: 0, dsrCentavos: 0, valorExtraCentavos: 0, feriado: feriadoNome, justificativa: null,
    avisos, ajustes: ajustes.map((a) => a.tipo),
  };
  const fechar = (status: StatusDia, extra: Partial<DiaCalculado> = {}): DiaCalculado => ({ ...base, ...extra, status });
  const valorDaExtra = (min: number) => Math.round(((min * vh) / 60) * (1 + pctExtra / 100));

  // 1) Antes do início do controle de ponto: nada conta.
  if (cfg.inicioControle && e.data < cfg.inicioControle) {
    if (n) avisos.push('Antes do início do controle de ponto: não conta.');
    return fechar('fora_controle');
  }

  // 2) Ausência justificada (código do relógio ou lançamento): não deve nada.
  if (e.turno?.tipo === 'justificada' || tem('justificar')) {
    const justificativa = e.turno?.tipo === 'justificada' ? rotuloJustificativa(e.turno.codigo) : 'Justificada';
    if (n) avisos.push('Dia justificado com batida: não somada.');
    return fechar('justificada', { justificativa });
  }

  // 3) Dia sem jornada (fim de semana, sem turno, feriado, folga): nada automático.
  const diaUtil = e.turno ? e.turno.tipo === 'turno' : cfg.diasSemana.includes(dow);
  const folga = tem('folga');
  if (!diaUtil || feriadoNome || folga) {
    const status: StatusDia = feriadoNome ? 'feriado' : 'folga';
    if (!n) return fechar(status);
    if (destinoAjuste) {
      // Hora extra lançada à mão: tudo o que trabalhou.
      return fechar(status, {
        extraMinutos: trabalhado, saldoBrutoMinutos: trabalhado, saldoMinutos: trabalhado,
        bancoMinutos: destinoAjuste === 'banco' ? trabalhado : 0,
        valorExtraCentavos: destinoAjuste === 'pagamento' ? valorDaExtra(trabalhado) : 0,
      });
    }
    const onde = feriadoNome ? `feriado (${feriadoNome})` : folga ? 'folga' : dow === 0 || dow === 6 ? 'fim de semana' : 'dia sem turno';
    avisos.push(`Batida em ${onde}: não somada. Se for hora extra, lance "Converter em hora extra".`);
    return fechar(status);
  }

  const previsto = jornadaDoDia(cfg, dow);
  base.previstoMinutos = previsto;

  // 4) Sem nenhuma batida.
  if (!n) {
    if (tem('compensacao')) {
      return fechar('folga', { saldoBrutoMinutos: -previsto, saldoMinutos: -previsto, bancoMinutos: -previsto });
    }
    const passou = !e.hoje || e.data < e.hoje;
    if (!e.coberto || !passou) return fechar('sem_registro');
    if (tem('abonar_falta') || tem('abonar_atraso')) return fechar('abonado');
    const perdoado = tem('perdoar_desconto');
    return fechar('falta', {
      faltaMinutos: previsto, saldoBrutoMinutos: -previsto, saldoMinutos: -previsto,
      bancoMinutos: perdoado ? -previsto : 0,
      descontoCentavos: perdoado ? 0 : Math.round((previsto * vh) / 60),
    });
  }

  // 5) Número ímpar de batidas.
  const entradaPrev = paraMinutos(cfg.entradaPrevista) ?? 0;
  const saidaPrev = dow === 6 || dow === 0 ? entradaPrev + previsto : (paraMinutos(cfg.saidaPrevista) ?? entradaPrev + previsto);
  const periodos = periodosDoDia(cfg, entradaPrev, saidaPrev);
  const almocoIni = cfg.intervaloInicio ? paraMinutos(cfg.intervaloInicio) : null;
  const doisPeriodos = periodos.length > 1 && almocoIni != null;
  const almocoFim = doisPeriodos ? periodos[1][0] : 0;
  if (n % 2 === 1) {
    if (e.data === e.ultimoDiaLido || e.data === e.hoje) {
      // Entrou só à tarde: a manhã já está perdida (não depende da saída). A tarde fecha com a saída.
      if (doisPeriodos && efetivas[0] >= almocoIni!) {
        const manhaPrev = periodos[0][1] - periodos[0][0];
        const nM = tem('abonar_manha') || tem('abonar_falta') || tem('abonar_atraso') ? 0 : -manhaPrev;
        avisos.push('Manhã sem batida. Dia em andamento: a tarde fecha quando a próxima importação trouxer a saída.');
        if (nM === 0) return fechar('abonado', { previstoMinutos: manhaPrev });
        return fechar('manha_sem_batida', {
          previstoMinutos: manhaPrev, trabalhadoMinutos: 0, saldoBrutoMinutos: nM, saldoMinutos: nM,
          bancoMinutos: tem('descontar_saldo') ? 0 : nM,
          descontoCentavos: tem('descontar_saldo') ? Math.round((manhaPrev * vh) / 60) : 0,
        });
      }
      avisos.push('Dia em andamento: falta a batida de saída. Fecha quando a próxima importação trouxer.');
      return fechar('em_andamento');
    }
    avisos.push('Dia sem saída (número ímpar de batidas): corrija as batidas pra calcular.');
    return fechar('incompleto');
  }

  // 6) Dia trabalhado.
  const primeira = efetivas[0];
  const ultima = efetivas[n - 1];
  const manhaSemBatida = doisPeriodos && primeira >= almocoIni!;
  const tardeSemBatida = doisPeriodos && !manhaSemBatida && ultima <= almocoFim;

  // Atraso e saída antecipada brutos (só informação, não entram no banco de novo).
  let atraso: number;
  let saida: number;
  if (manhaSemBatida) {
    atraso = Math.max(0, primeira - almocoFim);
    saida = Math.max(0, saidaPrev - ultima);
    avisos.push('Manhã sem batida: o saldo negativo da manhã pode ser abonado ("Abonar manhã").');
  } else if (tardeSemBatida) {
    atraso = Math.max(0, primeira - entradaPrev);
    saida = Math.max(0, almocoIni! - ultima);
    avisos.push('Tarde sem batida: o saldo negativo da tarde pode ser abonado ("Abonar tarde").');
  } else {
    atraso = Math.max(0, primeira - entradaPrev);
    saida = Math.max(0, saidaPrev - ultima);
    if (doisPeriodos && n >= 4) {
      atraso += Math.max(0, efetivas[2] - almocoFim);
      saida += Math.max(0, almocoIni! - efetivas[1]);
    }
  }

  // Saldo. Com manhã e tarde (almoço fora da conta): cada período tem a sua tolerância e o almoço não soma
  // nem como hora extra nem no acumulado. Sem esse desenho de jornada, vale o saldo do dia com a tolerância.
  const manha = periodos[0];
  const tarde = doisPeriodos ? periodos[1] : null;
  const porPeriodo = !!tarde && (manha[1] - manha[0]) + (tarde[1] - tarde[0]) === previsto;
  const tolera = (x: number) => (Math.abs(x) <= tol ? 0 : x);
  let trabalhadoFinal = trabalhado;
  let bruto: number;
  let liquido: number;
  let liquidoSemAbono: number;
  if (porPeriodo && tarde) {
    let trabM = 0;
    let trabT = 0;
    for (let i = 0; i + 1 < n; i += 2) {
      const ini = efetivas[i];
      const fim = efetivas[i + 1];
      // Manhã: do início da janela (10 min antes do horário: 07:50) até o início do almoço. Antes da janela não conta.
      trabM += Math.max(0, Math.min(fim, manha[1]) - Math.max(ini, manha[0] - tol));
      trabT += Math.max(0, fim - Math.max(ini, tarde[0])); // do fim do almoço em diante (inclui a saída depois do horário)
    }
    trabalhadoFinal = trabM + trabT;
    const netM = trabM - (manha[1] - manha[0]);
    const netT = trabT - (tarde[1] - tarde[0]);
    let nM = netM;
    let nT = netT;
    if (tem('abonar_manha') && nM < 0) nM = 0;
    if (tem('abonar_tarde') && nT < 0) nT = 0;
    if (tem('abonar_falta') || tem('abonar_atraso')) { nM = Math.max(0, nM); nT = Math.max(0, nT); }
    bruto = nM + nT;
    // Atraso/saída antecipada: até a tolerância vale 0. Hora extra: de manhã a partir de 10 min antes do horário (07:50;
    // antes disso não conta) e à tarde tudo o que passar das 18:00. A soma do dia negativa dentro da tolerância zera.
    const manhaVale = (x: number) => (x < 0 ? tolera(x) : x);
    const tardeVale = manhaVale;
    const diaVale = manhaVale;
    liquido = diaVale(manhaVale(nM) + tardeVale(nT));
    liquidoSemAbono = diaVale(manhaVale(netM) + tardeVale(netT));
  } else {
    const semAbono = trabalhado - previsto;
    bruto = semAbono;
    if (tem('abonar_manha') && bruto < 0 && manha) bruto = Math.min(0, bruto + (manha[1] - manha[0]));
    if (tem('abonar_tarde') && bruto < 0 && tarde) bruto = Math.min(0, bruto + (tarde[1] - tarde[0]));
    if ((tem('abonar_falta') || tem('abonar_atraso')) && bruto < 0) bruto = 0;
    liquido = tolera(bruto);
    liquidoSemAbono = tolera(semAbono);
  }

  let banco = liquido;
  let extra = 0;
  let valorExtra = 0;
  let desconto = 0;
  if (liquido > 0) {
    extra = liquido;
    if (extraDestino === 'pagamento') { banco = 0; valorExtra = valorDaExtra(extra); }
  } else if (liquido < 0 && tem('descontar_saldo')) {
    // Saldo negativo convertido em desconto no fechamento: sai do banco, vira R$.
    banco = 0;
    desconto = Math.round((-liquido * vh) / 60);
  }

  let status: StatusDia;
  if (manhaSemBatida && liquido < 0) status = 'manha_sem_batida';
  else if (tardeSemBatida && liquido < 0) status = 'tarde_sem_batida';
  else if (liquido < 0) status = 'atraso';
  else if (liquido > 0) status = 'extra';
  else if (ABONOS.some(tem) && liquido !== liquidoSemAbono) status = 'abonado';
  else status = 'normal';

  return fechar(status, {
    trabalhadoMinutos: trabalhadoFinal, atrasoMinutos: atraso, saidaAntecipadaMinutos: saida, saldoBrutoMinutos: bruto, saldoMinutos: liquido,
    bancoMinutos: banco, extraMinutos: extra, valorExtraCentavos: valorExtra, descontoCentavos: desconto,
  });
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
  /** Dias cobertos por alguma importação deste colaborador (Set de datas). */
  cobertos: Set<string>;
  /** data -> turno (aba Turnos). */
  turnos?: Map<string, TurnoDoDia>;
  hoje?: string;
}

export function calcularPeriodo(e: EntradaDoPeriodo): { dias: DiaCalculado[]; resumo: ResumoPeriodo } {
  // Resolve a virada com um dia de folga dos dois lados (a madrugada do dia seguinte ao fim fecha o último turno).
  const ampliado = new Map<string, string[]>();
  for (const [d, hs] of e.batidas) if (d >= somarDias(e.inicio, -1) && d <= somarDias(e.fim, 1)) ampliado.set(d, hs);
  const resolvido = resolverViradaDeDia(ampliado);
  const ultimoDiaLido = [...e.cobertos].sort().pop() ?? null;
  const dias = datasEntre(e.inicio, e.fim).map((data) => calcularDia({
    data,
    batidas: resolvido.get(data) ?? [],
    cfg: e.cfg,
    feriado: e.feriados.get(data) ?? null,
    ajustes: e.ajustes.get(data) ?? [],
    coberto: e.cobertos.has(data),
    hoje: e.hoje,
    ultimoDiaLido,
    turno: e.turnos?.get(data) ?? null,
  }));
  // DSR: na primeira falta com desconto de cada semana (segunda a domingo).
  const semanasComDsr = new Set<string>();
  for (const d of dias) {
    if (!faltaComDesconto(d)) continue;
    const segunda = somarDias(d.data, -((d.diaSemana + 6) % 7));
    if (semanasComDsr.has(segunda)) continue;
    semanasComDsr.add(segunda);
    const n = dsrDiasDaFalta(d.data);
    d.dsrDias = n;
    d.dsrCentavos = n * valorDsr(e.cfg);
    d.avisos.push(`DSR descontado (${n === 2 ? 'sábado e domingo' : 'domingo'}): falta na semana, além das horas.`);
  }
  return { dias, resumo: resumir(dias) };
}

export function resumir(dias: DiaCalculado[]): ResumoPeriodo {
  const r: ResumoPeriodo = {
    trabalhadoMinutos: 0, previstoMinutos: 0, extraMinutos: 0, extraBancoMinutos: 0, extraPagamentoMinutos: 0,
    atrasoMinutos: 0, saidaAntecipadaMinutos: 0, faltaMinutos: 0, faltas: 0, justificadas: 0, manhasSemBatida: 0,
    emAndamento: 0, saldoMinutos: 0, bancoMinutos: 0, descontoCentavos: 0, descontoDsrCentavos: 0, dsrSemanas: 0, valorExtraCentavos: 0,
  };
  for (const d of dias) {
    // Em andamento e fora do controle: as horas aparecem na linha, mas não entram nos totais.
    const conta = d.status !== 'em_andamento' && d.status !== 'fora_controle';
    if (conta) {
      r.trabalhadoMinutos += d.trabalhadoMinutos;
      r.previstoMinutos += d.previstoMinutos;
    }
    r.extraMinutos += d.extraMinutos;
    if (d.extraDestino === 'banco') r.extraBancoMinutos += d.extraMinutos;
    else r.extraPagamentoMinutos += d.extraMinutos;
    r.atrasoMinutos += d.atrasoMinutos;
    r.saidaAntecipadaMinutos += d.saidaAntecipadaMinutos;
    r.faltaMinutos += d.faltaMinutos;
    if (d.faltaMinutos > 0) r.faltas += 1;
    if (d.status === 'justificada') r.justificadas += 1;
    if (d.status === 'manha_sem_batida') r.manhasSemBatida += 1;
    if (d.status === 'em_andamento') r.emAndamento += 1;
    r.saldoMinutos += d.saldoMinutos;
    r.bancoMinutos += d.bancoMinutos;
    r.descontoCentavos += d.descontoCentavos + d.dsrCentavos;
    r.descontoDsrCentavos += d.dsrCentavos;
    if (d.dsrCentavos > 0) r.dsrSemanas += 1;
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
