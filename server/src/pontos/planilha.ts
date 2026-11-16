import * as XLSX from 'xlsx';

/**
 * Leitura da planilha do relógio de ponto (xlsx, xls ou csv) — só como DADO: fórmulas, macros e HTML não são
 * avaliados (lemos o valor bruto de cada célula). Puro: recebe o arquivo, devolve as linhas lidas.
 *
 * Formatos que a leitura automática entende (por aba):
 *  - uma linha por batida: Nome | Data | Hora   (ou Nome | Data e hora);
 *  - uma linha por dia:    Nome | Data | Entrada 1 | Saída 1 | Entrada 2 | Saída 2 …;
 *  - uma linha por dia com as batidas num campo só: Nome | Data | Marcações ("08:01 12:00 13:02 18:05");
 *  - sem coluna de nome: o nome vem do topo da aba ("Funcionário: JEAN …") ou do nome da aba.
 * Coluna que não for reconhecida: a tela de mapeamento pede, e o mapeamento fica salvo pela "assinatura" dos
 * cabeçalhos pras próximas importações.
 */

export type PapelColuna = 'ignorar' | 'nome' | 'data' | 'datahora' | 'hora' | 'batida' | 'batidas_texto';

export interface Mapeamento {
  /** Índice (0-based) da linha de cabeçalho na aba. */
  linhaCabecalho: number;
  /** índice da coluna -> papel. */
  colunas: Record<string, PapelColuna>;
}

export interface RegistroLido {
  aba: string;
  linha: number; // 1-based, como no Excel
  nome: string;
  data: string; // AAAA-MM-DD
  horas: string[]; // "HH:MM" (24h+ quando passou da meia-noite na mesma linha)
}

export interface LinhaInvalida { aba: string; linha: number; motivo: string }

export interface AbaLida {
  nome: string;
  cabecalhos: string[];
  assinatura: string;
  mapeamento: Mapeamento | null;
  precisaMapeamento: boolean;
  /** Nome do colaborador vindo do topo da aba/nome da aba (quando não há coluna de nome). */
  nomeDaAba: string;
  amostra: string[][];
}

export interface LeituraDaPlanilha {
  abas: AbaLida[];
  registros: RegistroLido[];
  invalidas: LinhaInvalida[];
  periodo: { inicio: string; fim: string } | null;
  /** Mês com mais datas (AAAA-MM). */
  mesProvavel: string | null;
  /** 'relogio' = exportação do relógio (abas Registros/Turnos/resumo); 'colunas' = planilha comum. */
  formato: 'relogio' | 'colunas';
  /** Período declarado no arquivo ("2026/11/01 ~ 11/16"), quando tem. */
  periodoArquivo: { inicio: string; fim: string } | null;
  /** Aba Turnos: dia com turno, sem turno ou ausência justificada. nome '*' = vale pra todos. */
  turnos: TurnoLido[];
  /** Totais que o relógio calculou (aba resumo), só pra conferência. */
  conferencia: ConferenciaLida[];
  /** Observações da leitura (abas ignoradas etc.). */
  observacoes: string[];
  /** Relógio: todos os colaboradores da aba Registros (inclusive quem não tem batida nenhuma no período). */
  nomes?: string[];
}

export interface TurnoLido { nome: string; data: string; tipo: 'turno' | 'sem_turno' | 'justificada'; codigo: string | null }
export interface ConferenciaLida { aba: string; nome: string; campos: Record<string, string> }

export const TAMANHO_MAXIMO = 5 * 1024 * 1024;
export const EXTENSOES = ['xlsx', 'xls', 'csv'];

const norm = (s: unknown) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
const normCompacto = (s: unknown) => norm(s).replace(/[^a-z0-9]/g, '');

/** Confere extensão, tamanho e "cara" do arquivo (assinatura dos primeiros bytes). Devolve o erro ou null. */
export function validarArquivo(nome: string, buf: Buffer): string | null {
  const ext = (nome.split('.').pop() ?? '').toLowerCase();
  if (!EXTENSOES.includes(ext)) return 'Formato não aceito: envie .xlsx, .xls ou .csv.';
  if (!buf.length) return 'Arquivo vazio.';
  if (buf.length > TAMANHO_MAXIMO) return 'Arquivo maior que 5 MB.';
  const zip = buf[0] === 0x50 && buf[1] === 0x4b; // xlsx = zip
  const ole = buf[0] === 0xd0 && buf[1] === 0xcf && buf[2] === 0x11 && buf[3] === 0xe0; // xls antigo
  if (ext === 'xlsx' && !zip) return 'O arquivo não parece um .xlsx válido.';
  if (ext === 'xls' && !ole && !zip && !textoPuro(buf)) return 'O arquivo não parece um .xls válido.';
  if (ext === 'csv' && !textoPuro(buf)) return 'O arquivo não parece um .csv (texto) válido.';
  return null;
}

function decodificarTexto(buf: Buffer): string {
  const semBom = buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf ? buf.subarray(3) : buf;
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(semBom);
  } catch {
    return new TextDecoder('windows-1252').decode(semBom);
  }
}

function textoPuro(buf: Buffer): boolean {
  const n = Math.min(buf.length, 4096);
  for (let i = 0; i < n; i++) if (buf[i] === 0) return false;
  return true;
}

// ───────────────────────────── valores de célula ─────────────────────────────

/** Converte o valor de uma célula numa data AAAA-MM-DD (aceita número de série do Excel, dd/mm/aaaa, aaaa-mm-dd). */
export function lerData(v: unknown): string | null {
  if (v == null || v === '') return null;
  if (typeof v === 'number' && v > 20000 && v < 80000) {
    const p = XLSX.SSF.parse_date_code(v);
    if (!p) return null;
    return `${p.y}-${String(p.m).padStart(2, '0')}-${String(p.d).padStart(2, '0')}`;
  }
  const s = String(v).trim();
  let m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})/.exec(s);
  if (m) {
    const ano = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
    return dataValida(ano, Number(m[2]), Number(m[1]));
  }
  m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s);
  if (m) return dataValida(Number(m[1]), Number(m[2]), Number(m[3]));
  return null;
}

function dataValida(a: number, m: number, d: number): string | null {
  if (m < 1 || m > 12 || d < 1 || d > 31 || a < 2000 || a > 2100) return null;
  const iso = `${a}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  const dt = new Date(`${iso}T12:00:00Z`);
  return dt.toISOString().slice(0, 10) === iso ? iso : null;
}

/** Converte o valor de uma célula num horário "HH:MM" (aceita fração do dia do Excel, "8:05", "08:05:33"). */
export function lerHora(v: unknown): string | null {
  if (v == null || v === '') return null;
  if (typeof v === 'number') {
    const frac = v % 1;
    if (v >= 1 && frac === 0) return null; // só data
    const total = Math.round(frac * 24 * 60);
    if (total >= 24 * 60) return null;
    return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
  }
  const m = /(?:^|\s|T)(\d{1,2}):(\d{2})(?::\d{2})?/.exec(String(v).trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
}

/** Todos os horários de um campo de texto ("08:01 12:00 13:02 18:05" / "08:01-12:00;13:02-18:05"). */
export function lerHoras(v: unknown): string[] {
  if (typeof v === 'number') { const h = lerHora(v); return h ? [h] : []; }
  return [...String(v ?? '').matchAll(/(\d{1,2}):(\d{2})/g)]
    .map(([, h, m]) => (Number(h) <= 23 && Number(m) <= 59 ? `${h.padStart(2, '0')}:${m}` : null))
    .filter((x): x is string => !!x);
}

/** Na mesma linha, horário menor que o anterior = passou da meia-noite: soma 24h ("02:10" depois de "22:00" -> "26:10"). */
export function aplicarViradaNaLinha(horas: string[]): string[] {
  let extra = 0;
  let anterior = -1;
  return horas.map((h) => {
    const [hh, mm] = h.split(':').map(Number);
    let min = hh * 60 + mm + extra;
    if (anterior >= 0 && min < anterior) { extra += 24 * 60; min += 24 * 60; }
    anterior = min;
    return `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
  });
}

// ───────────────────────────── detecção de colunas ─────────────────────────────

/** Papel provável de uma coluna pelo nome do cabeçalho. */
export function papelPeloCabecalho(cabecalho: string): PapelColuna | null {
  const c = normCompacto(cabecalho);
  if (!c) return null;
  if (/^(nome|funcionario|colaborador|empregado|servidor|nomedofuncionario|nomefuncionario)/.test(c)) return 'nome';
  if (/^(datahora|dataehora|datahorario|dataemarcacao)/.test(c)) return 'datahora';
  if (/^(data|dia|date)$/.test(c) || /^data(da)?(marcacao|batida|registro)?$/.test(c)) return 'data';
  if (/^(marcacoes|batidas|registros|horarios)$/.test(c)) return 'batidas_texto';
  if (/^(hora|horario|horamarcacao|horadabatida|horabatida|time)$/.test(c)) return 'hora';
  if (/^(entrada|saida|ent|sai|e|s)\d*$/.test(c) || /^(entrada|saida)(manha|tarde|almoco|intervalo)?\d*$/.test(c)
    || /^(marcacao|batida|registro)\d+$/.test(c) || /^(\d+)(a|o)?(entrada|saida)$/.test(c)) return 'batida';
  return null;
}

/** "Funcionário: JEAN MAY" / "Nome: João" no topo da aba. */
function nomeNoTopo(linhas: unknown[][], ate: number): string {
  for (let i = 0; i < Math.min(ate, linhas.length); i++) {
    const texto = (linhas[i] ?? []).map((c) => String(c ?? '')).join(' ').trim();
    const m = /(?:funcion[aá]rio|colaborador|empregado|nome)\s*[:-]\s*([^\d|;]{2,60})/i.exec(texto);
    if (m) return m[1].replace(/\s+/g, ' ').trim();
  }
  return '';
}

/** Acha a linha de cabeçalho (até a 20ª) e os papéis das colunas. */
export function detectarMapeamento(linhas: unknown[][]): { mapeamento: Mapeamento | null; cabecalhos: string[] } {
  let melhor: { linha: number; colunas: Record<string, PapelColuna>; pontos: number } | null = null;
  for (let i = 0; i < Math.min(20, linhas.length); i++) {
    const colunas: Record<string, PapelColuna> = {};
    let pontos = 0;
    (linhas[i] ?? []).forEach((c, idx) => {
      const p = papelPeloCabecalho(String(c ?? ''));
      if (p) { colunas[String(idx)] = p; pontos += 1; }
    });
    const temData = Object.values(colunas).some((p) => p === 'data' || p === 'datahora');
    const temHora = Object.values(colunas).some((p) => p === 'hora' || p === 'batida' || p === 'batidas_texto' || p === 'datahora');
    if (temData && temHora && (!melhor || pontos > melhor.pontos)) melhor = { linha: i, colunas, pontos };
  }
  if (!melhor) {
    const cab = (linhas[0] ?? []).map((c) => String(c ?? ''));
    return { mapeamento: null, cabecalhos: cab };
  }
  return {
    mapeamento: { linhaCabecalho: melhor.linha, colunas: melhor.colunas },
    cabecalhos: (linhas[melhor.linha] ?? []).map((c) => String(c ?? '')),
  };
}

export function assinaturaDosCabecalhos(cabecalhos: string[]): string {
  return cabecalhos.map(normCompacto).filter(Boolean).join('|') || '(sem cabeçalho)';
}

// ───────────────────────────── leitura ─────────────────────────────

/** Lê as abas do arquivo como linhas de valores brutos (sem avaliar fórmula nenhuma). */
export function lerAbas(buf: Buffer): { nome: string; linhas: unknown[][] }[] {
  const opcoes = { cellDates: false, cellFormula: false, cellHTML: false, cellStyles: false, raw: true, dense: false } as const;
  const binario = (buf[0] === 0x50 && buf[1] === 0x4b) || (buf[0] === 0xd0 && buf[1] === 0xcf);
  // CSV/texto: decodifica antes (UTF-8; se não for UTF-8 válido, Windows-1252, comum nos relógios de ponto).
  const wb = binario
    ? XLSX.read(buf, { ...opcoes, type: 'buffer' })
    : XLSX.read(decodificarTexto(buf), { ...opcoes, type: 'string' });
  return wb.SheetNames.map((nome) => ({
    nome,
    linhas: XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[nome], { header: 1, raw: true, defval: '', blankrows: false }),
  }));
}

/**
 * Lê a planilha toda. `mapeamentosSalvos` (assinatura -> mapeamento) e `mapeamentoManual` (por nome de aba) vencem a
 * detecção automática.
 */
export function lerPlanilha(
  buf: Buffer,
  mapeamentosSalvos: Record<string, Mapeamento> = {},
  mapeamentoManual: Record<string, Mapeamento> = {},
): LeituraDaPlanilha {
  const todas = lerAbas(buf);
  // Exportação do relógio (abas Registros/Turnos/resumo): leitor próprio, sem mapeamento de colunas.
  const relogio = lerExportacaoDoRelogio(todas);
  if (relogio) return relogio;

  const abas: AbaLida[] = [];
  const registros: RegistroLido[] = [];
  const invalidas: LinhaInvalida[] = [];

  for (const { nome: aba, linhas } of todas) {
    if (!linhas.length) continue;
    const auto = detectarMapeamento(linhas);
    // Mapeamento salvo: acha a linha cujo cabeçalho tem a mesma assinatura (o cabeçalho pode ter mudado de linha de um
    // arquivo pro outro, ex.: um título a mais em cima). Vale a linha onde ele está AGORA, não a do arquivo antigo.
    let salvo: Mapeamento | null = null;
    for (let i = 0; i < Math.min(20, linhas.length) && !salvo; i++) {
      const s = mapeamentosSalvos[assinaturaDosCabecalhos((linhas[i] ?? []).map((c) => String(c ?? '')))];
      if (s) salvo = { ...s, linhaCabecalho: i };
    }
    const mapa = mapeamentoManual[aba] ?? salvo ?? auto.mapeamento;
    const cabecalhos = mapa ? (linhas[mapa.linhaCabecalho] ?? []).map((c) => String(c ?? '')) : auto.cabecalhos;
    const assinatura = assinaturaDosCabecalhos(cabecalhos);
    const papeis = mapa ? Object.values(mapa.colunas) : [];
    const temNome = papeis.includes('nome');
    const nomeDaAba = temNome ? '' : (nomeNoTopo(linhas, mapa?.linhaCabecalho ?? 10) || (/^(sheet|planilha|plan)\s*\d*$/i.test(aba) ? '' : aba));
    const precisaMapeamento = !mapa
      || !papeis.some((p) => p === 'data' || p === 'datahora')
      || !papeis.some((p) => p === 'hora' || p === 'batida' || p === 'batidas_texto' || p === 'datahora');
    abas.push({
      nome: aba, cabecalhos, assinatura, mapeamento: mapa, precisaMapeamento, nomeDaAba,
      amostra: linhas.slice(mapa ? mapa.linhaCabecalho : 0, (mapa ? mapa.linhaCabecalho : 0) + 6).map((l) => l.map((c) => String(c ?? ''))),
    });
    if (precisaMapeamento || !mapa) continue;

    const ordem = Object.entries(mapa.colunas).map(([i, p]) => [Number(i), p] as const).sort((a, b) => a[0] - b[0]);
    for (let i = mapa.linhaCabecalho + 1; i < linhas.length; i++) {
      const linha = linhas[i] ?? [];
      if (linha.every((c) => String(c ?? '').trim() === '')) continue;
      let nome = '';
      let data: string | null = null;
      const horas: string[] = [];
      for (const [idx, papel] of ordem) {
        const v = linha[idx];
        if (papel === 'nome') nome = String(v ?? '').trim();
        else if (papel === 'data') data = data ?? lerData(v);
        else if (papel === 'datahora') {
          data = data ?? lerData(typeof v === 'number' ? Math.floor(v) : v);
          const h = lerHora(v);
          if (h) horas.push(h);
        } else if (papel === 'hora' || papel === 'batida') {
          const h = lerHora(v);
          if (h) horas.push(h);
        } else if (papel === 'batidas_texto') horas.push(...lerHoras(v));
      }
      if (!nome) nome = nomeDaAba;
      const numero = i + 1;
      if (!data) {
        // Linha de rodapé/total sem data e sem horário: ignora calado. Com horário e sem data: inválida.
        if (horas.length) invalidas.push({ aba, linha: numero, motivo: 'Data não reconhecida' });
        continue;
      }
      if (!nome) { invalidas.push({ aba, linha: numero, motivo: 'Sem nome do colaborador' }); continue; }
      if (!horas.length) continue; // dia sem batida na planilha: nada a gravar (falta é calculada)
      registros.push({ aba, linha: numero, nome, data, horas: aplicarViradaNaLinha(horas) });
    }
  }

  const datas = registros.map((r) => r.data).sort();
  const porMes = new Map<string, number>();
  for (const d of datas) porMes.set(d.slice(0, 7), (porMes.get(d.slice(0, 7)) ?? 0) + 1);
  const mesProvavel = [...porMes.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] ?? null;
  return {
    abas, registros, invalidas,
    periodo: datas.length ? { inicio: datas[0], fim: datas[datas.length - 1] } : null,
    mesProvavel, formato: 'colunas', periodoArquivo: null, turnos: [], conferencia: [], observacoes: [],
  };
}

// ───────────────────────────── exportação do relógio ─────────────────────────────
//
// Formato do relógio (abas resumo, Turnos, Registros, Anormal, …):
//  - Registros: período em texto ("2026/11/01 ~ 11/16\t( nx digital )"); uma linha com os dias 1..31 (coluna A = dia 1);
//    cada colaborador em 2 linhas: "No:" / "Nome:" / "Dept:" e, embaixo, uma célula por dia com as batidas separadas
//    por quebra de linha ("08:18\n12:16\n13:55\n18:10\n");
//  - Turnos: linha com o dia da semana (Su Mo Tu We Th Fr Sa) e "1" no dia com turno; 25 = licença, 26 = viagem,
//    "férias" = ausência justificada; vazio = sem turno;
//  - resumo / Anormal / outras: NÃO entram no cálculo; o resumo é lido só pra conferir com o nosso cálculo.

const texto = (v: unknown) => String(v ?? '').trim();
const ehRotulo = (v: unknown, r: RegExp) => r.test(norm(v));

/** "2026/11/01 ~ 11/16" (ou "2026/10/26 ~ 2026/11/25") -> início e fim. */
export function lerPeriodoDoTexto(v: unknown): { inicio: string; fim: string } | null {
  const m = /(\d{4})[/.-](\d{1,2})[/.-](\d{1,2})\s*~\s*(?:(\d{4})[/.-])?(\d{1,2})[/.-](\d{1,2})/.exec(String(v ?? ''));
  if (!m) return null;
  const inicio = dataValida(Number(m[1]), Number(m[2]), Number(m[3]));
  let anoFim = m[4] ? Number(m[4]) : Number(m[1]);
  if (!m[4] && Number(m[5]) < Number(m[2])) anoFim += 1; // 2026/12/20 ~ 01/19
  const fim = dataValida(anoFim, Number(m[5]), Number(m[6]));
  return inicio && fim && fim >= inicio ? { inicio, fim } : null;
}

/** Linha com os dias do mês (1, 2, 3 … em colunas seguidas): índice da coluna -> dia. */
function linhaDeDias(linhas: unknown[][], ate = 15): { linha: number; dias: Map<number, number> } | null {
  for (let i = 0; i < Math.min(ate, linhas.length); i++) {
    const dias = new Map<number, number>();
    (linhas[i] ?? []).forEach((c, idx) => {
      const n = Number(texto(c));
      if (texto(c) !== '' && Number.isInteger(n) && n >= 1 && n <= 31) dias.set(idx, n);
    });
    // Precisa ser uma sequência (1, 2, 3 …) em pelo menos 5 colunas seguidas.
    const seq = [...dias.entries()].sort((a, b) => a[0] - b[0]);
    let seguidas = 1;
    let melhor = seq.length ? 1 : 0;
    for (let k = 1; k < seq.length; k++) {
      seguidas = seq[k][0] === seq[k - 1][0] + 1 && seq[k][1] === seq[k - 1][1] + 1 ? seguidas + 1 : 1;
      melhor = Math.max(melhor, seguidas);
    }
    if (melhor >= 5) return { linha: i, dias };
  }
  return null;
}

/** Dia do mês -> data, dentro do período do arquivo (o período pode virar o mês: 26/10 ~ 25/11). */
function mapaDeDias(periodo: { inicio: string; fim: string }): Map<number, string> {
  const m = new Map<number, string>();
  for (let d = new Date(`${periodo.inicio}T12:00:00Z`); d.toISOString().slice(0, 10) <= periodo.fim; d.setUTCDate(d.getUTCDate() + 1)) {
    if (!m.has(d.getUTCDate())) m.set(d.getUTCDate(), d.toISOString().slice(0, 10));
  }
  return m;
}

/** Nome do colaborador numa linha "No: 1 … Nome: joao vitor … Dept: …". */
function nomeDaLinha(linha: unknown[]): string | null {
  for (let i = 0; i < linha.length; i++) {
    const m = /^nome\s*:\s*(.*)$/i.exec(texto(linha[i]));
    if (!m) continue;
    if (m[1].trim()) return m[1].trim();
    for (let j = i + 1; j < linha.length; j++) {
      const v = texto(linha[j]);
      if (!v) continue;
      return /^(dept|depto|departamento|no)\s*:/i.test(v) ? null : v;
    }
  }
  return null;
}
const ehLinhaDeColaborador = (linha: unknown[]) => linha.some((c) => ehRotulo(c, /^no\s*:/)) && linha.some((c) => ehRotulo(c, /^nome\s*:/));

export function lerExportacaoDoRelogio(todas: { nome: string; linhas: unknown[][] }[]): LeituraDaPlanilha | null {
  const aba = todas.find((a) => norm(a.nome) === 'registros' && a.linhas.some(ehLinhaDeColaborador));
  if (!aba) return null;
  const observacoes: string[] = [];
  const invalidas: LinhaInvalida[] = [];
  const registros: RegistroLido[] = [];
  const abaLida = (amostra: string[][]): AbaLida => ({
    nome: aba.nome, cabecalhos: [], assinatura: 'relogio:registros', mapeamento: null, precisaMapeamento: false, nomeDaAba: '', amostra,
  });

  // Período em texto (Registros primeiro, depois as outras abas).
  let periodoArquivo: { inicio: string; fim: string } | null = null;
  for (const a of [aba, ...todas.filter((x) => x !== aba)]) {
    for (const l of a.linhas.slice(0, 15)) for (const c of l) periodoArquivo = periodoArquivo ?? lerPeriodoDoTexto(c);
    if (periodoArquivo) break;
  }
  const cab = linhaDeDias(aba.linhas);
  if (!periodoArquivo || !cab) {
    observacoes.push(!periodoArquivo ? 'Não achei o período ("aaaa/mm/dd ~ mm/dd") na aba Registros.' : 'Não achei a linha com os dias (1..31) na aba Registros.');
    return {
      abas: [abaLida(aba.linhas.slice(0, 6).map((l) => l.map(texto)))], registros, invalidas, periodo: null, mesProvavel: null,
      formato: 'relogio', periodoArquivo, turnos: [], conferencia: [], observacoes,
    };
  }
  const dataDoDia = mapaDeDias(periodoArquivo);
  const nomes: string[] = [];

  for (let i = cab.linha + 1; i < aba.linhas.length; i++) {
    const linha = aba.linhas[i] ?? [];
    if (!ehLinhaDeColaborador(linha)) continue;
    const nome = nomeDaLinha(linha);
    // A linha das batidas vem logo embaixo. Colaborador sem nenhuma batida: a linha vazia some na leitura e a de baixo já
    // é o próximo colaborador; aí não consome.
    const proxima = aba.linhas[i + 1] ?? [];
    const batidasDaLinha = ehLinhaDeColaborador(proxima) ? [] : proxima;
    if (batidasDaLinha === proxima) i += 1;
    if (!nome) { invalidas.push({ aba: aba.nome, linha: i, motivo: 'Colaborador sem nome' }); continue; }
    nomes.push(nome);
    for (const [idx, diaDoMes] of cab.dias) {
      const v = batidasDaLinha[idx];
      // Texto ("08:18\n12:16\n…"); número só se o Excel tiver guardado um horário solto.
      const horas = lerHoras(typeof v === 'number' ? v : texto(v));
      if (!horas.length) continue;
      const data = dataDoDia.get(diaDoMes);
      if (!data) { invalidas.push({ aba: aba.nome, linha: i + 1, motivo: `Dia ${diaDoMes} fora do período do arquivo` }); continue; }
      registros.push({ aba: aba.nome, linha: i + 1, nome, data, horas: aplicarViradaNaLinha(horas) });
    }
  }

  const turnos: TurnoLido[] = [];
  const abaTurnos = todas.find((a) => norm(a.nome) === 'turnos');
  if (abaTurnos) turnos.push(...lerTurnos(abaTurnos.linhas, periodoArquivo, observacoes));
  else observacoes.push('Sem aba "Turnos": dias úteis pelo cadastro de cada colaborador.');

  const conferencia: ConferenciaLida[] = [];
  const abaResumo = todas.find((a) => norm(a.nome) === 'resumo');
  if (abaResumo) conferencia.push(...lerResumo(abaResumo.nome, abaResumo.linhas, nomes));
  const outras = todas.filter((a) => a !== aba && a !== abaTurnos).map((a) => a.nome);
  if (outras.length) observacoes.push(`Abas que não entram no cálculo (só conferência): ${outras.join(', ')}.`);

  const datas = registros.map((r) => r.data).sort();
  return {
    abas: [abaLida(aba.linhas.slice(cab.linha, cab.linha + 5).map((l) => l.slice(0, 16).map((c) => texto(c).replace(/\s+/g, ' '))))],
    registros, invalidas,
    periodo: datas.length ? { inicio: datas[0], fim: datas[datas.length - 1] } : null,
    mesProvavel: periodoArquivo.fim.slice(0, 7),
    formato: 'relogio', periodoArquivo, turnos, conferencia, observacoes, nomes,
  };
}

const DIAS_EN = ['su', 'mo', 'tu', 'we', 'th', 'fr', 'sa'];
const diaEn = (v: unknown) => { const n = norm(v); return n.length >= 2 && n.length <= 3 && DIAS_EN.includes(n.slice(0, 2)) ? n.slice(0, 2) : null; };

/** Valor da célula da aba Turnos -> tipo do dia (vazio = sem turno; 25/26/férias = justificada; resto = turno). */
export function tipoDoTurno(v: unknown): { tipo: TurnoLido['tipo']; codigo: string | null } {
  const c = texto(v);
  const n = norm(c);
  if (!c) return { tipo: 'sem_turno', codigo: null };
  if (n === '25' || n === '26' || n.startsWith('feria')) return { tipo: 'justificada', codigo: c };
  return { tipo: 'turno', codigo: null };
}

function lerTurnos(linhas: unknown[][], periodo: { inicio: string; fim: string }, observacoes: string[]): TurnoLido[] {
  const iSemana = linhas.findIndex((l, i) => i < 20 && (l ?? []).filter((c) => diaEn(c)).length >= 5);
  if (iSemana < 0) { observacoes.push('Aba Turnos sem a linha dos dias da semana (Su Mo Tu …): dias úteis pelo cadastro.'); return []; }
  // Coluna -> data: pela linha de dias (se a aba tiver) ou coluna A = dia 1; e o dia da semana tem que bater.
  const cab = linhaDeDias(linhas.slice(0, iSemana + 2), iSemana + 2);
  const dataDoDia = mapaDeDias(periodo);
  const colunaData = new Map<number, string>();
  (linhas[iSemana] ?? []).forEach((c, idx) => {
    const dSemana = diaEn(c);
    if (!dSemana) return;
    const data = dataDoDia.get(cab?.dias.get(idx) ?? idx + 1);
    if (data && DIAS_EN[new Date(`${data}T12:00:00Z`).getUTCDay()] === dSemana) colunaData.set(idx, data);
  });
  if (!colunaData.size) { observacoes.push('Aba Turnos: os dias da semana não batem com o período do arquivo; dias úteis pelo cadastro.'); return []; }

  const out: TurnoLido[] = [];
  const lerLinha = (nome: string, l: unknown[]) => { for (const [idx, data] of colunaData) out.push({ nome, data, ...tipoDoTurno(l[idx]) }); };
  let porColaborador = false;
  // Formato do relógio: "No | Nome | Dept. | 1 | 2 | …" e uma linha por colaborador, com o nome na coluna "Nome".
  const idxNome = [cab?.linha, iSemana - 1, iSemana].filter((x): x is number => x != null && x >= 0)
    .map((i) => (linhas[i] ?? []).findIndex((c) => /^nome$/.test(norm(c).replace(/[^a-z]/g, ''))))
    .find((x) => x >= 0);
  if (idxNome != null) {
    for (const l of linhas.slice(iSemana + 1)) {
      const nome = texto((l ?? [])[idxNome]);
      if (nome && !/^(especial|legenda|nota)/i.test(nome)) { lerLinha(nome, l); porColaborador = true; }
    }
  }
  // Outro formato: blocos "No: … Nome: …" com os turnos na linha de baixo.
  if (!porColaborador) {
    for (let i = iSemana + 1; i < linhas.length; i++) {
      if (!ehLinhaDeColaborador(linhas[i] ?? [])) continue;
      const nome = nomeDaLinha(linhas[i]);
      if (nome && linhas[i + 1]) { lerLinha(nome, linhas[i + 1]); porColaborador = true; }
      i += 1;
    }
  }
  if (!porColaborador) {
    // Uma linha só (vale pra todos): a primeira linha depois dos dias da semana com valor em alguma coluna de dia.
    const linha = linhas.slice(iSemana + 1).find((l) => [...colunaData.keys()].some((idx) => texto((l ?? [])[idx])));
    if (linha) lerLinha('*', linha);
  }
  return out;
}

/**
 * Aba resumo: cabeçalho em até duas linhas ("Atraso" mesclado em cima de "Vezes | Min") + uma linha por colaborador.
 * Só pra conferência; nada daqui entra no cálculo.
 */
function lerResumo(nomeAba: string, linhas: unknown[][], nomes: string[]): ConferenciaLida[] {
  const alvo = new Set(nomes.map(normalizarNome));
  const out: ConferenciaLida[] = [];
  const cabecalhos: string[][] = []; // linhas "cheias" (3+ células) antes do primeiro colaborador
  let rotulos: string[] | null = null;
  for (const bruta of linhas) {
    const l = (bruta ?? []).map((c) => texto(c).replace(/\s+/g, ' '));
    const idxNome = l.findIndex((c) => c && alvo.has(normalizarNome(c)));
    if (idxNome < 0) {
      if (!out.length && l.filter(Boolean).length >= 3) { cabecalhos.push(l); rotulos = null; }
      continue;
    }
    if (!rotulos) {
      // Cabeçalho de cima (célula mesclada vale pras colunas seguintes enquanto a de baixo tiver subtítulo) + o de baixo.
      const [cima, baixo] = cabecalhos.length >= 2 ? cabecalhos.slice(-2) : [cabecalhos[cabecalhos.length - 1] ?? [], []];
      rotulos = [];
      let mesclado = '';
      const n = Math.max(cima.length, baixo.length, l.length);
      for (let idx = 0; idx < n; idx++) {
        if (cima[idx]) mesclado = cima[idx];
        else if (!baixo[idx]) mesclado = '';
        const topo = cima[idx] || (baixo[idx] ? mesclado : '');
        rotulos.push([topo, baixo[idx]].filter(Boolean).join(' ').trim());
      }
    }
    const campos: Record<string, string> = {};
    l.forEach((v, idx) => {
      if (idx === idxNome || !v) return;
      const rotulo = rotulos![idx] || `Coluna ${idx + 1}`;
      if (/^(no|dept\.?|departamento)$/i.test(rotulo)) return;
      campos[rotulo] = v;
    });
    out.push({ aba: nomeAba, nome: l[idxNome], campos });
  }
  return out;
}

// ───────────────────────────── nomes ─────────────────────────────

export interface ColaboradorParaVinculo { id: string; nome: string; apelidos: string[]; ativo: boolean }

export const normalizarNome = (s: string) => norm(s).replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();

/**
 * Acha o colaborador de um nome da planilha (sem acento nem maiúscula): nome ou apelido igual; senão, o primeiro nome
 * igual (se só um colaborador ativo tiver esse primeiro nome). Não achou: null (a tela pede pra associar).
 */
export function vincularNome(nomePlanilha: string, colaboradores: ColaboradorParaVinculo[]): string | null {
  const n = normalizarNome(nomePlanilha);
  if (!n) return null;
  const ativos = colaboradores.filter((c) => c.ativo);
  const exato = ativos.find((c) => normalizarNome(c.nome) === n || c.apelidos.some((a) => normalizarNome(a) === n));
  if (exato) return exato.id;
  const primeiro = n.split(' ')[0];
  const mesmos = ativos.filter((c) => normalizarNome(c.nome).split(' ')[0] === primeiro);
  return mesmos.length === 1 ? mesmos[0].id : null;
}
