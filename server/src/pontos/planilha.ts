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
}

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
  const abas: AbaLida[] = [];
  const registros: RegistroLido[] = [];
  const invalidas: LinhaInvalida[] = [];

  for (const { nome: aba, linhas } of lerAbas(buf)) {
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
    mesProvavel,
  };
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
