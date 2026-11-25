import { FastifyInstance, FastifyReply } from 'fastify';
import { pool, query, queryOne, withTransaction } from '../db.js';
import { ehDoFinanceiro } from '../lib/acessoMenu.js';
import { renderFullHtmlToPdf } from '../lib/htmlPdf.js';
import {
  calcularPeriodo, datasEntre, somarDias, TIPOS_DE_AJUSTE, valorHora, paraMinutos, formatarMinutos,
  type AjusteDoDia, type ConfigColaborador, type DestinoDesconto, type TipoAjuste, type TurnoDoDia, type ResumoPeriodo,
} from './calculo.js';
import { planejarImportacao, type BatidaExistente, type Decisao } from './importacao.js';
import { pontosMigrado } from './migracao.js';
import { lerPlanilha, validarArquivo, vincularNome, type LeituraDaPlanilha, type Mapeamento, type PapelColuna } from './planilha.js';
import { compararComResumo } from './conferencia.js';
import { relatorioCsv, relatorioHtml } from './relatorio.js';

/**
 * Financeiro > Pontos — todas as rotas em /api/pontos. SÓ quem vê o Financeiro (admin dono do financeiro: o mesmo
 * ehDoFinanceiro de Comissões/Vendas): salário, valor/hora e descontos são dados sensíveis. O bloqueio é aqui, no
 * servidor (preHandler do plugin inteiro), não só no menu.
 */

const DIA = /^\d{4}-\d{2}-\d{2}$/;
const MES = /^\d{4}-(0[1-9]|1[0-2])$/;
const PAPEIS: PapelColuna[] = ['ignorar', 'nome', 'data', 'datahora', 'hora', 'batida', 'batidas_texto'];

type Usuario = { sub: string; role?: string };

function hojeSP(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}

function limitesDoMes(mes: string): { inicio: string; fim: string } {
  const [a, m] = mes.split('-').map(Number);
  const fim = new Date(Date.UTC(a, m, 0)).toISOString().slice(0, 10);
  return { inicio: `${mes}-01`, fim };
}

async function nomeDe(userId: string): Promise<string> {
  const p = await queryOne<{ name: string | null; email: string }>('SELECT name, email FROM profiles WHERE id = $1', [userId]);
  return p?.name || p?.email || '';
}

async function auditar(acao: string, detalhes: Record<string, unknown>, u: Usuario) {
  await query('INSERT INTO ponto_auditoria (acao, detalhes, autor_id, autor_nome) VALUES ($1, $2, $3, $4)',
    [acao, JSON.stringify(detalhes), u.sub, await nomeDe(u.sub)]);
}

// ───────────────────────────── colaboradores ─────────────────────────────

interface ColabRow {
  id: string; nome: string; apelidos: string[]; ativo: boolean; dias_semana: number[]; minutos_dia: number;
  minutos_sabado: number; minutos_domingo: number; entrada_prevista: string; saida_prevista: string;
  intervalo_minutos: number; intervalo_inicio: string | null; tolerancia_minutos: number; salario_base_centavos: string; divisor_mensal: number;
  valor_hora_centavos: string | null; pct_extra_util: string; pct_extra_domingo_feriado: string;
  destino_extra: 'banco' | 'pagamento'; banco_saldo_inicial_minutos: number; banco_inicio: string | null;
  inicio_controle: string | null;
}

const SELECT_COLAB = `SELECT id, nome, apelidos, ativo, dias_semana, minutos_dia, minutos_sabado, minutos_domingo,
  entrada_prevista, saida_prevista, intervalo_minutos, intervalo_inicio, tolerancia_minutos, salario_base_centavos, divisor_mensal,
  valor_hora_centavos, pct_extra_util, pct_extra_domingo_feriado, destino_extra, banco_saldo_inicial_minutos,
  to_char(banco_inicio, 'YYYY-MM-DD') AS banco_inicio, to_char(inicio_controle, 'YYYY-MM-DD') AS inicio_controle FROM ponto_colaboradores`;

function cfgDe(r: ColabRow): ConfigColaborador {
  return {
    diasSemana: r.dias_semana, minutosDia: r.minutos_dia, minutosSabado: r.minutos_sabado, minutosDomingo: r.minutos_domingo,
    entradaPrevista: r.entrada_prevista, saidaPrevista: r.saida_prevista, intervaloMinutos: r.intervalo_minutos,
    intervaloInicio: r.intervalo_inicio,
    toleranciaMinutos: r.tolerancia_minutos, salarioBaseCentavos: Number(r.salario_base_centavos), divisorMensal: r.divisor_mensal,
    valorHoraCentavos: r.valor_hora_centavos == null ? null : Number(r.valor_hora_centavos),
    pctExtraUtil: Number(r.pct_extra_util), pctExtraDomingoFeriado: Number(r.pct_extra_domingo_feriado), destinoExtra: r.destino_extra,
    inicioControle: r.inicio_controle,
  };
}

function colabParaApi(r: ColabRow) {
  const cfg = cfgDe(r);
  return {
    id: r.id, nome: r.nome, apelidos: r.apelidos, ativo: r.ativo, ...cfg,
    bancoSaldoInicialMinutos: r.banco_saldo_inicial_minutos, bancoInicio: r.banco_inicio,
    valorHoraCalculadoCentavos: valorHora(cfg),
  };
}

/** Lê e valida os campos editáveis do colaborador (os que vierem). */
function camposDoColaborador(b: Record<string, unknown>): { campos: Record<string, unknown>; erro?: string } {
  const c: Record<string, unknown> = {};
  const hora = (v: unknown) => typeof v === 'string' && /^\d{2}:\d{2}$/.test(v) && (paraMinutos(v) ?? 9999) < 24 * 60;
  const inteiro = (v: unknown, min: number, max: number) => Number.isInteger(v) && (v as number) >= min && (v as number) <= max;
  if ('nome' in b) { if (typeof b.nome !== 'string' || !b.nome.trim()) return { campos: c, erro: 'Nome obrigatório.' }; c.nome = b.nome.trim(); }
  if ('apelidos' in b) { if (!Array.isArray(b.apelidos)) return { campos: c, erro: 'Apelidos inválidos.' }; c.apelidos = b.apelidos.map(String).map((s) => s.trim()).filter(Boolean); }
  if ('ativo' in b) c.ativo = b.ativo === true;
  if ('diasSemana' in b) {
    if (!Array.isArray(b.diasSemana) || !b.diasSemana.every((d) => inteiro(d, 0, 6))) return { campos: c, erro: 'Dias da semana inválidos.' };
    c.dias_semana = [...new Set(b.diasSemana as number[])].sort();
  }
  for (const [k, col, max] of [['minutosDia', 'minutos_dia', 1440], ['minutosSabado', 'minutos_sabado', 1440], ['minutosDomingo', 'minutos_domingo', 1440],
    ['intervaloMinutos', 'intervalo_minutos', 600], ['toleranciaMinutos', 'tolerancia_minutos', 120], ['divisorMensal', 'divisor_mensal', 400],
    ['bancoSaldoInicialMinutos', 'banco_saldo_inicial_minutos', 100000]] as const) {
    if (k in b) {
      const min = k === 'bancoSaldoInicialMinutos' ? -100000 : k === 'divisorMensal' ? 1 : 0;
      if (!inteiro(b[k], min, max)) return { campos: c, erro: `Valor inválido em ${k}.` };
      c[col] = b[k];
    }
  }
  for (const [k, col] of [['entradaPrevista', 'entrada_prevista'], ['saidaPrevista', 'saida_prevista']] as const) {
    if (k in b) { if (!hora(b[k])) return { campos: c, erro: `Horário inválido em ${k} (use HH:MM).` }; c[col] = b[k]; }
  }
  if ('intervaloInicio' in b) {
    if (b.intervaloInicio != null && b.intervaloInicio !== '' && !hora(b.intervaloInicio)) return { campos: c, erro: 'Horário inválido no início do almoço (use HH:MM).' };
    c.intervalo_inicio = b.intervaloInicio || null;
  }
  if ('salarioBaseCentavos' in b) { if (!inteiro(b.salarioBaseCentavos, 0, 1e10)) return { campos: c, erro: 'Salário inválido.' }; c.salario_base_centavos = b.salarioBaseCentavos; }
  if ('valorHoraCentavos' in b) {
    if (b.valorHoraCentavos !== null && !inteiro(b.valorHoraCentavos, 0, 1e9)) return { campos: c, erro: 'Valor/hora inválido.' };
    c.valor_hora_centavos = b.valorHoraCentavos || null;
  }
  for (const [k, col] of [['pctExtraUtil', 'pct_extra_util'], ['pctExtraDomingoFeriado', 'pct_extra_domingo_feriado']] as const) {
    if (k in b) { const n = Number(b[k]); if (!Number.isFinite(n) || n < 0 || n > 500) return { campos: c, erro: `Percentual inválido em ${k}.` }; c[col] = n; }
  }
  if ('destinoExtra' in b) { if (b.destinoExtra !== 'banco' && b.destinoExtra !== 'pagamento') return { campos: c, erro: 'Destino da hora extra inválido.' }; c.destino_extra = b.destinoExtra; }
  if ('bancoInicio' in b) {
    if (b.bancoInicio !== null && !(typeof b.bancoInicio === 'string' && DIA.test(b.bancoInicio))) return { campos: c, erro: 'Data de início do banco inválida.' };
    c.banco_inicio = b.bancoInicio || null;
  }
  if ('inicioControle' in b) {
    if (b.inicioControle !== null && b.inicioControle !== '' && !(typeof b.inicioControle === 'string' && DIA.test(b.inicioControle))) {
      return { campos: c, erro: 'Data de início do controle de ponto inválida.' };
    }
    c.inicio_controle = b.inicioControle || null;
  }
  return { campos: c };
}

// ───────────────────────────── cálculo do período ─────────────────────────────

interface AjusteRow { id: string; colaborador_id: string; data: string; tipo: TipoAjuste; motivo: string; batidas: string[] | null; minutos: number | null; destino: DestinoDesconto | null; autor_nome: string; criado_em: string }

async function dadosParaCalculo(colabIds: string[], inicio: string, fim: string) {
  const [batidas, ajustes, feriados, importacoes, turnosRows] = await Promise.all([
    query<{ colaborador_id: string; data: string; hora: string }>(
      `SELECT colaborador_id, to_char(data, 'YYYY-MM-DD') AS data, hora FROM ponto_batidas
       WHERE colaborador_id = ANY($1::uuid[]) AND data BETWEEN $2::date AND $3::date ORDER BY data, hora`,
      [colabIds, somarDias(inicio, -1), somarDias(fim, 1)]
    ),
    query<AjusteRow>(
      `SELECT id, colaborador_id, to_char(data, 'YYYY-MM-DD') AS data, tipo, motivo, batidas, minutos, destino, autor_nome, criado_em FROM ponto_ajustes
       WHERE removido_em IS NULL AND colaborador_id = ANY($1::uuid[]) AND data BETWEEN $2::date AND $3::date ORDER BY criado_em`,
      [colabIds, inicio, fim]
    ),
    query<{ data: string; nome: string }>(`SELECT to_char(data, 'YYYY-MM-DD') AS data, nome FROM ponto_feriados WHERE data BETWEEN $1::date AND $2::date`, [inicio, fim]),
    query<{ inicio: string; fim: string; colaboradores: string[] }>(
      `SELECT to_char(periodo_inicio, 'YYYY-MM-DD') AS inicio, to_char(periodo_fim, 'YYYY-MM-DD') AS fim, colaboradores FROM ponto_importacoes
       WHERE desfeita_em IS NULL AND periodo_fim >= $1::date AND periodo_inicio <= $2::date`,
      [inicio, fim]
    ),
    query<{ colaborador_id: string; data: string; tipo: TurnoDoDia['tipo']; codigo: string | null }>(
      `SELECT colaborador_id, to_char(data, 'YYYY-MM-DD') AS data, tipo, codigo FROM ponto_turnos
       WHERE colaborador_id = ANY($1::uuid[]) AND data BETWEEN $2::date AND $3::date`,
      [colabIds, inicio, fim]
    ),
  ]);
  const turnos = new Map<string, Map<string, TurnoDoDia>>();
  for (const t of turnosRows) {
    const m = turnos.get(t.colaborador_id) ?? new Map<string, TurnoDoDia>();
    m.set(t.data, { tipo: t.tipo, codigo: t.codigo });
    turnos.set(t.colaborador_id, m);
  }
  // Dias cobertos, POR colaborador: só as importações que trouxeram aquele colaborador.
  const cobertos = new Map<string, Set<string>>();
  for (const i of importacoes) {
    const dias = datasEntre(i.inicio < inicio ? inicio : i.inicio, i.fim > fim ? fim : i.fim);
    for (const c of i.colaboradores ?? []) {
      const set = cobertos.get(c) ?? new Set<string>();
      for (const d of dias) set.add(d);
      cobertos.set(c, set);
    }
  }
  const feriadosMap = new Map<string, string>();
  for (const f of feriados) feriadosMap.set(f.data, feriadosMap.has(f.data) ? `${feriadosMap.get(f.data)} / ${f.nome}` : f.nome);
  return { batidas, ajustes, feriados: feriadosMap, cobertos, turnos };
}

function calcularDoColaborador(r: ColabRow, inicio: string, fim: string, d: Awaited<ReturnType<typeof dadosParaCalculo>>) {
  const batidas = new Map<string, string[]>();
  for (const b of d.batidas) if (b.colaborador_id === r.id) batidas.set(b.data, [...(batidas.get(b.data) ?? []), b.hora]);
  const ajustes = new Map<string, AjusteDoDia[]>();
  for (const a of d.ajustes) if (a.colaborador_id === r.id) ajustes.set(a.data, [...(ajustes.get(a.data) ?? []), { tipo: a.tipo, batidas: a.batidas, minutos: a.minutos, destino: a.destino, motivo: a.motivo }]);
  return calcularPeriodo({
    inicio, fim, cfg: cfgDe(r), batidas, feriados: d.feriados, ajustes, cobertos: d.cobertos.get(r.id) ?? new Set(),
    turnos: d.turnos.get(r.id), hoje: hojeSP(),
  });
}

/**
 * Banco de horas acumulado até `fim` (passa de um mês pro outro): saldo inicial + efeito no banco de todos os dias desde
 * o início do banco (dias antes do início do controle de ponto não contam).
 */
async function bancoAcumulado(r: ColabRow, fim: string): Promise<number> {
  const primeira = await queryOne<{ d: string | null }>(
    `SELECT to_char(LEAST(
       (SELECT MIN(data) FROM ponto_batidas WHERE colaborador_id = $1),
       (SELECT MIN(data) FROM ponto_ajustes WHERE colaborador_id = $1 AND removido_em IS NULL)
     ), 'YYYY-MM-DD') AS d`, [r.id]
  );
  const inicio = r.banco_inicio ?? primeira?.d ?? null;
  if (!inicio || inicio > fim) return r.banco_saldo_inicial_minutos;
  const dados = await dadosParaCalculo([r.id], inicio, fim);
  return r.banco_saldo_inicial_minutos + calcularDoColaborador(r, inicio, fim, dados).resumo.bancoMinutos;
}

// ───────────────────────────── importação ─────────────────────────────

interface CorpoImportacao {
  arquivoNome?: string;
  arquivoBase64?: string;
  modo?: 'mes' | 'periodo';
  mes?: string;
  de?: string;
  ate?: string;
  /** nome da aba -> mapeamento escolhido na tela. */
  mapeamentos?: Record<string, Mapeamento>;
  /** nome da planilha -> id do colaborador, ou "ignorar". */
  associacoes?: Record<string, string>;
  /** "colaboradorId|data" -> manter/substituir. */
  decisoes?: Record<string, Decisao>;
}

function validarMapeamentos(m: unknown): Record<string, Mapeamento> | null {
  if (m == null) return {};
  if (typeof m !== 'object') return null;
  const out: Record<string, Mapeamento> = {};
  for (const [aba, v] of Object.entries(m as Record<string, unknown>)) {
    const mp = v as Mapeamento;
    if (!mp || !Number.isInteger(mp.linhaCabecalho) || mp.linhaCabecalho < 0 || typeof mp.colunas !== 'object') return null;
    const colunas: Record<string, PapelColuna> = {};
    for (const [i, p] of Object.entries(mp.colunas)) {
      if (!/^\d+$/.test(i) || !PAPEIS.includes(p)) return null;
      if (p !== 'ignorar') colunas[i] = p;
    }
    out[aba] = { linhaCabecalho: mp.linhaCabecalho, colunas };
  }
  return out;
}

// ───────────────────────────── conferência com o resumo do relógio ─────────────────────────────

async function conferirComResumo(
  leitura: LeituraDaPlanilha, lido: { inicio: string; fim: string }, colabIds: string[], colaboradores: ColabRow[],
  vinculo: Map<string, string | null>, lidas: { colaboradorId: string; data: string; hora: string }[],
  turnos: { colaboradorId: string; data: string; tipo: TurnoDoDia['tipo']; codigo: string | null }[],
) {
  const dados = await dadosParaCalculo(colabIds, lido.inicio, lido.fim);
  const out = [];
  for (const conf of leitura.conferencia) {
    const id = vinculo.get(conf.nome);
    const c = id ? colaboradores.find((x) => x.id === id) : undefined;
    if (!c) continue;
    const batidas = new Map<string, string[]>();
    for (const l of lidas) if (l.colaboradorId === c.id) batidas.set(l.data, [...(batidas.get(l.data) ?? []), l.hora]);
    const ajustes = new Map<string, AjusteDoDia[]>();
    for (const a of dados.ajustes) if (a.colaborador_id === c.id) ajustes.set(a.data, [...(ajustes.get(a.data) ?? []), { tipo: a.tipo, batidas: a.batidas, minutos: a.minutos, destino: a.destino, motivo: a.motivo }]);
    const t = new Map(turnos.filter((x) => x.colaboradorId === c.id).map((x) => [x.data, { tipo: x.tipo, codigo: x.codigo }] as const));
    const { dias, resumo } = calcularPeriodo({
      inicio: lido.inicio, fim: lido.fim, cfg: cfgDe(c), batidas, feriados: dados.feriados, ajustes,
      cobertos: new Set(datasEntre(lido.inicio, lido.fim)), turnos: t, hoje: hojeSP(),
    });
    out.push({
      nome: c.nome, nomeNaPlanilha: conf.nome, relogio: conf.campos,
      nosso: {
        faltas: resumo.faltas, atrasoBruto: formatarMinutos(resumo.atrasoMinutos), horasExtras: formatarMinutos(resumo.extraMinutos),
        trabalhadas: formatarMinutos(resumo.trabalhadoMinutos), banco: formatarMinutos(resumo.bancoMinutos),
        justificadas: resumo.justificadas, emAndamento: resumo.emAndamento,
      },
      divergencias: compararComResumo(conf.campos, resumo, dias.filter((d) => d.atrasoMinutos > 0).length),
    });
  }
  return out;
}

/** Lê o arquivo e monta o plano (usado na pré-visualização e na confirmação, com as mesmas entradas). */
async function prepararImportacao(b: CorpoImportacao) {
  const nome = String(b.arquivoNome ?? '').slice(0, 200);
  if (!b.arquivoBase64 || typeof b.arquivoBase64 !== 'string') return { erro: 'Envie o arquivo.' };
  const buf = Buffer.from(b.arquivoBase64.replace(/^data:[^,]*,/, ''), 'base64');
  const invalido = validarArquivo(nome, buf);
  if (invalido) return { erro: invalido };
  const manuais = validarMapeamentos(b.mapeamentos);
  if (!manuais) return { erro: 'Mapeamento de colunas inválido.' };

  const salvos = Object.fromEntries((await query<{ assinatura: string; mapeamento: Mapeamento }>('SELECT assinatura, mapeamento FROM ponto_mapeamentos'))
    .map((m) => [m.assinatura, m.mapeamento]));
  let leitura: LeituraDaPlanilha;
  try {
    leitura = lerPlanilha(buf, salvos, manuais);
  } catch {
    return { erro: 'Não deu pra ler o arquivo: confira se é uma planilha válida.' };
  }

  const modo = b.modo === 'periodo' ? 'periodo' : 'mes';
  let periodo: { inicio: string; fim: string } | null = null;
  if (modo === 'periodo') {
    if (!b.de || !DIA.test(b.de)) return { erro: 'Escolha a data (ou o início do período).' };
    const ate = b.ate && DIA.test(b.ate) ? b.ate : b.de;
    if (ate < b.de) return { erro: 'O fim do período é antes do início.' };
    periodo = { inicio: b.de, fim: ate };
  } else if (leitura.formato === 'relogio' && leitura.periodoArquivo) {
    // Exportação do relógio: o período é o que está escrito no arquivo ("2026/11/01 ~ 11/16").
    periodo = leitura.periodoArquivo;
  } else {
    const mes = b.mes && MES.test(b.mes) ? b.mes : leitura.mesProvavel;
    if (mes) periodo = limitesDoMes(mes);
  }

  const colaboradores = await query<ColabRow>(`${SELECT_COLAB} ORDER BY nome`);
  const associacoes = b.associacoes ?? {};
  const nomes = [...new Set([...leitura.registros.map((r) => r.nome), ...(leitura.nomes ?? [])])];
  const vinculo = new Map<string, string | null>();
  // Quem está inativo (ex.: Arthur e Luis, removidos dos Pontos) e aparece na planilha do relógio: ignorado, sem pedir pra associar.
  const ignoradosInativos = new Set<string>();
  const inativos = new Set(colaboradores.filter((c) => !c.ativo).map((c) => c.id));
  for (const n of nomes) {
    const manual = associacoes[n];
    if (manual === 'ignorar') vinculo.set(n, null);
    else if (manual && colaboradores.some((c) => c.id === manual)) vinculo.set(n, manual);
    else {
      const achado = vincularNome(n, colaboradores.map((c) => ({ id: c.id, nome: c.nome, apelidos: c.apelidos, ativo: c.ativo })));
      vinculo.set(n, achado);
      if (!achado) {
        const entreTodos = vincularNome(n, colaboradores.map((c) => ({ id: c.id, nome: c.nome, apelidos: c.apelidos, ativo: true })));
        if (entreTodos && inativos.has(entreTodos)) ignoradosInativos.add(n);
      }
    }
  }
  const naoReconhecidos = nomes.filter((n) => !vinculo.get(n) && associacoes[n] !== 'ignorar' && !ignoradosInativos.has(n));

  const lidas = leitura.registros.flatMap((r) => {
    const colaboradorId = vinculo.get(r.nome);
    return colaboradorId ? r.horas.map((hora) => ({ colaboradorId, data: r.data, hora })) : [];
  });
  // Colaboradores do arquivo: os que têm batida e (no relógio) os que aparecem na aba Registros mesmo sem batida.
  const colabIds = [...new Set([
    ...lidas.map((l) => l.colaboradorId),
    ...(leitura.nomes ?? []).map((n) => vinculo.get(n)).filter((x): x is string => !!x),
  ])];
  const existentes = periodo && colabIds.length
    ? (await query<{ id: string; colaborador_id: string; data: string; hora: string; importacao_id: string | null }>(
        `SELECT id, colaborador_id, to_char(data, 'YYYY-MM-DD') AS data, hora, importacao_id FROM ponto_batidas
         WHERE colaborador_id = ANY($1::uuid[]) AND data BETWEEN $2::date AND $3::date`,
        [colabIds, periodo.inicio, periodo.fim]
      )).map((e): BatidaExistente => ({ id: e.id, colaboradorId: e.colaborador_id, data: e.data, hora: e.hora, importacaoId: e.importacao_id }))
    : [];
  const plano = periodo ? planejarImportacao({ lidas, existentes, periodo, decisoes: b.decisoes }) : null;

  // Avisos pra pré-visualização.
  const nomeDoColab = (id: string) => colaboradores.find((c) => c.id === id)?.nome ?? id;
  const avisos: string[] = [];
  for (const n of naoReconhecidos) avisos.push(`Nome não reconhecido: "${n}" (associe a um colaborador ou ignore).`);
  if (plano?.foraDoPeriodo) avisos.push(`${plano.foraDoPeriodo} batida(s) com data fora do período escolhido: ignoradas.`);
  if (plano?.duplicadasNoArquivo) avisos.push(`${plano.duplicadasNoArquivo} batida(s) repetida(s) no próprio arquivo: entram uma vez só.`);
  const porDia = new Map<string, number>();
  for (const l of lidas) if (!periodo || (l.data >= periodo.inicio && l.data <= periodo.fim)) porDia.set(`${l.colaboradorId}|${l.data}`, (porDia.get(`${l.colaboradorId}|${l.data}`) ?? 0) + 1);
  for (const [k, n] of porDia) {
    if (n % 2 === 1) {
      const [id, data] = k.split('|');
      avisos.push(`${nomeDoColab(id)} em ${data.split('-').reverse().join('/')}: ${n} batida(s), dia sem saída.`);
    }
  }

  const resumoPorColab = colabIds.map((id) => {
    const doColab = lidas.filter((l) => l.colaboradorId === id && (!periodo || (l.data >= periodo.inicio && l.data <= periodo.fim)));
    return { colaboradorId: id, nome: nomeDoColab(id), dias: new Set(doColab.map((l) => l.data)).size, batidas: doColab.length };
  });

  // Período lido (o que vira "coberto": dia útil sem batida dentro dele é falta, só pros colaboradores do arquivo).
  // Relógio e modo período: o período inteiro. Planilha comum no modo mês: as datas que vieram (o relógio pode ter
  // exportado só até o dia 13: do 14 em diante não é falta).
  let lido = periodo;
  if (periodo && leitura.formato !== 'relogio' && modo === 'mes') {
    const datasLidas = [...new Set(leitura.registros.map((x) => x.data))].filter((d) => d >= periodo!.inicio && d <= periodo!.fim).sort();
    if (datasLidas.length) lido = { inicio: datasLidas[0], fim: datasLidas[datasLidas.length - 1] };
  }

  // Aba Turnos -> por colaborador e dia (só dentro do período lido).
  const turnos = lido ? leitura.turnos.flatMap((t) => {
    if (t.data < lido!.inicio || t.data > lido!.fim) return [];
    const ids = t.nome === '*' ? colabIds : [vinculo.get(t.nome)].filter((x): x is string => !!x);
    return ids.map((colaboradorId) => ({ colaboradorId, data: t.data, tipo: t.tipo, codigo: t.codigo }));
  }) : [];
  for (const o of leitura.observacoes) avisos.push(o);

  // Conferência com o resumo do relógio (nada dele entra no cálculo: só avisa se o nosso cálculo der diferente).
  const conferencia = lido && leitura.conferencia.length
    ? await conferirComResumo(leitura, lido, colabIds, colaboradores, vinculo, lidas, turnos)
    : [];
  for (const c of conferencia) for (const d of c.divergencias) avisos.push(`Conferência (${c.nome}): ${d}`);

  return {
    nome, modo, periodo, lido, turnos, colabIds, leitura, plano, avisos, naoReconhecidos, colaboradores, vinculo,
    previa: {
      arquivoNome: nome,
      modo,
      formato: leitura.formato,
      periodoLido: lido,
      turnos: { total: turnos.length, justificadas: turnos.filter((t) => t.tipo === 'justificada').length },
      conferencia,
      mesDetectado: leitura.mesProvavel,
      periodoDoArquivo: leitura.periodo,
      periodo,
      abas: leitura.abas.map((a) => ({
        nome: a.nome, cabecalhos: a.cabecalhos, amostra: a.amostra, mapeamento: a.mapeamento,
        precisaMapeamento: a.precisaMapeamento, nomeDaAba: a.nomeDaAba,
      })),
      nomesDaPlanilha: nomes.map((n) => ({ nome: n, colaboradorId: vinculo.get(n) ?? null })),
      naoReconhecidos,
      colaboradores: resumoPorColab,
      invalidas: leitura.invalidas.slice(0, 200),
      totalInvalidas: leitura.invalidas.length,
      avisos,
      conflitos: (plano?.conflitos ?? []).map((c) => ({ ...c, nome: nomeDoColab(c.colaboradorId), chave: `${c.colaboradorId}|${c.data}` })),
      contagens: plano
        ? { novos: plano.novos, atualizados: plano.atualizados, ignorados: plano.ignorados, foraDoPeriodo: plano.foraDoPeriodo }
        : { novos: 0, atualizados: 0, ignorados: 0, foraDoPeriodo: 0 },
    },
  };
}

// ───────────────────────────── rotas ─────────────────────────────

let migrado = false;
const naoMigrado = (reply: FastifyReply) => reply.status(503).send({
  message: 'O módulo Pontos ainda não foi instalado no banco. Rode a migração: node dist/pontos/migrar.js',
});

export async function pontosRoutes(app: FastifyInstance) {
  app.addHook('preHandler', async (req, reply) => {
    const u = req.user as Usuario | undefined;
    if (!u?.sub || !ehDoFinanceiro(u.sub, u.role)) return reply.status(403).send({ message: 'Pontos é só do administrador do Financeiro.' });
    if (!migrado) migrado = await pontosMigrado(pool);
    if (!migrado) return naoMigrado(reply);
  });
  const auth = { onRequest: [app.authenticate] };

  // ── colaboradores ──
  app.get('/api/pontos/colaboradores', auth, async () => (await query<ColabRow>(`${SELECT_COLAB} ORDER BY ativo DESC, nome`)).map(colabParaApi));

  app.post<{ Body: Record<string, unknown> }>('/api/pontos/colaboradores', auth, async (req, reply) => {
    const { campos, erro } = camposDoColaborador(req.body ?? {});
    if (erro) return reply.status(400).send({ message: erro });
    if (!campos.nome) return reply.status(400).send({ message: 'Nome obrigatório.' });
    const chaves = Object.keys(campos);
    try {
      const [r] = await query<{ id: string }>(
        `INSERT INTO ponto_colaboradores (${chaves.join(', ')}) VALUES (${chaves.map((_, i) => `$${i + 1}`).join(', ')}) RETURNING id`,
        chaves.map((k) => campos[k])
      );
      await auditar('colaborador_criado', { id: r.id, ...campos }, req.user as Usuario);
      return reply.status(201).send(colabParaApi((await queryOne<ColabRow>(`${SELECT_COLAB} WHERE id = $1`, [r.id]))!));
    } catch {
      return reply.status(409).send({ message: 'Já existe um colaborador com esse nome.' });
    }
  });

  app.patch<{ Params: { id: string }; Body: Record<string, unknown> }>('/api/pontos/colaboradores/:id', auth, async (req, reply) => {
    const { campos, erro } = camposDoColaborador(req.body ?? {});
    if (erro) return reply.status(400).send({ message: erro });
    const chaves = Object.keys(campos);
    if (!chaves.length) return reply.status(400).send({ message: 'Nada pra alterar.' });
    try {
      const r = await queryOne<{ id: string }>(
        `UPDATE ponto_colaboradores SET ${chaves.map((k, i) => `${k} = $${i + 1}`).join(', ')}, atualizado_em = NOW()
         WHERE id = $${chaves.length + 1} RETURNING id`,
        [...chaves.map((k) => campos[k]), req.params.id]
      );
      if (!r) return reply.status(404).send({ message: 'Colaborador não encontrado.' });
    } catch {
      return reply.status(409).send({ message: 'Já existe um colaborador com esse nome.' });
    }
    await auditar('colaborador_alterado', { id: req.params.id, ...campos }, req.user as Usuario);
    return colabParaApi((await queryOne<ColabRow>(`${SELECT_COLAB} WHERE id = $1`, [req.params.id]))!);
  });

  // ── feriados ──
  app.get('/api/pontos/feriados', auth, async () =>
    query(`SELECT id, to_char(data, 'YYYY-MM-DD') AS data, nome, abrangencia FROM ponto_feriados ORDER BY data`));

  app.post<{ Body: { data?: string; nome?: string; abrangencia?: string } }>('/api/pontos/feriados', auth, async (req, reply) => {
    const { data, nome } = req.body ?? {};
    const abrangencia = ['nacional', 'estadual', 'municipal'].includes(String(req.body?.abrangencia)) ? req.body!.abrangencia : 'nacional';
    if (!data || !DIA.test(data) || !nome?.trim()) return reply.status(400).send({ message: 'Informe a data e o nome do feriado.' });
    const [f] = await query(
      `INSERT INTO ponto_feriados (data, nome, abrangencia) VALUES ($1, $2, $3) ON CONFLICT (data, nome) DO UPDATE SET abrangencia = EXCLUDED.abrangencia
       RETURNING id, to_char(data, 'YYYY-MM-DD') AS data, nome, abrangencia`,
      [data, nome.trim(), abrangencia]
    );
    await auditar('feriado_salvo', { data, nome, abrangencia }, req.user as Usuario);
    return reply.status(201).send(f);
  });

  app.delete<{ Params: { id: string } }>('/api/pontos/feriados/:id', auth, async (req, reply) => {
    const f = await queryOne('DELETE FROM ponto_feriados WHERE id = $1 RETURNING nome', [req.params.id]);
    if (!f) return reply.status(404).send({ message: 'Feriado não encontrado.' });
    await auditar('feriado_removido', { id: req.params.id, ...f }, req.user as Usuario);
    return { ok: true };
  });

  // ── período (tela) ──
  app.get<{ Querystring: { de?: string; ate?: string } }>('/api/pontos/periodo', auth, async (req, reply) => {
    const { de, ate } = req.query;
    if (!de || !ate || !DIA.test(de) || !DIA.test(ate) || ate < de) return reply.status(400).send({ message: 'Período inválido.' });
    if (datasEntre(de, ate).length > 370) return reply.status(400).send({ message: 'Período maior que 1 ano.' });
    const colaboradores = await query<ColabRow>(`${SELECT_COLAB} ORDER BY ativo DESC, nome`);
    const dados = await dadosParaCalculo(colaboradores.map((c) => c.id), de, ate);
    const saida = [];
    for (const c of colaboradores) {
      const { dias, resumo } = calcularDoColaborador(c, de, ate, dados);
      // Colaborador inativo (ex.: Arthur e Luis, removidos dos Pontos) não aparece; reativar na tela de Colaboradores traz de volta.
      if (!c.ativo) continue;
      const ajustes = dados.ajustes.filter((a) => a.colaborador_id === c.id)
        .map((a) => ({ id: a.id, data: a.data, tipo: a.tipo, motivo: a.motivo, batidas: a.batidas, minutos: a.minutos, destino: a.destino, autor: a.autor_nome, criadoEm: a.criado_em }));
      saida.push({ colaborador: colabParaApi(c), dias, resumo, ajustes, bancoAcumuladoMinutos: await bancoAcumulado(c, ate) });
    }
    return { de, ate, colaboradores: saida };
  });

  // ── ajustes ──
  app.post<{ Body: { colaboradorId?: string; data?: string; tipo?: string; motivo?: string; batidas?: unknown; minutos?: unknown; destino?: unknown } }>('/api/pontos/ajustes', auth, async (req, reply) => {
    const { colaboradorId, data, tipo, motivo } = req.body ?? {};
    if (!colaboradorId || !data || !DIA.test(data)) return reply.status(400).send({ message: 'Colaborador e data obrigatórios.' });
    if (!tipo || !TIPOS_DE_AJUSTE.includes(tipo as TipoAjuste)) return reply.status(400).send({ message: 'Tipo de ajuste inválido.' });
    if (!motivo?.trim()) return reply.status(400).send({ message: 'O motivo é obrigatório.' });
    let batidas: string[] | null = null;
    if (tipo === 'corrigir_batidas') {
      if (!Array.isArray(req.body.batidas)) return reply.status(400).send({ message: 'Informe os horários corrigidos.' });
      batidas = (req.body.batidas as unknown[]).map(String).map((s) => s.trim()).filter(Boolean);
      if (batidas.some((h) => paraMinutos(h) === null)) return reply.status(400).send({ message: 'Horário inválido (use HH:MM).' });
    }
    // Desconto manual de horas: quantos minutos (1 a 12h por lançamento) e de onde sai (banco de horas, padrão, ou R$).
    let minutos: number | null = null;
    let destino: DestinoDesconto | null = null;
    if (tipo === 'descontar_horas') {
      minutos = Math.round(Number(req.body.minutos));
      if (!Number.isFinite(minutos) || minutos < 1 || minutos > 12 * 60) return reply.status(400).send({ message: 'Informe quanto descontar (de 1 minuto a 12 horas).' });
      destino = req.body.destino === 'banco' ? 'banco' : 'dinheiro';
    }
    // Atestado: sem horas = o dia inteiro (falta abonada); com horas = só esse tempo (ex.: 1h no dentista).
    if (tipo === 'atestado' && req.body.minutos != null && req.body.minutos !== '') {
      minutos = Math.round(Number(req.body.minutos));
      if (!Number.isFinite(minutos) || minutos < 1 || minutos > 12 * 60) return reply.status(400).send({ message: 'Informe as horas do atestado (de 1 minuto a 12 horas).' });
    }
    const existe = await queryOne('SELECT 1 FROM ponto_colaboradores WHERE id = $1', [colaboradorId]);
    if (!existe) return reply.status(404).send({ message: 'Colaborador não encontrado.' });
    const u = req.user as Usuario;
    const [a] = await query<{ id: string }>(
      `INSERT INTO ponto_ajustes (colaborador_id, data, tipo, motivo, batidas, minutos, destino, autor_id, autor_nome) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
      [colaboradorId, data, tipo, motivo.trim(), batidas ? JSON.stringify(batidas) : null, minutos, destino, u.sub, await nomeDe(u.sub)]
    );
    await auditar('ajuste_criado', { id: a.id, colaboradorId, data, tipo, motivo, batidas, minutos, destino }, u);
    return reply.status(201).send({ id: a.id });
  });

  app.delete<{ Params: { id: string } }>('/api/pontos/ajustes/:id', auth, async (req, reply) => {
    const u = req.user as Usuario;
    const a = await queryOne(
      `UPDATE ponto_ajustes SET removido_em = NOW(), removido_por_nome = $2 WHERE id = $1 AND removido_em IS NULL
       RETURNING colaborador_id, to_char(data, 'YYYY-MM-DD') AS data, tipo`,
      [req.params.id, await nomeDe(u.sub)]
    );
    if (!a) return reply.status(404).send({ message: 'Ajuste não encontrado.' });
    await auditar('ajuste_removido', { id: req.params.id, ...a }, u);
    return { ok: true };
  });

  // ── importação ──
  app.post<{ Body: CorpoImportacao }>('/api/pontos/importacoes/previa', auth, async (req, reply) => {
    const r = await prepararImportacao(req.body ?? {});
    if ('erro' in r) return reply.status(400).send({ message: r.erro });
    return r.previa;
  });

  app.post<{ Body: CorpoImportacao }>('/api/pontos/importacoes', auth, async (req, reply) => {
    const r = await prepararImportacao(req.body ?? {});
    if ('erro' in r) return reply.status(400).send({ message: r.erro });
    if (!r.periodo || !r.plano) return reply.status(400).send({ message: 'Não achei nenhuma data no arquivo: confira o mapeamento das colunas.' });
    if (r.leitura.abas.some((a) => a.precisaMapeamento && !req.body.mapeamentos?.[a.nome])) {
      return reply.status(400).send({ message: 'Falta mapear as colunas de alguma aba.' });
    }
    const u = req.user as Usuario;
    const autor = await nomeDe(u.sub);
    const { plano, periodo } = r;
    const lido = r.lido ?? periodo;
    const colaboradoresDaImportacao = [...new Set([...plano.inserir.map((b) => b.colaboradorId), ...r.colabIds])];
    const id = await withTransaction(async (client) => {
      // Mapeamentos usados ficam salvos pras próximas importações.
      for (const a of r.leitura.abas) {
        if (!a.mapeamento) continue;
        await client.query(
          `INSERT INTO ponto_mapeamentos (assinatura, mapeamento) VALUES ($1, $2)
           ON CONFLICT (assinatura) DO UPDATE SET mapeamento = EXCLUDED.mapeamento, atualizado_em = NOW()`,
          [a.assinatura, JSON.stringify(a.mapeamento)]
        );
      }
      // Associação manual de nome vira apelido do colaborador (a próxima planilha já reconhece).
      for (const [nomePlanilha, colabId] of Object.entries(req.body.associacoes ?? {})) {
        if (!colabId || colabId === 'ignorar') continue;
        await client.query(
          `UPDATE ponto_colaboradores SET apelidos = array_append(apelidos, $2), atualizado_em = NOW()
           WHERE id = $1 AND NOT ($2 = ANY(apelidos)) AND lower(nome) <> lower($2)`,
          [colabId, nomePlanilha]
        );
      }
      const { rows: [imp] } = await client.query<{ id: string }>(
        `INSERT INTO ponto_importacoes (arquivo_nome, modo, periodo_inicio, periodo_fim, colaboradores, conteudo, substituidas, avisos, importado_por, importado_por_nome)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id`,
        [r.nome, r.modo, lido.inicio, lido.fim, colaboradoresDaImportacao,
          JSON.stringify(r.leitura.registros.filter((x) => x.data >= periodo.inicio && x.data <= periodo.fim).map((x) => ({ n: x.nome, d: x.data, h: x.horas }))),
          JSON.stringify(plano.remover), JSON.stringify(r.avisos), u.sub, autor]
      );
      if (plano.remover.length) await client.query('DELETE FROM ponto_batidas WHERE id = ANY($1::uuid[])', [plano.remover.map((x) => x.id)]);
      let inseridas = 0;
      for (const b of plano.inserir) {
        const res = await client.query(
          `INSERT INTO ponto_batidas (colaborador_id, data, hora, importacao_id) VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING`,
          [b.colaboradorId, b.data, b.hora, imp.id]
        );
        inseridas += res.rowCount ?? 0;
      }
      // Turnos do dia (aba Turnos do relógio): a importação mais nova vale.
      for (const t of r.turnos) {
        await client.query(
          `INSERT INTO ponto_turnos (colaborador_id, data, tipo, codigo, importacao_id) VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT (colaborador_id, data) DO UPDATE SET tipo = EXCLUDED.tipo, codigo = EXCLUDED.codigo,
             importacao_id = EXCLUDED.importacao_id, atualizado_em = NOW()`,
          [t.colaboradorId, t.data, t.tipo, t.codigo, imp.id]
        );
      }
      const ignorados = plano.ignorados + (plano.inserir.length - inseridas);
      await client.query('UPDATE ponto_importacoes SET novos = $2, atualizados = $3, ignorados = $4 WHERE id = $1',
        [imp.id, plano.novos, plano.atualizados, ignorados]);
      return imp.id;
    });
    await auditar('importacao', { id, arquivo: r.nome, modo: r.modo, periodo, novos: plano.novos, atualizados: plano.atualizados, substituidas: plano.remover.length }, u);
    return reply.status(201).send({ id, ...r.previa.contagens });
  });

  app.get('/api/pontos/importacoes', auth, async () => query(
    `SELECT id, arquivo_nome, modo, to_char(periodo_inicio, 'YYYY-MM-DD') AS periodo_inicio, to_char(periodo_fim, 'YYYY-MM-DD') AS periodo_fim,
            novos, atualizados, ignorados, avisos, importado_por_nome, criado_em, desfeita_em, desfeita_por_nome,
            (SELECT count(*)::int FROM ponto_batidas b WHERE b.importacao_id = i.id) AS batidas_atuais
     FROM ponto_importacoes i ORDER BY criado_em DESC LIMIT 200`
  ));

  app.post<{ Params: { id: string } }>('/api/pontos/importacoes/:id/desfazer', auth, async (req, reply) => {
    const u = req.user as Usuario;
    const autor = await nomeDe(u.sub);
    const resultado = await withTransaction(async (client) => {
      const { rows: [imp] } = await client.query<{ id: string; substituidas: BatidaExistente[]; desfeita_em: string | null }>(
        'SELECT id, substituidas, desfeita_em FROM ponto_importacoes WHERE id = $1 FOR UPDATE', [req.params.id]
      );
      if (!imp) return { status: 404 as const, message: 'Importação não encontrada.' };
      if (imp.desfeita_em) return { status: 409 as const, message: 'Essa importação já foi desfeita.' };
      const removidas = await client.query('DELETE FROM ponto_batidas WHERE importacao_id = $1', [imp.id]);
      await client.query('DELETE FROM ponto_turnos WHERE importacao_id = $1', [imp.id]);
      // Devolve as batidas que ela tinha substituído (só se a importação delas continua valendo).
      let devolvidas = 0;
      for (const s of imp.substituidas ?? []) {
        if (s.importacaoId) {
          const { rows: [orig] } = await client.query('SELECT desfeita_em FROM ponto_importacoes WHERE id = $1', [s.importacaoId]);
          if (!orig || orig.desfeita_em) continue;
        }
        const res = await client.query(
          'INSERT INTO ponto_batidas (colaborador_id, data, hora, importacao_id) VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING',
          [s.colaboradorId, s.data, s.hora, s.importacaoId]
        );
        devolvidas += res.rowCount ?? 0;
      }
      await client.query('UPDATE ponto_importacoes SET desfeita_em = NOW(), desfeita_por_nome = $2 WHERE id = $1', [imp.id, autor]);
      return { status: 200 as const, removidas: removidas.rowCount ?? 0, devolvidas };
    });
    if (resultado.status !== 200) return reply.status(resultado.status).send({ message: resultado.message });
    await auditar('importacao_desfeita', { id: req.params.id, removidas: resultado.removidas, devolvidas: resultado.devolvidas }, u);
    return { ok: true, removidas: resultado.removidas, devolvidas: resultado.devolvidas };
  });

  // ── relatório (CSV / PDF) ──
  app.post<{ Body: { colaboradorId?: string; de?: string; ate?: string; formato?: string } }>('/api/pontos/relatorio', auth, async (req, reply) => {
    const { colaboradorId, de, ate } = req.body ?? {};
    if (!colaboradorId || !de || !ate || !DIA.test(de) || !DIA.test(ate) || ate < de) return reply.status(400).send({ message: 'Colaborador e período obrigatórios.' });
    const c = await queryOne<ColabRow>(`${SELECT_COLAB} WHERE id = $1`, [colaboradorId]);
    if (!c) return reply.status(404).send({ message: 'Colaborador não encontrado.' });
    const dados = await dadosParaCalculo([c.id], de, ate);
    const { dias, resumo } = calcularDoColaborador(c, de, ate, dados);
    const rel = { colaborador: c.nome, inicio: de, fim: ate, dias, resumo, bancoAcumuladoMinutos: await bancoAcumulado(c, ate), valorHoraCentavos: valorHora(cfgDe(c)) };
    const base = `ponto-${c.nome.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-zA-Z0-9]+/g, '-').toLowerCase()}-${de}-a-${ate}`;
    await auditar('relatorio_exportado', { colaboradorId, de, ate, formato: req.body.formato === 'pdf' ? 'pdf' : 'csv' }, req.user as Usuario);
    if (req.body.formato === 'pdf') {
      const pdf = await renderFullHtmlToPdf(relatorioHtml(rel));
      reply.header('Content-Type', 'application/pdf');
      reply.header('Content-Disposition', `attachment; filename="${base}.pdf"`);
      return reply.send(pdf);
    }
    reply.header('Content-Type', 'text/csv; charset=utf-8');
    reply.header('Content-Disposition', `attachment; filename="${base}.csv"`);
    return reply.send(relatorioCsv(rel));
  });

  // ── auditoria ──
  app.get('/api/pontos/auditoria', auth, async () =>
    query('SELECT id, acao, detalhes, autor_nome, criado_em FROM ponto_auditoria ORDER BY criado_em DESC LIMIT 300'));
}
